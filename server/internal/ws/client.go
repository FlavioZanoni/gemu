package ws

import (
	"encoding/json"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"golang.org/x/time/rate"

	"gemu-server/internal/rooms"
)

const (
	// sendQueueLen bounds the per-client outbound queue (messages). A client
	// that falls this far behind is dropped instead of stalling broadcasts.
	sendQueueLen = 256
	// maxQueuedBytes bounds the same queue by size: room snapshots can carry
	// a dozen 256KB avatars, so a message count alone isn't a memory bound.
	maxQueuedBytes = 32 << 20
	// writeWait is the per-write deadline: a socket that can't take a frame
	// in this long is dead or hostile.
	writeWait  = 10 * time.Second
	pingPeriod = 25 * time.Second

	// Per-connection inbound rates. game.stream carries canvas strokes (the
	// client batches them, but a fast drawer still sends tens per second);
	// everything else is human-paced (ready toggles, guesses, votes).
	streamRatePerSec rate.Limit = 60
	streamBurst                 = 120
	msgRatePerSec    rate.Limit = 20
	msgBurst                    = 40
)

type Client struct {
	ID string
	// Conn is nil for in-process test clients.
	Conn *websocket.Conn
	// RoomID/Player/SessionID are the connection's room identity. They are
	// written under Hub.mu (bindClient, kick, session takeover) and must be
	// read under it too from any goroutine but the test harness — use
	// Hub.ident.
	RoomID    string
	Player    rooms.Player
	SessionID string
	IP        string

	// send is the outbound queue drained by writePump: every write goes
	// through it, so no broadcaster ever blocks on a slow socket (and never
	// while holding a room's session lock). nil = writes are dropped.
	send      chan []byte
	done      chan struct{}
	closeOnce sync.Once
	queued    atomic.Int64

	msgLimit    *rate.Limiter
	streamLimit *rate.Limiter
}

func newClient(conn *websocket.Conn, ip string) *Client {
	return &Client{
		ID:          uuid.NewString(),
		Conn:        conn,
		IP:          ip,
		send:        make(chan []byte, sendQueueLen),
		done:        make(chan struct{}),
		msgLimit:    rate.NewLimiter(msgRatePerSec, msgBurst),
		streamLimit: rate.NewLimiter(streamRatePerSec, streamBurst),
	}
}

// allow applies the per-connection token bucket for this message type.
// Clients built without limiters (tests) are unlimited.
func (c *Client) allow(msgType string) bool {
	lim := c.msgLimit
	if msgType == "game.stream" {
		lim = c.streamLimit
	}
	return lim == nil || lim.Allow()
}

// write serializes env now (callers often hold the session lock that guards
// the adapter state inside the payload) and queues the bytes.
func (c *Client) write(env Envelope) {
	if c == nil || c.send == nil {
		return
	}
	b, err := json.Marshal(env)
	if err != nil {
		log.Printf("marshal %s for %s: %v", env.Type, c.ID, err)
		return
	}
	c.enqueue(b)
}

// enqueue never blocks: a full queue means the peer stopped reading, so the
// connection is closed (its read loop then runs RemoveClient).
func (c *Client) enqueue(b []byte) {
	if c == nil || c.send == nil {
		return
	}
	select {
	case <-c.done:
		return
	default:
	}
	size := int64(len(b))
	if c.queued.Add(size) > maxQueuedBytes {
		c.queued.Add(-size)
		log.Printf("client %s outbound queue over %d bytes; dropping", c.ID, maxQueuedBytes)
		c.close()
		return
	}
	select {
	case c.send <- b:
	default:
		c.queued.Add(-size)
		log.Printf("client %s outbound queue full; dropping", c.ID)
		c.close()
	}
}

// writePump is the connection's only writer (data frames and pings), so
// gorilla's one-concurrent-writer rule holds without a mutex, and every
// write carries a deadline.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.close()
	}()
	for {
		select {
		case <-c.done:
			return
		case b := <-c.send:
			c.queued.Add(-int64(len(b)))
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.TextMessage, b); err != nil {
				return
			}
		case <-ticker.C:
			if err := c.Conn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(writeWait)); err != nil {
				return
			}
		}
	}
}

// close stops the writer and closes the socket (unblocking any stuck write
// and the read loop). Idempotent.
func (c *Client) close() {
	if c == nil {
		return
	}
	c.closeOnce.Do(func() {
		if c.done != nil {
			close(c.done)
		}
		if c.Conn != nil {
			_ = c.Conn.Close()
		}
	})
}

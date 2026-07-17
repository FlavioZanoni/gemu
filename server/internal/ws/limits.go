package ws

import (
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Capacity ceilings (ops-tunable via env) and fixed per-actor rate limits.
// These turn a friends-only server into one that survives a public URL: a
// single abusive client can no longer exhaust memory by spamming rooms or
// flooding actions.
var (
	maxClients = envInt("GEMU_MAX_CLIENTS", 5000) // global concurrent connections
	maxRooms   = envInt("GEMU_MAX_ROOMS", 1000)   // global live rooms
	// trustProxy: only read X-Forwarded-For when explicitly deployed behind a
	// proxy that sets it. Off by default — otherwise any direct client could
	// spoof XFF: "127.0.0.1" and bypass every per-IP limit via the loopback
	// exemption. When off, the real TCP peer (RemoteAddr) is used.
	trustProxy = envBool("GEMU_TRUST_PROXY", false)
)

func envBool(key string, def bool) bool {
	switch strings.ToLower(os.Getenv(key)) {
	case "1", "true", "yes":
		return true
	case "0", "false", "no":
		return false
	}
	return def
}

const (
	// Per-IP new WebSocket connections.
	connRatePerSec rate.Limit = 5
	connBurst                 = 15
	// Per-IP room.create calls (bucket refills ~1 every 6s, short bursts ok).
	roomCreateRatePerSec rate.Limit = 1.0 / 6.0
	roomCreateBurst                 = 5
)

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

// ipLimiters holds one token bucket per client IP, GC'ing idle buckets so the
// map can't grow without bound under a churn of distinct IPs.
type ipLimiters struct {
	mu    sync.Mutex
	limit rate.Limit
	burst int
	lim   map[string]*rate.Limiter
	seen  map[string]time.Time
}

func newIPLimiters(limit rate.Limit, burst int) *ipLimiters {
	return &ipLimiters{
		limit: limit,
		burst: burst,
		lim:   make(map[string]*rate.Limiter),
		seen:  make(map[string]time.Time),
	}
}

func (l *ipLimiters) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	lim, ok := l.lim[ip]
	if !ok {
		lim = rate.NewLimiter(l.limit, l.burst)
		l.lim[ip] = lim
	}
	l.seen[ip] = time.Now()
	if len(l.lim) > 8192 {
		cutoff := time.Now().Add(-10 * time.Minute)
		for k, t := range l.seen {
			if t.Before(cutoff) {
				delete(l.seen, k)
				delete(l.lim, k)
			}
		}
	}
	return lim.Allow()
}

// isLoopback reports whether ip is a local address. Loopback traffic is your
// own tooling/health-checks/proxy on the same host, so it skips the per-IP rate
// limits — real users arrive via the proxy carrying X-Forwarded-For, and the
// global caps still apply to everyone.
func isLoopback(ip string) bool {
	parsed := net.ParseIP(ip)
	return parsed != nil && parsed.IsLoopback()
}

// clientIP extracts the caller's address. X-Forwarded-For is client-controlled
// and spoofable, so it is only honored when trustProxy is set (i.e. a proxy you
// control sets/strips it). Otherwise the real TCP peer is used, which a client
// cannot forge.
func clientIP(r *http.Request) string {
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if i := strings.IndexByte(xff, ','); i >= 0 {
				return strings.TrimSpace(xff[:i])
			}
			return strings.TrimSpace(xff)
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

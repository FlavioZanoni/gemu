// Package persist provides optional Redis-backed durability for room state, so
// a server restart or deploy recovers rooms instead of dropping every game.
// It stores each room's serialized state as a field in a single Redis hash.
package persist

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

const roomsKey = "gemu:rooms"

// Store persists room state to Redis. All operations are best-effort and
// time-boxed; the caller treats errors as non-fatal (durability is a bonus,
// never a dependency for serving a game).
type Store struct {
	rdb *redis.Client
}

// Open connects to Redis from a URL (redis://host:port/db) and verifies
// reachability before returning.
func Open(url string) (*Store, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	rdb := redis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		_ = rdb.Close()
		return nil, err
	}
	return &Store{rdb: rdb}, nil
}

func ctx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 3*time.Second)
}

// SaveRooms atomically replaces the persisted set with exactly the live rooms
// (roomID -> bytes). A full replace (DEL+HSET in one transaction) is what makes
// this correct under concurrency: a room removed while a snapshot was in flight
// can't be resurrected by a late write, because each snapshot is authoritative
// for the whole set. An empty set clears the hash.
func (s *Store) SaveRooms(rooms map[string][]byte) error {
	c, cancel := ctx()
	defer cancel()
	pipe := s.rdb.TxPipeline()
	pipe.Del(c, roomsKey)
	if len(rooms) > 0 {
		fields := make(map[string]any, len(rooms))
		for id, b := range rooms {
			fields[id] = b
		}
		pipe.HSet(c, roomsKey, fields)
	}
	_, err := pipe.Exec(c)
	return err
}

// LoadRooms returns every persisted room's serialized state.
func (s *Store) LoadRooms() (map[string][]byte, error) {
	c, cancel := ctx()
	defer cancel()
	raw, err := s.rdb.HGetAll(c, roomsKey).Result()
	if err != nil {
		return nil, err
	}
	out := make(map[string][]byte, len(raw))
	for id, v := range raw {
		out[id] = []byte(v)
	}
	return out, nil
}

// DeleteRoom removes one room's persisted state.
func (s *Store) DeleteRoom(roomID string) error {
	c, cancel := ctx()
	defer cancel()
	return s.rdb.HDel(c, roomsKey, roomID).Err()
}

func (s *Store) Close() error { return s.rdb.Close() }

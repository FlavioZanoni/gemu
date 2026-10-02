package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"gemu-server/internal/games"
	"gemu-server/internal/persist"
	"gemu-server/internal/ws"
)

func main() {
	addr := os.Getenv("WS_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	registry := games.NewRegistry()
	registry.Register(games.NewInventionFactory())
	registry.Register(games.NewGarticFactory())
	registry.Register(games.NewStopFactory())
	registry.Register(games.NewGarticPhoneFactory())
	registry.Register(games.NewCahFactory())
	registry.Register(games.NewTriviaFactory())
	registry.Register(games.NewFibberFactory())

	hub := ws.NewHub(registry)

	// Optional Redis durability: rooms survive restarts/deploys. Without
	// REDIS_URL the server runs purely in-memory (the friends-mode default).
	if url := os.Getenv("REDIS_URL"); url != "" {
		store, err := persist.Open(url)
		if err != nil {
			log.Printf("redis unavailable (%v); running in-memory without durability", err)
		} else {
			hub.SetStore(store)
			if err := restoreWithRetry(hub); err != nil {
				// The saver full-replaces the stored set: starting it now would
				// erase every persisted room we failed to read. Run without
				// durability instead and leave Redis untouched.
				log.Printf("persist load failed (%v); durability DISABLED for this run to protect stored rooms", err)
				hub.DisableStore()
			} else {
				hub.StartPersistence(10 * time.Second)
				log.Printf("durability enabled via redis")
			}
		}
	}

	hub.StartSweeper()
	router := ws.NewRouter(hub)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", router.HandleWS)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		log.Printf("ws server listening on %s", addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	case <-ctx.Done():
		log.Printf("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		// Stops accepting new connections; hijacked WebSockets aren't tracked
		// by Shutdown and close with the process.
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("http shutdown: %v", err)
		}
		// Final snapshot so a deploy loses nothing since the last tick.
		hub.SnapshotToStore()
		log.Printf("shutdown complete")
	}
}

// restoreWithRetry loads persisted rooms, retrying transient Redis errors.
func restoreWithRetry(hub *ws.Hub) error {
	var err error
	for attempt := 0; attempt < 4; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * time.Second)
		}
		if err = hub.RestoreFromStore(); err == nil {
			return nil
		}
		log.Printf("persist load attempt %d failed: %v", attempt+1, err)
	}
	return err
}

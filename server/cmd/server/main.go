package main

import (
	"log"
	"net/http"
	"os"
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
			hub.RestoreFromStore()
			hub.StartPersistence(10 * time.Second)
			log.Printf("durability enabled via redis")
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

	log.Printf("ws server listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

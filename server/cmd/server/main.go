package main

import (
	"log"
	"net/http"
	"os"

	"gemu-server/internal/games"
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

	hub := ws.NewHub(registry)
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

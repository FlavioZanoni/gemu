package ws

import (
  "log"
  "net/http"
  "time"

  "github.com/gorilla/websocket"
)

type Router struct {
  hub      *Hub
  upgrader websocket.Upgrader
}

func NewRouter(hub *Hub) *Router {
  return &Router{
    hub: hub,
    upgrader: websocket.Upgrader{
      ReadBufferSize:  1024,
      WriteBufferSize: 1024,
      CheckOrigin: func(r *http.Request) bool {
        return true
      },
    },
  }
}

func (r *Router) HandleWS(w http.ResponseWriter, req *http.Request) {
  conn, err := r.upgrader.Upgrade(w, req, nil)
  if err != nil {
    log.Println("upgrade error:", err)
    return
  }
  conn.SetReadLimit(64 * 1024)
  _ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
  conn.SetPongHandler(func(string) error {
    _ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
    return nil
  })

  client := r.hub.AddClient(conn)
  log.Printf("client connected: %s", client.ID)

  go func() {
    defer func() {
      r.hub.RemoveClient(client.ID)
      _ = conn.Close()
      log.Printf("client disconnected: %s", client.ID)
    }()

    for {
      env, err := r.hub.ReadEnvelope(client)
      if err != nil {
        return
      }
      r.hub.HandleMessage(client, env)
    }
  }()

  go func() {
    ticker := time.NewTicker(25 * time.Second)
    defer ticker.Stop()
    for range ticker.C {
      if err := conn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(5*time.Second)); err != nil {
        return
      }
    }
  }()
}

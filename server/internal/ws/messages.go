package ws

type Envelope struct {
	Type      string         `json:"type"`
	RequestID string         `json:"requestId,omitempty"`
	RoomID    string         `json:"roomId,omitempty"`
	Payload   map[string]any `json:"payload,omitempty"`
}


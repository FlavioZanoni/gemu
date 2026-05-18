package games

type Adapter interface {
  Type() string
  Init(roomID string)
  OnPlayerJoin(playerID string)
  OnPlayerLeave(playerID string)
  OnAction(playerID string, payload map[string]any) error
  PublicState() map[string]any
  PrivateState(playerID string) map[string]any
}

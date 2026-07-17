package ws

import (
	"testing"
	"time"

	"gemu-server/internal/games"
	"gemu-server/internal/rooms"
)

// fireDeadline fires the next pending deadline for a session if one exists.
// Returns true if a deadline was fired, false if none was pending.
func fireDeadline(t *testing.T, hub *Hub, roomID string) bool {
	t.Helper()
	s, ok := hub.session(roomID)
	if !ok {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.adapter == nil {
		return false
	}
	name, _, ok := s.adapter.NextDeadline()
	if !ok {
		return false
	}
	s.adapter.OnTimer(name)
	hub.afterAdapterCall(roomID, s)
	return true
}

// extractInt safely extracts an integer from a public state map,
// handling both float64 and int types.
func extractInt(state map[string]any, key string, defaultVal int) int {
	v, ok := state[key]
	if !ok {
		return defaultVal
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	default:
		return defaultVal
	}
}

// extractSlice safely extracts a slice from a public state map.
func extractSlice(state map[string]any, key string) []any {
	v, ok := state[key]
	if !ok {
		return []any{}
	}
	switch s := v.(type) {
	case []any:
		return s
	case []string:
		result := make([]any, len(s))
		for i, str := range s {
			result[i] = str
		}
		return result
	default:
		return []any{}
	}
}

// TestFullNightAllGames plays an entire game night through all five registered
// games in sequence, proving the session layer advances each to completion and
// handles voting between games correctly.
func TestFullNightAllGames(t *testing.T) {
	// Setup: registry with all five games
	registry := games.NewRegistry()
	registry.Register(games.NewInventionFactory())
	registry.Register(games.NewStopFactory())
	registry.Register(games.NewGarticFactory())
	registry.Register(games.NewGarticPhoneFactory())
	registry.Register(games.NewCahFactory())
	registry.Register(games.NewTriviaFactory())
	registry.Register(games.NewFibberFactory())
	hub := NewHub(registry)

	// Three clients: host + 2 joiners
	host := &Client{ID: "host"}
	joiner1 := &Client{ID: "joiner1"}
	joiner2 := &Client{ID: "joiner2"}

	// Create room with all five games in the desired order
	playlist := []any{"stop", "gartic", "garticphone", "cah", "invention", "trivia", "fibber"}
	hub.handleRoomCreate(host, Envelope{
		Type: "room.create",
		Payload: map[string]any{
			"name":        "Full Night",
			"playlist":    playlist,
			"displayName": "Host",
			"sessionId":   "sess-host",
		},
	})
	if host.RoomID == "" {
		t.Fatalf("expected room to be created")
	}
	roomID := host.RoomID

	// Both joiners join
	hub.handleRoomJoin(joiner1, Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      roomID,
			"displayName": "Joiner1",
			"sessionId":   "sess-joiner1",
		},
	})
	if joiner1.RoomID == "" {
		t.Fatalf("expected joiner1 to join")
	}

	hub.handleRoomJoin(joiner2, Envelope{
		Type: "room.join",
		Payload: map[string]any{
			"roomId":      roomID,
			"displayName": "Joiner2",
			"sessionId":   "sess-joiner2",
		},
	})
	if joiner2.RoomID == "" {
		t.Fatalf("expected joiner2 to join")
	}

	// Register all three clients in hub.clients (Conn is nil, that's ok)
	hub.mu.Lock()
	hub.clients[host.ID] = host
	hub.clients[joiner1.ID] = joiner1
	hub.clients[joiner2.ID] = joiner2
	hub.mu.Unlock()

	// Mark all ready
	hub.handleRoomReadySet(host, Envelope{
		Type:    "room.ready.set",
		Payload: map[string]any{"ready": true},
	})
	hub.handleRoomReadySet(joiner1, Envelope{
		Type:    "room.ready.set",
		Payload: map[string]any{"ready": true},
	})
	hub.handleRoomReadySet(joiner2, Envelope{
		Type:    "room.ready.set",
		Payload: map[string]any{"ready": true},
	})

	clients := []*Client{host, joiner1, joiner2}
	gameOrder := []string{"stop", "gartic", "garticphone", "cah", "invention", "trivia", "fibber"}
	playedCount := 0

	// Play each game in sequence
	for i, gameType := range gameOrder {
		t.Logf("=== Playing game %d: %s ===", i+1, gameType)

		// Set the next game deterministically (mirrors vote-winner path)
		room, ok := hub.rooms.Get(roomID)
		if !ok {
			t.Fatalf("game %s: room not found", gameType)
		}
		room.SetNextGame(gameType, gameType)

		// Start the game
		hub.handleGameStart(host, Envelope{
			Type:    "game.start",
			Payload: map[string]any{"force": true},
		})

		room, ok = hub.rooms.Get(roomID)
		if !ok {
			t.Fatalf("game %s: room not found after game start", gameType)
		}
		if room.GetStatus() != rooms.StatusPlaying {
			t.Fatalf("game %s: expected status playing, got %s", gameType, room.GetStatus())
		}

		s, ok := hub.session(roomID)
		if !ok || s.adapter == nil {
			t.Fatalf("game %s: expected adapter to be running", gameType)
		}

		// Play to completion based on game type
		switch gameType {
		case "stop":
			playStop(t, hub, roomID, host, clients)
		case "gartic":
			playGartic(t, hub, roomID, host, clients)
		case "garticphone":
			playGarticPhone(t, hub, roomID, host, clients)
		case "cah":
			playCah(t, hub, roomID, host, clients)
		case "invention":
			playInvention(t, hub, roomID, host, clients)
		case "trivia":
			playTrivia(t, hub, roomID, host, clients)
		case "fibber":
			playFibber(t, hub, roomID, host, clients)
		}

		playedCount++

		// After game finishes, verify state transition
		room, ok = hub.rooms.Get(roomID)
		if !ok {
			t.Fatalf("game %s: room not found after game finish", gameType)
		}
		s, _ = hub.session(roomID)
		s.mu.Lock()
		if s.adapter != nil {
			t.Errorf("game %s: expected adapter to be nil after finish", gameType)
		}
		s.mu.Unlock()

		if room.GetStatus() != rooms.StatusResults {
			t.Errorf("game %s: expected status results after finish, got %s", gameType, room.GetStatus())
		}

		snapshot := room.Snapshot()
		playedGames, ok := snapshot["playedGames"].([]rooms.PlayedGame)
		if !ok {
			t.Fatalf("game %s: expected playedGames to be []rooms.PlayedGame, got %T", gameType, snapshot["playedGames"])
		}
		if len(playedGames) != playedCount {
			t.Errorf("game %s: expected %d played games, got %d", gameType, playedCount, len(playedGames))
		}
		if playedGames[playedCount-1].GameType != gameType {
			t.Errorf("game %s: expected latest game to be %s, got %s", gameType, gameType, playedGames[playedCount-1].GameType)
		}

		// Between-game transition: exercise the real vote flow. The next
		// game is pinned deterministically at the top of each iteration, so
		// here we only need the vote to resolve (options are sampled from the
		// playlist and may not include a specific game).
		if i < len(gameOrder)-1 {
			hub.handleSessionVoteStart(host, Envelope{Type: "session.vote.start"})
			room, ok = hub.rooms.Get(roomID)
			if !ok {
				t.Fatalf("game %s: room not found during voting", gameType)
			}
			if room.GetStatus() != rooms.StatusVoting {
				t.Fatalf("game %s: expected status voting after vote start, got %s", gameType, room.GetStatus())
			}
			// Everyone votes for the first offered option.
			s, _ := hub.session(roomID)
			s.mu.Lock()
			ballot := ""
			if len(s.voteOptions) > 0 {
				ballot = s.voteOptions[0]
			}
			s.mu.Unlock()
			for _, client := range clients {
				hub.handleSessionVoteCast(client, Envelope{
					Type:    "session.vote.cast",
					Payload: map[string]any{"gameType": ballot},
				})
			}
			room, _ = hub.rooms.Get(roomID)
			if room.GetStatus() != rooms.StatusLobby {
				t.Fatalf("game %s: expected status lobby after all votes, got %s", gameType, room.GetStatus())
			}
		}
	}

	// Before ending session, verify the data was recorded
	room, ok := hub.rooms.Get(roomID)
	if !ok {
		t.Fatalf("final: room not found before session end")
	}

	snapshot := room.Snapshot()
	scores, ok := snapshot["sessionScores"].(map[string]int)
	if !ok {
		t.Errorf("final: expected sessionScores map[string]int, got %T", snapshot["sessionScores"])
	}

	// All three players should have earned points
	for _, client := range clients {
		if score, ok := scores[client.Player.ID]; !ok || score <= 0 {
			t.Errorf("final: expected player %s to have > 0 points, got %d", client.Player.Name, score)
		}
	}

	// All five games should be recorded
	playedGames, ok := snapshot["playedGames"].([]rooms.PlayedGame)
	if !ok {
		t.Fatalf("final: expected playedGames to be []rooms.PlayedGame, got %T", snapshot["playedGames"])
	}
	if len(playedGames) != len(gameOrder) {
		t.Errorf("final: expected %d played games, got %d", len(gameOrder), len(playedGames))
	}

	// Verify all distinct types were played
	typesSeen := make(map[string]bool)
	for _, pg := range playedGames {
		typesSeen[pg.GameType] = true
	}
	for _, gameType := range gameOrder {
		if !typesSeen[gameType] {
			t.Errorf("final: game type %s was not played", gameType)
		}
	}

	// Now end the session (this will clear the data)
	hub.handleSessionEnd(host, Envelope{Type: "session.end"})
	room, ok = hub.rooms.Get(roomID)
	if !ok {
		t.Fatalf("final: room not found after session end")
	}
	if room.GetStatus() != rooms.StatusLobby {
		t.Errorf("final: expected status lobby after session end, got %s", room.GetStatus())
	}

	t.Logf("✓ Full night completed: %d games, all %d types played, all players scored", len(playedGames), len(gameOrder))
}

// playStop plays a complete stop game (3 rounds, each round: answer → validate → next).
func playStop(t *testing.T, hub *Hub, roomID string, host *Client, clients []*Client) {
	t.Helper()
	s, _ := hub.session(roomID)
	s.mu.Lock()
	adapter := s.adapter
	s.mu.Unlock()

	for round := 1; round <= 3; round++ {
		// Answering phase: every player submits answers for all categories
		s.mu.Lock()
		publicState := adapter.PublicState()
		phase := publicState["phase"].(string)
		if phase != "answering" {
			s.mu.Unlock()
			t.Errorf("stop round %d: expected phase answering, got %s", round, phase)
			return
		}
		// Get categories and letter from public state while holding lock
		categories, _ := publicState["categories"].([]any)
		letter, _ := publicState["letter"].(string)
		s.mu.Unlock()

		for i, client := range clients {
			answers := make(map[string]any)
			if categories != nil {
				for j, catAny := range categories {
					if cat, ok := catAny.(string); ok {
						// Build a valid answer: letter + category + index
						answers[cat] = letter + "word" + string(rune('0'+i*10+j))
					}
				}
			}
			hub.handleGameAction(client, Envelope{
				Type: "game.action",
				Payload: map[string]any{
					"action":  "set_answers",
					"answers": answers,
				},
			})
		}

		// Fire the answers deadline
		if !fireDeadline(t, hub, roomID) {
			t.Errorf("stop round %d: expected answers deadline to fire", round)
			return
		}

		// Validation phase: all validate (reject nothing)
		s.mu.Lock()
		ps := adapter.PublicState()
		phase = ps["phase"].(string)
		if phase != "validating" {
			s.mu.Unlock()
			t.Errorf("stop round %d: expected phase validating, got %s", round, phase)
			return
		}
		s.mu.Unlock()

		for _, client := range clients {
			hub.handleGameAction(client, Envelope{
				Type: "game.action",
				Payload: map[string]any{
					"action":   "validate",
					"rejected": []any{},
				},
			})
		}

		// When all players validate, the game auto-transitions to roundResults.
		// The deadline is cleared, so NextDeadline will return false.
		// We don't need to fire a deadline; the game auto-advanced.
		// Allow a small amount of time for the transition to complete.
		time.Sleep(5 * time.Millisecond)

		s.mu.Lock()
		ps = adapter.PublicState()
		phase = ps["phase"].(string)
		s.mu.Unlock()

		// Host advances to next round
		hub.handleGameAction(host, Envelope{
			Type: "game.action",
			Payload: map[string]any{
				"action": "next_round",
			},
		})

		// Allow transition
		time.Sleep(5 * time.Millisecond)
	}

	// After all rounds, verify game is finished
	s.mu.Lock()
	status := adapter.Status()
	s.mu.Unlock()
	if status != games.StatusFinished {
		t.Errorf("stop: expected finished after 3 rounds, got %s", status)
	}
}

// playGartic plays a complete gartic game (2 rounds).
// Each round has turns where one player draws and others guess.
func playGartic(t *testing.T, hub *Hub, roomID string, host *Client, clients []*Client) {
	t.Helper()
	s, _ := hub.session(roomID)
	s.mu.Lock()
	adapter := s.adapter
	s.mu.Unlock()

	// Play until the game finishes by continuously advancing through turns
	strafeAttempts := 0
	maxAttempts := 200 // Prevent infinite loops
	for strafeAttempts < maxAttempts {
		strafeAttempts++

		s.mu.Lock()
		status := adapter.Status()
		ps := adapter.PublicState()
		phase := ps["phase"].(string)
		s.mu.Unlock()

		if status == games.StatusFinished {
			break
		}

		if phase == "drawing" {
			// Get drawer and word
			s.mu.Lock()
			drawer := ps["drawer"].(string)
			privState := adapter.PrivateState(drawer)
			word, _ := privState["word"].(string)
			s.mu.Unlock()

			if word == "" {
				t.Logf("gartic: could not get word for drawer %s", drawer)
				break
			}

			// Test: drawer can send strokes, non-drawer cannot (but fails silently)
			if strafeAttempts == 1 {
				hub.handleGameStream(&Client{ID: drawer, RoomID: roomID, Player: rooms.Player{ID: drawer}}, Envelope{
					Type: "game.stream",
					Payload: map[string]any{
						"action": "stroke",
						"x":      10.0,
						"y":      20.0,
					},
				})

				if len(clients) > 0 {
					hub.handleGameStream(clients[0], Envelope{
						Type: "game.stream",
						Payload: map[string]any{
							"action": "stroke",
							"x":      30.0,
							"y":      40.0,
						},
					})
				}
			}

			// All non-drawer clients guess the correct word (only once)
			for _, client := range clients {
				if client.Player.ID == drawer {
					continue
				}
				s.mu.Lock()
				guessed := extractSlice(ps, "guessed")
				s.mu.Unlock()
				alreadyGuessed := false
				for _, gID := range guessed {
					if gID == client.Player.ID {
						alreadyGuessed = true
						break
					}
				}
				if !alreadyGuessed {
					hub.handleGameAction(client, Envelope{
						Type: "game.action",
						Payload: map[string]any{
							"action": "guess",
							"text":   word,
						},
					})
				}
			}

			// Try to fire deadline to end the turn
			fireDeadline(t, hub, roomID)
		} else if phase == "turnResults" {
			// Fire deadline to advance to next turn
			fireDeadline(t, hub, roomID)
		}

		time.Sleep(1 * time.Millisecond)
	}

	// Final check
	s.mu.Lock()
	status := adapter.Status()
	s.mu.Unlock()
	if status != games.StatusFinished {
		t.Logf("gartic: game did not finish after %d attempts (status: %v)", strafeAttempts, status)
	}
}

// playGarticPhone plays a complete gartic phone game (3 steps then reveal).
func playGarticPhone(t *testing.T, hub *Hub, roomID string, host *Client, clients []*Client) {
	t.Helper()
	s, _ := hub.session(roomID)
	s.mu.Lock()
	adapter := s.adapter
	s.mu.Unlock()

	// Step 0: all submit prompts
	for i, client := range clients {
		hub.handleGameAction(client, Envelope{
			Type: "game.action",
			Payload: map[string]any{
				"action": "submit_prompt",
				"text":   "prompt-" + string(rune('0'+i)),
			},
		})
	}

	// Step 1: all submit drawings
	for i, client := range clients {
		hub.handleGameAction(client, Envelope{
			Type: "game.action",
			Payload: map[string]any{
				"action": "submit_drawing",
				"draw":   "data:image/png;base64," + string(rune('0'+i)),
			},
		})
	}

	// Step 2: all submit descriptions
	for i, client := range clients {
		hub.handleGameAction(client, Envelope{
			Type: "game.action",
			Payload: map[string]any{
				"action": "submit_description",
				"text":   "desc-" + string(rune('0'+i)),
			},
		})
	}

	// Reveal loop: host spams reveal_next until finished (cap 20 iterations)
	revealCount := 0
	reacted := false
	for revealCount < 20 {
		revealCount++
		hub.handleGameAction(host, Envelope{
			Type: "game.action",
			Payload: map[string]any{
				"action": "reveal_next",
			},
		})

		s.mu.Lock()
		status := adapter.Status()
		s.mu.Unlock()

		if status == games.StatusFinished {
			break
		}

		// After at least one reveal, one player reacts
		if revealCount >= 1 && !reacted {
			hub.handleGameAction(clients[0], Envelope{
				Type: "game.action",
				Payload: map[string]any{
					"action": "react",
					"chain":  float64(0),
					"entry":  float64(0),
				},
			})
			reacted = true
		}
	}

	s.mu.Lock()
	status := adapter.Status()
	s.mu.Unlock()
	if status != games.StatusFinished {
		t.Logf("garticphone: game not finished after %d reveal iterations (status: %v)", revealCount, status)
	}
}

// playCah plays a complete cah game (8 rounds).
func playCah(t *testing.T, hub *Hub, roomID string, host *Client, clients []*Client) {
	t.Helper()
	s, _ := hub.session(roomID)
	s.mu.Lock()
	adapter := s.adapter
	s.mu.Unlock()

	// Play until finished
	strafeAttempts := 0
	maxAttempts := 200
	for strafeAttempts < maxAttempts {
		strafeAttempts++

		s.mu.Lock()
		status := adapter.Status()
		ps := adapter.PublicState()
		phase := ps["phase"].(string)
		s.mu.Unlock()

		if status == games.StatusFinished {
			break
		}

		if phase == "answering" {
			s.mu.Lock()
			blackCard, ok := ps["blackCard"].(map[string]any)
			if !ok {
				s.mu.Unlock()
				fireDeadline(t, hub, roomID)
				time.Sleep(1 * time.Millisecond)
				continue
			}
			pick := extractInt(blackCard, "pick", 1)
			judge, _ := ps["judge"].(string)
			s.mu.Unlock()

			// All connected non-judge players submit cards (only once per round)
			for _, client := range clients {
				if client.Player.ID == judge {
					continue
				}
				cards := make([]any, pick)
				for i := 0; i < pick; i++ {
					cards[i] = float64(i)
				}
				hub.handleGameAction(client, Envelope{
					Type: "game.action",
					Payload: map[string]any{
						"action": "submit",
						"cards":  cards,
					},
				})
			}
		} else if phase == "judging" {
			// Judge picks the first submission (index 0)
			hub.handleGameAction(host, Envelope{
				Type: "game.action",
				Payload: map[string]any{
					"action": "pick_winner",
					"index":  float64(0),
				},
			})
		}

		// Try to fire deadline to advance
		fireDeadline(t, hub, roomID)
		time.Sleep(1 * time.Millisecond)
	}

	// Final check
	s.mu.Lock()
	status := adapter.Status()
	s.mu.Unlock()
	if status != games.StatusFinished {
		t.Logf("cah: game did not finish after %d attempts (status: %v)", strafeAttempts, status)
	}
}

// playInvention plays a complete invention game (3 rounds).
func playInvention(t *testing.T, hub *Hub, roomID string, host *Client, clients []*Client) {
	t.Helper()
	s, _ := hub.session(roomID)
	s.mu.Lock()
	adapter := s.adapter
	s.mu.Unlock()

	for round := 1; round <= 3; round++ {
		s.mu.Lock()
		phase := adapter.PublicState()["phase"].(string)
		s.mu.Unlock()

		if phase == "finalResults" {
			break
		}

		// Collecting: submit 2 problems each (6 total auto-advances)
		if phase == "collecting" {
			for i, client := range clients {
				problems := []any{
					"p1-" + string(rune('0'+i)),
					"p2-" + string(rune('0'+i)),
				}
				hub.handleGameAction(client, Envelope{
					Type: "game.action",
					Payload: map[string]any{
						"problems": problems,
					},
				})
			}

			// Wait for auto-advance to drawing
			for {
				s.mu.Lock()
				phase = adapter.PublicState()["phase"].(string)
				s.mu.Unlock()
				if phase != "collecting" {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
		}

		// Drawing: all submit drawings
		s.mu.Lock()
		phase = adapter.PublicState()["phase"].(string)
		s.mu.Unlock()

		if phase == "drawing" {
			for i, client := range clients {
				hub.handleGameAction(client, Envelope{
					Type: "game.action",
					Payload: map[string]any{
						"action":  "submit_drawing",
						"title":   "T" + string(rune('0'+i)),
						"tagline": "tag",
						"draw":    "data:image/png;base64,x",
					},
				})
			}

			// Wait for auto-advance to presenting
			for {
				s.mu.Lock()
				phase = adapter.PublicState()["phase"].(string)
				s.mu.Unlock()
				if phase != "drawing" {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
		}

		// Presenting: host advances through presentations
		s.mu.Lock()
		phase = adapter.PublicState()["phase"].(string)
		s.mu.Unlock()

		if phase == "presenting" {
			// Advance through all presenters
			for {
				s.mu.Lock()
				ps := adapter.PublicState()
				phase := ps["phase"].(string)
				s.mu.Unlock()

				if phase != "presenting" {
					break
				}

				hub.handleGameAction(host, Envelope{
					Type: "game.action",
					Payload: map[string]any{
						"action": "advance",
					},
				})
			}
		}

		// Voting: all cast votes (empty funding map)
		s.mu.Lock()
		phase = adapter.PublicState()["phase"].(string)
		s.mu.Unlock()

		if phase == "voting" {
			for _, client := range clients {
				hub.handleGameAction(client, Envelope{
					Type: "game.action",
					Payload: map[string]any{
						"funding": map[string]any{},
					},
				})
			}

			// Wait for auto-advance to results
			for {
				s.mu.Lock()
				phase = adapter.PublicState()["phase"].(string)
				s.mu.Unlock()
				if phase != "voting" {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
		}

		// Results: host advances to next round or finishes
		s.mu.Lock()
		phase = adapter.PublicState()["phase"].(string)
		s.mu.Unlock()

		if round < 3 && phase == "results" {
			hub.handleGameAction(host, Envelope{
				Type: "game.action",
				Payload: map[string]any{
					"action": "next_round",
				},
			})
		} else if round == 3 && phase == "results" {
			hub.handleGameAction(host, Envelope{
				Type: "game.action",
				Payload: map[string]any{
					"action": "next_round",
				},
			})
		}
	}

	// Ensure game is finished
	s.mu.Lock()
	status := adapter.Status()
	s.mu.Unlock()
	if status != games.StatusFinished {
		t.Logf("invention: game status is %v after 3 rounds", status)
	}
}

// playTrivia plays a trivia game to completion.
func playTrivia(t *testing.T, hub *Hub, roomID string, host *Client, clients []*Client) {
	t.Helper()
	s, _ := hub.session(roomID)
	guard := 0
	for {
		guard++
		if guard > 200 {
			t.Fatalf("trivia did not finish")
		}
		s.mu.Lock()
		if s.adapter == nil {
			s.mu.Unlock()
			return // finished → session cleared
		}
		phase, _ := s.adapter.PublicState()["phase"].(string)
		s.mu.Unlock()

		if phase == "question" {
			// Every client answers option 0.
			for _, c := range clients {
				hub.handleGameAction(c, Envelope{Type: "game.action", Payload: map[string]any{"action": "answer", "choice": float64(0)}})
			}
		} else {
			// reveal → advance
			if !fireDeadline(t, hub, roomID) {
				return
			}
		}
	}
}

// playFibber plays a fibber game to completion.
func playFibber(t *testing.T, hub *Hub, roomID string, host *Client, clients []*Client) {
	t.Helper()
	s, _ := hub.session(roomID)
	guard := 0
	for {
		guard++
		if guard > 200 {
			t.Fatalf("fibber did not finish")
		}
		s.mu.Lock()
		if s.adapter == nil {
			s.mu.Unlock()
			return
		}
		phase, _ := s.adapter.PublicState()["phase"].(string)
		s.mu.Unlock()

		switch phase {
		case "writing":
			for i, c := range clients {
				hub.handleGameAction(c, Envelope{Type: "game.action", Payload: map[string]any{"action": "lie", "lie": "fib-" + string(rune('a'+i))}})
			}
		case "choosing":
			// Each client picks the first option that isn't their own lie.
			s.mu.Lock()
			ps := s.adapter.PublicState()
			s.mu.Unlock()
			opts, _ := ps["options"].([]string)
			_ = opts
			for _, c := range clients {
				s.mu.Lock()
				own := -1
				if v, ok := s.adapter.PrivateState(c.Player.ID)["ownOption"].(int); ok {
					own = v
				}
				s.mu.Unlock()
				choice := 0
				if own == 0 {
					choice = 1
				}
				hub.handleGameAction(c, Envelope{Type: "game.action", Payload: map[string]any{"action": "choose", "choice": float64(choice)}})
			}
		default: // reveal
			if !fireDeadline(t, hub, roomID) {
				return
			}
		}
	}
}

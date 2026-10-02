package games

import "testing"

// liveRoom is a RoomInfo whose connected set the test can change mid-game.
type liveRoom struct{ players []string }

func (r *liveRoom) ConnectedPlayerIDs() []string { return append([]string(nil), r.players...) }
func (r *liveRoom) IsAdmin(string) bool          { return false }

func newTrivia(players []string) *TriviaGame {
	g := &TriviaGame{}
	g.Start("r", Options{Room: fakeRoom{players: players}, Settings: map[string]any{"rounds": float64(3)}})
	return g
}

func answer(choice int) map[string]any {
	return map[string]any{"action": "answer", "choice": float64(choice)}
}

func TestTriviaStartAndAnswer(t *testing.T) {
	g := newTrivia([]string{"p1", "p2"})
	if g.phase != "question" {
		t.Fatalf("expected question phase, got %s", g.phase)
	}
	if len(g.current.Options) != 4 {
		t.Fatalf("expected 4 options")
	}
	// p1 answers correctly first (speed bonus), p2 wrong.
	correct := g.current.Correct
	wrong := (correct + 1) % 4
	if err := g.OnAction("p1", answer(correct)); err != nil {
		t.Fatal(err)
	}
	if err := g.OnAction("p2", answer(wrong)); err != nil {
		t.Fatal(err)
	}
	if g.phase != "reveal" {
		t.Fatalf("expected reveal after all answered, got %s", g.phase)
	}
	if g.scores["p1"] != 150 {
		t.Fatalf("expected p1 to score 100 + 50 speed bonus, got %d", g.scores["p1"])
	}
	if g.scores["p2"] != 0 {
		t.Fatalf("expected p2 to score 0, got %d", g.scores["p2"])
	}
	gained, _ := g.PublicState()["gained"].(map[string]int)
	if gained["p1"] != 150 || gained["p2"] != 0 {
		t.Fatalf("expected reveal to expose points gained, got %v", gained)
	}
}

func TestTriviaOneAnswerPerQuestion(t *testing.T) {
	g := newTrivia([]string{"p1", "p2"})
	correct := g.current.Correct
	_ = g.OnAction("p1", answer(correct))
	// Second answer ignored.
	_ = g.OnAction("p1", answer((correct+1)%4))
	if g.answers["p1"] != correct {
		t.Fatalf("expected first answer to stick")
	}
}

// Stream payloads ({action:"stroke", ...}) and any other unknown action must
// be rejected, never recorded as an answer.
func TestTriviaUnknownActionRejected(t *testing.T) {
	g := newTrivia([]string{"p1", "p2"})
	for _, p := range []map[string]any{
		{"action": "stroke", "choice": float64(0)},
		{"choice": float64(0)},
		{"action": "", "choice": float64(1)},
	} {
		if err := g.OnAction("p1", p); err == nil {
			t.Fatalf("expected error for payload %v", p)
		}
	}
	if _, ok := g.answers["p1"]; ok {
		t.Fatalf("unknown action recorded an answer")
	}
	if err := g.OnAction("p1", answer(9)); err == nil {
		t.Fatalf("expected out-of-range choice to error")
	}
}

// A player who answered and then disconnected must not count toward "everyone
// answered": the reveal waits for every still-connected player.
func TestTriviaDisconnectedAnswerDoesNotRevealEarly(t *testing.T) {
	room := &liveRoom{players: []string{"p1", "p2", "p3"}}
	g := &TriviaGame{}
	g.Start("r", Options{Room: room, Settings: map[string]any{"rounds": float64(3)}})
	_ = g.OnAction("p1", answer(0))
	room.players = []string{"p2", "p3"} // p1 drops (no OnPlayerLeave yet)
	g.OnRoomChange()
	_ = g.OnAction("p2", answer(0))
	if g.phase != "question" {
		t.Fatalf("revealed before p3 answered")
	}
	_ = g.OnAction("p3", answer(1))
	if g.phase != "reveal" {
		t.Fatalf("expected reveal once every connected player answered, got %s", g.phase)
	}
}

func TestTriviaPrivateStateStampedWithRound(t *testing.T) {
	g := newTrivia([]string{"p1", "p2"})
	_ = g.OnAction("p1", answer(0))
	priv := g.PrivateState("p1")
	if priv["round"] != 1 || priv["choice"] != 0 {
		t.Fatalf("unexpected private state %v", priv)
	}
	_ = g.OnAction("p2", answer(0))
	g.OnTimer("reveal")
	priv = g.PrivateState("p1")
	if priv["round"] != 2 {
		t.Fatalf("expected round 2 stamp, got %v", priv)
	}
	if _, ok := priv["choice"]; ok {
		t.Fatalf("stale choice leaked into the next question")
	}
}

func TestTriviaSettings(t *testing.T) {
	g := &TriviaGame{}
	g.Start("r", Options{Room: fakeRoom{players: []string{"p1", "p2"}}, Settings: map[string]any{"rounds": float64(99), "answerSeconds": float64(5)}})
	if g.totalRounds != TriviaMaxRounds || g.answerSecs != TriviaMinAnswerSeconds {
		t.Fatalf("settings not clamped: rounds=%d answerSecs=%d", g.totalRounds, g.answerSecs)
	}
	g = &TriviaGame{}
	g.Start("r", Options{Room: fakeRoom{players: []string{"p1", "p2"}}})
	if g.totalRounds != TriviaDefaultRounds || g.answerSecs != TriviaAnswerSeconds {
		t.Fatalf("defaults not applied: rounds=%d answerSecs=%d", g.totalRounds, g.answerSecs)
	}
}

// Both locales need enough well-formed questions for the max round count.
func TestTriviaBankCoversMaxRounds(t *testing.T) {
	for locale, bank := range triviaBank {
		if len(bank) < 40 || len(bank) < TriviaMaxRounds {
			t.Fatalf("%s: only %d questions", locale, len(bank))
		}
		seen := map[string]bool{}
		for _, q := range bank {
			if len(q.Options) != 4 || q.Correct < 0 || q.Correct >= len(q.Options) {
				t.Fatalf("%s: malformed question %q", locale, q.Q)
			}
			if seen[q.Q] {
				t.Fatalf("%s: duplicate question %q", locale, q.Q)
			}
			seen[q.Q] = true
			opts := map[string]bool{}
			for _, o := range q.Options {
				if opts[o] {
					t.Fatalf("%s: duplicate option %q in %q", locale, o, q.Q)
				}
				opts[o] = true
			}
		}
	}
}

func TestTriviaFinishesAfterRounds(t *testing.T) {
	g := newTrivia([]string{"p1", "p2"})
	guard := 0
	for g.Status() == StatusRunning {
		guard++
		if guard > 50 {
			t.Fatalf("trivia did not finish")
		}
		if g.phase == "question" {
			c := g.current.Correct
			_ = g.OnAction("p1", answer(c))
			_ = g.OnAction("p2", answer(c))
		} else {
			g.OnTimer("reveal")
		}
	}
	if g.round != 3 {
		t.Fatalf("expected 3 rounds played, got %d", g.round)
	}
	st := g.Standings()
	if len(st) != 2 || st[0].Score < st[1].Score {
		t.Fatalf("expected sorted standings")
	}
}

func TestTriviaTimeoutScores(t *testing.T) {
	g := newTrivia([]string{"p1", "p2"})
	c := g.current.Correct
	_ = g.OnAction("p1", answer(c))
	// p2 never answers; timer fires.
	g.OnTimer("answer")
	if g.phase != "reveal" {
		t.Fatalf("expected reveal after timeout")
	}
	if g.scores["p1"] < 100 {
		t.Fatalf("expected p1 scored on timeout")
	}
}

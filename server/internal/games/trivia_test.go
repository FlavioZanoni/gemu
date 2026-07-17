package games

import "testing"

func newTrivia(players []string) *TriviaGame {
	g := &TriviaGame{}
	g.Start("r", Options{Room: fakeRoom{players: players}, Settings: map[string]any{"rounds": float64(3)}})
	return g
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
	_ = g.OnAction("p1", map[string]any{"choice": float64(correct)})
	_ = g.OnAction("p2", map[string]any{"choice": float64(wrong)})
	if g.phase != "reveal" {
		t.Fatalf("expected reveal after all answered, got %s", g.phase)
	}
	if g.scores["p1"] <= 100 {
		t.Fatalf("expected p1 to score 100 + speed bonus, got %d", g.scores["p1"])
	}
	if g.scores["p2"] != 0 {
		t.Fatalf("expected p2 to score 0, got %d", g.scores["p2"])
	}
}

func TestTriviaOneAnswerPerQuestion(t *testing.T) {
	g := newTrivia([]string{"p1", "p2"})
	correct := g.current.Correct
	_ = g.OnAction("p1", map[string]any{"choice": float64(correct)})
	// Second answer ignored.
	_ = g.OnAction("p1", map[string]any{"choice": float64((correct + 1) % 4)})
	if g.answers["p1"] != correct {
		t.Fatalf("expected first answer to stick")
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
			_ = g.OnAction("p1", map[string]any{"choice": float64(c)})
			_ = g.OnAction("p2", map[string]any{"choice": float64(c)})
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
	_ = g.OnAction("p1", map[string]any{"choice": float64(c)})
	// p2 never answers; timer fires.
	g.OnTimer("answer")
	if g.phase != "reveal" {
		t.Fatalf("expected reveal after timeout")
	}
	if g.scores["p1"] < 100 {
		t.Fatalf("expected p1 scored on timeout")
	}
}

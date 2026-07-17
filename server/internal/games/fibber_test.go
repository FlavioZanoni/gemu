package games

import "testing"

func newFibber(players []string) *FibberGame {
	g := &FibberGame{}
	g.Start("r", Options{Room: fakeRoom{players: players}, Settings: map[string]any{"rounds": float64(2)}})
	return g
}

func TestFibberFullRound(t *testing.T) {
	players := []string{"p1", "p2", "p3"}
	g := newFibber(players)
	if g.phase != "writing" {
		t.Fatalf("expected writing phase")
	}
	truth := g.prompt.Answer

	// Everyone writes a distinct lie (not the truth).
	_ = g.OnAction("p1", map[string]any{"lie": "lie one"})
	_ = g.OnAction("p2", map[string]any{"lie": "lie two"})
	_ = g.OnAction("p3", map[string]any{"lie": "lie three"})
	if g.phase != "choosing" {
		t.Fatalf("expected choosing after all wrote, got %s", g.phase)
	}
	// Options = truth + 3 lies.
	if len(g.options) != 4 {
		t.Fatalf("expected 4 options (truth + 3 lies), got %d", len(g.options))
	}

	// Find indices.
	truthIdx := -1
	p1LieIdx := -1
	for i, o := range g.options {
		if o.Truth {
			truthIdx = i
		}
		if o.Author == "p1" {
			p1LieIdx = i
		}
	}
	_ = truth

	// p2 finds the truth (+100). p3 falls for p1's lie (+50 to p1). p1 picks
	// p3's lie so nobody falls for p2's lie (keeps p2 at exactly 100).
	p3LieIdx := -1
	for i, o := range g.options {
		if o.Author == "p3" {
			p3LieIdx = i
		}
	}
	_ = g.OnAction("p2", map[string]any{"choice": float64(truthIdx)})
	_ = g.OnAction("p3", map[string]any{"choice": float64(p1LieIdx)})
	_ = g.OnAction("p1", map[string]any{"choice": float64(p3LieIdx)})
	if g.phase != "reveal" {
		t.Fatalf("expected reveal after all picked, got %s", g.phase)
	}
	if g.scores["p2"] != 100 {
		t.Fatalf("expected p2 +100 for truth only, got %d", g.scores["p2"])
	}
	if g.scores["p1"] != 50 {
		t.Fatalf("expected p1 +50 for fooling p3, got %d", g.scores["p1"])
	}
	if g.scores["p3"] != 50 {
		t.Fatalf("expected p3 +50 for fooling p1, got %d", g.scores["p3"])
	}
}

func TestFibberCannotPickOwnLie(t *testing.T) {
	g := newFibber([]string{"p1", "p2", "p3"})
	_ = g.OnAction("p1", map[string]any{"lie": "alpha"})
	_ = g.OnAction("p2", map[string]any{"lie": "beta"})
	_ = g.OnAction("p3", map[string]any{"lie": "gamma"})
	ownIdx := -1
	for i, o := range g.options {
		if o.Author == "p1" {
			ownIdx = i
		}
	}
	_ = g.OnAction("p1", map[string]any{"choice": float64(ownIdx)})
	if _, picked := g.picks["p1"]; picked {
		t.Fatalf("expected picking own lie to be rejected")
	}
}

func TestFibberTruthMatchingLieDropped(t *testing.T) {
	g := newFibber([]string{"p1", "p2", "p3"})
	truth := g.prompt.Answer
	_ = g.OnAction("p1", map[string]any{"lie": truth}) // equals the truth
	_ = g.OnAction("p2", map[string]any{"lie": "unique two"})
	_ = g.OnAction("p3", map[string]any{"lie": "unique three"})
	// truth + p2 + p3 = 3 options (p1's truth-matching lie merged away).
	if len(g.options) != 3 {
		t.Fatalf("expected truth-matching lie dropped, got %d options", len(g.options))
	}
}

func TestFibberFinishes(t *testing.T) {
	g := newFibber([]string{"p1", "p2", "p3"})
	guard := 0
	for g.Status() == StatusRunning {
		guard++
		if guard > 50 {
			t.Fatalf("fibber did not finish")
		}
		switch g.phase {
		case "writing":
			g.OnTimer("write")
		case "choosing":
			g.OnTimer("choose")
		case "reveal":
			g.OnTimer("reveal")
		}
	}
	if g.round != 2 {
		t.Fatalf("expected 2 rounds, got %d", g.round)
	}
}

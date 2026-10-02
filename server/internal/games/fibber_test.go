package games

import (
	"strings"
	"testing"
)

func newFibber(players []string) *FibberGame {
	g := &FibberGame{}
	g.Start("r", Options{Room: fakeRoom{players: players}, Settings: map[string]any{"rounds": float64(2)}})
	return g
}

func lie(text string) map[string]any { return map[string]any{"action": "lie", "lie": text} }
func pick(i int) map[string]any      { return map[string]any{"action": "choose", "choice": float64(i)} }

func optionBy(g *FibberGame, author string) int {
	for i, o := range g.options {
		if author == "" && o.Truth || author != "" && o.Author == author {
			return i
		}
	}
	return -1
}

func TestFibberFullRound(t *testing.T) {
	g := newFibber([]string{"p1", "p2", "p3"})
	if g.phase != "writing" {
		t.Fatalf("expected writing phase")
	}
	_ = g.OnAction("p1", lie("lie one"))
	_ = g.OnAction("p2", lie("lie two"))
	_ = g.OnAction("p3", lie("lie three"))
	if g.phase != "choosing" {
		t.Fatalf("expected choosing after all wrote, got %s", g.phase)
	}
	if len(g.options) != 4 {
		t.Fatalf("expected 4 options (truth + 3 lies), got %d", len(g.options))
	}
	// p2 finds the truth (+100). p3 falls for p1's lie (+50 to p1). p1 picks
	// p3's lie (+50 to p3).
	_ = g.OnAction("p2", pick(optionBy(g, "")))
	_ = g.OnAction("p3", pick(optionBy(g, "p1")))
	_ = g.OnAction("p1", pick(optionBy(g, "p3")))
	if g.phase != "reveal" {
		t.Fatalf("expected reveal after all picked, got %s", g.phase)
	}
	if g.scores["p2"] != 100 || g.scores["p1"] != 50 || g.scores["p3"] != 50 {
		t.Fatalf("unexpected scores %v", g.scores)
	}
	gained, _ := g.PublicState()["gained"].(map[string]int)
	if gained["p2"] != 100 || gained["p1"] != 50 || gained["p3"] != 50 {
		t.Fatalf("expected reveal to expose points gained, got %v", gained)
	}
}

func TestFibberCannotPickOwnLie(t *testing.T) {
	g := newFibber([]string{"p1", "p2", "p3"})
	_ = g.OnAction("p1", lie("alpha"))
	_ = g.OnAction("p2", lie("beta"))
	_ = g.OnAction("p3", lie("gamma"))
	if err := g.OnAction("p1", pick(optionBy(g, "p1"))); err == nil {
		t.Fatalf("expected picking own lie to error")
	}
	if _, picked := g.picks["p1"]; picked {
		t.Fatalf("expected picking own lie to be rejected")
	}
}

// Stream payloads and unknown actions must error and never record anything.
func TestFibberUnknownActionRejected(t *testing.T) {
	g := newFibber([]string{"p1", "p2", "p3"})
	if err := g.OnAction("p1", map[string]any{"action": "stroke", "lie": "sneaky"}); err == nil {
		t.Fatalf("expected unknown action error")
	}
	if err := g.OnAction("p1", map[string]any{"lie": "no action"}); err == nil {
		t.Fatalf("expected missing action error")
	}
	if len(g.lies) != 0 {
		t.Fatalf("unknown action recorded a lie")
	}
	_ = g.OnAction("p1", lie("a"))
	_ = g.OnAction("p2", lie("b"))
	_ = g.OnAction("p3", lie("c"))
	if err := g.OnAction("p1", map[string]any{"action": "stroke", "choice": float64(0)}); err == nil {
		t.Fatalf("expected unknown action error while choosing")
	}
	if len(g.picks) != 0 {
		t.Fatalf("unknown action recorded a pick")
	}
}

// A lie equal to the truth (any case/spacing/accents/punctuation/article) is
// bounced back to its author, who must write another; it is never dropped
// silently (which would let them pick the truth for free).
func TestFibberTruthMatchingLieRejected(t *testing.T) {
	g := newFibber([]string{"p1", "p2", "p3"})
	truth := g.prompt.Answer
	variants := []string{truth, "  " + strings.ToUpper(truth) + "!! ", "the " + truth}
	for _, v := range variants {
		if err := g.OnAction("p1", lie(v)); err != nil {
			t.Fatal(err)
		}
		if _, ok := g.lies["p1"]; ok {
			t.Fatalf("truth-matching lie %q was accepted", v)
		}
		rej, ok := g.PrivateState("p1")["rejected"].(fibberRejection)
		if !ok || rej.Reason != FibberRejectTruth {
			t.Fatalf("expected truth rejection for %q, got %v", v, g.PrivateState("p1"))
		}
	}
	_ = g.OnAction("p2", lie("unique two"))
	_ = g.OnAction("p3", lie("unique three"))
	if g.phase != "writing" {
		t.Fatalf("expected to keep waiting for p1's real lie")
	}
	_ = g.OnAction("p1", lie("something else"))
	if _, ok := g.PrivateState("p1")["rejected"]; ok {
		t.Fatalf("rejection should clear after a valid lie")
	}
	if g.phase != "choosing" || len(g.options) != 4 {
		t.Fatalf("expected choosing with 4 options, got %s/%d", g.phase, len(g.options))
	}
}

func TestFibberDuplicateLieRejected(t *testing.T) {
	g := newFibber([]string{"p1", "p2", "p3"})
	_ = g.OnAction("p1", lie("Purple  Banana"))
	_ = g.OnAction("p2", lie("purple banana."))
	if _, ok := g.lies["p2"]; ok {
		t.Fatalf("duplicate lie accepted")
	}
	rej, ok := g.PrivateState("p2")["rejected"].(fibberRejection)
	if !ok || rej.Reason != FibberRejectDuplicate {
		t.Fatalf("expected duplicate rejection, got %v", g.PrivateState("p2"))
	}
	_ = g.OnAction("p2", lie("green apple"))
	_ = g.OnAction("p3", lie("red kiwi"))
	if len(g.options) != 4 {
		t.Fatalf("every author should keep their lie, got %d options", len(g.options))
	}
}

func TestFibberWhitespaceLieIgnored(t *testing.T) {
	g := newFibber([]string{"p1", "p2", "p3"})
	if err := g.OnAction("p1", lie("   \t ")); err == nil {
		t.Fatalf("expected whitespace-only lie to error")
	}
	if _, ok := g.lies["p1"]; ok {
		t.Fatalf("whitespace-only lie counted as submitted")
	}
	_ = g.OnAction("p1", lie("  spaced   out  "))
	if g.lies["p1"] != "spaced out" {
		t.Fatalf("expected lie trimmed, got %q", g.lies["p1"])
	}
}

func TestFibberPrivateStateStamped(t *testing.T) {
	g := newFibber([]string{"p1", "p2", "p3"})
	_ = g.OnAction("p1", lie("a"))
	_ = g.OnAction("p2", lie("b"))
	_ = g.OnAction("p3", lie("c"))
	priv := g.PrivateState("p1")
	if priv["phase"] != "choosing" || priv["round"] != 1 || priv["ownOption"] != optionBy(g, "p1") {
		t.Fatalf("unexpected private state %v", priv)
	}
}

func TestFibberBankCoversMaxRounds(t *testing.T) {
	for locale, bank := range fibberBank {
		if len(bank) < 40 {
			t.Fatalf("%s: only %d prompts", locale, len(bank))
		}
		seen := map[string]bool{}
		for _, p := range bank {
			if !strings.Contains(p.Q, "____") || fibberKey(p.Answer) == "" {
				t.Fatalf("%s: malformed prompt %q", locale, p.Q)
			}
			if seen[p.Q] {
				t.Fatalf("%s: duplicate prompt %q", locale, p.Q)
			}
			seen[p.Q] = true
		}
	}
}

func TestFibberSettings(t *testing.T) {
	g := &FibberGame{}
	g.Start("r", Options{Room: fakeRoom{players: []string{"p1", "p2", "p3"}}, Settings: map[string]any{"rounds": float64(50), "writeSeconds": float64(60)}})
	if g.totalRounds != FibberMaxRounds || g.writeSecs != 60 {
		t.Fatalf("settings not applied: rounds=%d writeSecs=%d", g.totalRounds, g.writeSecs)
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

func TestFibberPunctuationOnlyLieBouncedAsEmpty(t *testing.T) {
	g := newFibber([]string{"p1", "p2", "p3"})
	for _, v := range []string{"!!!", "🤥🤥", "... ?!"} {
		if err := g.OnAction("p1", lie(v)); err != nil {
			t.Fatalf("%q: expected a private rejection, got error %v", v, err)
		}
		if _, ok := g.lies["p1"]; ok {
			t.Fatalf("punctuation-only lie %q was accepted", v)
		}
		rej, ok := g.PrivateState("p1")["rejected"].(fibberRejection)
		if !ok || rej.Reason != FibberRejectEmpty || rej.Text != strings.Join(strings.Fields(v), " ") {
			t.Fatalf("expected empty rejection for %q, got %v", v, g.PrivateState("p1"))
		}
	}
	// Emoji next to a real word is fine.
	_ = g.OnAction("p1", lie("tiny 🦩 hat"))
	if _, ok := g.lies["p1"]; !ok {
		t.Fatalf("lie with letters should be accepted")
	}
	if _, ok := g.PrivateState("p1")["rejected"]; ok {
		t.Fatalf("rejection should clear after a valid lie")
	}
}

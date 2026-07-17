package games

import (
	"fmt"
	"testing"
	"time"
)

func newGPGame(players []string, admin string) *GarticPhoneGame {
	game := &GarticPhoneGame{}
	game.Start("room-1", Options{Room: fakeRoom{players: players, admin: admin}})
	return game
}

func TestGarticPhoneStartDefaults(t *testing.T) {
	game := newGPGame([]string{"p1", "p2", "p3"}, "p1")

	if game.phase != "prompt" {
		t.Fatalf("expected prompt phase, got %s", game.phase)
	}
	if game.totalSteps != 3 || len(game.chains) != 3 {
		t.Fatalf("expected 3 steps and 3 chains")
	}
	name, at, ok := game.NextDeadline()
	if !ok || name != "step" || !at.After(time.Now()) {
		t.Fatalf("expected pending step deadline")
	}
}

func TestGarticPhoneChainRotationAndKinds(t *testing.T) {
	players := []string{"p1", "p2", "p3"}
	game := newGPGame(players, "p1")

	// Everyone submits a prompt; all-submitted advances without the timer.
	for _, id := range players {
		_ = game.OnAction(id, map[string]any{"action": "submit_prompt", "text": "prompt by " + id})
	}
	if game.phase != "drawing" || game.step != 1 {
		t.Fatalf("expected drawing step 1, got %s step %d", game.phase, game.step)
	}

	// Each player's private assignment must be the chain of the player one
	// seat over, holding that player's prompt as prevEntry.
	for _, id := range players {
		private := game.PrivateState(id)
		chainIdx, ok := private["chain"].(int)
		if !ok {
			t.Fatalf("expected chain index in private state")
		}
		prev, ok := private["prevEntry"].(gpEntry)
		if !ok {
			t.Fatalf("expected prevEntry in private state")
		}
		starter := game.turnOrder[chainIdx]
		if prev.Text != "prompt by "+starter {
			t.Fatalf("expected prev entry to be starter's prompt, got %q for starter %s", prev.Text, starter)
		}
		if prev.Author == id {
			t.Fatalf("expected player not to work on their own prompt")
		}
	}

	// Drawings via timer (nobody submits -> autofill drawing entries).
	game.OnTimer("step")
	if game.phase != "writing" || game.step != 2 {
		t.Fatalf("expected writing step 2, got %s step %d", game.phase, game.step)
	}

	// Descriptions; last step ends in reveal.
	for _, id := range players {
		_ = game.OnAction(id, map[string]any{"action": "submit_description", "text": "desc " + id})
	}
	if game.phase != "reveal" {
		t.Fatalf("expected reveal, got %s", game.phase)
	}
	for i, chain := range game.chains {
		if len(chain) != 3 {
			t.Fatalf("expected chain %d to have 3 entries, got %d", i, len(chain))
		}
		if chain[0].Kind != "text" || chain[1].Kind != "drawing" || chain[2].Kind != "text" {
			t.Fatalf("expected text/drawing/text chain, got %+v", chain)
		}
		if chain[0].Author == chain[1].Author || chain[1].Author == chain[2].Author {
			t.Fatalf("expected different authors on consecutive entries")
		}
	}
}

func TestGarticPhoneAutofillOnTimeout(t *testing.T) {
	players := []string{"p1", "p2"}
	game := newGPGame(players, "p1")

	_ = game.OnAction("p1", map[string]any{"action": "submit_prompt", "text": "only one"})
	game.OnTimer("step")
	if game.step != 1 {
		t.Fatalf("expected advance after timer")
	}
	texts := map[string]bool{}
	for _, chain := range game.chains {
		texts[chain[0].Text] = true
	}
	if !texts["only one"] || !texts[gpAutofillText] {
		t.Fatalf("expected submitted prompt plus autofill, got %v", texts)
	}
}

func TestGarticPhoneRevealPacingAndReactions(t *testing.T) {
	players := []string{"p1", "p2"}
	game := newGPGame(players, "p1")
	for _, id := range players {
		_ = game.OnAction(id, map[string]any{"action": "submit_prompt", "text": "prompt " + id})
	}
	for _, id := range players {
		_ = game.OnAction(id, map[string]any{"action": "submit_drawing", "draw": "data:image/png;base64,x"})
	}
	if game.phase != "reveal" {
		t.Fatalf("expected reveal phase")
	}

	// Nothing revealed yet: reactions rejected.
	_ = game.OnAction("p1", map[string]any{"action": "react", "chain": float64(0), "entry": float64(0)})
	if len(game.likes) != 0 {
		t.Fatalf("expected no likes before reveal")
	}

	// Non-admin cannot advance the reveal.
	_ = game.OnAction("p2", map[string]any{"action": "reveal_next"})
	if game.revealPos != 0 {
		t.Fatalf("expected non-admin reveal_next ignored")
	}

	_ = game.OnAction("p1", map[string]any{"action": "reveal_next"})
	if !game.isRevealed(0, 0) {
		t.Fatalf("expected first entry revealed")
	}

	// React to the revealed entry (not by its author).
	author := game.chains[0][0].Author
	reactor := "p1"
	if author == "p1" {
		reactor = "p2"
	}
	_ = game.OnAction(reactor, map[string]any{"action": "react", "chain": float64(0), "entry": float64(0)})
	if game.scores[author] != GPPointsPerLike {
		t.Fatalf("expected author to score from like, got %d", game.scores[author])
	}
	// Double react ignored; self react ignored.
	_ = game.OnAction(reactor, map[string]any{"action": "react", "chain": float64(0), "entry": float64(0)})
	_ = game.OnAction(author, map[string]any{"action": "react", "chain": float64(0), "entry": float64(0)})
	if game.scores[author] != GPPointsPerLike {
		t.Fatalf("expected no double/self scoring, got %d", game.scores[author])
	}

	// 2 chains x 2 entries: 4 presses reveal everything, 5th finishes.
	presses := 0
	for game.Status() == StatusRunning {
		_ = game.OnAction("p1", map[string]any{"action": "reveal_next"})
		presses++
		if presses > 10 {
			t.Fatalf("reveal never finished")
		}
	}
	if presses != 4 {
		t.Fatalf("expected 4 more presses (3 entries + final), got %d", presses)
	}
}

func TestGarticPhoneStandingsFromLikes(t *testing.T) {
	players := []string{"p1", "p2", "p3"}
	game := newGPGame(players, "p1")
	game.scores = map[string]int{"p1": 20, "p2": 40, "p3": 0}

	standings := game.Standings()
	if standings[0].PlayerID != "p2" || standings[0].Score != 40 {
		t.Fatalf("expected p2 first, got %+v", standings)
	}
	if len(standings) != 3 {
		t.Fatalf("expected all players in standings")
	}
}

func TestGarticPhonePublicStateMasksUnrevealed(t *testing.T) {
	players := []string{"p1", "p2"}
	game := newGPGame(players, "p1")
	for _, id := range players {
		_ = game.OnAction(id, map[string]any{"action": "submit_prompt", "text": "secret " + id})
	}
	game.OnTimer("step") // autofill drawings -> reveal

	state := game.PublicState()
	chains, ok := state["chains"].([]map[string]any)
	if !ok || len(chains) != 2 {
		t.Fatalf("expected 2 chains in public state")
	}
	for _, chain := range chains {
		entries := chain["entries"].([]gpEntry)
		if len(entries) != 0 {
			t.Fatalf("expected no entries revealed yet, got %d", len(entries))
		}
		if chain["length"].(int) != 2 {
			t.Fatalf("expected chain length metadata")
		}
	}

	_ = game.OnAction("p1", map[string]any{"action": "reveal_next"})
	state = game.PublicState()
	chains = state["chains"].([]map[string]any)
	total := 0
	for _, chain := range chains {
		total += len(chain["entries"].([]gpEntry))
	}
	if total != 1 {
		t.Fatalf("expected exactly 1 revealed entry, got %d", total)
	}
}

func TestGarticPhoneEveryPlayerTouchesEveryChain(t *testing.T) {
	players := []string{"p1", "p2", "p3", "p4"}
	game := newGPGame(players, "p1")

	for game.phase != "reveal" {
		game.OnTimer("step")
	}
	for i, chain := range game.chains {
		seen := map[string]bool{}
		for _, entry := range chain {
			if seen[entry.Author] {
				t.Fatalf("chain %d: author %s appears twice", i, entry.Author)
			}
			seen[entry.Author] = true
		}
		if len(seen) != len(players) {
			t.Fatalf("chain %d: expected all %d players, got %d", i, len(players), len(seen))
		}
	}
}

func TestGarticPhoneTextTruncation(t *testing.T) {
	game := newGPGame([]string{"p1", "p2"}, "p1")
	long := ""
	for i := 0; i < 300; i++ {
		long += "ã"
	}
	_ = game.OnAction("p1", map[string]any{"action": "submit_prompt", "text": long})
	entry := game.pending["p1"]
	if got := len([]rune(entry.Text)); got != gpMaxEntryChars {
		t.Fatalf("expected truncation to %d runes, got %d", gpMaxEntryChars, got)
	}
	if fmt.Sprintf("%c", []rune(entry.Text)[gpMaxEntryChars-1]) != "ã" {
		t.Fatalf("expected rune-safe truncation")
	}
}

package games

import (
	"encoding/json"
	"fmt"
	"strings"
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

func gpToReveal(t *testing.T, game *GarticPhoneGame) {
	t.Helper()
	for game.phase != "reveal" {
		game.OnTimer("step")
	}
}

func TestGarticPhoneRevealPacingAndReactions(t *testing.T) {
	players := []string{"p1", "p2"}
	game := newGPGame(players, "p1")
	for _, id := range players {
		_ = game.OnAction(id, map[string]any{"action": "submit_prompt", "text": "prompt " + id})
	}
	for _, id := range players {
		if err := game.OnAction(id, map[string]any{"action": "submit_drawing", "draw": "data:image/png;base64,eA=="}); err != nil {
			t.Fatalf("valid drawing rejected: %v", err)
		}
	}
	if game.phase != "reveal" {
		t.Fatalf("expected reveal phase")
	}

	// The reveal opens with chain 0's prompt already on screen.
	if game.revealChain != 0 || game.revealPos != 1 || !game.isRevealed(0, 0) || game.isRevealed(0, 1) {
		t.Fatalf("expected only entry 0/0 revealed, got chain %d pos %d", game.revealChain, game.revealPos)
	}

	// Unrevealed entries can't be reacted to.
	_ = game.OnAction("p1", map[string]any{"action": "react", "chain": float64(0), "entry": float64(1)})
	if len(game.likes) != 0 {
		t.Fatalf("expected no likes on an unrevealed entry")
	}

	// Non-admin cannot advance the reveal.
	_ = game.OnAction("p2", map[string]any{"action": "reveal_next"})
	if game.revealPos != 1 {
		t.Fatalf("expected non-admin reveal_next ignored")
	}

	// React to the revealed entry (not by its author).
	author := game.chains[0][0].Author
	reactor := "p1"
	if author == "p1" {
		reactor = "p2"
	}
	_ = game.OnAction(reactor, map[string]any{"action": "react", "chain": float64(0), "entry": float64(0), "emoji": "😂"})
	if game.scores[author] != GPPointsPerLike {
		t.Fatalf("expected author to score from like, got %d", game.scores[author])
	}
	if game.reactions["0|0"]["😂"] != 1 {
		t.Fatalf("expected 😂 recorded, got %v", game.reactions["0|0"])
	}
	if got := game.PrivateState(reactor)["myReactions"].(map[string]string)["0|0"]; got != "😂" {
		t.Fatalf("expected private myReactions to carry the chosen emoji, got %q", got)
	}
	// Double react ignored; self react ignored.
	_ = game.OnAction(reactor, map[string]any{"action": "react", "chain": float64(0), "entry": float64(0)})
	_ = game.OnAction(author, map[string]any{"action": "react", "chain": float64(0), "entry": float64(0)})
	if game.scores[author] != GPPointsPerLike {
		t.Fatalf("expected no double/self scoring, got %d", game.scores[author])
	}

	// Press 1: chain 0 punchline (its LAST entry) is shown, not skipped.
	_ = game.OnAction("p1", map[string]any{"action": "reveal_next"})
	if game.revealChain != 0 || game.revealPos != 2 {
		t.Fatalf("expected chain 0 fully shown, got chain %d pos %d", game.revealChain, game.revealPos)
	}
	if game.PublicState()["revealDone"].(bool) {
		t.Fatalf("revealDone must stay false before the last chain")
	}
	last := game.chains[0][1]
	lastReactor := "p1"
	if last.Author == "p1" {
		lastReactor = "p2"
	}
	before := game.scores[last.Author]
	_ = game.OnAction(lastReactor, map[string]any{"action": "react", "chain": float64(0), "entry": float64(1)})
	if game.scores[last.Author] != before+GPPointsPerLike {
		t.Fatalf("expected the chain's last entry to be reactable")
	}

	// Press 2: next chain opens with its first entry.
	_ = game.OnAction("p1", map[string]any{"action": "reveal_next"})
	if game.revealChain != 1 || game.revealPos != 1 {
		t.Fatalf("expected chain 1 pos 1, got chain %d pos %d", game.revealChain, game.revealPos)
	}
	// Press 3: final chain fully shown; still running, revealDone.
	_ = game.OnAction("p1", map[string]any{"action": "reveal_next"})
	if game.Status() != StatusRunning || game.revealPos != 2 {
		t.Fatalf("expected final punchline on screen while running")
	}
	if !game.PublicState()["revealDone"].(bool) {
		t.Fatalf("expected revealDone once the last chain is fully shown")
	}
	// Press 4: FINISH.
	_ = game.OnAction("p1", map[string]any{"action": "reveal_next"})
	if game.Status() != StatusFinished {
		t.Fatalf("expected finish after the last chain's punchline")
	}
}

func TestGarticPhoneRevealReachesEveryEntryAndFinishes(t *testing.T) {
	players := []string{"p1", "p2", "p3", "p4", "p5"}
	game := newGPGame(players, "p1")
	gpToReveal(t, game)
	seen := map[string]bool{}
	presses := 0
	for game.Status() == StatusRunning {
		seen[fmt.Sprintf("%d|%d", game.revealChain, game.revealPos-1)] = true
		_ = game.OnAction("p1", map[string]any{"action": "reveal_next"})
		presses++
		if presses > 100 {
			t.Fatalf("reveal never finished")
		}
	}
	if len(seen) != 25 {
		t.Fatalf("expected every one of 25 entries to be the newest at some point, got %d", len(seen))
	}
	if presses != 25 {
		t.Fatalf("expected 25 presses (24 reveals + finish), got %d", presses)
	}
}

func TestGarticPhoneReactEmojiAllowlist(t *testing.T) {
	players := []string{"p1", "p2", "p3"}
	game := newGPGame(players, "p1")
	gpToReveal(t, game)
	author := game.chains[0][0].Author
	reactors := []string{}
	for _, id := range players {
		if id != author {
			reactors = append(reactors, id)
		}
	}
	_ = game.OnAction(reactors[0], map[string]any{"action": "react", "chain": float64(0), "entry": float64(0), "emoji": "<script>"})
	_ = game.OnAction(reactors[1], map[string]any{"action": "react", "chain": float64(0), "entry": float64(0), "emoji": "💀"})
	got := game.reactions["0|0"]
	if len(got) != 2 || got["⭐"] != 1 || got["💀"] != 1 {
		t.Fatalf("expected unknown emoji coerced to ⭐, got %v", got)
	}
}

func TestGarticPhoneRejectsBadInput(t *testing.T) {
	players := []string{"p1", "p2", "p3"}
	game := newGPGame(players, "p1")

	if err := game.OnAction("p1", map[string]any{"action": "nope"}); err == nil {
		t.Fatalf("expected unknown action error")
	}
	_ = game.OnAction("p1", map[string]any{"action": "submit_prompt", "text": "   \n\t "})
	if _, ok := game.pending["p1"]; ok {
		t.Fatalf("whitespace-only prompt must not count as a submission")
	}
	_ = game.OnAction("p1", map[string]any{"action": "submit_prompt", "text": "  hi  "})
	if game.pending["p1"].Text != "hi" {
		t.Fatalf("expected trimmed prompt, got %q", game.pending["p1"].Text)
	}

	game.OnTimer("step") // -> drawing
	if game.phase != "drawing" {
		t.Fatalf("expected drawing phase")
	}
	huge := "data:image/png;base64," + strings.Repeat("A", MaxDrawingBytes)
	if err := game.OnAction("p2", map[string]any{"action": "submit_drawing", "draw": huge}); err == nil {
		t.Fatalf("expected oversized drawing to be rejected with an error")
	}
	if err := game.OnAction("p2", map[string]any{"action": "submit_drawing", "draw": "data:image/svg+xml;base64,AAAA"}); err == nil {
		t.Fatalf("expected non-raster drawing to be rejected with an error")
	}
	if _, ok := game.pending["p2"]; ok {
		t.Fatalf("rejected drawing must not be stored")
	}
	if err := game.OnAction("p2", map[string]any{"action": "submit_drawing", "draw": "data:image/webp;base64,AAAA"}); err != nil {
		t.Fatalf("expected webp drawing accepted, got %v", err)
	}
}

func TestGarticPhoneMidGameJoinerIsSpectator(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &GarticPhoneGame{}
	game.Start("room-1", Options{Room: room})
	room.players = append(room.players, "late")

	if game.PrivateState("late")["spectator"] != true {
		t.Fatalf("expected late joiner flagged as spectator")
	}
	if game.PrivateState("p1")["spectator"] != nil {
		t.Fatalf("roster player must not be a spectator")
	}
	if err := game.OnAction("late", map[string]any{"action": "submit_prompt", "text": "hi"}); err == nil {
		t.Fatalf("expected spectator submission to be rejected")
	}
	// The spectator doesn't block the all-submitted advance.
	for _, id := range []string{"p1", "p2", "p3"} {
		_ = game.OnAction(id, map[string]any{"action": "submit_prompt", "text": "x " + id})
	}
	if game.phase != "drawing" {
		t.Fatalf("expected advance without the spectator, got %s", game.phase)
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
	for i, chain := range chains {
		entries := chain["entries"].([]gpEntry)
		want := 0
		if i == 0 {
			want = 1
		}
		if len(entries) != want {
			t.Fatalf("chain %d: expected %d entries revealed, got %d", i, want, len(entries))
		}
		if entries := chain["entries"].([]gpEntry); i == 0 && entries[0].Text == "" {
			t.Fatalf("expected the opening prompt's text")
		}
		if chain["length"].(int) != 2 {
			t.Fatalf("expected chain length metadata")
		}
	}

	total := 0
	for _, chain := range chains {
		total += len(chain["entries"].([]gpEntry))
	}
	if total != 1 {
		t.Fatalf("expected only the opening prompt revealed, got %d", total)
	}

	_ = game.OnAction("p1", map[string]any{"action": "reveal_next"})
	state = game.PublicState()
	chains = state["chains"].([]map[string]any)
	total = 0
	for _, chain := range chains {
		total += len(chain["entries"].([]gpEntry))
	}
	if total != 2 || len(chains[0]["entries"].([]gpEntry)) != 2 {
		t.Fatalf("expected chain 0 fully revealed (2 entries), got %d total", total)
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

// With nobody connected, firing the step timer must leave the next deadline
// (if any) in the future, or the hub re-fires OnTimer in a loop.
func TestGarticPhoneTimerWithNobodyConnectedRearms(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &GarticPhoneGame{}
	game.Start("room-1", Options{Room: room})
	room.players = nil
	for i := 0; i < 10; i++ {
		name, _, ok := game.NextDeadline()
		if !ok {
			break
		}
		game.OnTimer(name)
		assertDeadlineNotPast(t, game, "garticphone "+game.phase)
	}
	if game.phase != "reveal" {
		t.Fatalf("expected the empty room to reach the (untimed) reveal, got %s", game.phase)
	}
}

// Every reaction rebroadcasts the reveal state, so it must only carry the
// chain on screen. 16 players with 30KB drawings used to reach ~3.9MB per
// broadcast at the end of the reveal.
func TestGarticPhoneRevealBroadcastStaysSmall(t *testing.T) {
	players := make([]string, 16)
	for i := range players {
		players[i] = fmt.Sprintf("p%02d", i)
	}
	game := newGPGame(players, players[0])
	big := "data:image/png;base64," + strings.Repeat("A", 30_000)
	for game.phase != "reveal" {
		for _, id := range players {
			var err error
			if game.phase == "drawing" {
				err = game.OnAction(id, map[string]any{"action": "submit_drawing", "draw": big})
			} else {
				err = game.OnAction(id, map[string]any{"action": "submit_prompt", "text": "words from " + id})
			}
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	maxNow, maxLegacy := 0, 0
	for !game.finished {
		_ = game.OnAction(players[1], map[string]any{"action": "react", "chain": game.revealChain, "entry": game.revealPos - 1, "emoji": "😂"})
		state := game.PublicState()
		raw, _ := json.Marshal(state)
		maxNow = max(maxNow, len(raw))
		if state["revealDone"] == true {
			// The old wire shape at its largest: every entry of every chain.
			rawLegacy, _ := json.Marshal(game.chains)
			maxLegacy = len(rawLegacy)
		}
		for i, chain := range state["chains"].([]map[string]any) {
			if i != game.revealChain && len(chain["entries"].([]gpEntry)) != 0 {
				t.Fatalf("chain %d not on screen but carries entries", i)
			}
		}
		_ = game.OnAction(players[0], map[string]any{"action": "reveal_next", "chain": game.revealChain, "pos": game.revealPos})
	}
	t.Logf("garticphone reveal broadcast, 16 players x 30KB drawings: max %d bytes (before: >= %d)", maxNow, maxLegacy)
	if maxNow >= 600_000 {
		t.Fatalf("reveal broadcast too large: %d bytes", maxNow)
	}
}

// reveal_next tagged with the cursor it was pressed on ignores a double tap.
func TestGarticPhoneRevealNextIsCursorBound(t *testing.T) {
	players := []string{"p1", "p2", "p3"}
	game := newGPGame(players, "p1")
	gpToReveal(t, game)
	tap := map[string]any{"action": "reveal_next", "chain": float64(0), "pos": float64(1)}
	_ = game.OnAction("p1", tap)
	if game.revealPos != 2 {
		t.Fatalf("expected pos 2, got %d", game.revealPos)
	}
	_ = game.OnAction("p1", tap)
	if game.revealPos != 2 {
		t.Fatalf("stale reveal_next advanced the reveal to %d", game.revealPos)
	}
}

package games

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

// fakeRoom is a minimal RoomInfo implementation for driving checkAdvance.
type fakeRoom struct {
	players []string
	admin   string
}

func (r fakeRoom) ConnectedPlayerIDs() []string {
	return r.players
}

func (r fakeRoom) IsAdmin(playerID string) bool {
	return playerID == r.admin
}

func TestInventionStartDefaults(t *testing.T) {
	game := &InventionGame{}
	game.Start("room-1", Options{})

	if game.phase != "collecting" {
		t.Fatalf("expected phase collecting, got %s", game.phase)
	}
	if game.round != 1 {
		t.Fatalf("expected round 1, got %d", game.round)
	}
	if game.totalRounds != DefaultTotalRounds {
		t.Fatalf("expected totalRounds %d, got %d", DefaultTotalRounds, game.totalRounds)
	}
	if state := game.PublicState(); state["started"] != true {
		t.Fatalf("expected started=true in PublicState")
	}
}

func TestInventionCollectingAddsProblem(t *testing.T) {
	game := &InventionGame{}
	game.Start("room-1", Options{})

	_ = game.OnAction("p1", map[string]any{"problem": "Need coffee"})
	_ = game.OnAction("p1", map[string]any{"problem": "Need naps"})
	if game.PublicState()["problemsSubmitted"].(int) != 2 {
		t.Fatalf("expected submitted count to be 2")
	}
}

func TestInventionStartAssignSetsPhase(t *testing.T) {
	game := &InventionGame{}
	game.Start("room-1", Options{})

	game.startAssign(nil)
	if game.phase == "drawing" {
		t.Fatalf("expected phase to remain collecting with no players")
	}

	game.startAssign([]string{"p1", "p2"})
	if game.phase != "drawing" {
		t.Fatalf("expected phase drawing")
	}
	if game.assignments["p1"] == "" {
		t.Fatalf("expected assignment to be created for p1")
	}
	if game.assignments["p2"] == "" {
		t.Fatalf("expected assignment to be created for p2")
	}
}

func TestInventionAdvanceToPresenting(t *testing.T) {
	game := &InventionGame{}
	game.Start("room-1", Options{})
	game.phase = "drawing"
	game.drawings["p1"] = InventionDrawing{Title: "A", DataURL: "data"}

	if err := game.advanceToPresenting(); err != nil {
		t.Fatalf("expected advance to presenting to succeed")
	}
	if game.phase != "presenting" {
		t.Fatalf("expected phase presenting")
	}
}

func TestInventionVotingFundingAllocation(t *testing.T) {
	game := &InventionGame{}
	game.Start("room-1", Options{})
	game.phase = "voting"
	game.drawings["p2"] = InventionDrawing{Title: "B", DataURL: "data2"}
	game.drawings["p3"] = InventionDrawing{Title: "C", DataURL: "data3"}

	_ = game.OnAction("p1", map[string]any{"funding": map[string]any{"p2": float64(600), "p3": float64(400)}})
	if len(game.votes["p1"]) != 2 {
		t.Fatalf("expected 2 allocations from p1")
	}
	if game.votes["p1"]["p2"] != 600 {
		t.Fatalf("expected p2 to get 600")
	}
	if game.votes["p1"]["p3"] != 400 {
		t.Fatalf("expected p3 to get 400")
	}
}

func TestInventionVotingExceedsBudget(t *testing.T) {
	game := &InventionGame{}
	game.Start("room-1", Options{})
	game.phase = "voting"
	game.drawings["p2"] = InventionDrawing{Title: "B", DataURL: "data2"}

	_ = game.OnAction("p1", map[string]any{"funding": map[string]any{"p2": float64(1500)}})
	if len(game.votes) != 0 {
		t.Fatalf("expected vote to be rejected when over budget")
	}
}

func TestInventionVotingCannotFundSelf(t *testing.T) {
	game := &InventionGame{}
	game.Start("room-1", Options{})
	game.phase = "voting"
	game.drawings["p1"] = InventionDrawing{Title: "A", DataURL: "data1"}
	game.drawings["p2"] = InventionDrawing{Title: "B", DataURL: "data2"}

	_ = game.OnAction("p1", map[string]any{"funding": map[string]any{"p1": float64(500), "p2": float64(500)}})
	if _, ok := game.votes["p1"]["p1"]; ok {
		t.Fatalf("expected self-funding to be rejected")
	}
}

func TestInventionFinalizeFunding(t *testing.T) {
	game := &InventionGame{}
	game.Start("room-1", Options{})
	game.drawings["p2"] = InventionDrawing{Title: "B", DataURL: "data2"}
	game.votes["p1"] = map[string]int{"p2": 600}
	game.votes["p3"] = map[string]int{"p2": 400}

	game.finalizeFunding()
	if game.phase != "results" {
		t.Fatalf("expected results phase")
	}
	if game.funding["p2"] != 1000 {
		t.Fatalf("expected funding to be 1000, got %d", game.funding["p2"])
	}
	if game.totalFunding["p2"] != 1000 {
		t.Fatalf("expected totalFunding to be 1000, got %d", game.totalFunding["p2"])
	}
}

func TestInventionFinalResultsAfterLastRound(t *testing.T) {
	game := &InventionGame{}
	game.Start("room-1", Options{})
	game.round = 3
	game.drawings["p2"] = InventionDrawing{Title: "B", DataURL: "data2"}
	game.votes["p1"] = map[string]int{"p2": 1000}

	game.finalizeFunding()
	if game.phase != "finalResults" {
		t.Fatalf("expected finalResults phase, got %s", game.phase)
	}
}

func TestInventionStartNextRound(t *testing.T) {
	game := &InventionGame{}
	game.Start("room-1", Options{})
	game.phase = "results"
	game.round = 1
	game.drawings["p1"] = InventionDrawing{Title: "A", DataURL: "data"}
	game.chosen["p1"] = "problem"
	game.assignments["p1"] = "problem"
	game.votes["p2"] = map[string]int{"p1": 1000}
	game.funding["p1"] = 1000
	game.totalFunding["p1"] = 1000

	game.startNextRound()
	if game.round != 2 {
		t.Fatalf("expected round 2, got %d", game.round)
	}
	if game.phase != "collecting" {
		t.Fatalf("expected collecting phase, got %s", game.phase)
	}
	if len(game.drawings) != 0 {
		t.Fatalf("expected drawings to be cleared")
	}
	if game.totalFunding["p1"] != 1000 {
		t.Fatalf("expected totalFunding to persist across rounds")
	}
}

func TestInventionOnPlayerLeaveClearsState(t *testing.T) {
	game := &InventionGame{}
	game.Start("room-1", Options{})
	_ = game.OnAction("p1", map[string]any{"problem": "Need coffee"})
	game.chosen["p1"] = "Problem"
	game.drawings["p1"] = InventionDrawing{Title: "X", DataURL: "Y"}
	game.votes["p1"] = map[string]int{"p2": 500}
	game.assignments["p1"] = "Problem"

	game.OnPlayerLeave("p1")
	if len(game.problems) != 0 || len(game.chosen) != 0 || len(game.drawings) != 0 || len(game.votes) != 0 || len(game.assignments) != 0 {
		t.Fatalf("expected player state to be cleared")
	}
}

func TestInventionAutoAdvanceToDrawing(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &InventionGame{}
	game.Start("room-1", Options{Room: room})

	_ = game.OnAction("p1", map[string]any{"problems": []any{"Problem A", "Problem B"}})
	if game.phase != "collecting" {
		t.Fatalf("expected phase to remain collecting after only one player submits, got %s", game.phase)
	}

	_ = game.OnAction("p2", map[string]any{"problems": []any{"Problem C", "Problem D"}})
	if game.phase != "drawing" {
		t.Fatalf("expected phase drawing after both players submit, got %s", game.phase)
	}
	if game.assignments["p1"] == "" {
		t.Fatalf("expected p1 to be assigned a problem")
	}
	if game.assignments["p2"] == "" {
		t.Fatalf("expected p2 to be assigned a problem")
	}
}

func TestInventionStatusAndStandings(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &InventionGame{}
	game.Start("room-1", Options{Room: room})
	game.round = game.totalRounds
	game.drawings["p1"] = InventionDrawing{Title: "A", DataURL: "data1"}
	game.drawings["p2"] = InventionDrawing{Title: "B", DataURL: "data2"}
	game.votes["p1"] = map[string]int{"p2": 900}
	game.votes["p2"] = map[string]int{"p1": 300}

	game.finalizeFunding()

	if game.Status() != StatusFinished {
		t.Fatalf("expected StatusFinished, got %v", game.Status())
	}

	standings := game.Standings()
	if len(standings) != 2 {
		t.Fatalf("expected 2 standings, got %d", len(standings))
	}
	if standings[0].PlayerID != "p2" || standings[0].Score != 900 {
		t.Fatalf("expected p2 first with score 900, got %+v", standings[0])
	}
	if standings[1].PlayerID != "p1" || standings[1].Score != 300 {
		t.Fatalf("expected p1 second with score 300, got %+v", standings[1])
	}
}

// The admin "advance" action must be able to force collecting -> drawing
// even when some connected players never submitted problems; missing
// submissions are treated as absent, same as elsewhere.
func TestInventionAdminAdvanceCollecting(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &InventionGame{}
	game.Start("room-1", Options{Room: room})

	// Only p1 submits; p2 and p3 never do.
	_ = game.OnAction("p1", map[string]any{"problems": []any{"Problem A", "Problem B"}})
	if game.phase != "collecting" {
		t.Fatalf("expected phase to remain collecting, got %s", game.phase)
	}

	// Non-admin cannot force the advance.
	_ = game.OnAction("p2", map[string]any{"action": "advance"})
	if game.phase != "collecting" {
		t.Fatalf("expected non-admin advance to be ignored, got %s", game.phase)
	}

	// Admin forces the advance despite missing submissions.
	_ = game.OnAction("p1", map[string]any{"action": "advance"})
	if game.phase != "drawing" {
		t.Fatalf("expected admin advance to force collecting -> drawing, got %s", game.phase)
	}
	for _, id := range []string{"p1", "p2", "p3"} {
		if game.assignments[id] == "" {
			t.Fatalf("expected %s to receive an assignment after forced advance", id)
		}
	}
}

// Nobody should be dealt a problem they wrote themselves (when avoidable).
func TestInventionAssignAvoidsOwnProblems(t *testing.T) {
	players := []string{"p1", "p2", "p3", "p4"}
	for iter := 0; iter < 100; iter++ {
		game := &InventionGame{}
		game.Start("room-1", Options{Room: fakeRoom{players: players}})
		authors := map[string]string{}
		for _, id := range players {
			a, b := id+"-problem-A", id+"-problem-B"
			_ = game.OnAction(id, map[string]any{"problems": []any{a, b}})
			authors[a], authors[b] = id, id
		}
		if game.phase != "drawing" {
			t.Fatalf("iter %d: expected drawing after all submitted, got %s", iter, game.phase)
		}
		for _, id := range players {
			assigned := game.assignments[id]
			if assigned == "" {
				t.Fatalf("iter %d: %s got no assignment", iter, id)
			}
			if authors[assigned] == id {
				t.Fatalf("iter %d: %s was dealt their own problem %q", iter, id, assigned)
			}
		}
	}
}

// Admin advance in the drawing phase with zero drawings skips the round
// entirely (nothing to present or fund) instead of silently no-oping.
func TestInventionAdminAdvanceDrawingZeroDrawingsSkipsRound(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &InventionGame{}
	game.Start("room-1", Options{Room: room})

	_ = game.OnAction("p1", map[string]any{"problems": []any{"Problem A", "Problem B"}})
	_ = game.OnAction("p1", map[string]any{"action": "advance"}) // collecting -> drawing
	if game.phase != "drawing" {
		t.Fatalf("expected drawing, got %s", game.phase)
	}

	// Nobody draws; admin skips again.
	_ = game.OnAction("p1", map[string]any{"action": "advance"})
	if game.phase != "results" && game.phase != "finalResults" {
		t.Fatalf("expected zero-drawing skip to land on results/finalResults, got %s", game.phase)
	}
}

const testPNG = "data:image/png;base64,iVBORw0KGgo="

func drawFor(game *InventionGame, id string) error {
	return game.OnAction(id, map[string]any{"action": "submit_drawing", "title": "T-" + id, "tagline": "tag", "draw": testPNG})
}

// newInventionAt starts a game with every player having submitted problems,
// landing in the drawing phase.
func newInventionInDrawing(t *testing.T, room *fakeRoom) *InventionGame {
	t.Helper()
	game := &InventionGame{}
	game.Start("room-1", Options{Room: room})
	for _, id := range room.players {
		_ = game.OnAction(id, map[string]any{"action": "submit_problems", "problems": []any{id + " A", id + " B"}})
	}
	if game.phase != "drawing" {
		t.Fatalf("expected drawing, got %s", game.phase)
	}
	return game
}

// The client reads problem/title/tagline/dataURL — the wire format must match.
func TestInventionDrawingJSONTags(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := newInventionInDrawing(t, room)
	_ = drawFor(game, "p1")
	_ = drawFor(game, "p2")
	if game.phase != "presenting" {
		t.Fatalf("expected presenting, got %s", game.phase)
	}
	raw, err := json.Marshal(game.PublicState())
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"title":"T-p1"`, `"tagline":"tag"`, `"dataURL":"data:image/png`, `"problem":"`} {
		if !strings.Contains(string(raw), key) {
			t.Fatalf("public state missing %s: %s", key, raw)
		}
	}
	priv, _ := json.Marshal(game.PrivateState("p1"))
	if !strings.Contains(string(priv), `"dataURL":"data:image/png`) {
		t.Fatalf("private drawing missing dataURL: %s", priv)
	}
}

func TestInventionPrivateStateOmitsMissingDrawing(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := newInventionInDrawing(t, room)
	if _, ok := game.PrivateState("p1")["drawing"]; ok {
		t.Fatalf("drawing must be absent before submitting")
	}
	_ = drawFor(game, "p1")
	if _, ok := game.PrivateState("p1")["drawing"]; !ok {
		t.Fatalf("drawing must be present after submitting")
	}
}

// A disconnected player's drawing must not fill a connected player's slot.
func TestInventionDisconnectedSubmissionsDontCount(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := newInventionInDrawing(t, room)
	_ = drawFor(game, "p3")
	room.players = []string{"p1", "p2"} // p3 drops
	game.OnRoomChange()
	_ = drawFor(game, "p1")
	if game.phase != "drawing" {
		t.Fatalf("advanced before p2 drew: %s", game.phase)
	}
	_ = drawFor(game, "p2")
	if game.phase != "presenting" {
		t.Fatalf("expected presenting once every connected player drew, got %s", game.phase)
	}
}

// Same rule for collecting: problems from someone offline don't count.
func TestInventionCollectingCountsConnectedOnly(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &InventionGame{}
	game.Start("room-1", Options{Room: room})
	_ = game.OnAction("p3", map[string]any{"problems": []any{"a", "b"}})
	_ = game.OnAction("p3", map[string]any{"problems": []any{"c", "d"}}) // capped at 2
	room.players = []string{"p1", "p2"}
	_ = game.OnAction("p1", map[string]any{"problems": []any{"e", "f"}})
	if game.phase != "collecting" {
		t.Fatalf("advanced before p2 submitted: %s", game.phase)
	}
	_ = game.OnAction("p2", map[string]any{"problems": []any{"g", "  "}})
	if game.phase != "collecting" {
		t.Fatalf("whitespace problem must not count: %s", game.phase)
	}
	_ = game.OnAction("p2", map[string]any{"problems": []any{"h"}})
	if game.phase != "drawing" {
		t.Fatalf("expected drawing, got %s", game.phase)
	}
}

// A player who joins mid-drawing gets a problem and never blocks the room.
func TestInventionLateJoinerGetsProblemAndDoesNotBlock(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := newInventionInDrawing(t, room)
	room.players = append(room.players, "late")
	game.OnPlayerJoin("late")
	if assigned, _ := game.PrivateState("late")["assigned"].(string); assigned == "" {
		t.Fatalf("late joiner must see a problem")
	}
	_ = drawFor(game, "p1")
	_ = drawFor(game, "p2")
	if game.phase != "presenting" {
		t.Fatalf("late joiner blocked drawing: %s", game.phase)
	}

	// And a late joiner who does draw in time is included.
	room2 := &fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game2 := newInventionInDrawing(t, room2)
	room2.players = append(room2.players, "late")
	game2.OnPlayerJoin("late")
	if err := drawFor(game2, "late"); err != nil {
		t.Fatalf("late joiner submit: %v", err)
	}
	if game2.drawings["late"].Problem == "" {
		t.Fatalf("late joiner drawing has no problem")
	}
}

func presentingGame(t *testing.T, players []string) (*InventionGame, *fakeRoom) {
	t.Helper()
	room := &fakeRoom{players: players, admin: players[0]}
	game := newInventionInDrawing(t, room)
	for _, id := range players {
		_ = drawFor(game, id)
	}
	if game.phase != "presenting" {
		t.Fatalf("expected presenting, got %s", game.phase)
	}
	return game, room
}

// An earlier presenter leaving must not skip the next pitch.
func TestInventionPresenterLeaveKeepsOrder(t *testing.T) {
	game, room := presentingGame(t, []string{"p1", "p2", "p3", "p4"})
	first := game.presenters[0]
	_ = game.OnAction(first, map[string]any{"action": "next"})
	current := game.presenters[game.presentIdx]
	room.players = without(room.players, first)
	game.OnPlayerLeave(first)
	if got := game.presenters[game.presentIdx]; got != current {
		t.Fatalf("expected %s still presenting, got %s", current, got)
	}
}

func without(ids []string, drop string) []string {
	out := []string{}
	for _, id := range ids {
		if id != drop {
			out = append(out, id)
		}
	}
	return out
}

// A disconnected presenter is skipped, and the admin can move pitches along.
func TestInventionDisconnectedPresenterSkipped(t *testing.T) {
	game, room := presentingGame(t, []string{"p1", "p2", "p3"})
	current := game.presenters[game.presentIdx]
	room.players = without(room.players, current)
	game.OnRoomChange()
	if game.phase == "presenting" && game.presenters[game.presentIdx] == current {
		t.Fatalf("disconnected presenter %s still holds the floor", current)
	}

	game2, _ := presentingGame(t, []string{"p1", "p2", "p3"})
	before := game2.presentIdx
	presenter := game2.presenters[before]
	other := "p2"
	if presenter == other {
		other = "p3"
	}
	_ = game2.OnAction(other, map[string]any{"action": "next"})
	if game2.presentIdx != before {
		t.Fatalf("non-presenter non-admin advanced the pitch")
	}
	_ = game2.OnAction("p1", map[string]any{"action": "next"})
	if game2.presentIdx != before+1 {
		t.Fatalf("admin could not advance the pitch")
	}
}

// Overflowing amounts must never wrap past the budget check.
func TestInventionFundingOverflowRejected(t *testing.T) {
	game := &InventionGame{}
	game.Start("room-1", Options{})
	game.phase = "voting"
	game.drawings["b"] = InventionDrawing{Title: "B", DataURL: testPNG}
	game.drawings["c"] = InventionDrawing{Title: "C", DataURL: testPNG}
	huge := float64(int64(1) << 62)
	if err := game.OnAction("a", map[string]any{"funding": map[string]any{"b": huge, "c": huge}}); err == nil {
		t.Fatalf("expected error for overflowing allocation")
	}
	if err := game.OnAction("a", map[string]any{"funding": map[string]any{"b": float64(600), "c": float64(600)}}); err == nil {
		t.Fatalf("expected error for over-budget total")
	}
	if err := game.OnAction("a", map[string]any{"funding": map[string]any{"b": float64(-5)}}); err == nil {
		t.Fatalf("expected error for negative amount")
	}
	if len(game.votes) != 0 {
		t.Fatalf("no vote should have been recorded: %v", game.votes)
	}
}

// A player with nobody to fund isn't waited for, and empty votes are valid.
func TestInventionVotingWaitsOnlyForFunders(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := newInventionInDrawing(t, room)
	_ = drawFor(game, "p1")
	_ = game.OnAction("p1", map[string]any{"action": "advance"}) // only p1 drew
	for game.phase == "presenting" {
		_ = game.OnAction("p1", map[string]any{"action": "next"})
	}
	if game.phase != "voting" {
		t.Fatalf("expected voting, got %s", game.phase)
	}
	// p1 has nobody to fund; p2 votes, p3 submits an empty allocation.
	_ = game.OnAction("p2", map[string]any{"action": "fund", "funding": map[string]any{"p1": float64(1000)}})
	if game.phase != "voting" {
		t.Fatalf("advanced before p3 voted: %s", game.phase)
	}
	if err := game.OnAction("p3", map[string]any{"action": "fund", "funding": map[string]any{}}); err != nil {
		t.Fatalf("empty allocation rejected: %v", err)
	}
	if game.phase != "results" {
		t.Fatalf("expected results, got %s", game.phase)
	}
	if game.funding["p1"] != 1000 {
		t.Fatalf("expected p1 funded 1000, got %d", game.funding["p1"])
	}
}

func TestInventionRejectsBadDrawingsAndUnknownActions(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := newInventionInDrawing(t, room)
	for _, bad := range []string{"https://evil.example/x.png", "data:image/svg+xml;base64,PHN2Zz4=", ""} {
		if err := game.OnAction("p1", map[string]any{"action": "submit_drawing", "title": "x", "draw": bad}); err == nil {
			t.Fatalf("accepted bad drawing %q", bad)
		}
	}
	if err := game.OnAction("p1", map[string]any{"action": "submit_drawing", "title": "   ", "draw": testPNG}); err == nil {
		t.Fatalf("accepted whitespace title")
	}
	if len(game.drawings) != 0 {
		t.Fatalf("bad drawings were stored")
	}
	for _, payload := range []map[string]any{{"action": "stroke"}, {"action": "bogus"}, {}} {
		if err := game.OnAction("p1", payload); err == nil {
			t.Fatalf("expected unknown action error for %v", payload)
		}
	}
}

// Every phase is bounded by a timer, and expiry moves the game forward.
func TestInventionTimersAdvanceEveryPhase(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &InventionGame{}
	game.Start("room-1", Options{Room: room, Settings: map[string]any{"rounds": float64(2)}})
	expect := []string{"collecting", "drawing"}
	for _, phase := range expect {
		name, _, ok := game.NextDeadline()
		if !ok || name != phase || game.phase != phase {
			t.Fatalf("expected %s deadline, got %q ok=%v phase=%s", phase, name, ok, game.phase)
		}
		if phase == "drawing" {
			_ = drawFor(game, "p1") // so presenting has something
		}
		game.OnTimer(name)
	}
	if game.phase != "presenting" {
		t.Fatalf("expected presenting, got %s", game.phase)
	}
	game.OnTimer("presenting")
	if game.phase != "voting" {
		t.Fatalf("expected voting after last pitch timer, got %s", game.phase)
	}
	game.OnTimer("voting")
	if game.phase != "results" {
		t.Fatalf("expected results, got %s", game.phase)
	}
	if _, ok := game.PublicState()["deadline"]; !ok {
		t.Fatalf("results should expose a deadline")
	}
	game.OnTimer("results")
	if game.phase != "collecting" || game.round != 2 {
		t.Fatalf("expected round 2 collecting, got %s round %d", game.phase, game.round)
	}
	// Stale timer names are ignored.
	game.OnTimer("voting")
	if game.phase != "collecting" {
		t.Fatalf("stale timer moved the game: %s", game.phase)
	}
}

// Pitch reactions: allowlisted kinds, one per player per kind, counted.
func TestInventionReactions(t *testing.T) {
	game, _ := presentingGame(t, []string{"p1", "p2", "p3"})
	presenter := game.presenters[game.presentIdx]
	for _, id := range []string{"p1", "p2", "p3"} {
		_ = game.OnAction(id, map[string]any{"action": "react", "kind": "rocket"})
		_ = game.OnAction(id, map[string]any{"action": "react", "kind": "nuke"})
	}
	counts := game.PublicState()["reactions"].(map[string]int)
	if counts["rocket"] != 2 || len(counts) != 3 {
		t.Fatalf("expected 2 rockets (presenter excluded), got %v", counts)
	}
	voter := "p1"
	if presenter == voter {
		voter = "p2"
	}
	_ = game.OnAction(voter, map[string]any{"action": "react", "kind": "rocket"}) // toggle off
	if c := game.PublicState()["reactions"].(map[string]int)["rocket"]; c != 1 {
		t.Fatalf("expected toggle-off to leave 1 rocket, got %d", c)
	}
}

// Forced assignment with too few problems still gives distinct problems and
// never the player's own.
func TestInventionForcedAssignDistinct(t *testing.T) {
	players := []string{"p1", "p2", "p3", "p4"}
	for iter := 0; iter < 100; iter++ {
		room := &fakeRoom{players: players, admin: "p1"}
		game := &InventionGame{}
		game.Start("room-1", Options{Room: room})
		_ = game.OnAction("p1", map[string]any{"problems": []any{"only p1 A", "only p1 B"}})
		_ = game.OnAction("p1", map[string]any{"action": "advance"})
		seen := map[string]bool{}
		for _, id := range players {
			p := game.assignments[id]
			if p == "" || seen[p] {
				t.Fatalf("iter %d: %s got empty/duplicate problem %q", iter, id, p)
			}
			seen[p] = true
			if id == "p1" && strings.HasPrefix(p, "only p1") {
				t.Fatalf("iter %d: p1 got own problem", iter)
			}
		}
	}
}

// With a single connected player the game still moves via the host.
func TestInventionSoloHostCanFinish(t *testing.T) {
	room := &fakeRoom{players: []string{"p1"}, admin: "p1"}
	game := &InventionGame{}
	game.Start("room-1", Options{Room: room, Settings: map[string]any{"rounds": float64(1)}})
	_ = game.OnAction("p1", map[string]any{"action": "advance"})
	if game.phase != "drawing" {
		t.Fatalf("expected drawing, got %s", game.phase)
	}
	_ = drawFor(game, "p1")
	if game.phase != "presenting" {
		t.Fatalf("expected presenting, got %s", game.phase)
	}
	_ = game.OnAction("p1", map[string]any{"action": "next"})
	if game.phase != "finalResults" || game.Status() != StatusFinished {
		t.Fatalf("expected finished, got %s", game.phase)
	}
}

// assertDeadlineNotPast fails when the game reports a pending deadline that
// is already due: the hub would re-fire OnTimer immediately, in a hot loop.
func assertDeadlineNotPast(t *testing.T, game Adapter, context string) {
	t.Helper()
	if name, at, ok := game.NextDeadline(); ok && !at.After(time.Now()) {
		t.Fatalf("%s: deadline %q left in the past (%v ago)", context, name, time.Since(at))
	}
}

// With nobody connected, firing any phase's timer must leave the next
// deadline (if any) in the future — collecting used to keep its expired
// deadline because there was nobody to deal problems to (~100k OnTimer/s).
func TestInventionTimerWithNobodyConnectedRearms(t *testing.T) {
	for _, target := range []string{"collecting", "drawing", "presenting", "voting", "results"} {
		room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
		game := &InventionGame{}
		game.Start("room-1", Options{Room: room, Settings: map[string]any{"rounds": float64(2)}})
		for i := 0; game.phase != target; i++ {
			if i > 20 {
				t.Fatalf("never reached %s (stuck in %s)", target, game.phase)
			}
			if game.phase == "drawing" {
				_ = drawFor(game, "p1")
				_ = drawFor(game, "p2")
			}
			name, _, _ := game.NextDeadline()
			game.OnTimer(name)
		}
		room.players = nil
		for i := 0; i < 3; i++ {
			name, _, ok := game.NextDeadline()
			if !ok {
				break
			}
			game.OnTimer(name)
			assertDeadlineNotPast(t, game, target)
		}
	}
}

// A host "advance" tagged with a phase/round only acts on that phase: a
// double tap (or one racing an auto-advance) must not skip the next phase.
func TestInventionAdvanceIsPhaseBound(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &InventionGame{}
	game.Start("room-1", Options{Room: room})
	tap := map[string]any{"action": "advance", "phase": "collecting", "round": float64(1)}
	_ = game.OnAction("p1", tap)
	if game.phase != "drawing" {
		t.Fatalf("expected drawing, got %s", game.phase)
	}
	_ = game.OnAction("p1", tap) // the double tap
	if game.phase != "drawing" {
		t.Fatalf("stale advance skipped drawing: %s", game.phase)
	}
	_ = game.OnAction("p1", map[string]any{"action": "advance", "phase": "drawing", "round": float64(2)})
	if game.phase != "drawing" {
		t.Fatalf("advance for another round acted: %s", game.phase)
	}
	_ = drawFor(game, "p1")
	_ = game.OnAction("p1", map[string]any{"action": "advance", "phase": "drawing", "round": float64(1)})
	if game.phase != "presenting" {
		t.Fatalf("expected presenting, got %s", game.phase)
	}
}

// "next" is bound to the pitch it was pressed on.
func TestInventionNextIsPresenterBound(t *testing.T) {
	game, _ := presentingGame(t, []string{"p1", "p2", "p3"})
	tap := map[string]any{"action": "next", "presentIndex": float64(0), "presenter": game.presenters[0]}
	_ = game.OnAction("p1", tap)
	if game.presentIdx != 1 {
		t.Fatalf("expected pitch 1, got %d", game.presentIdx)
	}
	_ = game.OnAction("p1", tap) // double tap / raced the pitch timer
	if game.phase != "presenting" || game.presentIdx != 1 {
		t.Fatalf("stale next skipped a pitch: phase %s idx %d", game.phase, game.presentIdx)
	}
	_ = game.OnAction("p1", map[string]any{"action": "next", "presentIndex": float64(1), "presenter": "nobody"})
	if game.presentIdx != 1 {
		t.Fatalf("next for another presenter acted")
	}
}

// Presenting broadcasts (one per reaction) carry only the drawing on stage;
// voting carries them all.
func TestInventionPresentingCarriesOnlyCurrentDrawing(t *testing.T) {
	players := make([]string, 16)
	for i := range players {
		players[i] = fmt.Sprintf("p%02d", i)
	}
	room := &fakeRoom{players: players, admin: players[0]}
	game := newInventionInDrawing(t, room)
	big := "data:image/png;base64," + strings.Repeat("A", 30_000)
	for _, id := range players {
		if err := game.OnAction(id, map[string]any{"action": "submit_drawing", "title": "T", "draw": big}); err != nil {
			t.Fatal(err)
		}
	}
	if game.phase != "presenting" {
		t.Fatalf("expected presenting, got %s", game.phase)
	}
	maxPresenting := 0
	for game.phase == "presenting" {
		state := game.PublicState()
		subs := state["submissions"].(map[string]InventionDrawing)
		withImage := 0
		for id, sub := range subs {
			if sub.DataURL != "" {
				withImage++
				if id != state["presenter"] {
					t.Fatalf("non-presenter %s drawing broadcast during presenting", id)
				}
			}
			if sub.Title == "" {
				t.Fatalf("card text missing for %s", id)
			}
		}
		if withImage != 1 {
			t.Fatalf("expected exactly the presenter's drawing, got %d", withImage)
		}
		raw, _ := json.Marshal(state)
		maxPresenting = max(maxPresenting, len(raw))
		game.OnTimer("presenting")
	}
	legacy, _ := json.Marshal(game.drawings) // what every presenting broadcast used to carry
	t.Logf("invention presenting broadcast, 16 players x 30KB: max %d bytes (was >= %d)", maxPresenting, len(legacy))
	if maxPresenting > 100_000 {
		t.Fatalf("presenting broadcast too large: %d", maxPresenting)
	}
	subs := game.PublicState()["submissions"].(map[string]InventionDrawing)
	for id, sub := range subs {
		if sub.DataURL == "" {
			t.Fatalf("voting needs every drawing; %s missing", id)
		}
	}
}

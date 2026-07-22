package games

import "testing"

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

	game.startAssign([]string{"p1"})
	if game.phase == "drawing" {
		t.Fatalf("expected phase to remain collecting when not enough players")
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

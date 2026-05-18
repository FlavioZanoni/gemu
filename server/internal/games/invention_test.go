package games

import "testing"

func TestInventionInitDefaults(t *testing.T) {
	game := &InventionGame{}
	game.Init("room-1")

	if game.phase != "collecting" {
		t.Fatalf("expected default phase collecting")
	}
	if game.roomID != "room-1" {
		t.Fatalf("expected roomID to be set")
	}
	if game.round != 1 {
		t.Fatalf("expected round 1")
	}
	if game.totalRounds != DefaultTotalRounds {
		t.Fatalf("expected totalRounds %d", DefaultTotalRounds)
	}
}

func TestInventionCollectingAddsProblem(t *testing.T) {
	game := &InventionGame{}
	game.Init("room-1")

	_ = game.OnAction("p1", map[string]any{"problem": "Need coffee"})
	_ = game.OnAction("p1", map[string]any{"problem": "Need naps"})
	if game.PublicState()["problemsSubmitted"].(int) != 2 {
		t.Fatalf("expected submitted count to be 2")
	}
}

func TestInventionStartAssignSetsPhase(t *testing.T) {
	game := &InventionGame{}
	game.Init("room-1")

	game.StartAssign([]string{"p1"})
	if game.phase == "drawing" {
		t.Fatalf("expected phase to remain collecting when not enough players")
	}

	game.StartAssign([]string{"p1", "p2"})
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
	game.Init("room-1")
	game.phase = "drawing"
	game.drawings["p1"] = InventionDrawing{Title: "A", DataURL: "data"}

	if err := game.AdvanceToPresenting(); err != nil {
		t.Fatalf("expected advance to presenting to succeed")
	}
	if game.phase != "presenting" {
		t.Fatalf("expected phase presenting")
	}
}

func TestInventionVotingFundingAllocation(t *testing.T) {
	game := &InventionGame{}
	game.Init("room-1")
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
	game.Init("room-1")
	game.phase = "voting"
	game.drawings["p2"] = InventionDrawing{Title: "B", DataURL: "data2"}

	_ = game.OnAction("p1", map[string]any{"funding": map[string]any{"p2": float64(1500)}})
	if len(game.votes) != 0 {
		t.Fatalf("expected vote to be rejected when over budget")
	}
}

func TestInventionVotingCannotFundSelf(t *testing.T) {
	game := &InventionGame{}
	game.Init("room-1")
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
	game.Init("room-1")
	game.drawings["p2"] = InventionDrawing{Title: "B", DataURL: "data2"}
	game.votes["p1"] = map[string]int{"p2": 600}
	game.votes["p3"] = map[string]int{"p2": 400}

	game.FinalizeFunding()
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
	game.Init("room-1")
	game.round = 3
	game.drawings["p2"] = InventionDrawing{Title: "B", DataURL: "data2"}
	game.votes["p1"] = map[string]int{"p2": 1000}

	game.FinalizeFunding()
	if game.phase != "finalResults" {
		t.Fatalf("expected finalResults phase, got %s", game.phase)
	}
}

func TestInventionStartNextRound(t *testing.T) {
	game := &InventionGame{}
	game.Init("room-1")
	game.phase = "results"
	game.round = 1
	game.drawings["p1"] = InventionDrawing{Title: "A", DataURL: "data"}
	game.chosen["p1"] = "problem"
	game.assignments["p1"] = "problem"
	game.votes["p2"] = map[string]int{"p1": 1000}
	game.funding["p1"] = 1000
	game.totalFunding["p1"] = 1000

	game.StartNextRound([]string{"p1", "p2"})
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
	game.Init("room-1")
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

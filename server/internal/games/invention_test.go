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
	if len(game.assignments["p1"]) != 2 {
		t.Fatalf("expected assignments to be created")
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

func TestInventionFinalizeFunding(t *testing.T) {
	game := &InventionGame{}
	game.Init("room-1")
	game.votes["p1"] = "p2"
	game.votes["p3"] = "p2"

	game.FinalizeFunding()
	if game.phase != "results" {
		t.Fatalf("expected results phase")
	}
	if game.funding["p2"] != 2 {
		t.Fatalf("expected funding count to be 2")
	}
}

func TestInventionOnPlayerLeaveClearsState(t *testing.T) {
	game := &InventionGame{}
	game.Init("room-1")
	_ = game.OnAction("p1", map[string]any{"problem": "Need coffee"})
	game.chosen["p1"] = "Problem"
	game.drawings["p1"] = InventionDrawing{Title: "X", DataURL: "Y"}
	game.votes["p1"] = "p2"
	game.funding["p1"] = 1
	game.assignments["p1"] = []string{"A", "B"}

	game.OnPlayerLeave("p1")
	if len(game.problems) != 0 || len(game.chosen) != 0 || len(game.drawings) != 0 || len(game.votes) != 0 || len(game.funding) != 0 || len(game.assignments) != 0 {
		t.Fatalf("expected player state to be cleared")
	}
}

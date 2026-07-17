package games

import (
	"testing"
	"time"
)

func newGarticGame(players []string) *GarticGame {
	game := &GarticGame{}
	game.Start("room-1", Options{Room: fakeRoom{players: players}})
	return game
}

func guessers(game *GarticGame, players []string) []string {
	out := make([]string, 0, len(players))
	for _, id := range players {
		if id != game.drawer {
			out = append(out, id)
		}
	}
	return out
}

func TestGarticStartDefaults(t *testing.T) {
	players := []string{"p1", "p2", "p3"}
	game := newGarticGame(players)

	if game.phase != "drawing" {
		t.Fatalf("expected drawing phase, got %s", game.phase)
	}
	if game.word == "" || game.drawer == "" {
		t.Fatalf("expected word and drawer to be set")
	}
	if len(game.turnOrder) != 3 {
		t.Fatalf("expected 3 players in turn order")
	}
	name, at, ok := game.NextDeadline()
	if !ok || name != "turn" || !at.After(time.Now()) {
		t.Fatalf("expected pending turn deadline")
	}
	if game.PublicState()["wordLength"] == nil {
		t.Fatalf("expected wordLength hint while drawing")
	}
	if game.PublicState()["word"] != nil {
		t.Fatalf("expected word hidden while drawing")
	}
	if game.PrivateState(game.drawer)["word"] != game.word {
		t.Fatalf("expected drawer to see the word")
	}
}

func TestGarticGuessScoringAndMasking(t *testing.T) {
	players := []string{"p1", "p2", "p3"}
	game := newGarticGame(players)
	game.word = "banana"
	others := guessers(game, players)

	_ = game.OnAction(others[0], map[string]any{"action": "guess", "text": "airplane"})
	if len(game.guesses) != 1 || game.guesses[0].Text != "airplane" || game.guesses[0].Correct {
		t.Fatalf("expected wrong guess in chat")
	}

	_ = game.OnAction(others[0], map[string]any{"action": "guess", "text": " BANANA "})
	if game.scores[others[0]] != 100 {
		t.Fatalf("expected first correct guess to score 100, got %d", game.scores[others[0]])
	}
	if game.scores[game.drawer] != 25 {
		t.Fatalf("expected drawer to score 25, got %d", game.scores[game.drawer])
	}
	if game.guesses[1].Text != "" || !game.guesses[1].Correct {
		t.Fatalf("expected correct guess masked in chat")
	}

	// Correct guesser cannot guess again.
	_ = game.OnAction(others[0], map[string]any{"action": "guess", "text": "banana"})
	if game.scores[others[0]] != 100 {
		t.Fatalf("expected no double scoring")
	}

	// All non-drawers correct ends the turn.
	_ = game.OnAction(others[1], map[string]any{"action": "guess", "text": "banana"})
	if game.scores[others[1]] != 90 {
		t.Fatalf("expected second correct guess to score 90, got %d", game.scores[others[1]])
	}
	if game.phase != "turnResults" {
		t.Fatalf("expected turn to end when all guessed, got %s", game.phase)
	}
	if game.PublicState()["word"] != "banana" {
		t.Fatalf("expected word revealed in turnResults")
	}
}

func TestGarticCloseGuessIsPrivate(t *testing.T) {
	players := []string{"p1", "p2"}
	game := newGarticGame(players)
	game.word = "banana"
	other := guessers(game, players)[0]

	_ = game.OnAction(other, map[string]any{"action": "guess", "text": "banans"})
	if game.PrivateState(other)["closeGuess"] != "banans" {
		t.Fatalf("expected close-guess feedback for guesser")
	}
	if game.PrivateState(game.drawer)["closeGuess"] != nil {
		t.Fatalf("expected no close-guess leak to drawer")
	}
	if game.scores[other] != 0 {
		t.Fatalf("expected close guess not to score")
	}
}

func TestGarticStrokeDrawerOnly(t *testing.T) {
	players := []string{"p1", "p2"}
	game := newGarticGame(players)
	other := guessers(game, players)[0]

	if err := game.OnAction(game.drawer, map[string]any{"action": "stroke"}); err != nil {
		t.Fatalf("expected drawer stroke accepted: %v", err)
	}
	if err := game.OnAction(other, map[string]any{"action": "stroke"}); err == nil {
		t.Fatalf("expected non-drawer stroke rejected")
	}
	game.OnTimer("turn")
	if err := game.OnAction(game.drawer, map[string]any{"action": "stroke"}); err == nil {
		t.Fatalf("expected stroke rejected outside drawing phase")
	}
}

func TestGarticTurnAndRoundRotation(t *testing.T) {
	players := []string{"p1", "p2"}
	game := newGarticGame(players)

	seenDrawers := map[string]bool{}
	turns := 0
	for game.Status() == StatusRunning {
		seenDrawers[game.drawer] = true
		turns++
		if turns > 10 {
			t.Fatalf("game did not finish")
		}
		game.OnTimer("turn")
		if game.phase != "turnResults" {
			t.Fatalf("expected turnResults after turn timer")
		}
		game.OnTimer("reveal")
	}
	// 2 players x 2 rounds = 4 turns, both players drew.
	if turns != 4 {
		t.Fatalf("expected 4 turns, got %d", turns)
	}
	if !seenDrawers["p1"] || !seenDrawers["p2"] {
		t.Fatalf("expected both players to draw")
	}
	if _, _, ok := game.NextDeadline(); ok {
		t.Fatalf("expected no deadline when finished")
	}
}

func TestGarticDrawerLeaveEndsTurn(t *testing.T) {
	players := []string{"p1", "p2", "p3"}
	game := newGarticGame(players)

	game.OnPlayerLeave(game.drawer)
	if game.phase != "turnResults" {
		t.Fatalf("expected turn to end when drawer leaves, got %s", game.phase)
	}
}

func TestGarticStandingsSorted(t *testing.T) {
	players := []string{"p1", "p2", "p3"}
	game := newGarticGame(players)
	game.scores = map[string]int{"p1": 50, "p2": 150}

	standings := game.Standings()
	if len(standings) != 3 {
		t.Fatalf("expected 3 standings, got %d", len(standings))
	}
	if standings[0].PlayerID != "p2" || standings[1].PlayerID != "p1" || standings[2].Score != 0 {
		t.Fatalf("expected sorted standings with zero-fill, got %+v", standings)
	}
}

func TestLevenshtein(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"banana", "banana", 0},
		{"banana", "banans", 1},
		{"banana", "bananas", 1},
		{"banana", "melon", 5},
		{"", "abc", 3},
	}
	for _, c := range cases {
		if got := levenshtein(c.a, c.b); got != c.want {
			t.Fatalf("levenshtein(%q,%q)=%d want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestNormalizeAnswer(t *testing.T) {
	if NormalizeAnswer("  Água   Viva ") != "agua viva" {
		t.Fatalf("expected accent/space normalization, got %q", NormalizeAnswer("  Água   Viva "))
	}
	if !StartsWithLetter("Água", "A") {
		t.Fatalf("expected Água to start with A")
	}
	if StartsWithLetter("", "A") {
		t.Fatalf("expected empty answer to not match")
	}
}

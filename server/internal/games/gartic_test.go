package games

import (
	"encoding/json"
	"strconv"
	"strings"
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
	if !ok || (name != "turn" && name != "hint") || !at.After(time.Now()) || !game.deadline.After(at.Add(-time.Millisecond)) {
		t.Fatalf("expected pending turn/hint deadline, got %s", name)
	}
	if mask, _ := game.PublicState()["mask"].(string); mask == "" || strings.ContainsAny(mask, game.word) {
		t.Fatalf("expected an all-blank mask while drawing, got %q", mask)
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
	game.setWord("banana")
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
	if game.guesses[1].Text != "" || !game.guesses[1].Correct || game.guesses[1].Points != 100 {
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
	players := []string{"p1", "p2", "p3"}
	game := newGarticGame(players)
	game.setWord("banana")
	others := guessers(game, players)
	other, bystander := others[0], others[1]

	for _, text := range []string{"banans", "big banana!", "bananna"} {
		_ = game.OnAction(other, map[string]any{"action": "guess", "text": text})
		last := game.guesses[len(game.guesses)-1]
		if !last.Close || last.Text != "" || last.Correct {
			t.Fatalf("%q: expected a text-less close line in public chat, got %+v", text, last)
		}
		own, _ := game.PrivateState(other)["ownClose"].(map[string]string)
		if own[strconv.Itoa(last.Seq)] != text {
			t.Fatalf("%q: expected guesser to see their own close text, got %v", text, own)
		}
	}
	if game.PrivateState(other)["closeGuess"] != "bananna" {
		t.Fatalf("expected latest close-guess feedback for guesser")
	}
	for _, id := range []string{game.drawer, bystander} {
		private := game.PrivateState(id)
		if private["closeGuess"] != nil || private["ownClose"] != nil {
			t.Fatalf("expected no close-guess leak to %s: %v", id, private)
		}
	}
	public, _ := json.Marshal(game.PublicState())
	if strings.Contains(string(public), "banan") {
		t.Fatalf("public state leaks the near miss: %s", public)
	}
	if game.scores[other] != 0 {
		t.Fatalf("expected close guess not to score")
	}
}

func TestGarticAnswerVariantsAccepted(t *testing.T) {
	cases := []struct{ word, guess string }{
		{"arco-íris", "Arco Iris!"},
		{"arco-íris", "arcoiris"},
		{"boneco de neve", "boneco-de-neve"},
		{"guarda-chuva", "guarda chuva."},
		{"dragão", "Dragões"},
		{"farol", "faróis"},
		{"pinguim", "pinguins"},
		{"banana", "bananas"},
		{"fireworks", "firework"},
		{"butterfly", "butterflies"},
		{"snowman", "  SNOW-MAN?? "},
	}
	for _, c := range cases {
		game := newGarticGame([]string{"p1", "p2"})
		game.setWord(c.word)
		other := guessers(game, []string{"p1", "p2"})[0]
		_ = game.OnAction(other, map[string]any{"action": "guess", "text": c.guess})
		if !game.hasGuessed(other) {
			t.Fatalf("word %q: expected guess %q to be accepted", c.word, c.guess)
		}
	}
	for _, c := range []struct{ word, guess string }{{"banana", "melon"}, {"cacto", "gato"}, {"ghost", "host"}} {
		if GarticAnswerMatches(GarticAnswerKey(c.guess), GarticAnswerKey(c.word)) {
			t.Fatalf("word %q: guess %q must not match", c.word, c.guess)
		}
	}
}

func TestGarticMaskAndHints(t *testing.T) {
	game := newGarticGame([]string{"p1", "p2"})
	game.setWord("boneco de neve")
	if got := game.mask(); got != "______ __ ____" {
		t.Fatalf("expected spaced mask, got %q", got)
	}
	game.setWord("guarda-chuva")
	if got := game.mask(); got != "______-_____" {
		t.Fatalf("expected hyphen kept in mask, got %q", got)
	}
	if game.PublicState()["letters"] != 11 {
		t.Fatalf("expected 11 letters, got %v", game.PublicState()["letters"])
	}

	game = newGarticGame([]string{"p1", "p2"})
	game.setWord("helicopter")
	game.hintAt = []time.Time{time.Now().Add(time.Second), time.Now().Add(2 * time.Second)}
	if name, _, _ := game.NextDeadline(); name != "hint" {
		t.Fatalf("expected the hint to be the next deadline, got %s", name)
	}
	game.OnTimer("hint")
	revealed := strings.Count(game.mask(), "_")
	if revealed != 9 {
		t.Fatalf("expected one letter revealed, mask %q", game.mask())
	}
	game.OnTimer("hint")
	if strings.Count(game.mask(), "_") != 8 || len(game.hintAt) != 0 {
		t.Fatalf("expected a second letter revealed, mask %q", game.mask())
	}
	if name, _, _ := game.NextDeadline(); name != "turn" {
		t.Fatalf("expected the turn deadline once hints are spent, got %s", name)
	}
	if game.PublicState()["word"] != nil {
		t.Fatalf("word must stay hidden while drawing")
	}
}

func TestGarticHintScheduleScalesWithWord(t *testing.T) {
	game := newGarticGame([]string{"p1", "p2"})
	for _, c := range []struct {
		word  string
		hints int
	}{{"igloo", 1}, {"yoga", 1}, {"helicopter", 2}} {
		game.deck = []string{c.word}
		game.startTurn()
		if len(game.hintAt) != c.hints {
			t.Fatalf("%s: expected %d hints, got %d", c.word, c.hints, len(game.hintAt))
		}
	}
}

func TestGarticStrokeDrawerOnly(t *testing.T) {
	players := []string{"p1", "p2"}
	game := newGarticGame(players)
	other := guessers(game, players)[0]

	if !game.AcceptStream(game.drawer, "stroke") {
		t.Fatalf("expected drawer stroke accepted")
	}
	if game.AcceptStream(other, "stroke") {
		t.Fatalf("expected non-drawer stroke rejected")
	}
	game.OnTimer("turn")
	if game.AcceptStream(game.drawer, "stroke") {
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
	room := &fakeRoom{players: players}
	game := &GarticGame{}
	game.Start("room-1", Options{Room: room})

	room.players = garticWithout(players, game.drawer)
	game.OnPlayerLeave(game.drawer)
	if game.phase != "turnResults" {
		t.Fatalf("expected turn to end when drawer leaves, got %s", game.phase)
	}
}

func TestGarticDrawerDisconnectGrace(t *testing.T) {
	players := []string{"p1", "p2", "p3"}
	room := &fakeRoom{players: players}
	game := &GarticGame{}
	game.Start("room-1", Options{Room: room})
	drawer := game.drawer

	// Refresh: socket drops, turn keeps going under a grace timer.
	room.players = garticWithout(players, drawer)
	game.OnRoomChange()
	if game.phase != "drawing" {
		t.Fatalf("expected turn to survive a drawer disconnect, got %s", game.phase)
	}
	name, at, _ := game.NextDeadline()
	if name != "grace" || time.Until(at) > GarticGraceSeconds*time.Second {
		t.Fatalf("expected a grace deadline, got %s at %v", name, at)
	}
	if game.PublicState()["graceEnd"] == nil {
		t.Fatalf("expected graceEnd in public state")
	}

	// Back within the grace: the drawer continues and keeps the turn.
	room.players = players
	game.OnTimer("grace")
	if game.phase != "drawing" || game.drawer != drawer || !game.graceEnd.IsZero() {
		t.Fatalf("expected the drawer to continue after reconnecting")
	}
	if !game.AcceptStream(drawer, "stroke") {
		t.Fatalf("expected the reconnected drawer to stream again")
	}

	// Gone for good: grace expires and the turn ends.
	room.players = garticWithout(players, drawer)
	game.OnRoomChange()
	game.OnTimer("grace")
	if game.phase != "turnResults" {
		t.Fatalf("expected turn to end after the grace, got %s", game.phase)
	}
}

func TestGarticEndsEarlyWithoutGuessers(t *testing.T) {
	players := []string{"p1", "p2"}
	room := &fakeRoom{players: players}
	game := &GarticGame{}
	game.Start("room-1", Options{Room: room})
	guesser := guessers(game, players)[0]

	room.players = []string{game.drawer}
	game.OnRoomChange()
	if name, _, _ := game.NextDeadline(); name != "grace" {
		t.Fatalf("expected grace while nobody can guess, got %s", name)
	}
	game.OnTimer("grace")
	if game.phase != "turnResults" {
		t.Fatalf("expected the turn to end with nobody to guess, got %s", game.phase)
	}
	// The reveal waits once for a returning player, then ends the game.
	game.OnTimer("reveal")
	if game.Status() != StatusRunning {
		t.Fatalf("expected one reveal grace before finishing")
	}
	game.OnTimer("reveal")
	if game.Status() != StatusFinished {
		t.Fatalf("expected game to finish with fewer than 2 players")
	}

	// A permanent leave ends the turn immediately.
	room.players = players
	game = &GarticGame{}
	game.Start("room-1", Options{Room: room})
	other := guessers(game, players)[0]
	room.players = []string{game.drawer}
	game.OnPlayerLeave(other)
	if game.phase != "turnResults" {
		t.Fatalf("expected immediate turn end when the last guesser leaves")
	}
	_ = guesser
}

func TestGarticUnknownActionErrors(t *testing.T) {
	game := newGarticGame([]string{"p1", "p2"})
	if err := game.OnAction("p1", map[string]any{"action": "nope"}); err == nil {
		t.Fatalf("expected an error for an unknown action")
	}
}

func TestGarticShiftMovesAllDeadlines(t *testing.T) {
	game := newGarticGame([]string{"p1", "p2", "p3"})
	game.graceEnd = time.Now().Add(time.Second)
	hint := game.hintAt[0]
	deadline := game.deadline
	grace := game.graceEnd
	game.Shift(5 * time.Second)
	if !game.deadline.Equal(deadline.Add(5*time.Second)) || !game.hintAt[0].Equal(hint.Add(5*time.Second)) || !game.graceEnd.Equal(grace.Add(5*time.Second)) {
		t.Fatalf("expected every deadline shifted")
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

func garticWithout(ids []string, drop string) []string {
	out := []string{}
	for _, id := range ids {
		if id != drop {
			out = append(out, id)
		}
	}
	return out
}

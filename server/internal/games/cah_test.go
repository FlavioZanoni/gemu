package games

import (
	"strings"
	"testing"
)

func TestCahStartDealsCards(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	if game.phase != "answering" {
		t.Fatalf("expected phase answering, got %s", game.phase)
	}
	if game.round != 1 {
		t.Fatalf("expected round 1, got %d", game.round)
	}
	if game.totalRounds != CahTotalRounds {
		t.Fatalf("expected totalRounds %d, got %d", CahTotalRounds, game.totalRounds)
	}

	// Check all players got hand
	for _, playerID := range []string{"p1", "p2", "p3"} {
		if len(game.hands[playerID]) != CahHandSize {
			t.Fatalf("expected player %s to have %d cards, got %d", playerID, CahHandSize, len(game.hands[playerID]))
		}
	}

	// Check one is judge
	if game.judge == "" {
		t.Fatalf("expected a judge to be set")
	}
	judgeFound := false
	for _, playerID := range []string{"p1", "p2", "p3"} {
		if playerID == game.judge {
			judgeFound = true
			break
		}
	}
	if !judgeFound {
		t.Fatalf("judge %s not in player list", game.judge)
	}
}

func TestCahSubmitValidation(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	// Set black card to pick=1 for easier testing
	game.blackCard = cahBlackCard{Text: "____", Pick: 1}

	// Judge cannot submit
	if game.judge == "p1" {
		// Make p2 submit instead
		game.OnAction("p2", map[string]any{"action": "submit", "cards": []any{float64(0)}})
		if _, ok := game.submissions["p2"]; !ok {
			t.Fatalf("expected p2 submission")
		}
		// Try judge submit
		game.OnAction("p1", map[string]any{"action": "submit", "cards": []any{float64(0)}})
		if _, ok := game.submissions["p1"]; ok {
			t.Fatalf("judge should not be able to submit")
		}
	} else {
		game.OnAction("p1", map[string]any{"action": "submit", "cards": []any{float64(0)}})
		if _, ok := game.submissions["p1"]; !ok {
			t.Fatalf("expected p1 submission")
		}
		game.OnAction(game.judge, map[string]any{"action": "submit", "cards": []any{float64(0)}})
		if _, ok := game.submissions[game.judge]; ok {
			t.Fatalf("judge should not be able to submit")
		}
	}
}

func TestCahSubmitWrongCount(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	game.blackCard = cahBlackCard{Text: "____", Pick: 1}

	nonJudge := "p1"
	if game.judge == "p1" {
		nonJudge = "p2"
	}

	// Submit wrong count
	game.OnAction(nonJudge, map[string]any{"action": "submit", "cards": []any{float64(0), float64(1)}})
	if _, ok := game.submissions[nonJudge]; ok {
		t.Fatalf("should reject wrong card count")
	}
}

func TestCahSubmitDuplicate(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	game.blackCard = cahBlackCard{Text: "____ and ____", Pick: 2}

	nonJudge := "p1"
	if game.judge == "p1" {
		nonJudge = "p2"
	}

	// Submit duplicate index
	game.OnAction(nonJudge, map[string]any{"action": "submit", "cards": []any{float64(0), float64(0)}})
	if _, ok := game.submissions[nonJudge]; ok {
		t.Fatalf("should reject duplicate card index")
	}
}

func TestCahSubmitOutOfRange(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	game.blackCard = cahBlackCard{Text: "____", Pick: 1}

	nonJudge := "p1"
	if game.judge == "p1" {
		nonJudge = "p2"
	}

	// Submit out of range
	game.OnAction(nonJudge, map[string]any{"action": "submit", "cards": []any{float64(100)}})
	if _, ok := game.submissions[nonJudge]; ok {
		t.Fatalf("should reject out of range index")
	}
}

func TestCahSubmitRemovesCards(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	game.blackCard = cahBlackCard{Text: "____", Pick: 1}

	nonJudge := "p1"
	if game.judge == "p1" {
		nonJudge = "p2"
	}

	originalHandSize := len(game.hands[nonJudge])
	game.OnAction(nonJudge, map[string]any{"action": "submit", "cards": []any{float64(0)}})

	if len(game.hands[nonJudge]) != originalHandSize-1 {
		t.Fatalf("expected hand size to decrease by 1")
	}
}

func TestCahAllSubmittedAdvances(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	game.blackCard = cahBlackCard{Text: "____", Pick: 1}

	// Get non-judge players
	others := make([]string, 0)
	for _, id := range []string{"p1", "p2", "p3"} {
		if id != game.judge {
			others = append(others, id)
		}
	}

	// Have all non-judges submit
	for _, id := range others {
		game.OnAction(id, map[string]any{"action": "submit", "cards": []any{float64(0)}})
	}

	if game.phase != "judging" {
		t.Fatalf("expected phase judging after all submit, got %s", game.phase)
	}

	if len(game.shuffledSubs) != len(others) {
		t.Fatalf("expected %d submissions, got %d", len(others), len(game.shuffledSubs))
	}
}

func TestCahPickWinnerAwardsPoint(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	game.blackCard = cahBlackCard{Text: "____", Pick: 1}

	// Get non-judge players and have them submit
	others := make([]string, 0)
	for _, id := range []string{"p1", "p2", "p3"} {
		if id != game.judge {
			others = append(others, id)
		}
	}

	for _, id := range others {
		game.OnAction(id, map[string]any{"action": "submit", "cards": []any{float64(0)}})
	}

	// Judge picks winner
	game.OnAction(game.judge, map[string]any{"action": "pick_winner", "index": float64(0)})

	if game.roundWinner == "" {
		t.Fatalf("expected roundWinner to be set")
	}

	if game.scores[game.roundWinner] != 1 {
		t.Fatalf("expected winner to have 1 point, got %d", game.scores[game.roundWinner])
	}

	if game.phase != "roundResults" {
		t.Fatalf("expected phase roundResults after pick, got %s", game.phase)
	}
}

func TestCahJudgeTimerPicksWinner(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	game.blackCard = cahBlackCard{Text: "____", Pick: 1}

	// Get non-judge players and have them submit
	others := make([]string, 0)
	for _, id := range []string{"p1", "p2", "p3"} {
		if id != game.judge {
			others = append(others, id)
		}
	}

	for _, id := range others {
		game.OnAction(id, map[string]any{"action": "submit", "cards": []any{float64(0)}})
	}

	if game.phase != "judging" {
		t.Fatalf("expected judging phase")
	}

	// Trigger timer
	game.OnTimer("judge")

	if game.roundWinner == "" {
		t.Fatalf("expected roundWinner to be set after timer")
	}

	if game.scores[game.roundWinner] != 1 {
		t.Fatalf("expected winner to have 1 point")
	}

	if game.phase != "roundResults" {
		t.Fatalf("expected roundResults phase after timer")
	}
}

func TestCahJudgeDisconnectAutoPicks(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	game.blackCard = cahBlackCard{Text: "____", Pick: 1}

	// Identify judge and non-judges
	judge := game.judge
	others := make([]string, 0)
	for _, id := range []string{"p1", "p2", "p3"} {
		if id != judge {
			others = append(others, id)
		}
	}

	for _, id := range others {
		game.OnAction(id, map[string]any{"action": "submit", "cards": []any{float64(0)}})
	}

	if game.phase != "judging" {
		t.Fatalf("expected judging phase")
	}

	// Judge disconnects (simulate by removing from room and calling OnRoomChange)
	room.players = others
	game.OnRoomChange()

	if game.phase != "roundResults" {
		t.Fatalf("expected roundResults phase after judge disconnect")
	}

	if game.roundWinner == "" {
		t.Fatalf("expected winner auto-picked after judge disconnect")
	}
}

func TestCahZeroSubmissionSkips(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	game.blackCard = cahBlackCard{Text: "____", Pick: 1}

	// Trigger timer with no submissions
	if game.phase != "answering" {
		t.Fatalf("expected answering phase")
	}

	game.OnTimer("answers")

	if game.round != 2 {
		t.Fatalf("expected round to advance to 2 after zero submissions, got %d", game.round)
	}
}

func TestCahHandRefillAfterRound(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	game.blackCard = cahBlackCard{Text: "____", Pick: 1}

	// Get non-judge players
	others := make([]string, 0)
	for _, id := range []string{"p1", "p2", "p3"} {
		if id != game.judge {
			others = append(others, id)
		}
	}

	originalCard := game.hands[others[0]][0]

	// Have all non-judges submit
	for _, id := range others {
		game.OnAction(id, map[string]any{"action": "submit", "cards": []any{float64(0)}})
	}

	// Judge picks winner
	game.OnAction(game.judge, map[string]any{"action": "pick_winner", "index": float64(0)})

	// Trigger next round timer
	game.OnTimer("next")

	// Check hands are refilled
	for _, playerID := range others {
		if len(game.hands[playerID]) != CahHandSize {
			t.Fatalf("expected player %s hand to be refilled to %d, got %d", playerID, CahHandSize, len(game.hands[playerID]))
		}
	}

	// Check new card is different (probably)
	if game.hands[others[0]][len(game.hands[others[0]])-1] == originalCard {
		// This could rarely fail due to chance, but very unlikely with 60+ card deck
		t.Logf("warning: refilled with same card (unlikely but possible)")
	}
}

func TestCahJudgeRotates(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	game.blackCard = cahBlackCard{Text: "____", Pick: 1}
	firstJudge := game.judge

	// Get non-judge players
	others := make([]string, 0)
	for _, id := range []string{"p1", "p2", "p3"} {
		if id != game.judge {
			others = append(others, id)
		}
	}

	// Have all non-judges submit
	for _, id := range others {
		game.OnAction(id, map[string]any{"action": "submit", "cards": []any{float64(0)}})
	}

	// Judge picks winner
	game.OnAction(game.judge, map[string]any{"action": "pick_winner", "index": float64(0)})

	// Trigger next round timer
	game.OnTimer("next")

	if game.judge == firstJudge {
		t.Fatalf("expected judge to rotate from %s", firstJudge)
	}
}

func TestCahGameFinishes(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	// Run through all rounds
	for round := 1; round <= CahTotalRounds; round++ {
		game.blackCard = cahBlackCard{Text: "____", Pick: 1}

		if game.Status() != StatusRunning {
			t.Fatalf("expected game running on round %d", round)
		}

		// Get non-judge players
		others := make([]string, 0)
		for _, id := range []string{"p1", "p2", "p3"} {
			if id != game.judge {
				others = append(others, id)
			}
		}

		// Have all non-judges submit
		for _, id := range others {
			game.OnAction(id, map[string]any{"action": "submit", "cards": []any{float64(0)}})
		}

		// Judge picks winner
		game.OnAction(game.judge, map[string]any{"action": "pick_winner", "index": float64(0)})

		// Trigger next round timer (or game finish if last round)
		game.OnTimer("next")
	}

	if game.Status() != StatusFinished {
		t.Fatalf("expected game finished after %d rounds", CahTotalRounds)
	}
}

func TestCahStandings(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	game.blackCard = cahBlackCard{Text: "____", Pick: 1}

	// Run through all rounds and award points
	for round := 1; round <= CahTotalRounds; round++ {
		game.blackCard = cahBlackCard{Text: "____", Pick: 1}

		others := make([]string, 0)
		for _, id := range []string{"p1", "p2", "p3"} {
			if id != game.judge {
				others = append(others, id)
			}
		}

		for _, id := range others {
			game.OnAction(id, map[string]any{"action": "submit", "cards": []any{float64(0)}})
		}

		// Always pick first submission to ensure scoring
		game.OnAction(game.judge, map[string]any{"action": "pick_winner", "index": float64(0)})

		game.OnTimer("next")
	}

	standings := game.Standings()
	if len(standings) != 3 {
		t.Fatalf("expected 3 standings, got %d", len(standings))
	}

	// Check sorted descending
	for i := 1; i < len(standings); i++ {
		if standings[i].Score > standings[i-1].Score {
			t.Fatalf("standings not sorted descending: %v", standings)
		}
	}
}

func TestCahStandingsZeroFilled(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	// Don't play any rounds, just check standings
	standings := game.Standings()

	if len(standings) != 3 {
		t.Fatalf("expected all connected players in standings, got %d", len(standings))
	}

	for _, standing := range standings {
		if standing.Score != 0 {
			t.Fatalf("expected all unplayed players to have score 0, got %d for %s", standing.Score, standing.PlayerID)
		}
	}
}

func TestCahPlayerLeaveClears(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	game.blackCard = cahBlackCard{Text: "____", Pick: 1}

	// p1 leaves
	game.OnPlayerLeave("p1")

	if _, ok := game.hands["p1"]; ok {
		t.Fatalf("expected p1 hand to be cleared")
	}
	if _, ok := game.submissions["p1"]; ok {
		t.Fatalf("expected p1 submission to be cleared")
	}
}

func TestCahPlayerJoinDealedNextRound(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room})

	game.blackCard = cahBlackCard{Text: "____", Pick: 1}

	// p3 joins mid-game - add to room first
	room.players = append(room.players, "p3")
	game.OnPlayerJoin("p3")

	// p3 shouldn't have cards yet
	if len(game.hands["p3"]) > 0 {
		t.Fatalf("expected p3 to not have cards until next round")
	}

	// Advance to next round - have all non-judge players submit
	connected := []string{"p1", "p2", "p3"}
	for _, id := range connected {
		if id != game.judge {
			game.OnAction(id, map[string]any{"action": "submit", "cards": []any{float64(0)}})
		}
	}

	// If still in answering phase, trigger timer to advance
	if game.phase == "answering" {
		game.OnTimer("answers")
	}

	if game.phase == "judging" {
		game.OnAction(game.judge, map[string]any{"action": "pick_winner", "index": float64(0)})
	}

	// Trigger next round
	game.OnTimer("next")

	// Now p3 should have cards
	if len(game.hands["p3"]) != CahHandSize {
		t.Fatalf("expected p3 to be dealt %d cards in new round, got %d", CahHandSize, len(game.hands["p3"]))
	}
}

func TestBuiltinDecksValid(t *testing.T) {
	metas := BuiltinDeckMetas()
	if len(metas) < 5 {
		t.Fatalf("expected at least 5 built-in decks (base en/pt, party, nsfw en/pt), got %d", len(metas))
	}
	// Base decks must exist for both locales.
	for _, want := range []string{"base_en", "base_pt-BR"} {
		d, ok := BuiltinDeck(want)
		if !ok {
			t.Fatalf("missing built-in deck %s", want)
		}
		if len(d.Black) < 20 || len(d.White) < 60 {
			t.Fatalf("%s should be a full base deck, got %d black / %d white", want, len(d.Black), len(d.White))
		}
	}
	// Every deck: valid pick/blank cards, non-empty whites.
	for _, m := range metas {
		d, _ := BuiltinDeck(m.ID)
		for _, c := range d.Black {
			blanks := strings.Count(c.Text, "____")
			if c.Pick != 1 && c.Pick != 2 {
				t.Fatalf("deck %s: bad pick %d", d.ID, c.Pick)
			}
			if blanks != 0 && blanks != c.Pick {
				t.Fatalf("deck %s: card %q has %d blanks, pick %d", d.ID, c.Text, blanks, c.Pick)
			}
		}
		for _, w := range d.White {
			if w == "" {
				t.Fatalf("deck %s has an empty white card", d.ID)
			}
		}
	}
}

func TestCahMergesSelectedDecks(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	base, _ := BuiltinDeck("base_en")
	party, _ := BuiltinDeck("party_en")
	game := &CahGame{}
	game.Start("room-1", Options{Room: room, Locale: "en", Decks: []Deck{base, party}})
	// Round 1 already drew one black card and dealt 3 hands of CahHandSize.
	wantBlack := len(base.Black) + len(party.Black) - 1
	wantWhite := len(base.White) + len(party.White) - 3*CahHandSize
	if len(game.blackDeck) != wantBlack {
		t.Fatalf("expected merged black pile %d, got %d", wantBlack, len(game.blackDeck))
	}
	if len(game.whiteDeck) != wantWhite {
		t.Fatalf("expected merged white pile %d, got %d", wantWhite, len(game.whiteDeck))
	}
}

func TestParseDeckRejectsBad(t *testing.T) {
	bad := [][]byte{
		[]byte(`{"name":"x","black":[{"text":"a ____ b ____","pick":1}],"white":["a","b","c","d","e","f","g","h"]}`),
		[]byte(`{"name":"x","black":[{"text":"nope","pick":3}],"white":["a","b","c","d","e","f","g","h"]}`),
		[]byte(`{"name":"x","black":[{"text":"a","pick":1}],"white":["a"]}`),
		[]byte(`not json`),
	}
	for i, raw := range bad {
		if _, err := ParseDeck(raw); err == nil {
			t.Fatalf("bad deck %d should have been rejected", i)
		}
	}
	good := []byte(`{"name":"Mine","locale":"en","black":[{"text":"Q?","pick":1},{"text":"a ____","pick":1},{"text":"____ and ____","pick":2}],"white":["a","b","c","d","e","f","g","h"]}`)
	d, err := ParseDeck(good)
	if err != nil {
		t.Fatalf("good deck rejected: %v", err)
	}
	if len(d.Black) != 3 || len(d.White) != 8 {
		t.Fatalf("unexpected parsed deck size")
	}
}

func TestCahPortugueseLocaleOptions(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room, Locale: "pt-BR"})

	if game.locale != "pt-BR" {
		t.Fatalf("expected locale pt-BR, got %s", game.locale)
	}
}

func TestCahUnknownLocaleDefaultsToEn(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: room, Locale: "invalid"})

	if game.locale != "en" {
		t.Fatalf("expected locale en after invalid, got %s", game.locale)
	}
}

func TestCahSubmissionResolvesPlayedCards(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: *room})
	game.blackCard = cahBlackCard{Text: "____ and ____.", Pick: 2}

	var player string
	for _, id := range room.players {
		if id != game.judge {
			player = id
			break
		}
	}
	want := []string{game.hands[player][1], game.hands[player][3]}

	_ = game.OnAction(player, map[string]any{"action": "submit", "cards": []any{float64(1), float64(3)}})
	got := game.submissions[player]
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("expected submission %v, got %v", want, got)
	}

	// The judging view must show exactly those cards, not hand leftovers.
	game.enterJudging()
	found := false
	for i, sub := range game.shuffledSubs {
		if game.subOrder[i] == player {
			found = len(sub) == 2 && sub[0] == want[0] && sub[1] == want[1]
		}
	}
	if !found {
		t.Fatalf("expected judging submissions to carry the played card texts")
	}
}

func TestCahMalformedSubmitDoesNotPanic(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &CahGame{}
	game.Start("room-1", Options{Room: *room})

	var player string
	for _, id := range room.players {
		if id != game.judge {
			player = id
			break
		}
	}
	_ = game.OnAction(player, map[string]any{"action": "submit", "cards": []any{"not-a-number"}})
	if _, ok := game.submissions[player]; ok {
		t.Fatalf("expected malformed submission rejected")
	}
}

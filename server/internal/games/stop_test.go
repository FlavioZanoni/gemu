package games

import (
	"testing"
	"time"
)

func TestStopStartDefaults(t *testing.T) {
	game := &StopGame{}
	game.Start("room-1", Options{})

	if game.phase != "answering" {
		t.Fatalf("expected phase answering, got %s", game.phase)
	}

	if len(game.categories) != StopCategoriesPerRound {
		t.Fatalf("expected %d categories, got %d", StopCategoriesPerRound, len(game.categories))
	}

	if game.letter == "" {
		t.Fatalf("expected letter to be set")
	}

	if game.round != 1 {
		t.Fatalf("expected round 1, got %d", game.round)
	}

	if game.totalRounds != StopTotalRounds {
		t.Fatalf("expected totalRounds %d, got %d", StopTotalRounds, game.totalRounds)
	}

	if game.deadline.IsZero() || game.deadline.Before(time.Now()) {
		t.Fatalf("expected deadline in the future")
	}

	state := game.PublicState()
	if state["phase"] != "answering" {
		t.Fatalf("expected phase in public state")
	}
}

func TestStopStartLocaleEnglish(t *testing.T) {
	game := &StopGame{}
	game.Start("room-1", Options{Locale: "en"})

	if game.locale != "en" {
		t.Fatalf("expected locale en")
	}

	// Check that letter is from English set
	validLetters := map[string]bool{"A": true, "B": true, "C": true, "D": true, "E": true, "F": true, "G": true, "H": true, "I": true, "J": true, "K": true, "L": true, "M": true, "N": true, "O": true, "P": true, "R": true, "S": true, "T": true, "W": true}
	if !validLetters[game.letter] {
		t.Fatalf("expected letter from English set, got %s", game.letter)
	}

	// Check that categories are from English set
	validCategories := map[string]bool{}
	for _, cat := range stopCategories["en"] {
		validCategories[cat] = true
	}
	for _, cat := range game.categories {
		if !validCategories[cat] {
			t.Fatalf("expected category from English set, got %s", cat)
		}
	}
}

func TestStopStartLocalePortuguese(t *testing.T) {
	game := &StopGame{}
	game.Start("room-1", Options{Locale: "pt-BR"})

	if game.locale != "pt-BR" {
		t.Fatalf("expected locale pt-BR")
	}

	// Check that letter is from Portuguese set
	validLetters := map[string]bool{"A": true, "B": true, "C": true, "D": true, "E": true, "F": true, "G": true, "H": true, "I": true, "J": true, "L": true, "M": true, "N": true, "O": true, "P": true, "R": true, "S": true, "T": true, "U": true, "V": true}
	if !validLetters[game.letter] {
		t.Fatalf("expected letter from Portuguese set, got %s", game.letter)
	}

	// Check that categories are from Portuguese set
	validCategories := map[string]bool{}
	for _, cat := range stopCategories["pt-BR"] {
		validCategories[cat] = true
	}
	for _, cat := range game.categories {
		if !validCategories[cat] {
			t.Fatalf("expected category from Portuguese set, got %s", cat)
		}
	}
}

func TestStopSetAnswers(t *testing.T) {
	game := &StopGame{}
	game.Start("room-1", Options{})

	// Submit answers
	answers := make(map[string]any)
	for _, cat := range game.categories {
		answers[cat] = "test answer"
	}

	err := game.OnAction("p1", map[string]any{
		"action":  "set_answers",
		"answers": answers,
	})

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(game.answers["p1"]) == 0 {
		t.Fatalf("expected answers to be stored")
	}

	// Check that all categories are stored
	for _, cat := range game.categories {
		if game.answers["p1"][cat] != "test answer" {
			t.Fatalf("expected answer for category %s", cat)
		}
	}
}

func TestStopAnswerTruncation(t *testing.T) {
	game := &StopGame{}
	game.Start("room-1", Options{})

	// Submit a long answer
	longAnswer := "this is a very long answer that exceeds sixty characters total"
	answers := make(map[string]any)
	answers[game.categories[0]] = longAnswer

	err := game.OnAction("p1", map[string]any{
		"action":  "set_answers",
		"answers": answers,
	})

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(game.answers["p1"][game.categories[0]]) > 60 {
		t.Fatalf("expected answer to be truncated to 60 chars")
	}
}

func TestStopStopRejectedWithoutAllAnswers(t *testing.T) {
	game := &StopGame{}
	game.Start("room-1", Options{})

	// Try to stop without all answers
	err := game.OnAction("p1", map[string]any{
		"action": "stop",
	})

	if err == nil {
		t.Fatalf("expected an error explaining the rejected stop")
	}

	if game.stopped {
		t.Fatalf("expected stop to be rejected without all answers")
	}
}

func TestStopStopAcceptedWithAllAnswers(t *testing.T) {
	game := &StopGame{}
	game.Start("room-1", Options{})

	// Submit complete answers
	answers := make(map[string]any)
	for _, cat := range game.categories {
		answers[cat] = "answer"
	}

	_ = game.OnAction("p1", map[string]any{
		"action":  "set_answers",
		"answers": answers,
	})

	// Now stop
	initialDeadline := game.deadline
	err := game.OnAction("p1", map[string]any{
		"action": "stop",
	})

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if !game.stopped {
		t.Fatalf("expected stop to be accepted with all answers")
	}

	if game.stoppedBy != "p1" {
		t.Fatalf("expected stoppedBy to be p1")
	}

	// Check that deadline was shortened
	if game.deadline.After(initialDeadline) {
		t.Fatalf("expected deadline to be shortened")
	}

	// Check that deadline is within grace period
	gracePeriodEnd := time.Now().Add(StopGraceSeconds * time.Second)
	if game.deadline.After(gracePeriodEnd.Add(1 * time.Second)) {
		t.Fatalf("expected deadline to be within grace period")
	}
}

func TestStopTimerAnswersEntersValidating(t *testing.T) {
	game := &StopGame{}
	game.Start("room-1", Options{})
	game.letter = "A" // pin the random letter so validity is deterministic

	// Submit some answers
	answers := make(map[string]any)
	answers[game.categories[0]] = "apple"
	answers[game.categories[1]] = "wrong"

	_ = game.OnAction("p1", map[string]any{
		"action":  "set_answers",
		"answers": answers,
	})

	// Fire the timer
	game.OnTimer("answers")

	if game.phase != "validating" {
		t.Fatalf("expected phase validating, got %s", game.phase)
	}

	// Check autoInvalid
	if !game.autoInvalid[game.categories[1]]["p1"] {
		t.Fatalf("expected autoInvalid for answer not starting with letter")
	}
}

func TestStopMajorityRejection(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})

	// Both players answer with valid answers (starting with the game's letter)
	answers1 := make(map[string]any)
	answers2 := make(map[string]any)
	for _, cat := range game.categories {
		answers1[cat] = game.letter + "answer1"
		answers2[cat] = game.letter + "answer2"
	}

	_ = game.OnAction("p1", map[string]any{
		"action":  "set_answers",
		"answers": answers1,
	})

	_ = game.OnAction("p2", map[string]any{
		"action":  "set_answers",
		"answers": answers2,
	})

	// Enter validating
	game.OnTimer("answers")

	// p1 validates, rejecting one of p2's answers
	_ = game.OnAction("p1", map[string]any{
		"action":   "validate",
		"rejected": []any{game.categories[0] + "|p2"},
	})

	// p2 validates, not rejecting anything
	_ = game.OnAction("p2", map[string]any{
		"action":   "validate",
		"rejected": []any{},
	})

	if game.phase != "roundResults" {
		t.Fatalf("expected phase roundResults after all validated")
	}

	// With 2 players the author can't vote on their own answer, so p1 is the
	// only eligible voter on p2's answer: 1 rejection of 1 is a majority.
	verdict := ""
	for _, result := range game.PublicState()["results"].(map[string][]map[string]any)[game.categories[0]] {
		if result["playerId"] == "p2" {
			verdict = result["verdict"].(string)
		}
	}

	if verdict != "invalid" {
		t.Fatalf("expected p2's answer rejected by the only other voter, got %q", verdict)
	}
	if game.roundScores["p2"] != 70 {
		t.Fatalf("expected p2 to score 7 uniques (70), got %d", game.roundScores["p2"])
	}
}

func TestStopMajorityRejectionWith3Players(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})

	// All three players answer
	for _, playerID := range []string{"p1", "p2", "p3"} {
		answers := make(map[string]any)
		for _, cat := range game.categories {
			answers[cat] = game.letter + "answer" + playerID
		}
		_ = game.OnAction(playerID, map[string]any{
			"action":  "set_answers",
			"answers": answers,
		})
	}

	// Enter validating
	game.OnTimer("answers")

	// p1 rejects p2's first answer
	_ = game.OnAction("p1", map[string]any{
		"action":   "validate",
		"rejected": []any{game.categories[0] + "|p2"},
	})

	// p2 rejects p2's first answer (should be filtered)
	_ = game.OnAction("p2", map[string]any{
		"action":   "validate",
		"rejected": []any{game.categories[0] + "|p2"},
	})

	// p3 rejects p2's first answer
	_ = game.OnAction("p3", map[string]any{
		"action":   "validate",
		"rejected": []any{game.categories[0] + "|p2"},
	})

	if game.phase != "roundResults" {
		t.Fatalf("expected phase roundResults after all validated")
	}

	// With 3 validators, 2 rejections is a majority (2*2 > 3 is true)
	// So p2's answer should be invalid
	verdict := ""
	for _, result := range game.PublicState()["results"].(map[string][]map[string]any)[game.categories[0]] {
		if result["playerId"] == "p2" {
			verdict = result["verdict"].(string)
		}
	}

	if verdict != "invalid" {
		t.Fatalf("expected p2's answer to be invalid with 2 rejections out of 3 validators, got %s", verdict)
	}
}

func TestStopScoringUnique(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})

	// Players submit different answers, both starting with the game's letter
	answers1 := make(map[string]any)
	answers2 := make(map[string]any)
	for _, cat := range game.categories {
		answers1[cat] = game.letter + "apple"
		answers2[cat] = game.letter + "banana"
	}

	_ = game.OnAction("p1", map[string]any{
		"action":  "set_answers",
		"answers": answers1,
	})

	_ = game.OnAction("p2", map[string]any{
		"action":  "set_answers",
		"answers": answers2,
	})

	// Enter validating and complete validation
	game.OnTimer("answers")

	_ = game.OnAction("p1", map[string]any{
		"action":   "validate",
		"rejected": []any{},
	})

	_ = game.OnAction("p2", map[string]any{
		"action":   "validate",
		"rejected": []any{},
	})

	// Check scores - each unique answer should be 10 points
	for _, playerID := range []string{"p1", "p2"} {
		expected := 10 * len(game.categories) // 10 points per unique answer
		if game.totalScores[playerID] != expected {
			t.Fatalf("expected %d points for %s, got %d", expected, playerID, game.totalScores[playerID])
		}
	}
}

func TestStopScoringDuplicate(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})

	// Players submit same answers, starting with the game's letter
	answers := make(map[string]any)
	for _, cat := range game.categories {
		answers[cat] = game.letter + "apple"
	}

	_ = game.OnAction("p1", map[string]any{
		"action":  "set_answers",
		"answers": answers,
	})

	_ = game.OnAction("p2", map[string]any{
		"action":  "set_answers",
		"answers": answers,
	})

	// Enter validating and complete validation
	game.OnTimer("answers")

	_ = game.OnAction("p1", map[string]any{
		"action":   "validate",
		"rejected": []any{},
	})

	_ = game.OnAction("p2", map[string]any{
		"action":   "validate",
		"rejected": []any{},
	})

	// Check scores - each duplicate answer should be 5 points
	for _, playerID := range []string{"p1", "p2"} {
		expected := 5 * len(game.categories) // 5 points per duplicate answer
		if game.totalScores[playerID] != expected {
			t.Fatalf("expected %d points for %s, got %d", expected, playerID, game.totalScores[playerID])
		}
	}
}

func TestStopScoringNormalizedDuplicate(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})

	// Players submit answers that normalize to the same value, starting with the game's letter
	answers1 := make(map[string]any)
	answers2 := make(map[string]any)
	for i, cat := range game.categories {
		if i == 0 {
			answers1[cat] = game.letter + "Água"
			answers2[cat] = game.letter + "agua "
		} else {
			answers1[cat] = game.letter + "answer"
			answers2[cat] = game.letter + "answer"
		}
	}

	_ = game.OnAction("p1", map[string]any{
		"action":  "set_answers",
		"answers": answers1,
	})

	_ = game.OnAction("p2", map[string]any{
		"action":  "set_answers",
		"answers": answers2,
	})

	// Enter validating and complete validation
	game.OnTimer("answers")

	_ = game.OnAction("p1", map[string]any{
		"action":   "validate",
		"rejected": []any{},
	})

	_ = game.OnAction("p2", map[string]any{
		"action":   "validate",
		"rejected": []any{},
	})

	// Check scores - answers that normalize to the same should be duplicates
	for _, playerID := range []string{"p1", "p2"} {
		expected := 5 * len(game.categories) // 5 points per duplicate answer
		if game.totalScores[playerID] != expected {
			t.Fatalf("expected %d points for %s (normalized duplicates), got %d", expected, playerID, game.totalScores[playerID])
		}
	}
}

func TestStopNextRoundAdminGated(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})

	// Complete a round
	answers := make(map[string]any)
	for _, cat := range game.categories {
		answers[cat] = "answer"
	}

	_ = game.OnAction("p1", map[string]any{
		"action":  "set_answers",
		"answers": answers,
	})

	_ = game.OnAction("p2", map[string]any{
		"action":  "set_answers",
		"answers": answers,
	})

	game.OnTimer("answers")

	_ = game.OnAction("p1", map[string]any{
		"action":   "validate",
		"rejected": []any{},
	})

	_ = game.OnAction("p2", map[string]any{
		"action":   "validate",
		"rejected": []any{},
	})

	// p2 (non-admin) tries to go to next round
	err := game.OnAction("p2", map[string]any{
		"action": "next_round",
	})

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if game.round != 1 {
		t.Fatalf("expected round to remain 1 when non-admin tries next_round")
	}

	// p1 (admin) goes to next round
	err = game.OnAction("p1", map[string]any{
		"action": "next_round",
	})

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if game.round != 2 {
		t.Fatalf("expected round to advance to 2 when admin requests next_round")
	}
}

func TestStopFinishedAfterLastRound(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})

	for round := 1; round < StopTotalRounds; round++ {
		// Complete a round
		answers := make(map[string]any)
		for _, cat := range game.categories {
			answers[cat] = "answer"
		}

		_ = game.OnAction("p1", map[string]any{
			"action":  "set_answers",
			"answers": answers,
		})

		_ = game.OnAction("p2", map[string]any{
			"action":  "set_answers",
			"answers": answers,
		})

		game.OnTimer("answers")

		_ = game.OnAction("p1", map[string]any{
			"action":   "validate",
			"rejected": []any{},
		})

		_ = game.OnAction("p2", map[string]any{
			"action":   "validate",
			"rejected": []any{},
		})

		// Go to next round
		_ = game.OnAction("p1", map[string]any{
			"action": "next_round",
		})
	}

	// Complete the last round
	answers := make(map[string]any)
	for _, cat := range game.categories {
		answers[cat] = "answer"
	}

	_ = game.OnAction("p1", map[string]any{
		"action":  "set_answers",
		"answers": answers,
	})

	_ = game.OnAction("p2", map[string]any{
		"action":  "set_answers",
		"answers": answers,
	})

	game.OnTimer("answers")

	_ = game.OnAction("p1", map[string]any{
		"action":   "validate",
		"rejected": []any{},
	})

	_ = game.OnAction("p2", map[string]any{
		"action":   "validate",
		"rejected": []any{},
	})

	// The last round's results are shown before the game finishes.
	if game.phase != "roundResults" || game.Status() == StatusFinished {
		t.Fatalf("expected final roundResults before finishing, got phase %s", game.phase)
	}
	name, _, ok := game.NextDeadline()
	if !ok || name != "final" {
		t.Fatalf("expected a final-results deadline, got %q ok=%v", name, ok)
	}
	game.OnTimer("final")

	// At this point, game should be finished
	if game.Status() != StatusFinished {
		t.Fatalf("expected StatusFinished after all rounds complete")
	}

	standings := game.Standings()
	if len(standings) != 2 {
		t.Fatalf("expected 2 standings")
	}

	// Scores should be sorted descending
	for i := 0; i < len(standings)-1; i++ {
		if standings[i].Score < standings[i+1].Score {
			t.Fatalf("expected standings to be sorted descending")
		}
	}
}

func TestStopOnPlayerLeaveCompletesValidationGate(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})

	// All players answer
	for _, playerID := range []string{"p1", "p2", "p3"} {
		answers := make(map[string]any)
		for _, cat := range game.categories {
			answers[cat] = game.letter + "answer" + playerID
		}
		_ = game.OnAction(playerID, map[string]any{
			"action":  "set_answers",
			"answers": answers,
		})
	}

	// Enter validating
	game.OnTimer("answers")

	// p1 and p2 validate
	_ = game.OnAction("p1", map[string]any{
		"action":   "validate",
		"rejected": []any{},
	})

	_ = game.OnAction("p2", map[string]any{
		"action":   "validate",
		"rejected": []any{},
	})

	// Game should still be in validating phase
	if game.phase != "validating" {
		t.Fatalf("expected phase validating, got %s", game.phase)
	}

	// p3 leaves - should trigger completion of validation
	game.OnPlayerLeave("p3")

	// Now game should have advanced
	if game.phase == "validating" {
		t.Fatalf("expected phase to advance after player leave completes validation gate")
	}
}

func TestStopStandingsSortedDescending(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})

	// Manually set some scores
	game.totalScores["p1"] = 100
	game.totalScores["p2"] = 200
	game.totalScores["p3"] = 50

	standings := game.Standings()

	if standings[0].PlayerID != "p2" || standings[0].Score != 200 {
		t.Fatalf("expected p2 first with 200")
	}
	if standings[1].PlayerID != "p1" || standings[1].Score != 100 {
		t.Fatalf("expected p1 second with 100")
	}
	if standings[2].PlayerID != "p3" || standings[2].Score != 50 {
		t.Fatalf("expected p3 third with 50")
	}
}

func TestStopStandingsIncludesUnseenPlayers(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})

	// Only p1 has a score
	game.totalScores["p1"] = 100

	standings := game.Standings()

	if len(standings) != 2 {
		t.Fatalf("expected 2 standings, got %d", len(standings))
	}

	// Find p2 in standings
	found := false
	for _, s := range standings {
		if s.PlayerID == "p2" && s.Score == 0 {
			found = true
		}
	}

	if !found {
		t.Fatalf("expected p2 with 0 score in standings")
	}
}

func TestStopPrivateState(t *testing.T) {
	game := &StopGame{}
	game.Start("room-1", Options{})

	// Set some answers
	answers := make(map[string]any)
	answers[game.categories[0]] = "apple"
	_ = game.OnAction("p1", map[string]any{
		"action":  "set_answers",
		"answers": answers,
	})

	private := game.PrivateState("p1")

	if private["answers"] == nil {
		t.Fatalf("expected answers in private state")
	}

	if private["validated"] != false {
		t.Fatalf("expected validated to be false")
	}

	if private["rejected"] == nil {
		t.Fatalf("expected rejected in private state")
	}
}

func TestStopNextDeadlineInAnsweringPhase(t *testing.T) {
	game := &StopGame{}
	game.Start("room-1", Options{})

	name, deadline, ok := game.NextDeadline()

	if !ok {
		t.Fatalf("expected NextDeadline to return true during answering")
	}

	if name != "answers" {
		t.Fatalf("expected deadline name 'answers', got %s", name)
	}

	if deadline.Before(time.Now()) {
		t.Fatalf("expected deadline in the future")
	}
}

func TestStopNextDeadlineInValidatingPhase(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})
	for _, playerID := range []string{"p1", "p2"} {
		answers := make(map[string]any)
		for _, cat := range game.categories {
			answers[cat] = game.letter + "x" + playerID
		}
		_ = game.OnAction(playerID, map[string]any{"action": "set_answers", "answers": answers})
	}

	// Enter validating
	game.OnTimer("answers")

	name, deadline, ok := game.NextDeadline()

	if !ok {
		t.Fatalf("expected NextDeadline to return true during validating")
	}

	if name != "validation" {
		t.Fatalf("expected deadline name 'validation', got %s", name)
	}

	if deadline.Before(time.Now()) {
		t.Fatalf("expected deadline in the future")
	}
}

func TestStopNextDeadlineInRoundResultsPhase(t *testing.T) {
	game := &StopGame{}
	game.Start("room-1", Options{})

	game.OnTimer("answers")
	game.OnTimer("validation")

	_, _, ok := game.NextDeadline()

	if ok {
		t.Fatalf("expected NextDeadline to return false during roundResults")
	}
}

// A player who disconnects after scoring in round 1 must not lose their
// cumulative total, even if they stay disconnected through round 2's scoring.
func TestStopOnPlayerLeavePreservesTotalScoreAcrossRounds(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})

	completeRound := func(players []string) {
		for _, playerID := range players {
			answers := make(map[string]any)
			for _, cat := range game.categories {
				answers[cat] = game.letter + "answer"
			}
			_ = game.OnAction(playerID, map[string]any{
				"action":  "set_answers",
				"answers": answers,
			})
		}
		game.OnTimer("answers")
		for _, playerID := range players {
			_ = game.OnAction(playerID, map[string]any{
				"action":   "validate",
				"rejected": []any{},
			})
		}
	}

	// Round 1: everyone plays and validates.
	completeRound([]string{"p1", "p2", "p3"})
	if game.phase != "roundResults" {
		t.Fatalf("expected phase roundResults after round 1, got %s", game.phase)
	}

	p3ScoreAfterRound1 := game.totalScores["p3"]
	if p3ScoreAfterRound1 == 0 {
		t.Fatalf("expected p3 to have earned points in round 1")
	}

	// p3 disconnects before round 2 starts.
	room.players = []string{"p1", "p2"}
	game.OnPlayerLeave("p3")

	if got, ok := game.totalScores["p3"]; !ok || got != p3ScoreAfterRound1 {
		t.Fatalf("expected p3's total score to survive disconnect, got %d (present=%v), want %d", got, ok, p3ScoreAfterRound1)
	}

	// Admin advances to round 2, played only by the still-connected players.
	_ = game.OnAction("p1", map[string]any{"action": "next_round"})
	if game.round != 2 {
		t.Fatalf("expected round 2, got %d", game.round)
	}

	completeRound([]string{"p1", "p2"})

	if got := game.totalScores["p3"]; got != p3ScoreAfterRound1 {
		t.Fatalf("expected p3's cumulative total to remain %d after round 2 scoring, got %d", p3ScoreAfterRound1, got)
	}
}

func TestStopUnknownLocaleDefaultsToEnglish(t *testing.T) {
	game := &StopGame{}
	game.Start("room-1", Options{Locale: "unknown"})

	if game.locale != "en" {
		t.Fatalf("expected locale to default to en, got %s", game.locale)
	}
}

// stopFill submits a full form for each player: letter + suffix + playerID.
func stopFill(game *StopGame, players ...string) {
	for _, playerID := range players {
		answers := make(map[string]any)
		for _, cat := range game.categories {
			answers[cat] = game.letter + "word" + playerID
		}
		_ = game.OnAction(playerID, map[string]any{"action": "set_answers", "answers": answers})
	}
}

func stopVerdict(game *StopGame, cat, playerID string) (string, int) {
	for _, r := range game.results[cat] {
		if r["playerId"] == playerID {
			return r["verdict"].(string), r["points"].(int)
		}
	}
	return "", -1
}

func TestStopUnknownActionErrors(t *testing.T) {
	game := &StopGame{}
	game.Start("room-1", Options{})
	if err := game.OnAction("p1", map[string]any{"action": "explode"}); err == nil {
		t.Fatalf("expected error for unknown action")
	}
	if err := game.OnAction("p1", map[string]any{}); err == nil {
		t.Fatalf("expected error for missing action")
	}
}

// Two players: a single NONSENSE vote from the only other player zeroes the
// answer (the author is not a voter on their own answer).
func TestStopTwoPlayerVoteRejects(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})
	stopFill(game, "p1", "p2")
	game.OnTimer("answers")
	if game.phase != "validating" {
		t.Fatalf("expected validating, got %s", game.phase)
	}

	key := game.categories[0] + "|p2"
	if err := game.OnAction("p1", map[string]any{"action": "vote", "key": key, "valid": false}); err != nil {
		t.Fatalf("vote: %v", err)
	}
	tally := game.PublicState()["tally"].(map[string]map[string]int)
	if tally[key]["nope"] != 1 || tally[key]["valid"] != 0 {
		t.Fatalf("expected live tally 0/1 for %s, got %v", key, tally[key])
	}
	// Self-votes and unknown keys are refused.
	if err := game.OnAction("p2", map[string]any{"action": "vote", "key": key, "valid": true}); err == nil {
		t.Fatalf("expected error voting on own answer")
	}
	if err := game.OnAction("p2", map[string]any{"action": "vote", "key": "Nope|p1", "valid": true}); err == nil {
		t.Fatalf("expected error voting on unknown key")
	}

	_ = game.OnAction("p1", map[string]any{"action": "validate"})
	_ = game.OnAction("p2", map[string]any{"action": "validate"})
	if game.phase != "roundResults" {
		t.Fatalf("expected roundResults, got %s", game.phase)
	}
	if v, pts := stopVerdict(game, game.categories[0], "p2"); v != "invalid" || pts != 0 {
		t.Fatalf("expected p2's first answer zeroed, got %s/%d", v, pts)
	}
	if v, pts := stopVerdict(game, game.categories[1], "p2"); v != "unique" || pts != 10 {
		t.Fatalf("expected p2's second answer unique, got %s/%d", v, pts)
	}
	if game.roundScores["p2"] != 70 || game.roundScores["p1"] != 80 {
		t.Fatalf("unexpected round scores %v", game.roundScores)
	}
}

func TestStopValidateIgnoresForeignKeys(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})
	stopFill(game, "p1", "p2")
	game.OnTimer("answers")

	junk := make([]any, 0, 1000)
	for i := 0; i < 1000; i++ {
		junk = append(junk, "Junk|p2")
	}
	junk = append(junk, game.categories[0]+"|p2")
	_ = game.OnAction("p1", map[string]any{"action": "validate", "rejected": junk})
	for key := range game.validations["p1"] {
		if _, ok := game.judgeable[key]; !ok {
			t.Fatalf("stored a foreign key %q", key)
		}
	}
	if len(game.validations["p1"]) > len(game.judgeable) {
		t.Fatalf("validation map grew beyond the judgeable set")
	}
}

func TestStopValidatingSkippedWhenNothingToJudge(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})
	// Nobody typed anything.
	game.OnTimer("answers")
	if game.phase != "roundResults" {
		t.Fatalf("expected validation skipped straight to roundResults, got %s", game.phase)
	}
}

func TestStopAnswersAcceptedDuringGrace(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})
	stopFill(game, "p1")
	if err := game.OnAction("p1", map[string]any{"action": "stop"}); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if !game.stopped {
		t.Fatalf("expected stopped")
	}
	cat := game.categories[0]
	_ = game.OnAction("p2", map[string]any{"action": "set_answers", "answers": map[string]any{cat: game.letter + "late"}})
	if game.answers["p2"][cat] != game.letter+"late" {
		t.Fatalf("expected grace-period answer to be stored")
	}
}

func TestStopPrivateStateCarriesRound(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})
	stopFill(game, "p1", "p2")
	game.OnTimer("answers")
	_ = game.OnAction("p1", map[string]any{"action": "validate"})
	_ = game.OnAction("p2", map[string]any{"action": "validate"})
	_ = game.OnAction("p1", map[string]any{"action": "next_round"})
	priv := game.PrivateState("p1")
	if priv["round"] != 2 {
		t.Fatalf("expected private round 2, got %v", priv["round"])
	}
	if len(priv["answers"].(map[string]string)) != 0 {
		t.Fatalf("expected empty answers in a fresh round")
	}
}

func TestStopResultsFrozenAfterLeave(t *testing.T) {
	room := &fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room})
	stopFill(game, "p1", "p2", "p3")
	game.OnTimer("answers")
	for _, p := range []string{"p1", "p2", "p3"} {
		_ = game.OnAction(p, map[string]any{"action": "validate"})
	}
	before := len(game.results[game.categories[0]])
	scoreBefore := game.roundScores["p1"]
	room.players = []string{"p1", "p2"}
	game.OnPlayerLeave("p3")
	if len(game.results[game.categories[0]]) != before || game.roundScores["p1"] != scoreBefore {
		t.Fatalf("results changed after a leave during roundResults")
	}
}

func TestStopFinalResultsThenFinish(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
	game := &StopGame{}
	game.Start("room-1", Options{Room: room, Settings: map[string]any{"rounds": 1}})
	stopFill(game, "p1", "p2")
	game.OnTimer("answers")
	_ = game.OnAction("p1", map[string]any{"action": "validate"})
	_ = game.OnAction("p2", map[string]any{"action": "validate"})
	st := game.PublicState()
	if st["phase"] != "roundResults" || st["final"] != true || st["results"] == nil {
		t.Fatalf("expected final round results to be shown, got %v", st["phase"])
	}
	if game.Status() == StatusFinished {
		t.Fatalf("finished before showing the last round's results")
	}
	// Admin can skip ahead.
	_ = game.OnAction("p1", map[string]any{"action": "next_round"})
	if game.Status() != StatusFinished {
		t.Fatalf("expected admin skip to finish the game")
	}
}

// With nobody connected, firing any phase's timer must leave the next
// deadline (if any) in the future, or the hub re-fires OnTimer in a loop.
func TestStopTimerWithNobodyConnectedRearms(t *testing.T) {
	for _, rounds := range []int{1, 2} {
		room := &fakeRoom{players: []string{"p1", "p2"}, admin: "p1"}
		game := &StopGame{}
		game.Start("room-1", Options{Room: room, Settings: map[string]any{"rounds": rounds}})
		stopFill(game, "p1", "p2")
		room.players = nil
		for i := 0; i < 5; i++ {
			name, _, ok := game.NextDeadline()
			if !ok {
				break
			}
			game.OnTimer(name)
			assertDeadlineNotPast(t, game, "stop "+game.phase)
		}
	}
}

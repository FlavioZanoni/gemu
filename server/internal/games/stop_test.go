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

	if err != nil {
		t.Fatalf("expected no error, got %v", err)
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

	// With 2 validators, 1 rejection is not a majority (1*2 > 2 is false)
	// So p2's answer should be valid
	verdict := ""
	for _, result := range game.PublicState()["results"].(map[string][]map[string]any)[game.categories[0]] {
		if result["playerId"] == "p2" {
			verdict = result["verdict"].(string)
		}
	}

	if verdict == "invalid" {
		t.Fatalf("expected p2's answer to survive with only 1 rejection out of 2 validators")
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
			answers[cat] = "answer"
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
			answers[cat] = "answer"
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
	game := &StopGame{}
	game.Start("room-1", Options{})

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

func TestStopUnknownLocaleDefaultsToEnglish(t *testing.T) {
	game := &StopGame{}
	game.Start("room-1", Options{Locale: "unknown"})

	if game.locale != "en" {
		t.Fatalf("expected locale to default to en, got %s", game.locale)
	}
}

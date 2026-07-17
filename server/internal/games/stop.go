package games

import (
	"math/rand"
	"sort"
	"time"
)

const (
	StopTotalRounds        = 3
	StopAnswerSeconds      = 90
	StopGraceSeconds       = 5
	StopValidationSeconds  = 60
	StopCategoriesPerRound = 8
)

// Category pools for each locale
var stopCategories = map[string][]string{
	"en": {
		"Animal", "City", "Country", "Food or drink", "Boy/girl name",
		"Profession", "Brand", "Movie or TV show", "Object", "Color",
		"Fruit or vegetable", "Sport", "Famous person", "Thing in the house",
		"Body part", "Song or band",
	},
	"pt-BR": {
		"Animal", "Cidade", "País", "Comida ou bebida", "Nome",
		"Profissão", "Marca", "Filme ou série", "Objeto", "Cor",
		"Fruta ou legume", "Esporte", "Pessoa famosa", "Coisa de casa",
		"Parte do corpo", "Música ou banda",
	},
}

// Letter sets for each locale
var stopLetters = map[string][]string{
	"en":    {"A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "R", "S", "T", "W"},
	"pt-BR": {"A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "L", "M", "N", "O", "P", "R", "S", "T", "U", "V"},
}

type StopGame struct {
	roomID        string
	room          RoomInfo
	locale        string
	phase         string
	round         int
	totalRounds   int
	answerSeconds int

	// Round state
	letter       string
	categories   []string
	usedLetters  map[string]bool
	answers      map[string]map[string]string // playerID -> category -> answer
	stopped      bool
	stoppedBy    string
	stopDeadline time.Time
	deadline     time.Time
	deadlineName string
	finished     bool

	// Validation state
	validations      map[string]map[string]bool // playerID -> "category|playerID" -> rejected
	validatedPlayers map[string]bool
	autoInvalid      map[string]map[string]bool // category -> playerID -> is auto invalid

	// Scoring
	roundScores map[string]int // playerID -> points this round
	totalScores map[string]int // playerID -> cumulative points
}

func NewStopFactory() Factory {
	return Factory{
		Type: "stop",
		Name: "Stop!",
		New: func() Adapter {
			return &StopGame{}
		},
	}
}

func (g *StopGame) Type() string {
	return "stop"
}

func (g *StopGame) Start(roomID string, opts Options) {
	g.roomID = roomID
	g.room = opts.Room
	locale := opts.Locale
	if locale == "" {
		locale = "en"
	}
	if _, ok := stopCategories[locale]; !ok {
		locale = "en"
	}
	g.locale = locale

	g.phase = ""
	g.round = 1
	g.totalRounds = SettingInt(opts.Settings, "rounds", StopTotalRounds, 1, 10)
	g.answerSeconds = SettingInt(opts.Settings, "answerSeconds", StopAnswerSeconds, 30, 300)
	g.usedLetters = make(map[string]bool)
	g.answers = make(map[string]map[string]string)
	g.stopped = false
	g.stoppedBy = ""
	g.validations = make(map[string]map[string]bool)
	g.validatedPlayers = make(map[string]bool)
	g.autoInvalid = make(map[string]map[string]bool)
	g.roundScores = make(map[string]int)
	g.totalScores = make(map[string]int)
	g.finished = false

	g.startRound()
}

func (g *StopGame) startRound() {
	// Pick unused letter
	availableLetters := make([]string, 0)
	for _, letter := range stopLetters[g.locale] {
		if !g.usedLetters[letter] {
			availableLetters = append(availableLetters, letter)
		}
	}
	if len(availableLetters) == 0 {
		availableLetters = stopLetters[g.locale]
	}
	g.letter = availableLetters[rand.Intn(len(availableLetters))]
	g.usedLetters[g.letter] = true

	// Pick distinct categories
	cats := stopCategories[g.locale]
	catCopy := make([]string, len(cats))
	copy(catCopy, cats)
	rand.Shuffle(len(catCopy), func(i, j int) { catCopy[i], catCopy[j] = catCopy[j], catCopy[i] })
	g.categories = catCopy[:StopCategoriesPerRound]

	// Clear round state
	g.answers = make(map[string]map[string]string)
	g.stopped = false
	g.stoppedBy = ""
	g.stopDeadline = time.Time{}
	g.validations = make(map[string]map[string]bool)
	g.validatedPlayers = make(map[string]bool)
	g.autoInvalid = make(map[string]map[string]bool)
	g.roundScores = make(map[string]int)

	// Enter answering phase
	g.phase = "answering"
	g.deadline = time.Now().Add(time.Duration(g.answerSeconds) * time.Second)
	g.deadlineName = "answers"
}

func (g *StopGame) OnPlayerJoin(playerID string) {
	// Mid-game joiners sit out the current round
}

func (g *StopGame) OnPlayerLeave(playerID string) {
	// Delete player's answers and validation
	delete(g.answers, playerID)
	delete(g.validations, playerID)
	delete(g.validatedPlayers, playerID)
	delete(g.totalScores, playerID)

	// Re-check if everyone has validated
	if g.phase == "validating" {
		g.checkAllValidated()
	}
}

func (g *StopGame) OnRoomChange() {
	// Re-check if everyone has validated
	if g.phase == "validating" {
		g.checkAllValidated()
	}
}

func (g *StopGame) OnAction(playerID string, payload map[string]any) error {
	if g.finished {
		return nil
	}

	switch g.phase {
	case "answering":
		action, _ := payload["action"].(string)
		switch action {
		case "set_answers":
			answersRaw, ok := payload["answers"].(map[string]any)
			if !ok {
				return nil
			}
			if _, ok := g.answers[playerID]; !ok {
				g.answers[playerID] = make(map[string]string)
			}
			for _, cat := range g.categories {
				if val, ok := answersRaw[cat]; ok {
					if str, ok := val.(string); ok {
						runes := []rune(str)
						if len(runes) > 60 {
							runes = runes[:60]
						}
						g.answers[playerID][cat] = string(runes)
					}
				}
			}
			return nil

		case "stop":
			// Check if player has a non-empty answer for every category
			playerAnswers := g.answers[playerID]
			for _, cat := range g.categories {
				if playerAnswers[cat] == "" {
					return nil
				}
			}
			// Valid stop
			if !g.stopped {
				g.stopped = true
				g.stoppedBy = playerID
				newDeadline := time.Now().Add(StopGraceSeconds * time.Second)
				if newDeadline.Before(g.deadline) {
					g.deadline = newDeadline
				}
			}
			return nil
		}

	case "validating":
		action, _ := payload["action"].(string)
		if action == "validate" {
			rejectedRaw, ok := payload["rejected"].([]any)
			if !ok {
				return nil
			}

			validation := make(map[string]bool)
			for _, item := range rejectedRaw {
				if key, ok := item.(string); ok {
					// Parse "category|playerID"
					idx := -1
					for i := len(key) - 1; i >= 0; i-- {
						if key[i] == '|' {
							idx = i
							break
						}
					}
					if idx <= 0 || idx >= len(key)-1 {
						continue
					}
					cat := key[:idx]
					targetPlayerID := key[idx+1:]

					// Filter out auto-invalid or self-answers
					if g.autoInvalid[cat][targetPlayerID] {
						continue
					}
					if targetPlayerID == playerID {
						continue
					}
					validation[key] = true
				}
			}

			g.validations[playerID] = validation
			g.validatedPlayers[playerID] = true
			g.checkAllValidated()
		}

	case "roundResults":
		action, _ := payload["action"].(string)
		if action == "next_round" {
			if g.room != nil && g.room.IsAdmin(playerID) {
				if g.round < g.totalRounds {
					g.round++
					g.startRound()
				} else {
					g.finished = true
				}
			}
		}
	}

	return nil
}

func (g *StopGame) OnTimer(name string) {
	if g.finished || name != g.deadlineName {
		return
	}

	switch g.phase {
	case "answering":
		g.enterValidating()
	case "validating":
		g.scoreRound()
		if g.round < g.totalRounds {
			g.phase = "roundResults"
		} else {
			g.finished = true
		}
	}
}

func (g *StopGame) enterValidating() {
	g.phase = "validating"

	// Compute autoInvalid
	for _, cat := range g.categories {
		if _, ok := g.autoInvalid[cat]; !ok {
			g.autoInvalid[cat] = make(map[string]bool)
		}
		for playerID, playerAnswers := range g.answers {
			answer := playerAnswers[cat]
			if answer == "" || !StartsWithLetter(answer, g.letter) {
				g.autoInvalid[cat][playerID] = true
			}
		}
	}

	g.validatedPlayers = make(map[string]bool)
	g.deadline = time.Now().Add(StopValidationSeconds * time.Second)
	g.deadlineName = "validation"
}

func (g *StopGame) checkAllValidated() {
	if g.room == nil {
		return
	}

	connected := g.room.ConnectedPlayerIDs()
	for _, playerID := range connected {
		if _, ok := g.answers[playerID]; ok && !g.validatedPlayers[playerID] {
			return
		}
	}

	// Everyone has validated
	g.scoreRound()
	if g.round < g.totalRounds {
		g.phase = "roundResults"
	} else {
		g.finished = true
	}
}

func (g *StopGame) scoreRound() {
	// Collect all players who validated
	validators := make(map[string]bool)
	for playerID := range g.validations {
		validators[playerID] = true
	}
	validatorCount := len(validators)

	// Score each category
	for _, cat := range g.categories {
		// First, determine which answers are valid (not auto-invalid and not majority-rejected)
		validAnswers := make(map[string]bool) // playerID -> is valid
		for playerID, playerAnswers := range g.answers {
			answer := playerAnswers[cat]
			if answer == "" {
				continue
			}

			if g.autoInvalid[cat][playerID] {
				continue
			}

			// Count rejections for this answer
			rejectionCount := 0
			for _, rejectedKeys := range g.validations {
				key := cat + "|" + playerID
				if rejectedKeys[key] {
					rejectionCount++
				}
			}

			// Check if majority rejected
			if validatorCount > 0 && rejectionCount*2 > validatorCount {
				continue
			}

			validAnswers[playerID] = true
		}

		// Now, group valid answers by normalized form to find duplicates
		normalizedGroups := make(map[string][]string) // normalized -> list of playerIDs
		for playerID := range validAnswers {
			if answer, ok := g.answers[playerID][cat]; ok {
				normalized := NormalizeAnswer(answer)
				normalizedGroups[normalized] = append(normalizedGroups[normalized], playerID)
			}
		}

		// Assign points
		for playerID := range validAnswers {
			if answer, ok := g.answers[playerID][cat]; ok {
				normalized := NormalizeAnswer(answer)
				if len(normalizedGroups[normalized]) > 1 {
					// Duplicate
					g.roundScores[playerID] += 5
				} else {
					// Unique
					g.roundScores[playerID] += 10
				}
			}
		}
	}

	// Accumulate round scores to total scores
	for playerID, points := range g.roundScores {
		g.totalScores[playerID] += points
	}

	// Ensure all connected players have entries
	if g.room != nil {
		for _, playerID := range g.room.ConnectedPlayerIDs() {
			if _, ok := g.totalScores[playerID]; !ok {
				g.totalScores[playerID] = 0
			}
		}
	}
}

func (g *StopGame) NextDeadline() (string, time.Time, bool) {
	if g.finished || (g.phase != "answering" && g.phase != "validating") {
		return "", time.Time{}, false
	}
	return g.deadlineName, g.deadline, true
}

func (g *StopGame) Status() Status {
	if g.finished {
		return StatusFinished
	}
	return StatusRunning
}

func (g *StopGame) Standings() []Standing {
	standings := make([]Standing, 0)
	seen := make(map[string]bool)

	for playerID, score := range g.totalScores {
		standings = append(standings, Standing{PlayerID: playerID, Score: score})
		seen[playerID] = true
	}

	// Add connected players with 0 if not already included
	if g.room != nil {
		for _, playerID := range g.room.ConnectedPlayerIDs() {
			if !seen[playerID] {
				standings = append(standings, Standing{PlayerID: playerID, Score: 0})
			}
		}
	}

	sort.SliceStable(standings, func(i, j int) bool { return standings[i].Score > standings[j].Score })
	return standings
}

func (g *StopGame) PublicState() map[string]any {
	state := map[string]any{
		"phase":       g.phase,
		"round":       g.round,
		"totalRounds": g.totalRounds,
		"letter":      g.letter,
		"categories":  g.categories,
		"totalScores": g.totalScores,
	}

	if g.phase == "answering" {
		state["deadline"] = g.deadline.UnixMilli()
		state["stopped"] = g.stopped
		if g.stopped {
			state["stoppedBy"] = g.stoppedBy
		}
		answersFilled := make(map[string]int)
		for playerID, playerAnswers := range g.answers {
			count := 0
			for _, answer := range playerAnswers {
				if answer != "" {
					count++
				}
			}
			answersFilled[playerID] = count
		}
		state["answersFilled"] = answersFilled
	}

	if g.phase == "validating" {
		state["deadline"] = g.deadline.UnixMilli()
		answersState := make(map[string][]map[string]any)
		for _, cat := range g.categories {
			answersState[cat] = make([]map[string]any, 0)
			for playerID, playerAnswers := range g.answers {
				if answer, ok := playerAnswers[cat]; ok && answer != "" {
					answersState[cat] = append(answersState[cat], map[string]any{
						"playerId":    playerID,
						"answer":      answer,
						"autoInvalid": g.autoInvalid[cat][playerID],
					})
				}
			}
		}
		state["answers"] = answersState
		state["validatedCount"] = len(g.validatedPlayers)
	}

	if g.phase == "roundResults" {
		// Collect validators count
		validatorCount := len(g.validations)

		resultsState := make(map[string][]map[string]any)
		for _, cat := range g.categories {
			resultsState[cat] = make([]map[string]any, 0)
			for playerID, playerAnswers := range g.answers {
				answer, ok := playerAnswers[cat]
				if !ok || answer == "" {
					continue
				}

				verdict := "invalid"
				if !g.autoInvalid[cat][playerID] {
					rejectionCount := 0
					for _, rejectedKeys := range g.validations {
						key := cat + "|" + playerID
						if rejectedKeys[key] {
							rejectionCount++
						}
					}
					isMajorityRejected := validatorCount > 0 && rejectionCount*2 > validatorCount
					if !isMajorityRejected {
						// Check if unique or duplicate
						normalizedAnswers := make(map[string]int)
						for otherPlayerID, otherPlayerAnswers := range g.answers {
							otherAnswer := otherPlayerAnswers[cat]
							if otherAnswer == "" || otherPlayerID == playerID {
								continue
							}
							if g.autoInvalid[cat][otherPlayerID] {
								continue
							}
							otherRejectionCount := 0
							for _, rejectedKeys := range g.validations {
								otherKey := cat + "|" + otherPlayerID
								if rejectedKeys[otherKey] {
									otherRejectionCount++
								}
							}
							otherIsMajorityRejected := validatorCount > 0 && otherRejectionCount*2 > validatorCount
							if otherIsMajorityRejected {
								continue
							}
							normalizedOther := NormalizeAnswer(otherAnswer)
							normalizedAnswers[normalizedOther]++
						}

						normalizedThis := NormalizeAnswer(answer)
						if normalizedAnswers[normalizedThis] > 0 {
							verdict = "duplicate"
						} else {
							verdict = "unique"
						}
					}
				}

				points := 0
				switch verdict {
				case "unique":
					points = 10
				case "duplicate":
					points = 5
				}
				resultsState[cat] = append(resultsState[cat], map[string]any{
					"playerId": playerID,
					"answer":   answer,
					"verdict":  verdict,
					"points":   points,
				})
			}
		}
		state["results"] = resultsState
		state["roundScores"] = g.roundScores
	}

	return state
}

func (g *StopGame) PrivateState(playerID string) map[string]any {
	playerAnswers := g.answers[playerID]
	if playerAnswers == nil {
		playerAnswers = make(map[string]string)
	}

	rejectedList := make([]string, 0)
	if validations, ok := g.validations[playerID]; ok {
		for key := range validations {
			rejectedList = append(rejectedList, key)
		}
	}

	return map[string]any{
		"answers":   playerAnswers,
		"validated": g.validatedPlayers[playerID],
		"rejected":  rejectedList,
	}
}

func (g *StopGame) Shift(delta time.Duration) {
	g.deadline = g.deadline.Add(delta)
}

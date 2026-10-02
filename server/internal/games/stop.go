package games

import (
	"errors"
	"math/rand"
	"sort"
	"strings"
	"time"
)

const (
	StopTotalRounds        = 3
	StopAnswerSeconds      = 90
	StopGraceSeconds       = 5
	StopValidationSeconds  = 60
	StopCategoriesPerRound = 8
	// StopFinalResultsSeconds is how long the last round's results stay up
	// before the game reports finished and the session results take over.
	StopFinalResultsSeconds = 10
	stopMaxAnswerRunes      = 60
)

var (
	errStopUnknownAction = errors.New("unknown action")
	errStopIncomplete    = errors.New("fill every category")
	errStopBadVote       = errors.New("invalid vote")
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
	roster       map[string]bool              // players taking part in this round
	stopped      bool
	stoppedBy    string
	deadline     time.Time
	deadlineName string
	finished     bool

	// Validation state
	validations      map[string]map[string]bool // voterID -> "category|authorID" -> rejected
	validatedPlayers map[string]bool
	autoInvalid      map[string]map[string]bool // category -> playerID -> is auto invalid
	judgeable        map[string]string          // "category|authorID" -> authorID (answers open to a vote)

	// Scoring (frozen once the round is scored)
	results     map[string][]map[string]any // category -> per-answer verdicts
	roundScores map[string]int              // playerID -> points this round
	totalScores map[string]int              // playerID -> cumulative points
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

func (g *StopGame) Start(roomID string, opts Options) {
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
	g.roster = make(map[string]bool)
	if g.room != nil {
		for _, id := range g.room.ConnectedPlayerIDs() {
			g.roster[id] = true
		}
	}
	g.stopped = false
	g.stoppedBy = ""
	g.validations = make(map[string]map[string]bool)
	g.validatedPlayers = make(map[string]bool)
	g.autoInvalid = make(map[string]map[string]bool)
	g.judgeable = make(map[string]string)
	g.results = nil
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
	// A permanent leave. totalScores stay (earlier rounds were earned).
	switch g.phase {
	case "answering":
		// Their half-filled form never reaches the vote.
		delete(g.answers, playerID)
		delete(g.roster, playerID)
	case "validating":
		// Answers already up for a vote stay (others may be mid-judgement);
		// they just stop being someone the gate waits for.
		delete(g.roster, playerID)
		g.checkAllValidated()
	}
	// roundResults: results are frozen; nothing to recompute.
}

func (g *StopGame) OnRoomChange() {
	if g.phase == "validating" {
		g.checkAllValidated()
	}
}

func (g *StopGame) OnAction(playerID string, payload map[string]any) error {
	action, _ := payload["action"].(string)
	switch action {
	case "set_answers", "stop", "vote", "validate", "next_round":
	default:
		return errStopUnknownAction
	}
	if g.finished {
		return nil
	}

	switch action {
	case "set_answers":
		// Accepted through the STOP grace window too (phase stays answering).
		if g.phase != "answering" {
			return nil
		}
		answersRaw, ok := payload["answers"].(map[string]any)
		if !ok {
			return errors.New("answers must be an object")
		}
		g.roster[playerID] = true
		if _, ok := g.answers[playerID]; !ok {
			g.answers[playerID] = make(map[string]string)
		}
		for _, cat := range g.categories {
			if str, ok := answersRaw[cat].(string); ok {
				runes := []rune(str)
				if len(runes) > stopMaxAnswerRunes {
					runes = runes[:stopMaxAnswerRunes]
				}
				g.answers[playerID][cat] = string(runes)
			}
		}
		return nil

	case "stop":
		if g.phase != "answering" || g.stopped {
			return nil
		}
		playerAnswers := g.answers[playerID]
		for _, cat := range g.categories {
			if strings.TrimSpace(playerAnswers[cat]) == "" {
				return errStopIncomplete
			}
		}
		g.stopped = true
		g.stoppedBy = playerID
		newDeadline := time.Now().Add(StopGraceSeconds * time.Second)
		if newDeadline.Before(g.deadline) {
			g.deadline = newDeadline
		}
		return nil

	case "vote":
		if g.phase != "validating" || g.validatedPlayers[playerID] {
			return nil
		}
		if !g.roster[playerID] {
			return errStopBadVote
		}
		key, _ := payload["key"].(string)
		author, ok := g.judgeable[key]
		if !ok || author == playerID {
			return errStopBadVote
		}
		valid, ok := payload["valid"].(bool)
		if !ok {
			return errStopBadVote
		}
		if g.validations[playerID] == nil {
			g.validations[playerID] = make(map[string]bool)
		}
		g.validations[playerID][key] = !valid
		return nil

	case "validate":
		if g.phase != "validating" || g.validatedPlayers[playerID] {
			return nil
		}
		if !g.roster[playerID] {
			return errStopBadVote
		}
		votes := g.validations[playerID]
		if votes == nil {
			votes = make(map[string]bool)
		}
		// Optional bulk list of rejected keys. Only keys of this round's
		// judgeable answers by someone else count; the scan is capped.
		rejectedRaw, _ := payload["rejected"].([]any)
		limit := len(g.judgeable)
		for i, item := range rejectedRaw {
			if i >= limit {
				break
			}
			key, ok := item.(string)
			if !ok {
				continue
			}
			if author, ok := g.judgeable[key]; ok && author != playerID {
				votes[key] = true
			}
		}
		// Anything left unjudged counts as a VALID vote.
		for key, author := range g.judgeable {
			if author == playerID {
				continue
			}
			if _, voted := votes[key]; !voted {
				votes[key] = false
			}
		}
		g.validations[playerID] = votes
		g.validatedPlayers[playerID] = true
		g.checkAllValidated()
		return nil

	case "next_round":
		if g.phase != "roundResults" || g.room == nil || !g.room.IsAdmin(playerID) {
			return nil
		}
		if g.round < g.totalRounds {
			g.round++
			g.startRound()
		} else {
			g.finished = true
		}
		return nil
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
		g.endRound()
	case "roundResults":
		if g.round >= g.totalRounds {
			g.finished = true
		}
	}
	// Every branch above moves to a phase with a fresh (or no) deadline; this
	// guard keeps it that way, since a deadline left in the past would make
	// the hub re-fire OnTimer in a hot loop.
	if _, at, ok := g.NextDeadline(); ok && !at.After(time.Now()) {
		g.deadline = time.Now().Add(StopGraceSeconds * time.Second)
	}
}

func (g *StopGame) enterValidating() {
	g.phase = "validating"

	// Compute autoInvalid and the set of answers open to a vote.
	for _, cat := range g.categories {
		if _, ok := g.autoInvalid[cat]; !ok {
			g.autoInvalid[cat] = make(map[string]bool)
		}
		for playerID, playerAnswers := range g.answers {
			answer := playerAnswers[cat]
			if strings.TrimSpace(answer) == "" {
				continue
			}
			if !StartsWithLetter(answer, g.letter) {
				g.autoInvalid[cat][playerID] = true
				continue
			}
			g.judgeable[cat+"|"+playerID] = playerID
		}
	}

	g.validatedPlayers = make(map[string]bool)
	g.deadline = time.Now().Add(StopValidationSeconds * time.Second)
	g.deadlineName = "validation"

	// Nobody may have anything to judge (e.g. every answer auto-invalid).
	g.checkAllValidated()
}

// hasSomethingToJudge reports whether playerID has at least one answer by
// someone else to vote on.
func (g *StopGame) hasSomethingToJudge(playerID string) bool {
	for _, author := range g.judgeable {
		if author != playerID {
			return true
		}
	}
	return false
}

func (g *StopGame) checkAllValidated() {
	if g.phase != "validating" {
		return
	}
	if g.room == nil {
		// No room view (unit tests): only advance when nothing is judgeable.
		if len(g.judgeable) == 0 {
			g.endRound()
		}
		return
	}
	for _, playerID := range g.room.ConnectedPlayerIDs() {
		if !g.roster[playerID] || g.validatedPlayers[playerID] {
			continue
		}
		if g.hasSomethingToJudge(playerID) {
			return
		}
	}
	g.endRound()
}

// endRound scores the round, freezes its results and shows them. After the
// last round the results stay up for StopFinalResultsSeconds, then finish.
func (g *StopGame) endRound() {
	g.scoreRound()
	g.phase = "roundResults"
	if g.round >= g.totalRounds {
		g.deadline = time.Now().Add(StopFinalResultsSeconds * time.Second)
		g.deadlineName = "final"
	} else {
		g.deadlineName = ""
	}
}

// rejected reports whether a strict majority of the players who voted on key
// (the author never votes on their own answer) called it nonsense.
func (g *StopGame) rejected(key string) bool {
	voters, rejections := 0, 0
	for _, votes := range g.validations {
		rejected, ok := votes[key]
		if !ok {
			continue
		}
		voters++
		if rejected {
			rejections++
		}
	}
	return voters > 0 && rejections*2 > voters
}

func (g *StopGame) scoreRound() {
	results := make(map[string][]map[string]any, len(g.categories))
	for _, cat := range g.categories {
		// Valid = typed, starts with the letter, not majority-rejected.
		valid := make(map[string]string) // playerID -> normalized answer
		groups := make(map[string]int)   // normalized -> count
		for playerID, playerAnswers := range g.answers {
			answer := playerAnswers[cat]
			if strings.TrimSpace(answer) == "" || g.autoInvalid[cat][playerID] {
				continue
			}
			if g.rejected(cat + "|" + playerID) {
				continue
			}
			n := NormalizeAnswer(answer)
			valid[playerID] = n
			groups[n]++
		}

		ids := make([]string, 0, len(g.answers))
		for playerID := range g.answers {
			ids = append(ids, playerID)
		}
		sort.Strings(ids)

		entries := make([]map[string]any, 0, len(ids))
		for _, playerID := range ids {
			answer := g.answers[playerID][cat]
			if strings.TrimSpace(answer) == "" {
				continue
			}
			verdict, points := "invalid", 0
			if n, ok := valid[playerID]; ok {
				if groups[n] > 1 {
					verdict, points = "duplicate", 5
				} else {
					verdict, points = "unique", 10
				}
			}
			g.roundScores[playerID] += points
			entries = append(entries, map[string]any{
				"playerId": playerID,
				"answer":   answer,
				"verdict":  verdict,
				"points":   points,
			})
		}
		results[cat] = entries
	}
	g.results = results

	for playerID, points := range g.roundScores {
		g.totalScores[playerID] += points
	}
	// Everyone who took part shows up on the board, even with 0.
	for playerID := range g.roster {
		if _, ok := g.totalScores[playerID]; !ok {
			g.totalScores[playerID] = 0
		}
		if _, ok := g.roundScores[playerID]; !ok {
			g.roundScores[playerID] = 0
		}
	}
	if g.room != nil {
		for _, playerID := range g.room.ConnectedPlayerIDs() {
			if _, ok := g.totalScores[playerID]; !ok {
				g.totalScores[playerID] = 0
			}
		}
	}
}

func (g *StopGame) NextDeadline() (string, time.Time, bool) {
	if g.finished || g.deadlineName == "" {
		return "", time.Time{}, false
	}
	switch g.phase {
	case "answering", "validating":
		return g.deadlineName, g.deadline, true
	case "roundResults":
		if g.deadlineName == "final" {
			return g.deadlineName, g.deadline, true
		}
	}
	return "", time.Time{}, false
}

func (g *StopGame) Status() Status {
	if g.finished {
		return StatusFinished
	}
	return StatusRunning
}

func (g *StopGame) Standings() []Standing {
	return standings(g.totalScores, g.room)
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

	switch g.phase {
	case "answering":
		state["deadline"] = g.deadline.UnixMilli()
		// Skew-free form of deadline: the client anchors it to its own clock
		// to flush unsent answers just before the round closes.
		state["remainingMs"] = max(0, time.Until(g.deadline).Milliseconds())
		state["stopped"] = g.stopped
		if g.stopped {
			state["stoppedBy"] = g.stoppedBy
		}
		answersFilled := make(map[string]int)
		for playerID, playerAnswers := range g.answers {
			count := 0
			for _, cat := range g.categories {
				if strings.TrimSpace(playerAnswers[cat]) != "" {
					count++
				}
			}
			answersFilled[playerID] = count
		}
		state["answersFilled"] = answersFilled

	case "validating":
		state["deadline"] = g.deadline.UnixMilli()
		ids := make([]string, 0, len(g.answers))
		for playerID := range g.answers {
			ids = append(ids, playerID)
		}
		sort.Strings(ids)
		answersState := make(map[string][]map[string]any)
		tally := make(map[string]map[string]int, len(g.judgeable))
		for _, cat := range g.categories {
			answersState[cat] = make([]map[string]any, 0)
			for _, playerID := range ids {
				answer := g.answers[playerID][cat]
				if strings.TrimSpace(answer) == "" {
					continue
				}
				answersState[cat] = append(answersState[cat], map[string]any{
					"playerId":    playerID,
					"answer":      answer,
					"autoInvalid": g.autoInvalid[cat][playerID],
				})
			}
		}
		for key := range g.judgeable {
			tally[key] = map[string]int{"valid": 0, "nope": 0}
		}
		for _, votes := range g.validations {
			for key, rejected := range votes {
				t, ok := tally[key]
				if !ok {
					continue
				}
				if rejected {
					t["nope"]++
				} else {
					t["valid"]++
				}
			}
		}
		required := 0
		if g.room != nil {
			for _, playerID := range g.room.ConnectedPlayerIDs() {
				if g.roster[playerID] && g.hasSomethingToJudge(playerID) {
					required++
				}
			}
		}
		state["answers"] = answersState
		state["tally"] = tally
		state["validatedCount"] = len(g.validatedPlayers)
		state["requiredCount"] = required

	case "roundResults":
		state["results"] = g.results
		state["roundScores"] = g.roundScores
		state["final"] = g.round >= g.totalRounds
		if g.round >= g.totalRounds {
			state["deadline"] = g.deadline.UnixMilli()
		}
	}

	return state
}

func (g *StopGame) PrivateState(playerID string) map[string]any {
	playerAnswers := g.answers[playerID]
	if playerAnswers == nil {
		playerAnswers = make(map[string]string)
	}

	rejectedList := make([]string, 0)
	votes := make(map[string]string)
	for key, rejected := range g.validations[playerID] {
		if rejected {
			rejectedList = append(rejectedList, key)
			votes[key] = "nonsense"
		} else {
			votes[key] = "valid"
		}
	}
	sort.Strings(rejectedList)

	return map[string]any{
		// round lets the client ignore a stale private state that arrives
		// before (or after) the public state of a new round.
		"round":     g.round,
		"answers":   playerAnswers,
		"validated": g.validatedPlayers[playerID],
		"rejected":  rejectedList,
		"votes":     votes,
		"judge":     g.roster[playerID],
	}
}

func (g *StopGame) Shift(delta time.Duration) {
	g.deadline = g.deadline.Add(delta)
}

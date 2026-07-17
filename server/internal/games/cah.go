package games

import (
	"math/rand"
	"time"
)

const (
	CahTotalRounds   = 8
	CahHandSize      = 5
	CahAnswerSeconds = 75
	CahJudgeSeconds  = 60
	CahResultSeconds = 8
)

type cahBlackCard struct {
	Text string
	Pick int
}

type CahGame struct {
	room         RoomInfo
	locale       string
	phase        string // "answering", "judging", "roundResults"
	round        int
	totalRounds  int
	deadline     time.Time
	deadlineName string
	finished     bool

	// Decks and draw piles
	blackDeck []cahBlackCard
	whiteDeck []string
	whiteDiscard []string

	// Judge rotation
	judgeOrder []string
	judgeIdx   int
	judge      string

	// Current round state
	blackCard    cahBlackCard
	hands        map[string][]string // playerID -> card texts
	submissions  map[string][]string // playerID -> played card texts (resolved at submit time)
	shuffledSubs [][]string          // anonymized submissions in shuffle order
	subOrder     []string            // which playerID submitted which shuffledSubs index
	roundWinner  string              // playerID or ""
	scores       map[string]int      // round wins

}

func NewCahFactory() Factory {
	return Factory{
		Type:       "cah",
		Name:       "Cartas",
		MinPlayers: 3,
		New: func() Adapter {
			return &CahGame{}
		},
	}
}

func (g *CahGame) Start(roomID string, opts Options) {
	g.room = opts.Room
	g.locale = opts.Locale
	if g.locale != "en" && g.locale != "pt-BR" {
		g.locale = "en"
	}

	// The hub resolves and merges selected decks; unit tests may pass none, so
	// fall back to this locale's base deck.
	decks := opts.Decks
	if len(decks) == 0 {
		if base, ok := BuiltinDeck(DefaultDeckID(g.locale)); ok {
			decks = []Deck{base}
		}
	}
	black, white := MergeDecks(decks)
	g.blackDeck = make([]cahBlackCard, len(black))
	copy(g.blackDeck, black)
	g.whiteDeck = make([]string, len(white))
	copy(g.whiteDeck, white)
	// Start() shuffles both piles below via shuffleDeckCards().

	g.round = 1
	g.totalRounds = SettingInt(opts.Settings, "rounds", CahTotalRounds, 3, 20)
	g.finished = false
	g.scores = make(map[string]int)
	g.hands = make(map[string][]string)
	g.submissions = make(map[string][]string)
	g.whiteDiscard = make([]string, 0)

	// Shuffle decks
	g.shuffleDeckCards()

	// Initialize judge order from connected players
	g.judgeOrder = g.connectedPlayers()
	if len(g.judgeOrder) > 0 {
		rand.Shuffle(len(g.judgeOrder), func(i, j int) {
			g.judgeOrder[i], g.judgeOrder[j] = g.judgeOrder[j], g.judgeOrder[i]
		})
		g.judgeIdx = 0
		g.judge = g.judgeOrder[0]
	}

	// Ensure all connected players have scores
	for _, playerID := range g.connectedPlayers() {
		if _, ok := g.scores[playerID]; !ok {
			g.scores[playerID] = 0
		}
	}

	g.startRound()
}

func (g *CahGame) connectedPlayers() []string {
	if g.room == nil {
		return []string{}
	}
	return g.room.ConnectedPlayerIDs()
}

func (g *CahGame) shuffleDeckCards() {
	rand.Shuffle(len(g.blackDeck), func(i, j int) {
		g.blackDeck[i], g.blackDeck[j] = g.blackDeck[j], g.blackDeck[i]
	})
	rand.Shuffle(len(g.whiteDeck), func(i, j int) {
		g.whiteDeck[i], g.whiteDeck[j] = g.whiteDeck[j], g.whiteDeck[i]
	})
}

func (g *CahGame) drawBlackCard() cahBlackCard {
	card := g.blackDeck[0]
	g.blackDeck = g.blackDeck[1:]
	return card
}

func (g *CahGame) drawWhiteCards(count int) []string {
	result := make([]string, 0, count)
	for i := 0; i < count; i++ {
		if len(g.whiteDeck) == 0 {
			g.whiteDeck = g.whiteDiscard
			g.whiteDiscard = make([]string, 0)
			rand.Shuffle(len(g.whiteDeck), func(i, j int) {
				g.whiteDeck[i], g.whiteDeck[j] = g.whiteDeck[j], g.whiteDeck[i]
			})
		}
		if len(g.whiteDeck) > 0 {
			card := g.whiteDeck[0]
			g.whiteDeck = g.whiteDeck[1:]
			result = append(result, card)
		}
	}
	return result
}

func (g *CahGame) startRound() {
	if g.round > g.totalRounds {
		g.finished = true
		return
	}

	// Draw black card
	g.blackCard = g.drawBlackCard()

	// Clear submissions
	g.submissions = make(map[string][]string)
	g.shuffledSubs = nil
	g.subOrder = nil
	g.roundWinner = ""

	// Deal cards to all connected players (including any pending joins)
	connected := g.connectedPlayers()
	for _, playerID := range connected {
		if _, ok := g.hands[playerID]; !ok {
			g.hands[playerID] = make([]string, 0)
		}
		// Refill to CahHandSize
		needed := CahHandSize - len(g.hands[playerID])
		if needed > 0 {
			newCards := g.drawWhiteCards(needed)
			g.hands[playerID] = append(g.hands[playerID], newCards...)
		}
	}

	// Start answering phase
	g.phase = "answering"
	g.deadline = time.Now().Add(time.Duration(CahAnswerSeconds) * time.Second)
	g.deadlineName = "answers"
}

func (g *CahGame) checkAllSubmitted() bool {
	connected := g.connectedPlayers()
	for _, playerID := range connected {
		if playerID == g.judge {
			continue // judge doesn't submit
		}
		if _, ok := g.submissions[playerID]; !ok {
			return false
		}
	}
	return true
}

func (g *CahGame) enterJudging() {
	g.phase = "judging"
	g.deadline = time.Now().Add(time.Duration(CahJudgeSeconds) * time.Second)
	g.deadlineName = "judge"

	// Build anonymized submissions
	g.shuffledSubs = make([][]string, 0)
	g.subOrder = make([]string, 0)

	// Collect all submissions in order
	submissionList := make([]struct {
		playerID string
		cards    []string
	}, 0)

	connected := make(map[string]bool)
	for _, id := range g.connectedPlayers() {
		connected[id] = true
	}

	for playerID, cards := range g.submissions {
		if !connected[playerID] {
			continue
		}
		submissionList = append(submissionList, struct {
			playerID string
			cards    []string
		}{playerID, cards})
	}

	// Shuffle submissions
	rand.Shuffle(len(submissionList), func(i, j int) {
		submissionList[i], submissionList[j] = submissionList[j], submissionList[i]
	})

	for _, sub := range submissionList {
		g.shuffledSubs = append(g.shuffledSubs, sub.cards)
		g.subOrder = append(g.subOrder, sub.playerID)
	}
}

func (g *CahGame) enterRoundResults() {
	g.phase = "roundResults"
	g.deadline = time.Now().Add(time.Duration(CahResultSeconds) * time.Second)
	g.deadlineName = "next"
}

func (g *CahGame) rotateJudge() {
	if len(g.judgeOrder) == 0 {
		return
	}

	connected := make(map[string]bool)
	for _, id := range g.connectedPlayers() {
		connected[id] = true
	}

	// Move to next in judge order
	attempts := 0
	for attempts < len(g.judgeOrder) {
		g.judgeIdx = (g.judgeIdx + 1) % len(g.judgeOrder)
		if connected[g.judgeOrder[g.judgeIdx]] {
			g.judge = g.judgeOrder[g.judgeIdx]
			return
		}
		attempts++
	}

	// Fallback: keep current judge if none connected
	// or pick any connected player
	for _, id := range g.connectedPlayers() {
		g.judge = id
		return
	}
}

func (g *CahGame) OnPlayerJoin(playerID string) {
}

func (g *CahGame) OnPlayerLeave(playerID string) {
	if g.finished {
		return
	}

	// Remove their hand and submission
	delete(g.hands, playerID)
	delete(g.submissions, playerID)

	// If they were the judge during answering or judging, rotate to next connected player
	if playerID == g.judge && (g.phase == "answering" || g.phase == "judging") {
		g.rotateJudge()
		if g.phase == "answering" {
			// Recheck if all remaining players have submitted
			if g.checkAllSubmitted() {
				g.enterJudging()
			}
		}
	}
}

func (g *CahGame) OnRoomChange() {
	if g.finished {
		return
	}

	if g.phase == "answering" {
		// Recheck if all have submitted
		if g.checkAllSubmitted() {
			g.enterJudging()
		}
	} else if g.phase == "judging" {
		// Check if judge is still connected
		connected := make(map[string]bool)
		for _, id := range g.connectedPlayers() {
			connected[id] = true
		}
		if !connected[g.judge] {
			// Judge disconnected, auto-pick a winner
			if len(g.shuffledSubs) > 0 {
				winnerIdx := rand.Intn(len(g.shuffledSubs))
				g.roundWinner = g.subOrder[winnerIdx]
				g.scores[g.roundWinner]++
			}
			g.enterRoundResults()
		}
	}
}

func (g *CahGame) OnAction(playerID string, payload map[string]any) error {
	if g.finished {
		return nil
	}

	action, _ := payload["action"].(string)

	switch g.phase {
	case "answering":
		if action == "submit" {
			// Player submits their answer
			if playerID == g.judge {
				return nil // Judge doesn't submit
			}

			// Check if already submitted
			if _, ok := g.submissions[playerID]; ok {
				return nil // Already submitted, ignore resubmit
			}

			// Parse card indices
			cardsRaw, ok := payload["cards"].([]any)
			if !ok {
				return nil
			}

			seen := make(map[int]bool)
			indices := make([]int, 0, len(cardsRaw))
			for _, c := range cardsRaw {
				num, ok := c.(float64)
				if !ok {
					return nil // Malformed index
				}
				idx := int(num)
				if idx < 0 || idx >= len(g.hands[playerID]) {
					return nil // Out of range
				}
				if seen[idx] {
					return nil // Duplicate
				}
				seen[idx] = true
				indices = append(indices, idx)
			}

			if len(seen) != g.blackCard.Pick {
				return nil // Wrong count
			}

			// Resolve the played card texts NOW (indices die with the hand
			// mutation below), record the submission, and discard from hand.
			played := make([]string, 0, g.blackCard.Pick)
			newHand := make([]string, 0, len(g.hands[playerID]))
			for _, idx := range indices {
				played = append(played, g.hands[playerID][idx])
			}
			for i, card := range g.hands[playerID] {
				if !seen[i] {
					newHand = append(newHand, card)
				} else {
					g.whiteDiscard = append(g.whiteDiscard, card)
				}
			}
			g.submissions[playerID] = played
			g.hands[playerID] = newHand

			// Check if everyone has submitted
			if g.checkAllSubmitted() {
				g.enterJudging()
			}
		}

	case "judging":
		if action == "pick_winner" {
			if playerID != g.judge {
				return nil
			}

			// Judge picks a winner
			idx, ok := payload["index"].(float64)
			if !ok {
				return nil
			}
			winnerIdx := int(idx)

			if winnerIdx < 0 || winnerIdx >= len(g.shuffledSubs) {
				return nil
			}

			g.roundWinner = g.subOrder[winnerIdx]
			g.scores[g.roundWinner]++

			g.enterRoundResults()
		}
	}

	return nil
}

func (g *CahGame) OnTimer(name string) {
	if g.finished || name != g.deadlineName {
		return
	}

	switch g.phase {
	case "answering":
		// If no submissions at all, skip to next round
		if len(g.submissions) == 0 {
			g.round++
			g.rotateJudge()
			g.startRound()
		} else {
			g.enterJudging()
		}

	case "judging":
		// Auto-pick random winner
		if len(g.shuffledSubs) > 0 {
			winnerIdx := rand.Intn(len(g.shuffledSubs))
			g.roundWinner = g.subOrder[winnerIdx]
			g.scores[g.roundWinner]++
		}
		g.enterRoundResults()

	case "roundResults":
		// Move to next round
		g.round++
		if g.round > g.totalRounds {
			g.finished = true
		} else {
			g.rotateJudge()
			g.startRound()
		}
	}
}

func (g *CahGame) NextDeadline() (string, time.Time, bool) {
	if g.finished {
		return "", time.Time{}, false
	}
	return g.deadlineName, g.deadline, true
}

func (g *CahGame) Status() Status {
	if g.finished {
		return StatusFinished
	}
	return StatusRunning
}

func (g *CahGame) Standings() []Standing {
	return standings(g.scores, g.room)
}

func (g *CahGame) PublicState() map[string]any {
	state := map[string]any{
		"phase":       g.phase,
		"round":       g.round,
		"totalRounds": g.totalRounds,
		"judge":       g.judge,
		"blackCard": map[string]any{
			"text": g.blackCard.Text,
			"pick": g.blackCard.Pick,
		},
		"wins":     g.scores,
		"deadline": g.deadline.UnixMilli(),
	}

	if g.phase == "answering" {
		// Count who has submitted
		submittedList := make([]string, 0)
		for playerID := range g.submissions {
			submittedList = append(submittedList, playerID)
		}
		state["submittedCount"] = len(submittedList)
		state["submitted"] = submittedList
	}

	if g.phase == "judging" {
		// Show anonymized submissions
		state["submissions"] = g.shuffledSubs
	}

	if g.phase == "roundResults" {
		// Show reveal with player IDs
		reveal := make([]map[string]any, len(g.subOrder))
		for i, playerID := range g.subOrder {
			reveal[i] = map[string]any{
				"playerId": playerID,
				"cards":    g.shuffledSubs[i],
				"winner":   playerID == g.roundWinner,
			}
		}
		state["reveal"] = reveal
		state["winner"] = g.roundWinner
	}

	return state
}

func (g *CahGame) PrivateState(playerID string) map[string]any {
	state := map[string]any{
		"hand":      g.hands[playerID],
		"submitted": false,
		"isJudge":   playerID == g.judge,
	}

	if _, ok := g.submissions[playerID]; ok {
		state["submitted"] = true
	}

	return state
}

func (g *CahGame) Shift(delta time.Duration) {
	g.deadline = g.deadline.Add(delta)
}

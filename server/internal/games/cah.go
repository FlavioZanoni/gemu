package games

import (
	"errors"
	"math/rand"
	"strings"
	"time"
)

const (
	CahTotalRounds   = 8
	CahHandSize      = 5
	CahAnswerSeconds = 75
	CahJudgeSeconds  = 60
	CahResultSeconds = 8

	// cahWhiteMarginPerPlayer is how many cards beyond a full hand each
	// player needs in the pool: one round of plays (pick ≤ 2) sits on the
	// table while hands are refilled, so a pool smaller than this would
	// deal short hands even with discard recycling.
	cahWhiteMarginPerPlayer = 3
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
	blackDeck    []cahBlackCard
	blackDiscard []cahBlackCard
	whiteDeck    []string
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
	g.round = 1
	g.totalRounds = SettingInt(opts.Settings, "rounds", CahTotalRounds, 3, 20)
	g.finished = false
	g.scores = make(map[string]int)
	g.hands = make(map[string][]string)
	g.submissions = make(map[string][]string)
	g.whiteDiscard = make([]string, 0)
	g.blackDiscard = nil

	g.buildPiles(opts.Decks)
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

	for _, playerID := range g.connectedPlayers() {
		g.scores[playerID] = 0
	}

	g.startRound()
}

// buildPiles merges the selected decks into de-duplicated draw piles and tops
// them up from the locale's base deck when the selection is too small for
// this table: a 16-player room needs 16×5 white cards in hands plus a round
// of plays on the table, and a short prompt pile would repeat every round.
func (g *CahGame) buildPiles(decks []Deck) {
	players := len(g.connectedPlayers())
	if players < 3 {
		players = 3
	}
	needWhite := players * (CahHandSize + cahWhiteMarginPerPlayer)
	needBlack := g.totalRounds

	black, white := MergeDecks(decks)
	base, hasBase := BuiltinDeck(DefaultDeckID(g.locale))
	if hasBase {
		if len(dedupeWhite(white)) < needWhite {
			white = append(white, base.White...)
		}
		if len(dedupeBlack(black)) < needBlack {
			black = append(black, base.Black...)
		}
	}
	g.blackDeck = dedupeBlack(black)
	g.whiteDeck = dedupeWhite(white)
	// Anything still short is covered by recycling discards in the draws.
}

func dedupeWhite(cards []string) []string {
	seen := make(map[string]bool, len(cards))
	out := make([]string, 0, len(cards))
	for _, c := range cards {
		key := strings.ToLower(strings.TrimSpace(c))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, c)
	}
	return out
}

func dedupeBlack(cards []cahBlackCard) []cahBlackCard {
	seen := make(map[string]bool, len(cards))
	out := make([]cahBlackCard, 0, len(cards))
	for _, c := range cards {
		key := strings.ToLower(strings.TrimSpace(c.Text))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, c)
	}
	return out
}

func (g *CahGame) connectedPlayers() []string {
	if g.room == nil {
		return []string{}
	}
	return g.room.ConnectedPlayerIDs()
}

func (g *CahGame) isConnected(playerID string) bool {
	for _, id := range g.connectedPlayers() {
		if id == playerID {
			return true
		}
	}
	return false
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
	// Recycle used prompts when the pile runs dry, so a small deck (or a high
	// round count) can't index past the end and panic.
	if len(g.blackDeck) == 0 {
		g.blackDeck = g.blackDiscard
		g.blackDiscard = nil
		rand.Shuffle(len(g.blackDeck), func(i, j int) {
			g.blackDeck[i], g.blackDeck[j] = g.blackDeck[j], g.blackDeck[i]
		})
	}
	if len(g.blackDeck) == 0 {
		// Only reachable with no decks at all (unit tests without a room).
		return cahBlackCard{Text: "____", Pick: 1}
	}
	card := g.blackDeck[0]
	g.blackDeck = g.blackDeck[1:]
	g.blackDiscard = append(g.blackDiscard, card)
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

// refillHand tops a player's hand up to CahHandSize.
func (g *CahGame) refillHand(playerID string) {
	if needed := CahHandSize - len(g.hands[playerID]); needed > 0 {
		g.hands[playerID] = append(g.hands[playerID], g.drawWhiteCards(needed)...)
	}
}

func (g *CahGame) startRound() {
	if g.round > g.totalRounds {
		g.finished = true
		return
	}

	// Last round's plays go to the discard pile before anyone draws, so the
	// recycled pile is as large as possible.
	for _, cards := range g.submissions {
		g.whiteDiscard = append(g.whiteDiscard, cards...)
	}
	g.submissions = make(map[string][]string)
	g.shuffledSubs = nil
	g.subOrder = nil
	g.roundWinner = ""

	g.blackCard = g.drawBlackCard()

	for _, playerID := range g.connectedPlayers() {
		g.refillHand(playerID)
	}

	g.phase = "answering"
	g.deadline = time.Now().Add(time.Duration(CahAnswerSeconds) * time.Second)
	g.deadlineName = "answers"
}

// nextRound advances past the current round (rotating the judge) or ends the
// game after the last one.
func (g *CahGame) nextRound() {
	g.round++
	if g.round > g.totalRounds {
		g.finished = true
		return
	}
	g.rotateJudge()
	g.startRound()
}

// canSubmit reports whether a player is expected to answer this round: a
// connected non-judge holding enough cards for the prompt. Short-handed
// players (an exhausted pile) are skipped rather than waited on.
func (g *CahGame) canSubmit(playerID string) bool {
	if playerID == g.judge {
		return false
	}
	return len(g.hands[playerID]) >= g.blackCard.Pick
}

// expectedSubmitters lists the connected players this round waits on
// (including those who already submitted).
func (g *CahGame) expectedSubmitters() []string {
	out := make([]string, 0)
	for _, playerID := range g.connectedPlayers() {
		if playerID == g.judge {
			continue
		}
		if _, ok := g.submissions[playerID]; ok || g.canSubmit(playerID) {
			out = append(out, playerID)
		}
	}
	return out
}

// checkAllSubmitted is true once at least one card is in and every expected
// submitter has played. With nobody able to play, the answer timer decides.
func (g *CahGame) checkAllSubmitted() bool {
	if len(g.submissions) == 0 {
		return false
	}
	for _, playerID := range g.expectedSubmitters() {
		if _, ok := g.submissions[playerID]; !ok {
			return false
		}
	}
	return true
}

// returnSubmissionToHand undoes a player's play this round (used when they're
// promoted to judge mid-round), so they don't end up short-handed.
func (g *CahGame) returnSubmissionToHand(playerID string) {
	if cards, ok := g.submissions[playerID]; ok {
		g.hands[playerID] = append(g.hands[playerID], cards...)
		delete(g.submissions, playerID)
	}
}

func (g *CahGame) enterJudging() {
	// The judge must never have their own card in the pool they're judging.
	g.returnSubmissionToHand(g.judge)

	connected := make(map[string]bool)
	for _, id := range g.connectedPlayers() {
		connected[id] = true
	}

	type sub struct {
		playerID string
		cards    []string
	}
	list := make([]sub, 0, len(g.submissions))
	for playerID, cards := range g.submissions {
		if connected[playerID] {
			list = append(list, sub{playerID, cards})
		}
	}
	rand.Shuffle(len(list), func(i, j int) { list[i], list[j] = list[j], list[i] })

	g.shuffledSubs = make([][]string, 0, len(list))
	g.subOrder = make([]string, 0, len(list))
	for _, s := range list {
		g.shuffledSubs = append(g.shuffledSubs, s.cards)
		g.subOrder = append(g.subOrder, s.playerID)
	}

	if len(g.shuffledSubs) == 0 {
		// Every card on the table belonged to someone who dropped: nothing
		// to judge, move on.
		g.nextRound()
		return
	}

	g.phase = "judging"
	g.deadline = time.Now().Add(time.Duration(CahJudgeSeconds) * time.Second)
	g.deadlineName = "judge"

	// A judge who dropped during answering would leave the table frozen for
	// the whole judging timer: pick for them right away.
	if !connected[g.judge] {
		g.autoPickWinner()
	}
}

// autoPickWinner picks a random submission (judge timed out or left) and
// shows the round results.
func (g *CahGame) autoPickWinner() {
	if len(g.shuffledSubs) > 0 {
		g.awardWinner(rand.Intn(len(g.shuffledSubs)))
	}
	g.enterRoundResults()
}

func (g *CahGame) awardWinner(idx int) {
	g.roundWinner = g.subOrder[idx]
	g.scores[g.roundWinner]++
}

func (g *CahGame) enterRoundResults() {
	g.phase = "roundResults"
	g.deadline = time.Now().Add(time.Duration(CahResultSeconds) * time.Second)
	g.deadlineName = "next"
}

func (g *CahGame) rotateJudge() {
	connected := make(map[string]bool)
	for _, id := range g.connectedPlayers() {
		connected[id] = true
	}

	for attempts := 0; attempts < len(g.judgeOrder); attempts++ {
		g.judgeIdx = (g.judgeIdx + 1) % len(g.judgeOrder)
		if connected[g.judgeOrder[g.judgeIdx]] {
			g.judge = g.judgeOrder[g.judgeIdx]
			return
		}
	}

	// Nobody in the rotation is connected: pick any connected player.
	for _, id := range g.connectedPlayers() {
		g.judge = id
		return
	}
}

// OnPlayerJoin deals a newcomer in: they join the judge rotation and get a
// hand right away, so they can answer the current prompt if it's still open.
func (g *CahGame) OnPlayerJoin(playerID string) {
	if g.finished {
		return
	}
	inOrder := false
	for _, id := range g.judgeOrder {
		if id == playerID {
			inOrder = true
			break
		}
	}
	if !inOrder {
		g.judgeOrder = append(g.judgeOrder, playerID)
	}
	if _, ok := g.scores[playerID]; !ok {
		g.scores[playerID] = 0
	}
	g.refillHand(playerID)
}

func (g *CahGame) OnPlayerLeave(playerID string) {
	if g.finished {
		return
	}

	// Their hand goes back into circulation instead of vanishing.
	g.whiteDiscard = append(g.whiteDiscard, g.hands[playerID]...)
	delete(g.hands, playerID)

	switch g.phase {
	case "answering":
		if cards, ok := g.submissions[playerID]; ok {
			g.whiteDiscard = append(g.whiteDiscard, cards...)
			delete(g.submissions, playerID)
		}
		if playerID == g.judge {
			g.rotateJudge()
			// The new judge may already have played as a regular player;
			// take that card back so it can't land in their own pool.
			g.returnSubmissionToHand(g.judge)
		}
		if g.checkAllSubmitted() {
			g.enterJudging()
		}
	case "judging":
		// Handing the role to someone else mid-judging would let them pick
		// their own card: the table picks at random instead (as on a judge
		// disconnect). Their own submission stays in the pool.
		if playerID == g.judge {
			g.autoPickWinner()
		}
	}
}

func (g *CahGame) OnRoomChange() {
	if g.finished {
		return
	}

	switch g.phase {
	case "answering":
		// A disconnect can complete the "everyone submitted" gate; the judge
		// being gone is handled when judging starts.
		if g.checkAllSubmitted() {
			g.enterJudging()
		}
	case "judging":
		if !g.isConnected(g.judge) {
			g.autoPickWinner()
		}
	}
}

func (g *CahGame) OnAction(playerID string, payload map[string]any) error {
	if g.finished {
		return errors.New("game finished")
	}

	action, _ := payload["action"].(string)
	switch action {
	case "submit":
		return g.submit(playerID, payload)
	case "pick_winner":
		return g.pickWinner(playerID, payload)
	default:
		return errors.New("unknown action")
	}
}

func (g *CahGame) submit(playerID string, payload map[string]any) error {
	if g.phase != "answering" {
		return errors.New("not answering")
	}
	if playerID == g.judge {
		return errors.New("judge doesn't submit")
	}
	if _, ok := g.submissions[playerID]; ok {
		return errors.New("already submitted")
	}

	cardsRaw, ok := payload["cards"].([]any)
	if !ok {
		return errors.New("missing cards")
	}
	hand := g.hands[playerID]
	seen := make(map[int]bool)
	indices := make([]int, 0, len(cardsRaw))
	for _, c := range cardsRaw {
		num, ok := c.(float64)
		if !ok {
			return errors.New("malformed card index")
		}
		idx := int(num)
		if float64(idx) != num || idx < 0 || idx >= len(hand) {
			return errors.New("card index out of range")
		}
		if seen[idx] {
			return errors.New("duplicate card")
		}
		seen[idx] = true
		indices = append(indices, idx)
	}
	if len(indices) != g.blackCard.Pick {
		return errors.New("wrong card count")
	}

	// Resolve the played texts now (indices die with the hand mutation). The
	// played cards go to the discard pile when the next round starts.
	played := make([]string, 0, len(indices))
	for _, idx := range indices {
		played = append(played, hand[idx])
	}
	newHand := make([]string, 0, len(hand))
	for i, card := range hand {
		if !seen[i] {
			newHand = append(newHand, card)
		}
	}
	g.submissions[playerID] = played
	g.hands[playerID] = newHand

	if g.checkAllSubmitted() {
		g.enterJudging()
	}
	return nil
}

func (g *CahGame) pickWinner(playerID string, payload map[string]any) error {
	if g.phase != "judging" {
		return errors.New("not judging")
	}
	if playerID != g.judge {
		return errors.New("only the judge picks")
	}
	idx, ok := payload["index"].(float64)
	if !ok {
		return errors.New("missing index")
	}
	winnerIdx := int(idx)
	if float64(winnerIdx) != idx || winnerIdx < 0 || winnerIdx >= len(g.shuffledSubs) {
		return errors.New("index out of range")
	}
	if g.subOrder[winnerIdx] == playerID {
		return errors.New("judge can't pick their own card")
	}
	g.awardWinner(winnerIdx)
	g.enterRoundResults()
	return nil
}

func (g *CahGame) OnTimer(name string) {
	if g.finished || name != g.deadlineName {
		return
	}

	switch g.phase {
	case "answering":
		if len(g.submissions) == 0 {
			g.nextRound()
		} else {
			g.enterJudging()
		}
	case "judging":
		g.autoPickWinner()
	case "roundResults":
		g.nextRound()
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

	switch g.phase {
	case "answering":
		submittedList := make([]string, 0, len(g.submissions))
		for playerID := range g.submissions {
			submittedList = append(submittedList, playerID)
		}
		state["submittedCount"] = len(submittedList)
		state["submitted"] = submittedList
		// Who the round is waiting on (connected, non-judge, able to play),
		// so clients don't have to guess from the player list.
		state["expectedCount"] = len(g.expectedSubmitters())
	case "judging":
		state["submissions"] = g.shuffledSubs
		state["submittedCount"] = len(g.shuffledSubs)
	case "roundResults":
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
	if cards, ok := g.submissions[playerID]; ok {
		state["submitted"] = true
		state["played"] = cards
	}
	return state
}

func (g *CahGame) Shift(delta time.Duration) {
	g.deadline = g.deadline.Add(delta)
}

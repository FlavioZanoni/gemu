package games

import (
	"errors"
	"hash/fnv"
	"math/rand"
	"strings"
	"time"
)

var fallbackProblems = []string{
	"Invent something for a silly situation.",
	"Invent something for a weird problem.",
	"Invent a contraption for an absurd everyday struggle.",
	"Invent a device for a ridiculous inconvenience.",
	"Invent a gadget for a bizarre predicament.",
	"Invent a solution for a comically bad day.",
	"Invent a machine for a strange habit.",
	"Invent a tool for an unlikely emergency.",
	"Invent a product for a peculiar annoyance.",
	"Invent an apparatus for a silly fear.",
	"Invent something for a confusing social situation.",
	"Invent a vehicle for a preposterous commute.",
	"Invent a contraption for an itchy situation you can't scratch.",
	"Invent a robot for a completely unnecessary task.",
	"Invent a service for a problem nobody asked to solve.",
	"Invent an appliance for a ridiculous kitchen disaster.",
	"Invent something for when your clothes betray you.",
	"Invent a system for a hopelessly tangled mess.",
	"Invent a cure for a fake ailment.",
	"Invent a structure for an imaginary animal.",
}

const (
	DefaultTotalRounds = 3
	FundingPerPlayer   = 1000

	inventionProblemsPerPlayer = 2
	inventionProblemMaxRunes   = 140
	inventionTitleMaxRunes     = 80
	inventionTaglineMaxRunes   = 140
)

// Generous per-phase timers: Patently Silly is mostly gated on "everyone
// connected is done", but a timer guarantees no phase can stall forever
// (an AFK player, a host who walked away). Vars so tests can shrink them.
var (
	InventionCollectSeconds = 90
	InventionDrawSeconds    = 180
	InventionPitchSeconds   = 45
	InventionVoteSeconds    = 60
	InventionResultsSeconds = 20
)

// inventionReactions is the allowlist of pitch reactions (design: 💰 🗑 🚀).
var inventionReactions = map[string]bool{"fund": true, "trash": true, "rocket": true}

var errUnknownAction = errors.New("unknown action")

type InventionGame struct {
	room        RoomInfo
	phase       string
	round       int
	totalRounds int

	problems    map[string][]string
	assignments map[string]string
	chosen      map[string]string
	drawings    map[string]InventionDrawing

	votes   map[string]map[string]int
	funding map[string]int

	totalFunding map[string]int

	presenters []string
	presentIdx int
	// reactions[presenterID][playerID][kind] — one of each kind per player
	// per pitch.
	reactions map[string]map[string]map[string]bool

	deadline     time.Time
	deadlineName string
}

type InventionDrawing struct {
	Problem string `json:"problem"`
	Title   string `json:"title"`
	Tagline string `json:"tagline"`
	DataURL string `json:"dataURL"`
}

func NewInventionFactory() Factory {
	return Factory{
		Type: "invention",
		Name: "Patently Silly",
		New: func() Adapter {
			return &InventionGame{}
		},
	}
}

func (g *InventionGame) Start(roomID string, opts Options) {
	g.room = opts.Room
	g.round = 1
	g.totalRounds = SettingInt(opts.Settings, "rounds", DefaultTotalRounds, 1, 5)
	g.totalFunding = make(map[string]int)
	g.resetRound()
}

// resetRound clears per-round state and opens the collecting phase.
func (g *InventionGame) resetRound() {
	g.problems = make(map[string][]string)
	g.assignments = make(map[string]string)
	g.chosen = make(map[string]string)
	g.drawings = make(map[string]InventionDrawing)
	g.votes = make(map[string]map[string]int)
	g.funding = make(map[string]int)
	g.presenters = []string{}
	g.presentIdx = 0
	g.reactions = make(map[string]map[string]map[string]bool)
	g.setPhase("collecting")
}

// setPhase switches phase and arms that phase's timer.
func (g *InventionGame) setPhase(phase string) {
	g.phase = phase
	seconds := 0
	switch phase {
	case "collecting":
		seconds = InventionCollectSeconds
	case "drawing":
		seconds = InventionDrawSeconds
	case "presenting":
		seconds = InventionPitchSeconds
	case "voting":
		seconds = InventionVoteSeconds
	case "results":
		seconds = InventionResultsSeconds
	}
	if seconds == 0 {
		g.deadline = time.Time{}
		g.deadlineName = ""
		return
	}
	g.deadline = time.Now().Add(time.Duration(seconds) * time.Second)
	g.deadlineName = phase
}

// OnPlayerJoin: a mid-game joiner needs nothing up front — during drawing
// they are dealt a fallback problem lazily (problemFor) and the gates never
// wait on them; collecting/voting simply count them as a connected player.
func (g *InventionGame) OnPlayerJoin(playerID string) {
	g.checkAdvance()
}

func (g *InventionGame) OnPlayerLeave(playerID string) {
	delete(g.problems, playerID)
	delete(g.assignments, playerID)
	delete(g.chosen, playerID)
	delete(g.drawings, playerID)
	delete(g.votes, playerID)
	delete(g.reactions, playerID)
	for _, byPlayer := range g.reactions {
		delete(byPlayer, playerID)
	}
	next := make([]string, 0, len(g.presenters))
	for i, id := range g.presenters {
		if id == playerID {
			// An earlier presenter leaving shifts everyone after them down
			// one slot; follow the current presenter instead of skipping.
			if i < g.presentIdx {
				g.presentIdx--
			} else if i == g.presentIdx && g.phase == "presenting" {
				// Whoever slides into this slot gets a fresh pitch clock.
				g.setPhase("presenting")
			}
			continue
		}
		next = append(next, id)
	}
	g.presenters = next
	if g.presentIdx > len(g.presenters) {
		g.presentIdx = len(g.presenters)
	}
	g.checkAdvance()
}

func (g *InventionGame) OnRoomChange() {
	g.checkAdvance()
}

func (g *InventionGame) OnTimer(name string) {
	if name == "" || name != g.deadlineName || name != g.phase {
		return
	}
	switch g.phase {
	case "collecting":
		g.forceAssign()
	case "drawing":
		g.forcePresenting()
	case "presenting":
		g.nextPresenter()
	case "voting":
		g.finalizeFunding()
	case "results":
		g.startNextRound()
	}
	g.checkAdvance()
	// A phase that could not move (e.g. collecting with nobody connected to
	// deal problems to) must not leave its deadline in the past: the hub
	// would re-fire OnTimer immediately, forever. Re-arm the phase's timer
	// so an empty room idles at one tick per phase length instead.
	if g.deadlineName != "" && !g.deadline.After(time.Now()) {
		g.setPhase(g.phase)
	}
}

func (g *InventionGame) NextDeadline() (string, time.Time, bool) {
	if g.deadlineName == "" || g.phase == "finalResults" {
		return "", time.Time{}, false
	}
	return g.deadlineName, g.deadline, true
}

func (g *InventionGame) Shift(delta time.Duration) {
	if !g.deadline.IsZero() {
		g.deadline = g.deadline.Add(delta)
	}
}

func (g *InventionGame) Status() Status {
	if g.phase == "finalResults" {
		return StatusFinished
	}
	return StatusRunning
}

func (g *InventionGame) Standings() []Standing {
	return standings(g.totalFunding, g.room)
}

func (g *InventionGame) connected() []string {
	if g.room == nil {
		return nil
	}
	return g.room.ConnectedPlayerIDs()
}

func (g *InventionGame) isConnected(playerID string) bool {
	if g.room == nil {
		return true
	}
	for _, id := range g.connected() {
		if id == playerID {
			return true
		}
	}
	return false
}

func (g *InventionGame) isAdmin(playerID string) bool {
	return g.room != nil && g.room.IsAdmin(playerID)
}

// progress reports, for the current phase, how many of the players the gate
// is waiting on are done and how many it waits on. Only CONNECTED players
// count: a disconnected player's submission neither fills a slot nor is
// waited for.
func (g *InventionGame) progress() (done, needed int) {
	for _, id := range g.connected() {
		switch g.phase {
		case "collecting":
			needed++
			if len(g.problems[id]) >= inventionProblemsPerPlayer {
				done++
			}
		case "drawing":
			// Only players dealt a problem at assignment time are waited
			// for; late joiners may still draw but never hold the room up.
			if _, ok := g.assignments[id]; !ok {
				continue
			}
			needed++
			if _, ok := g.drawings[id]; ok {
				done++
			}
		case "voting":
			// Nobody to fund (e.g. the only drawing is your own) means
			// nothing to wait for.
			if !g.hasFundable(id) {
				continue
			}
			needed++
			if _, ok := g.votes[id]; ok {
				done++
			}
		}
	}
	return done, needed
}

func (g *InventionGame) hasFundable(playerID string) bool {
	for id := range g.drawings {
		if id != playerID {
			return true
		}
	}
	return false
}

// checkAdvance moves the game forward whenever the current phase's completion
// condition is met among connected players.
func (g *InventionGame) checkAdvance() {
	if g.room == nil {
		return
	}
	connected := g.connected()
	if len(connected) == 0 {
		return
	}
	switch g.phase {
	case "collecting":
		// Needs a real table: a lone player racing ahead while everyone
		// else reconnects would be silly. The timer/admin cover that case.
		if done, needed := g.progress(); len(connected) >= 2 && done >= needed {
			g.forceAssign()
		}
	case "drawing":
		if done, needed := g.progress(); needed > 0 && done >= needed {
			g.forcePresenting()
		}
	case "presenting":
		g.skipDisconnectedPresenters()
	case "voting":
		if done, needed := g.progress(); done >= needed {
			g.finalizeFunding()
		}
	}
}

// skipDisconnectedPresenters advances past presenters who aren't here to
// pitch (they can't press "next"), ending in voting when none are left.
func (g *InventionGame) skipDisconnectedPresenters() {
	if g.phase != "presenting" {
		return
	}
	skipped := false
	for g.presentIdx < len(g.presenters) && !g.isConnected(g.presenters[g.presentIdx]) {
		g.presentIdx++
		skipped = true
	}
	if g.presentIdx >= len(g.presenters) {
		g.setPhase("voting")
		g.checkAdvance()
		return
	}
	if skipped {
		g.setPhase("presenting")
	}
}

func (g *InventionGame) nextPresenter() {
	g.presentIdx++
	if g.presentIdx >= len(g.presenters) {
		g.setPhase("voting")
		return
	}
	g.setPhase("presenting")
}

func (g *InventionGame) actionName(payload map[string]any) string {
	if action, ok := payload["action"].(string); ok && action != "" {
		return action
	}
	// Legacy keyless shapes.
	if _, ok := payload["problems"]; ok {
		return "submit_problems"
	}
	if _, ok := payload["problem"]; ok {
		return "submit_problems"
	}
	if _, ok := payload["funding"]; ok {
		return "fund"
	}
	return ""
}

// OnAction routes a player action. Unknown actions are an error; known
// actions sent in the wrong phase (stale clicks racing a phase change) are
// silently ignored.
func (g *InventionGame) OnAction(playerID string, payload map[string]any) error {
	action := g.actionName(payload)
	switch action {
	case "advance", "submit_problems", "submit_drawing", "next", "react", "fund", "next_round":
	default:
		return errUnknownAction
	}
	defer g.checkAdvance()

	if action == "advance" {
		if g.isAdmin(playerID) && g.advanceIsCurrent(payload) {
			g.adminAdvance()
		}
		return nil
	}

	switch g.phase {
	case "collecting":
		if action == "submit_problems" {
			g.addProblems(playerID, payload)
		}
	case "drawing":
		if action == "submit_drawing" {
			return g.submitDrawing(playerID, payload)
		}
	case "presenting":
		switch action {
		case "next":
			// The presenter ends their own pitch; the host can move it along
			// too (presenter AFK, chatty presenter). Bound to the pitch it was
			// pressed on: a double tap, or a tap racing the pitch timer, must
			// not skip the NEXT presenter's pitch too.
			if g.presentIdx < len(g.presenters) &&
				(g.presenters[g.presentIdx] == playerID || g.isAdmin(playerID)) &&
				payloadMatchesInt(payload, "presentIndex", g.presentIdx) &&
				payloadMatchesString(payload, "presenter", g.presenters[g.presentIdx]) {
				g.nextPresenter()
			}
		case "react":
			g.react(playerID, payload)
		}
	case "voting":
		if action == "fund" {
			return g.fund(playerID, payload)
		}
	case "results":
		if action == "next_round" && g.isAdmin(playerID) {
			g.startNextRound()
		}
	}
	return nil
}

// advanceIsCurrent reports whether a host "advance" was pressed for the
// phase (and round) the game is in now. The client tags it with both; a
// stale one — a double tap, or a tap racing a timer/gate auto-advance —
// would otherwise force the NEXT phase forward too (and could end the game).
// Untagged legacy payloads are still honoured.
func (g *InventionGame) advanceIsCurrent(payload map[string]any) bool {
	return payloadMatchesString(payload, "phase", g.phase) &&
		payloadMatchesInt(payload, "round", g.round)
}

// payloadMatchesString: an absent key matches; a present one must equal want.
func payloadMatchesString(payload map[string]any, key, want string) bool {
	raw, ok := payload[key]
	if !ok {
		return true
	}
	got, ok := raw.(string)
	return ok && got == want
}

// payloadMatchesInt: an absent key matches; a present one must equal want.
func payloadMatchesInt(payload map[string]any, key string, want int) bool {
	if _, ok := payload[key]; !ok {
		return true
	}
	return decodePayloadInt(payload, key) == want
}

// adminAdvance is the host's escape hatch: force the current phase forward
// regardless of who is still missing.
func (g *InventionGame) adminAdvance() {
	switch g.phase {
	case "collecting":
		g.forceAssign()
	case "drawing":
		g.forcePresenting()
	case "presenting":
		g.setPhase("voting")
	case "voting":
		g.finalizeFunding()
	case "results":
		g.startNextRound()
	}
}

func (g *InventionGame) addProblems(playerID string, payload map[string]any) {
	var items []any
	if arr, ok := payload["problems"].([]any); ok {
		items = arr
	} else if one, ok := payload["problem"]; ok {
		items = []any{one}
	}
	for _, item := range items {
		problem, ok := item.(string)
		if !ok {
			continue
		}
		problem = strings.TrimSpace(problem)
		if problem == "" {
			continue
		}
		current := g.problems[playerID]
		if len(current) >= inventionProblemsPerPlayer {
			break
		}
		g.problems[playerID] = append(current, TruncateText(problem, inventionProblemMaxRunes))
	}
}

func (g *InventionGame) submitDrawing(playerID string, payload map[string]any) error {
	title, _ := payload["title"].(string)
	tagline, _ := payload["tagline"].(string)
	dataURL, _ := payload["draw"].(string)
	title = strings.TrimSpace(title)
	tagline = strings.TrimSpace(tagline)
	if title == "" {
		return errors.New("missing title")
	}
	if !ValidImageDataURL(dataURL) {
		return errors.New("invalid drawing")
	}
	problem := g.problemFor(playerID)
	g.chosen[playerID] = problem
	g.drawings[playerID] = InventionDrawing{
		Problem: problem,
		Title:   TruncateText(title, inventionTitleMaxRunes),
		Tagline: TruncateText(tagline, inventionTaglineMaxRunes),
		DataURL: dataURL,
	}
	return nil
}

func (g *InventionGame) react(playerID string, payload map[string]any) {
	kind, _ := payload["kind"].(string)
	if !inventionReactions[kind] || g.presentIdx >= len(g.presenters) {
		return
	}
	presenter := g.presenters[g.presentIdx]
	if presenter == playerID {
		return
	}
	byPlayer := g.reactions[presenter]
	if byPlayer == nil {
		byPlayer = make(map[string]map[string]bool)
		g.reactions[presenter] = byPlayer
	}
	kinds := byPlayer[playerID]
	if kinds == nil {
		kinds = make(map[string]bool)
		byPlayer[playerID] = kinds
	}
	// Tapping again takes the reaction back.
	if kinds[kind] {
		delete(kinds, kind)
	} else {
		kinds[kind] = true
	}
}

func (g *InventionGame) fund(playerID string, payload map[string]any) error {
	allocations, ok := payload["funding"].(map[string]any)
	if !ok {
		return errors.New("invalid funding")
	}
	vote := make(map[string]int)
	total := 0
	for target, amount := range allocations {
		var amt int
		switch v := amount.(type) {
		case float64:
			// Range-check BEFORE converting: a huge float wraps on int().
			if v < 0 || v > FundingPerPlayer {
				return errors.New("invalid amount")
			}
			amt = int(v)
		case int:
			if v < 0 || v > FundingPerPlayer {
				return errors.New("invalid amount")
			}
			amt = v
		default:
			return errors.New("invalid amount")
		}
		if amt == 0 {
			continue
		}
		if _, ok := g.drawings[target]; !ok || target == playerID {
			// Self-funding, or an inventor who just left: drop that line,
			// keep the rest of the vote.
			continue
		}
		total += amt
		if total > FundingPerPlayer {
			return errors.New("over budget")
		}
		vote[target] = amt
	}
	// An empty allocation is a valid "I fund nobody" vote.
	g.votes[playerID] = vote
	return nil
}

func (g *InventionGame) currentReactions() map[string]int {
	counts := map[string]int{"fund": 0, "trash": 0, "rocket": 0}
	if g.phase != "presenting" || g.presentIdx >= len(g.presenters) {
		return counts
	}
	for _, kinds := range g.reactions[g.presenters[g.presentIdx]] {
		for kind := range kinds {
			counts[kind]++
		}
	}
	return counts
}

func (g *InventionGame) PublicState() map[string]any {
	submissions := make(map[string]InventionDrawing)
	switch g.phase {
	case "presenting":
		// Every pitch reaction rebroadcasts this state, so only the drawing
		// on stage travels; the others keep their card text (dataURL "")
		// until voting, when every drawing is needed at once.
		current := ""
		if g.presentIdx < len(g.presenters) {
			current = g.presenters[g.presentIdx]
		}
		for id, drawing := range g.drawings {
			if id != current {
				drawing.DataURL = ""
			}
			submissions[id] = drawing
		}
	case "voting", "results", "finalResults":
		for id, drawing := range g.drawings {
			submissions[id] = drawing
		}
	}
	done, needed := g.progress()
	state := map[string]any{
		"phase":             g.phase,
		"started":           true,
		"round":             g.round,
		"totalRounds":       g.totalRounds,
		"problemsSubmitted": g.countProblems(),
		"drawingsSubmitted": len(g.drawings),
		"doneCount":         done,
		"neededCount":       needed,
		"presenters":        g.presenters,
		"presentIndex":      g.presentIdx,
		"reactions":         g.currentReactions(),
		"funding":           g.funding,
		"totalFunding":      g.totalFunding,
		"voteCount":         done,
		"submissions":       submissions,
	}
	if g.phase == "presenting" && g.presentIdx < len(g.presenters) {
		state["presenter"] = g.presenters[g.presentIdx]
	}
	if _, at, ok := g.NextDeadline(); ok {
		state["deadline"] = at.UnixMilli()
	}
	return state
}

func (g *InventionGame) PrivateState(playerID string) map[string]any {
	state := map[string]any{
		"fundingBudget": FundingPerPlayer,
		"problemsDone":  len(g.problems[playerID]) >= inventionProblemsPerPlayer,
	}
	if g.phase == "drawing" {
		state["assigned"] = g.problemFor(playerID)
	} else if assigned := g.assignments[playerID]; assigned != "" {
		state["assigned"] = assigned
	}
	if chosen := g.chosen[playerID]; chosen != "" {
		state["chosen"] = chosen
	}
	// Only present once submitted — an empty object would read as "done".
	if drawing, ok := g.drawings[playerID]; ok {
		state["drawing"] = drawing
	}
	if _, ok := g.votes[playerID]; ok {
		state["voted"] = true
	}
	if g.phase == "presenting" && g.presentIdx < len(g.presenters) {
		mine := []string{}
		for kind := range g.reactions[g.presenters[g.presentIdx]][playerID] {
			mine = append(mine, kind)
		}
		state["myReactions"] = mine
	}
	return state
}

// problemFor is the problem a player draws for: their assignment, or — for
// a mid-game joiner / someone offline during assignment — a deterministic
// fallback (pure, so PrivateState can show it without mutating the game).
func (g *InventionGame) problemFor(playerID string) string {
	if p := g.assignments[playerID]; p != "" {
		return p
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(playerID))
	return fallbackProblems[(int(h.Sum32())+g.round)%len(fallbackProblems)]
}

// forceAssign deals problems to everyone connected and opens drawing.
func (g *InventionGame) forceAssign() {
	if g.phase != "collecting" {
		return
	}
	players := g.connected()
	if len(players) == 0 {
		return
	}
	g.startAssign(players)
}

// forcePresenting ends drawing; with zero drawings the round has nothing to
// present or fund, so it is skipped straight to results.
func (g *InventionGame) forcePresenting() {
	if g.phase != "drawing" {
		return
	}
	if err := g.advanceToPresenting(); err != nil {
		g.finalizeFunding()
	}
}

// startAssign deals each player one problem written by someone else, all
// distinct. Players that can't get a player-written problem (too few were
// submitted, or only their own remain) get distinct fallback problems.
func (g *InventionGame) startAssign(players []string) {
	if len(players) == 0 {
		return
	}
	type authored struct{ problem, author string }
	pool := make([]authored, 0)
	for author, problems := range g.problems {
		for _, problem := range problems {
			pool = append(pool, authored{problem, author})
		}
	}

	order := append([]string(nil), players...)
	var best map[string]string
	for attempt := 0; attempt < 64; attempt++ {
		rand.Shuffle(len(pool), func(i, j int) { pool[i], pool[j] = pool[j], pool[i] })
		rand.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })
		used := make([]bool, len(pool))
		got := make(map[string]string, len(order))
		for _, playerID := range order {
			for i, p := range pool {
				if !used[i] && p.author != playerID {
					used[i] = true
					got[playerID] = p.problem
					break
				}
			}
		}
		if best == nil || len(got) > len(best) {
			best = got
		}
		if len(best) == len(players) || len(best) == len(pool) {
			break
		}
	}

	fallbacks := append([]string(nil), fallbackProblems...)
	rand.Shuffle(len(fallbacks), func(i, j int) { fallbacks[i], fallbacks[j] = fallbacks[j], fallbacks[i] })
	g.assignments = make(map[string]string, len(players))
	next := 0
	for _, playerID := range players {
		if p, ok := best[playerID]; ok {
			g.assignments[playerID] = p
			continue
		}
		g.assignments[playerID] = fallbacks[next%len(fallbacks)]
		next++
	}
	g.presenters = []string{}
	g.presentIdx = 0
	g.setPhase("drawing")
}

func (g *InventionGame) advanceToPresenting() error {
	if g.phase != "drawing" {
		return errors.New("invalid phase")
	}
	if len(g.drawings) == 0 {
		return errors.New("no drawings")
	}
	g.presenters = make([]string, 0, len(g.drawings))
	for playerID := range g.drawings {
		g.presenters = append(g.presenters, playerID)
	}
	rand.Shuffle(len(g.presenters), func(i, j int) { g.presenters[i], g.presenters[j] = g.presenters[j], g.presenters[i] })
	g.presentIdx = 0
	g.reactions = make(map[string]map[string]map[string]bool)
	g.setPhase("presenting")
	g.skipDisconnectedPresenters()
	return nil
}

func (g *InventionGame) finalizeFunding() {
	funding := make(map[string]int)
	for _, vote := range g.votes {
		for target, amount := range vote {
			// Inventors who left take their drawing (and funding) with them.
			if _, ok := g.drawings[target]; ok {
				funding[target] += amount
			}
		}
	}
	g.funding = funding
	for id, amount := range funding {
		g.totalFunding[id] += amount
	}
	if g.round >= g.totalRounds {
		g.setPhase("finalResults")
	} else {
		g.setPhase("results")
	}
}

func (g *InventionGame) startNextRound() {
	if g.phase != "results" {
		return
	}
	g.round++
	g.resetRound()
}

func (g *InventionGame) countProblems() int {
	total := 0
	for _, problems := range g.problems {
		total += len(problems)
	}
	return total
}

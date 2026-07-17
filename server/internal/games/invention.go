package games

import (
	"errors"
	"math/rand"
	"sort"
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
)

type InventionGame struct {
	roomID      string
	room        RoomInfo
	phase       string
	started     bool
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
}

type InventionDrawing struct {
	Problem string
	Title   string
	Tagline string
	DataURL string
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

func (g *InventionGame) Type() string {
	return "invention"
}

func (g *InventionGame) Start(roomID string, opts Options) {
	g.roomID = roomID
	g.room = opts.Room
	g.phase = "collecting"
	g.started = true
	g.round = 1
	g.totalRounds = SettingInt(opts.Settings, "rounds", DefaultTotalRounds, 1, 5)
	g.problems = make(map[string][]string)
	g.assignments = make(map[string]string)
	g.chosen = make(map[string]string)
	g.drawings = make(map[string]InventionDrawing)
	g.votes = make(map[string]map[string]int)
	g.funding = make(map[string]int)
	g.totalFunding = make(map[string]int)
	g.presenters = []string{}
	g.presentIdx = 0
}

func (g *InventionGame) OnPlayerJoin(playerID string) {}

func (g *InventionGame) OnPlayerLeave(playerID string) {
	delete(g.problems, playerID)
	delete(g.assignments, playerID)
	delete(g.chosen, playerID)
	delete(g.drawings, playerID)
	delete(g.votes, playerID)
	nextPresenters := make([]string, 0, len(g.presenters))
	for _, id := range g.presenters {
		if id != playerID {
			nextPresenters = append(nextPresenters, id)
		}
	}
	g.presenters = nextPresenters
	if g.presentIdx >= len(g.presenters) {
		g.presentIdx = len(g.presenters)
	}
	g.checkAdvance()
}

func (g *InventionGame) OnRoomChange() {
	g.checkAdvance()
}

func (g *InventionGame) OnTimer(name string) {}

func (g *InventionGame) NextDeadline() (string, time.Time, bool) {
	return "", time.Time{}, false
}

func (g *InventionGame) Status() Status {
	if g.phase == "finalResults" {
		return StatusFinished
	}
	return StatusRunning
}

func (g *InventionGame) Standings() []Standing {
	seen := make(map[string]bool)
	standings := make([]Standing, 0, len(g.totalFunding))
	for id, amount := range g.totalFunding {
		standings = append(standings, Standing{PlayerID: id, Score: amount})
		seen[id] = true
	}
	if g.room != nil {
		for _, id := range g.room.ConnectedPlayerIDs() {
			if !seen[id] {
				standings = append(standings, Standing{PlayerID: id, Score: 0})
			}
		}
	}
	sort.SliceStable(standings, func(i, j int) bool { return standings[i].Score > standings[j].Score })
	return standings
}

// checkAdvance moves the game forward whenever the current phase's completion
// condition is met. Replaces the phase logic that used to live in the ws hub.
func (g *InventionGame) checkAdvance() {
	if g.room == nil {
		return
	}
	connected := g.room.ConnectedPlayerIDs()
	if len(connected) < 2 {
		return
	}
	switch g.phase {
	case "collecting":
		if g.countProblems() >= len(connected)*2 {
			g.startAssign(connected)
		}
	case "drawing":
		if len(g.drawings) >= len(connected) {
			_ = g.advanceToPresenting()
		}
	case "voting":
		if len(g.votes) >= len(connected) {
			g.finalizeFunding()
		}
	}
}

func (g *InventionGame) OnAction(playerID string, payload map[string]any) error {
	defer g.checkAdvance()
	switch g.phase {
	case "collecting":
		if p, ok := payload["problems"]; ok {
			arr, ok := p.([]any)
			if !ok {
				return nil
			}
			for _, item := range arr {
				problem, ok := item.(string)
				if !ok || problem == "" {
					continue
				}
				current := g.problems[playerID]
				if len(current) >= 2 {
					break
				}
				g.problems[playerID] = append(current, problem)
			}
			return nil
		}
		if payload["problem"] == nil {
			return nil
		}
		problem, ok := payload["problem"].(string)
		if !ok || problem == "" {
			return nil
		}
		current := g.problems[playerID]
		if len(current) >= 2 {
			return nil
		}
		g.problems[playerID] = append(current, problem)
		return nil

	case "drawing":
		action, _ := payload["action"].(string)
		switch action {
		case "submit_drawing":
			title, _ := payload["title"].(string)
			tagline, _ := payload["tagline"].(string)
			dataURL, _ := payload["draw"].(string)
			problem := g.assignments[playerID]
			if problem == "" || title == "" || dataURL == "" {
				return nil
			}
			g.chosen[playerID] = problem
			g.drawings[playerID] = InventionDrawing{
				Problem: problem,
				Title:   title,
				Tagline: tagline,
				DataURL: dataURL,
			}
			return nil
		default:
			return nil
		}

	case "presenting":
		if payload["action"] == "next" {
			if g.presentIdx < len(g.presenters) && g.presenters[g.presentIdx] != playerID {
				return nil
			}
			g.presentIdx++
			if g.presentIdx >= len(g.presenters) {
				g.phase = "voting"
			}
			return nil
		}
		if payload["action"] == "advance" {
			g.phase = "voting"
			return nil
		}
		return nil

	case "voting":
		allocations, ok := payload["funding"].(map[string]any)
		if !ok {
			return nil
		}
		vote := make(map[string]int)
		total := 0
		for target, amount := range allocations {
			if _, ok := g.drawings[target]; !ok || target == playerID {
				continue
			}
			var amt int
			switch v := amount.(type) {
			case float64:
				amt = int(v)
			case int:
				amt = v
			default:
				continue
			}
			if amt < 0 {
				continue
			}
			vote[target] = amt
			total += amt
		}
		if total > FundingPerPlayer {
			return nil
		}
		g.votes[playerID] = vote
		return nil

	case "results":
		if action, _ := payload["action"].(string); action == "next_round" {
			if g.room != nil && g.room.IsAdmin(playerID) {
				g.startNextRound()
			}
		}
		return nil

	default:
		return nil
	}
}

func (g *InventionGame) PublicState() map[string]any {
	submissions := make(map[string]InventionDrawing)
	if g.phase == "presenting" || g.phase == "voting" || g.phase == "results" || g.phase == "finalResults" {
		for id, drawing := range g.drawings {
			submissions[id] = drawing
		}
	}
	votedCount := 0
	if g.phase == "voting" {
		votedCount = len(g.votes)
	}
	return map[string]any{
		"phase":             g.phase,
		"started":           g.started,
		"round":             g.round,
		"totalRounds":       g.totalRounds,
		"problemsSubmitted": g.countProblems(),
		"drawingsSubmitted": len(g.drawings),
		"presenters":        g.presenters,
		"presentIndex":      g.presentIdx,
		"funding":           g.funding,
		"totalFunding":      g.totalFunding,
		"voteCount":         votedCount,
		"submissions":       submissions,
	}
}

func (g *InventionGame) PrivateState(playerID string) map[string]any {
	return map[string]any{
		"assigned":      g.assignments[playerID],
		"chosen":        g.chosen[playerID],
		"drawing":       g.drawings[playerID],
		"fundingBudget": FundingPerPlayer,
	}
}

func (g *InventionGame) startAssign(players []string) {
	if len(players) < 2 {
		return
	}
	pool := make([]string, 0)
	for _, problems := range g.problems {
		for _, problem := range problems {
			pool = append(pool, problem)
		}
	}
	if len(pool) == 0 {
		shuffled := make([]string, len(fallbackProblems))
		copy(shuffled, fallbackProblems)
		rand.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })
		needed := len(players)
		for len(shuffled) < needed {
			shuffled = append(shuffled, shuffled...)
		}
		pool = shuffled[:needed]
	}
	rand.Shuffle(len(pool), func(i, j int) { pool[i], pool[j] = pool[j], pool[i] })
	g.assignments = make(map[string]string)
	for _, playerID := range players {
		if len(pool) > 0 {
			g.assignments[playerID] = pool[0]
			pool = pool[1:]
		} else {
			g.assignments[playerID] = fallbackProblems[0]
		}
	}
	g.presenters = make([]string, 0, len(players))
	for _, id := range players {
		g.presenters = append(g.presenters, id)
	}
	g.presentIdx = 0
	g.phase = "drawing"
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
	g.phase = "presenting"
	g.presentIdx = 0
	rand.Shuffle(len(g.presenters), func(i, j int) { g.presenters[i], g.presenters[j] = g.presenters[j], g.presenters[i] })
	return nil
}

func (g *InventionGame) finalizeFunding() {
	funding := make(map[string]int)
	for _, vote := range g.votes {
		for target, amount := range vote {
			funding[target] += amount
		}
	}
	g.funding = funding
	for id, amount := range funding {
		g.totalFunding[id] += amount
	}
	if g.round >= g.totalRounds {
		g.phase = "finalResults"
	} else {
		g.phase = "results"
	}
}

func (g *InventionGame) startNextRound() {
	if g.phase != "results" {
		return
	}
	g.round++
	g.problems = make(map[string][]string)
	g.assignments = make(map[string]string)
	g.chosen = make(map[string]string)
	g.drawings = make(map[string]InventionDrawing)
	g.votes = make(map[string]map[string]int)
	g.funding = make(map[string]int)
	g.presenters = []string{}
	g.presentIdx = 0
	g.phase = "collecting"
}

func (g *InventionGame) countProblems() int {
	total := 0
	for _, problems := range g.problems {
		total += len(problems)
	}
	return total
}

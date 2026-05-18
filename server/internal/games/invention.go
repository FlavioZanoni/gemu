package games

import (
	"errors"
	"math/rand"
)

type InventionGame struct {
	roomID      string
	phase       string
	problems    map[string][]string
	chosen      map[string]string
	drawings    map[string]InventionDrawing
	votes       map[string]string
	funding     map[string]int
	presenters  []string
	presentIdx  int
	assignments map[string][]string
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

func (g *InventionGame) Init(roomID string) {
	g.roomID = roomID
	g.phase = "collecting"
	g.problems = make(map[string][]string)
	g.chosen = make(map[string]string)
	g.drawings = make(map[string]InventionDrawing)
	g.votes = make(map[string]string)
	g.funding = make(map[string]int)
	g.presenters = []string{}
	g.presentIdx = 0
	g.assignments = make(map[string][]string)
}

func (g *InventionGame) OnPlayerJoin(playerID string) {}

func (g *InventionGame) OnPlayerLeave(playerID string) {
	delete(g.problems, playerID)
	delete(g.chosen, playerID)
	delete(g.drawings, playerID)
	delete(g.votes, playerID)
	delete(g.funding, playerID)
	delete(g.assignments, playerID)
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
}

func (g *InventionGame) OnAction(playerID string, payload map[string]any) error {
	switch g.phase {
	case "collecting":
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
		case "choose_problem":
			choice, ok := payload["problem"].(string)
			if !ok || choice == "" {
				return nil
			}
			if options, ok := g.assignments[playerID]; ok {
				valid := false
				for _, option := range options {
					if option == choice {
						valid = true
						break
					}
				}
				if !valid {
					return nil
				}
			}
			g.chosen[playerID] = choice
			return nil
		case "submit_drawing":
			title, _ := payload["title"].(string)
			tagline, _ := payload["tagline"].(string)
			dataURL, _ := payload["draw"].(string)
			problem, ok := g.chosen[playerID]
			if !ok || title == "" || dataURL == "" {
				return nil
			}
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
		target, _ := payload["vote"].(string)
		if target == "" || target == playerID {
			return nil
		}
		if _, ok := g.drawings[target]; !ok {
			return nil
		}
		g.votes[playerID] = target
		return nil
	default:
		return nil
	}
}

func (g *InventionGame) PublicState() map[string]any {
	submissions := make(map[string]InventionDrawing)
	if g.phase == "presenting" || g.phase == "voting" || g.phase == "results" {
		for id, drawing := range g.drawings {
			submissions[id] = drawing
		}
	}
	return map[string]any{
		"phase":             g.phase,
		"problemsSubmitted": g.countProblems(),
		"drawingsSubmitted": len(g.drawings),
		"presenters":        g.presenters,
		"presentIndex":      g.presentIdx,
		"funding":           g.funding,
		"voteCount":         len(g.votes),
		"submissions":       submissions,
	}
}

func (g *InventionGame) PrivateState(playerID string) map[string]any {
	return map[string]any{
		"assigned": g.assignments[playerID],
		"chosen":   g.chosen[playerID],
		"drawing":  g.drawings[playerID],
	}
}

func (g *InventionGame) StartAssign(players []string) {
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
		for range players {
			pool = append(pool, "Invent something for a silly situation.")
		}
	}
	rand.Shuffle(len(pool), func(i, j int) {
		pool[i], pool[j] = pool[j], pool[i]
	})
	g.assignments = make(map[string][]string)
	for _, playerID := range players {
		if len(pool) >= 2 {
			g.assignments[playerID] = []string{pool[0], pool[1]}
			pool = append(pool[2:], pool[0], pool[1])
		} else if len(pool) == 1 {
			g.assignments[playerID] = []string{pool[0], pool[0]}
		} else {
			g.assignments[playerID] = []string{
				"Invent something for a silly situation.",
				"Invent something for a weird problem.",
			}
		}
	}
	g.presenters = make([]string, 0, len(players))
	for _, id := range players {
		g.presenters = append(g.presenters, id)
	}
	g.presentIdx = 0
	g.phase = "drawing"
}

func (g *InventionGame) AdvanceToPresenting() error {
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
	rand.Shuffle(len(g.presenters), func(i, j int) {
		g.presenters[i], g.presenters[j] = g.presenters[j], g.presenters[i]
	})
	return nil
}

func (g *InventionGame) FinalizeFunding() {
	funding := make(map[string]int)
	for _, target := range g.votes {
		funding[target]++
	}
	g.funding = funding
	g.phase = "results"
}

func (g *InventionGame) countProblems() int {
	total := 0
	for _, problems := range g.problems {
		total += len(problems)
	}
	return total
}

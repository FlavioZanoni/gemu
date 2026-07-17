package games

import (
	"fmt"
	"math/rand"
	"sort"
	"time"
)

const (
	GPPromptSeconds = 60
	GPDrawSeconds   = 120
	GPWriteSeconds  = 60
	GPPointsPerLike = 10
	gpAutofillText  = "…"
	gpMaxEntryChars = 200
)

type gpEntry struct {
	Author  string `json:"author"`
	Kind    string `json:"kind"` // "text" | "drawing"
	Text    string `json:"text,omitempty"`
	DataURL string `json:"dataUrl,omitempty"`
}

// GarticPhoneGame: everyone writes a prompt, then chains rotate through the
// players alternating draw-the-text / describe-the-drawing until every chain
// passed through everyone. The admin-paced reveal is the payoff; reactions
// during the reveal are the score.
type GarticPhoneGame struct {
	roomID string
	room   RoomInfo

	turnOrder []string       // roster snapshot at start; chains[i] starts with turnOrder[i]
	playerIdx map[string]int // playerID -> index in turnOrder
	chains    [][]gpEntry

	drawSeconds int
	step        int // 0 = prompt, then 1..len(turnOrder)-1
	totalSteps  int
	phase       string // "prompt" | "drawing" | "writing" | "reveal"
	pending     map[string]gpEntry
	deadline    time.Time
	deadlineTag string

	revealChain int
	revealPos   int             // entries revealed in the current chain
	reacted     map[string]bool // "player|chain|entry"
	likes       map[string]int  // "chain|entry"
	scores      map[string]int
	finished    bool
}

func NewGarticPhoneFactory() Factory {
	return Factory{
		Type:       "garticphone",
		Name:       "Gartic Phone",
		MinPlayers: 3,
		New: func() Adapter {
			return &GarticPhoneGame{}
		},
	}
}

func (g *GarticPhoneGame) Type() string {
	return "garticphone"
}

func (g *GarticPhoneGame) Start(roomID string, opts Options) {
	g.roomID = roomID
	g.room = opts.Room
	g.turnOrder = nil
	if g.room != nil {
		g.turnOrder = g.room.ConnectedPlayerIDs()
	}
	rand.Shuffle(len(g.turnOrder), func(i, j int) { g.turnOrder[i], g.turnOrder[j] = g.turnOrder[j], g.turnOrder[i] })
	g.playerIdx = make(map[string]int, len(g.turnOrder))
	for i, id := range g.turnOrder {
		g.playerIdx[id] = i
	}
	g.drawSeconds = SettingInt(opts.Settings, "drawSeconds", GPDrawSeconds, 30, 300)
	g.chains = make([][]gpEntry, len(g.turnOrder))
	g.totalSteps = len(g.turnOrder)
	g.step = 0
	g.pending = make(map[string]gpEntry)
	g.reacted = make(map[string]bool)
	g.likes = make(map[string]int)
	g.scores = make(map[string]int)
	for _, id := range g.turnOrder {
		g.scores[id] = 0
	}
	if g.totalSteps == 0 {
		g.finished = true
		return
	}
	g.phase = "prompt"
	g.deadline = time.Now().Add(GPPromptSeconds * time.Second)
	g.deadlineTag = "step"
}

// chainFor returns the chain index the player works on during the current step.
func (g *GarticPhoneGame) chainFor(playerID string) (int, bool) {
	idx, ok := g.playerIdx[playerID]
	if !ok {
		return 0, false
	}
	return (idx + g.step) % len(g.turnOrder), true
}

func (g *GarticPhoneGame) stepKind() string {
	if g.step == 0 || g.step%2 == 0 {
		return "text"
	}
	return "drawing"
}

func (g *GarticPhoneGame) allSubmitted() bool {
	if g.room == nil {
		return false
	}
	any := false
	for _, id := range g.room.ConnectedPlayerIDs() {
		if _, inRoster := g.playerIdx[id]; !inRoster {
			continue
		}
		any = true
		if _, ok := g.pending[id]; !ok {
			return false
		}
	}
	return any
}

// commitStep writes everyone's pending entry (autofilling absentees) and
// moves to the next step or the reveal.
func (g *GarticPhoneGame) commitStep() {
	kind := g.stepKind()
	for _, playerID := range g.turnOrder {
		chainIdx, _ := g.chainFor(playerID)
		entry, ok := g.pending[playerID]
		if !ok {
			entry = gpEntry{Author: playerID, Kind: kind}
			if kind == "text" {
				entry.Text = gpAutofillText
			}
		}
		g.chains[chainIdx] = append(g.chains[chainIdx], entry)
	}
	g.pending = make(map[string]gpEntry)
	g.step++
	if g.step >= g.totalSteps {
		g.phase = "reveal"
		g.revealChain = 0
		g.revealPos = 0
		return
	}
	if g.stepKind() == "drawing" {
		g.phase = "drawing"
		g.deadline = time.Now().Add(time.Duration(g.drawSeconds) * time.Second)
	} else {
		g.phase = "writing"
		g.deadline = time.Now().Add(GPWriteSeconds * time.Second)
	}
	g.deadlineTag = "step"
}

func (g *GarticPhoneGame) OnPlayerJoin(playerID string) {}

func (g *GarticPhoneGame) OnPlayerLeave(playerID string) {
	delete(g.pending, playerID)
	g.OnRoomChange()
}

func (g *GarticPhoneGame) OnRoomChange() {
	if g.finished || g.phase == "reveal" {
		return
	}
	if g.allSubmitted() {
		g.commitStep()
	}
}

func (g *GarticPhoneGame) OnTimer(name string) {
	if g.finished || name != "step" || g.phase == "reveal" {
		return
	}
	g.commitStep()
}

func (g *GarticPhoneGame) NextDeadline() (string, time.Time, bool) {
	if g.finished || g.phase == "reveal" {
		return "", time.Time{}, false
	}
	return g.deadlineTag, g.deadline, true
}

func (g *GarticPhoneGame) Status() Status {
	if g.finished {
		return StatusFinished
	}
	return StatusRunning
}

func (g *GarticPhoneGame) Standings() []Standing {
	standings := make([]Standing, 0, len(g.scores))
	for id, score := range g.scores {
		standings = append(standings, Standing{PlayerID: id, Score: score})
	}
	sort.SliceStable(standings, func(i, j int) bool { return standings[i].Score > standings[j].Score })
	return standings
}

func (g *GarticPhoneGame) OnAction(playerID string, payload map[string]any) error {
	if g.finished {
		return nil
	}
	action, _ := payload["action"].(string)

	switch g.phase {
	case "prompt", "writing":
		if action != "submit_prompt" && action != "submit_description" {
			return nil
		}
		if _, ok := g.chainFor(playerID); !ok {
			return nil
		}
		text, _ := payload["text"].(string)
		runes := []rune(text)
		if len(runes) > gpMaxEntryChars {
			runes = runes[:gpMaxEntryChars]
		}
		if len(runes) == 0 {
			return nil
		}
		g.pending[playerID] = gpEntry{Author: playerID, Kind: "text", Text: string(runes)}
		if g.allSubmitted() {
			g.commitStep()
		}
		return nil

	case "drawing":
		if action != "submit_drawing" {
			return nil
		}
		if _, ok := g.chainFor(playerID); !ok {
			return nil
		}
		dataURL, _ := payload["draw"].(string)
		if dataURL == "" {
			return nil
		}
		g.pending[playerID] = gpEntry{Author: playerID, Kind: "drawing", DataURL: dataURL}
		if g.allSubmitted() {
			g.commitStep()
		}
		return nil

	case "reveal":
		switch action {
		case "reveal_next":
			if g.room == nil || !g.room.IsAdmin(playerID) {
				return nil
			}
			g.advanceReveal()
			return nil
		case "react":
			chainIdx := decodePayloadInt(payload, "chain")
			entryIdx := decodePayloadInt(payload, "entry")
			if !g.isRevealed(chainIdx, entryIdx) {
				return nil
			}
			entry := g.chains[chainIdx][entryIdx]
			if entry.Author == playerID {
				return nil
			}
			key := fmt.Sprintf("%s|%d|%d", playerID, chainIdx, entryIdx)
			if g.reacted[key] {
				return nil
			}
			g.reacted[key] = true
			likeKey := fmt.Sprintf("%d|%d", chainIdx, entryIdx)
			g.likes[likeKey]++
			g.scores[entry.Author] += GPPointsPerLike
			return nil
		}
		return nil
	}
	return nil
}

func (g *GarticPhoneGame) advanceReveal() {
	// Once every chain is shown, one more press ends the game — so the final
	// punchline stays on screen until the host moves on.
	if g.revealChain >= len(g.chains) {
		g.finished = true
		return
	}
	if g.revealPos < len(g.chains[g.revealChain]) {
		g.revealPos++
	}
	if g.revealPos >= len(g.chains[g.revealChain]) {
		g.revealChain++
		g.revealPos = 0
	}
}

func (g *GarticPhoneGame) isRevealed(chainIdx, entryIdx int) bool {
	if chainIdx < 0 || chainIdx >= len(g.chains) {
		return false
	}
	if entryIdx < 0 || entryIdx >= len(g.chains[chainIdx]) {
		return false
	}
	if chainIdx < g.revealChain {
		return true
	}
	return chainIdx == g.revealChain && entryIdx < g.revealPos
}

func (g *GarticPhoneGame) PublicState() map[string]any {
	state := map[string]any{
		"phase":      g.phase,
		"step":       g.step,
		"totalSteps": g.totalSteps,
		"turnOrder":  g.turnOrder,
		"scores":     g.scores,
	}
	switch g.phase {
	case "prompt", "drawing", "writing":
		state["deadline"] = g.deadline.UnixMilli()
		submitted := make([]string, 0, len(g.pending))
		for id := range g.pending {
			submitted = append(submitted, id)
		}
		sort.Strings(submitted)
		state["submitted"] = submitted
	case "reveal":
		state["revealChain"] = g.revealChain
		state["revealPos"] = g.revealPos
		state["likes"] = g.likes
		revealed := make([]map[string]any, 0, len(g.chains))
		for i, chain := range g.chains {
			entries := make([]gpEntry, 0, len(chain))
			for j, entry := range chain {
				if g.isRevealed(i, j) || g.finished {
					entries = append(entries, entry)
				}
			}
			revealed = append(revealed, map[string]any{
				"starter": g.turnOrder[i],
				"length":  len(chain),
				"entries": entries,
			})
		}
		state["chains"] = revealed
	}
	return state
}

func (g *GarticPhoneGame) PrivateState(playerID string) map[string]any {
	state := map[string]any{}
	switch g.phase {
	case "prompt", "drawing", "writing":
		_, submitted := g.pending[playerID]
		state["submitted"] = submitted
		chainIdx, ok := g.chainFor(playerID)
		if !ok {
			return state
		}
		state["chain"] = chainIdx
		if g.step > 0 && len(g.chains[chainIdx]) >= g.step {
			prev := g.chains[chainIdx][g.step-1]
			state["prevEntry"] = prev
		}
	}
	return state
}

func decodePayloadInt(payload map[string]any, key string) int {
	switch v := payload[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	default:
		return -1
	}
}

func (g *GarticPhoneGame) Shift(delta time.Duration) {
	g.deadline = g.deadline.Add(delta)
}

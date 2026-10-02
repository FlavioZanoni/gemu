package games

import (
	"errors"
	"fmt"
	"math/rand"
	"sort"
	"strings"
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
	room RoomInfo

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

	// Reveal cursor. revealChain is the chain on screen; revealPos is the
	// COUNT of its entries revealed so far (1..len(chain)), so the newest
	// visible entry is chains[revealChain][revealPos-1]. Every chain before
	// revealChain is fully revealed. Each reveal_next shows one more entry;
	// once a chain is fully shown the next press opens the following chain
	// with its first entry visible, and the press after the LAST chain's last
	// entry ends the game — so every punchline stays on screen until the host
	// moves on.
	revealChain int
	revealPos   int
	reacted     map[string]map[string]string // player -> "chain|entry" -> emoji
	likes       map[string]int               // "chain|entry" (total)
	reactions   map[string]map[string]int    // "chain|entry" -> emoji -> count
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

func (g *GarticPhoneGame) Start(roomID string, opts Options) {
	g.room = opts.Room
	g.turnOrder = nil
	if g.room != nil {
		// Copy: shuffling must never reorder the room's own slice.
		g.turnOrder = append([]string(nil), g.room.ConnectedPlayerIDs()...)
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
	g.reacted = make(map[string]map[string]string)
	g.likes = make(map[string]int)
	g.reactions = make(map[string]map[string]int)
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
		g.revealPos = 1 // the first prompt opens the show
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
	return standings(g.scores, g.room)
}

// gpReactionEmoji is the reveal's reaction palette (design: 😂/💀/⭐ pills).
// Anything else is stored as the default ⭐ so the public reactions map can't
// be stuffed with arbitrary keys.
var gpReactionEmoji = map[string]bool{"😂": true, "💀": true, "⭐": true}

const gpDefaultEmoji = "⭐"

var (
	errGPUnknownAction = errors.New("unknown action")
	errGPSpectator     = errors.New("not playing this game")
	errGPBadDrawing    = errors.New("invalid drawing")
)

func (g *GarticPhoneGame) OnAction(playerID string, payload map[string]any) error {
	action, _ := payload["action"].(string)
	switch action {
	case "submit_prompt", "submit_description":
		if g.finished || (g.phase != "prompt" && g.phase != "writing") {
			return nil // late/raced submit: harmless, ignore
		}
		if _, ok := g.chainFor(playerID); !ok {
			return errGPSpectator
		}
		text, _ := payload["text"].(string)
		text = strings.TrimSpace(text)
		runes := []rune(text)
		if len(runes) > gpMaxEntryChars {
			runes = []rune(strings.TrimSpace(string(runes[:gpMaxEntryChars])))
		}
		if len(runes) == 0 {
			return nil
		}
		g.pending[playerID] = gpEntry{Author: playerID, Kind: "text", Text: string(runes)}
		if g.allSubmitted() {
			g.commitStep()
		}
		return nil

	case "submit_drawing":
		if g.finished || g.phase != "drawing" {
			return nil
		}
		if _, ok := g.chainFor(playerID); !ok {
			return errGPSpectator
		}
		dataURL, _ := payload["draw"].(string)
		if !ValidImageDataURL(dataURL) {
			// Oversized or malformed: tell the client so it keeps the drawing
			// (and can retry) instead of silently autofilling a blank later.
			return errGPBadDrawing
		}
		g.pending[playerID] = gpEntry{Author: playerID, Kind: "drawing", DataURL: dataURL}
		if g.allSubmitted() {
			g.commitStep()
		}
		return nil

	case "reveal_next":
		if g.finished || g.phase != "reveal" {
			return nil
		}
		if g.room == nil || !g.room.IsAdmin(playerID) {
			return nil
		}
		// Bound to the cursor it was pressed on (when the client says): a
		// double tap must not skip the next entry's big moment.
		if _, ok := payload["chain"]; ok && decodePayloadInt(payload, "chain") != g.revealChain {
			return nil
		}
		if _, ok := payload["pos"]; ok && decodePayloadInt(payload, "pos") != g.revealPos {
			return nil
		}
		g.advanceReveal()
		return nil

	case "react":
		if g.finished || g.phase != "reveal" {
			return nil
		}
		chainIdx := decodePayloadInt(payload, "chain")
		entryIdx := decodePayloadInt(payload, "entry")
		if !g.isRevealed(chainIdx, entryIdx) {
			return nil
		}
		entry := g.chains[chainIdx][entryIdx]
		if entry.Author == playerID {
			return nil
		}
		likeKey := fmt.Sprintf("%d|%d", chainIdx, entryIdx)
		if g.reacted[playerID] == nil {
			g.reacted[playerID] = make(map[string]string)
		}
		if _, done := g.reacted[playerID][likeKey]; done {
			return nil
		}
		emoji, _ := payload["emoji"].(string)
		if !gpReactionEmoji[emoji] {
			emoji = gpDefaultEmoji
		}
		g.reacted[playerID][likeKey] = emoji
		g.likes[likeKey]++
		if g.reactions[likeKey] == nil {
			g.reactions[likeKey] = make(map[string]int)
		}
		g.reactions[likeKey][emoji]++
		// Scoring is emoji-agnostic: every reaction is a like.
		g.scores[entry.Author] += GPPointsPerLike
		return nil
	}
	return errGPUnknownAction
}

// advanceReveal moves the reveal cursor one press forward (see revealPos).
func (g *GarticPhoneGame) advanceReveal() {
	if g.revealChain >= len(g.chains) {
		g.finished = true
		return
	}
	if g.revealPos < len(g.chains[g.revealChain]) {
		g.revealPos++
		return
	}
	// Current chain fully shown.
	if g.revealChain+1 >= len(g.chains) {
		g.finished = true
		return
	}
	g.revealChain++
	g.revealPos = 1
	if len(g.chains[g.revealChain]) == 0 {
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
		// round/totalRounds feed the shell header's "RD n/total" label:
		// 1-based step here, the chain on screen during the reveal.
		state["round"] = g.step + 1
		state["totalRounds"] = g.totalSteps
		state["deadline"] = g.deadline.UnixMilli()
		// remainingMs is the clock-skew-free form of deadline: the client
		// anchors it to its own clock when the state arrives (auto-submit).
		state["remainingMs"] = max(0, time.Until(g.deadline).Milliseconds())
		submitted := make([]string, 0, len(g.pending))
		for id := range g.pending {
			submitted = append(submitted, id)
		}
		sort.Strings(submitted)
		state["submitted"] = submitted
	case "reveal":
		state["round"] = min(g.revealChain+1, len(g.chains))
		state["totalRounds"] = len(g.chains)
		state["revealChain"] = g.revealChain
		state["revealPos"] = g.revealPos
		// revealDone: the last chain is fully on screen; the host's next
		// press is FINISH.
		state["revealDone"] = g.finished || (g.revealChain >= len(g.chains)-1 &&
			(g.revealChain >= len(g.chains) || g.revealPos >= len(g.chains[g.revealChain])))
		state["likes"] = g.likes
		state["reactions"] = g.reactions
		// Only the chain on screen carries entries: every reaction
		// rebroadcasts this state, and resending every revealed drawing of
		// every earlier chain grew it to megabytes by the end of a 16-player
		// reveal. Other chains are metadata (starter, length) only; their
		// reaction totals stay in likes/reactions.
		revealed := make([]map[string]any, 0, len(g.chains))
		for i, chain := range g.chains {
			entries := make([]gpEntry, 0)
			if i == g.revealChain {
				for j, entry := range chain {
					if g.isRevealed(i, j) {
						entries = append(entries, entry)
					}
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
	_, inRoster := g.playerIdx[playerID]
	if !inRoster {
		// Joined after the chains were dealt: watches (and can react during
		// the reveal) but has no chain to work on.
		state["spectator"] = true
	}
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
	case "reveal":
		mine := make(map[string]string, len(g.reacted[playerID]))
		for k, v := range g.reacted[playerID] {
			mine[k] = v
		}
		state["myReactions"] = mine
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

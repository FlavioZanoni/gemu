package games

import (
	"errors"
	"math/rand"
	"sort"
	"time"
)

const (
	GarticTotalRounds   = 2
	GarticTurnSeconds   = 75
	GarticRevealSeconds = 6
	garticChatCap       = 30
)

var garticWords = map[string][]string{
	"en": {
		"apple", "banana", "guitar", "elephant", "bicycle", "pizza", "rocket", "castle",
		"dragon", "penguin", "rainbow", "volcano", "spider", "wizard", "robot", "pirate",
		"tornado", "mermaid", "dinosaur", "helicopter", "lighthouse", "snowman", "octopus", "cactus",
		"vampire", "skateboard", "hamburger", "butterfly", "telescope", "waterfall", "campfire", "parachute",
		"scarecrow", "submarine", "windmill", "igloo", "jellyfish", "treasure", "ghost", "ladder",
		"anchor", "trophy", "mustache", "umbrella", "whale", "clown", "beehive", "fireworks",
		"karate", "surfing", "fishing", "juggling", "sleepwalking", "yoga", "karaoke", "hiccups",
		"toothbrush", "microwave", "vacuum", "hammock", "seesaw", "trampoline",
	},
	"pt-BR": {
		"maçã", "banana", "violão", "elefante", "bicicleta", "pizza", "foguete", "castelo",
		"dragão", "pinguim", "arco-íris", "vulcão", "aranha", "bruxo", "robô", "pirata",
		"tornado", "sereia", "dinossauro", "helicóptero", "farol", "boneco de neve", "polvo", "cacto",
		"vampiro", "skate", "hambúrguer", "borboleta", "telescópio", "cachoeira", "fogueira", "paraquedas",
		"espantalho", "submarino", "moinho", "iglu", "água-viva", "tesouro", "fantasma", "escada",
		"âncora", "troféu", "bigode", "guarda-chuva", "baleia", "palhaço", "colmeia", "fogos de artifício",
		"caratê", "surfe", "pescaria", "malabarismo", "sonâmbulo", "ioga", "karaokê", "soluço",
		"escova de dentes", "micro-ondas", "aspirador", "rede de dormir", "gangorra", "cama elástica",
	},
}

type garticGuess struct {
	PlayerID string `json:"playerId"`
	Text     string `json:"text"` // empty when Correct: the word stays hidden
	Correct  bool   `json:"correct"`
}

type GarticGame struct {
	roomID string
	room   RoomInfo
	locale string

	deck        []string
	round       int
	totalRounds int
	turnOrder   []string
	turnIdx     int
	drawer      string
	word        string
	phase       string // "drawing" | "turnResults"
	deadline    time.Time
	deadlineTag string

	guessedOrder []string
	guesses      []garticGuess
	closeFor     map[string]string
	scores       map[string]int
	finished     bool
}

func NewGarticFactory() Factory {
	return Factory{
		Type: "gartic",
		Name: "Gartic",
		New: func() Adapter {
			return &GarticGame{}
		},
	}
}

func (g *GarticGame) Type() string {
	return "gartic"
}

func (g *GarticGame) Start(roomID string, opts Options) {
	g.roomID = roomID
	g.room = opts.Room
	g.locale = opts.Locale
	if _, ok := garticWords[g.locale]; !ok {
		g.locale = "en"
	}
	g.round = 1
	g.totalRounds = GarticTotalRounds
	g.scores = make(map[string]int)
	g.shuffleDeck()
	g.turnOrder = g.connected()
	rand.Shuffle(len(g.turnOrder), func(i, j int) { g.turnOrder[i], g.turnOrder[j] = g.turnOrder[j], g.turnOrder[i] })
	g.turnIdx = 0
	g.startTurn()
}

func (g *GarticGame) connected() []string {
	if g.room == nil {
		return nil
	}
	return g.room.ConnectedPlayerIDs()
}

func (g *GarticGame) shuffleDeck() {
	words := garticWords[g.locale]
	g.deck = make([]string, len(words))
	copy(g.deck, words)
	rand.Shuffle(len(g.deck), func(i, j int) { g.deck[i], g.deck[j] = g.deck[j], g.deck[i] })
}

func (g *GarticGame) drawWord() string {
	if len(g.deck) == 0 {
		g.shuffleDeck()
	}
	word := g.deck[0]
	g.deck = g.deck[1:]
	return word
}

func (g *GarticGame) startTurn() {
	if g.turnIdx >= len(g.turnOrder) {
		g.finished = true
		return
	}
	g.drawer = g.turnOrder[g.turnIdx]
	g.word = g.drawWord()
	g.phase = "drawing"
	g.guessedOrder = nil
	g.guesses = nil
	g.closeFor = make(map[string]string)
	g.deadline = time.Now().Add(GarticTurnSeconds * time.Second)
	g.deadlineTag = "turn"
}

func (g *GarticGame) endTurn() {
	g.phase = "turnResults"
	g.deadline = time.Now().Add(GarticRevealSeconds * time.Second)
	g.deadlineTag = "reveal"
}

// advanceTurn moves past the reveal to the next drawer, skipping drawers who
// are no longer connected, and rolls rounds until the game finishes.
func (g *GarticGame) advanceTurn() {
	connected := make(map[string]bool)
	for _, id := range g.connected() {
		connected[id] = true
	}
	g.turnIdx++
	for g.turnIdx < len(g.turnOrder) && !connected[g.turnOrder[g.turnIdx]] {
		g.turnIdx++
	}
	if g.turnIdx < len(g.turnOrder) {
		g.startTurn()
		return
	}
	if g.round >= g.totalRounds {
		g.finished = true
		return
	}
	g.round++
	g.turnOrder = g.connected()
	rand.Shuffle(len(g.turnOrder), func(i, j int) { g.turnOrder[i], g.turnOrder[j] = g.turnOrder[j], g.turnOrder[i] })
	g.turnIdx = 0
	if len(g.turnOrder) < 2 {
		g.finished = true
		return
	}
	g.startTurn()
}

func (g *GarticGame) hasGuessed(playerID string) bool {
	for _, id := range g.guessedOrder {
		if id == playerID {
			return true
		}
	}
	return false
}

// allGuessed reports whether every connected non-drawer has guessed the word.
func (g *GarticGame) allGuessed() bool {
	connected := g.connected()
	others := 0
	for _, id := range connected {
		if id == g.drawer {
			continue
		}
		others++
		if !g.hasGuessed(id) {
			return false
		}
	}
	return others > 0
}

func (g *GarticGame) OnPlayerJoin(playerID string) {}

func (g *GarticGame) OnPlayerLeave(playerID string) {
	if g.finished {
		return
	}
	if g.phase == "drawing" {
		if playerID == g.drawer {
			g.endTurn()
			return
		}
		if g.allGuessed() {
			g.endTurn()
		}
	}
}

func (g *GarticGame) OnRoomChange() {
	if g.finished || g.phase != "drawing" {
		return
	}
	connected := make(map[string]bool)
	for _, id := range g.connected() {
		connected[id] = true
	}
	if !connected[g.drawer] || g.allGuessed() {
		g.endTurn()
	}
}

func (g *GarticGame) OnTimer(name string) {
	switch {
	case name == "turn" && g.phase == "drawing":
		g.endTurn()
	case name == "reveal" && g.phase == "turnResults":
		g.advanceTurn()
	}
}

func (g *GarticGame) NextDeadline() (string, time.Time, bool) {
	if g.finished {
		return "", time.Time{}, false
	}
	return g.deadlineTag, g.deadline, true
}

func (g *GarticGame) Status() Status {
	if g.finished {
		return StatusFinished
	}
	return StatusRunning
}

func (g *GarticGame) Standings() []Standing {
	seen := make(map[string]bool)
	standings := make([]Standing, 0, len(g.scores))
	for id, score := range g.scores {
		standings = append(standings, Standing{PlayerID: id, Score: score})
		seen[id] = true
	}
	for _, id := range g.connected() {
		if !seen[id] {
			standings = append(standings, Standing{PlayerID: id, Score: 0})
		}
	}
	sort.SliceStable(standings, func(i, j int) bool { return standings[i].Score > standings[j].Score })
	return standings
}

func (g *GarticGame) OnAction(playerID string, payload map[string]any) error {
	action, _ := payload["action"].(string)
	switch action {
	case "stroke", "canvas_clear", "canvas_undo":
		// Relayed via game.stream; only the current drawer may draw.
		if g.phase != "drawing" || playerID != g.drawer {
			return errors.New("not the drawer")
		}
		return nil

	case "guess":
		if g.phase != "drawing" || playerID == g.drawer || g.hasGuessed(playerID) {
			return nil
		}
		text, _ := payload["text"].(string)
		normalized := NormalizeAnswer(text)
		if normalized == "" {
			return nil
		}
		if normalized == NormalizeAnswer(g.word) {
			g.guessedOrder = append(g.guessedOrder, playerID)
			points := 100 - 10*(len(g.guessedOrder)-1)
			if points < 50 {
				points = 50
			}
			g.scores[playerID] += points
			g.scores[g.drawer] += 25
			delete(g.closeFor, playerID)
			g.appendGuess(garticGuess{PlayerID: playerID, Correct: true})
			if g.allGuessed() {
				g.endTurn()
			}
			return nil
		}
		if levenshtein(normalized, NormalizeAnswer(g.word)) <= 2 {
			g.closeFor[playerID] = text
		}
		g.appendGuess(garticGuess{PlayerID: playerID, Text: text})
		return nil

	default:
		return nil
	}
}

func (g *GarticGame) appendGuess(guess garticGuess) {
	g.guesses = append(g.guesses, guess)
	if len(g.guesses) > garticChatCap {
		g.guesses = g.guesses[len(g.guesses)-garticChatCap:]
	}
}

func (g *GarticGame) PublicState() map[string]any {
	state := map[string]any{
		"phase":       g.phase,
		"round":       g.round,
		"totalRounds": g.totalRounds,
		"drawer":      g.drawer,
		"turnOrder":   g.turnOrder,
		"turnIndex":   g.turnIdx,
		"scores":      g.scores,
		"guessed":     g.guessedOrder,
		"guesses":     g.guesses,
	}
	if !g.finished {
		state["deadline"] = g.deadline.UnixMilli()
	}
	if g.phase == "turnResults" || g.finished {
		state["word"] = g.word
	} else {
		state["wordLength"] = len([]rune(g.word))
	}
	return state
}

func (g *GarticGame) PrivateState(playerID string) map[string]any {
	state := map[string]any{}
	if playerID == g.drawer && g.phase == "drawing" {
		state["word"] = g.word
	}
	if closeText, ok := g.closeFor[playerID]; ok {
		state["closeGuess"] = closeText
	}
	return state
}

// levenshtein is a plain DP edit distance for close-guess feedback.
func levenshtein(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	if len(ra) == 0 {
		return len(rb)
	}
	prev := make([]int, len(rb)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ra); i++ {
		curr := make([]int, len(rb)+1)
		curr[0] = i
		for j := 1; j <= len(rb); j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			curr[j] = min(curr[j-1]+1, prev[j]+1, prev[j-1]+cost)
		}
		prev = curr
	}
	return prev[len(rb)]
}

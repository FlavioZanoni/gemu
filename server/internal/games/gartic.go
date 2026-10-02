package games

import (
	"errors"
	"math/rand"
	"strconv"
	"strings"
	"time"
	"unicode"
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

// garticGuess is one public chat line. Wrong guesses carry their text; a
// correct guess or a near miss never does — the word (or most of it) would
// leak to everyone still guessing. Close lines show "<name> is close!" and
// only the guesser sees their own text (PrivateState.ownClose by Seq).
type garticGuess struct {
	Seq      int    `json:"seq"`
	PlayerID string `json:"playerId"`
	Text     string `json:"text"`
	Correct  bool   `json:"correct"`
	Close    bool   `json:"close,omitempty"`
	Points   int    `json:"points,omitempty"`
}

type GarticGame struct {
	room   RoomInfo
	locale string

	deck        []string
	round       int
	totalRounds int
	turnSeconds int
	turnOrder   []string
	turnIdx     int
	drawer      string
	word        string
	phase       string    // "drawing" | "turnResults"
	turnStart   time.Time // when the current turn began (clients sync late-joiner canvases off it)
	deadline    time.Time // turn end while drawing, reveal end in turnResults

	// Several logical timers share the hub's single pending deadline:
	// NextDeadline reports the earliest of turn end, the next hint and the
	// absent-player grace.
	hintAt   []time.Time // pending letter reveals, ascending
	revealed []bool      // per rune of word
	graceEnd time.Time   // zero unless the turn is unplayable (drawer gone / nobody to guess)
	// revealGrace is set once a reveal was stretched to wait for a
	// reconnecting player, so a refresh at the turn boundary doesn't end the game.
	revealGrace bool

	guessSeq     int
	guessedOrder []string
	guesses      []garticGuess
	closeFor     map[string]string         // latest near miss per guesser
	ownClose     map[string]map[int]string // guesser -> seq -> their hidden text
	scores       map[string]int
	finished     bool
}

const (
	// GarticGraceSeconds is how long a turn waits for a disconnected drawer
	// (or for anyone to guess) before ending — enough for a page refresh.
	GarticGraceSeconds = 10
)

func NewGarticFactory() Factory {
	return Factory{
		Type: "gartic",
		Name: "Gartic",
		New: func() Adapter {
			return &GarticGame{}
		},
	}
}

func (g *GarticGame) Start(roomID string, opts Options) {
	g.room = opts.Room
	g.locale = opts.Locale
	if _, ok := garticWords[g.locale]; !ok {
		g.locale = "en"
	}
	g.round = 1
	g.totalRounds = SettingInt(opts.Settings, "rounds", GarticTotalRounds, 1, 10)
	g.turnSeconds = SettingInt(opts.Settings, "turnSeconds", GarticTurnSeconds, 30, 180)
	g.scores = make(map[string]int)
	g.shuffleDeck()
	g.turnOrder = g.connected()
	for _, id := range g.turnOrder {
		g.scores[id] = 0
	}
	rand.Shuffle(len(g.turnOrder), func(i, j int) { g.turnOrder[i], g.turnOrder[j] = g.turnOrder[j], g.turnOrder[i] })
	g.turnIdx = 0
	if len(g.turnOrder) < 2 {
		g.finished = true
		return
	}
	g.startTurn()
}

func (g *GarticGame) connected() []string {
	if g.room == nil {
		return nil
	}
	return g.room.ConnectedPlayerIDs()
}

func (g *GarticGame) connectedSet() map[string]bool {
	set := make(map[string]bool)
	for _, id := range g.connected() {
		set[id] = true
	}
	return set
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
	g.setWord(g.drawWord())
	g.phase = "drawing"
	g.guessedOrder = nil
	g.guesses = nil
	g.closeFor = make(map[string]string)
	g.ownClose = make(map[string]map[int]string)
	g.graceEnd = time.Time{}
	g.revealGrace = false
	now := time.Now()
	turn := time.Duration(g.turnSeconds) * time.Second
	g.turnStart = now
	g.deadline = now.Add(turn)
	// Hints: one letter at half time, a second at three quarters for longer
	// words. Short words get fewer so the hint never gives the word away.
	g.hintAt = nil
	letters := g.letterCount()
	if letters >= 4 {
		g.hintAt = append(g.hintAt, now.Add(turn/2))
	}
	if letters >= 6 {
		g.hintAt = append(g.hintAt, now.Add(turn*3/4))
	}
}

// setWord installs the turn's word with nothing revealed.
func (g *GarticGame) setWord(word string) {
	g.word = word
	g.revealed = make([]bool, len([]rune(word)))
}

func isWordLetter(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r)
}

func (g *GarticGame) letterCount() int {
	n := 0
	for _, r := range g.word {
		if isWordLetter(r) {
			n++
		}
	}
	return n
}

// mask renders the word for guessers: unrevealed letters as "_", spaces
// and hyphens kept so word boundaries show ("boneco de neve" ->
// "______ __ ____").
func (g *GarticGame) mask() string {
	runes := []rune(g.word)
	var b strings.Builder
	for i, r := range runes {
		switch {
		case !isWordLetter(r):
			b.WriteRune(r)
		case i < len(g.revealed) && g.revealed[i]:
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	return b.String()
}

// revealLetter uncovers one random hidden letter for the hint.
func (g *GarticGame) revealLetter() {
	var hidden []int
	for i, r := range []rune(g.word) {
		if isWordLetter(r) && i < len(g.revealed) && !g.revealed[i] {
			hidden = append(hidden, i)
		}
	}
	// Never uncover the last hidden letters: keep at least two.
	if len(hidden) <= 2 {
		return
	}
	g.revealed[hidden[rand.Intn(len(hidden))]] = true
}

func (g *GarticGame) endTurn() {
	g.phase = "turnResults"
	g.deadline = time.Now().Add(GarticRevealSeconds * time.Second)
	g.hintAt = nil
	g.graceEnd = time.Time{}
	g.revealGrace = false
}

// advanceTurn moves past the reveal to the next drawer, skipping drawers who
// are no longer connected, and rolls rounds until the game finishes. With
// fewer than two players connected there is nobody to draw for, so the game
// ends (results stay with the scores so far).
func (g *GarticGame) advanceTurn() {
	connected := g.connectedSet()
	if len(connected) < 2 {
		g.finished = true
		return
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

// guesserCount is the number of connected players other than the drawer.
func (g *GarticGame) guesserCount() int {
	n := 0
	for _, id := range g.connected() {
		if id != g.drawer {
			n++
		}
	}
	return n
}

// allGuessed reports whether every connected non-drawer has guessed the word.
func (g *GarticGame) allGuessed() bool {
	others := 0
	for _, id := range g.connected() {
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

// checkPlayable re-evaluates the running turn after connectivity changes.
// Everyone guessed -> end now. Drawer disconnected or nobody left to guess
// -> start a short grace (a refresh reconnects within it) instead of
// burning or killing the turn; once playable again the grace is dropped.
func (g *GarticGame) checkPlayable() {
	if g.finished || g.phase != "drawing" {
		return
	}
	if g.allGuessed() {
		g.endTurn()
		return
	}
	if g.connectedSet()[g.drawer] && g.guesserCount() > 0 {
		g.graceEnd = time.Time{}
		return
	}
	if g.graceEnd.IsZero() {
		g.graceEnd = time.Now().Add(GarticGraceSeconds * time.Second)
	}
}

// OnPlayerJoin: a new player can guess right away; they draw from the next
// round. A join can also make a stalled turn playable again.
func (g *GarticGame) OnPlayerJoin(playerID string) {
	if _, ok := g.scores[playerID]; !ok && g.scores != nil {
		g.scores[playerID] = 0
	}
	g.checkPlayable()
}

// OnPlayerLeave is a permanent leave: no grace. The drawer leaving or the
// last guesser leaving ends the turn at once.
func (g *GarticGame) OnPlayerLeave(playerID string) {
	if g.finished || g.phase != "drawing" {
		return
	}
	if playerID == g.drawer || g.guesserCount() == 0 || g.allGuessed() {
		g.endTurn()
		return
	}
	g.checkPlayable()
}

// OnRoomChange fires on disconnects (and other connectivity changes): a
// disconnect may be a refresh, so it only arms the grace.
func (g *GarticGame) OnRoomChange() {
	g.checkPlayable()
}

func (g *GarticGame) OnTimer(name string) {
	switch {
	case name == "turn" && g.phase == "drawing":
		g.endTurn()
	case name == "hint" && g.phase == "drawing":
		if len(g.hintAt) > 0 {
			g.hintAt = g.hintAt[1:]
		}
		g.revealLetter()
	case name == "grace" && g.phase == "drawing":
		g.graceEnd = time.Time{}
		if !g.connectedSet()[g.drawer] || g.guesserCount() == 0 {
			g.endTurn()
			return
		}
		g.checkPlayable()
	case name == "reveal" && g.phase == "turnResults":
		// A player refreshing right at the turn boundary would otherwise
		// end a 2-player game; wait once for them to come back.
		if len(g.connected()) < 2 && !g.revealGrace {
			g.revealGrace = true
			g.deadline = time.Now().Add(GarticGraceSeconds * time.Second)
			return
		}
		g.advanceTurn()
	}
}

func (g *GarticGame) NextDeadline() (string, time.Time, bool) {
	if g.finished {
		return "", time.Time{}, false
	}
	if g.phase == "turnResults" {
		return "reveal", g.deadline, true
	}
	name, at := "turn", g.deadline
	if len(g.hintAt) > 0 && g.hintAt[0].Before(at) {
		name, at = "hint", g.hintAt[0]
	}
	if !g.graceEnd.IsZero() && g.graceEnd.Before(at) {
		name, at = "grace", g.graceEnd
	}
	return name, at, true
}

func (g *GarticGame) Status() Status {
	if g.finished {
		return StatusFinished
	}
	return StatusRunning
}

func (g *GarticGame) Standings() []Standing {
	return standings(g.scores, g.room)
}

// AcceptStream lets only the current drawer stream strokes, and only while
// drawing.
func (g *GarticGame) AcceptStream(playerID, action string) bool {
	return g.phase == "drawing" && playerID == g.drawer
}

func (g *GarticGame) OnAction(playerID string, payload map[string]any) error {
	action, _ := payload["action"].(string)
	switch action {
	case "guess":
		// Any action is a chance to notice the drawer came back.
		g.checkPlayable()
		if g.phase != "drawing" || playerID == g.drawer || g.hasGuessed(playerID) {
			return nil
		}
		raw, _ := payload["text"].(string)
		text := strings.TrimSpace(TruncateText(raw, 80))
		guessKey := GarticAnswerKey(text)
		if guessKey == "" {
			return nil
		}
		wordKey := GarticAnswerKey(g.word)
		if GarticAnswerMatches(guessKey, wordKey) {
			g.guessedOrder = append(g.guessedOrder, playerID)
			points := 100 - 10*(len(g.guessedOrder)-1)
			if points < 50 {
				points = 50
			}
			g.scores[playerID] += points
			g.scores[g.drawer] += 25
			delete(g.closeFor, playerID)
			g.appendGuess(garticGuess{PlayerID: playerID, Correct: true, Points: points})
			if g.allGuessed() {
				g.endTurn()
			}
			return nil
		}
		if garticIsClose(guessKey, wordKey) {
			seq := g.appendGuess(garticGuess{PlayerID: playerID, Close: true})
			g.closeFor[playerID] = text
			if g.ownClose[playerID] == nil {
				g.ownClose[playerID] = make(map[int]string)
			}
			g.ownClose[playerID][seq] = text
			return nil
		}
		g.appendGuess(garticGuess{PlayerID: playerID, Text: text})
		return nil

	default:
		return errors.New("unknown action")
	}
}

func (g *GarticGame) appendGuess(guess garticGuess) int {
	g.guessSeq++
	guess.Seq = g.guessSeq
	g.guesses = append(g.guesses, guess)
	if len(g.guesses) > garticChatCap {
		g.guesses = g.guesses[len(g.guesses)-garticChatCap:]
	}
	return guess.Seq
}

func (g *GarticGame) PublicState() map[string]any {
	state := map[string]any{
		"phase":         g.phase,
		"round":         g.round,
		"totalRounds":   g.totalRounds,
		"drawer":        g.drawer,
		"turnOrder":     g.turnOrder,
		"turnIndex":     g.turnIdx,
		"turnSeconds":   g.turnSeconds,
		"turnStartedAt": g.turnStart.UnixMilli(),
		"scores":        g.scores,
		"guessed":       g.guessedOrder,
		"guesses":       g.guesses,
	}
	if !g.finished {
		state["deadline"] = g.deadline.UnixMilli()
	}
	if g.phase == "turnResults" || g.finished {
		state["word"] = g.word
	} else {
		state["mask"] = g.mask()
		state["letters"] = g.letterCount()
		if len(g.hintAt) > 0 {
			state["nextHintAt"] = g.hintAt[0].UnixMilli()
		}
		if !g.graceEnd.IsZero() {
			state["graceEnd"] = g.graceEnd.UnixMilli()
		}
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
	if own := g.ownClose[playerID]; len(own) > 0 {
		// JSON object keys must be strings.
		byKey := make(map[string]string, len(own))
		for seq, text := range own {
			byKey[strconv.Itoa(seq)] = text
		}
		state["ownClose"] = byKey
	}
	return state
}

// GarticAnswerKey reduces a guess or word to what matters for matching:
// lowercase, no accents, letters and digits only — so "Arco-Íris",
// "arco iris" and "ARCOIRIS!" are the same answer.
func GarticAnswerKey(s string) string {
	s = NormalizeAnswer(s)
	var b strings.Builder
	for _, r := range s {
		if isWordLetter(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// garticPlurals lists simple plural spellings of a key (en "s"/"es", pt-BR
// ão->ões/ães/ãos, l->is, m->ns, r/z->es). Keys are accent-free already.
func garticPlurals(key string) []string {
	out := []string{key + "s", key + "es"}
	switch {
	case strings.HasSuffix(key, "ao"):
		stem := strings.TrimSuffix(key, "ao")
		out = append(out, stem+"oes", stem+"aes", stem+"aos")
	case strings.HasSuffix(key, "il"):
		out = append(out, strings.TrimSuffix(key, "l")+"s", strings.TrimSuffix(key, "il")+"eis")
	case strings.HasSuffix(key, "l"):
		out = append(out, strings.TrimSuffix(key, "l")+"is")
	case strings.HasSuffix(key, "m"):
		out = append(out, strings.TrimSuffix(key, "m")+"ns")
	case strings.HasSuffix(key, "y"):
		out = append(out, strings.TrimSuffix(key, "y")+"ies")
	}
	return out
}

// GarticAnswerMatches accepts the exact key or a simple plural/singular of
// it in either direction ("fireworks" vs "firework", "dragões" vs "dragão").
func GarticAnswerMatches(guessKey, wordKey string) bool {
	if guessKey == "" || wordKey == "" {
		return false
	}
	if guessKey == wordKey {
		return true
	}
	for _, p := range garticPlurals(wordKey) {
		if guessKey == p {
			return true
		}
	}
	for _, p := range garticPlurals(guessKey) {
		if wordKey == p {
			return true
		}
	}
	return false
}

// garticIsClose flags guesses that would leak the word if shown to the
// room: typos within a small edit distance, anything containing the word,
// and sizeable chunks of it ("snow" for "snowman").
func garticIsClose(guessKey, wordKey string) bool {
	limit := 2
	if len([]rune(wordKey)) <= 5 {
		limit = 1
	}
	if levenshtein(guessKey, wordKey) <= limit {
		return true
	}
	if strings.Contains(guessKey, wordKey) {
		return true
	}
	return len([]rune(guessKey)) >= 3 && strings.Contains(wordKey, guessKey)
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

// Shift moves every pending deadline forward after a pause.
func (g *GarticGame) Shift(delta time.Duration) {
	g.deadline = g.deadline.Add(delta)
	g.turnStart = g.turnStart.Add(delta)
	for i := range g.hintAt {
		g.hintAt[i] = g.hintAt[i].Add(delta)
	}
	if !g.graceEnd.IsZero() {
		g.graceEnd = g.graceEnd.Add(delta)
	}
}

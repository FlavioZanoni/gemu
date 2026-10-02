package games

import (
	"errors"
	"math/rand"
	"strings"
	"time"
	"unicode"
)

// Host settings: "rounds" (1–FibberMaxRounds, capped by the prompt pool) and
// "writeSeconds" (FibberMinWriteSeconds–FibberMaxWriteSeconds).
const (
	FibberDefaultRounds   = 4
	FibberMaxRounds       = 10
	FibberWriteSeconds    = 45
	FibberMinWriteSeconds = 20
	FibberMaxWriteSeconds = 120
	FibberChooseSeconds   = 30
	FibberRevealSeconds   = 8
	fibberMaxLie          = 80
)

// Reasons a submitted lie is bounced back to its author (PrivateState
// "rejected"), so they can write another one.
const (
	FibberRejectDuplicate = "duplicate" // someone already wrote that
	FibberRejectTruth     = "truth"     // too close to the real answer
	FibberRejectEmpty     = "empty"     // no letter or digit left to compare
)

type fibberPrompt struct {
	Q      string
	Answer string
}

var fibberBank = map[string][]fibberPrompt{
	"en": {
		{"A group of flamingos is officially called a ____.", "flamboyance"},
		{"The fear of long words is called ____.", "hippopotomonstrosesquippedaliophobia"},
		{"The dot over a lowercase 'i' is called a ____.", "tittle"},
		{"A baby echidna is called a ____.", "puggle"},
		{"The smooth patch of skin between your eyebrows is called the ____.", "glabella"},
		{"The plastic tip on a shoelace is called an ____.", "aglet"},
		{"A group of owls is called a ____.", "parliament"},
		{"The fleshy flap that dangles over a turkey's beak is called a ____.", "snood"},
		{"Astronauts on the ISS see a sunrise roughly every ____ minutes.", "90"},
		{"The fear of the number 13 is called ____.", "triskaidekaphobia"},
		{"A group of pugs is called a ____.", "grumble"},
		{"The little plastic table in a pizza box is called a ____.", "pizza saver"},
		{"A group of crows is called a ____.", "murder"},
		{"The # symbol's lesser-known name is the ____.", "octothorpe"},
		{"The earthy smell of rain on dry ground is called ____.", "petrichor"},
		{"The shortest war in history, Britain vs. Zanzibar in 1896, lasted about ____ minutes.", "38"},
		{"Wombats are famous for pooping ____.", "cubes"},
		{"A group of ferrets is called a ____.", "business"},
		{"The fear of clowns is called ____.", "coulrophobia"},
		{"The heat of chili peppers is measured on the ____ scale.", "Scoville"},
		{"The national animal of Scotland is the ____.", "unicorn"},
		{"The grooved edge on many coins is called ____.", "reeding"},
		{"Sea otters sleep holding ____ so they don't drift apart.", "hands"},
		{"A group of jellyfish is called a ____.", "smack"},
		{"An octopus has ____ blood.", "blue"},
		{"The pale half-moon at the base of a fingernail is called the ____.", "lunula"},
		{"Botanically speaking, a banana is a ____.", "berry"},
		{"A group of rhinos is called a ____.", "crash"},
		{"Cleopatra lived closer in time to the Moon landing than to the building of the ____.", "Great Pyramid"},
		{"The metal band that holds a pencil's eraser in place is called a ____.", "ferrule"},
		{"The groove between your nose and upper lip is called the ____.", "philtrum"},
		{"The tiny extra pocket on jeans was originally made for a ____.", "pocket watch"},
		{"A cat has ____ muscles in each ear.", "32"},
		{"The inventor of the Pringles can had some of his ashes buried in a ____.", "Pringles can"},
		{"The first item ever sold on eBay was a broken ____.", "laser pointer"},
		{"In seahorses, it's the ____ who gets pregnant.", "male"},
		{"In summer heat, the Eiffel Tower can grow about ____ centimeters taller.", "15"},
		{"A group of porcupines is called a ____.", "prickle"},
		{"Peanuts aren't nuts — botanically they're ____.", "legumes"},
		{"The only letter that doesn't appear in any U.S. state name is ____.", "Q"},
		{"In Japan the number 4 is often avoided because it sounds like the word for ____.", "death"},
		{"The Moon drifts away from Earth by about ____ centimeters every year.", "3.8"},
	},
	"pt-BR": {
		{"O pontinho sobre a letra 'i' minúscula se chama ____.", "pingo"},
		{"A pontinha de plástico do cadarço se chama ____.", "agulheta"},
		{"O espaço liso entre as sobrancelhas se chama ____.", "glabela"},
		{"Astronautas na ISS veem um nascer do sol mais ou menos a cada ____ minutos.", "90"},
		{"O medo do número 13 se chama ____.", "triscaidecafobia"},
		{"Em inglês, o filhote de equidna tem um nome fofo: ____.", "puggle"},
		{"As saliências carnudas na cabeça e no pescoço do peru se chamam ____.", "carúnculas"},
		{"Um grupo de borboletas é chamado de ____.", "panapaná"},
		{"Um grupo de camelos é chamado de ____.", "cáfila"},
		{"Um grupo de porcos é chamado de ____.", "vara"},
		{"Um grupo de cabras é chamado de ____.", "fato"},
		{"Um grupo de mulas de carga é chamado de ____.", "récua"},
		{"Um conjunto de chaves presas juntas é um ____ de chaves.", "molho"},
		{"Uma galeria de pinturas também se chama ____.", "pinacoteca"},
		{"O cheiro de terra molhada depois da chuva se chama ____.", "petricor"},
		{"O símbolo # se chama oficialmente ____.", "cerquilha"},
		{"O sulco entre o nariz e o lábio de cima se chama ____.", "filtro"},
		{"A meia-lua clara na base da unha se chama ____.", "lúnula"},
		{"O cocô do vombate tem formato de ____.", "cubo"},
		{"O medo de palhaços se chama ____.", "coulrofobia"},
		{"A ardência das pimentas é medida na escala ____.", "Scoville"},
		{"O animal nacional da Escócia é o ____.", "unicórnio"},
		{"Em inglês, um grupo de corujas é chamado de \"parliament\", que quer dizer ____.", "parlamento"},
		{"As lontras-marinhas dormem de ____ para não se separarem.", "mãos dadas"},
		{"O sangue do polvo é da cor ____.", "azul"},
		{"Do ponto de vista botânico, a banana é uma ____.", "baga"},
		{"Cleópatra viveu mais perto da chegada à Lua do que da construção da ____.", "Grande Pirâmide"},
		{"O anel de metal que prende a borracha no lápis se chama ____.", "virola"},
		{"O bolsinho pequeno da calça jeans foi criado para guardar um ____.", "relógio de bolso"},
		{"Um gato tem ____ músculos em cada orelha.", "32"},
		{"O inventor da lata de Pringles teve parte das cinzas enterrada numa ____.", "lata de Pringles"},
		{"O primeiro item vendido no eBay foi uma ____ quebrada.", "caneta laser"},
		{"Entre os cavalos-marinhos, quem fica grávido é o ____.", "macho"},
		{"No calor do verão, a Torre Eiffel pode crescer cerca de ____ centímetros.", "15"},
		{"Amendoim não é castanha: botanicamente é uma ____.", "leguminosa"},
		{"A guerra mais curta da história, entre Reino Unido e Zanzibar em 1896, durou cerca de ____ minutos.", "38"},
		{"No Japão, o número 4 é evitado porque soa como a palavra ____.", "morte"},
		{"A Lua se afasta da Terra cerca de ____ centímetros por ano.", "3,8"},
		{"Os pontinhos na casca do morango, que parecem sementes, são na verdade ____.", "frutos"},
		{"A única letra que não aparece no nome de nenhum estado dos EUA é o ____.", "Q"},
		{"Em Vênus, um dia dura mais que um ____.", "ano"},
	},
}

type FibberGame struct {
	room        RoomInfo
	locale      string
	phase       string // "writing" | "choosing" | "reveal"
	round       int
	totalRounds int
	writeSecs   int
	deck        []fibberPrompt
	prompt      fibberPrompt

	deadline    time.Time
	deadlineTag string

	// per-round state
	lies     map[string]string          // playerID -> their fake answer
	rejected map[string]fibberRejection // playerID -> last bounced lie
	options  []fibberOption             // shuffled truth + lies shown in choosing
	picks    map[string]int             // playerID -> chosen option index
	gained   map[string]int             // points earned this round (reveal)
	scores   map[string]int
	finished bool
}

type fibberRejection struct {
	Text   string `json:"text"`
	Reason string `json:"reason"`
}

// fibberOption is one shown answer; Author is "" for the truth.
type fibberOption struct {
	Text   string `json:"text"`
	Author string `json:"author"`
	Truth  bool   `json:"truth"`
}

// fibberArticles are leading articles ignored when comparing lies, so "the
// Great Pyramid" collides with "Great Pyramid".
var fibberArticles = map[string]bool{
	"a": true, "an": true, "the": true,
	"o": true, "os": true, "as": true, "um": true, "uma": true, "uns": true, "umas": true,
}

// fibberKey reduces an answer to its comparable core: normalized (case,
// accents, spacing), punctuation dropped, leading article removed.
func fibberKey(s string) string {
	n := NormalizeAnswer(s)
	n = strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsSpace(r) {
			return r
		}
		return ' '
	}, n)
	words := strings.Fields(n)
	if len(words) > 1 && fibberArticles[words[0]] {
		words = words[1:]
	}
	return strings.Join(words, " ")
}

func NewFibberFactory() Factory {
	return Factory{
		Type:       "fibber",
		Name:       "Fibber",
		MinPlayers: 3,
		New: func() Adapter {
			return &FibberGame{}
		},
	}
}

func (g *FibberGame) Start(roomID string, opts Options) {
	g.room = opts.Room
	g.locale = opts.Locale
	if _, ok := fibberBank[g.locale]; !ok {
		g.locale = "en"
	}
	bank := fibberBank[g.locale]
	g.deck = make([]fibberPrompt, len(bank))
	copy(g.deck, bank)
	rand.Shuffle(len(g.deck), func(i, j int) { g.deck[i], g.deck[j] = g.deck[j], g.deck[i] })
	g.totalRounds = SettingInt(opts.Settings, "rounds", FibberDefaultRounds, 1, min(FibberMaxRounds, len(g.deck)))
	g.writeSecs = SettingInt(opts.Settings, "writeSeconds", FibberWriteSeconds, FibberMinWriteSeconds, FibberMaxWriteSeconds)
	g.scores = make(map[string]int)
	for _, id := range g.connected() {
		g.scores[id] = 0
	}
	g.round = 0
	g.startRound()
}

func (g *FibberGame) connected() []string {
	if g.room == nil {
		return nil
	}
	return g.room.ConnectedPlayerIDs()
}

func (g *FibberGame) startRound() {
	if g.round >= g.totalRounds || g.round >= len(g.deck) {
		g.finished = true
		return
	}
	g.prompt = g.deck[g.round]
	g.round++
	g.phase = "writing"
	g.lies = make(map[string]string)
	g.rejected = make(map[string]fibberRejection)
	g.options = nil
	g.picks = make(map[string]int)
	g.gained = nil
	g.deadline = time.Now().Add(time.Duration(g.writeSecs) * time.Second)
	g.deadlineTag = "write"
}

func (g *FibberGame) allWritten() bool {
	c := g.connected()
	if len(c) == 0 {
		return false
	}
	for _, id := range c {
		if _, ok := g.lies[id]; !ok {
			return false
		}
	}
	return true
}

func (g *FibberGame) allPicked() bool {
	c := g.connected()
	if len(c) == 0 {
		return false
	}
	for _, id := range c {
		if _, ok := g.picks[id]; !ok {
			return false
		}
	}
	return true
}

// enterChoosing builds the shuffled option list (truth + every lie) and
// opens the vote. Lies are unique and never match the truth — submitLie
// bounces collisions back to their author — so no lie is ever dropped.
func (g *FibberGame) enterChoosing() {
	opts := []fibberOption{{Text: g.prompt.Answer, Truth: true}}
	for id, lie := range g.lies {
		opts = append(opts, fibberOption{Text: lie, Author: id})
	}
	rand.Shuffle(len(opts), func(i, j int) { opts[i], opts[j] = opts[j], opts[i] })
	g.options = opts
	g.phase = "choosing"
	g.deadline = time.Now().Add(FibberChooseSeconds * time.Second)
	g.deadlineTag = "choose"
}

// scoreAndReveal awards points: +100 for finding the truth, +50 to a liar per
// player they fooled.
func (g *FibberGame) scoreAndReveal() {
	g.gained = make(map[string]int)
	for voter, idx := range g.picks {
		if idx < 0 || idx >= len(g.options) {
			continue
		}
		opt := g.options[idx]
		if opt.Truth {
			g.gained[voter] += 100
		} else if opt.Author != "" && opt.Author != voter {
			g.gained[opt.Author] += 50
		}
	}
	for id, pts := range g.gained {
		g.scores[id] += pts
	}
	// Ensure everyone has a score entry.
	for _, id := range g.connected() {
		if _, ok := g.scores[id]; !ok {
			g.scores[id] = 0
		}
	}
	g.phase = "reveal"
	g.deadline = time.Now().Add(FibberRevealSeconds * time.Second)
	g.deadlineTag = "reveal"
}

func (g *FibberGame) OnPlayerJoin(playerID string) {}

func (g *FibberGame) OnPlayerLeave(playerID string) {
	delete(g.picks, playerID)
	if g.phase == "writing" {
		// Their lie never made it to the vote — drop it. Once choosing has
		// started the lie stays on the board.
		delete(g.lies, playerID)
	}
	g.advanceIfComplete()
}

func (g *FibberGame) OnRoomChange() {
	g.advanceIfComplete()
}

func (g *FibberGame) advanceIfComplete() {
	switch g.phase {
	case "writing":
		if g.allWritten() {
			g.enterChoosing()
		}
	case "choosing":
		if g.allPicked() {
			g.scoreAndReveal()
		}
	}
}

func (g *FibberGame) OnTimer(name string) {
	switch {
	case name == "write" && g.phase == "writing":
		g.enterChoosing()
	case name == "choose" && g.phase == "choosing":
		g.scoreAndReveal()
	case name == "reveal" && g.phase == "reveal":
		g.startRound()
	}
}

func (g *FibberGame) NextDeadline() (string, time.Time, bool) {
	if g.finished {
		return "", time.Time{}, false
	}
	return g.deadlineTag, g.deadline, true
}

func (g *FibberGame) Shift(delta time.Duration) {
	g.deadline = g.deadline.Add(delta)
}

func (g *FibberGame) Status() Status {
	if g.finished {
		return StatusFinished
	}
	return StatusRunning
}

func (g *FibberGame) Standings() []Standing {
	return standings(g.scores, g.room)
}

func (g *FibberGame) OnAction(playerID string, payload map[string]any) error {
	action, _ := payload["action"].(string)
	switch action {
	case "lie":
		if g.finished || g.phase != "writing" {
			return nil // a late submit after the phase moved on: ignore
		}
		raw, _ := payload["lie"].(string)
		return g.submitLie(playerID, raw)
	case "choose":
		if g.finished || g.phase != "choosing" {
			return nil
		}
		return g.choose(playerID, decodePayloadInt(payload, "choice"))
	default:
		return errors.New("unknown action")
	}
}

// submitLie records a player's fake answer. A lie that collides with the
// truth or another player's lie (case/accents/spacing/punctuation-insensitive)
// is not recorded: the author gets it back in PrivateState "rejected" and can
// try again, so every lie reaches the vote and nobody can smuggle the truth in.
func (g *FibberGame) submitLie(playerID, raw string) error {
	if _, done := g.lies[playerID]; done {
		return nil
	}
	lie := TruncateText(strings.Join(strings.Fields(raw), " "), fibberMaxLie)
	if lie == "" {
		return errors.New("empty lie")
	}
	key := fibberKey(lie)
	if key == "" {
		// Only punctuation / emoji: nothing to compare against the truth or
		// the other lies, so bounce it back like a duplicate.
		g.rejected[playerID] = fibberRejection{Text: lie, Reason: FibberRejectEmpty}
		return nil
	}
	if key == fibberKey(g.prompt.Answer) {
		g.rejected[playerID] = fibberRejection{Text: lie, Reason: FibberRejectTruth}
		return nil
	}
	for id, other := range g.lies {
		if id != playerID && fibberKey(other) == key {
			g.rejected[playerID] = fibberRejection{Text: lie, Reason: FibberRejectDuplicate}
			return nil
		}
	}
	delete(g.rejected, playerID)
	g.lies[playerID] = lie
	if g.allWritten() {
		g.enterChoosing()
	}
	return nil
}

func (g *FibberGame) choose(playerID string, idx int) error {
	if _, done := g.picks[playerID]; done {
		return nil
	}
	if idx < 0 || idx >= len(g.options) {
		return errors.New("invalid choice")
	}
	if g.options[idx].Author == playerID {
		return errors.New("can't pick your own lie")
	}
	g.picks[playerID] = idx
	if g.allPicked() {
		g.scoreAndReveal()
	}
	return nil
}

func (g *FibberGame) PublicState() map[string]any {
	state := map[string]any{
		"phase":       g.phase,
		"round":       g.round,
		"totalRounds": g.totalRounds,
		"prompt":      g.prompt.Q,
		"scores":      g.scores,
	}
	if !g.finished {
		state["deadline"] = g.deadline.UnixMilli()
	}
	switch g.phase {
	case "writing":
		written := make([]string, 0, len(g.lies))
		for id := range g.lies {
			written = append(written, id)
		}
		state["written"] = written
	case "choosing":
		// Options WITHOUT author/truth flags — that would give it away.
		texts := make([]string, len(g.options))
		for i, o := range g.options {
			texts[i] = o.Text
		}
		state["options"] = texts
		picked := make([]string, 0, len(g.picks))
		for id := range g.picks {
			picked = append(picked, id)
		}
		state["picked"] = picked
	case "reveal":
		// Full options (author + truth) + who picked what + the real answer.
		state["options"] = g.options
		state["picks"] = g.picks
		state["answer"] = g.prompt.Answer
		state["gained"] = g.gained
	}
	return state
}

// PrivateState is stamped with round + phase: public and private state
// arrive as separate messages, so the client must not trust a private payload
// (e.g. which option is its own lie) until it matches the public phase.
func (g *FibberGame) PrivateState(playerID string) map[string]any {
	state := map[string]any{"round": g.round, "phase": g.phase}
	if lie, ok := g.lies[playerID]; ok {
		state["lie"] = lie
	}
	if rej, ok := g.rejected[playerID]; ok && g.phase == "writing" {
		state["rejected"] = rej
	}
	if pick, ok := g.picks[playerID]; ok {
		state["choice"] = pick
	}
	// So the client can grey out the player's own lie in the choosing list.
	if g.phase == "choosing" {
		for i, o := range g.options {
			if o.Author == playerID {
				state["ownOption"] = i
				break
			}
		}
	}
	return state
}

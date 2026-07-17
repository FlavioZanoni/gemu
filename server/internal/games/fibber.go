package games

import (
	"math/rand"
	"sort"
	"time"
)

const (
	FibberDefaultRounds = 4
	FibberWriteSeconds  = 45
	FibberChooseSeconds = 30
	FibberRevealSeconds = 8
	fibberMaxLie        = 80
)

type fibberPrompt struct {
	Q      string
	Answer string
}

var fibberBank = map[string][]fibberPrompt{
	"en": {
		{"A group of flamingos is officially called a ____.", "flamboyance"},
		{"The scientific fear of long words is called ____.", "hippopotomonstrosesquippedaliophobia"},
		{"The dot over a lowercase 'i' is called a ____.", "tittle"},
		{"A baby echidna is called a ____.", "puggle"},
		{"The space between your eyebrows is called the ____.", "glabella"},
		{"The plastic tip on a shoelace is called an ____.", "aglet"},
		{"A group of owls is called a ____.", "parliament"},
		{"The wobbly bit under a turkey's chin is called a ____.", "snood"},
		{"Astronauts on the ISS see a sunrise every ____ minutes.", "90"},
		{"The fear of the number 13 is called ____.", "triskaidekaphobia"},
		{"A group of pugs is called a ____.", "grumble"},
		{"The little plastic table in a pizza box is called a ____.", "package saver"},
	},
	"pt-BR": {
		{"Um grupo de flamingos é chamado de ____.", "bando"},
		{"O ponto sobre a letra 'i' minúscula se chama ____.", "til de ponto"},
		{"A pontinha de plástico do cadarço se chama ____.", "agulheta"},
		{"O espaço entre as sobrancelhas se chama ____.", "glabela"},
		{"Um grupo de corujas é chamado de ____.", "conselho"},
		{"Astronautas na ISS veem um nascer do sol a cada ____ minutos.", "90"},
		{"O medo do número 13 se chama ____.", "triscaidecafobia"},
		{"A mesinha de plástico dentro da caixa de pizza se chama ____.", "poupa-pizza"},
		{"Um filhote de equidna é chamado de ____.", "puggle"},
		{"A parte mole embaixo do queixo do peru se chama ____.", "carúncula"},
	},
}

type FibberGame struct {
	roomID      string
	room        RoomInfo
	locale      string
	phase       string // "writing" | "choosing" | "reveal"
	round       int
	totalRounds int
	deck        []fibberPrompt
	prompt      fibberPrompt

	deadline    time.Time
	deadlineTag string

	// per-round state
	lies     map[string]string // playerID -> their fake answer
	options  []fibberOption    // shuffled truth + lies shown in choosing
	picks    map[string]int    // playerID -> chosen option index
	scores   map[string]int
	finished bool
}

// fibberOption is one shown answer; Author is "" for the truth.
type fibberOption struct {
	Text   string `json:"text"`
	Author string `json:"author"`
	Truth  bool   `json:"truth"`
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

func (g *FibberGame) Type() string { return "fibber" }

func (g *FibberGame) Start(roomID string, opts Options) {
	g.roomID = roomID
	g.room = opts.Room
	g.locale = opts.Locale
	if _, ok := fibberBank[g.locale]; !ok {
		g.locale = "en"
	}
	bank := fibberBank[g.locale]
	g.deck = make([]fibberPrompt, len(bank))
	copy(g.deck, bank)
	rand.Shuffle(len(g.deck), func(i, j int) { g.deck[i], g.deck[j] = g.deck[j], g.deck[i] })
	g.totalRounds = SettingInt(opts.Settings, "rounds", FibberDefaultRounds, 1, len(g.deck))
	g.scores = make(map[string]int)
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
	g.options = nil
	g.picks = make(map[string]int)
	g.deadline = time.Now().Add(FibberWriteSeconds * time.Second)
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

// enterChoosing builds the shuffled option list (truth + all lies, dropping a
// lie that accidentally equals the truth) and opens the vote.
func (g *FibberGame) enterChoosing() {
	opts := []fibberOption{{Text: g.prompt.Answer, Truth: true}}
	seen := map[string]bool{NormalizeAnswer(g.prompt.Answer): true}
	for id, lie := range g.lies {
		n := NormalizeAnswer(lie)
		if n == "" || seen[n] {
			continue // an empty or truth-matching lie is discarded
		}
		seen[n] = true
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
	for voter, idx := range g.picks {
		if idx < 0 || idx >= len(g.options) {
			continue
		}
		opt := g.options[idx]
		if opt.Truth {
			g.scores[voter] += 100
		} else if opt.Author != "" && opt.Author != voter {
			g.scores[opt.Author] += 50
		}
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
	delete(g.lies, playerID)
	delete(g.picks, playerID)
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

func (g *FibberGame) OnRoomChange() {
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
	seen := map[string]bool{}
	standings := make([]Standing, 0, len(g.scores))
	for id, s := range g.scores {
		standings = append(standings, Standing{PlayerID: id, Score: s})
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

func (g *FibberGame) OnAction(playerID string, payload map[string]any) error {
	if g.finished {
		return nil
	}
	switch g.phase {
	case "writing":
		if _, done := g.lies[playerID]; done {
			return nil
		}
		lie, _ := payload["lie"].(string)
		lie = truncateText(lie, fibberMaxLie)
		if lie == "" {
			return nil
		}
		g.lies[playerID] = lie
		if g.allWritten() {
			g.enterChoosing()
		}
	case "choosing":
		if _, done := g.picks[playerID]; done {
			return nil
		}
		idx := decodePayloadInt(payload, "choice")
		if idx < 0 || idx >= len(g.options) {
			return nil
		}
		// Can't pick your own lie.
		if g.options[idx].Author == playerID {
			return nil
		}
		g.picks[playerID] = idx
		if g.allPicked() {
			g.scoreAndReveal()
		}
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
	}
	return state
}

func (g *FibberGame) PrivateState(playerID string) map[string]any {
	state := map[string]any{}
	if lie, ok := g.lies[playerID]; ok {
		state["lie"] = lie
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

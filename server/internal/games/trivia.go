package games

import (
	"math/rand"
	"time"
)

const (
	TriviaDefaultRounds = 8
	TriviaAnswerSeconds = 20
	TriviaRevealSeconds = 6
)

type triviaQuestion struct {
	Q       string
	Options []string
	Correct int
}

var triviaBank = map[string][]triviaQuestion{
	"en": {
		{"Which planet is closest to the Sun?", []string{"Venus", "Mercury", "Mars", "Earth"}, 1},
		{"How many strings does a standard guitar have?", []string{"4", "5", "6", "7"}, 2},
		{"What is the largest ocean on Earth?", []string{"Atlantic", "Indian", "Arctic", "Pacific"}, 3},
		{"Which animal is known as the King of the Jungle?", []string{"Tiger", "Lion", "Elephant", "Gorilla"}, 1},
		{"What gas do plants primarily absorb?", []string{"Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"}, 2},
		{"How many continents are there?", []string{"5", "6", "7", "8"}, 2},
		{"What is the hardest natural substance?", []string{"Gold", "Iron", "Diamond", "Quartz"}, 2},
		{"Which country invented pizza?", []string{"France", "Italy", "Greece", "Spain"}, 1},
		{"What is H2O commonly known as?", []string{"Salt", "Water", "Sugar", "Acid"}, 1},
		{"How many legs does a spider have?", []string{"6", "8", "10", "12"}, 1},
		{"Which is the fastest land animal?", []string{"Lion", "Horse", "Cheetah", "Greyhound"}, 2},
		{"What color do you get mixing blue and yellow?", []string{"Green", "Purple", "Orange", "Brown"}, 0},
		{"How many minutes are in a full day?", []string{"1200", "1440", "1800", "2400"}, 1},
		{"Which planet is known as the Red Planet?", []string{"Jupiter", "Venus", "Mars", "Saturn"}, 2},
		{"What is the tallest animal in the world?", []string{"Elephant", "Giraffe", "Horse", "Camel"}, 1},
		{"How many sides does a hexagon have?", []string{"5", "6", "7", "8"}, 1},
	},
	"pt-BR": {
		{"Qual planeta é o mais próximo do Sol?", []string{"Vênus", "Mercúrio", "Marte", "Terra"}, 1},
		{"Quantas cordas tem um violão comum?", []string{"4", "5", "6", "7"}, 2},
		{"Qual é o maior oceano da Terra?", []string{"Atlântico", "Índico", "Ártico", "Pacífico"}, 3},
		{"Qual animal é conhecido como o Rei da Selva?", []string{"Tigre", "Leão", "Elefante", "Gorila"}, 1},
		{"Qual gás as plantas absorvem principalmente?", []string{"Oxigênio", "Nitrogênio", "Gás carbônico", "Hidrogênio"}, 2},
		{"Quantos continentes existem?", []string{"5", "6", "7", "8"}, 2},
		{"Qual é a substância natural mais dura?", []string{"Ouro", "Ferro", "Diamante", "Quartzo"}, 2},
		{"Qual país inventou a pizza?", []string{"França", "Itália", "Grécia", "Espanha"}, 1},
		{"Como o H2O é popularmente conhecido?", []string{"Sal", "Água", "Açúcar", "Ácido"}, 1},
		{"Quantas patas tem uma aranha?", []string{"6", "8", "10", "12"}, 1},
		{"Qual é o animal terrestre mais rápido?", []string{"Leão", "Cavalo", "Guepardo", "Galgo"}, 2},
		{"Que cor sai ao misturar azul e amarelo?", []string{"Verde", "Roxo", "Laranja", "Marrom"}, 0},
		{"Quantos minutos há em um dia inteiro?", []string{"1200", "1440", "1800", "2400"}, 1},
		{"Qual planeta é conhecido como o Planeta Vermelho?", []string{"Júpiter", "Vênus", "Marte", "Saturno"}, 2},
		{"Qual é o animal mais alto do mundo?", []string{"Elefante", "Girafa", "Cavalo", "Camelo"}, 1},
		{"Quantos lados tem um hexágono?", []string{"5", "6", "7", "8"}, 1},
	},
}

type TriviaGame struct {
	room        RoomInfo
	locale      string
	phase       string // "question" | "reveal"
	round       int
	totalRounds int
	deck        []triviaQuestion
	current     triviaQuestion
	answerSecs  int

	deadline    time.Time
	deadlineTag string

	answers map[string]int // playerID -> chosen option this round
	// answeredAt gives a speed bonus (earlier = more).
	answeredOrder []string
	scores        map[string]int
	finished      bool
}

func NewTriviaFactory() Factory {
	return Factory{
		Type:       "trivia",
		Name:       "Trivia",
		MinPlayers: 2,
		New: func() Adapter {
			return &TriviaGame{}
		},
	}
}


func (g *TriviaGame) Start(roomID string, opts Options) {
	g.room = opts.Room
	g.locale = opts.Locale
	if _, ok := triviaBank[g.locale]; !ok {
		g.locale = "en"
	}
	bank := triviaBank[g.locale]
	g.deck = make([]triviaQuestion, len(bank))
	copy(g.deck, bank)
	rand.Shuffle(len(g.deck), func(i, j int) { g.deck[i], g.deck[j] = g.deck[j], g.deck[i] })

	maxRounds := len(g.deck)
	g.totalRounds = SettingInt(opts.Settings, "rounds", TriviaDefaultRounds, 1, maxRounds)
	g.answerSecs = SettingInt(opts.Settings, "answerSeconds", TriviaAnswerSeconds, 10, 60)
	g.scores = make(map[string]int)
	if g.room != nil {
		for _, id := range g.room.ConnectedPlayerIDs() {
			g.scores[id] = 0
		}
	}
	g.round = 0
	g.startQuestion()
}

func (g *TriviaGame) startQuestion() {
	if g.round >= g.totalRounds || g.round >= len(g.deck) {
		g.finished = true
		return
	}
	g.current = g.deck[g.round]
	g.round++
	g.phase = "question"
	g.answers = make(map[string]int)
	g.answeredOrder = nil
	g.deadline = time.Now().Add(time.Duration(g.answerSecs) * time.Second)
	g.deadlineTag = "answer"
}

func (g *TriviaGame) connectedCount() int {
	if g.room == nil {
		return 0
	}
	return len(g.room.ConnectedPlayerIDs())
}

func (g *TriviaGame) allAnswered() bool {
	c := g.connectedCount()
	return c > 0 && len(g.answers) >= c
}

// scoreAndReveal awards points and enters the reveal phase.
func (g *TriviaGame) scoreAndReveal() {
	// Correct answers earn 100, plus a speed bonus by answer order.
	rankBonus := map[string]int{}
	rank := 0
	for _, id := range g.answeredOrder {
		if g.answers[id] == g.current.Correct {
			bonus := 50 - 10*rank
			if bonus < 0 {
				bonus = 0
			}
			rankBonus[id] = bonus
			rank++
		}
	}
	for id, choice := range g.answers {
		if choice == g.current.Correct {
			g.scores[id] += 100 + rankBonus[id]
		}
	}
	g.phase = "reveal"
	g.deadline = time.Now().Add(TriviaRevealSeconds * time.Second)
	g.deadlineTag = "reveal"
}

func (g *TriviaGame) OnPlayerJoin(playerID string) {}

func (g *TriviaGame) OnPlayerLeave(playerID string) {
	delete(g.answers, playerID)
	if g.phase == "question" && g.allAnswered() {
		g.scoreAndReveal()
	}
}

func (g *TriviaGame) OnRoomChange() {
	if g.phase == "question" && g.allAnswered() {
		g.scoreAndReveal()
	}
}

func (g *TriviaGame) OnTimer(name string) {
	switch {
	case name == "answer" && g.phase == "question":
		g.scoreAndReveal()
	case name == "reveal" && g.phase == "reveal":
		g.startQuestion()
	}
}

func (g *TriviaGame) NextDeadline() (string, time.Time, bool) {
	if g.finished {
		return "", time.Time{}, false
	}
	return g.deadlineTag, g.deadline, true
}

func (g *TriviaGame) Status() Status {
	if g.finished {
		return StatusFinished
	}
	return StatusRunning
}

func (g *TriviaGame) Standings() []Standing {
	return standings(g.scores, g.room)
}

func (g *TriviaGame) OnAction(playerID string, payload map[string]any) error {
	if g.finished || g.phase != "question" {
		return nil
	}
	if _, done := g.answers[playerID]; done {
		return nil // one answer per question
	}
	choice := decodePayloadInt(payload, "choice")
	if choice < 0 || choice >= len(g.current.Options) {
		return nil
	}
	g.answers[playerID] = choice
	g.answeredOrder = append(g.answeredOrder, playerID)
	if g.allAnswered() {
		g.scoreAndReveal()
	}
	return nil
}

func (g *TriviaGame) Shift(delta time.Duration) {
	g.deadline = g.deadline.Add(delta)
}

func (g *TriviaGame) PublicState() map[string]any {
	answered := make([]string, 0, len(g.answers))
	for id := range g.answers {
		answered = append(answered, id)
	}
	state := map[string]any{
		"phase":       g.phase,
		"round":       g.round,
		"totalRounds": g.totalRounds,
		"question":    g.current.Q,
		"options":     g.current.Options,
		"scores":      g.scores,
		"answered":    answered,
	}
	if !g.finished {
		state["deadline"] = g.deadline.UnixMilli()
	}
	if g.phase == "reveal" {
		state["correct"] = g.current.Correct
		// Per-player choice, revealed only at the end of the question.
		state["choices"] = g.answers
	}
	return state
}

func (g *TriviaGame) PrivateState(playerID string) map[string]any {
	if choice, ok := g.answers[playerID]; ok {
		return map[string]any{"choice": choice}
	}
	return map[string]any{}
}

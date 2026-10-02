package games

import (
	"errors"
	"math/rand"
	"time"
)

// Host settings: "rounds" (1–TriviaMaxRounds, capped by the question pool)
// and "answerSeconds" (TriviaMinAnswerSeconds–TriviaMaxAnswerSeconds).
const (
	TriviaDefaultRounds    = 8
	TriviaMaxRounds        = 20
	TriviaAnswerSeconds    = 20
	TriviaMinAnswerSeconds = 10
	TriviaMaxAnswerSeconds = 60
	TriviaRevealSeconds    = 6
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
		{"Which gas do plants absorb for photosynthesis?", []string{"Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"}, 2},
		{"What is the hardest natural substance?", []string{"Gold", "Iron", "Diamond", "Quartz"}, 2},
		{"Pizza Margherita is a classic from which Italian city?", []string{"Rome", "Naples", "Milan", "Venice"}, 1},
		{"What is H2O commonly known as?", []string{"Salt", "Water", "Sugar", "Vinegar"}, 1},
		{"How many legs does a spider have?", []string{"6", "8", "10", "12"}, 1},
		{"Which is the fastest land animal?", []string{"Lion", "Horse", "Cheetah", "Greyhound"}, 2},
		{"Which color do you get by mixing blue and yellow paint?", []string{"Green", "Purple", "Orange", "Brown"}, 0},
		{"How many minutes are in a full day?", []string{"1200", "1440", "1800", "2400"}, 1},
		{"Which planet is known as the Red Planet?", []string{"Jupiter", "Venus", "Mars", "Saturn"}, 2},
		{"What is the tallest animal in the world?", []string{"Elephant", "Giraffe", "Horse", "Camel"}, 1},
		{"How many sides does a hexagon have?", []string{"5", "6", "7", "8"}, 1},
		{"What is the chemical symbol for gold?", []string{"Ag", "Au", "Gd", "Go"}, 1},
		{"How many players per team are on the field in a soccer match?", []string{"9", "10", "11", "12"}, 2},
		{"Which is the largest planet in the Solar System?", []string{"Saturn", "Jupiter", "Neptune", "Uranus"}, 1},
		{"In which year did humans first land on the Moon?", []string{"1965", "1969", "1972", "1959"}, 1},
		{"Who painted the Mona Lisa?", []string{"Michelangelo", "Raphael", "Leonardo da Vinci", "Donatello"}, 2},
		{"What is the capital of Australia?", []string{"Sydney", "Melbourne", "Canberra", "Perth"}, 2},
		{"What is the longest river in South America?", []string{"Amazon", "Paraná", "São Francisco", "Orinoco"}, 0},
		{"How many bones are in the adult human body?", []string{"186", "206", "226", "246"}, 1},
		{"Which organ pumps blood through the body?", []string{"Liver", "Lungs", "Heart", "Kidneys"}, 2},
		{"At sea level, water boils at how many degrees Celsius?", []string{"90", "100", "110", "120"}, 1},
		{"Which of these instruments usually has 88 keys?", []string{"Harp", "Piano", "Violin", "Flute"}, 1},
		{"What is the smallest prime number?", []string{"0", "1", "2", "3"}, 2},
		{"Which language has the most native speakers?", []string{"English", "Spanish", "Mandarin Chinese", "Hindi"}, 2},
		{"How many hearts does an octopus have?", []string{"1", "2", "3", "4"}, 2},
		{"Which country has won the most FIFA World Cups?", []string{"Germany", "Italy", "Brazil", "Argentina"}, 2},
		{"Water freezes at how many degrees Fahrenheit?", []string{"0", "32", "100", "212"}, 1},
		{"Which gas makes up most of Earth's atmosphere?", []string{"Oxygen", "Carbon dioxide", "Nitrogen", "Argon"}, 2},
		{"Who wrote \"Romeo and Juliet\"?", []string{"Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"}, 1},
		{"What is the largest animal that has ever lived?", []string{"African elephant", "Blue whale", "Sperm whale", "Argentinosaurus"}, 1},
		{"How many degrees are in a right angle?", []string{"45", "90", "180", "360"}, 1},
		{"Which metal is liquid at room temperature?", []string{"Mercury", "Lead", "Tin", "Aluminum"}, 0},
		{"What is the capital of Canada?", []string{"Toronto", "Vancouver", "Ottawa", "Montreal"}, 2},
		{"Which planet is famous for its bright, wide rings?", []string{"Mars", "Saturn", "Venus", "Mercury"}, 1},
		{"What is the main ingredient of guacamole?", []string{"Tomato", "Avocado", "Onion", "Lime"}, 1},
		{"How many days are in a leap year?", []string{"364", "365", "366", "367"}, 2},
		{"What is the closest star to Earth?", []string{"Sirius", "Proxima Centauri", "The Sun", "Polaris"}, 2},
		{"Which shape has eight sides?", []string{"Hexagon", "Heptagon", "Octagon", "Nonagon"}, 2},
		{"What is the square root of 144?", []string{"10", "11", "12", "14"}, 2},
		{"In which country do wild kangaroos live?", []string{"Australia", "New Zealand", "South Africa", "Argentina"}, 0},
		{"Which ocean lies between Africa and Australia?", []string{"Atlantic", "Pacific", "Indian", "Arctic"}, 2},
		{"How many planets are in the Solar System?", []string{"7", "8", "9", "10"}, 1},
		{"Which vitamin does your skin make when exposed to sunlight?", []string{"Vitamin A", "Vitamin B12", "Vitamin C", "Vitamin D"}, 3},
		{"What is the currency of Japan?", []string{"Yuan", "Won", "Yen", "Ringgit"}, 2},
	},
	"pt-BR": {
		{"Qual planeta é o mais próximo do Sol?", []string{"Vênus", "Mercúrio", "Marte", "Terra"}, 1},
		{"Quantas cordas tem um violão comum?", []string{"4", "5", "6", "7"}, 2},
		{"Qual é o maior oceano da Terra?", []string{"Atlântico", "Índico", "Ártico", "Pacífico"}, 3},
		{"Qual animal é conhecido como o Rei da Selva?", []string{"Tigre", "Leão", "Elefante", "Gorila"}, 1},
		{"Qual gás as plantas absorvem na fotossíntese?", []string{"Oxigênio", "Nitrogênio", "Gás carbônico", "Hidrogênio"}, 2},
		{"Qual é a substância natural mais dura?", []string{"Ouro", "Ferro", "Diamante", "Quartzo"}, 2},
		{"A pizza margherita é um clássico de qual cidade italiana?", []string{"Roma", "Nápoles", "Milão", "Veneza"}, 1},
		{"Como o H2O é popularmente conhecido?", []string{"Sal", "Água", "Açúcar", "Vinagre"}, 1},
		{"Quantas patas tem uma aranha?", []string{"6", "8", "10", "12"}, 1},
		{"Qual é o animal terrestre mais rápido?", []string{"Leão", "Cavalo", "Guepardo", "Galgo"}, 2},
		{"Que cor sai ao misturar tinta azul e amarela?", []string{"Verde", "Roxo", "Laranja", "Marrom"}, 0},
		{"Quantos minutos há em um dia inteiro?", []string{"1200", "1440", "1800", "2400"}, 1},
		{"Qual planeta é conhecido como o Planeta Vermelho?", []string{"Júpiter", "Vênus", "Marte", "Saturno"}, 2},
		{"Qual é o animal mais alto do mundo?", []string{"Elefante", "Girafa", "Cavalo", "Camelo"}, 1},
		{"Quantos lados tem um hexágono?", []string{"5", "6", "7", "8"}, 1},
		{"Qual é o símbolo químico do ouro?", []string{"Ag", "Au", "Gd", "Ou"}, 1},
		{"Quantos jogadores de cada time ficam em campo numa partida de futebol?", []string{"9", "10", "11", "12"}, 2},
		{"Qual é o maior planeta do Sistema Solar?", []string{"Saturno", "Júpiter", "Netuno", "Urano"}, 1},
		{"Em que ano o ser humano pisou na Lua pela primeira vez?", []string{"1965", "1969", "1972", "1959"}, 1},
		{"Quem pintou a Mona Lisa?", []string{"Michelangelo", "Rafael", "Leonardo da Vinci", "Donatello"}, 2},
		{"Qual é a capital da Austrália?", []string{"Sydney", "Melbourne", "Camberra", "Perth"}, 2},
		{"Qual é o rio mais longo da América do Sul?", []string{"Amazonas", "Paraná", "São Francisco", "Orinoco"}, 0},
		{"Quantos ossos tem o corpo humano adulto?", []string{"186", "206", "226", "246"}, 1},
		{"Qual órgão bombeia o sangue pelo corpo?", []string{"Fígado", "Pulmões", "Coração", "Rins"}, 2},
		{"Ao nível do mar, a água ferve a quantos graus Celsius?", []string{"90", "100", "110", "120"}, 1},
		{"Qual destes instrumentos costuma ter 88 teclas?", []string{"Harpa", "Piano", "Violino", "Flauta"}, 1},
		{"Qual é o menor número primo?", []string{"0", "1", "2", "3"}, 2},
		{"Qual idioma tem mais falantes nativos?", []string{"Inglês", "Espanhol", "Mandarim", "Híndi"}, 2},
		{"Quantos corações tem um polvo?", []string{"1", "2", "3", "4"}, 2},
		{"Qual país ganhou mais Copas do Mundo da FIFA?", []string{"Alemanha", "Itália", "Brasil", "Argentina"}, 2},
		{"A água congela a quantos graus Fahrenheit?", []string{"0", "32", "100", "212"}, 1},
		{"Qual gás forma a maior parte da atmosfera da Terra?", []string{"Oxigênio", "Gás carbônico", "Nitrogênio", "Argônio"}, 2},
		{"Quem escreveu \"Romeu e Julieta\"?", []string{"Machado de Assis", "William Shakespeare", "Jane Austen", "Mark Twain"}, 1},
		{"Qual é o maior animal que já existiu?", []string{"Elefante-africano", "Baleia-azul", "Cachalote", "Argentinossauro"}, 1},
		{"Quantos graus tem um ângulo reto?", []string{"45", "90", "180", "360"}, 1},
		{"Qual metal é líquido à temperatura ambiente?", []string{"Mercúrio", "Chumbo", "Estanho", "Alumínio"}, 0},
		{"Qual é a capital do Canadá?", []string{"Toronto", "Vancouver", "Ottawa", "Montreal"}, 2},
		{"Qual planeta é famoso pelos seus anéis largos e brilhantes?", []string{"Marte", "Saturno", "Vênus", "Mercúrio"}, 1},
		{"Qual é o ingrediente principal do guacamole?", []string{"Tomate", "Abacate", "Cebola", "Limão"}, 1},
		{"Quantos dias tem um ano bissexto?", []string{"364", "365", "366", "367"}, 2},
		{"Qual é a estrela mais próxima da Terra?", []string{"Sírius", "Proxima Centauri", "O Sol", "Estrela Polar"}, 2},
		{"Qual figura tem oito lados?", []string{"Hexágono", "Heptágono", "Octógono", "Eneágono"}, 2},
		{"Qual é a raiz quadrada de 144?", []string{"10", "11", "12", "14"}, 2},
		{"Em que país vivem cangurus selvagens?", []string{"Austrália", "Nova Zelândia", "África do Sul", "Argentina"}, 0},
		{"Qual oceano fica entre a África e a Austrália?", []string{"Atlântico", "Pacífico", "Índico", "Ártico"}, 2},
		{"Quantos planetas há no Sistema Solar?", []string{"7", "8", "9", "10"}, 1},
		{"Qual vitamina a pele produz quando exposta ao sol?", []string{"Vitamina A", "Vitamina B12", "Vitamina C", "Vitamina D"}, 3},
		{"Qual é a moeda do Japão?", []string{"Yuan", "Won", "Iene", "Ringgit"}, 2},
		{"Qual é a capital do Brasil?", []string{"Rio de Janeiro", "São Paulo", "Brasília", "Salvador"}, 2},
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
	// answeredOrder gives a speed bonus (earlier = more).
	answeredOrder []string
	gained        map[string]int // points earned this question (shown on reveal)
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

	maxRounds := min(TriviaMaxRounds, len(g.deck))
	g.totalRounds = SettingInt(opts.Settings, "rounds", TriviaDefaultRounds, 1, maxRounds)
	g.answerSecs = SettingInt(opts.Settings, "answerSeconds", TriviaAnswerSeconds, TriviaMinAnswerSeconds, TriviaMaxAnswerSeconds)
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
	g.gained = nil
	g.deadline = time.Now().Add(time.Duration(g.answerSecs) * time.Second)
	g.deadlineTag = "answer"
}

// allAnswered reports whether every CONNECTED player has locked an answer.
// Answers from players who since disconnected don't count toward the total,
// so a drop-out can never trigger an early reveal.
func (g *TriviaGame) allAnswered() bool {
	if g.room == nil {
		return false
	}
	connected := g.room.ConnectedPlayerIDs()
	if len(connected) == 0 {
		return false
	}
	for _, id := range connected {
		if _, ok := g.answers[id]; !ok {
			return false
		}
	}
	return true
}

// scoreAndReveal awards points and enters the reveal phase.
func (g *TriviaGame) scoreAndReveal() {
	// Correct answers earn 100, plus a speed bonus by answer order.
	g.gained = make(map[string]int)
	rank := 0
	for _, id := range g.answeredOrder {
		choice, ok := g.answers[id]
		if !ok || choice != g.current.Correct {
			continue
		}
		bonus := max(0, 50-10*rank)
		rank++
		g.gained[id] = 100 + bonus
		g.scores[id] += 100 + bonus
	}
	if g.room != nil {
		for _, id := range g.room.ConnectedPlayerIDs() {
			if _, ok := g.scores[id]; !ok {
				g.scores[id] = 0
			}
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
	action, _ := payload["action"].(string)
	if action != "answer" {
		return errors.New("unknown action")
	}
	if g.finished || g.phase != "question" {
		return nil // a late click after the reveal: harmless, ignore
	}
	if _, done := g.answers[playerID]; done {
		return nil // one answer per question
	}
	choice := decodePayloadInt(payload, "choice")
	if choice < 0 || choice >= len(g.current.Options) {
		return errors.New("invalid choice")
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
	for _, id := range g.answeredOrder {
		if _, ok := g.answers[id]; ok {
			answered = append(answered, id)
		}
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
		state["gained"] = g.gained
	}
	return state
}

// PrivateState is stamped with the round so the client can tell a fresh
// private payload from the previous question's (public and private state
// arrive as separate messages).
func (g *TriviaGame) PrivateState(playerID string) map[string]any {
	state := map[string]any{"round": g.round}
	if choice, ok := g.answers[playerID]; ok {
		state["choice"] = choice
	}
	return state
}

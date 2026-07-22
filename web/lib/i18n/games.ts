// Game-screen strings (Stop, Gartic, Gartic Phone, Cartas, Patently Silly).
// Owned by the game-screens implementation; add keys here as games need them.
export const games = {
  en: {
    // Stop! — How to play steps
    "howto.stop.1": "Race the clock to write an answer for each category that starts with the given letter.",
    "howto.stop.2": "Press STOP when you're done, or wait for the timer to run out.",
    "howto.stop.3": "In the validation round, vote on which answers are valid (answers that don't start with the letter or are blank are auto-invalid).",
    "howto.stop.4": "Unique answers earn 10 points, duplicates earn 5, invalid answers earn 0. Highest score wins!",

    // Gartic — How to play steps
    "howto.gartic.1": "One player draws a word while others guess before the timer runs out — don't be shy!",
    "howto.gartic.2": "The first correct guesser scores 100 points (−10 for each guess after), and the drawer gets 25 points per correct guess.",
    "howto.gartic.3": "After everyone has drawn once per round, the scores reset and the next drawer is up.",

    // Gartic Phone — How to play steps
    "howto.garticphone.1": "Everyone writes a prompt. Chains rotate through the group, alternating between drawing and describing.",
    "howto.garticphone.2": "If you miss a submission, the chain auto-fills (a blank drawing or '…'). Draw what you see, describe what you read.",
    "howto.garticphone.3": "During the reveal (admin-paced), react to each entry with a like. Likes earn the entry's author 10 points.",
    "howto.garticphone.4": "Watch how your prompt transforms as it passes through the chain — it's always a surprise!",

    // Cartas (CAH) — How to play steps
    "howto.cah.1": "You have a hand of 5 white cards. Read the black card — it's a fill-in-the-blank or a multi-blank prompt.",
    "howto.cah.2": "Submit the exact number of cards the black card asks for. The judge shuffles all submissions and picks the funniest one.",
    "howto.cah.3": "Scoring: each round win is 1 point. The player with the most wins at the end is the Funniest Person.",

    // Invention (Patently Silly) — How to play steps
    "howto.invention.1": "Write down a silly problem. Other players will draw an invention to solve it.",
    "howto.invention.2": "When it's your turn, draw an invention for an assigned silly problem before the timer ends.",
    "howto.invention.3": "Present your invention and explain how it solves the problem. Be as ridiculous as you want!",
    "howto.invention.4": "Vote by allocating your funding points to inventions. Higher scores = funnier inventions.",

    // Invention game UI
    "invention.collecting": "Collecting Problems",
    "invention.collecting.desc": "Write silly problems",
    "invention.drawing": "Drawing Phase",
    "invention.drawing.desc": "Invent something ridiculous",
    "invention.presenting": "Presentation",
    "invention.presenting.desc": "Behold these inventions",
    "invention.voting": "Funding Vote",
    "invention.voting.desc": "Fund your favorites",
    "invention.results": "Round Results",
    "invention.finalResults": "Final Results",
    "invention.problemsSubmitted": "{count} of {total} problems submitted",
    "invention.drawingsSubmitted": "{count} of {total} drawing(s) done",
    "invention.votesSubmitted": "{count} of {total} voted",
    "invention.yourProblem": "Your assigned problem",
    "invention.waitingAssignment": "Waiting for assignment…",
    "invention.inventionTitle": "Invention title",
    "invention.tagline": "Tagline",
    "invention.nextDraw": "Next: Draw your invention",
    "invention.drawFor": "Draw your invention for:",
    "invention.submitInvention": "Submit invention",
    "invention.nextInvention": "Next invention",
    "invention.skipVoting": "Skip to voting",
    "invention.hostAdvance": "Host: skip the wait ▶",
    "invention.fundingBudget": "Allocate your {budget} across these inventions",
    "invention.submitFunding": "Submit funding",
    "invention.finalWinner": "{name} wins with {amount}!",
    "invention.noWinner": "No winner",
    "invention.nextRound": "Next round",
    "invention.waitingRound": "Waiting for host to start next round…",
    "invention.backToLobby": "Back to lobby",

    // Trivia
    "howto.trivia.1": "A question appears with four answers. Tap the one you think is right.",
    "howto.trivia.2": "You get 100 points for a correct answer, plus a speed bonus for answering early.",
    "howto.trivia.3": "The correct answer is revealed each round. Most points at the end wins!",
    "trivia.locked": "Answer locked — waiting for everyone…",
    "trivia.answeredCount": "{n} answered",

    // Fibber
    "howto.fibber.1": "Everyone gets an obscure question. Write a fake answer that sounds real.",
    "howto.fibber.2": "All fakes plus the real answer are shuffled together. Pick the one you think is true.",
    "howto.fibber.3": "+100 for finding the truth. +50 every time someone falls for your lie!",
    "fibber.prompt": "Fill the blank",
    "fibber.writeLie": "Write a convincing fake answer",
    "fibber.liePlaceholder": "make it believable…",
    "fibber.submitLie": "Submit my fib",
    "fibber.lieIn": "Fib submitted — waiting for the others…",
    "fibber.findTruth": "Which one is the REAL answer?",
    "fibber.yourLie": "your fib",
    "fibber.theTruth": "The real answer was",
    "fibber.truthTag": "TRUTH",
    "fibber.by": "by",
    "fibber.pickedBy": "Fooled",

    // Canvas & drawing

    // Stop game UI
    "stop.validate": "Validate",
    "stop.validated": "You've validated",
    "stop.nextRound": "Next round",
    "stop.unique": "Unique",
    "stop.duplicate": "Duplicate",
    "stop.invalid": "Invalid",

    // Gartic game UI

    // Gartic Phone game UI
    "garticphone.gameOver": "Game over!",

    // Cartas (CAH) game UI

    // Waiting states
    "game.waiting": "WAITING FOR OTHERS…",
  },
  "pt-BR": {
    // Stop! — How to play steps
    "howto.stop.1": "Corra contra o relógio para escrever uma resposta para cada categoria que começa com a letra dada.",
    "howto.stop.2": "Pressione STOP quando terminar, ou aguarde a contagem regressiva acabar.",
    "howto.stop.3": "Na rodada de validação, vote em quais respostas são válidas (respostas que não começam com a letra ou em branco são automaticamente inválidas).",
    "howto.stop.4": "Respostas únicas valem 10 pontos, duplicadas 5, inválidas 0. Maior pontuação vence!",

    // Gartic — How to play steps
    "howto.gartic.1": "Um jogador desenha uma palavra enquanto os outros adivinham antes do tempo acabar — não seja tímido!",
    "howto.gartic.2": "O primeiro a adivinhar corretamente ganha 100 pontos (−10 para cada palpite depois), e o desenhista ganha 25 pontos por acerto.",
    "howto.gartic.3": "Depois que todos desenharem uma vez por rodada, os pontos são zerados e o próximo desenhista começa.",

    // Gartic Phone — How to play steps
    "howto.garticphone.1": "Todos escrevem um prompt. As cadeias giram pelo grupo, alternando entre desenhar e descrever.",
    "howto.garticphone.2": "Se você perder um envio, a cadeia se auto-completa (um desenho em branco ou '…'). Desenhe o que vê, descreva o que lê.",
    "howto.garticphone.3": "Durante a revelação (controlada pelo administrador), reaja a cada entrada com um curtida. Curtidas ganham 10 pontos para o autor da entrada.",
    "howto.garticphone.4": "Veja como seu prompt se transforma conforme passa pela cadeia — sempre uma surpresa!",

    // Cartas (CAH) — How to play steps
    "howto.cah.1": "Você tem uma mão de 5 cartas brancas. Leia a carta preta — é um preenchimento em branco ou um prompt multi-branco.",
    "howto.cah.2": "Envie exatamente o número de cartas que a carta preta pede. O juiz embaralha todos os envios e escolhe o mais engraçado.",
    "howto.cah.3": "Pontuação: cada vitória de rodada vale 1 ponto. O jogador com mais vitórias no final é a Pessoa Mais Engraçada.",

    // Invention (Patentemente Bobo) — How to play steps
    "howto.invention.1": "Escreva um problema bobo. Outros jogadores desenharão uma invenção para resolvê-lo.",
    "howto.invention.2": "Quando for sua vez, desenhe uma invenção para um problema bobo atribuído antes do tempo acabar.",
    "howto.invention.3": "Apresente sua invenção e explique como ela resolve o problema. Seja o mais ridículo possível!",
    "howto.invention.4": "Vote alocando seus pontos de financiamento para invenções. Pontuações mais altas = invenções mais engraçadas.",

    // Invention game UI
    "invention.collecting": "Coletando Problemas",
    "invention.collecting.desc": "Escreva problemas bobos",
    "invention.drawing": "Fase de Desenho",
    "invention.drawing.desc": "Invente algo ridículo",
    "invention.presenting": "Apresentação",
    "invention.presenting.desc": "Veja essas invenções",
    "invention.voting": "Votação de Financiamento",
    "invention.voting.desc": "Financie seus favoritos",
    "invention.results": "Resultados da Rodada",
    "invention.finalResults": "Resultados Finais",
    "invention.problemsSubmitted": "{count} de {total} problemas enviados",
    "invention.drawingsSubmitted": "{count} de {total} desenho(s) concluído(s)",
    "invention.votesSubmitted": "{count} de {total} votaram",
    "invention.yourProblem": "Seu problema atribuído",
    "invention.waitingAssignment": "Aguardando atribuição…",
    "invention.inventionTitle": "Título da invenção",
    "invention.tagline": "Slogan",
    "invention.nextDraw": "Próximo: Desenhe sua invenção",
    "invention.drawFor": "Desenhe sua invenção para:",
    "invention.submitInvention": "Enviar invenção",
    "invention.nextInvention": "Próxima invenção",
    "invention.skipVoting": "Pular para votação",
    "invention.hostAdvance": "Anfitrião: pular a espera ▶",
    "invention.fundingBudget": "Aloque seus {budget} entre essas invenções",
    "invention.submitFunding": "Enviar financiamento",
    "invention.finalWinner": "{name} vence com {amount}!",
    "invention.noWinner": "Sem vencedor",
    "invention.nextRound": "Próxima rodada",
    "invention.waitingRound": "Aguardando o host iniciar a próxima rodada…",
    "invention.backToLobby": "Voltar ao lobby",

    // Trivia
    "howto.trivia.1": "Aparece uma pergunta com quatro respostas. Toque na que achar certa.",
    "howto.trivia.2": "Você ganha 100 pontos por acerto, mais um bônus de velocidade por responder cedo.",
    "howto.trivia.3": "A resposta certa é revelada a cada rodada. Mais pontos no fim vence!",
    "trivia.locked": "Resposta travada — esperando todo mundo…",
    "trivia.answeredCount": "{n} responderam",

    // Fibber
    "howto.fibber.1": "Todos recebem uma pergunta obscura. Escreva uma resposta falsa que pareça real.",
    "howto.fibber.2": "As falsas e a verdadeira são embaralhadas. Escolha a que você acha verdadeira.",
    "howto.fibber.3": "+100 por achar a verdade. +50 cada vez que alguém cai na sua mentira!",
    "fibber.prompt": "Complete a lacuna",
    "fibber.writeLie": "Escreva uma resposta falsa convincente",
    "fibber.liePlaceholder": "faça parecer real…",
    "fibber.submitLie": "Enviar minha mentira",
    "fibber.lieIn": "Mentira enviada — esperando os outros…",
    "fibber.findTruth": "Qual é a resposta VERDADEIRA?",
    "fibber.yourLie": "sua mentira",
    "fibber.theTruth": "A resposta real era",
    "fibber.truthTag": "VERDADE",
    "fibber.by": "de",
    "fibber.pickedBy": "Enganou",

    // Canvas & drawing

    // Stop game UI
    "stop.validate": "Validar",
    "stop.validated": "Você validou",
    "stop.nextRound": "Próxima rodada",
    "stop.unique": "Única",
    "stop.duplicate": "Duplicada",
    "stop.invalid": "Inválida",

    // Gartic game UI

    // Gartic Phone game UI
    "garticphone.gameOver": "Fim de jogo!",

    // Cartas (CAH) game UI

    // Waiting states
    "game.waiting": "AGUARDANDO OUTROS…",
  },
} as const;

// Game-screen strings (Stop, Gartic, Gartic Phone, Cartas, Patently Silly).
// Owned by the game-screens implementation; add keys here as games need them.
export const games = {
  en: {
    // Stop! — How to play steps
    "howto.stop.1": "Everyone has {n} seconds to write an answer for each category that starts with the given letter.",
    "howto.stop.2": "Press STOP when you're done, or wait for the timer to run out.",
    "howto.stop.3": "In the validation round, vote on which answers are valid (answers that don't start with the letter or are blank are auto-invalid).",
    "howto.stop.4": "Unique answers earn 10 points, duplicates earn 5, invalid answers earn 0. Highest score wins!",

    // Gartic — How to play steps
    "howto.gartic.1": "One player draws a word while others guess. You have {n} seconds to guess — don't be shy!",
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
    "howto.invention.2": "When it's your turn, draw an invention for an assigned silly problem. You have {n} seconds.",
    "howto.invention.3": "Present your invention and explain how it solves the problem. Be as ridiculous as you want!",
    "howto.invention.4": "Vote by allocating your {n} funding points to inventions. Higher scores = funnier inventions.",

    // Canvas & drawing
    "canvas.color": "Color",
    "canvas.brush": "Brush",
    "canvas.eraser": "Eraser",
    "canvas.undo": "Undo",
    "canvas.clear": "Clear",

    // Stop game UI
    "stop.letter": "Letter: {letter}",
    "stop.answerFor": "Answer for {category}",
    "stop.timeRemaining": "Time remaining",
    "stop.stopButton": "STOP!",
    "stop.validate": "Validate",
    "stop.validated": "You've validated",
    "stop.nextRound": "Next round",
    "stop.results": "Round {n} Results",
    "stop.unique": "Unique",
    "stop.duplicate": "Duplicate",
    "stop.invalid": "Invalid",
    "stop.score": "{points} pts",

    // Gartic game UI
    "gartic.word": "Word to draw",
    "gartic.guess": "Guess the word",
    "gartic.guessedIt": "Guessed it!",
    "gartic.drawer": "{name} is drawing…",
    "gartic.closeGuess": "You were close: {word}",
    "gartic.round": "Round {n} of {total}",

    // Gartic Phone game UI
    "garticphone.writePrompt": "Write a prompt",
    "garticphone.drawPrompt": "Draw the text",
    "garticphone.describeDrawing": "Describe the drawing",
    "garticphone.submitPrompt": "Submit prompt",
    "garticphone.submitDrawing": "Submit drawing",
    "garticphone.submitDescription": "Submit description",
    "garticphone.waiting": "Waiting for other players…",
    "garticphone.reveal": "Reveal",
    "garticphone.nextEntry": "Next",
    "garticphone.gameOver": "Game over!",
    "garticphone.chain": "Chain {n}",

    // Cartas (CAH) game UI
    "cah.hand": "Your hand",
    "cah.blackCard": "Black card",
    "cah.selectCards": "Select {n} card{s}",
    "cah.submit": "Submit",
    "cah.judging": "Judging…",
    "cah.judge": "{name} is judging…",
    "cah.roundResults": "Round {n} Results",
    "cah.winner": "{name} wins this round!",
    "cah.yourWins": "Your wins: {n}",

    // Waiting states
    "game.answering": "ANSWERING…",
    "game.drawing": "DRAWING…",
    "game.writing": "WRITING…",
    "game.judging": "JUDGING…",
    "game.validating": "VALIDATING…",
    "game.revealing": "REVEAL…",
    "game.waiting": "WAITING FOR OTHERS…",
  },
  "pt-BR": {
    // Stop! — How to play steps
    "howto.stop.1": "Todos têm {n} segundos para escrever uma resposta para cada categoria que começa com a letra dada.",
    "howto.stop.2": "Pressione STOP quando terminar, ou aguarde a contagem regressiva acabar.",
    "howto.stop.3": "Na rodada de validação, vote em quais respostas são válidas (respostas que não começam com a letra ou em branco são automaticamente inválidas).",
    "howto.stop.4": "Respostas únicas valem 10 pontos, duplicadas 5, inválidas 0. Maior pontuação vence!",

    // Gartic — How to play steps
    "howto.gartic.1": "Um jogador desenha uma palavra enquanto outros adivinham. Você tem {n} segundos para adivinhar — não seja tímido!",
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
    "howto.invention.2": "Quando for sua vez, desenhe uma invenção para um problema bobo atribuído. Você tem {n} segundos.",
    "howto.invention.3": "Apresente sua invenção e explique como ela resolve o problema. Seja o mais ridículo possível!",
    "howto.invention.4": "Vote alocando seus {n} pontos de financiamento para invenções. Pontuações mais altas = invenções mais engraçadas.",

    // Canvas & drawing
    "canvas.color": "Cor",
    "canvas.brush": "Pincel",
    "canvas.eraser": "Borracha",
    "canvas.undo": "Desfazer",
    "canvas.clear": "Limpar",

    // Stop game UI
    "stop.letter": "Letra: {letter}",
    "stop.answerFor": "Resposta para {category}",
    "stop.timeRemaining": "Tempo restante",
    "stop.stopButton": "STOP!",
    "stop.validate": "Validar",
    "stop.validated": "Você validou",
    "stop.nextRound": "Próxima rodada",
    "stop.results": "Resultados da Rodada {n}",
    "stop.unique": "Única",
    "stop.duplicate": "Duplicada",
    "stop.invalid": "Inválida",
    "stop.score": "{points} pts",

    // Gartic game UI
    "gartic.word": "Palavra para desenhar",
    "gartic.guess": "Adivinhe a palavra",
    "gartic.guessedIt": "Adivinhou!",
    "gartic.drawer": "{name} está desenhando…",
    "gartic.closeGuess": "Você estava perto: {word}",
    "gartic.round": "Rodada {n} de {total}",

    // Gartic Phone game UI
    "garticphone.writePrompt": "Escreva um prompt",
    "garticphone.drawPrompt": "Desenhe o texto",
    "garticphone.describeDrawing": "Descreva o desenho",
    "garticphone.submitPrompt": "Enviar prompt",
    "garticphone.submitDrawing": "Enviar desenho",
    "garticphone.submitDescription": "Enviar descrição",
    "garticphone.waiting": "Aguardando outros jogadores…",
    "garticphone.reveal": "Revelar",
    "garticphone.nextEntry": "Próximo",
    "garticphone.gameOver": "Fim de jogo!",
    "garticphone.chain": "Cadeia {n}",

    // Cartas (CAH) game UI
    "cah.hand": "Sua mão",
    "cah.blackCard": "Carta preta",
    "cah.selectCards": "Selecione {n} carta{s}",
    "cah.submit": "Enviar",
    "cah.judging": "Julgando…",
    "cah.judge": "{name} está julgando…",
    "cah.roundResults": "Resultados da Rodada {n}",
    "cah.winner": "{name} vence esta rodada!",
    "cah.yourWins": "Suas vitórias: {n}",

    // Waiting states
    "game.answering": "RESPONDENDO…",
    "game.drawing": "DESENHANDO…",
    "game.writing": "ESCREVENDO…",
    "game.judging": "JULGANDO…",
    "game.validating": "VALIDANDO…",
    "game.revealing": "REVELANDO…",
    "game.waiting": "AGUARDANDO OUTROS…",
  },
} as const;

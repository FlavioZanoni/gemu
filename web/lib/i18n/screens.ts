// Screen strings (home, lobby, results, vote, podium). Owned by the screens
// implementation; add keys here as screens need them.
export const screens = {
  en: {
    // Home screen (ticket-booth layout)
    "home.stepRightUp": "Step right up",
    "home.tagline1": "One room. A playlist of games.",
    "home.tagline2": "A champion crowned by midnight.",
    "home.drawFace": "draw your face",
    "home.yourNickname": "Your nickname",
    "home.typeIt": "type it…",
    "home.createRoom": "Create a room",
    "home.orJoin": "or join the party",
    "home.codePlaceholder": "CODE…",
    "home.join": "Join",
    "home.onAir": "On air now · public rooms",
    "home.playlistCount": "Playlist · {n} games",
    "home.full": "Full",
    "home.nickFirst": "Pick a nickname to create or join",
    "home.autoRoomName": "{name}'s room",
    "avatar.title": "Draw your face",
    "avatar.hint": "Colors, shapes, brush sizes — go wild.",
    "avatar.save": "Use this face",
    "home.noRooms": "No public rooms yet. Be the first!",
    "home.joinRoomTitle": "Join room",
    "home.joinRoomDesc": "Enter the room ID and join code if required.",
    "home.displayName": "Display name",
    "home.password": "Password (optional)",
    "home.starting": "Starting...",
    "home.joinRoom": "Join room",
    "home.joining": "Joining...",
    "home.joinCode": "Join code (if private)",
    "home.live": "Live",
    "home.offline": "Offline",
    "home.drawYourAvatar": "Draw your avatar",

    // CAH deck picker
    "decks.button": "Decks",
    "decks.title": "Cartas — Decks",
    "decks.pickHint": "Tick the decks to shuffle together",
    "decks.cards": "cards",
    "decks.custom": "Custom",
    "decks.importCustom": "Import a custom deck",
    "decks.pasteLabel": "Paste deck JSON",
    "decks.pastePlaceholder": "{ \"name\": \"My deck\", \"black\": [{\"text\":\"____ ruined it.\",\"pick\":1}], \"white\": [\"...\"] }",
    "decks.addDeck": "Add deck",
    "decks.done": "Done",
    "decks.badJson": "That's not valid JSON.",
    "decks.badShape": "Deck needs a name, black[], and white[].",

    // Lobby screen
    "lobby.readyUp": "Ready up",
    "lobby.startGame": "Start game",

    // Playing screen
    "playing.howToPlay": "? How to play",

    // Results screen
    "results.title": "Game Over",
    "results.endTheNight": "End the night",
    "results.waiting": "Waiting for host...",

    // Voting screen
    "voting.title": "What's next?",
    "voting.selectGame": "Tap to select the next game",
    "voting.upComingNext": "Up coming next",

    // Podium screen
    "podium.title": "The Winners",

    // Pause overlay
    "pause.title": "Show paused",
    "pause.body": "The host froze the clock. Grab a slice — nothing moves until they're back.",
    "pause.resume": "Resume the show",
    "pause.caption": "★ Host only · timers freeze for everyone",
    "pause.pause": "Pause",

    // Edge states
    "edge.kicked": "You've been kicked",
    "edge.kickedDesc": "The host removed you from this room. You can head back to the lobby to join a different game.",
    "edge.joining": "Joining room...",
    "edge.returnToLobby": "Return to lobby",
    "edge.leaving": "Leaving room...",
    "edge.reconnecting": "Signal lost — reconnecting to the studio…",
    "edge.errorNameTaken": "That name is already taken in this room.",
    "edge.errorInvalidPassword": "Password incorrect.",
    "edge.errorRoomFull": "This room is full.",
    "edge.errorInvalidCode": "Invalid room code.",
    "edge.errorNotFound": "Room not found.",
    "edge.errorSessionInRoom": "You're already in another room.",
    "edge.errorNotEnoughPlayers": "Not enough players to start this game.",
  },
  "pt-BR": {
    // Home screen (ticket-booth layout)
    "home.stepRightUp": "Chegou, jogou",
    "home.tagline1": "Uma sala. Uma playlist de jogos.",
    "home.tagline2": "Um campeão coroado até a meia-noite.",
    "home.drawFace": "desenhe sua cara",
    "home.yourNickname": "Seu apelido",
    "home.typeIt": "digite aqui…",
    "home.orJoin": "ou entre na festa",
    "home.codePlaceholder": "CÓDIGO…",
    "home.join": "Entrar",
    "home.onAir": "No ar agora · salas públicas",
    "home.playlistCount": "Playlist · {n} jogos",
    "home.full": "Cheia",
    "home.nickFirst": "Escolha um apelido para criar ou entrar",
    "home.autoRoomName": "Sala de {name}",
    "avatar.title": "Desenhe sua cara",
    "avatar.hint": "Cores, formas, tamanhos de pincel — capriche.",
    "avatar.save": "Usar esta cara",
    "home.createRoom": "Criar sala",
    "home.noRooms": "Nenhuma sala pública ainda. Seja o primeiro!",
    "home.joinRoomTitle": "Entrar em sala",
    "home.joinRoomDesc": "Digite o ID da sala e o código de entrada se necessário.",
    "home.displayName": "Nome de exibição",
    "home.password": "Senha (opcional)",
    "home.starting": "Iniciando...",
    "home.joinRoom": "Entrar em sala",
    "home.joining": "Entrando...",
    "home.joinCode": "Código de entrada (se privada)",
    "home.live": "Ao vivo",
    "home.offline": "Offline",
    "home.drawYourAvatar": "Desenhe seu avatar",

    // CAH deck picker
    "decks.button": "Decks",
    "decks.title": "Cartas — Decks",
    "decks.pickHint": "Marque os decks para embaralhar juntos",
    "decks.cards": "cartas",
    "decks.custom": "Próprio",
    "decks.importCustom": "Importar deck próprio",
    "decks.pasteLabel": "Cole o JSON do deck",
    "decks.pastePlaceholder": "{ \"name\": \"Meu deck\", \"black\": [{\"text\":\"____ estragou tudo.\",\"pick\":1}], \"white\": [\"...\"] }",
    "decks.addDeck": "Adicionar deck",
    "decks.done": "Pronto",
    "decks.badJson": "JSON inválido.",
    "decks.badShape": "O deck precisa de name, black[] e white[].",

    // Lobby screen
    "lobby.readyUp": "Pronto",
    "lobby.startGame": "Iniciar jogo",

    // Playing screen
    "playing.howToPlay": "? Como jogar",

    // Results screen
    "results.title": "Fim do jogo",
    "results.endTheNight": "Encerrar a noite",
    "results.waiting": "Aguardando o anfitrião...",

    // Voting screen
    "voting.title": "Qual é o próximo?",
    "voting.selectGame": "Toque para selecionar o próximo jogo",
    "voting.upComingNext": "Próximo jogo",

    // Podium screen
    "podium.title": "Os Vencedores",

    // Pause overlay
    "pause.title": "Show pausado",
    "pause.body": "O anfitrião congelou o relógio. Pega uma fatia — nada anda até ele voltar.",
    "pause.resume": "Retomar o show",
    "pause.caption": "★ Só o anfitrião · o tempo congela para todos",
    "pause.pause": "Pausar",

    // Edge states
    "edge.kicked": "Você foi expulso",
    "edge.kickedDesc": "O anfitrião o removeu da sala. Você pode voltar ao lobby para entrar em um jogo diferente.",
    "edge.joining": "Entrando em sala...",
    "edge.returnToLobby": "Voltar ao lobby",
    "edge.leaving": "Saindo da sala...",
    "edge.reconnecting": "Sinal perdido — reconectando ao estúdio…",
    "edge.errorNameTaken": "Esse nome já está sendo usado nesta sala.",
    "edge.errorInvalidPassword": "Senha incorreta.",
    "edge.errorRoomFull": "Esta sala está cheia.",
    "edge.errorInvalidCode": "Código de sala inválido.",
    "edge.errorNotFound": "Sala não encontrada.",
    "edge.errorSessionInRoom": "Você já está em outra sala.",
    "edge.errorNotEnoughPlayers": "Não há jogadores suficientes para começar este jogo.",
  },
} as const;

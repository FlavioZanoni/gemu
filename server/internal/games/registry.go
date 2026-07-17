package games

type Factory struct {
	Type string
	Name string
	// MinPlayers below 2 is treated as 2 (the platform-wide floor).
	MinPlayers int
	New        func() Adapter
}

func (f Factory) MinConnected() int {
	if f.MinPlayers < 2 {
		return 2
	}
	return f.MinPlayers
}

type Registry struct {
	games map[string]Factory
}

func NewRegistry() *Registry {
	return &Registry{games: make(map[string]Factory)}
}

func (r *Registry) Register(factory Factory) {
	r.games[factory.Type] = factory
}

func (r *Registry) Get(gameType string) (Factory, bool) {
	factory, ok := r.games[gameType]
	return factory, ok
}

func (r *Registry) List() []map[string]any {
	out := make([]map[string]any, 0, len(r.games))
	for _, game := range r.games {
		out = append(out, map[string]any{
			"type":       game.Type,
			"name":       game.Name,
			"minPlayers": game.MinConnected(),
		})
	}
	return out
}

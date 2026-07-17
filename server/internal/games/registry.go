package games

import "sync"

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
	mu    sync.RWMutex
	games map[string]Factory
}

func NewRegistry() *Registry {
	return &Registry{games: make(map[string]Factory)}
}

func (r *Registry) Register(factory Factory) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.games[factory.Type] = factory
}

func (r *Registry) Get(gameType string) (Factory, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	factory, ok := r.games[gameType]
	return factory, ok
}

func (r *Registry) List() []map[string]any {
	r.mu.RLock()
	defer r.mu.RUnlock()
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

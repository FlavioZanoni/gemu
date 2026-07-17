package games

import "sync"

type Factory struct {
	Type string
	Name string
	New  func() Adapter
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

func (r *Registry) List() []map[string]string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]map[string]string, 0, len(r.games))
	for _, game := range r.games {
		out = append(out, map[string]string{
			"type": game.Type,
			"name": game.Name,
		})
	}
	return out
}

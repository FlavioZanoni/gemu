package games

import "testing"

func TestRegistryRegisterAndGet(t *testing.T) {
	registry := NewRegistry()
	factory := Factory{Type: "test", Name: "Test Game", New: func() Adapter { return &InventionGame{} }}
	registry.Register(factory)

	got, ok := registry.Get("test")
	if !ok || got.Type != "test" {
		t.Fatalf("expected registry to return registered factory")
	}
}

func TestRegistryList(t *testing.T) {
	registry := NewRegistry()
	registry.Register(Factory{Type: "a", Name: "A", New: func() Adapter { return &InventionGame{} }})
	registry.Register(Factory{Type: "b", Name: "B", New: func() Adapter { return &InventionGame{} }})

	list := registry.List()
	if len(list) != 2 {
		t.Fatalf("expected 2 games, got %d", len(list))
	}
}

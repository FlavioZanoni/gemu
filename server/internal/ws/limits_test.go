package ws

import (
	"net/http"
	"testing"

	"gemu-server/internal/games"
)

func TestIsLoopback(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "::1"} {
		if !isLoopback(ip) {
			t.Errorf("expected %q to be loopback", ip)
		}
	}
	for _, ip := range []string{"8.8.8.8", "203.0.113.5", ""} {
		if isLoopback(ip) {
			t.Errorf("expected %q to NOT be loopback", ip)
		}
	}
}

func TestClientIPIgnoresSpoofedXFFByDefault(t *testing.T) {
	orig := trustProxy
	defer func() { trustProxy = orig }()

	req := &http.Request{
		RemoteAddr: "203.0.113.5:40000",
		Header:     http.Header{"X-Forwarded-For": {"127.0.0.1"}},
	}

	// Default: XFF is untrusted, so a spoofed loopback header is ignored.
	trustProxy = false
	if got := clientIP(req); got != "203.0.113.5" {
		t.Errorf("with trustProxy off, want real peer 203.0.113.5, got %q", got)
	}

	// Behind a trusted proxy: XFF is honored.
	trustProxy = true
	if got := clientIP(req); got != "127.0.0.1" {
		t.Errorf("with trustProxy on, want XFF 127.0.0.1, got %q", got)
	}
}

func TestAllowConnectionEnforcedForRealIP(t *testing.T) {
	h := NewHub(games.NewRegistry())

	// A non-loopback IP is throttled once its burst is spent.
	denied := false
	for i := 0; i < connBurst+5; i++ {
		if !h.AllowConnection("203.0.113.9") {
			denied = true
			break
		}
	}
	if !denied {
		t.Errorf("expected a real IP to be rate-limited after its burst")
	}

	// Loopback is always allowed (health checks / same-host tooling).
	for i := 0; i < connBurst+50; i++ {
		if !h.AllowConnection("127.0.0.1") {
			t.Fatalf("loopback should never be rate-limited")
		}
	}
}

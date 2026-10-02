package ws

import (
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Capacity ceilings (ops-tunable via env) and fixed per-actor rate limits.
// These turn a friends-only server into one that survives a public URL: a
// single abusive client can no longer exhaust memory by spamming rooms or
// flooding actions.
var (
	maxClients = envInt("GEMU_MAX_CLIENTS", 5000) // global concurrent connections
	maxRooms   = envInt("GEMU_MAX_ROOMS", 1000)   // global live rooms
	// trustProxy: only read X-Forwarded-For when explicitly deployed behind a
	// proxy that sets it. Off by default — otherwise any direct client could
	// spoof XFF: "127.0.0.1" and bypass every per-IP limit via the loopback
	// exemption. When off, the real TCP peer (RemoteAddr) is used.
	trustProxy = envBool("GEMU_TRUST_PROXY", false)
	// proxyHops is how many trusted proxies append to X-Forwarded-For (1 =
	// a single reverse proxy). The client address is the entry that many
	// places from the right: everything left of it is client-supplied.
	proxyHops = envInt("GEMU_PROXY_HOPS", 1)
)

func envBool(key string, def bool) bool {
	switch strings.ToLower(os.Getenv(key)) {
	case "1", "true", "yes":
		return true
	case "0", "false", "no":
		return false
	}
	return def
}

const (
	// Per-IP new WebSocket connections.
	connRatePerSec rate.Limit = 5
	connBurst                 = 15
	// Per-IP room.create calls (bucket refills ~1 every 6s, short bursts ok).
	roomCreateRatePerSec rate.Limit = 1.0 / 6.0
	roomCreateBurst                 = 5
	// Per-IP FAILED room.join attempts (unknown room/code, wrong password):
	// ~1 every 5s after a burst of 20, so codes and passwords can't be
	// brute-forced, while a household behind one NAT reconnecting after a
	// wifi blip (successful joins) is never throttled.
	joinFailRatePerSec rate.Limit = 1.0 / 5.0
	joinFailBurst                 = 20
)

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

// ipLimiters holds one token bucket per client IP, GC'ing idle buckets so the
// map can't grow without bound under a churn of distinct IPs.
type ipLimiters struct {
	mu    sync.Mutex
	limit rate.Limit
	burst int
	lim   map[string]*rate.Limiter
	seen  map[string]time.Time
}

func newIPLimiters(limit rate.Limit, burst int) *ipLimiters {
	return &ipLimiters{
		limit: limit,
		burst: burst,
		lim:   make(map[string]*rate.Limiter),
		seen:  make(map[string]time.Time),
	}
}

func (l *ipLimiters) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	lim, ok := l.lim[ip]
	if !ok {
		lim = rate.NewLimiter(l.limit, l.burst)
		l.lim[ip] = lim
	}
	l.seen[ip] = time.Now()
	if len(l.lim) > 8192 {
		cutoff := time.Now().Add(-10 * time.Minute)
		for k, t := range l.seen {
			if t.Before(cutoff) {
				delete(l.seen, k)
				delete(l.lim, k)
			}
		}
	}
	return lim.Allow()
}

// exhausted reports whether ip has no token left, without consuming one.
func (l *ipLimiters) exhausted(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	lim, ok := l.lim[ip]
	return ok && lim.Tokens() < 1
}

// isLoopback reports whether ip is a local address. Loopback traffic is your
// own tooling/health-checks/proxy on the same host, so it skips the per-IP rate
// limits — real users arrive via the proxy carrying X-Forwarded-For, and the
// global caps still apply to everyone.
func isLoopback(ip string) bool {
	parsed := net.ParseIP(ip)
	return parsed != nil && parsed.IsLoopback()
}

// clientIP extracts the caller's address. X-Forwarded-For is client-controlled
// and spoofable, so it is only honored when trustProxy is set (i.e. a proxy you
// control appends to it), and then only the entry proxyHops from the right —
// the address the outermost trusted proxy actually saw. Entries further left
// are whatever the client sent. A header-derived loopback address is never
// returned as-is, so it can't claim the loopback rate-limit exemption.
// Otherwise the real TCP peer is used, which a client cannot forge.
func clientIP(r *http.Request) string {
	if trustProxy {
		if ip, ok := forwardedIP(r.Header.Values("X-Forwarded-For")); ok {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func forwardedIP(headers []string) (string, bool) {
	var parts []string
	for _, h := range headers {
		for _, p := range strings.Split(h, ",") {
			if p = strings.TrimSpace(p); p != "" {
				parts = append(parts, p)
			}
		}
	}
	hops := proxyHops
	if hops < 1 {
		hops = 1
	}
	if len(parts) < hops {
		return "", false
	}
	ip := parts[len(parts)-hops]
	if isLoopback(ip) {
		return "forwarded:" + ip, true
	}
	return ip, true
}

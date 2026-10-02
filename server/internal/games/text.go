package games

import "strings"

// maxDrawingBytes caps an embedded canvas data: URL, independent of the WS
// frame ceiling — these get stored and rebroadcast in full game state to
// every player, so they must stay small. Clients export compressed
// JPEG/WebP (≤ ~150KB); 200KB leaves headroom for base64 overhead.
const maxDrawingBytes = 200_000

// MaxDrawingBytes is the exported drawing cap, for docs/tests.
const MaxDrawingBytes = maxDrawingBytes

var imageDataURLPrefixes = []string{
	"data:image/png;base64,",
	"data:image/jpeg;base64,",
	"data:image/webp;base64,",
}

// ValidImageDataURL reports whether s is a base64 PNG/JPEG/WebP data: URL
// within maxDrawingBytes. Games must check submitted drawings with it before
// storing them: anything else (SVG with script, remote URLs, oversized blobs)
// would be rebroadcast verbatim to every player.
func ValidImageDataURL(s string) bool {
	if len(s) > maxDrawingBytes {
		return false
	}
	for _, prefix := range imageDataURLPrefixes {
		if strings.HasPrefix(s, prefix) && len(s) > len(prefix) {
			return isBase64Body(s[len(prefix):])
		}
	}
	return false
}

func isBase64Body(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '+', c == '/', c == '=':
		default:
			return false
		}
	}
	return true
}

// TruncateText caps a string to max runes.
func TruncateText(s string, max int) string {
	r := []rune(s)
	if len(r) > max {
		return string(r[:max])
	}
	return s
}

// ponytail: hand-rolled diacritic table instead of x/text — covers pt-BR/en;
// swap for golang.org/x/text/unicode/norm if more languages show up.
var diacritics = strings.NewReplacer(
	"á", "a", "à", "a", "â", "a", "ã", "a", "ä", "a",
	"é", "e", "è", "e", "ê", "e", "ë", "e",
	"í", "i", "ì", "i", "î", "i", "ï", "i",
	"ó", "o", "ò", "o", "ô", "o", "õ", "o", "ö", "o",
	"ú", "u", "ù", "u", "û", "u", "ü", "u",
	"ç", "c", "ñ", "n",
)

// NormalizeAnswer lowercases, trims, collapses inner whitespace, and strips
// pt-BR/en diacritics, so "  Água " matches "agua".
func NormalizeAnswer(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = diacritics.Replace(s)
	return strings.Join(strings.Fields(s), " ")
}

// StartsWithLetter reports whether the normalized answer begins with the
// (single-letter, already lowercase ASCII) letter.
func StartsWithLetter(answer, letter string) bool {
	n := NormalizeAnswer(answer)
	return n != "" && strings.HasPrefix(n, strings.ToLower(letter))
}

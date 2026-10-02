package games

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

//go:embed decks/*.json
var deckFS embed.FS

// Deck is a named set of CAH cards. Built-in decks are embedded; custom decks
// arrive at runtime (paste/upload) and are validated the same way.
type Deck struct {
	ID     string         `json:"id"`
	Name   string         `json:"name"`
	Locale string         `json:"locale"`
	NSFW   bool           `json:"nsfw"`
	Black  []cahBlackCard `json:"black"`
	White  []string       `json:"white"`
}

// DeckMeta is the listing shape sent to clients (no card text).
type DeckMeta struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Locale string `json:"locale"`
	NSFW   bool   `json:"nsfw"`
	Black  int    `json:"black"`
	White  int    `json:"white"`
}

func (d Deck) Meta() DeckMeta {
	return DeckMeta{ID: d.ID, Name: d.Name, Locale: d.Locale, NSFW: d.NSFW, Black: len(d.Black), White: len(d.White)}
}

// deckJSON is the on-disk / on-wire shape (black cards as {text,pick}).
type deckJSON struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Locale string `json:"locale"`
	NSFW   bool   `json:"nsfw"`
	Black  []struct {
		Text string `json:"text"`
		Pick int    `json:"pick"`
	} `json:"black"`
	White []string `json:"white"`
}

const blankToken = "____"

// Custom-deck limits. The hub caps raw payload size before parsing; these
// keep a parsed deck sane on their own.
const (
	DeckMinBlack    = 1
	DeckMinWhite    = 10
	DeckMaxCards    = 1000
	DeckMaxCardLen  = 200
	DeckMaxNameLen  = 60
	deckMaxLocLen   = 10
	deckMaxIDLength = 64
)

// blankRun matches any run of 3+ underscores: decks written by hand use "___"
// or "________" for a blank; both mean one blank.
var blankRun = regexp.MustCompile(`_{3,}`)

// countBlanks counts blank tokens in a black card.
func countBlanks(text string) int {
	return strings.Count(text, blankToken)
}

// cleanCardText trims, collapses inner whitespace and normalizes blanks.
func cleanCardText(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	return blankRun.ReplaceAllString(s, blankToken)
}

// ParseDeck validates raw deck JSON and returns a Deck. Used for both embedded
// decks (panic on failure at startup) and custom uploads (error returned, its
// message shown to the host). Cards are trimmed and de-duplicated; a pick of
// 0/omitted is inferred from the blanks.
func ParseDeck(raw []byte) (Deck, error) {
	var dj deckJSON
	if err := json.Unmarshal(raw, &dj); err != nil {
		return Deck{}, fmt.Errorf("invalid deck json: %w", err)
	}
	name := strings.Join(strings.Fields(dj.Name), " ")
	if name == "" {
		return Deck{}, fmt.Errorf("deck needs a name")
	}
	if utf8.RuneCountInString(name) > DeckMaxNameLen {
		return Deck{}, fmt.Errorf("deck name is longer than %d characters", DeckMaxNameLen)
	}
	if len(dj.Black)+len(dj.White) > DeckMaxCards {
		return Deck{}, fmt.Errorf("deck has more than %d cards", DeckMaxCards)
	}
	locale := strings.TrimSpace(dj.Locale)
	if locale == "" || len(locale) > deckMaxLocLen {
		locale = "en"
	}
	id := strings.TrimSpace(dj.ID)
	if len(id) > deckMaxIDLength {
		id = id[:deckMaxIDLength]
	}
	deck := Deck{ID: id, Name: name, Locale: locale, NSFW: dj.NSFW}

	seen := make(map[string]bool)
	for i, b := range dj.Black {
		text := cleanCardText(b.Text)
		if text == "" {
			return Deck{}, fmt.Errorf("black card %d is empty", i+1)
		}
		if utf8.RuneCountInString(text) > DeckMaxCardLen {
			return Deck{}, fmt.Errorf("black card %d is longer than %d characters", i+1, DeckMaxCardLen)
		}
		blanks := countBlanks(text)
		pick := b.Pick
		if pick == 0 {
			pick = max(blanks, 1)
		}
		if pick != 1 && pick != 2 {
			return Deck{}, fmt.Errorf("black card pick must be 1 or 2: %q", text)
		}
		// Two card styles: a question (pick 1, no blank — the white card is the
		// answer) or fill-in (blanks must equal pick).
		if blanks == 0 {
			if pick != 1 {
				return Deck{}, fmt.Errorf("blank-less card must be pick 1: %q", text)
			}
		} else if blanks != pick {
			return Deck{}, fmt.Errorf("black card must have %d blank(s) to match pick: %q", pick, text)
		}
		key := strings.ToLower(text)
		if seen[key] {
			continue
		}
		seen[key] = true
		deck.Black = append(deck.Black, cahBlackCard{Text: text, Pick: pick})
	}

	seen = make(map[string]bool)
	for i, w := range dj.White {
		text := strings.Join(strings.Fields(w), " ")
		if text == "" {
			return Deck{}, fmt.Errorf("white card %d is empty", i+1)
		}
		if utf8.RuneCountInString(text) > DeckMaxCardLen {
			return Deck{}, fmt.Errorf("white card %d is longer than %d characters", i+1, DeckMaxCardLen)
		}
		key := strings.ToLower(text)
		if seen[key] {
			continue
		}
		seen[key] = true
		deck.White = append(deck.White, text)
	}

	if len(deck.Black) < DeckMinBlack {
		return Deck{}, fmt.Errorf("deck needs at least %d black card", DeckMinBlack)
	}
	if len(deck.White) < DeckMinWhite {
		return Deck{}, fmt.Errorf("deck needs at least %d different white cards (has %d)", DeckMinWhite, len(deck.White))
	}
	return deck, nil
}

// CustomDeckID derives a custom deck's id from its name: "custom:" + a
// readable slug + a short hash of the exact (whitespace-normalized) name.
// The slug alone is ambiguous ("A b" and "a_b" both slug to "a_b"); the hash
// keeps distinct names apart while re-uploading the same name still replaces
// the earlier deck. Namespaced so it can never shadow a built-in id.
func CustomDeckID(name string) string {
	name = strings.Join(strings.Fields(name), " ")
	var slug strings.Builder
	lastUnderscore := false
	for _, r := range strings.ToLower(name) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			slug.WriteRune(r)
			lastUnderscore = false
		case !lastUnderscore && slug.Len() > 0:
			slug.WriteByte('_')
			lastUnderscore = true
		}
		if slug.Len() >= 32 {
			break
		}
	}
	sum := sha256.Sum256([]byte(name))
	return "custom:" + strings.TrimSuffix(slug.String(), "_") + "-" + hex.EncodeToString(sum[:4])
}

var builtinDecks = loadBuiltinDecks()

// loadBuiltinDecks parses every embedded deck at startup. A malformed embedded
// deck is a build error, so it panics.
func loadBuiltinDecks() map[string]Deck {
	entries, err := deckFS.ReadDir("decks")
	if err != nil {
		panic(err)
	}
	decks := make(map[string]Deck)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		raw, err := deckFS.ReadFile(path.Join("decks", entry.Name()))
		if err != nil {
			panic(err)
		}
		deck, err := ParseDeck(raw)
		if err != nil {
			panic(fmt.Sprintf("embedded deck %s: %v", entry.Name(), err))
		}
		if deck.ID == "" {
			deck.ID = strings.TrimSuffix(entry.Name(), ".json")
		}
		if _, dup := decks[deck.ID]; dup {
			panic("duplicate deck id: " + deck.ID)
		}
		decks[deck.ID] = deck
	}
	return decks
}

// BuiltinDeckMetas lists the embedded decks (stable order: locale, then name).
func BuiltinDeckMetas() []DeckMeta {
	metas := make([]DeckMeta, 0, len(builtinDecks))
	for _, d := range builtinDecks {
		metas = append(metas, d.Meta())
	}
	sort.SliceStable(metas, func(i, j int) bool {
		if metas[i].Locale != metas[j].Locale {
			return metas[i].Locale < metas[j].Locale
		}
		return metas[i].Name < metas[j].Name
	})
	return metas
}

// BuiltinDeck returns an embedded deck by id.
func BuiltinDeck(id string) (Deck, bool) {
	d, ok := builtinDecks[id]
	return d, ok
}

// DefaultDeckID is the base deck for a locale (used when nothing is selected).
func DefaultDeckID(locale string) string {
	if _, ok := builtinDecks["base_"+locale]; ok {
		return "base_" + locale
	}
	return "base_en"
}

// MergeDecks flattens a set of decks into one black/white pool (the game
// shuffles both piles after).
func MergeDecks(decks []Deck) (black []cahBlackCard, white []string) {
	for _, d := range decks {
		black = append(black, d.Black...)
		white = append(white, d.White...)
	}
	return black, white
}

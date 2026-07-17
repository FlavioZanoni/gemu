package games

import (
	"embed"
	"encoding/json"
	"fmt"
	"path"
	"sort"
	"strings"
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

// countBlanks counts blank tokens in a black card.
func countBlanks(text string) int {
	return strings.Count(text, blankToken)
}

// ParseDeck validates raw deck JSON and returns a Deck. Used for both embedded
// decks (panic on failure at startup) and custom uploads (error returned).
func ParseDeck(raw []byte) (Deck, error) {
	var dj deckJSON
	if err := json.Unmarshal(raw, &dj); err != nil {
		return Deck{}, fmt.Errorf("invalid deck json: %w", err)
	}
	if strings.TrimSpace(dj.Name) == "" {
		return Deck{}, fmt.Errorf("deck needs a name")
	}
	if len(dj.Black) < 3 {
		return Deck{}, fmt.Errorf("deck needs at least 3 black cards")
	}
	if len(dj.White) < 8 {
		return Deck{}, fmt.Errorf("deck needs at least 8 white cards")
	}
	deck := Deck{
		ID:     strings.TrimSpace(dj.ID),
		Name:   strings.TrimSpace(dj.Name),
		Locale: dj.Locale,
		NSFW:   dj.NSFW,
	}
	if deck.Locale == "" {
		deck.Locale = "en"
	}
	for _, b := range dj.Black {
		if b.Pick != 1 && b.Pick != 2 {
			return Deck{}, fmt.Errorf("black card pick must be 1 or 2: %q", b.Text)
		}
		// Two card styles: a question (pick 1, no blank — the white card is the
		// answer) or fill-in (blanks must equal pick).
		blanks := countBlanks(b.Text)
		if blanks == 0 {
			if b.Pick != 1 {
				return Deck{}, fmt.Errorf("blank-less card must be pick 1: %q", b.Text)
			}
		} else if blanks != b.Pick {
			return Deck{}, fmt.Errorf("black card must have %d blank(s) to match pick: %q", b.Pick, b.Text)
		}
		deck.Black = append(deck.Black, cahBlackCard{Text: b.Text, Pick: b.Pick})
	}
	for _, w := range dj.White {
		if strings.TrimSpace(w) == "" {
			return Deck{}, fmt.Errorf("white card cannot be empty")
		}
		deck.White = append(deck.White, w)
	}
	return deck, nil
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

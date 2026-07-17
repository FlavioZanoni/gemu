package games

import "strings"

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

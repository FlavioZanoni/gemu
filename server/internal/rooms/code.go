package rooms

import "crypto/rand"

// joinCodeAlphabet drops look-alikes (0/O, 1/I) so codes read cleanly aloud
// and on a TV. 32 symbols: a random byte masked to 5 bits is unbiased.
const joinCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

// JoinCodeLen stays 6: embedding hosts (awful.chat) parse 6-char codes.
const JoinCodeLen = 6

// NewJoinCode returns a crypto-random join code (~1e9 possibilities, so
// codes can't be enumerated within the join rate limit).
func NewJoinCode() string {
	buf := make([]byte, JoinCodeLen)
	if _, err := rand.Read(buf); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	for i, b := range buf {
		buf[i] = joinCodeAlphabet[int(b)&31]
	}
	return string(buf)
}

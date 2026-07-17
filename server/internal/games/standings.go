package games

import "sort"

// standings builds a sorted standings list from a scores map and room info.
// It fills every connected player with 0 if not in scores, then sorts descending.
func standings(scores map[string]int, room RoomInfo) []Standing {
	seen := make(map[string]bool)
	standings := make([]Standing, 0, len(scores))
	for id, score := range scores {
		standings = append(standings, Standing{PlayerID: id, Score: score})
		seen[id] = true
	}
	if room != nil {
		for _, id := range room.ConnectedPlayerIDs() {
			if !seen[id] {
				standings = append(standings, Standing{PlayerID: id, Score: 0})
			}
		}
	}
	sort.SliceStable(standings, func(i, j int) bool { return standings[i].Score > standings[j].Score })
	return standings
}

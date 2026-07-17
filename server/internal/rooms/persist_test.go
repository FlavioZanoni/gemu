package rooms

import "testing"

func TestMarshalStateRoundTrip(t *testing.T) {
	orig := &Room{
		ID:            "r1",
		Name:          "Game Night",
		Visibility:    Private,
		JoinCode:      "ABC123",
		Password:      "hunter2", // json:"-" — must still survive persistence
		MaxPlayers:    8,
		Locale:        "en",
		Status:        StatusPlaying,
		GameType:      "trivia",
		GameName:      "Trivia",
		Players: map[string]Player{
			"p1": {ID: "p1", Name: "Ada", SessionID: "sess-1", Connected: true, Ready: true},
			"p2": {ID: "p2", Name: "Bo", SessionID: "sess-2"},
		},
		AdminChain:    []string{"p1"},
		Playlist:      []string{"trivia", "stop"},
		CahDeckIDs:    []string{"base_en"},
		SessionScores: map[string]int{"p1": 120, "p2": 80},
	}

	b, err := orig.MarshalState()
	if err != nil {
		t.Fatalf("MarshalState: %v", err)
	}
	got, err := RoomFromState(b)
	if err != nil {
		t.Fatalf("RoomFromState: %v", err)
	}

	if got.Password != "hunter2" {
		t.Errorf("password not preserved: %q", got.Password)
	}
	if got.Players["p1"].SessionID != "sess-1" || got.Players["p2"].SessionID != "sess-2" {
		t.Errorf("session ids not preserved: %+v", got.Players)
	}
	if got.SessionScores["p1"] != 120 || got.SessionScores["p2"] != 80 {
		t.Errorf("session scores not preserved: %+v", got.SessionScores)
	}
	if got.Status != StatusPlaying || got.GameType != "trivia" {
		t.Errorf("status/game not preserved: %s %s", got.Status, got.GameType)
	}
	if got.JoinCode != "ABC123" || got.Visibility != Private {
		t.Errorf("room meta not preserved: %s %s", got.JoinCode, got.Visibility)
	}
	if len(got.Playlist) != 2 || got.Playlist[0] != "trivia" {
		t.Errorf("playlist not preserved: %v", got.Playlist)
	}
}

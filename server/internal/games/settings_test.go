package games

import "testing"

func TestSettingInt(t *testing.T) {
	cases := []struct {
		settings map[string]any
		want     int
	}{
		{nil, 3},
		{map[string]any{"rounds": float64(5)}, 5},
		{map[string]any{"rounds": float64(99)}, 10},
		{map[string]any{"rounds": float64(0)}, 1},
		{map[string]any{"rounds": "nope"}, 3},
	}
	for _, c := range cases {
		if got := SettingInt(c.settings, "rounds", 3, 1, 10); got != c.want {
			t.Fatalf("SettingInt(%v)=%d want %d", c.settings, got, c.want)
		}
	}
}

func TestGamesReadSettings(t *testing.T) {
	room := fakeRoom{players: []string{"p1", "p2", "p3"}, admin: "p1"}
	settings := map[string]any{"rounds": float64(7), "answerSeconds": float64(45), "turnSeconds": float64(60), "drawSeconds": float64(200)}

	stop := &StopGame{}
	stop.Start("r", Options{Room: room, Settings: settings})
	if stop.totalRounds != 7 || stop.answerSeconds != 45 {
		t.Fatalf("stop settings not applied: rounds=%d answerSeconds=%d", stop.totalRounds, stop.answerSeconds)
	}

	gartic := &GarticGame{}
	gartic.Start("r", Options{Room: room, Settings: settings})
	if gartic.totalRounds != 7 || gartic.turnSeconds != 60 {
		t.Fatalf("gartic settings not applied: rounds=%d turnSeconds=%d", gartic.totalRounds, gartic.turnSeconds)
	}

	gp := &GarticPhoneGame{}
	gp.Start("r", Options{Room: room, Settings: settings})
	if gp.drawSeconds != 200 {
		t.Fatalf("garticphone drawSeconds not applied: %d", gp.drawSeconds)
	}

	cah := &CahGame{}
	cah.Start("r", Options{Room: room, Settings: settings})
	if cah.totalRounds != 7 {
		t.Fatalf("cah rounds not applied: %d", cah.totalRounds)
	}

	inv := &InventionGame{}
	inv.Start("r", Options{Room: room, Settings: settings})
	if inv.totalRounds != 5 { // clamped: invention max is 5
		t.Fatalf("invention rounds not clamped to 5: %d", inv.totalRounds)
	}
}

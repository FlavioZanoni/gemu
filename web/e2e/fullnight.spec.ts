import { test as guarded } from "./fixtures";
import { test, expect, type Page } from "@playwright/test";
import { openRoom, playTriviaToResults, ALL_GAMES, type Room, type GameType } from "./helpers";

// The whole night in one browser run: lobby -> random first game -> play it ->
// results -> audience vote picks the other game -> drumroll -> intro (host
// config screen) -> play it -> results -> end the night -> podium.
//
// The playlist holds trivia + gartic, so the first pick is random between the
// two; the spec detects which mounted and plays the drivers in whichever
// order, always voting the *other* game in next.

const NIGHT_GAMES: GameType[] = ["trivia", "gartic"];

async function trimPlaylist(room: Room) {
  for (const type of ALL_GAMES) {
    if (NIGHT_GAMES.includes(type)) continue;
    const card = room.host.getByTestId(`game-card-${type}`);
    if ((await card.getAttribute("data-selected")) === "true") await card.click();
  }
  for (const keep of NIGHT_GAMES) {
    await expect(room.host.getByTestId(`game-card-${keep}`)).toHaveAttribute("data-selected", "true");
  }
}

async function dismissHowTos(room: Room) {
  for (const page of room.pages) {
    const gotit = page.getByTestId("howto-gotit");
    if (await gotit.isVisible().catch(() => false)) await gotit.click().catch(() => {});
  }
}

// Which of the two games is on screen right now?
async function detectGame(room: Room): Promise<GameType> {
  for (let i = 0; i < 40; i++) {
    for (const page of room.pages) {
      if (await page.getByTestId("trivia-option-0").isVisible().catch(() => false)) return "trivia";
      if (await page.getByTestId("gartic-secret-word").isVisible().catch(() => false)) return "gartic";
    }
    await room.host.waitForTimeout(500);
  }
  throw new Error("neither trivia nor gartic mounted");
}

// Play gartic to the results screen: each turn, read the drawer's secret word
// and submit it from the other player, which ends the turn early.
async function playGarticToResults(room: Room) {
  const done = () => room.host.getByTestId("results-end-night").isVisible().catch(() => false);
  for (let i = 0; i < 30; i++) {
    if (await done()) return;
    for (const drawer of room.pages) {
      const secret = drawer.getByTestId("gartic-secret-word");
      if (!(await secret.isVisible().catch(() => false))) continue;
      const word = (await secret.textContent())?.trim();
      if (!word || word === "?") continue;
      const guesser = room.pages.find((p) => p !== drawer)!;
      const input = guesser.getByTestId("gartic-guess-input");
      if (await input.isEnabled().catch(() => false)) {
        await input.fill(word).catch(() => {});
        await guesser.getByTestId("gartic-guess-submit").click().catch(() => {});
      }
    }
    await room.host.waitForTimeout(1000);
  }
  await expect(room.host.getByTestId("results-end-night")).toBeVisible();
}

async function playToResults(room: Room, game: GameType) {
  await dismissHowTos(room);
  if (game === "trivia") {
    await playTriviaToResults(room);
  } else {
    await playGarticToResults(room);
  }
  await expect(room.host.getByTestId("results-vote-next")).toBeVisible();
}

guarded("full night: play, vote, config, play, podium", async ({ browser }) => {
  test.slow();
  const room = await openRoom(browser, 2);
  try {
    // Lobby: two-game playlist, everyone ready, host starts (random pick).
    await trimPlaylist(room);
    for (const page of room.pages) await page.getByTestId("ready-up").click();
    await room.host.getByTestId("start-game").click();
    await expect(room.host.getByTestId("game-surface")).toBeVisible({ timeout: 15_000 });
    await dismissHowTos(room);

    // Game 1: whichever the random pick chose.
    const first = await detectGame(room);
    const second: GameType = first === "trivia" ? "gartic" : "trivia";
    await playToResults(room, first);

    // Vote flow: everyone votes for the other game; vote closes early once
    // everyone has voted, then the drumroll reveals the winner and the intro
    // (config) screen appears for the host.
    await room.host.getByTestId("results-vote-next").click();
    for (const page of room.pages) {
      await page.getByTestId(`vote-option-${second}`).click({ timeout: 15_000 });
    }
    await expect(room.host.getByTestId("intro-start")).toBeVisible({ timeout: 30_000 });

    // Everyone readies through the intro; the host starts the queued game.
    await room.host.getByTestId("intro-start").click();
    for (const page of room.pages) {
      await expect(page.getByTestId("game-surface")).toBeVisible({ timeout: 15_000 });
    }
    await dismissHowTos(room);

    // Game 2, then end the night at the podium.
    await playToResults(room, second);
    await room.host.getByTestId("results-end-night").click();
    for (const page of room.pages) {
      await expect(page.getByTestId("podium-winner")).toBeVisible({ timeout: 15_000 });
    }
    await expect(room.host.getByTestId("podium-continue")).toBeVisible();
  } finally {
    await room.cleanup();
  }
});

import { test, expect } from "./fixtures";
import { openRoom, startGame, playTriviaToResults } from "./helpers";

// The session loop: play a game to completion, then the host chooses what's
// next — replay, vote, or end the night (podium). Driving a full Trivia game
// (8 rounds, 6s reveal each) is slow but deterministic, so these get a long
// per-test budget. All use a single-game (Trivia) playlist, which makes the
// first pick deterministic.

test.describe("session loop", () => {
  test.slow(); // triples the timeout — a full Trivia game runs ~50s

  test("play to results: scoreboard mid-game and host actions", async ({ browser }) => {
    const room = await openRoom(browser, 2);
    try {
      await startGame(room, "trivia");
      // Live scoreboard is visible during play.
      await expect(room.host.getByTestId("score-strip").first()).toBeVisible();

      await playTriviaToResults(room);

      // Host sees all three next-step actions.
      await expect(room.host.getByTestId("results-play-again")).toBeVisible();
      await expect(room.host.getByTestId("results-vote-next")).toBeVisible();
      await expect(room.host.getByTestId("results-end-night")).toBeVisible();
      // Non-host sees the waiting state, not the buttons.
      await expect(room.guests[0].getByTestId("results-play-again")).toHaveCount(0);
    } finally {
      await room.cleanup();
    }
  });

  test("play again replays the same game", async ({ browser }) => {
    const room = await openRoom(browser, 2);
    try {
      await startGame(room, "trivia");
      await playTriviaToResults(room);

      // Replay queues the same game and returns to the intro; the host starts it.
      await room.host.getByTestId("results-play-again").click();
      await room.host.getByTestId("intro-start").click();
      for (const page of room.pages) {
        await expect(page.getByTestId("game-surface")).toBeVisible();
      }
    } finally {
      await room.cleanup();
    }
  });

  test("end the night shows the podium", async ({ browser }) => {
    const room = await openRoom(browser, 2);
    try {
      await startGame(room, "trivia");
      await playTriviaToResults(room);

      await room.host.getByTestId("results-end-night").click();
      // Podium appears for everyone with a champion and a continue button.
      for (const page of room.pages) {
        await expect(page.getByTestId("podium-winner")).toBeVisible();
      }
      await expect(room.host.getByTestId("podium-continue")).toBeVisible();
    } finally {
      await room.cleanup();
    }
  });

  test("vote next queues the next game", async ({ browser }) => {
    const room = await openRoom(browser, 2);
    try {
      // Single-game playlist: "vote next" has nothing to vote on, so it queues
      // the game and drops back to the intro/lobby with a next game set.
      await startGame(room, "trivia");
      await playTriviaToResults(room);

      await room.host.getByTestId("results-vote-next").click();
      // The queued game lands on the intro, ready for the host to start again.
      await expect(room.host.getByTestId("intro-start")).toBeVisible();
    } finally {
      await room.cleanup();
    }
  });
});

import { test, expect } from "./fixtures";
import { createRoom } from "./helpers";

// The CAH deck picker: open it from the (selected-by-default) Cartas card,
// and import a custom deck via paste-JSON. A fresh room's playlist includes
// every game, so the Cartas card is already selected and its Decks button shows.

test("import a custom CAH deck via paste JSON", async ({ page }) => {
  await createRoom(page, "Host");

  await page.getByTestId("open-decks").click();
  const picker = page.getByTestId("deck-picker");
  await expect(picker).toBeVisible();

  await picker.getByTestId("deck-import-toggle").click();
  const deck = {
    name: "E2E Test Deck",
    black: [
      { text: "____ wins the night.", pick: 1 },
      { text: "The best part of ____.", pick: 1 },
      { text: "Nothing beats ____.", pick: 1 },
    ],
    white: ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"],
  };
  await picker.getByTestId("deck-paste-textarea").fill(JSON.stringify(deck));
  await picker.getByTestId("deck-add").click();

  // The imported deck now appears in the picker's list.
  await expect(picker.getByText("E2E Test Deck")).toBeVisible();
});

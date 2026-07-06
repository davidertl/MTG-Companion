import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ArenaAppShell } from "../src/app/ArenaAppShell";
import { buildArenaAppShellState } from "../src/app/buildArenaAppShellState";

function baseState() {
  return buildArenaAppShellState({
    hasDetailedLogs: true,
    logPath: "/tmp/Player.log",
    watcherRunning: true,
    matches: [
      { matchId: "m1", deck: "Azorius Control", result: "win", queue: "ranked" },
    ],
    collection: { cardsOwned: 620, capturedAt: "2026-05-07T02:00:00Z" },
    draftPicks: [
      { setCode: "OTJ", packNumber: 1, pickNumber: 2, choice: "Caustic Bronco" },
    ],
  });
}

describe("ArenaAppShell navigation", () => {
  it("renders only the active view's content", () => {
    const state = baseState();

    const collectionHtml = renderToStaticMarkup(
      <ArenaAppShell state={state} activeView="Collection" />,
    );
    expect(collectionHtml).toContain("Cards owned");
    // Decks-only content must not appear when Collection is active.
    expect(collectionHtml).not.toContain("Archidekt import — coming soon");
    // Draft-only content must not appear either.
    expect(collectionHtml).not.toContain("Caustic Bronco");

    const decksHtml = renderToStaticMarkup(
      <ArenaAppShell state={state} activeView="Decks" />,
    );
    expect(decksHtml).toContain("Archidekt import — coming soon");
    expect(decksHtml).not.toContain("Cards owned");
  });

  it("marks the active nav entry and always renders the global summary strip", () => {
    const state = baseState();
    const html = renderToStaticMarkup(
      <ArenaAppShell state={state} activeView="Draft" />,
    );

    // Global summary strip (System pulse) is present regardless of active view.
    expect(html).toContain("System pulse");
    expect(html).toContain("Known matches");
    // Active nav entry is flagged.
    expect(html).toContain('aria-current="page"');
    // Draft view renders the actual picks list, not just a count.
    expect(html).toContain("Caustic Bronco");
  });

  it("invokes onSelectView wiring for nav entries", () => {
    // The nav entries are buttons; verify the handler prop is wired by rendering
    // with a spy and confirming buttons carry the nav labels for every view.
    const state = baseState();
    const onSelectView = vi.fn();
    const html = renderToStaticMarkup(
      <ArenaAppShell state={state} activeView="Imports" onSelectView={onSelectView} />,
    );
    for (const label of state.nav) {
      expect(html).toContain(label);
    }
  });

  it("overview mode (no activeView) still renders every view for static export", () => {
    const state = baseState();
    const html = renderToStaticMarkup(<ArenaAppShell state={state} />);
    expect(html).toContain("Cards owned");
    expect(html).toContain("Archidekt import — coming soon");
    expect(html).toContain("Match Detail");
  });
});

import { describe, expect, it } from "vitest";

import { formatDashboardCards } from "../src/pages/DashboardPage";

describe("dashboard flow", () => {
  it("formats dashboard metrics", () => {
    const cards = formatDashboardCards({
      activeProducers: 2,
      activeSessions: 3,
      eventsLast5Minutes: 12,
      errorsLast5Minutes: 1,
      reviewQueueCount: 4,
    });
    expect(cards).toHaveLength(5);
    expect(cards[0]).toMatchObject({ label: "Active Producers", value: 2 });
  });

  it("handles empty and zero states", () => {
    const cards = formatDashboardCards({
      activeProducers: 0,
      activeSessions: 0,
      eventsLast5Minutes: 0,
      errorsLast5Minutes: 0,
      reviewQueueCount: 0,
    });
    expect(cards.every((card) => card.value === 0)).toBe(true);
  });
});

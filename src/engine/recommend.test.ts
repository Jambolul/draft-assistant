import { describe, expect, it } from "vitest";
import { defaultPool, midChampions } from "../data/champions";
import {
  demoDraft,
  emptyDraft,
  sanitizeDraft,
  selectedIds,
  setPick,
} from "./draft";
import { analyzeDraft, recommend } from "./recommend";
import { sanitizeSettings } from "../state";

describe("draft selection", () => {
  it("prevents duplicate picks across both sides and preserves the mid slot", () => {
    const draft = setPick(emptyDraft(), { side: "ally", role: "top" }, "ornn");
    expect(setPick(draft, { side: "enemy", role: "top" }, "ornn")).toBe(draft);
    expect(setPick(draft, { side: "ally", role: "mid" }, "ahri")).toBe(draft);
    expect(setPick(draft, { side: "enemy", role: "mid" }, "unknown")).toBe(
      draft,
    );
    const cleared = setPick(draft, { side: "ally", role: "top" }, null);
    expect(
      setPick(cleared, { side: "enemy", role: "top" }, "ornn").enemy.top,
    ).toBe("ornn");
  });
  it("repairs invalid saved drafts without duplicating champions", () => {
    const result = sanitizeDraft({
      ally: { top: "ornn", mid: "ahri" },
      enemy: { top: "ornn", adc: "unknown", support: "lulu" },
    });
    expect(result.ally.mid).toBeNull();
    expect(selectedIds(result)).toEqual(["ornn", "lulu"]);
  });
  it("validates saved pool and comfort while preserving an intentionally empty pool", () => {
    expect(
      sanitizeSettings({ pool: [], comfort: { ahri: 99 } }).solo.pools.mid.pool,
    ).toEqual([]);
    expect(
      sanitizeSettings({
        pool: ["ahri", "ahri", "ornn", 3],
        comfort: { ahri: 99 },
      }).solo.pools.mid.pool,
    ).toEqual(["ahri"]);
    expect(
      sanitizeSettings({ comfort: { ahri: "4" } }).solo.pools.mid.comfort.ahri,
    ).toBe(3);
    expect(
      sanitizeSettings({ comfort: { ahri: 5 } }).solo.pools.mid.comfort.ahri,
    ).toBe(5);
  });
  it("loads old settings with blue as the default and remembers a valid red side", () => {
    const saved = {
      draft: demoDraft(),
      pool: ["ahri", "anivia"],
      comfort: { anivia: 5 },
    };
    expect(sanitizeSettings(saved).solo.playerSide).toBe("blue");
    const red = sanitizeSettings({ ...saved, playerSide: "red" }).solo;
    expect(red.playerSide).toBe("red");
    expect(red.draft).toEqual(saved.draft);
    expect(red.pools.mid.pool).toEqual(saved.pool);
    expect(red.pools.mid.comfort.anivia).toBe(5);
    expect(
      sanitizeSettings({ ...saved, playerSide: "invalid" }).solo.playerSide,
    ).toBe("blue");
    expect(
      recommend(red.draft, red.pools.mid.pool, red.pools.mid.comfort),
    ).toEqual(recommend(saved.draft, saved.pool, saved.comfort));
  });
  it("accepts new roster champions, preserves their saved picks and prevents duplicates", () => {
    const draft = setPick(
      emptyDraft(),
      { side: "enemy", role: "mid" },
      "locke",
    );
    const next = setPick(draft, { side: "ally", role: "top" }, "zaahen");
    expect(
      sanitizeSettings({ draft: next, playerSide: "red" }).solo.draft,
    ).toEqual(next);
    expect(setPick(next, { side: "enemy", role: "top" }, "zaahen")).toBe(next);
    expect(next.ally.top).toBe("zaahen");
    expect(next.enemy.mid).toBe("locke");
  });
});
describe("recommendations", () => {
  it("does not invent recommendations for an empty draft or empty pool", () => {
    expect(recommend(emptyDraft(), defaultPool, {})).toEqual([]);
    expect(recommend(demoDraft(), [], {})).toEqual([]);
  });
  it("only recommends unique available mid-pool champions", () => {
    const draft = demoDraft();
    draft.enemy.mid = "ahri";
    const ids = recommend(
      draft,
      [...defaultPool, "ahri", "ornn", "unknown"],
      {},
    ).map((item) => item.champion.id);
    expect(ids).not.toContain("ahri");
    expect(ids).not.toContain("ornn");
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5);
  });
  it("recognizes dive and adds defensive reasoning for anti-dive candidates", () => {
    const draft = demoDraft();
    expect(analyzeDraft(draft).threats).toContain("Backline dive");
    const taliyah = recommend(draft, ["taliyah"], {})[0];
    expect(taliyah.reasons.join(" ")).toContain("anti-dive");
    expect(taliyah.score).toBeGreaterThan(0);
  });
  it("changes reasoning when the enemy draft changes", () => {
    const dive = recommend(demoDraft(), ["taliyah"], {})[0];
    const draft = demoDraft();
    draft.enemy = {
      top: "gwen",
      jungle: "viego",
      mid: "syndra",
      adc: "caitlyn",
      support: "lulu",
    };
    const other = recommend(draft, ["taliyah"], {})[0];
    expect(
      other.breakdown.some((item) => item.label.includes("anti-dive")),
    ).toBe(false);
    expect(
      dive.breakdown.some((item) => item.label.includes("anti-dive")),
    ).toBe(true);
  });
  it("comfort matters and all scores remain bounded and reproducible", () => {
    const low = recommend(demoDraft(), ["ahri"], { ahri: 1 })[0];
    const high = recommend(demoDraft(), ["ahri"], { ahri: 5 })[0];
    expect(high.score).toBeGreaterThan(low.score);
    const first = recommend(demoDraft(), defaultPool, {});
    expect(first).toEqual(recommend(demoDraft(), defaultPool, {}));
    for (const option of first) {
      expect(option.score).toBeGreaterThanOrEqual(0);
      expect(option.score).toBeLessThanOrEqual(100);
    }
  });
  it("reports partial evidence and still accepts flex picks", () => {
    const draft = setPick(
      emptyDraft(),
      { side: "enemy", role: "support" },
      "ahri",
    );
    expect(analyzeDraft(draft).known).toBe(1);
    expect(recommend(draft, defaultPool, {})).toHaveLength(5);
  });
  it("preserves the original example's top recommendations after expanding the roster", () => {
    expect(
      recommend(demoDraft(), defaultPool, {})
        .slice(0, 3)
        .map(({ champion, score }) => [champion.id, score]),
    ).toEqual([
      ["taliyah", 81],
      ["hwei", 79],
      ["orianna", 76],
    ]);
  });
  it("scores the expanded mid roster and excludes any selected champion", () => {
    const draft = demoDraft();
    draft.enemy.mid = "anivia";
    const options = recommend(
      draft,
      midChampions.map((c) => c.id),
      {},
    );
    expect(options).toHaveLength(midChampions.length - 1);
    expect(options.some((c) => c.champion.id === "anivia")).toBe(false);
    expect(options.some((c) => c.champion.id === "locke")).toBe(true);
    for (const option of options) {
      expect(Number.isFinite(option.score)).toBe(true);
      expect(option.score).toBeGreaterThanOrEqual(0);
      expect(option.score).toBeLessThanOrEqual(100);
      expect(option.reasons.length).toBeGreaterThan(0);
      expect(option.tradeoffs.length).toBeGreaterThan(0);
    }
  });
});

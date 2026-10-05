import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaults,
  legacyStorageKey,
  loadSettings,
  sanitizeSettings,
  storageKey,
} from "./state";
import { emptyDraft, selectedIds, setPick } from "./engine/draft";
import { recommend } from "./engine/recommend";
import { championById } from "./data/champions";
import { roles } from "./types";

afterEach(() => vi.unstubAllGlobals());
describe("personal and coach workspaces", () => {
  it("migrates the existing profile without giving the coach the personal draft or pool", () => {
    const legacy = {
      playerSide: "red",
      pool: ["anivia"],
      comfort: { anivia: 5 },
      draft: setPick(emptyDraft(), { side: "enemy", role: "mid" }, "ahri"),
    };
    const getItem = vi.fn((key: string) =>
      key === legacyStorageKey ? JSON.stringify(legacy) : null,
    );
    vi.stubGlobal("localStorage", { getItem });
    const settings = loadSettings();
    expect(settings.solo.playerSide).toBe("red");
    expect(settings.solo.draft).toEqual(legacy.draft);
    expect(settings.solo.pools.mid).toMatchObject({
      pool: ["anivia"],
      comfort: { anivia: 5 },
    });
    expect(settings.coach.draft).toEqual(emptyDraft());
    expect(settings.coach.players.mid.pool).not.toEqual(["anivia"]);
  });
  it("restores independent drafts, roles, sides, bans, names and pools after reload", () => {
    const saved = defaults();
    saved.mode = "coach";
    saved.solo.role = "support";
    saved.solo.playerSide = "red";
    saved.solo.pools.support = { pool: ["lulu"], comfort: { lulu: 5 } };
    saved.solo.bans = ["ahri"];
    saved.solo.draft = setPick(
      saved.solo.draft,
      { side: "ally", role: "support" },
      "lulu",
      null,
    );
    saved.coach.teamName = "Practice team";
    saved.coach.players.mid = { name: "Jami", pool: [], comfort: { ahri: 4 } };
    saved.coach.draft = setPick(
      saved.coach.draft,
      { side: "ally", role: "mid" },
      "orianna",
      null,
    );
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === storageKey ? JSON.stringify(saved) : null,
    });
    const restored = loadSettings();
    expect(restored.mode).toBe("coach");
    expect(restored.solo).toMatchObject(saved.solo);
    expect(restored.coach).toMatchObject(saved.coach);
    expect(restored.coach.players.mid.pool).toEqual([]);
    expect(restored.coach.draft.ally.mid).toBe("orianna");
  });
  it("repairs invalid roles, duplicate picks, conflicting bans and invalid comfort", () => {
    const restored = sanitizeSettings({
      version: 2,
      mode: "unknown",
      solo: {
        role: "other",
        draft: { ally: { mid: "ahri" }, enemy: { mid: "ahri" } },
        bans: ["ahri", "lulu", "lulu", "missing"],
        pools: {
          support: { pool: ["lulu", "lulu", "ahri"], comfort: { lulu: 99 } },
        },
      },
    });
    expect(restored.mode).toBe("solo");
    expect(restored.solo.role).toBe("mid");
    expect(selectedIds(restored.solo.draft)).toEqual(["ahri"]);
    expect(restored.solo.bans).toEqual(["lulu"]);
    expect(restored.solo.pools.support).toMatchObject({
      pool: ["lulu"],
      comfort: { lulu: 3 },
    });
  });
  it("recovers the legacy profile if the newer save is unreadable", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === storageKey ? "{broken" : JSON.stringify({ pool: [] }),
    });
    expect(loadSettings().solo.pools.mid.pool).toEqual([]);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("unavailable");
      },
    });
    expect(loadSettings()).toEqual(defaults());
  });
  it("creates independent, eligible starter pools for every role and player", () => {
    const settings = defaults();
    for (const role of roles) {
      const personal = settings.solo.pools[role];
      const player = settings.coach.players[role];
      expect(personal.pool.length).toBeGreaterThan(0);
      expect(personal.pool).not.toBe(player.pool);
      expect(personal.comfort).not.toBe(player.comfort);
      for (const id of personal.pool)
        expect(championById.get(id)?.roles).toContain(role);
    }
  });
});
describe("recommendations across roles", () => {
  it("uses each player's role and comfort, excludes bans, and avoids the mid baseline outside mid", () => {
    const draft = setPick(
      emptyDraft(),
      { side: "enemy", role: "mid" },
      "ahri",
      null,
    );
    const players = defaults().coach.players;
    for (const role of roles) {
      const player = players[role];
      const banned = player.pool[0];
      const results = recommend(
        draft,
        [...player.pool, "unknown"],
        player.comfort,
        role,
        [banned],
      );
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.champion.roles).toContain(role);
        expect(result.champion.id).not.toBe(banned);
        expect(result.champion.id).not.toBe("ahri");
        if (role !== "mid")
          expect(
            result.breakdown.some((b) => b.label.includes("mid-lane")),
          ).toBe(false);
      }
    }
    expect(
      recommend(draft, ["lulu"], { lulu: 5 }, "support")[0].score,
    ).toBeGreaterThan(
      recommend(draft, ["lulu"], { lulu: 1 }, "support")[0].score,
    );
  });
  it("allows allied mid picks, blocks bans, and recalculates other open roles after a flex pick", () => {
    const draft = setPick(
      emptyDraft(),
      { side: "enemy", role: "mid" },
      "ahri",
      null,
    );
    const pool = ["nautilus", "lulu"];
    expect(
      recommend(draft, pool, {}, "support").map((r) => r.champion.id),
    ).toContain("nautilus");
    const next = setPick(
      draft,
      { side: "ally", role: "mid" },
      "nautilus",
      null,
    );
    expect(next.ally.mid).toBe("nautilus");
    expect(
      recommend(next, pool, {}, "support").map((r) => r.champion.id),
    ).not.toContain("nautilus");
    expect(recommend(next, ["orianna"], {}, "mid")).toEqual([]);
    expect(
      setPick(next, { side: "ally", role: "support" }, "lulu", null, ["lulu"]),
    ).toBe(next);
    const reopened = setPick(next, { side: "ally", role: "mid" }, null, null);
    expect(
      recommend(reopened, pool, {}, "support").map((r) => r.champion.id),
    ).toContain("nautilus");
  });
});

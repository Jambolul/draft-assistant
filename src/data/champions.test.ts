import { describe, expect, it } from "vitest";
import { champions, championById, defaultPool } from "./champions";
import roster from "./roster-source.json";
import { roles } from "../types";

describe("editable champion dataset", () => {
  it("covers every champion in the pinned Riot roster exactly once", () => {
    expect(champions.map((c) => c.riotId).sort()).toEqual(
      [...roster.riotIds].sort(),
    );
    expect(championById.size).toBe(champions.length);
    expect(new Set(champions.map((c) => c.name)).size).toBe(champions.length);
    expect(championById.get("jarvan")?.riotId).toBe("JarvanIV");
    expect(championById.get("wukong")?.riotId).toBe("MonkeyKing");
    for (const id of defaultPool)
      expect(championById.get(id)?.roles).toContain("mid");
  });

  it("requires complete named ratings, valid roles and useful profile text", () => {
    const required = [
      "magic",
      "physical",
      "engage",
      "peel",
      "poke",
      "burst",
      "sustain",
      "waveclear",
      "pick",
      "mobility",
      "frontline",
      "scaling",
      "antiDive",
      "dive",
      "teamfight",
    ].sort();
    for (const champion of champions) {
      expect(champion.id).toMatch(/^[a-z0-9]+$/);
      expect(champion.identity.trim().length).toBeGreaterThan(0);
      expect(champion.tradeoff.trim().length).toBeGreaterThan(0);
      expect(champion.color).toMatch(/^#[a-f0-9]{6}$/i);
      expect(champion.roles.length).toBeGreaterThan(0);
      expect(new Set(champion.roles).size).toBe(champion.roles.length);
      expect(champion.roles.every((role) => roles.includes(role))).toBe(true);
      expect(Object.keys(champion.traits).sort()).toEqual(required);
      for (const value of Object.values(champion.traits)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(5);
      }
    }
  });
});

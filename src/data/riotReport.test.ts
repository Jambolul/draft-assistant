import { describe, expect, it } from "vitest";
import { parseRiotReport } from "./riotReport";

const report = {
  schemaVersion: 4,
  datasetId: "fixture",
  source: "Riot API",
  region: "EUW",
  queue: "Ranked Solo/Duo",
  patches: ["26.19", "26.20"],
  patchCounts: { "26.19": 1, "26.20": 0 },
  generatedAt: "2026-10-05T10:00:00Z",
  windowStart: "2026-09-22T00:00:00Z",
  windowEnd: "2026-10-05T10:00:00Z",
  targetMatches: 1000,
  acceptedMatches: 1,
  retainedMatches: 0,
  retainedRankPolicies: [],
  downloadedMatches: 2,
  rejectedMatches: 1,
  pendingMatches: 0,
  seedPlayers: 10,
  visitedSeedPlayers: 1,
  rankSnapshots: 20,
  apiRequests: 30,
  rankPolicy: "seed_emerald_plus",
  maxSeedPlayers: 10000,
  matchesPerSeed: 5,
  reusedMatches: 0,
  status: { code: "collecting", message: "Collecting matches." },
  rankBasis: "Current observations",
  rankObservedFrom: null,
  rankObservedTo: null,
  rejectionCounts: { wrong_patch: 1 },
  tiers: { EMERALD: 10 },
  championRoles: [
    {
      championId: 103,
      championName: "Ahri",
      role: "MIDDLE",
      games: 1,
      wins: 1,
    },
  ],
};

describe("Riot aggregate report boundary", () => {
  it("distinguishes retained games from the current collection rule", () => {
    const mixed = parseRiotReport({
      ...report,
      rankPolicy: "seed_diamond_plus",
      retainedMatches: 1,
      retainedRankPolicies: ["seed_emerald_plus"],
    });
    expect(mixed.retainedMatches).toBe(1);
    expect(mixed.rankPolicy).toBe("seed_diamond_plus");
  });
  it("accepts an in-progress report and a zero-match report", () => {
    expect(parseRiotReport(report).acceptedMatches).toBe(1);
    expect(
      parseRiotReport({
        ...report,
        acceptedMatches: 0,
        patchCounts: { "26.19": 0, "26.20": 0 },
        championRoles: [],
      }).championRoles,
    ).toEqual([]);
  });
  it("rejects incompatible or misleading report data before rendering it", () => {
    const bad = [
      null,
      "<html>fallback</html>",
      { ...report, schemaVersion: 1 },
      { ...report, retainedMatches: 2 },
      { ...report, retainedMatches: 1 },
      { ...report, retainedRankPolicies: ["seed_emerald_plus"] },
      { ...report, generatedAt: "unknown" },
      { ...report, acceptedMatches: 3 },
      { ...report, targetMatches: 0 },
      { ...report, rankPolicy: "all_ten_emerald_plus" },
      { ...report, patchCounts: { "26.19": 1 } },
      { ...report, patches: ["26.19", "26.19"] },
      { ...report, rejectionCounts: { invalid: -1 } },
      { ...report, status: {} },
      { ...report, championRoles: [{ ...report.championRoles[0], wins: 2 }] },
      {
        ...report,
        championRoles: [{ ...report.championRoles[0], role: "unknown" }],
      },
    ];
    for (const value of bad) expect(() => parseRiotReport(value)).toThrow();
  });
});

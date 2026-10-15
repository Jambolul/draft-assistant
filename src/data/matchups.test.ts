import { describe, expect, it } from "vitest";
import {
  matchupRoles,
  otherOpponentBaseline,
  parseMatchupDataset,
  queryMatchups,
} from "./matchups";
import type { MatchupDataset, MatchupGame } from "./matchups";

function game(id: number): MatchupGame {
  return {
    matchId: `EUW1_${id}`,
    patch: "26.19",
    rankPolicy: "seed_emerald_plus",
    collectionPhase: "current",
    startedAt: `2026-09-${23 + id}T12:00:00Z`,
    durationSeconds: 1800,
    blueWin: true,
    players: Array.from({ length: 10 }, (_, index) => ({
      championId: index + 1,
      role: matchupRoles[index % 5],
      teamId: index < 5 ? 100 : 200,
      rankStatus: "ranked",
      rankTier: "EMERALD",
      rankDivision: "II",
    })),
  };
}
function fixture(): MatchupDataset {
  const red = game(2);
  red.players.forEach((player) => {
    player.teamId = player.teamId === 100 ? 200 : 100;
  });
  const other = game(3);
  other.blueWin = false;
  other.players[5].championId = 11;
  const mid = game(4);
  mid.players[0].role = "MIDDLE";
  mid.players[2].role = "TOP";
  return {
    schemaVersion: 4,
    source: "Riot API",
    datasetId: "fixture",
    region: "EUW",
    queueId: 420,
    patches: ["26.19", "26.20"],
    generatedAt: "2026-10-05T00:00:00Z",
    rankPolicy: "seed_emerald_plus",
    retainedMatches: 0,
    retainedRankPolicies: [],
    champions: Array.from({ length: 11 }, (_, index) => ({
      id: index + 1,
      name: `Champion${index + 1}`,
    })),
    matches: [game(1), red, other, mid],
  };
}
describe("matchup evidence", () => {
  it("retains earlier Emerald games alongside new Diamond games without double counting or relabelling", () => {
    const data = fixture();
    data.rankPolicy = "seed_diamond_plus";
    data.matches.forEach((game) => {
      game.rankPolicy = "seed_diamond_plus";
    });
    data.matches[0].rankPolicy = "seed_emerald_plus";
    data.matches[0].collectionPhase = "retained";
    data.retainedMatches = 1;
    data.retainedRankPolicies = ["seed_emerald_plus"];
    const parsed = parseMatchupDataset(data);
    expect(queryMatchups(parsed, 1, "TOP").games).toBe(3);
    expect(parsed.matches[0].rankPolicy).toBe("seed_emerald_plus");
    expect(() =>
      parseMatchupDataset({ ...data, retainedMatches: 2 }),
    ).toThrow();
    expect(() =>
      parseMatchupDataset({
        ...data,
        retainedRankPolicies: ["seed_diamond_plus"],
      }),
    ).toThrow();
  });
  it("separates patches in both matchup counts and the other-opponent baseline", () => {
    const data = fixture();
    data.matches[2].patch = "26.20";
    const older = queryMatchups(data, 1, "TOP", "all", "26.19");
    const newer = queryMatchups(data, 1, "TOP", "all", "26.20");
    expect([older.games, older.wins, newer.games, newer.wins]).toEqual([
      2, 1, 1, 0,
    ]);
    expect(older.rows.map((row) => row.opponentId)).toEqual([6]);
    expect(newer.rows.map((row) => row.opponentId)).toEqual([11]);
    expect(otherOpponentBaseline(older, older.rows[0])).toEqual({
      games: 0,
      wins: 0,
      winRate: null,
    });
    expect(queryMatchups(data, 1, "TOP").games).toBe(3);
    expect(queryMatchups(data, 1, "TOP", "red", "26.20").games).toBe(0);
  });
  it("counts game outcomes from the chosen champion's perspective against the enemy in the same role", () => {
    const result = queryMatchups(fixture(), 1, "TOP");
    expect({ games: result.games, wins: result.wins }).toEqual({
      games: 3,
      wins: 1,
    });
    expect(
      result.rows.map(({ opponentId, games, wins }) => ({
        opponentId,
        games,
        wins,
      })),
    ).toEqual([
      { opponentId: 6, games: 2, wins: 1 },
      { opponentId: 11, games: 1, wins: 0 },
    ]);
    expect(result.rows[0].observations.map((row) => row.game.matchId)).toEqual([
      "EUW1_2",
      "EUW1_1",
    ]);
    const reverse = queryMatchups(fixture(), 6, "TOP").rows.find(
      (row) => row.opponentId === 1,
    )!;
    expect(reverse.games).toBe(2);
    expect(reverse.wins).toBe(1);
    const otherReverse = queryMatchups(fixture(), 11, "TOP").rows[0];
    expect(otherReverse.games).toBe(1);
    expect(otherReverse.wins).toBe(1);
  });
  it("applies side to the selected champion, handles role changes and never counts an ally as the opponent", () => {
    const blue = queryMatchups(fixture(), 1, "TOP", "blue"),
      red = queryMatchups(fixture(), 1, "TOP", "red");
    expect([blue.games, blue.wins, red.games, red.wins]).toEqual([2, 1, 1, 0]);
    const mid = queryMatchups(fixture(), 1, "MIDDLE");
    expect([mid.games, mid.wins, mid.rows[0].opponentId]).toEqual([1, 1, 8]);
    expect(queryMatchups(fixture(), 1, "UTILITY")).toEqual({
      games: 0,
      wins: 0,
      rows: [],
    });
  });
  it("excludes the selected matchup from the baseline and handles an absent baseline", () => {
    const total = queryMatchups(fixture(), 1, "TOP");
    expect(otherOpponentBaseline(total, total.rows[0])).toEqual({
      games: 1,
      wins: 0,
      winRate: 0,
    });
    expect(
      otherOpponentBaseline({ games: 2, wins: 1 }, { games: 2, wins: 1 }),
    ).toEqual({ games: 0, wins: 0, winRate: null });
  });
  it("accepts complete and empty exports", () => {
    const diamond = fixture();
    diamond.rankPolicy = "seed_diamond_plus";
    diamond.matches.forEach((game) => {
      game.rankPolicy = "seed_diamond_plus";
    });
    expect(parseMatchupDataset(diamond).rankPolicy).toBe("seed_diamond_plus");
    expect(parseMatchupDataset(fixture()).matches).toHaveLength(4);
    expect(
      parseMatchupDataset({ ...fixture(), matches: [], champions: [] }).matches,
    ).toEqual([]);
    const data = fixture();
    for (const [index, status] of (
      ["not_checked", "unranked", "unavailable"] as const
    ).entries()) {
      data.matches[0].players[index].rankStatus = status;
      data.matches[0].players[index].rankTier = null;
      data.matches[0].players[index].rankDivision = null;
    }
    expect(parseMatchupDataset(data).matches[0].players[0].rankStatus).toBe(
      "not_checked",
    );
  });
  it("rejects duplicate matches and malformed compositions before they can bias the table", () => {
    const bad: unknown[] = [
      null,
      {},
      { ...fixture(), schemaVersion: 1 },
      { ...fixture(), retainedMatches: 1 },
      { ...fixture(), retainedRankPolicies: ["seed_emerald_plus"] },
      { ...fixture(), rankPolicy: "seed_diamond_plus" },
      { ...fixture(), rankPolicy: "all_ten_emerald_plus" },
      { ...fixture(), queueId: 440 },
      { ...fixture(), patches: [] },
      { ...fixture(), matches: [game(1), game(1)] },
    ];
    for (const mutate of [
      (m: MatchupGame) => {
        m.players[0].championId = 999;
      },
      (m: MatchupGame) => {
        m.players[0].championId = 2;
      },
      (m: MatchupGame) => {
        m.players[0].role = "MIDDLE";
      },
      (m: MatchupGame) => {
        m.players[0].teamId = 200;
      },
      (m: MatchupGame) => {
        m.players[0].rankTier = "unknown";
      },
      (m: MatchupGame) => {
        m.patch = "26.21";
      },
      (m: MatchupGame) => {
        m.players[0].rankStatus = "not_checked";
      },
      (m: MatchupGame) => {
        m.players[0].rankDivision = null;
      },
      (m: MatchupGame) => {
        m.durationSeconds = NaN;
      },
      (m: MatchupGame) => {
        m.startedAt = "unknown";
      },
    ]) {
      const data = fixture();
      mutate(data.matches[0]);
      bad.push(data);
    }
    for (const value of bad) expect(() => parseMatchupDataset(value)).toThrow();
  });
});

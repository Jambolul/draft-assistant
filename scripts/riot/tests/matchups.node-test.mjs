import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMatchupDataset } from "../matchups.mjs";
import { classifyMatch } from "../validation.mjs";
import { config, endTime, match, rankCache } from "./fixtures.mjs";

test("matchup browser export preserves both compositions and outcomes through an explicit allowlist", () => {
  const first = classifyMatch(
    match(),
    "EUW1_1",
    config,
    endTime,
    () => rankCache(),
    "fixture-player-0",
  ).normalized;
  const second = structuredClone(first);
  second.matchId = "EUW1_2";
  second.participants.forEach((player) => {
    player.win = !player.win;
  });
  first.secret = "private-secret";
  first.participants[0].puuid = "private-player-id";
  first.participants[0].riotIdGameName = "private-player-name";
  first.participants[0].goldEarned = 12345;
  const result = buildMatchupDataset(
    { accepted: () => [first, second] },
    config,
    "2026-10-05T00:00:00Z",
  );
  assert.equal(result.matches.length, 2);
  assert.equal(result.champions.length, 10);
  assert.deepEqual(
    result.matches.map((row) => row.blueWin),
    [true, false],
  );
  assert.equal(result.matches[0].players.length, 10);
  assert.deepEqual(result.matches[0].players[0], {
    championId: 1,
    role: "TOP",
    teamId: 100,
    rankStatus: "ranked",
    rankTier: "EMERALD",
    rankDivision: "II",
  });
  const json = JSON.stringify(result);
  for (const secret of [
    "private-secret",
    "private-player-id",
    "private-player-name",
    "puuid",
    "goldEarned",
    "leaguePoints",
    "RGAPI",
  ])
    assert.equal(json.includes(secret), false);
});

test("empty exports and missing rank observations stay explicit", () => {
  assert.deepEqual(
    buildMatchupDataset({ accepted: () => [] }, config).matches,
    [],
  );
  const normalized = classifyMatch(
    match(),
    "EUW1_1",
    config,
    endTime,
    (id) => (id === "fixture-player-0" ? rankCache() : null),
    "fixture-player-0",
  ).normalized;
  normalized.participants[2].rankAtLookup = { status: "unavailable" };
  normalized.participants[3].rankAtLookup = { status: "unranked" };
  const result = buildMatchupDataset({ accepted: () => [normalized] }, config);
  assert.equal(result.schemaVersion, 4);
  assert.equal(result.rankPolicy, "seed_emerald_plus");
  for (const [index, status] of [
    [1, "not_checked"],
    [2, "unavailable"],
    [3, "unranked"],
  ]) {
    assert.equal(result.matches[0].players[index].rankStatus, status);
    assert.equal(result.matches[0].players[index].rankTier, null);
    assert.equal(result.matches[0].players[index].rankDivision, null);
  }
});

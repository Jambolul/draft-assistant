import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, acquireLock } from "../store.mjs";
import { classifyMatch, inspectMatch } from "../validation.mjs";
import { bindScope, collect, discoverSeeds, rebuild } from "../collector.mjs";
import { buildReport, publishReport } from "../report.mjs";
import { CollectionStopped } from "../client.mjs";
import { loadConfig, validateConfig } from "../config.mjs";
import {
  config,
  endTime,
  match,
  ranked,
  rankCache,
  seedStore,
} from "./fixtures.mjs";

test("patch, queue, role, region, time, remake and outcome gates reject unsuitable matches", () => {
  const cases = [
    ["wrong_patch", (m) => (m.info.gameVersion = "16.190.1")],
    ["wrong_patch", (m) => (m.info.gameVersion = "26.19.1")],
    ["wrong_queue_or_map", (m) => (m.info.queueId = 440)],
    ["wrong_region_or_id", (m) => (m.info.platformId = "EUN1")],
    [
      "outside_time_window",
      (m) => (m.info.gameStartTimestamp = endTime * 1000),
    ],
    ["short_game_or_remake", (m) => (m.info.gameDuration = 180)],
    [
      "early_surrender",
      (m) => (m.info.participants[0].gameEndedInEarlySurrender = true),
    ],
    [
      "invalid_participants",
      (m) => (m.info.participants[0].puuid = m.info.participants[1].puuid),
    ],
    [
      "invalid_champions",
      (m) =>
        (m.info.participants[0].championId = m.info.participants[1].championId),
    ],
    ["ambiguous_roles", (m) => (m.info.participants[0].teamPosition = "")],
    [
      "ambiguous_roles",
      (m) => (m.info.participants[0].teamPosition = "JUNGLE"),
    ],
    ["invalid_outcome", (m) => (m.info.participants[0].win = false)],
  ];
  for (const [expected, mutate] of cases) {
    const raw = match();
    mutate(raw);
    assert.equal(inspectMatch(raw, "EUW1_1", config, endTime).reason, expected);
  }
  assert.equal(inspectMatch(match(), "EUW1_1", config, endTime).reason, null);
});
test("only the discovery player's verified Solo/Duo rank qualifies a match", () => {
  const classifySeed = (cached, source = "fixture-player-0") =>
    classifyMatch(
      match(),
      "EUW1_1",
      config,
      endTime,
      (id) => (id === source ? cached : rankCache("CHALLENGER")),
      source,
    );
  assert.equal(classifySeed(null).reason, "seed_rank_unavailable");
  assert.equal(
    classifySeed({ ...rankCache(), body: null }).reason,
    "seed_rank_unavailable",
  );
  assert.equal(
    classifySeed({ ...rankCache(), body: [] }).reason,
    "seed_rank_below_threshold",
  );
  assert.equal(
    classifySeed({
      ...rankCache(),
      body: [
        ...ranked("PLATINUM"),
        { ...ranked("CHALLENGER")[0], queueType: "RANKED_FLEX_SR" },
      ],
    }).reason,
    "seed_rank_below_threshold",
  );
  assert.equal(
    classifySeed({
      ...rankCache(),
      body: [{ ...ranked()[0], queueType: "RANKED_FLEX_SR" }],
    }).reason,
    "seed_rank_below_threshold",
  );
  assert.equal(
    classifySeed(rankCache(), "absent-player").reason,
    "seed_not_in_match",
  );
  assert.equal(
    classifyMatch(match(), "EUW1_1", config, endTime, () => rankCache()).reason,
    "seed_not_in_match",
  );
  for (const tier of [
    "EMERALD",
    "DIAMOND",
    "MASTER",
    "GRANDMASTER",
    "CHALLENGER",
  ])
    assert.equal(classifySeed(rankCache(tier)).reason, null);
});
test("other participants need no rank check and existing observations remain accurate", () => {
  const result = classifyMatch(
    match(),
    "EUW1_1",
    config,
    endTime,
    (id) => (id === "fixture-player-0" ? rankCache() : null),
    "fixture-player-0",
  );
  assert.equal(result.reason, null);
  assert.equal(result.normalized.rankPolicy, "seed_emerald_plus");
  assert.equal(result.normalized.observedQualifyingParticipants, 1);
  assert.equal(result.normalized.discoveryRankAtLookup.tier, "EMERALD");
  assert.equal(
    result.normalized.participants.filter(
      (p) => p.rankAtLookup.status === "not_checked",
    ).length,
    9,
  );
  const withCachedRanks = classifyMatch(
    match(),
    "EUW1_1",
    config,
    endTime,
    (id) => (id === "fixture-player-0" ? rankCache() : rankCache("BRONZE")),
    "fixture-player-0",
  );
  assert.equal(withCachedRanks.reason, null);
  assert.equal(
    withCachedRanks.normalized.participants[1].rankAtLookup.tier,
    "BRONZE",
  );
  assert.equal(
    result.normalized.rankBasis,
    "snapshot_at_collection_not_rank_at_match",
  );
  assert.equal(
    JSON.stringify(result.normalized).includes("fixture-player"),
    false,
  );
});
test("deduplication preserves discovery provenance and makes no participant-rank requests", async () => {
  const store = new Store(":memory:");
  try {
    seedStore(store, ["EUW1_1", "EUW1_1", "EUW1_2"]);
    store.saveHistory("another-seed", ["EUW1_1"]);
    let matchCalls = 0,
      rankCalls = 0;
    const client = {
      get: async (_route, path, method) => {
        if (method === "match-detail") {
          matchCalls++;
          return match(path.split("/").at(-1));
        }
        if (method === "player-rank") {
          rankCalls++;
          return ranked();
        }
        throw new Error("Unexpected request");
      },
    };
    await collect({ store, config, client });
    assert.equal(store.count("candidates", "status='accepted'"), 2);
    assert.equal(matchCalls, 2);
    assert.equal(rankCalls, 0);
    await collect({ store, config, client });
    assert.equal(matchCalls, 2);
    assert.equal(rankCalls, 0);
  } finally {
    store.close();
  }
});
test("new histories use the smaller per-player count and reuse previously downloaded shared games", async () => {
  const store = new Store(":memory:");
  try {
    seedStore(store, ["EUW1_1"]);
    store.saveMatch("EUW1_1", match(), "2026-10-05");
    store.addSeed("fixture-player-1", "EMERALD-II", 1);
    store.saveRank("fixture-player-1", ranked(), "2026-10-05", "fixture");
    const methods = [];
    await collect({
      store,
      config: { ...config, matchesPerSeed: 5 },
      client: {
        get: async (_route, path, method) => {
          methods.push(method);
          if (method === "match-history") {
            const url = new URL(path, "https://europe.api.riotgames.com");
            assert.equal(url.searchParams.get("count"), "5");
            assert.equal(url.searchParams.get("queue"), "420");
            assert.ok(url.pathname.includes("fixture-player-1"));
            return ["EUW1_1", "EUW1_2"];
          }
          assert.equal(method, "match-detail");
          assert.equal(path.split("/").at(-1), "EUW1_2");
          return match("EUW1_2");
        },
      },
    });
    assert.deepEqual(methods, ["match-history", "match-detail"]);
    assert.equal(store.accepted().length, 2);
    assert.equal(store.count("seeds", "visited=1"), 2);
    assert.equal(
      store.db
        .prepare("SELECT source_puuid FROM candidates WHERE match_id='EUW1_1'")
        .get().source_puuid,
      "fixture-player-0",
    );
  } finally {
    store.close();
  }
});

test("an interrupted download resumes without refetching saved matches after reopening SQLite", async () => {
  const directory = mkdtempSync(join(tmpdir(), "draft-resume-test-"));
  let store = new Store(join(directory, "test.sqlite"));
  try {
    seedStore(store, ["EUW1_1", "EUW1_2"]);
    let calls = 0;
    const client = {
      get: async (_route, path, method) => {
        assert.equal(method, "match-detail");
        if (++calls === 2) throw new CollectionStopped("needs_key", "expired");
        return match(path.split("/").at(-1));
      },
    };
    await assert.rejects(collect({ store, config, client }), /expired/);
    assert.equal(store.count("matches"), 1);
    assert.equal(store.count("ranks"), 1);
    store.close();
    store = new Store(join(directory, "test.sqlite"));
    let resumedCalls = 0;
    await collect({
      store,
      config,
      client: {
        get: async (_r, path, method) => {
          assert.equal(method, "match-detail");
          assert.equal(path.split("/").at(-1), "EUW1_2");
          resumedCalls++;
          return match("EUW1_2");
        },
      },
    });
    assert.equal(resumedCalls, 1);
    assert.equal(store.accepted().length, 2);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("offline rebuild recovers legacy rank exclusions but rejects missing source provenance", () => {
  const store = new Store(":memory:");
  try {
    seedStore(store, ["EUW1_1"]);
    store.saveMatch("EUW1_1", match(), "2026-10-05");
    store.saveRank(
      "fixture-player-1",
      ranked("PLATINUM"),
      "2026-10-05",
      "fixture",
    );
    store.decide("EUW1_1", "rank_below_threshold");
    assert.equal(store.accepted().length, 0);
    store.saveHistory("absent-player", ["EUW1_2"]);
    store.saveMatch("EUW1_2", match("EUW1_2"), "2026-10-05");
    rebuild(store, config);
    assert.equal(store.accepted().length, 1);
    assert.equal(
      store.accepted()[0].participants[1].rankAtLookup.tier,
      "PLATINUM",
    );
    assert.equal(store.count("candidates", "status='rejected'"), 1);
    assert.equal(
      buildReport(store, config).rejectionCounts.seed_not_in_match,
      1,
    );
  } finally {
    store.close();
  }
});
test("ladder discovery expands a legacy seed pool from cache, preserves progress and remembers exhaustion", async () => {
  const store = new Store(":memory:");
  try {
    let calls = 0;
    const client = {
      get: async (_route, path) => {
        calls++;
        const entries = Array.from({ length: 3 }, (_, n) => ({
          puuid: `fixture-${path}-${n}`,
          rank: "I",
        }));
        return path.includes("/entries/") ? entries : { entries };
      },
    };
    await discoverSeeds(store, { ...config, maxSeedPlayers: 22 }, client);
    assert.equal(calls, 11);
    assert.equal(store.count("seeds"), 22);
    const visited = store.nextSeed();
    store.saveHistory(visited.puuid, ["EUW1_1"]);
    const original = store.db
      .prepare("SELECT * FROM seeds ORDER BY ordering")
      .all();
    // Old pilots stored only seedsReady, without the selection settings.
    store.db.prepare("DELETE FROM meta WHERE key='seedSelection'").run();
    await discoverSeeds(store, { ...config, maxSeedPlayers: 33 }, client);
    assert.equal(calls, 11);
    assert.equal(store.count("seeds"), 33);
    assert.equal(store.count("seeds", "visited=1"), 1);
    assert.deepEqual(
      store.db.prepare("SELECT * FROM seeds ORDER BY ordering LIMIT 22").all(),
      original,
    );
    assert.equal(store.nextCandidate().source_puuid, visited.puuid);
    assert.equal(store.cache("histories", visited.puuid).body[0], "EUW1_1");
    assert.equal(
      store.db.prepare("SELECT count(DISTINCT ordering) AS n FROM seeds").get()
        .n,
      33,
    );
    await discoverSeeds(store, { ...config, maxSeedPlayers: 44 }, client);
    await discoverSeeds(store, { ...config, maxSeedPlayers: 44 }, client);
    assert.equal(store.count("seeds"), 33);
    assert.equal(calls, 11);
    assert.equal(store.count("ranks"), 33);
    const first = store.db
      .prepare("SELECT bucket FROM seeds ORDER BY ordering LIMIT 11")
      .all();
    assert.equal(new Set(first.map((s) => s.bucket)).size, 11);
    await discoverSeeds(store, { ...config, maxSeedPlayers: 22 }, client);
    assert.equal(calls, 11);
    await discoverSeeds(
      store,
      { ...config, maxSeedPlayers: 60, seedPagesPerDivision: 3 },
      client,
    );
    assert.equal(calls, 27);
    assert.equal(store.count("seeds"), 60);
    assert.deepEqual(
      store.db.prepare("SELECT * FROM seeds ORDER BY ordering LIMIT 22").all(),
      original,
    );
    assert.equal(store.nextCandidate().source_puuid, visited.puuid);
    await discoverSeeds(
      store,
      { ...config, maxSeedPlayers: 60, seedPagesPerDivision: 3 },
      client,
    );
    assert.equal(calls, 27);
  } finally {
    store.close();
  }
});
test("10000 synthetic matches cross the old download cap, stop at target and resume without requests", async () => {
  const store = new Store(":memory:");
  const directory = mkdtempSync(join(tmpdir(), "draft-report-test-"));
  try {
    seedStore(
      store,
      Array.from({ length: 10005 }, (_, i) => "EUW1_" + (i + 1)),
    );
    let calls = 0;
    await collect({
      store,
      config: { ...config, targetMatches: 10000 },
      client: {
        get: async (_r, path, method) => {
          calls++;
          assert.equal(method, "match-detail");
          return match(path.split("/").at(-1));
        },
      },
    });
    assert.equal(calls, 10000);
    await collect({
      store,
      config: { ...config, targetMatches: 10000 },
      client: {
        get: () => {
          throw new Error("Completed matches must not be fetched again");
        },
      },
    });
    const report = publishReport(
      store,
      { ...config, targetMatches: 10000 },
      join(directory, "public.json"),
      join(directory, "summary.json"),
    );
    assert.equal(report.acceptedMatches, 10000);
    assert.equal(report.rankPolicy, "seed_emerald_plus");
    assert.equal(report.tiers.EMERALD, 10000);
    assert.equal(report.tiers.not_checked, 90000);
    assert.equal(report.pendingMatches, 5);
    assert.equal(report.status.code, "complete");
    assert.equal(
      report.championRoles.reduce((sum, r) => sum + r.games, 0),
      100000,
    );
    assert.equal(
      report.championRoles.reduce((sum, r) => sum + r.wins, 0),
      50000,
    );
    assert.equal(report.roleCounts.TOP, 20000);
    assert.equal(report.blueWins, 10000);
    const output = readFileSync(join(directory, "public.json"), "utf8");
    for (const secret of [
      "fixture-player",
      "fixture-seed",
      "EUW1_1",
      "RGAPI",
      "puuid",
    ])
      assert.equal(output.includes(secret), false);
    assert.equal(
      buildReport(store, { ...config, targetMatches: 20000 }).status.code,
      "paused",
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("scope mismatch, duplicate collectors, invalid limits and exhausted candidates fail visibly", async () => {
  const directory = mkdtempSync(join(tmpdir(), "draft-lock-test-"));
  const store = new Store(":memory:");
  try {
    const release = acquireLock(directory);
    assert.throws(() => acquireLock(directory), /already running/);
    release();
    bindScope(store, config, endTime * 1000);
    assert.throws(
      () =>
        bindScope(store, {
          ...config,
          patches: [{ label: "26.20", gameVersionPrefix: "16.20" }],
        }),
      /another region, patch/,
    );
    assert.throws(() => validateConfig({ ...config, datasetId: "../outside" }));
    assert.throws(() => validateConfig({ ...config, requestSpacingMs: 0 }));
    assert.throws(() => validateConfig({ ...config, rankPolicy: "any_rank" }));
    assert.throws(() =>
      validateConfig({ ...config, minEmeraldParticipants: 10 }),
    );
    store.set("seedsReady", true);
    store.set("seedSelection", {
      maxSeedPlayers: config.maxSeedPlayers,
      seedPagesPerDivision: config.seedPagesPerDivision,
      rankPolicy: config.rankPolicy,
    });
    await assert.rejects(
      collect({
        store,
        config,
        client: {
          get: () => {
            throw new Error("Unexpected API request");
          },
        },
      }),
      (e) => e.status === "exhausted",
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("target overrides support 5k and 10k without total request or download caps", () => {
  for (const target of [5000, 10000]) {
    const selected = loadConfig(["--target", String(target)]);
    assert.equal(selected.targetMatches, target);
    assert.equal(selected.maxRequestsPerRun, null);
    assert.equal(selected.maxDownloadedMatches, null);
  }
  assert.equal(loadConfig(["--max-requests", "none"]).maxRequestsPerRun, null);
  assert.equal(loadConfig(["--max-requests", "200"]).maxRequestsPerRun, 200);
  for (const key of ["maxRequestsPerRun", "maxDownloadedMatches"])
    for (const value of [0, -1, 1.5, "none", undefined, Infinity])
      assert.throws(() => validateConfig({ ...config, [key]: value }));
  assert.throws(() => loadConfig(["--target", "none"]));
  assert.throws(() => loadConfig(["--target", "0"]));
  assert.throws(() => validateConfig({ ...config, maxDownloadedMatches: 1 }));
});

test("an optional download cap can be removed and rejected downloads do not count toward the target", async () => {
  const store = new Store(":memory:");
  try {
    seedStore(store, ["EUW1_1", "EUW1_2", "EUW1_3"]);
    const calls = [];
    const client = {
      get: async (_route, path, method) => {
        assert.equal(method, "match-detail");
        const id = path.split("/").at(-1);
        calls.push(id);
        const raw = match(id);
        if (id === "EUW1_1") raw.info.gameVersion = "16.18.1";
        return raw;
      },
    };
    await assert.rejects(
      collect({
        store,
        config: { ...config, maxDownloadedMatches: 2 },
        client,
      }),
      (error) => error.status === "download_limit",
    );
    assert.equal(store.accepted().length, 1);
    await collect({
      store,
      config: { ...config, maxDownloadedMatches: null },
      client,
    });
    assert.equal(store.accepted().length, 2);
    assert.deepEqual(calls, ["EUW1_1", "EUW1_2", "EUW1_3"]);
  } finally {
    store.close();
  }
});

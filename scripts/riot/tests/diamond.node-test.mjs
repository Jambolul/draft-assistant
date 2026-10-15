import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Store } from "../store.mjs";
import { loadConfig, fixedScope } from "../config.mjs";
import {
  assertScope,
  bindScope,
  collect,
  discoverSeeds,
  rebuild,
} from "../collector.mjs";
import { classifyMatch } from "../validation.mjs";
import { buildReport } from "../report.mjs";
import { buildMatchupDataset } from "../matchups.mjs";
import { CacheSource, prepareFromCache } from "../cache-source.mjs";
import { config, endTime, match, ranked, rankCache } from "./fixtures.mjs";

const diamond = {
  ...loadConfig(),
  datasetId: "fixture-diamond",
  reuseDatasetId: "fixture-emerald",
};
const newEnd = Date.parse("2026-10-08T00:00:00Z") / 1000;

test("Diamond discovery excludes Emerald seeds, accepts both exact patch prefixes and records the actual patch", () => {
  const classify = (raw, tier = "DIAMOND") =>
    classifyMatch(
      raw,
      raw.metadata.matchId,
      diamond,
      newEnd,
      (id) => (id === "fixture-player-0" ? rankCache(tier) : null),
      "fixture-player-0",
    );
  assert.equal(
    classify(match(), "EMERALD").reason,
    "seed_rank_below_threshold",
  );
  const older = classify(match()).normalized;
  assert.equal(older.patch, "26.19");
  assert.equal(older.rankPolicy, "seed_diamond_plus");
  assert.equal(older.observedQualifyingParticipants, 1);
  const newerRaw = match("EUW1_2");
  newerRaw.info.gameVersion = "16.20.123.456";
  newerRaw.info.gameStartTimestamp = Date.parse("2026-10-07T12:00:00Z");
  const newer = classify(newerRaw).normalized;
  assert.equal(newer.patch, "26.20");
  for (const version of ["16.200.1", "16.18.1", "16.21.1", "26.20.1"])
    assert.equal(
      classify({
        ...newerRaw,
        info: { ...newerRaw.info, gameVersion: version },
      }).reason,
      "wrong_patch",
    );
  const exportData = buildMatchupDataset(
    { accepted: () => [older, newer] },
    diamond,
  );
  assert.deepEqual(exportData.patches, ["26.19", "26.20"]);
  assert.deepEqual(
    exportData.matches.map((row) => row.patch),
    ["26.19", "26.20"],
  );
});

test("10,000 unique discovery players are selected from Diamond and higher without requesting Emerald lists", async () => {
  const store = new Store(":memory:");
  try {
    const calls = [];
    await discoverSeeds(store, diamond, {
      get: async (_route, path) => {
        calls.push(path);
        assert.ok(!path.includes("EMERALD"));
        const count = path.includes("/entries/")
          ? 205
          : path.includes("/grandmasterleagues/")
            ? 700
            : path.includes("/challengerleagues/")
              ? 300
              : 10000;
        const entries = Array.from({ length: count }, (_, i) => ({
          puuid: `fixture-${path}-${i}`,
          rank: "I",
        }));
        return path.includes("/entries/") ? entries : { entries };
      },
    });
    assert.equal(calls.length, 43);
    assert.equal(store.count("seeds"), 10000);
    assert.equal(
      store.db
        .prepare("SELECT count(*) AS n FROM seeds WHERE bucket LIKE 'EMERALD%'")
        .get().n,
      0,
    );
    assert.equal(
      store.db.prepare("SELECT count(DISTINCT ordering) AS n FROM seeds").get()
        .n,
      10000,
    );
    assert.equal(
      store.db.prepare("SELECT count(DISTINCT bucket) AS n FROM seeds").get().n,
      7,
    );
    await discoverSeeds(store, diamond, {
      get: () => {
        throw new Error("Already selected players must be reused");
      },
    });
  } finally {
    store.close();
  }
});

test("the new dataset reuses only five games per qualifying old seed and never changes the source collection", async () => {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, "draft-diamond-cache-"));
  assert.equal(dirname(directory), root);
  const path = join(directory, "old.sqlite");
  const old = new Store(path);
  const target = new Store(":memory:");
  let source;
  try {
    old.set("scope", fixedScope(config));
    old.set("endTime", endTime);
    old.set("http", {
      totalRequests: 123,
      lastRequest: 99,
      gates: { europe: 111 },
    });
    old.saveRank(
      "fixture-player-0",
      ranked("DIAMOND"),
      "2026-10-05",
      "fixture",
    );
    old.saveRank(
      "fixture-player-1",
      ranked("EMERALD"),
      "2026-10-05",
      "fixture",
    );
    old.addSeed("fixture-player-0", "DIAMOND-II", 0);
    old.addSeed("fixture-player-1", "EMERALD-II", 1);
    const ids = Array.from({ length: 8 }, (_, i) => `EUW1_${i + 1}`);
    old.saveHistory("fixture-player-0", ids);
    old.saveHistory("fixture-player-1", ["EUW1_9"]);
    for (const id of [...ids, "EUW1_9"])
      old.saveMatch(id, match(id), "2026-10-05");
    const sourceCounts = [
      old.count("seeds"),
      old.count("matches"),
      old.count("candidates"),
    ];
    source = new CacheSource(path, diamond);
    bindScope(target, diamond, newEnd * 1000);
    const readCache = source.cache.bind(source);
    source.cache = (table, key) => {
      if (table === "matches") throw new Error("Interrupted cache import");
      return readCache(table, key);
    };
    assert.throws(
      () => prepareFromCache(target, diamond, source),
      /Interrupted/,
    );
    assert.equal(target.count("seeds"), 0);
    assert.equal(target.count("histories"), 0);
    assert.equal(target.count("ranks"), 0);
    assert.equal(target.get("cachePrepared"), null);
    source.cache = readCache;
    prepareFromCache(target, diamond, source);
    rebuild(target, diamond);
    assert.equal(target.count("seeds"), 1);
    assert.equal(target.accepted().length, 5);
    assert.equal(target.cache("histories", "fixture-player-0").body.length, 5);
    assert.equal(target.cache("histories", "fixture-player-1"), null);
    assert.equal(target.cache("matches", "EUW1_6"), null);
    assert.equal(target.get("endTime"), newEnd);
    assert.equal(target.get("http").totalRequests, 0);
    assert.deepEqual(target.get("http").gates, { europe: 111 });
    assert.equal(target.get("reusedMatches"), 5);
    prepareFromCache(target, diamond, source);
    assert.equal(target.get("reusedMatches"), 5);
    const report = buildReport(target, diamond);
    assert.deepEqual(report.patchCounts, { 26.19: 5, "26.20": 0 });
    assert.ok(report.rankBasis.includes("Diamond+"));
    // A sixth appearance by an old player is allowed when another seed supplied it.
    target.addSeed("fixture-player-2", "DIAMOND-II", 1);
    target.saveRank(
      "fixture-player-2",
      ranked("DIAMOND"),
      "2026-10-07",
      "fixture",
    );
    let requests = 0;
    await collect({
      store: target,
      config: { ...diamond, maxSeedPlayers: 2, targetMatches: 6 },
      cacheSource: source,
      client: {
        get: async (_route, path, method) => {
          requests++;
          assert.equal(method, "match-history");
          assert.equal(
            new URL(path, "https://europe.api.riotgames.com").searchParams.get(
              "count",
            ),
            "5",
          );
          return ["EUW1_6"];
        },
      },
    });
    assert.equal(requests, 1);
    assert.equal(target.accepted().length, 6);
    assert.equal(target.get("reusedMatches"), 6);
    assert.deepEqual(
      [old.count("seeds"), old.count("matches"), old.count("candidates")],
      sourceCounts,
    );
    assert.equal(old.cache("histories", "fixture-player-0").body.length, 8);
    assert.equal(old.get("http").totalRequests, 123);
    assert.throws(() => source.db.exec("DELETE FROM seeds"), /readonly/i);
  } finally {
    source?.close();
    old.close();
    target.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("minimum rank, patch set and history size cannot silently change in an existing dataset", () => {
  const store = new Store(":memory:");
  try {
    bindScope(store, diamond, newEnd * 1000);
    assert.throws(
      () => assertScope(store, { ...diamond, rankPolicy: "seed_emerald_plus" }),
      /minimum rank/,
    );
    assert.throws(
      () => assertScope(store, { ...diamond, patches: [diamond.patches[0]] }),
      /patch/,
    );
    assert.throws(
      () => assertScope(store, { ...diamond, matchesPerSeed: 20 }),
      /games per discovery player/,
    );
    assert.doesNotThrow(() =>
      assertScope(store, { ...diamond, targetMatches: 50000 }),
    );
  } finally {
    store.close();
  }
});

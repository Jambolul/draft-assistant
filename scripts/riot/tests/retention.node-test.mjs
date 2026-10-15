import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Store } from "../store.mjs";
import { loadConfig } from "../config.mjs";
import { bindScope, collect, rebuild } from "../collector.mjs";
import {
  CacheSource,
  prepareFromCache,
  retainAcceptedFromCache,
} from "../cache-source.mjs";
import { buildReport } from "../report.mjs";
import { buildMatchupDataset } from "../matchups.mjs";
import { classifyMatch } from "../validation.mjs";
import { config, endTime, match, ranked, rankCache } from "./fixtures.mjs";

test("all earlier accepted games survive new rank/history limits, deduplication, rebuild and future collection", async () => {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, "draft-retention-"));
  assert.equal(dirname(directory), root);
  const path = join(directory, "earlier.sqlite");
  const old = new Store(path);
  const current = new Store(":memory:");
  const nextConfig = {
    ...loadConfig(),
    datasetId: "retention-test",
    reuseDatasetId: "old-test",
    maxSeedPlayers: 3,
    targetMatches: 13,
  };
  let source;
  try {
    bindScope(old, config, endTime * 1000);
    for (const [index, tier, ids] of [
      [0, "EMERALD", Array.from({ length: 8 }, (_, i) => `EUW1_${i + 1}`)],
      [1, "DIAMOND", ["EUW1_9", "EUW1_10", "EUW1_11", "EUW1_12"]],
    ]) {
      const player = `fixture-player-${index}`;
      old.addSeed(player, `${tier}-II`, index);
      old.saveRank(player, ranked(tier), "2026-10-05T00:00:00Z", "fixture");
      old.saveHistory(player, ids);
      for (const id of ids) {
        const raw = match(id);
        if (id === "EUW1_12") raw.info.gameDuration = 100;
        old.saveMatch(id, raw, "2026-10-05T00:00:00Z");
      }
    }
    rebuild(old, config);
    assert.equal(old.accepted().length, 11);
    source = new CacheSource(path, nextConfig);
    bindScope(current, nextConfig, endTime * 1000);
    prepareFromCache(current, nextConfig, source);
    current.addSeed("fixture-player-3", "DIAMOND-II", 1);
    current.saveRank(
      "fixture-player-3",
      ranked("DIAMOND"),
      "2026-10-05T00:00:00Z",
      "fixture",
    );
    current.saveHistory("fixture-player-3", ["EUW1_100"]);
    current.saveMatch("EUW1_100", match("EUW1_100"), "2026-10-05T00:00:00Z");
    current.addSeed("fixture-player-2", "DIAMOND-II", 2);
    current.saveRank(
      "fixture-player-2",
      ranked("DIAMOND"),
      "2026-10-05T00:00:00Z",
      "fixture",
    );
    current.set("http", { totalRequests: 33 });
    rebuild(current, nextConfig);
    const progress = current.db
      .prepare("SELECT * FROM seeds ORDER BY ordering")
      .all();
    const histories = current.db
      .prepare("SELECT * FROM histories ORDER BY puuid")
      .all();
    const before = current.accepted().map((m) => m.matchId);
    const reused = current.get("reusedMatches");

    const readCache = source.cache.bind(source);
    source.cache = (table, key) => {
      if (table === "matches" && key === "EUW1_8")
        throw new Error("Interrupted restoration");
      return readCache(table, key);
    };
    assert.throws(
      () => retainAcceptedFromCache(current, nextConfig, source),
      /Interrupted/,
    );
    assert.deepEqual(
      current.accepted().map((m) => m.matchId),
      before,
    );
    assert.equal(
      current.db.prepare("SELECT count(*) AS n FROM retained_matches").get().n,
      0,
    );
    assert.equal(current.get("retainedImport"), null);
    assert.equal(current.get("reusedMatches"), reused);
    source.cache = readCache;

    retainAcceptedFromCache(current, nextConfig, source);
    assert.equal(current.accepted().length, 12);
    const afterReuse = current.get("reusedMatches");
    retainAcceptedFromCache(current, nextConfig, source);
    assert.equal(current.get("reusedMatches"), afterReuse);
    assert.deepEqual(
      current.db.prepare("SELECT * FROM seeds ORDER BY ordering").all(),
      progress,
    );
    assert.deepEqual(
      current.db.prepare("SELECT * FROM histories ORDER BY puuid").all(),
      histories,
    );
    assert.equal(current.get("http").totalRequests, 33);
    assert.equal(current.cache("histories", "fixture-player-0"), null);
    assert.equal(current.cache("matches", "EUW1_8"), null);
    assert.equal(current.savedMatchCount(), 13); // 12 accepted and one cached rejected game

    // Rebuilding cannot reclassify old Emerald games under the newer Diamond rule.
    rebuild(current, nextConfig);
    rebuild(current, nextConfig);
    const retained = current.accepted().filter((m) => m.retainedFromDataset);
    assert.equal(retained.length, 11);
    assert.ok(retained.every((m) => m.rankPolicy === "seed_emerald_plus"));
    assert.equal(
      current.accepted().find((m) => m.matchId === "EUW1_100").rankPolicy,
      "seed_diamond_plus",
    );
    assert.equal(
      classifyMatch(
        match("EUW1_101"),
        "EUW1_101",
        nextConfig,
        endTime,
        () => rankCache("EMERALD"),
        "fixture-player-2",
      ).reason,
      "seed_rank_below_threshold",
    );

    const calls = [];
    await collect({
      store: current,
      config: nextConfig,
      cacheSource: source,
      client: {
        get: async (_route, path, method) => {
          calls.push(method);
          if (method === "match-history") {
            assert.equal(
              new URL(
                path,
                "https://europe.api.riotgames.com",
              ).searchParams.get("count"),
              "5",
            );
            return ["EUW1_1", "EUW1_101"];
          }
          assert.equal(method, "match-detail");
          assert.ok(path.endsWith("EUW1_101"));
          return match("EUW1_101");
        },
      },
    });
    assert.deepEqual(calls, ["match-history", "match-detail"]);
    assert.equal(current.accepted().length, 13);
    assert.equal(new Set(current.accepted().map((m) => m.matchId)).size, 13);
    const report = buildReport(current, nextConfig);
    assert.equal(report.retainedMatches, 11);
    assert.equal(report.downloadedMatches, 14);
    assert.deepEqual(report.retainedRankPolicies, ["seed_emerald_plus"]);
    const exported = buildMatchupDataset(current, nextConfig);
    assert.equal(exported.retainedMatches, 11);
    assert.equal(
      exported.matches.filter((m) => m.collectionPhase === "current").length,
      2,
    );
    assert.equal(JSON.stringify(exported).includes("fixture-player"), false);
    assert.equal(
      JSON.stringify(exported).includes("retainedFromDataset"),
      false,
    );
    assert.equal(old.accepted().length, 11);
    assert.equal(old.cache("histories", "fixture-player-0").body.length, 8);
    assert.throws(() => source.db.exec("DELETE FROM candidates"), /readonly/i);
  } finally {
    source?.close();
    old.close();
    current.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

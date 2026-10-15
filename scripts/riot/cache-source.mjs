import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { projectRoot, rankPolicy } from "./config.mjs";
import { classifyMatch, rankSnapshot } from "./validation.mjs";

// Old collections are opened read-only. Only the new dataset receives writes.
export class CacheSource {
  constructor(path, config) {
    this.db = new DatabaseSync(path, { readOnly: true });
    try {
      const scope = this.meta("scope");
      if (
        !scope ||
        ["region", "platform", "routing", "queueId", "leagueQueue"].some(
          (key) => scope[key] !== config[key],
        )
      )
        throw new Error(
          "The reusable cache belongs to another region or queue.",
        );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  meta(key) {
    const row = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return row ? JSON.parse(row.value) : null;
  }
  cache(table, key) {
    const column = { matches: "match_id", histories: "puuid", ranks: "puuid" }[
      table
    ];
    if (!column) throw new Error("Unsupported reusable cache table.");
    const row = this.db
      .prepare(`SELECT * FROM ${table} WHERE ${column}=?`)
      .get(key);
    return row
      ? { ...row, body: row.body === null ? null : JSON.parse(row.body) }
      : null;
  }
  close() {
    this.db.close();
  }
}
export function openCacheSource(config) {
  if (!config.reuseDatasetId) return null;
  const path = resolve(
    projectRoot,
    "data/riot",
    config.reuseDatasetId,
    "pilot.sqlite",
  );
  return existsSync(path) ? new CacheSource(path, config) : null;
}
export function prepareFromCache(store, config, source) {
  if (!source || store.get("cachePrepared")) return;
  // Do not replace progress in a dataset that was already collected independently.
  if (store.count("seeds") || store.count("candidates")) return;
  const policy = rankPolicy(config);
  store.transaction(() => {
    for (const row of source.db.prepare("SELECT * FROM pages").iterate())
      if (
        policy.pagedTiers.some((tier) => row.key.includes(`/${tier}/`)) ||
        row.key.includes("leagues/by-queue/")
      )
        store.savePage(row.key, JSON.parse(row.body), row.observed_at);
    // Import qualifying rank observations. New Diamond ladder observations can
    // then qualify players who were below Diamond in the older collection.
    for (const row of source.db.prepare("SELECT * FROM ranks").iterate()) {
      const cached = {
        ...row,
        body: row.body === null ? null : JSON.parse(row.body),
      };
      const rank = rankSnapshot(cached, config.leagueQueue);
      if (rank.status === "ranked" && policy.tiers.includes(rank.tier))
        store.saveRank(row.puuid, cached.body, row.observed_at, row.source);
    }
    let ordering = 0,
      reused = 0;
    for (const seed of source.db
      .prepare("SELECT * FROM seeds ORDER BY ordering, puuid")
      .iterate()) {
      const rank = rankSnapshot(
        store.cache("ranks", seed.puuid),
        config.leagueQueue,
      );
      if (rank.status !== "ranked" || !policy.tiers.includes(rank.tier))
        continue;
      if (ordering >= config.maxSeedPlayers) break;
      const history = source.cache("histories", seed.puuid);
      if (!history || !Array.isArray(history.body)) continue;
      const bucket = ["EMERALD", "DIAMOND"].includes(rank.tier)
        ? `${rank.tier}-${rank.division}`
        : rank.tier;
      store.addSeed(seed.puuid, bucket, ordering++);
      const ids = history.body
        .filter((id) => typeof id === "string" && /^EUW1_\d+$/.test(id))
        .slice(0, config.matchesPerSeed);
      store.saveHistory(seed.puuid, ids);
      for (const id of ids) {
        if (store.cache("matches", id)) continue;
        const match = source.cache("matches", id);
        if (match) {
          store.saveMatch(id, match.body, match.fetched_at);
          reused++;
        }
      }
    }
    // Carry active cooldowns across datasets without counting old API calls again.
    const http = source.meta("http");
    if (http && !store.get("http"))
      store.set("http", { ...http, totalRequests: 0 });
    store.set("reusedMatches", reused);
    store.set("cachePrepared", {
      sourceDatasetId: config.reuseDatasetId,
      rankPolicy: config.rankPolicy,
      matchesPerSeed: config.matchesPerSeed,
    });
    store.set("status", {
      code: "paused",
      message:
        "Cached games prepared. Run the collector to expand the Diamond+ player pool and collect more matches.",
    });
  });
}

// Preserve the accepted historical cohort independently of future discovery rules.
// This can also repair a dataset already populated by the earlier five-game import.
export function retainAcceptedFromCache(store, config, source) {
  if (!config.retainAcceptedMatches || !source) return;
  const previous = store.get("retainedImport");
  if (previous) {
    if (previous.sourceDatasetId !== config.reuseDatasetId)
      throw new Error("Retained matches already came from another dataset.");
    return;
  }
  store.transaction(() => {
    const retain = store.db.prepare(
      "INSERT INTO retained_matches VALUES (?, ?, ?)",
    );
    const accept = store.db
      .prepare(`INSERT INTO candidates (match_id, source_puuid, status, reason, normalized)
      VALUES (?, ?, 'accepted', NULL, ?) ON CONFLICT(match_id) DO UPDATE SET
      source_puuid=excluded.source_puuid, status='accepted', reason=NULL, normalized=excluded.normalized`);
    const saved = store.db.prepare("SELECT 1 FROM matches WHERE match_id=?");
    let count = 0,
      reused = 0;
    for (const row of source.db
      .prepare(
        "SELECT match_id, source_puuid, normalized FROM candidates WHERE status='accepted' ORDER BY match_id",
      )
      .iterate()) {
      const original = JSON.parse(row.normalized);
      const historicalConfig = { ...config, rankPolicy: original.rankPolicy };
      rankPolicy(historicalConfig);
      const raw = source.cache("matches", row.match_id);
      const result =
        raw &&
        classifyMatch(
          raw.body,
          row.match_id,
          historicalConfig,
          store.get("endTime"),
          (id) => source.cache("ranks", id),
          row.source_puuid,
        );
      if (!result || result.reason)
        throw new Error(
          "An earlier accepted match could not be retained under its original rank rule and the active region, patch and date scope. No matches were imported.",
        );
      const normalized = JSON.stringify({
        ...result.normalized,
        retainedFromDataset: config.reuseDatasetId,
      });
      retain.run(row.match_id, config.reuseDatasetId, normalized);
      accept.run(row.match_id, row.source_puuid, normalized);
      if (!saved.get(row.match_id)) reused++;
      count++;
    }
    store.set("reusedMatches", (store.get("reusedMatches") ?? 0) + reused);
    store.set("retainedImport", {
      sourceDatasetId: config.reuseDatasetId,
      matches: count,
    });
  });
}

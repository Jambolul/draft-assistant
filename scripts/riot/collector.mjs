import { createHash } from "node:crypto";
import { fixedScope, rankPolicy } from "./config.mjs";
import { CollectionStopped } from "./client.mjs";
import { classifyMatch } from "./validation.mjs";

const nowIso = () => new Date().toISOString();
const orderHash = (value) => createHash("sha256").update(value).digest("hex");
function checkEntries(body) {
  if (!Array.isArray(body))
    throw new CollectionStopped(
      "error",
      "Riot returned an unexpected ranked-player response.",
    );
  if (body.some((p) => typeof p?.puuid !== "string" || !p.puuid))
    throw new CollectionStopped(
      "error",
      "A ranked response is missing player identifiers. Check the current Riot API schema.",
    );
}
export function assertScope(store, config) {
  const scope = fixedScope(config);
  if (
    store.get("scope") &&
    JSON.stringify(store.get("scope")) !== JSON.stringify(scope)
  )
    throw new Error(
      "The saved dataset uses another region, patch or time window. Use a new datasetId to preserve the existing collection.",
    );
  const savedPolicy =
    store.get("rankPolicy") ??
    (store.count("seeds") || store.count("candidates")
      ? "seed_emerald_plus"
      : null);
  if (savedPolicy && savedPolicy !== config.rankPolicy)
    throw new Error(
      "The saved dataset uses a different minimum rank. Use a new datasetId to preserve it.",
    );
  const savedSampling = store.get("sampling");
  if (savedSampling && savedSampling.matchesPerSeed !== config.matchesPerSeed)
    throw new Error(
      "The saved dataset uses a different number of games per discovery player. Use a new datasetId.",
    );
}
export function bindScope(store, config, now = Date.now()) {
  assertScope(store, config);
  store.set("scope", fixedScope(config));
  store.set("rankPolicy", config.rankPolicy);
  store.set("sampling", { matchesPerSeed: config.matchesPerSeed });
  if (!store.get("endTime"))
    store.set(
      "endTime",
      Math.floor(Math.min(now, Date.parse(config.windowEnd)) / 1000),
    );
  if (store.get("endTime") * 1000 <= Date.parse(config.windowStart))
    throw new Error("This patch's collection window has not started yet.");
}
export async function discoverSeeds(store, config, client) {
  const policy = rankPolicy(config);
  const selection = {
    maxSeedPlayers: config.maxSeedPlayers,
    seedPagesPerDivision: config.seedPagesPerDivision,
    rankPolicy: config.rankPolicy,
  };
  if (
    store.count("seeds") >= config.maxSeedPlayers ||
    (store.get("seedsReady") &&
      JSON.stringify(store.get("seedSelection")) === JSON.stringify(selection))
  )
    return;
  const buckets = [];
  for (const tier of policy.pagedTiers)
    for (const division of ["I", "II", "III", "IV"]) {
      const rows = [];
      for (let page = 1; page <= config.seedPagesPerDivision; page++) {
        const path = `/lol/league/v4/entries/${config.leagueQueue}/${tier}/${division}?page=${page}`;
        let cached = store.cache("pages", path);
        if (!cached) {
          const body = await client.get(
            config.platform,
            path,
            "ladder-entries",
          );
          checkEntries(body);
          store.savePage(path, body, nowIso());
          cached = store.cache("pages", path);
        }
        checkEntries(cached.body);
        for (const entry of cached.body)
          rows.push({
            ...entry,
            tier,
            rank: division,
            queueType: config.leagueQueue,
            observedAt: cached.observed_at,
          });
        if (!cached.body.length) break;
      }
      buckets.push({ name: `${tier}-${division}`, rows });
    }
  for (const [tier, endpoint] of [
    ["MASTER", "masterleagues"],
    ["GRANDMASTER", "grandmasterleagues"],
    ["CHALLENGER", "challengerleagues"],
  ]) {
    const path = `/lol/league/v4/${endpoint}/by-queue/${config.leagueQueue}`;
    let cached = store.cache("pages", path);
    if (!cached) {
      const body = await client.get(config.platform, path, endpoint);
      checkEntries(body?.entries);
      store.savePage(path, body, nowIso());
      cached = store.cache("pages", path);
    }
    checkEntries(cached.body.entries);
    buckets.push({
      name: tier,
      rows: cached.body.entries.map((entry) => ({
        ...entry,
        tier,
        rank: "I",
        queueType: config.leagueQueue,
        observedAt: cached.observed_at,
      })),
    });
  }
  store.transaction(() => {
    for (const bucket of buckets) {
      bucket.rows.sort((a, b) =>
        orderHash(config.datasetId + a.puuid).localeCompare(
          orderHash(config.datasetId + b.puuid),
        ),
      );
      for (const entry of bucket.rows) {
        const { observedAt, ...rank } = entry;
        store.saveRank(entry.puuid, [rank], observedAt, "league-ladder");
      }
    }
    // Append new seeds without resetting visited histories or changing the old order.
    const existing = store.db
      .prepare("SELECT puuid, ordering FROM seeds")
      .all();
    let index = 0,
      ordering = existing.reduce(
        (next, seed) => Math.max(next, seed.ordering + 1),
        0,
      );
    const seen = new Set(existing.map((seed) => seed.puuid));
    while (
      seen.size < config.maxSeedPlayers &&
      buckets.some((b) => b.rows[index])
    ) {
      for (const bucket of buckets) {
        const entry = bucket.rows[index];
        if (
          entry &&
          !seen.has(entry.puuid) &&
          policy.tiers.includes(entry.tier) &&
          seen.size < config.maxSeedPlayers
        ) {
          store.addSeed(entry.puuid, bucket.name, ordering++);
          seen.add(entry.puuid);
        }
      }
      index++;
    }
    store.set("seedsReady", true);
    store.set("seedSelection", selection);
  });
}
export function rebuild(store, config) {
  for (const row of store.db
    .prepare("SELECT match_id, normalized FROM retained_matches")
    .iterate())
    store.decide(row.match_id, null, JSON.parse(row.normalized));
  const end = store.get("endTime");
  for (const row of store.cachedMatches()) {
    const result = classifyMatch(
      row.body,
      row.match_id,
      config,
      end,
      (id) => store.cache("ranks", id),
      row.source_puuid,
    );
    store.decide(row.match_id, result.reason, result.normalized);
  }
}
export async function collect({
  store,
  config,
  client,
  publish = () => {},
  signal,
  log = () => {},
  cacheSource = null,
}) {
  bindScope(store, config);
  rebuild(store, config);
  if (store.count("candidates", "status='accepted'") >= config.targetMatches) {
    store.set("status", {
      code: "complete",
      message: "The pilot target has been reached.",
    });
    publish();
    return;
  }
  store.set("status", {
    code: "collecting",
    message: `Collecting Solo/Duo matches through known ${rankPolicy(config).label} players. Other participants' ranks are not required.`,
  });
  publish();
  await discoverSeeds(store, config, client);
  publish();
  let handled = 0;
  while (
    store.count("candidates", "status='accepted'") < config.targetMatches
  ) {
    signal?.throwIfAborted();
    let candidate = store.nextCandidate();
    if (!candidate) {
      const seed = store.nextSeed();
      if (!seed)
        throw new CollectionStopped(
          "exhausted",
          `All ${store.count("seeds")} saved seed players have been searched. Increase maxSeedPlayers and, if needed, seedPagesPerDivision in scripts/riot/pilot.config.json, then rerun with the same target. Saved matches will be reused.`,
        );
      const params = new URLSearchParams({
        queue: String(config.queueId),
        startTime: String(Math.floor(Date.parse(config.windowStart) / 1000)),
        endTime: String(store.get("endTime")),
        start: "0",
        count: String(config.matchesPerSeed),
      });
      const ids = await client.get(
        config.routing,
        `/lol/match/v5/matches/by-puuid/${encodeURIComponent(seed.puuid)}/ids?${params}`,
        "match-history",
      );
      if (
        ids !== null &&
        (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
      )
        throw new CollectionStopped(
          "error",
          "Riot returned an invalid match history.",
        );
      store.saveHistory(
        seed.puuid,
        (ids ?? []).filter((id) => /^EUW1_\d+$/.test(id)),
      );
      candidate = store.nextCandidate();
      if (!candidate) continue;
    }
    let cached = store.cache("matches", candidate.match_id);
    if (!cached) {
      const reusable = cacheSource?.cache("matches", candidate.match_id);
      if (reusable) {
        store.saveMatch(candidate.match_id, reusable.body, reusable.fetched_at);
        store.set("reusedMatches", (store.get("reusedMatches") ?? 0) + 1);
        cached = store.cache("matches", candidate.match_id);
      }
    }
    if (!cached) {
      if (
        config.maxDownloadedMatches != null &&
        store.count("matches") >= config.maxDownloadedMatches
      )
        throw new CollectionStopped(
          "download_limit",
          "The optional download cap was reached. Progress is saved; raise the cap or set maxDownloadedMatches to null to continue.",
        );
      const raw = await client.get(
        config.routing,
        `/lol/match/v5/matches/${candidate.match_id}`,
        "match-detail",
      );
      store.saveMatch(candidate.match_id, raw, nowIso());
      cached = store.cache("matches", candidate.match_id);
    }
    const result = classifyMatch(
      cached.body,
      candidate.match_id,
      config,
      store.get("endTime"),
      (id) => store.cache("ranks", id),
      candidate.source_puuid,
    );
    store.decide(candidate.match_id, result.reason, result.normalized);
    if (++handled % 5 === 0) {
      log(
        `${store.count("candidates", "status='accepted'")}/${config.targetMatches} accepted; ${store.savedMatchCount()} saved; ${store.count("candidates", "status='rejected'")} excluded.`,
      );
      publish();
    }
  }
  store.set("status", {
    code: "complete",
    message: "The pilot target has been reached.",
  });
  publish();
}

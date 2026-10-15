import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { rankPolicy } from "./config.mjs";
export function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + ".tmp";
  writeFileSync(temporary, text);
  renameSync(temporary, path);
}
export function buildReport(store, config, now = new Date().toISOString()) {
  const matches = store.accepted();
  const retained = matches.filter((match) => match.retainedFromDataset);
  const championRoles = new Map(),
    tiers = {},
    patchCounts = Object.fromEntries(config.patches.map((p) => [p.label, 0])),
    versions = {},
    roleCounts = {};
  let blueWins = 0,
    rankMin = null,
    rankMax = null;
  for (const match of matches) {
    patchCounts[match.patch] = (patchCounts[match.patch] ?? 0) + 1;
    versions[match.gameVersion] = (versions[match.gameVersion] ?? 0) + 1;
    if (match.participants.some((p) => p.teamId === 100 && p.win)) blueWins++;
    for (const p of match.participants) {
      const key = p.championId + ":" + p.role;
      const entry = championRoles.get(key) ?? {
        championId: p.championId,
        championName: p.championName,
        role: p.role,
        games: 0,
        wins: 0,
      };
      entry.games++;
      if (p.win) entry.wins++;
      championRoles.set(key, entry);
      const tier = p.rankAtLookup.tier ?? p.rankAtLookup.status;
      tiers[tier] = (tiers[tier] ?? 0) + 1;
      roleCounts[p.role] = (roleCounts[p.role] ?? 0) + 1;
      const at = p.rankAtLookup.observedAt;
      if (at && (!rankMin || at < rankMin)) rankMin = at;
      if (at && (!rankMax || at > rankMax)) rankMax = at;
    }
  }
  const rejectionCounts = Object.fromEntries(
    store.db
      .prepare(
        "SELECT reason, count(*) AS n FROM candidates WHERE status='rejected' GROUP BY reason",
      )
      .all()
      .map((row) => [row.reason, row.n]),
  );
  const collectedStatus = store.get("status") ?? {
    code: "not_started",
    message: "No matches have been collected yet.",
  };
  const status =
    matches.length >= config.targetMatches
      ? { code: "complete", message: "The pilot target has been reached." }
      : collectedStatus.code === "complete"
        ? {
            code: "paused",
            message:
              "The target or inclusion rule changed. Run the collector to continue.",
          }
        : collectedStatus;
  return {
    schemaVersion: 4,
    source: "Riot API",
    generatedAt: now,
    datasetId: config.datasetId,
    region: config.region,
    queue: "Ranked Solo/Duo",
    patches: config.patches.map((p) => p.label),
    patchCounts,
    targetMatches: config.targetMatches,
    acceptedMatches: matches.length,
    downloadedMatches: store.savedMatchCount(),
    retainedMatches: retained.length,
    retainedRankPolicies: [
      ...new Set(retained.map((match) => match.rankPolicy)),
    ],
    discoveredMatches: store.count("candidates"),
    rejectedMatches: store.count("candidates", "status='rejected'"),
    pendingMatches: store.count("candidates", "status='pending'"),
    seedPlayers: store.count("seeds"),
    visitedSeedPlayers: store.count("seeds", "visited=1"),
    rankSnapshots: store.count("ranks"),
    apiRequests: store.get("http")?.totalRequests ?? 0,
    status,
    rankPolicy: config.rankPolicy,
    maxSeedPlayers: config.maxSeedPlayers,
    matchesPerSeed: config.matchesPerSeed,
    reusedMatches: store.get("reusedMatches") ?? 0,
    rankBasis: `New games are discovered through a player observed at ${rankPolicy(config).label} in Solo/Duo. ${retained.length} earlier accepted games retain their original inclusion rules. Other participants need no rank check. Cached snapshots are observations at lookup time, not historical rank or MMR. This is a non-representative sample.`,
    windowStart: config.windowStart,
    windowEnd: store.get("endTime")
      ? new Date(store.get("endTime") * 1000).toISOString()
      : config.windowEnd,
    rankObservedFrom: rankMin,
    rankObservedTo: rankMax,
    firstMatchAt: matches.map((m) => m.startedAt).sort()[0] ?? null,
    lastMatchAt:
      matches
        .map((m) => m.startedAt)
        .sort()
        .at(-1) ?? null,
    blueWins,
    rejectionCounts,
    tiers,
    versions,
    roleCounts,
    championRoles: [...championRoles.values()].sort(
      (a, b) =>
        b.games - a.games ||
        a.championName.localeCompare(b.championName) ||
        a.role.localeCompare(b.role),
    ),
    // Only aggregates are exported to the browser: never player IDs, raw responses or credentials.
  };
}
export function publishReport(store, config, publicPath, localPath) {
  const report = buildReport(store, config);
  const json = JSON.stringify(report, null, 2) + "\n";
  writeAtomic(localPath, json);
  writeAtomic(publicPath, json);
  return report;
}

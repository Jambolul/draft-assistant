import { writeAtomic } from "./report.mjs";

// Deliberate browser export allowlist. Never copy raw responses or player IDs.
export function buildMatchupDataset(
  store,
  config,
  now = new Date().toISOString(),
) {
  const accepted = store.accepted();
  const champions = new Map();
  const matches = accepted.map((match) => {
    const players = match.participants.map((player) => {
      champions.set(player.championId, {
        id: player.championId,
        name: player.championName,
      });
      return {
        championId: player.championId,
        role: player.role,
        teamId: player.teamId,
        rankStatus: player.rankAtLookup.status,
        rankTier: player.rankAtLookup.tier ?? null,
        rankDivision: player.rankAtLookup.division ?? null,
      };
    });
    return {
      matchId: match.matchId,
      patch: match.patch,
      rankPolicy: match.rankPolicy,
      collectionPhase: match.retainedFromDataset ? "retained" : "current",
      startedAt: match.startedAt,
      durationSeconds: match.durationSeconds,
      blueWin: match.participants.some(
        (player) => player.teamId === 100 && player.win,
      ),
      players,
    };
  });
  return {
    schemaVersion: 4,
    source: "Riot API",
    datasetId: config.datasetId,
    region: config.region,
    queueId: config.queueId,
    patches: config.patches.map((p) => p.label),
    generatedAt: now,
    rankPolicy: config.rankPolicy,
    retainedMatches: matches.filter(
      (match) => match.collectionPhase === "retained",
    ).length,
    retainedRankPolicies: [
      ...new Set(
        matches
          .filter((match) => match.collectionPhase === "retained")
          .map((match) => match.rankPolicy),
      ),
    ],
    champions: [...champions.values()].sort((a, b) => a.id - b.id),
    matches,
  };
}

export function publishMatchupDataset(store, config, path) {
  const dataset = buildMatchupDataset(store, config);
  writeAtomic(path, JSON.stringify(dataset) + "\n");
  return dataset;
}

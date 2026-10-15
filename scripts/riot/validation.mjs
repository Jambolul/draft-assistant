import { emeraldTiers, positions, rankPolicy } from "./config.mjs";
export function inspectMatch(raw, expectedId, config, endTime) {
  if (raw === null) return { reason: "match_unavailable" };
  const info = raw?.info,
    participants = info?.participants;
  if (
    !raw?.metadata ||
    raw.metadata.matchId !== expectedId ||
    !/^EUW1_\d+$/.test(expectedId) ||
    info?.platformId !== "EUW1"
  )
    return { reason: "wrong_region_or_id" };
  if (
    info.queueId !== config.queueId ||
    info.mapId !== 11 ||
    info.gameMode !== "CLASSIC"
  )
    return { reason: "wrong_queue_or_map" };
  const prefix =
    typeof info.gameVersion === "string"
      ? info.gameVersion.split(".").slice(0, 2).join(".")
      : null;
  const patch = config.patches.find((p) => p.gameVersionPrefix === prefix);
  if (!patch) return { reason: "wrong_patch" };
  if (
    !Number.isSafeInteger(info.gameStartTimestamp) ||
    info.gameStartTimestamp < Date.parse(config.windowStart) ||
    info.gameStartTimestamp >= endTime * 1000
  )
    return { reason: "outside_time_window" };
  if (
    !Number.isFinite(info.gameDuration) ||
    info.gameDuration < config.minDurationSeconds
  )
    return { reason: "short_game_or_remake" };
  if (
    !Array.isArray(participants) ||
    participants.length !== 10 ||
    !Array.isArray(raw.metadata.participants) ||
    raw.metadata.participants.length !== 10
  )
    return { reason: "invalid_participants" };
  if (participants.some((p) => p.gameEndedInEarlySurrender === true))
    return { reason: "early_surrender" };
  const ids = participants.map((p) => p.puuid);
  if (
    ids.some((id) => typeof id !== "string" || !id) ||
    new Set(ids).size !== 10 ||
    new Set(raw.metadata.participants).size !== 10 ||
    raw.metadata.participants.some((id) => !ids.includes(id))
  )
    return { reason: "invalid_participants" };
  if (
    participants.some(
      (p) =>
        !Number.isSafeInteger(p.championId) ||
        p.championId < 1 ||
        typeof p.championName !== "string" ||
        !p.championName,
    ) ||
    new Set(participants.map((p) => p.championId)).size !== 10
  )
    return { reason: "invalid_champions" };
  if (
    !Array.isArray(info.teams) ||
    info.teams.length !== 2 ||
    info.teams.filter((t) => t.win === true).length !== 1
  )
    return { reason: "invalid_outcome" };
  for (const teamId of [100, 200]) {
    const team = participants.filter((p) => p.teamId === teamId),
      outcome = info.teams.find((t) => t.teamId === teamId);
    if (
      team.length !== 5 ||
      new Set(team.map((p) => p.teamPosition)).size !== 5 ||
      team.some((p) => !positions.includes(p.teamPosition))
    )
      return { reason: "ambiguous_roles" };
    if (
      !outcome ||
      typeof outcome.win !== "boolean" ||
      team.some((p) => p.win !== outcome.win)
    )
      return { reason: "invalid_outcome" };
  }
  return { reason: null, info, participants, patch: patch.label };
}
export function rankSnapshot(cached, queue) {
  if (!cached) return { status: "not_checked", observedAt: null, source: null };
  if (cached.body === null)
    return {
      status: "unavailable",
      observedAt: cached.observed_at,
      source: cached.source,
    };
  const solo = cached.body.find((entry) => entry.queueType === queue);
  if (!solo)
    return {
      status: "unranked",
      observedAt: cached.observed_at,
      source: cached.source,
    };
  const tiers = [
    "IRON",
    "BRONZE",
    "SILVER",
    "GOLD",
    "PLATINUM",
    ...emeraldTiers,
  ];
  if (
    !tiers.includes(solo.tier) ||
    !["I", "II", "III", "IV"].includes(solo.rank)
  )
    return {
      status: "unavailable",
      observedAt: cached.observed_at,
      source: cached.source,
    };
  return {
    status: "ranked",
    tier: solo.tier,
    division: solo.rank,
    leaguePoints: Number.isFinite(solo.leaguePoints) ? solo.leaguePoints : null,
    observedAt: cached.observed_at,
    source: cached.source,
  };
}
export function classifyMatch(raw, id, config, endTime, getRank, sourcePuuid) {
  const checked = inspectMatch(raw, id, config, endTime);
  if (checked.reason) return checked;
  // Qualify the player whose history supplied this match, not an arbitrary participant.
  const seedIndex = checked.participants.findIndex(
    (p) => p.puuid === sourcePuuid,
  );
  if (seedIndex === -1) return { reason: "seed_not_in_match" };
  const snapshots = checked.participants.map((p) =>
    rankSnapshot(getRank(p.puuid), config.leagueQueue),
  );
  const seedRank = snapshots[seedIndex];
  const eligibleTiers = rankPolicy(config).tiers;
  if (seedRank.status === "not_checked" || seedRank.status === "unavailable")
    return { reason: "seed_rank_unavailable" };
  if (seedRank.status !== "ranked" || !eligibleTiers.includes(seedRank.tier))
    return { reason: "seed_rank_below_threshold" };
  const qualified = snapshots.filter(
    (r) => r.status === "ranked" && eligibleTiers.includes(r.tier),
  ).length;
  return {
    reason: null,
    normalized: {
      matchId: id,
      patch: checked.patch,
      gameVersion: checked.info.gameVersion,
      queueId: config.queueId,
      region: config.region,
      startedAt: new Date(checked.info.gameStartTimestamp).toISOString(),
      durationSeconds: checked.info.gameDuration,
      rankBasis: "snapshot_at_collection_not_rank_at_match",
      rankPolicy: config.rankPolicy,
      discoveryRankAtLookup: seedRank,
      observedQualifyingParticipants: qualified,
      participants: checked.participants.map((p, index) => ({
        championId: p.championId,
        championName: p.championName,
        role: p.teamPosition,
        teamId: p.teamId,
        win: p.win,
        rankAtLookup: snapshots[index],
      })),
    },
  };
}

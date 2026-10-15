import { loadConfig, positions } from "../config.mjs";
export const config = {
  ...loadConfig(),
  reuseDatasetId: null,
  rankPolicy: "seed_emerald_plus",
  patches: [{ label: "26.19", gameVersionPrefix: "16.19" }],
  targetMatches: 2,
  maxSeedPlayers: 2,
  seedPagesPerDivision: 1,
};
export const endTime = Math.floor(Date.parse("2026-10-05T00:00:00Z") / 1000);
export function match(id = "EUW1_1") {
  const participants = Array.from({ length: 10 }, (_, i) => ({
    puuid: `fixture-player-${i}`,
    teamId: i < 5 ? 100 : 200,
    championId: i + 1,
    championName: `FixtureChampion${i + 1}`,
    teamPosition: positions[i % 5],
    win: i < 5,
    gameEndedInEarlySurrender: false,
  }));
  return {
    metadata: { matchId: id, participants: participants.map((p) => p.puuid) },
    info: {
      platformId: "EUW1",
      queueId: 420,
      mapId: 11,
      gameMode: "CLASSIC",
      gameVersion: "16.19.123.456",
      gameStartTimestamp: Date.parse("2026-09-25T12:00:00Z"),
      gameDuration: 1800,
      participants,
      teams: [
        { teamId: 100, win: true },
        { teamId: 200, win: false },
      ],
    },
  };
}
export const ranked = (tier = "EMERALD") => [
  { queueType: "RANKED_SOLO_5x5", tier, rank: "II", leaguePoints: 40 },
];
export const rankCache = (tier) => ({
  body: ranked(tier),
  observed_at: "2026-10-05T01:00:00Z",
  source: "fixture",
});
export function seedStore(store, ids = ["EUW1_1", "EUW1_2"]) {
  store.set("endTime", endTime);
  store.set("seedsReady", true);
  store.set("seedSelection", {
    maxSeedPlayers: config.maxSeedPlayers,
    seedPagesPerDivision: config.seedPagesPerDivision,
    rankPolicy: config.rankPolicy,
  });
  store.addSeed("fixture-player-0", "EMERALD-II", 0);
  store.saveRank(
    "fixture-player-0",
    ranked(),
    "2026-10-05T01:00:00Z",
    "league-ladder",
  );
  store.saveHistory("fixture-player-0", ids);
}

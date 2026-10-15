export const matchupRoles = [
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
] as const;
export type MatchupRole = (typeof matchupRoles)[number];
export const matchupRoleNames: Record<MatchupRole, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "Bot",
  UTILITY: "Support",
};
export type MatchupSide = "all" | "blue" | "red";
export interface MatchupPlayer {
  championId: number;
  role: MatchupRole;
  teamId: 100 | 200;
  rankStatus: "ranked" | "not_checked" | "unranked" | "unavailable";
  rankTier: string | null;
  rankDivision: string | null;
}
export interface MatchupGame {
  matchId: string;
  patch: string;
  rankPolicy: RankPolicy;
  collectionPhase: "retained" | "current";
  startedAt: string;
  durationSeconds: number;
  blueWin: boolean;
  players: MatchupPlayer[];
}
export interface MatchupDataset {
  schemaVersion: 4;
  source: "Riot API";
  datasetId: string;
  region: string;
  queueId: 420;
  patches: string[];
  generatedAt: string;
  rankPolicy: RankPolicy;
  retainedMatches: number;
  retainedRankPolicies: RankPolicy[];
  champions: { id: number; name: string }[];
  matches: MatchupGame[];
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const positiveInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const validDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const tiers = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
];

export function parseMatchupDataset(value: unknown): MatchupDataset {
  const fail = (): never => {
    throw new Error(
      "The matchup export is invalid or outdated. Regenerate it with npm run data:export.",
    );
  };
  if (!isObject(value)) return fail();
  if (
    value.schemaVersion !== 4 ||
    value.source !== "Riot API" ||
    value.region !== "EUW" ||
    value.queueId !== 420 ||
    typeof value.datasetId !== "string" ||
    !isPatchList(value.patches) ||
    !validDate(value.generatedAt) ||
    !isRankPolicy(value.rankPolicy) ||
    typeof value.retainedMatches !== "number" ||
    !Number.isSafeInteger(value.retainedMatches) ||
    value.retainedMatches < 0 ||
    !Array.isArray(value.retainedRankPolicies) ||
    !value.retainedRankPolicies.every(isRankPolicy) ||
    new Set(value.retainedRankPolicies).size !==
      value.retainedRankPolicies.length ||
    !Array.isArray(value.champions) ||
    !Array.isArray(value.matches)
  )
    return fail();
  const championIds = new Set<number>();
  for (const champion of value.champions) {
    if (
      !isObject(champion) ||
      !positiveInt(champion.id) ||
      typeof champion.name !== "string" ||
      !champion.name ||
      championIds.has(champion.id)
    )
      return fail();
    championIds.add(champion.id);
  }
  const ids = new Set<string>();
  for (const match of value.matches) {
    if (
      !isObject(match) ||
      !isRankPolicy(match.rankPolicy) ||
      !["retained", "current"].includes(String(match.collectionPhase)) ||
      (match.collectionPhase === "current" &&
        match.rankPolicy !== value.rankPolicy) ||
      typeof match.patch !== "string" ||
      !value.patches.includes(match.patch) ||
      typeof match.matchId !== "string" ||
      !/^EUW1_\d+$/.test(match.matchId) ||
      ids.has(match.matchId) ||
      !validDate(match.startedAt) ||
      typeof match.durationSeconds !== "number" ||
      !Number.isFinite(match.durationSeconds) ||
      match.durationSeconds <= 0 ||
      typeof match.blueWin !== "boolean" ||
      !Array.isArray(match.players) ||
      match.players.length !== 10
    )
      return fail();
    ids.add(match.matchId);
    const picked = new Set(),
      slots = new Set();
    for (const player of match.players) {
      if (
        !isObject(player) ||
        !positiveInt(player.championId) ||
        !championIds.has(player.championId) ||
        picked.has(player.championId) ||
        typeof player.role !== "string" ||
        !matchupRoles.includes(player.role as MatchupRole) ||
        ![100, 200].includes(Number(player.teamId)) ||
        typeof player.teamId !== "number" ||
        slots.has(player.teamId + player.role) ||
        !["ranked", "not_checked", "unranked", "unavailable"].includes(
          String(player.rankStatus),
        ) ||
        (player.rankStatus === "ranked"
          ? player.rankTier === null || player.rankDivision === null
          : player.rankTier !== null || player.rankDivision !== null) ||
        !(
          player.rankTier === null ||
          (typeof player.rankTier === "string" &&
            tiers.includes(player.rankTier))
        ) ||
        !(
          player.rankDivision === null ||
          (typeof player.rankDivision === "string" &&
            ["I", "II", "III", "IV"].includes(player.rankDivision))
        )
      )
        return fail();
      picked.add(player.championId);
      slots.add(player.teamId + player.role);
    }
  }
  const retained = value.matches.filter(
    (match) => match.collectionPhase === "retained",
  );
  const policies = new Set(retained.map((match) => match.rankPolicy));
  if (
    retained.length !== value.retainedMatches ||
    policies.size !== value.retainedRankPolicies.length ||
    value.retainedRankPolicies.some((policy) => !policies.has(policy))
  )
    return fail();
  return value as unknown as MatchupDataset;
}

export interface MatchupObservation {
  game: MatchupGame;
  player: MatchupPlayer;
  opponent: MatchupPlayer;
  won: boolean;
}
export interface MatchupRow {
  opponentId: number;
  games: number;
  wins: number;
  observations: MatchupObservation[];
}
export function queryMatchups(
  dataset: MatchupDataset,
  championId: number,
  role: MatchupRole,
  side: MatchupSide = "all",
  patch: string = "all",
) {
  const opponents = new Map<number, MatchupRow>();
  let games = 0,
    wins = 0;
  for (const game of dataset.matches) {
    if (patch !== "all" && game.patch !== patch) continue;
    const player = game.players.find(
      (p) => p.championId === championId && p.role === role,
    );
    if (
      !player ||
      (side === "blue" && player.teamId !== 100) ||
      (side === "red" && player.teamId !== 200)
    )
      continue;
    const opponent = game.players.find(
      (p) => p.teamId !== player.teamId && p.role === role,
    );
    if (!opponent) continue;
    const won = player.teamId === 100 ? game.blueWin : !game.blueWin;
    games++;
    wins += Number(won);
    const row = opponents.get(opponent.championId) ?? {
      opponentId: opponent.championId,
      games: 0,
      wins: 0,
      observations: [],
    };
    row.games++;
    row.wins += Number(won);
    row.observations.push({ game, player, opponent, won });
    opponents.set(opponent.championId, row);
  }
  for (const row of opponents.values())
    row.observations.sort(
      (a, b) =>
        b.game.startedAt.localeCompare(a.game.startedAt) ||
        a.game.matchId.localeCompare(b.game.matchId),
    );
  return { games, wins, rows: [...opponents.values()] };
}

export function otherOpponentBaseline(
  total: { games: number; wins: number },
  selected: Pick<MatchupRow, "games" | "wins">,
) {
  const games = total.games - selected.games,
    wins = total.wins - selected.wins;
  return { games, wins, winRate: games ? wins / games : null };
}
import { isPatchList, isRankPolicy } from "./rankPolicy";
import type { RankPolicy } from "./rankPolicy";

import { isPatchList, isRankPolicy } from "./rankPolicy";
import type { RankPolicy } from "./rankPolicy";
export interface RiotReport {
  schemaVersion: 4;
  datasetId: string;
  source: "Riot API";
  region: string;
  queue: string;
  patches: string[];
  patchCounts: Record<string, number>;
  generatedAt: string;
  targetMatches: number;
  acceptedMatches: number;
  downloadedMatches: number;
  retainedMatches: number;
  retainedRankPolicies: RankPolicy[];
  rejectedMatches: number;
  pendingMatches: number;
  seedPlayers: number;
  visitedSeedPlayers: number;
  rankSnapshots: number;
  apiRequests: number;
  rankPolicy: RankPolicy;
  maxSeedPlayers: number;
  matchesPerSeed: number;
  reusedMatches: number;
  status: { code: string; message: string };
  rankBasis: string;
  rankObservedFrom: string | null;
  rankObservedTo: string | null;
  windowStart: string;
  windowEnd: string;
  rejectionCounts: Record<string, number>;
  tiers: Record<string, number>;
  championRoles: {
    championId: number;
    championName: string;
    role: string;
    games: number;
    wins: number;
  }[];
}
export function parseRiotReport(value: unknown): RiotReport {
  if (!value || typeof value !== "object")
    throw new Error("Invalid dataset report.");
  const r = value as Record<string, unknown>;
  const count = (n: unknown) =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  const date = (d: unknown) =>
    typeof d === "string" && Number.isFinite(Date.parse(d));
  const countMap = (m: unknown) =>
    !!m &&
    typeof m === "object" &&
    !Array.isArray(m) &&
    Object.values(m).every(count);
  if (
    r.schemaVersion !== 4 ||
    !isRankPolicy(r.rankPolicy) ||
    !isPatchList(r.patches) ||
    r.source !== "Riot API" ||
    !["region", "queue", "datasetId", "rankBasis"].every(
      (key) => typeof r[key] === "string",
    ) ||
    !["generatedAt", "windowStart", "windowEnd"].every((key) => date(r[key])) ||
    !["rankObservedFrom", "rankObservedTo"].every(
      (key) => r[key] === null || date(r[key]),
    )
  )
    throw new Error(
      "The dataset report is outdated or invalid. Regenerate it with npm run data:export.",
    );
  if (
    ![
      "targetMatches",
      "acceptedMatches",
      "downloadedMatches",
      "retainedMatches",
      "rejectedMatches",
      "pendingMatches",
      "seedPlayers",
      "visitedSeedPlayers",
      "rankSnapshots",
      "apiRequests",
      "maxSeedPlayers",
      "matchesPerSeed",
      "reusedMatches",
    ].every((key) => count(r[key])) ||
    Number(r.targetMatches) < 1 ||
    Number(r.acceptedMatches) > Number(r.downloadedMatches) ||
    Number(r.retainedMatches) > Number(r.acceptedMatches) ||
    !Array.isArray(r.retainedRankPolicies) ||
    !r.retainedRankPolicies.every(isRankPolicy) ||
    new Set(r.retainedRankPolicies).size !== r.retainedRankPolicies.length ||
    Number(r.retainedMatches) > 0 !== r.retainedRankPolicies.length > 0 ||
    !countMap(r.rejectionCounts) ||
    !countMap(r.tiers)
  )
    throw new Error("Invalid dataset counts.");
  const patches = r.patches as string[];
  const patchCounts = r.patchCounts as Record<string, number>;
  if (
    !countMap(patchCounts) ||
    Object.keys(patchCounts).length !== patches.length ||
    patches.some((p) => !Object.hasOwn(patchCounts, p)) ||
    Object.values(patchCounts).reduce((sum, count) => sum + count, 0) !==
      r.acceptedMatches
  )
    throw new Error("Invalid per-patch counts.");
  const status = r.status as Record<string, unknown> | undefined;
  if (
    !status ||
    typeof status.code !== "string" ||
    typeof status.message !== "string"
  )
    throw new Error("Missing dataset status.");
  if (
    !Array.isArray(r.championRoles) ||
    !r.championRoles.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        count(entry.championId) &&
        typeof entry.championName === "string" &&
        ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"].includes(entry.role) &&
        count(entry.games) &&
        count(entry.wins) &&
        entry.wins <= entry.games,
    )
  )
    throw new Error("Invalid champion samples.");
  return value as RiotReport;
}

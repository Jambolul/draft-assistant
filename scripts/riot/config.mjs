import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export const configPath = resolve(
  projectRoot,
  "scripts/riot/pilot.config.json",
);
export const emeraldTiers = [
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
];
export const positions = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
export const rankPolicies = {
  seed_emerald_plus: {
    label: "Emerald+",
    tiers: emeraldTiers,
    pagedTiers: ["EMERALD", "DIAMOND"],
  },
  seed_diamond_plus: {
    label: "Diamond+",
    tiers: emeraldTiers.slice(1),
    pagedTiers: ["DIAMOND"],
  },
};
export function rankPolicy(config) {
  if (!Object.hasOwn(rankPolicies, config.rankPolicy))
    throw new Error("Unsupported rank policy.");
  return rankPolicies[config.rankPolicy];
}
const validDatasetId = (value) =>
  typeof value === "string" &&
  /^[a-z0-9][a-z0-9.-]{2,60}$/.test(value) &&
  !value.includes("..");

export function validateConfig(config) {
  if (
    config.retainAcceptedMatches != null &&
    typeof config.retainAcceptedMatches !== "boolean"
  )
    throw new Error("retainAcceptedMatches must be true or false.");
  if (!validDatasetId(config.datasetId)) throw new Error("Invalid dataset ID.");
  if (
    config.reuseDatasetId != null &&
    (!validDatasetId(config.reuseDatasetId) ||
      config.reuseDatasetId === config.datasetId)
  )
    throw new Error(
      "The reusable cache must use a different valid dataset ID.",
    );
  if (
    config.region !== "EUW" ||
    config.platform !== "euw1" ||
    config.routing !== "europe" ||
    config.queueId !== 420 ||
    config.leagueQueue !== "RANKED_SOLO_5x5"
  )
    throw new Error("This pilot supports EUW ranked Solo/Duo only.");
  if (
    !Array.isArray(config.patches) ||
    !config.patches.length ||
    config.patches.some(
      (p) =>
        !p ||
        !/^\d{2}\.\d{1,2}$/.test(p.label) ||
        !/^\d{2}\.\d{1,2}$/.test(p.gameVersionPrefix),
    ) ||
    new Set(config.patches.map((p) => p.label)).size !==
      config.patches.length ||
    new Set(config.patches.map((p) => p.gameVersionPrefix)).size !==
      config.patches.length ||
    "patchLabel" in config ||
    "gameVersionPrefix" in config
  )
    throw new Error(
      "Use a nonempty patches list with unique patch labels and game version prefixes.",
    );
  const start = Date.parse(config.windowStart),
    end = Date.parse(config.windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
    throw new Error("Invalid collection window.");
  if (
    !Object.hasOwn(rankPolicies, config.rankPolicy) ||
    "minEmeraldParticipants" in config
  )
    throw new Error(
      "Use rankPolicy: seed_emerald_plus or seed_diamond_plus; participant rank thresholds are no longer supported.",
    );
  for (const [key, min, max] of [
    ["targetMatches", 1, 100000],
    ["minDurationSeconds", 180, 3600],
    ["maxSeedPlayers", 1, 10000],
    ["seedPagesPerDivision", 1, 50],
    ["matchesPerSeed", 1, 100],
    ["requestSpacingMs", 1250, 60000],
  ]) {
    if (
      !Number.isInteger(config[key]) ||
      config[key] < min ||
      config[key] > max
    )
      throw new Error(
        `Invalid ${key}: expected an integer from ${min} to ${max}.`,
      );
  }
  for (const key of ["maxDownloadedMatches", "maxRequestsPerRun"]) {
    if (
      config[key] !== null &&
      (!Number.isSafeInteger(config[key]) || config[key] < 1)
    )
      throw new Error(
        `Invalid ${key}: use null for no cap, or a positive integer.`,
      );
  }
  if (
    config.maxDownloadedMatches !== null &&
    config.maxDownloadedMatches < config.targetMatches
  )
    throw new Error("The download limit must cover the target count.");
  return config;
}
export function loadConfig(args = []) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const flags = {
    "--target": "targetMatches",
    "--max-requests": "maxRequestsPerRun",
  };
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    const noRequestCap = args[i] === "--max-requests" && value === "none";
    if (!flags[args[i]] || (!noRequestCap && !/^\d+$/.test(value ?? "")))
      throw new Error(
        "Supported options: --target NUMBER, --max-requests NUMBER|none.",
      );
    config[flags[args[i]]] = noRequestCap ? null : Number(value);
  }
  return validateConfig(config);
}
export function fixedScope(config) {
  return Object.fromEntries(
    [
      "region",
      "platform",
      "routing",
      "queueId",
      "leagueQueue",
      "patches",
      "windowStart",
      "windowEnd",
    ].map((key) => [key, config[key]]),
  );
}

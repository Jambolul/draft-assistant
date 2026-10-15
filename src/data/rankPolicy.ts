export const rankPolicyLabels = {
  seed_emerald_plus: "Emerald+",
  seed_diamond_plus: "Diamond+",
} as const;
export type RankPolicy = keyof typeof rankPolicyLabels;
export const isRankPolicy = (value: unknown): value is RankPolicy =>
  typeof value === "string" && Object.hasOwn(rankPolicyLabels, value);
export const isPatchList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (patch) => typeof patch === "string" && /^\d{2}\.\d{1,2}$/.test(patch),
  ) &&
  new Set(value).size === value.length;

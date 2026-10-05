import { championProfiles } from "./championProfiles";

export const champions = championProfiles;
export const championById = new Map(
  champions.map((champion) => [champion.id, champion]),
);
export const midChampions = champions.filter((champion) =>
  champion.roles.includes("mid"),
);
export const defaultPool = [
  "ahri",
  "orianna",
  "syndra",
  "viktor",
  "taliyah",
  "hwei",
];

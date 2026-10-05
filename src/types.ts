export const roles = ["top", "jungle", "mid", "adc", "support"] as const;
export type Role = (typeof roles)[number];
export type Side = "ally" | "enemy";
export type MapSide = "blue" | "red";
export const roleLabels: Record<Role, string> = {
  top: "Top",
  jungle: "Jungle",
  mid: "Mid",
  adc: "Bot",
  support: "Support",
};
export type Team = Record<Role, string | null>;
export type Draft = Record<Side, Team>;
export type Traits = Record<
  | "magic"
  | "physical"
  | "engage"
  | "peel"
  | "poke"
  | "burst"
  | "sustain"
  | "waveclear"
  | "pick"
  | "mobility"
  | "frontline"
  | "scaling"
  | "antiDive"
  | "dive"
  | "teamfight",
  number
>;
export interface Champion {
  id: string;
  riotId: string;
  name: string;
  roles: Role[];
  identity: string;
  color: string;
  traits: Traits;
  tradeoff: string;
}
export interface ChampionPool {
  pool: string[];
  comfort: Record<string, number>;
}
export interface DraftWorkspace {
  playerSide: MapSide;
  draft: Draft;
  bans: string[];
}
export interface SoloSettings extends DraftWorkspace {
  role: Role;
  pools: Record<Role, ChampionPool>;
}
export interface CoachPlayer extends ChampionPool {
  name: string;
}
export interface CoachSettings extends DraftWorkspace {
  teamName: string;
  players: Record<Role, CoachPlayer>;
}
export interface Settings {
  version: 2;
  mode: "solo" | "coach";
  solo: SoloSettings;
  coach: CoachSettings;
}
export interface Slot {
  side: Side;
  role: Role;
}

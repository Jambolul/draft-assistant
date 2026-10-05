import { championById } from "../data/champions";
import type { Champion, Draft, Role, Team, Traits } from "../types";
import { selectedIds } from "./draft";

export function analyzeTeam(team: Team) {
  const members = Object.values(team).flatMap((id) =>
    id && championById.has(id) ? [championById.get(id)!] : [],
  );
  const average = (trait: keyof Traits) =>
    members.length
      ? members.reduce((sum, c) => sum + c.traits[trait], 0) / members.length
      : 0;
  return { members, count: members.length, average };
}
export function analyzeDraft(draft: Draft) {
  const ally = analyzeTeam(draft.ally),
    enemy = analyzeTeam(draft.enemy);
  const needs: string[] = [],
    threats: string[] = [];
  if (ally.count) {
    if (ally.average("magic") < 2.5) needs.push("Magic damage");
    if (ally.average("waveclear") < 3) needs.push("Waveclear");
    if (ally.average("peel") < 2.5) needs.push("Carry protection");
    if (ally.average("engage") >= 3) needs.push("Engage follow-up");
    if (ally.average("frontline") < 2) needs.push("A frontline");
  }
  if (enemy.count) {
    if (enemy.average("dive") >= 3) threats.push("Backline dive");
    if (enemy.average("burst") >= 3.5) threats.push("Burst damage");
    if (enemy.average("poke") >= 3) threats.push("Long-range poke");
    if (enemy.average("frontline") >= 2.5) threats.push("Durable frontline");
    if (enemy.average("engage") >= 3) threats.push("Strong initiation");
  }
  return { ally, enemy, needs, threats, known: ally.count + enemy.count };
}
interface Rule {
  label: string;
  weight: number;
  trait: keyof Traits;
}
export interface Recommendation {
  champion: Champion;
  score: number;
  reasons: string[];
  tradeoffs: string[];
  breakdown: { label: string; points: number; max: number }[];
}
export function recommend(
  draft: Draft,
  pool: string[],
  comfort: Record<string, number>,
  role: Role = "mid",
  bans: string[] = [],
): Recommendation[] {
  if (draft.ally[role]) return [];
  const { ally, enemy, known } = analyzeDraft(draft);
  if (!known) return [];
  const rules: Rule[] = [];
  if (ally.count) {
    if (ally.average("magic") < 2.5)
      rules.push({
        label: "Adds magic damage to the known allied picks.",
        weight: 8,
        trait: "magic",
      });
    if (ally.average("waveclear") < 3)
      rules.push({
        label: "Helps cover your team’s waveclear.",
        weight: 6,
        trait: "waveclear",
      });
    if (ally.average("peel") < 2.5)
      rules.push({
        label: "Adds protection for your carries.",
        weight: 5,
        trait: "peel",
      });
    if (ally.average("engage") < 2)
      rules.push({
        label: "Adds ways to start or catch a fight.",
        weight: 4,
        trait: "engage",
      });
    if (ally.average("engage") >= 3)
      rules.push({
        label: "Brings area damage to follow your team’s engage.",
        weight: 8,
        trait: "teamfight",
      });
    if (ally.average("frontline") >= 2.5)
      rules.push({
        label: "Can deal sustained damage behind your frontline.",
        weight: 6,
        trait: "sustain",
      });
    if (ally.average("scaling") >= 3.5)
      rules.push({
        label: "Fits your team’s scaling direction.",
        weight: 4,
        trait: "scaling",
      });
    const adc = draft.ally.adc ? championById.get(draft.ally.adc) : undefined;
    if (adc && adc.traits.mobility <= 1)
      rules.push({
        label: "Offers tools to protect " + adc.name + ".",
        weight: 6,
        trait: "peel",
      });
  }
  if (enemy.count) {
    if (enemy.average("dive") >= 3) {
      rules.push({
        label: "Adds anti-dive tools against backline pressure.",
        weight: 9,
        trait: "antiDive",
      });
      rules.push({
        label: "Has mobility to reposition against dive.",
        weight: 5,
        trait: "mobility",
      });
    }
    if (enemy.average("frontline") >= 2.5)
      rules.push({
        label: "Adds sustained damage into a durable enemy team.",
        weight: 8,
        trait: "sustain",
      });
    if (enemy.average("poke") >= 3)
      rules.push({
        label: "Can reposition against long-range poke.",
        weight: 5,
        trait: "mobility",
      });
    if (enemy.average("burst") >= 3.5)
      rules.push({
        label: "Has mobility to help avoid burst threats.",
        weight: 4,
        trait: "mobility",
      });
  }
  // Keep the existing mid baseline; other roles use the shared provisional rules.
  if (role === "mid")
    rules.push({
      label: "Brings useful mid-lane waveclear.",
      weight: 2,
      trait: "waveclear",
    });
  const taken = new Set([...selectedIds(draft), ...bans]);
  return [...new Set(pool)]
    .flatMap((id) => {
      const champion = championById.get(id);
      if (!champion || !champion.roles.includes(role) || taken.has(id))
        return [];
      const contributions = rules.map((rule) => ({
        label: rule.label,
        points: (rule.weight * champion.traits[rule.trait]) / 5,
        max: rule.weight,
      }));
      const level = Number.isFinite(comfort[id])
        ? Math.min(5, Math.max(1, comfort[id]))
        : 3;
      const breakdown = [
        ...contributions,
        {
          label: "Player comfort rating (" + level + "/5).",
          points: level,
          max: 5,
        },
      ];
      const total = breakdown.reduce((sum, item) => sum + item.points, 0);
      const maximum = breakdown.reduce((sum, item) => sum + item.max, 0);
      const reasons = contributions
        .filter((item) => item.points / item.max >= 0.6)
        .sort((a, b) => b.points - a.points)
        .slice(0, 3)
        .map((item) => item.label);
      if (level >= 4)
        reasons.push("One of this player’s more comfortable picks.");
      if (!reasons.length)
        reasons.push("Limited fit with the needs identified so far.");
      const tradeoffs = [champion.tradeoff];
      if (enemy.average("dive") >= 3 && champion.traits.mobility <= 1)
        tradeoffs.push(
          "Enemy dive makes defensive positioning especially important.",
        );
      if (
        ally.count &&
        ally.average("frontline") < 2 &&
        champion.traits.frontline < 2
      )
        tradeoffs.push("Your team’s frontline gap remains.");
      return [
        {
          champion,
          score: Math.round((100 * total) / maximum),
          reasons,
          tradeoffs,
          breakdown,
        },
      ];
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.champion.name.localeCompare(b.champion.name),
    );
}

import { championById } from "../data/champions";
import { roles } from "../types";
import type { Draft, MapSide, Role, Side, Slot, Team } from "../types";

// Draft ownership stays stable; map side only controls the board presentation.
export function mapSideFor(side: Side, playerSide: MapSide): MapSide {
  return side === "ally" ? playerSide : playerSide === "blue" ? "red" : "blue";
}

export function boardOrder(playerSide: MapSide): Side[] {
  return playerSide === "blue" ? ["ally", "enemy"] : ["enemy", "ally"];
}

export function emptyTeam(): Team {
  return { top: null, jungle: null, mid: null, adc: null, support: null };
}
export function emptyDraft(): Draft {
  return { ally: emptyTeam(), enemy: emptyTeam() };
}
export function selectedIds(draft: Draft): string[] {
  return [...Object.values(draft.ally), ...Object.values(draft.enemy)].filter(
    (id): id is string => id !== null,
  );
}
export function setPick(
  draft: Draft,
  slot: Slot,
  id: string | null,
  reservedRole: Role | null = "mid",
  bans: string[] = [],
): Draft {
  if (slot.side === "ally" && slot.role === reservedRole) return draft;
  if (
    id &&
    (!championById.has(id) ||
      bans.includes(id) ||
      selectedIds(draft).some(
        (picked) => picked === id && draft[slot.side][slot.role] !== id,
      ))
  )
    return draft;
  return { ...draft, [slot.side]: { ...draft[slot.side], [slot.role]: id } };
}
export function demoDraft(): Draft {
  return {
    ally: {
      top: "ornn",
      jungle: "vi",
      mid: null,
      adc: "jinx",
      support: "nautilus",
    },
    enemy: {
      top: "renekton",
      jungle: "nocturne",
      mid: "akali",
      adc: "kaisa",
      support: "rakan",
    },
  };
}
export function sanitizeDraft(
  input: unknown,
  reservedRole: Role | null = "mid",
): Draft {
  const draft = emptyDraft();
  if (!input || typeof input !== "object") return draft;
  const seen = new Set<string>();
  for (const side of ["ally", "enemy"] as const) {
    const team = (input as Record<string, unknown>)[side];
    if (!team || typeof team !== "object") continue;
    for (const role of roles) {
      if (side === "ally" && role === reservedRole) continue;
      const id = (team as Record<string, unknown>)[role];
      if (typeof id === "string" && championById.has(id) && !seen.has(id)) {
        draft[side][role] = id;
        seen.add(id);
      }
    }
  }
  return draft;
}

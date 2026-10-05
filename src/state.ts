import { champions, championById, defaultPool } from "./data/champions";
import { emptyDraft, sanitizeDraft, selectedIds } from "./engine/draft";
import { roles, roleLabels } from "./types";
import type { ChampionPool, DraftWorkspace, Role, Settings } from "./types";

export const storageKey = "draft-assistant:v2";
export const legacyStorageKey = "draft-assistant:v1";
const starterPools: Record<Role, string[]> = {
  top: ["ornn", "gwen", "renekton"],
  jungle: ["vi", "viego", "sejuani"],
  mid: defaultPool,
  adc: ["jinx", "kaisa", "ezreal"],
  support: ["nautilus", "lulu", "rakan"],
};
function roleRecord<T>(create: (role: Role) => T): Record<Role, T> {
  return Object.fromEntries(
    roles.map((role) => [role, create(role)]),
  ) as Record<Role, T>;
}
function freshPool(role: Role): ChampionPool {
  return {
    pool: [...starterPools[role]],
    comfort: Object.fromEntries(
      champions.filter((c) => c.roles.includes(role)).map((c) => [c.id, 3]),
    ),
  };
}
function freshWorkspace(): DraftWorkspace {
  return { playerSide: "blue", draft: emptyDraft(), bans: [] };
}
export function defaults(): Settings {
  return {
    version: 2,
    mode: "solo",
    solo: { ...freshWorkspace(), role: "mid", pools: roleRecord(freshPool) },
    coach: {
      ...freshWorkspace(),
      teamName: "My team",
      players: roleRecord((role) => ({
        ...freshPool(role),
        name: roleLabels[role] + " player",
      })),
    },
  };
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function sanitizePool(input: unknown, role: Role): ChampionPool {
  const value = record(input);
  const fresh = freshPool(role);
  const valid = new Set(
    champions.filter((c) => c.roles.includes(role)).map((c) => c.id),
  );
  if (Array.isArray(value.pool))
    fresh.pool = [
      ...new Set(
        value.pool.filter(
          (id): id is string => typeof id === "string" && valid.has(id),
        ),
      ),
    ];
  for (const [id, score] of Object.entries(record(value.comfort))) {
    if (
      valid.has(id) &&
      typeof score === "number" &&
      Number.isInteger(score) &&
      score >= 1 &&
      score <= 5
    )
      fresh.comfort[id] = score;
  }
  return fresh;
}
export function sanitizeBans(
  input: unknown,
  draft: DraftWorkspace["draft"],
): string[] {
  const picked = new Set(selectedIds(draft));
  return Array.isArray(input)
    ? [
        ...new Set(
          input.filter(
            (id): id is string =>
              typeof id === "string" && championById.has(id) && !picked.has(id),
          ),
        ),
      ].slice(0, 10)
    : [];
}
function sanitizeWorkspace(input: unknown): DraftWorkspace {
  const value = record(input);
  const draft = sanitizeDraft(value.draft, null);
  return {
    draft,
    playerSide: value.playerSide === "red" ? "red" : "blue",
    bans: sanitizeBans(value.bans, draft),
  };
}
export function sanitizeSettings(input: unknown): Settings {
  const value = record(input);
  const fresh = defaults();
  if (value.version !== 2) {
    // Preserve the old mid profile and board. The legacy browser entry remains untouched.
    fresh.solo = { ...fresh.solo, ...sanitizeWorkspace(value) };
    fresh.solo.draft = sanitizeDraft(value.draft);
    fresh.solo.pools.mid = sanitizePool(value, "mid");
    return fresh;
  }
  const solo = record(value.solo);
  const coach = record(value.coach);
  const pools = record(solo.pools);
  const players = record(coach.players);
  fresh.mode = value.mode === "coach" ? "coach" : "solo";
  fresh.solo = {
    ...sanitizeWorkspace(solo),
    role: roles.includes(solo.role as Role) ? (solo.role as Role) : "mid",
    pools: roleRecord((role) => sanitizePool(pools[role], role)),
  };
  fresh.coach = {
    ...sanitizeWorkspace(coach),
    teamName:
      typeof coach.teamName === "string"
        ? coach.teamName.slice(0, 40)
        : "My team",
    players: roleRecord((role) => {
      const player = record(players[role]);
      return {
        ...sanitizePool(player, role),
        name:
          typeof player.name === "string"
            ? player.name.slice(0, 32)
            : roleLabels[role] + " player",
      };
    }),
  };
  return fresh;
}
export function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) {
      try {
        return sanitizeSettings(JSON.parse(saved));
      } catch {
        /* Try the preserved v1 profile. */
      }
    }
    return sanitizeSettings(
      JSON.parse(localStorage.getItem(legacyStorageKey) ?? "null"),
    );
  } catch {
    return defaults();
  }
}

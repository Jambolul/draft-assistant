import { useEffect, useRef, useState } from "react";
import { champions } from "../data/champions";
import { roleLabels, roles } from "../types";
import type { Draft, MapSide, Role, Slot } from "../types";
import { mapSideFor, selectedIds } from "../engine/draft";
import ChampionBadge from "./ChampionBadge";
const searchable = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]/g, "");
export default function ChampionPicker({
  slot,
  draft,
  playerSide,
  onPick,
  onClose,
  bans = [],
  purpose = "pick",
}: {
  slot: Slot;
  draft: Draft;
  playerSide: MapSide;
  onPick: (id: string) => void;
  onClose: () => void;
  bans?: string[];
  purpose?: "pick" | "ban";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Role | "all">("all");
  useEffect(() => {
    const element = dialog.current!;
    if (!element.open) element.showModal();
  }, []);
  const taken = new Set([...selectedIds(draft), ...bans]);
  const current = purpose === "pick" ? draft[slot.side][slot.role] : null;
  const matches = champions
    .filter(
      (c) =>
        searchable(c.name).includes(searchable(query)) &&
        (filter === "all" || c.roles.includes(filter)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <dialog
      ref={dialog}
      className={"picker-dialog " + mapSideFor(slot.side, playerSide)}
      onCancel={onClose}
      aria-labelledby="picker-title"
    >
      <div className="picker-heading">
        <div>
          <p className="eyebrow">
            {purpose === "ban"
              ? "BANS / BOTH TEAMS"
              : mapSideFor(slot.side, playerSide).toUpperCase() +
                " SIDE / " +
                roleLabels[slot.role].toUpperCase()}
          </p>
          <h2 id="picker-title">
            {purpose === "ban" ? "Ban a champion" : "Choose a champion"}
          </h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close champion picker"
        >
          ×
        </button>
      </div>
      <label className="search-box">
        <span aria-hidden="true">⌕</span>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search champions…"
          aria-label="Search champions"
        />
      </label>
      <div className="role-filters" aria-label="Filter by usual role">
        {(["all", ...roles] as const).map((role) => (
          <button
            key={role}
            aria-pressed={filter === role}
            onClick={() => setFilter(role)}
          >
            {role === "all" ? "All roles" : roleLabels[role]}
          </button>
        ))}
      </div>
      <p className="picker-note">
        {champions.length} champions · Role filters are suggestions.
      </p>
      <div className="champion-grid">
        {matches.map((champion) => {
          const unavailable = taken.has(champion.id) && current !== champion.id;
          return (
            <button
              className="champion-option"
              key={champion.id}
              disabled={unavailable}
              onClick={() => onPick(champion.id)}
              aria-label={
                champion.name +
                (unavailable
                  ? bans.includes(champion.id)
                    ? ", banned"
                    : ", already picked"
                  : "")
              }
            >
              <ChampionBadge champion={champion} />
              <strong>{champion.name}</strong>
              <small>
                {unavailable
                  ? bans.includes(champion.id)
                    ? "Banned"
                    : "Already picked"
                  : champion.roles.map((role) => roleLabels[role]).join(" / ")}
              </small>
            </button>
          );
        })}
      </div>
      {!matches.length && (
        <p className="no-matches">
          No champions match. Try another name or role.
        </p>
      )}
    </dialog>
  );
}

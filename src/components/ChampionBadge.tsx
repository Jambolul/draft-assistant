import type { CSSProperties } from "react";
import type { Champion } from "../types";
export default function ChampionBadge({
  champion,
  small = false,
}: {
  champion: Champion;
  small?: boolean;
}) {
  return (
    <span
      className={"champion-badge" + (small ? " small" : "")}
      style={{ "--champion-color": champion.color } as CSSProperties}
      aria-hidden="true"
    >
      {champion.name
        .replace(/[^a-z]/gi, "")
        .slice(0, 2)
        .toUpperCase()}
    </span>
  );
}

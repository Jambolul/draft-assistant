import { useState, type CSSProperties } from "react";
import type { Champion } from "../types";
export default function ChampionBadge({
  champion,
  small = false,
}: {
  champion: Champion;
  small?: boolean;
}) {
  const icon = `/champion/${encodeURIComponent(champion.riotId)}.png`;
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  return (
    <span
      className={"champion-badge" + (small ? " small" : "")}
      style={{ "--champion-color": champion.color } as CSSProperties}
      aria-hidden="true"
    >
      {failedIcon !== icon ? (
        <img
          src={icon}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedIcon(icon)}
        />
      ) : (
        champion.name.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

import { useState } from "react";
import { champions } from "../data/champions";
import { roleLabels } from "../types";
import type { ChampionPool, Role } from "../types";
import ChampionBadge from "./ChampionBadge";
export default function PoolEditor({
  settings,
  onChange,
  role,
  owner,
}: {
  settings: ChampionPool;
  onChange: (next: ChampionPool) => void;
  role: Role;
  owner: string;
}) {
  const [query, setQuery] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const normalize = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const matches = champions.filter(
    (champion) =>
      champion.roles.includes(role) &&
      normalize(champion.name).includes(normalize(query)) &&
      (!onlySelected || settings.pool.includes(champion.id)),
  );
  function toggle(id: string) {
    onChange({
      ...settings,
      pool: settings.pool.includes(id)
        ? settings.pool.filter((entry) => entry !== id)
        : [...settings.pool, id],
    });
  }
  return (
    <section className="pool-section">
      <div className="section-heading">
        <div>
          <h2>
            {owner} · {roleLabels[role]} pool
          </h2>
        </div>
        <span className="count-pill">{settings.pool.length} selected</span>
      </div>
      <div className="pool-tools">
        <label className="search-box pool-search">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              "Search " + roleLabels[role].toLowerCase() + " champions…"
            }
            aria-label="Search your champion pool"
          />
        </label>
        <button
          className="filter-toggle"
          aria-pressed={onlySelected}
          onClick={() => setOnlySelected(!onlySelected)}
        >
          In pool only
        </button>
      </div>
      <div className="pool-grid">
        {matches.map((champion) => {
          const enabled = settings.pool.includes(champion.id);
          return (
            <article
              className={"pool-card" + (enabled ? " included" : "")}
              key={champion.id}
            >
              <div className="pool-card-top">
                <ChampionBadge champion={champion} />
                <label className="pool-toggle">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggle(champion.id)}
                    aria-label={"Include " + champion.name + " in your pool"}
                  />
                  <span>{enabled ? "In pool" : "Add to pool"}</span>
                </label>
              </div>
              <h3>{champion.name}</h3>
              <p>{champion.identity}</p>
              <label className="comfort-label">
                Player comfort
                <select
                  disabled={!enabled}
                  value={settings.comfort[champion.id] ?? 3}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      comfort: {
                        ...settings.comfort,
                        [champion.id]: Number(event.target.value),
                      },
                    })
                  }
                  aria-label={champion.name + " comfort"}
                >
                  <option value={1}>1 / 5 · New pick</option>
                  <option value={2}>2 / 5 · Learning</option>
                  <option value={3}>3 / 5 · Comfortable</option>
                  <option value={4}>4 / 5 · Confident</option>
                  <option value={5}>5 / 5 · Signature pick</option>
                </select>
              </label>
            </article>
          );
        })}
      </div>
      {!matches.length && (
        <p className="no-matches">No champions match your search.</p>
      )}
      {!settings.pool.length && (
        <p className="warning" role="status">
          Your pool is empty. Add at least one champion to get recommendations.
        </p>
      )}
    </section>
  );
}

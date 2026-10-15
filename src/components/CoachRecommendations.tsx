import { useState } from "react";
import { championById } from "../data/champions";
import { analyzeDraft, recommend } from "../engine/recommend";
import { roles, roleLabels } from "../types";
import type { CoachSettings, Role } from "../types";
import ChampionBadge from "./ChampionBadge";
import Recommendations from "./Recommendations";

export default function CoachRecommendations({
  workspace,
  onPick,
  onEdit,
}: {
  workspace: CoachSettings;
  onPick: (role: Role, id: string) => void;
  onEdit: () => void;
}) {
  const [detailRole, setDetailRole] = useState<Role | null>(null);
  const { draft, players, bans } = workspace;
  const known = analyzeDraft(draft).known;
  const shortlists = roles.map((role) => ({
    role,
    results: recommend(
      draft,
      players[role].pool,
      players[role].comfort,
      role,
      bans,
    ),
  }));
  const detail = shortlists.find(
    ({ role }) => role === detailRole && !draft.ally[role],
  );
  return (
    <section
      className="coach-suggestions"
      aria-labelledby="coach-suggestions-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="coach-suggestions-title">Player shortlists</h2>
        </div>
        <button className="text-button" onClick={onEdit}>
          Edit player pools
        </button>
      </div>
      <div className="coach-shortlists">
        {shortlists.map(({ role, results }) => {
          const picked = championById.get(draft.ally[role] ?? "");
          return (
            <article
              className={"role-shortlist" + (picked ? " is-picked" : "")}
              key={role}
            >
              <div className="shortlist-heading">
                <h3>{roleLabels[role]}</h3>
                <span>{picked ? "Picked" : results.length + " available"}</span>
              </div>
              <p className="player-name">
                {players[role].name || roleLabels[role] + " player"}
              </p>
              {picked ? (
                <div className="locked-champion">
                  <ChampionBadge champion={picked} small />
                  <strong>{picked.name}</strong>
                </div>
              ) : (
                <>
                  <div className="shortlist-options">
                    {results.slice(0, 3).map((result) => (
                      <button
                        key={result.champion.id}
                        onClick={() => onPick(role, result.champion.id)}
                        aria-label={
                          "Pick " +
                          result.champion.name +
                          " for " +
                          roleLabels[role]
                        }
                      >
                        <ChampionBadge champion={result.champion} small />
                        <strong>{result.champion.name}</strong>
                        <span>
                          {result.score}
                          <small> fit</small>
                        </span>
                      </button>
                    ))}
                  </div>
                  {!results.length && (
                    <p className="shortlist-empty">
                      {!known
                        ? "Add a known pick to compare this pool."
                        : !players[role].pool.length
                          ? "No champions in this player’s pool."
                          : "All pool champions are picked or banned."}
                    </p>
                  )}
                  {results.length > 0 && (
                    <button
                      className="text-button shortlist-detail"
                      aria-expanded={detailRole === role}
                      onClick={() =>
                        setDetailRole(detailRole === role ? null : role)
                      }
                    >
                      {" "}
                      {detailRole === role ? "Hide" : "View"} {roleLabels[role]}{" "}
                      reasoning
                    </button>
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>
      {detail && (
        <Recommendations
          results={detail.results}
          title={
            roleLabels[detail.role] +
            " · " +
            (players[detail.role].name || "Player")
          }
          onPick={(id) => onPick(detail.role, id)}
        />
      )}
    </section>
  );
}

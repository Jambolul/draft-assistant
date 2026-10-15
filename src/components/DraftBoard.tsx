import { championById } from "../data/champions";
import { roles, roleLabels } from "../types";
import type { Draft, MapSide, Role, Slot } from "../types";
import { boardOrder, mapSideFor } from "../engine/draft";
import ChampionBadge from "./ChampionBadge";
export default function DraftBoard({
  draft,
  playerSide,
  onSelect,
  onRemove,
  personalRole = "mid",
  editablePersonalPick = false,
  playerNames,
  teamName,
}: {
  draft: Draft;
  playerSide: MapSide;
  onSelect: (slot: Slot) => void;
  onRemove: (slot: Slot) => void;
  personalRole?: Role | null;
  editablePersonalPick?: boolean;
  playerNames?: Record<Role, string>;
  teamName?: string;
}) {
  return (
    <div className="draft-board">
      {boardOrder(playerSide).map((side) => (
        <section
          className={"team-panel " + mapSideFor(side, playerSide)}
          key={side}
          aria-label={side === "ally" ? "Your team" : "Enemy team"}
        >
          <div className="team-header">
            <h2>
              <span className="side-dot" />
              {mapSideFor(side, playerSide) === "blue"
                ? "Blue side"
                : "Red side"}
            </h2>
            <span>
              {side === "ally" ? teamName || "Your team" : "Enemy team"}
            </span>
          </div>
          <div className="team-slots">
            {roles.map((role) => {
              const slot = { side, role },
                id = draft[side][role],
                champion = id ? championById.get(id) : undefined;
              const isYou = side === "ally" && role === personalRole;
              const playerName =
                side === "ally" ? playerNames?.[role] : undefined;
              return (
                <div
                  className={"slot-row" + (isYou ? " your-slot" : "")}
                  key={role}
                >
                  <span className="role-label">{roleLabels[role]}</span>
                  {isYou && !editablePersonalPick ? (
                    <div className="you-content">
                      <div>
                        <strong>Your pick</strong>
                      </div>
                      <span className="you-label">YOU</span>
                    </div>
                  ) : (
                    <>
                      <button
                        className={"slot-button" + (champion ? " filled" : "")}
                        onClick={() => onSelect(slot)}
                        aria-label={
                          (champion
                            ? "Change " + champion.name
                            : "Select champion") +
                          " for " +
                          (side === "ally" ? "your" : "enemy") +
                          " " +
                          roleLabels[role]
                        }
                      >
                        {champion ? (
                          <>
                            <ChampionBadge champion={champion} small />
                            <span>
                              <strong>{champion.name}</strong>
                              {playerName && (
                                <small className="slot-player">
                                  {playerName}
                                </small>
                              )}
                            </span>
                            {isYou && <span className="you-label">YOU</span>}
                          </>
                        ) : (
                          <>
                            <span className="empty-symbol" aria-hidden="true">
                              +
                            </span>
                            <span>
                              {isYou ? "Your pick" : "Select champion"}
                              {playerName && (
                                <small className="slot-player">
                                  {playerName}
                                </small>
                              )}
                            </span>
                            {isYou && <span className="you-label">YOU</span>}
                          </>
                        )}
                      </button>
                      {champion && (
                        <button
                          className="remove-pick"
                          onClick={() => onRemove(slot)}
                          aria-label={
                            "Remove " +
                            champion.name +
                            " from " +
                            (side === "ally" ? "your" : "enemy") +
                            " " +
                            roleLabels[role]
                          }
                        >
                          ×
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

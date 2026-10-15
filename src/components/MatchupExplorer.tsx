import { useEffect, useMemo, useState } from "react";
import { champions } from "../data/champions";
import { rankPolicyLabels } from "../data/rankPolicy";
import {
  matchupRoleNames,
  matchupRoles,
  otherOpponentBaseline,
  parseMatchupDataset,
  queryMatchups,
} from "../data/matchups";
import type {
  MatchupDataset,
  MatchupObservation,
  MatchupPlayer,
  MatchupRole,
  MatchupRow,
  MatchupSide,
} from "../data/matchups";

const displayNames = new Map(
  champions.map((champion) => [champion.riotId.toLowerCase(), champion.name]),
);
const number = (value: number) => value.toLocaleString("en-GB");
const rate = (wins: number, games: number) =>
  games ? `${((wins / games) * 100).toFixed(1)}%` : "—";
const when = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const rank = ({
  rankTier: value,
  rankDivision: division,
  rankStatus,
}: MatchupPlayer) =>
  value
    ? value.charAt(0) +
      value.slice(1).toLowerCase() +
      (division && !["MASTER", "GRANDMASTER", "CHALLENGER"].includes(value)
        ? ` ${division}`
        : "")
    : rankStatus === "not_checked"
      ? "Rank not checked"
      : rankStatus === "unranked"
        ? "Unranked in Solo/Duo"
        : "Rank unavailable";

export default function MatchupExplorer({
  refresh,
  expectedMatches,
  expectedPatches,
  expectedDatasetId,
  expectedPolicy,
}: {
  refresh: number;
  expectedMatches: number;
  expectedPatches: string;
  expectedDatasetId: string;
  expectedPolicy: MatchupDataset["rankPolicy"];
}) {
  const [dataset, setDataset] = useState<MatchupDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch("./data/riot-matchups.json", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (
          response.status === 404 ||
          (response.ok &&
            response.headers.get("content-type")?.includes("text/html"))
        ) {
          if (!controller.signal.aborted) setDataset(null);
          return;
        }
        if (!response.ok)
          throw new Error(
            "Could not load the matchup data. Try Refresh again.",
          );
        const next = parseMatchupDataset(await response.json());
        if (
          next.patches.join(",") !== expectedPatches ||
          next.datasetId !== expectedDatasetId ||
          next.rankPolicy !== expectedPolicy
        ) {
          if (!controller.signal.aborted) setDataset(null);
          throw new Error(
            "The matchup export uses a different patch or rank rule. Run npm run data:export, then Refresh.",
          );
        }
        if (!controller.signal.aborted) setDataset(next);
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not read matchup data.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [refresh, expectedPatches, expectedDatasetId, expectedPolicy]);
  if (loading && !dataset)
    return (
      <p className="data-empty" role="status">
        Loading the collected matchups…
      </p>
    );
  return (
    <>
      {error && (
        <p className="warning" role="alert">
          {error} {dataset && "Showing the previous export."}
        </p>
      )}
      {dataset?.matches.length ? (
        <>
          {dataset.matches.length !== expectedMatches && (
            <p className="matchup-notice">
              This export has {number(dataset.matches.length)} matches; the
              collection has {number(expectedMatches)} accepted matches. Run{" "}
              <code>npm run data:export</code> after collection stops, then
              Refresh.
            </p>
          )}
          <Explorer key={dataset.datasetId} dataset={dataset} />
        </>
      ) : (
        !error && (
          <div className="data-empty">
            <h2>No matchup export yet</h2>
            <p>
              After collecting matches, run <code>npm run data:export</code> in
              the project terminal, then Refresh. This prepares the games
              already saved on your computer.
            </p>
          </div>
        )
      )}
    </>
  );
}

function Explorer({ dataset }: { dataset: MatchupDataset }) {
  const names = useMemo(
    () =>
      new Map(
        dataset.champions.map((champion) => [
          champion.id,
          displayNames.get(champion.name.toLowerCase()) ?? champion.name,
        ]),
      ),
    [dataset],
  );
  const options = useMemo(
    () =>
      [...dataset.champions].sort((a, b) =>
        (names.get(a.id) ?? a.name).localeCompare(names.get(b.id) ?? b.name),
      ),
    [dataset, names],
  );
  const name = (id: number) => names.get(id) ?? `Champion ${id}`;
  const [championId, setChampionId] = useState(
    () =>
      dataset.champions.find((champion) => champion.name === "Ahri")?.id ??
      options[0].id,
  );
  const [role, setRole] = useState<MatchupRole>("MIDDLE");
  const [side, setSide] = useState<MatchupSide>("all");
  const [patch, setPatch] = useState(
    () =>
      [...dataset.patches]
        .reverse()
        .find((p) => dataset.matches.some((game) => game.patch === p)) ??
      dataset.patches[0],
  );
  const [search, setSearch] = useState("");
  const [minimum, setMinimum] = useState(1);
  const [sort, setSort] = useState("games");
  const [opponentId, setOpponentId] = useState<number | null>(null);
  const selectedChampion = names.has(championId) ? championId : options[0].id;
  const result = useMemo(
    () => queryMatchups(dataset, selectedChampion, role, side, patch),
    [dataset, selectedChampion, role, side, patch],
  );
  const patchGames = dataset.matches.filter(
    (game) => patch === "all" || game.patch === patch,
  ).length;
  const rows = result.rows
    .filter(
      (row) =>
        row.games >= minimum &&
        name(row.opponentId)
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort((a, b) => {
      if (sort === "high")
        return (
          b.wins / b.games - a.wins / a.games ||
          b.games - a.games ||
          name(a.opponentId).localeCompare(name(b.opponentId))
        );
      if (sort === "low")
        return (
          a.wins / a.games - b.wins / b.games ||
          b.games - a.games ||
          name(a.opponentId).localeCompare(name(b.opponentId))
        );
      return (
        b.games - a.games ||
        name(a.opponentId).localeCompare(name(b.opponentId))
      );
    });
  const selected = rows.find((row) => row.opponentId === opponentId) ?? rows[0];
  const resetOpponent = () => {
    setOpponentId(null);
    setSearch("");
  };
  return (
    <section className="matchup-explorer" aria-label="Matchup explorer">
      <div className="matchup-intro">
        <div>
          <h2>Explore a matchup</h2>
          <p>
            Choose a champion and role, then open an opponent to inspect the
            games.
          </p>
        </div>
        <span className="count-pill">
          {number(patchGames)} games ·{" "}
          {patch === "all" ? "Combined patches" : `Patch ${patch}`}
        </span>
      </div>
      <div className="matchup-controls">
        <label>
          Patch
          <select
            value={patch}
            onChange={(event) => {
              setPatch(event.target.value);
              resetOpponent();
            }}
          >
            {dataset.patches.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value="all">All patches combined</option>
          </select>
        </label>
        <label>
          Champion
          <select
            value={selectedChampion}
            onChange={(event) => {
              setChampionId(Number(event.target.value));
              resetOpponent();
            }}
          >
            {options.map((champion) => (
              <option key={champion.id} value={champion.id}>
                {name(champion.id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Role
          <select
            value={role}
            onChange={(event) => {
              setRole(event.target.value as MatchupRole);
              resetOpponent();
            }}
          >
            {matchupRoles.map((id) => (
              <option key={id} value={id}>
                {matchupRoleNames[id]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Champion’s side
          <select
            value={side}
            onChange={(event) => {
              setSide(event.target.value as MatchupSide);
            }}
          >
            <option value="all">Both sides</option>
            <option value="blue">Blue side</option>
            <option value="red">Red side</option>
          </select>
        </label>
      </div>
      <p className="matchup-caveat">
        {dataset.retainedMatches > 0 && (
          <>
            This dataset includes {number(dataset.retainedMatches)} earlier{" "}
            {dataset.retainedRankPolicies
              .map((policy) => rankPolicyLabels[policy])
              .join(" / ")}{" "}
            games. New collection uses {rankPolicyLabels[dataset.rankPolicy]};
            earlier games keep their original inclusion rules.{" "}
          </>
        )}
        {patch === "all" && (
          <>
            Results combine patches {dataset.patches.join(" and ")}; balance
            changes can affect the comparison.{" "}
          </>
        )}
        These are <strong>game wins against the same-role opponent</strong>.
        Lane performance isn’t measured. Team compositions, player skill and
        sample selection also affect the result.
      </p>
      <div className="matchup-baseline">
        <strong>
          {name(selectedChampion)} · {matchupRoleNames[role]}
        </strong>
        <span>{number(result.games)} games</span>
        <span>
          {result.wins}W / {result.games - result.wins}L
        </span>
        <span>{rate(result.wins, result.games)} across all opponents</span>
      </div>
      <div className="matchup-layout">
        <section className="matchup-opponents" aria-label="Opponents">
          <div className="matchup-table-heading">
            <h3>Opponents</h3>
            <span>
              {rows.length} / {result.rows.length} observed
            </span>
          </div>
          <div className="matchup-table-controls">
            <label className="matchup-search">
              Find opponent
              <input
                type="search"
                placeholder="Champion name"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label>
              Minimum games
              <select
                value={minimum}
                onChange={(event) => setMinimum(Number(event.target.value))}
              >
                {[1, 3, 5, 10, 30].map((n) => (
                  <option key={n} value={n}>
                    {n}+
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sort by
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="games">Most games</option>
                <option value="high">Highest win rate</option>
                <option value="low">Lowest win rate</option>
              </select>
            </label>
          </div>
          {rows.length ? (
            <div className="matchup-table-scroll">
              <table className="data-table matchup-table">
                <caption className="sr-only">
                  {name(selectedChampion)} {matchupRoleNames[role]} results by
                  same-role opponent
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Opponent</th>
                    <th scope="col">Games</th>
                    <th scope="col">W / L</th>
                    <th scope="col">Game win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.opponentId}
                      className={
                        selected?.opponentId === row.opponentId
                          ? "selected-matchup"
                          : ""
                      }
                    >
                      <td>
                        <button
                          aria-label={`Inspect ${name(selectedChampion)} versus ${name(row.opponentId)}`}
                          aria-pressed={selected?.opponentId === row.opponentId}
                          onClick={() => setOpponentId(row.opponentId)}
                        >
                          {name(row.opponentId)}
                        </button>
                        {row.games < 30 && (
                          <small>
                            {row.games < 10 ? "Very few games" : "Small sample"}
                          </small>
                        )}
                      </td>
                      <td>{row.games}</td>
                      <td>
                        {row.wins} / {row.games - row.wins}
                      </td>
                      <td>{rate(row.wins, row.games)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="data-empty">
              <h3>
                {result.games
                  ? "No opponents match these filters"
                  : !patchGames && patch !== "all"
                    ? `No games collected for patch ${patch}`
                    : "No games for this champion and role"}
              </h3>
              <p>
                {result.games
                  ? "Try another name or lower the minimum game count."
                  : !patchGames && patch !== "all"
                    ? "This patch is accepted by the collector, but has no games in the current export yet."
                    : "This sample contains no evidence for the selected patch, champion, role and side. Try another selection."}
              </p>
            </div>
          )}
          <p className="settings-note">
            Counts below 30 are flagged for context. Larger counts alone don’t
            make a matchup reliable. Every opponent shown was actually observed
            in this sample.
          </p>
        </section>
        {selected ? (
          <MatchupDetail
            key={`${patch}:${selectedChampion}:${role}:${side}:${selected.opponentId}`}
            row={selected}
            total={result}
            championName={name(selectedChampion)}
            opponentName={name(selected.opponentId)}
            role={role}
            name={name}
          />
        ) : (
          <div className="matchup-detail matchup-placeholder">
            <p>Select an observed matchup to inspect its evidence.</p>
          </div>
        )}
      </div>
      <details className="matchup-method">
        <summary>How to read these results</summary>
        <p>
          Each game contributes once to the chosen champion’s role and opponent.
          Side filters apply to the chosen champion. “Other opponents” excludes
          the selected opponent and keeps the same patch, role and side filters;
          it does not change when you search or hide low-count rows.
        </p>
        <p>
          Win-rate differences are descriptive, without adjustment for champion
          strength, rank, player experience or the other eight picks. They are
          not counter scores or a prediction for your next game. Bot and support
          opponents are compared separately; the game details show both duos.
        </p>
        <p>
          Games are found through a player observed at{" "}
          {rankPolicyLabels[dataset.rankPolicy]} in Solo/Duo for new collection.
          Retained games keep their earlier rank rule. Other participants’ ranks
          are not required; any displayed ranks come from cached observations
          during collection, not at match time. The pilot’s seed selection
          favors higher ranks; repeated players and inferred roles can also
          affect these results.
        </p>
        <p>
          Source: Riot API · {dataset.region} Solo/Duo ·{" "}
          {patch === "all"
            ? `Patches ${dataset.patches.join(" / ")}`
            : `Patch ${patch}`}{" "}
          · Exported {when(dataset.generatedAt)}. Your draft recommendations
          still use the existing champion traits.
        </p>
      </details>
    </section>
  );
}

function MatchupDetail({
  row,
  total,
  championName,
  opponentName,
  role,
  name,
}: {
  row: MatchupRow;
  total: { games: number; wins: number };
  championName: string;
  opponentName: string;
  role: MatchupRole;
  name: (id: number) => string;
}) {
  const [limit, setLimit] = useState(10);
  const baseline = otherOpponentBaseline(total, row);
  const difference =
    baseline.winRate === null
      ? null
      : (row.wins / row.games - baseline.winRate) * 100;
  const blue = row.observations.filter(
    (observation) => observation.player.teamId === 100,
  );
  const red = row.observations.filter(
    (observation) => observation.player.teamId === 200,
  );
  return (
    <section className="matchup-detail" aria-label="Selected matchup">
      <div className="matchup-detail-heading">
        <p className="eyebrow">
          {matchupRoleNames[role].toUpperCase()} MATCHUP
        </p>
        <h3>
          {championName} <span>vs</span> {opponentName}
        </h3>
        <p>Results from {championName}’s perspective</p>
      </div>
      <div className="matchup-result">
        <div>
          <strong>{rate(row.wins, row.games)}</strong>
          <span>Observed game win rate</span>
        </div>
        <div>
          <strong>
            {row.wins}
            <span>W</span> / {row.games - row.wins}
            <span>L</span>
          </strong>
          <span>
            From {row.games} {row.games === 1 ? "game" : "games"}
          </span>
        </div>
      </div>
      <div className="matchup-winbar" aria-hidden="true">
        <span style={{ width: `${(row.wins / row.games) * 100}%` }} />
      </div>
      <p className="matchup-sample-note">
        {row.games < 30 ? "Small sample. " : "Sample sensitivity: "}One
        different outcome changes this rate by {(100 / row.games).toFixed(1)}{" "}
        percentage points.
      </p>
      <div className="matchup-comparison">
        <span>
          {championName} vs other {matchupRoleNames[role].toLowerCase()}{" "}
          opponents
        </span>
        <strong>
          {rate(baseline.wins, baseline.games)}{" "}
          <small>
            ({baseline.wins}W / {baseline.games - baseline.wins}L)
          </small>
        </strong>
        <p>
          {difference === null
            ? "No other opponents to compare with in this selection."
            : `${difference > 0 ? "+" : ""}${difference.toFixed(1)} percentage points vs that baseline. This difference is unadjusted.`}
        </p>
      </div>
      <div className="matchup-sides">
        <span>
          Blue: {blue.filter((observation) => observation.won).length}W /{" "}
          {blue.filter((observation) => !observation.won).length}L
        </span>
        <span>
          Red: {red.filter((observation) => observation.won).length}W /{" "}
          {red.filter((observation) => !observation.won).length}L
        </span>
      </div>
      <div className="matchup-games-heading">
        <h4>Games behind the numbers</h4>
        <span>Newest first</span>
      </div>
      {row.observations.slice(0, limit).map((observation) => (
        <GameEvidence
          key={observation.game.matchId}
          observation={observation}
          championName={championName}
          name={name}
        />
      ))}
      {limit < row.observations.length && (
        <button
          className="secondary-button matchup-more"
          onClick={() => setLimit((value) => value + 10)}
        >
          Show more games ({row.observations.length - limit} remaining)
        </button>
      )}
    </section>
  );
}

function GameEvidence({
  observation,
  championName,
  name,
}: {
  observation: MatchupObservation;
  championName: string;
  name: (id: number) => string;
}) {
  const { game, player, opponent, won } = observation;
  return (
    <details className="matchup-game">
      <summary>
        <span className={won ? "game-win" : "game-loss"}>
          {won ? "Win" : "Loss"}
        </span>
        <span>
          {when(game.startedAt)}
          <small>
            {Math.floor(game.durationSeconds / 60)}:
            {String(Math.floor(game.durationSeconds % 60)).padStart(2, "0")} ·{" "}
            {championName} on {player.teamId === 100 ? "blue" : "red"} · Patch{" "}
            {game.patch}
          </small>
        </span>
      </summary>
      <div className="matchup-game-content">
        <p className="settings-note">
          {game.collectionPhase === "retained"
            ? "Retained from the earlier collection"
            : "New collection"}
          {" · "}
          {rankPolicyLabels[game.rankPolicy]} discovery-player rule
        </p>
        <div className="matchup-game-teams">
          {[100, 200].map((teamId) => (
            <div key={teamId}>
              <h4>
                {teamId === 100 ? "Blue" : "Red"} team ·{" "}
                {(teamId === 100) === game.blueWin ? "Won" : "Lost"}
              </h4>
              <ul>
                {matchupRoles.map((role) => {
                  const participant = game.players.find(
                    (p) => p.teamId === teamId && p.role === role,
                  )!;
                  return (
                    <li
                      key={role}
                      className={
                        [player.championId, opponent.championId].includes(
                          participant.championId,
                        )
                          ? "focused-player"
                          : ""
                      }
                    >
                      <span>{matchupRoleNames[role]}</span>
                      <strong>
                        {name(participant.championId)}
                        <small>{rank(participant)}</small>
                      </strong>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <p>
          Ranks observed during collection. Match reference:{" "}
          <span>{game.matchId}</span>
        </p>
      </div>
    </details>
  );
}

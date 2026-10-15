import { useEffect, useState } from "react";
import { champions } from "../data/champions";
import { parseRiotReport } from "../data/riotReport";
import type { RiotReport } from "../data/riotReport";
import MatchupExplorer from "./MatchupExplorer";
import { rankPolicyLabels } from "../data/rankPolicy";
const roleNames: Record<string, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "Bot",
  UTILITY: "Support",
};
const statuses: Record<string, string> = {
  not_started: "Not started",
  collecting: "Collecting",
  complete: "Pilot complete",
  needs_key: "API key needed",
  paused: "Paused",
  error: "Stopped",
  request_limit: "Request limit reached",
  download_limit: "Download limit reached",
  exhausted: "Sample exhausted",
};
const rejectionLabels: Record<string, string> = {
  match_unavailable: "Match unavailable",
  wrong_region_or_id: "Region / match identity",
  wrong_queue_or_map: "Queue or map",
  wrong_patch: "Different patch",
  outside_time_window: "Outside date window",
  short_game_or_remake: "Short game / remake",
  early_surrender: "Early surrender",
  invalid_participants: "Incomplete participants",
  invalid_champions: "Invalid champion data",
  ambiguous_roles: "Missing or ambiguous roles",
  invalid_outcome: "Invalid result",
  seed_not_in_match: "Discovery player missing from match",
  seed_rank_unavailable: "Discovery player's rank unavailable",
  seed_rank_below_threshold: "Discovery player below the minimum Solo/Duo rank",
};
const format = (n: number) => n.toLocaleString("en-GB");
const championNames = new Map(
  champions.map((champion) => [champion.riotId, champion.name]),
);
const date = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
export default function DataPilot() {
  const [report, setReport] = useState<RiotReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [role, setRole] = useState("all");
  const [panel, setPanel] = useState<"matchups" | "collection">("matchups");
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function read() {
      if (busy) return;
      busy = true;
      setLoading(true);
      try {
        const response = await fetch("./data/riot-pilot.json", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 404) {
          setReport(null);
          setError("");
          return;
        }
        if (!response.ok)
          throw new Error("Could not load the collection report.");
        // Vite serves its HTML fallback when a public report has not been generated.
        if (response.headers.get("content-type")?.includes("text/html")) {
          setReport(null);
          setError("");
          return;
        }
        const next = parseRiotReport(await response.json());
        if (!controller.signal.aborted) {
          setReport(next);
          setError("");
        }
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not read the collection report.",
          );
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void read();
    const timer = setInterval(() => {
      void read();
    }, 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  const rows =
    report?.championRoles.filter(
      (entry) => role === "all" || entry.role === role,
    ) ?? [];
  const stale =
    report?.status.code === "collecting" &&
    Date.now() - Date.parse(report.generatedAt) > 180000;
  return (
    <section className="data-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">MATCH DATA</p>
          <h1>EUW data pilot</h1>
          <p>
            {report
              ? `${report.queue} · New games: ${rankPolicyLabels[report.rankPolicy]} · Patches ${report.patches.join(" / ")} · Target ${format(report.targetMatches)} eligible matches`
              : "Ranked Solo/Duo · Locally collected matches"}
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => setRefresh((n) => n + 1)}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {error && (
        <p className="warning" role="alert">
          {error} {report && "Showing the last report loaded successfully."}
        </p>
      )}
      <div className="data-view-switch" role="group" aria-label="Data view">
        <button
          aria-pressed={panel === "matchups"}
          onClick={() => setPanel("matchups")}
        >
          Matchups
        </button>
        <button
          aria-pressed={panel === "collection"}
          onClick={() => setPanel("collection")}
        >
          Collection overview
        </button>
      </div>
      {!report ? (
        <div className="data-empty">
          <h2>
            {loading ? "Loading the pilot report…" : "No matches collected yet"}
          </h2>
          <p>
            The local collector will publish its progress here. Your draft
            recommendations still use editable champion traits.
          </p>
        </div>
      ) : panel === "matchups" ? (
        <MatchupExplorer
          refresh={refresh}
          expectedMatches={report.acceptedMatches}
          expectedPatches={report.patches.join(",")}
          expectedDatasetId={report.datasetId}
          expectedPolicy={report.rankPolicy}
        />
      ) : (
        <>
          <div className="data-status" role="status">
            <span
              className={
                "status-chip " + (stale ? "paused" : report.status.code)
              }
            >
              {stale
                ? "Update overdue"
                : (statuses[report.status.code] ?? report.status.code)}
            </span>
            <p>
              {stale
                ? "No recent progress report. The collector may be waiting or stopped; check its terminal."
                : report.status.message}
            </p>
            <small>Updated {date(report.generatedAt)}</small>
          </div>
          <div className="data-stats">
            {[
              ["Accepted matches", report.acceptedMatches],
              ["Saved games", report.downloadedMatches],
              ["Excluded", report.rejectedMatches],
              ["Rank snapshots", report.rankSnapshots],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{format(Number(value))}</strong>
              </div>
            ))}
          </div>
          <div className="data-progress">
            <progress
              value={report.acceptedMatches}
              max={report.targetMatches}
              aria-label="Pilot collection progress"
            />
            <span>
              {format(report.acceptedMatches)} / {format(report.targetMatches)}{" "}
              eligible matches
            </span>
          </div>
          <div className="data-notes">
            <div>
              <h2>Collection rules</h2>
              <p>
                {report.region} · {report.queue} · Patches{" "}
                {report.patches.join(" / ")}
              </p>
              <p>
                New games are found through a player observed at{" "}
                {rankPolicyLabels[report.rankPolicy]} in Solo/Duo. Other
                participants’ ranks are not required. Each accepted match has
                ten distinct champions, five identifiable roles per team and a
                valid result.
              </p>
              <p>
                New collection player pool: {format(report.seedPlayers)}{" "}
                selected / {format(report.maxSeedPlayers)} planned · Up to{" "}
                {report.matchesPerSeed} games per discovery player.
              </p>
              {report.retainedMatches > 0 && (
                <p>
                  {format(report.retainedMatches)} earlier{" "}
                  {report.retainedRankPolicies
                    .map((policy) => rankPolicyLabels[policy])
                    .join(" / ")}{" "}
                  games retained. The new rank and five-game limits do not
                  remove previously accepted games. Shared games count once.
                </p>
              )}
            </div>
            <div>
              <h2>What this sample tells us</h2>
              <p>
                Rank snapshots are current observations, not rank at the time of
                the match. This pilot checks data quality and coverage; it is
                not a representative win-rate model.
              </p>
              <p>These counts do not affect draft recommendations yet.</p>
            </div>
          </div>
          <div className="data-details">
            <details>
              <summary>Collection details</summary>
              <dl>
                <dt>Seed players checked</dt>
                <dd>
                  {format(report.visitedSeedPlayers)} /{" "}
                  {format(report.seedPlayers)}
                </dd>
                <dt>API requests</dt>
                <dd>{format(report.apiRequests)}</dd>
                <dt>Matches reused from the earlier collection</dt>
                <dd>{format(report.reusedMatches)}</dd>
                <dt>Earlier accepted games retained</dt>
                <dd>{format(report.retainedMatches)}</dd>
                <dt>Additional accepted games</dt>
                <dd>
                  {format(report.acceptedMatches - report.retainedMatches)}
                </dd>
                {report.patches.map((patch) => (
                  <div key={patch} className="data-rejection">
                    <dt>Patch {patch}</dt>
                    <dd>{format(report.patchCounts[patch])} accepted</dd>
                  </div>
                ))}
                <dt>Discovered matches still queued</dt>
                <dd>{format(report.pendingMatches)}</dd>
                <dt>Candidate date window</dt>
                <dd>
                  {date(report.windowStart)} – {date(report.windowEnd)}
                </dd>
                <dt>Rank observations</dt>
                <dd>
                  {report.rankObservedFrom && report.rankObservedTo
                    ? date(report.rankObservedFrom) +
                      " – " +
                      date(report.rankObservedTo)
                    : "No accepted rank observations yet"}
                </dd>
              </dl>
            </details>
            <details>
              <summary>
                Why matches were excluded ({format(report.rejectedMatches)})
              </summary>
              {Object.keys(report.rejectionCounts).length ? (
                <dl>
                  {Object.entries(report.rejectionCounts).map(
                    ([reason, count]) => (
                      <div className="data-rejection" key={reason}>
                        <dt>{rejectionLabels[reason] ?? reason}</dt>
                        <dd>{format(count)}</dd>
                      </div>
                    ),
                  )}
                </dl>
              ) : (
                <p>No exclusions recorded yet.</p>
              )}
            </details>
          </div>
          <div className="section-heading">
            <div>
              <h2>Champion coverage</h2>
              <p>
                Observed results across the selected dataset’s patches. Use
                Matchups to filter by patch. Small samples are not pick
                priorities.
              </p>
            </div>
            <label className="inline-field">
              Role
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="all">All roles</option>
                {Object.entries(roleNames).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {rows.length ? (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Champion</th>
                    <th>Role</th>
                    <th>Games</th>
                    <th>Wins</th>
                    <th>Observed win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 30).map((row) => (
                    <tr key={row.championId + row.role}>
                      <td>
                        {championNames.get(row.championName) ??
                          row.championName}
                      </td>
                      <td>{roleNames[row.role]}</td>
                      <td>
                        {format(row.games)}
                        {row.games < 30 && <small> Small sample</small>}
                      </td>
                      <td>{format(row.wins)}</td>
                      <td>
                        {row.games
                          ? ((row.wins / row.games) * 100).toFixed(1) + "%"
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="settings-note">
                Showing {Math.min(30, rows.length)} of {rows.length}{" "}
                champion-role samples, ordered by games played. “Small sample”
                is a display flag below 30 games, not a reliability guarantee
                above it.
              </p>
            </div>
          ) : (
            <p className="data-empty">
              Champion coverage will appear as matches pass validation.
            </p>
          )}
        </>
      )}
    </section>
  );
}

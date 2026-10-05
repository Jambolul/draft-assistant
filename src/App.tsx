import { useEffect, useState } from "react";
import { roles, roleLabels } from "./types";
import type { DraftWorkspace, Role, Slot } from "./types";
import { loadSettings, sanitizeBans, storageKey } from "./state";
import { champions, championById } from "./data/champions";
import {
  demoDraft,
  emptyDraft,
  emptyTeam,
  selectedIds,
  setPick,
} from "./engine/draft";
import { analyzeDraft, recommend } from "./engine/recommend";
import DraftBoard from "./components/DraftBoard";
import ChampionPicker from "./components/ChampionPicker";
import SettingsPanel from "./components/SettingsPanel";
import Recommendations from "./components/Recommendations";
import CoachRecommendations from "./components/CoachRecommendations";
import TeamProfile from "./components/TeamProfile";

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [view, setView] = useState<"draft" | "settings">("draft");
  const [picker, setPicker] = useState<Slot | "ban" | null>(null);
  const [analyzed, setAnalyzed] = useState({ solo: false, coach: false });
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }, [settings]);
  const { mode, solo, coach } = settings;
  const workspace = settings[mode];
  const { draft, playerSide, bans } = workspace;
  const isCoach = mode === "coach";
  const analysis = analyzeDraft(draft);
  const taken = new Set([...selectedIds(draft), ...bans]);
  const pool = solo.pools[solo.role];
  const available = pool.pool.filter((id) => !taken.has(id));
  const results = !isCoach
    ? recommend(draft, pool.pool, pool.comfort, solo.role, bans)
    : [];
  const ownPick = championById.get(draft.ally[solo.role] ?? "");
  const openRoles = roles.filter((role) => !draft.ally[role]);
  const playerNames = Object.fromEntries(
    roles.map((role) => [
      role,
      coach.players[role].name || roleLabels[role] + " player",
    ]),
  ) as Record<Role, string>;
  function updateWorkspace(
    update: (current: DraftWorkspace) => DraftWorkspace,
  ) {
    setSettings((previous) => ({
      ...previous,
      [previous.mode]: {
        ...previous[previous.mode],
        ...update(previous[previous.mode]),
      },
    }));
  }
  function pick(slot: Slot, id: string | null) {
    updateWorkspace((current) => ({
      ...current,
      draft: setPick(current.draft, slot, id, null, current.bans),
    }));
  }
  function changeRole(role: Role) {
    setSettings((previous) => ({
      ...previous,
      solo: { ...previous.solo, role },
    }));
  }
  function loadExample() {
    const example = demoDraft();
    if (isCoach) example.ally = emptyTeam();
    else {
      example.ally.mid = "ahri";
      example.ally[solo.role] = null;
    }
    updateWorkspace((current) => ({ ...current, draft: example, bans: [] }));
    setAnalyzed((previous) => ({ ...previous, [mode]: false }));
  }
  return (
    <div className={"app-shell player-" + playerSide}>
      <header className="app-header">
        <a className="brand" href="#main" onClick={() => setView("draft")}>
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <span>Draft Assistant</span>
        </a>
        <div className="mode-switch" role="group" aria-label="Draft mode">
          {(["solo", "coach"] as const).map((next) => (
            <button
              key={next}
              aria-pressed={mode === next}
              onClick={() => {
                setSettings((previous) => ({ ...previous, mode: next }));
                setPicker(null);
              }}
            >
              {next === "solo" ? "SoloQ" : "Coach"}
            </button>
          ))}
        </div>
        <nav aria-label="Main navigation">
          <button
            aria-current={view === "draft" ? "page" : undefined}
            onClick={() => setView("draft")}
          >
            Draft board
          </button>
          <button
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => setView("settings")}
          >
            {isCoach ? "Team settings" : "Personal settings"}
          </button>
        </nav>
      </header>
      <main id="main">
        {view === "draft" ? (
          <>
            <div className="board-toolbar">
              <div className="draft-controls">
                <h1>{isCoach ? "Team draft" : "Draft"}</h1>
                <div
                  className="side-selector"
                  role="group"
                  aria-label="Your side"
                >
                  <span>Your side</span>
                  {(["blue", "red"] as const).map((side) => (
                    <button
                      key={side}
                      className={side}
                      aria-pressed={playerSide === side}
                      onClick={() =>
                        updateWorkspace((current) => ({
                          ...current,
                          playerSide: side,
                        }))
                      }
                    >
                      {side === "blue" ? "Blue" : "Red"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="draft-actions">
                <button className="text-button" onClick={loadExample}>
                  Load example
                </button>
                <span className="toolbar-divider" />
                <button
                  className="text-button muted"
                  disabled={!analysis.known && !bans.length}
                  onClick={() => {
                    updateWorkspace((current) => ({
                      ...current,
                      draft: emptyDraft(),
                      bans: [],
                    }));
                    setAnalyzed((previous) => ({ ...previous, [mode]: false }));
                  }}
                >
                  Clear draft
                </button>
              </div>
            </div>
            <div className="draft-context">
              {isCoach ? (
                <>
                  <div>
                    <strong>{coach.teamName || "My team"}</strong>
                    <span>Five players. Five pools.</span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setView("settings")}
                  >
                    Manage roster
                  </button>
                </>
              ) : (
                <>
                  <label className="inline-field">
                    Your role
                    <select
                      value={solo.role}
                      onChange={(e) => changeRole(e.target.value as Role)}
                    >
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {roleLabels[role]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="text-button"
                    onClick={() => setView("settings")}
                  >
                    Edit your {roleLabels[solo.role].toLowerCase()} pool
                  </button>
                </>
              )}
            </div>
            <DraftBoard
              draft={draft}
              playerSide={playerSide}
              personalRole={isCoach ? null : solo.role}
              editablePersonalPick
              playerNames={isCoach ? playerNames : undefined}
              teamName={isCoach ? coach.teamName : undefined}
              onSelect={setPicker}
              onRemove={(slot) => pick(slot, null)}
            />
            <div className="ban-bar" aria-label="Banned champions">
              <span className="ban-label">
                Bans <small>{bans.length}/10</small>
              </span>
              <div className="ban-chips">
                {bans.map((id) => (
                  <button
                    key={id}
                    aria-label={"Remove ban on " + championById.get(id)!.name}
                    onClick={() =>
                      updateWorkspace((current) => ({
                        ...current,
                        bans: current.bans.filter((ban) => ban !== id),
                      }))
                    }
                  >
                    {championById.get(id)!.name}
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
              <button
                className="text-button"
                disabled={bans.length >= 10}
                onClick={() => setPicker("ban")}
              >
                + Add ban
              </button>
            </div>
            <div className="analyze-bar">
              <div>
                <strong>
                  {isCoach
                    ? openRoles.length + " roles left to fill"
                    : ownPick
                      ? ownPick.name + " selected for " + roleLabels[solo.role]
                      : available.length +
                        " available in your " +
                        roleLabels[solo.role].toLowerCase() +
                        " pool"}
                </strong>
                <span className="analysis-hint">
                  {!analysis.known
                    ? "Add a known pick or load an example to begin."
                    : "Trait-based estimates · Match data pending"}
                </span>
              </div>
              {ownPick && !isCoach ? (
                <button
                  className="secondary-button"
                  onClick={() => pick({ side: "ally", role: solo.role }, null)}
                >
                  Reopen your pick
                </button>
              ) : (
                <button
                  className="primary-button"
                  aria-expanded={analyzed[mode]}
                  disabled={
                    !analysis.known ||
                    (!analyzed[mode] && !isCoach && !available.length)
                  }
                  onClick={() =>
                    setAnalyzed((previous) => ({
                      ...previous,
                      [mode]: !previous[mode],
                    }))
                  }
                >
                  {analyzed[mode]
                    ? "Hide analysis"
                    : isCoach
                      ? "Compare player pools"
                      : "Analyze draft"}
                  <span aria-hidden="true">↗</span>
                </button>
              )}
            </div>
            {!isCoach && !ownPick && !available.length && (
              <p className="warning" role="status">
                {pool.pool.length
                  ? "Your pool champions are all picked or banned."
                  : "Your champion pool is empty."}{" "}
                <button
                  className="text-button"
                  onClick={() => setView("settings")}
                >
                  Edit your pool →
                </button>
              </p>
            )}
            {analyzed[mode] && analysis.known > 0 && (
              <>
                {isCoach ? (
                  <CoachRecommendations
                    workspace={coach}
                    onPick={(role, id) => pick({ side: "ally", role }, id)}
                    onEdit={() => setView("settings")}
                  />
                ) : (
                  !ownPick && (
                    <Recommendations
                      results={results}
                      known={analysis.known}
                      title={roleLabels[solo.role] + " recommendations"}
                      onPick={(id) =>
                        pick({ side: "ally", role: solo.role }, id)
                      }
                    />
                  )
                )}
                <TeamProfile draft={draft} />
              </>
            )}
          </>
        ) : (
          <SettingsPanel
            key={mode}
            settings={settings}
            onChange={setSettings}
          />
        )}
      </main>
      <footer className="app-footer">
        <span>
          <span className={"save-dot" + (saveFailed ? " failed" : "")} />
          {saveFailed
            ? "Browser saving unavailable · changes last this session"
            : "Saved locally · Drafts and pools kept per mode"}
        </span>
        <span>{champions.length} champions · Estimated fit, not win rate</span>
      </footer>
      {picker && (
        <ChampionPicker
          slot={picker === "ban" ? { side: "ally", role: solo.role } : picker}
          purpose={picker === "ban" ? "ban" : "pick"}
          draft={draft}
          bans={bans}
          playerSide={playerSide}
          onClose={() => setPicker(null)}
          onPick={(id) => {
            if (picker === "ban")
              updateWorkspace((current) => ({
                ...current,
                bans: sanitizeBans([...current.bans, id], current.draft),
              }));
            else pick(picker, id);
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

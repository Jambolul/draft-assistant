import { useState } from "react";
import { roles, roleLabels } from "../types";
import type { ChampionPool, Role, Settings } from "../types";
import PoolEditor from "./PoolEditor";

export default function SettingsPanel({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
}) {
  const coach = settings.mode === "coach";
  const [editingRole, setEditingRole] = useState<Role>(
    coach ? "top" : settings.solo.role,
  );
  const player = settings.coach.players[editingRole];
  const profile = coach ? player : settings.solo.pools[editingRole];
  function updatePool(next: ChampionPool) {
    onChange(
      coach
        ? {
            ...settings,
            coach: {
              ...settings.coach,
              players: {
                ...settings.coach.players,
                [editingRole]: { ...player, ...next },
              },
            },
          }
        : {
            ...settings,
            solo: {
              ...settings.solo,
              pools: { ...settings.solo.pools, [editingRole]: next },
            },
          },
    );
  }
  return (
    <section className="settings-page">
      <div className="section-heading">
        <div>
          <h1>{coach ? "Team settings" : "Personal settings"}</h1>
        </div>
      </div>
      <div className="settings-layout">
        <aside className="profile-sidebar">
          {coach ? (
            <label className="field">
              Team name
              <input
                value={settings.coach.teamName}
                maxLength={40}
                placeholder="My team"
                onChange={(e) =>
                  onChange({
                    ...settings,
                    coach: { ...settings.coach, teamName: e.target.value },
                  })
                }
              />
            </label>
          ) : (
            <label className="field">
              Your role
              <select
                value={settings.solo.role}
                onChange={(e) => {
                  const role = e.target.value as Role;
                  setEditingRole(role);
                  onChange({ ...settings, solo: { ...settings.solo, role } });
                }}
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="eyebrow">{coach ? "ROSTER & POOLS" : "YOUR POOLS"}</p>
          <div
            className="profile-roles"
            role="group"
            aria-label={coach ? "Player pools" : "Role pools"}
          >
            {roles.map((role) => (
              <button
                key={role}
                className="profile-role-button"
                aria-pressed={editingRole === role}
                onClick={() => setEditingRole(role)}
              >
                <span>
                  <strong>{roleLabels[role]}</strong>
                  {coach && (
                    <small>
                      {settings.coach.players[role].name ||
                        roleLabels[role] + " player"}
                    </small>
                  )}
                </span>
                <span className="pool-size">
                  {
                    (coach
                      ? settings.coach.players[role]
                      : settings.solo.pools[role]
                    ).pool.length
                  }
                </span>
              </button>
            ))}
          </div>
        </aside>
        <div className="profile-content">
          {coach && (
            <label className="field player-name-field">
              {roleLabels[editingRole]} player name
              <input
                value={player.name}
                maxLength={32}
                placeholder={roleLabels[editingRole] + " player"}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    coach: {
                      ...settings.coach,
                      players: {
                        ...settings.coach.players,
                        [editingRole]: { ...player, name: e.target.value },
                      },
                    },
                  })
                }
              />
            </label>
          )}
          <PoolEditor
            key={editingRole}
            role={editingRole}
            owner={
              coach
                ? player.name || roleLabels[editingRole] + " player"
                : "Your champions"
            }
            settings={profile}
            onChange={updatePool}
          />
        </div>
      </div>
    </section>
  );
}

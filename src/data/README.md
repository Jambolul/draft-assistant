# Editing champion profiles

Edit **championProfiles.ts**. Search for a champion's name, change its named fields, and save. The running development app refreshes automatically. A production copy needs `npm run build` again.

Every champion has a complete, independent profile. There are no positional rating arrays or hidden inherited defaults. For example, Hwei has `waveclear: 5`, `mobility: 1`, and `antiDive: 4`.

## Rating guide

Use a 0–5 scale: **0** absent/negligible, **1** weak, **2** limited, **3** useful, **4** strong, **5** defining strength. Decimals are allowed. Rate a typical Summoner's Rift build and reasonable execution, relative to other champions. These are kit estimates, not a tier list or a win-rate model.

| Field | Meaning |
| --- | --- |
| `magic` | Magic damage contribution, not AP ratios or damage percentage |
| `physical` | Physical damage contribution, not AD ratios or damage percentage |
| `engage` | Ability to start a fight |
| `peel` | Ability to protect allies from threats |
| `poke` | Repeatable damage from a safe distance |
| `burst` | Damage delivered in a short window |
| `sustain` | **Sustained damage over time**, not healing or regeneration |
| `waveclear` | Ability to clear lane minions, not jungle clear speed |
| `pick` | Ability to catch or isolate a target |
| `mobility` | Movement and repositioning tools |
| `frontline` | Ability to occupy space and withstand damage |
| `scaling` | How much levels and items improve later-game impact |
| `antiDive` | Tools that punish or deny backline entry; not universal immunity to engage |
| `dive` | Ability to reach and threaten backline targets |
| `teamfight` | Contribution to grouped fights |

Magic and physical ratings are independent; they do not have to sum to five. True damage has no separate field in the current scoring model. A single profile cannot capture every build, role, form, matchup, cooldown or patch change. Kayn and other build-dependent champions especially benefit from your review.

`identity` is the short playstyle summary; `tradeoff` is the weakness shown in recommendations. Editing the prose changes the explanation, not the score. Editing `traits` changes the score. `roles` controls picker filters and eligibility in personal and coach role pools. Allowed roles are `top`, `jungle`, `mid`, `adc`, `support`. Include a role to make the champion available in that role's pool editor. All champions remain selectable in any draft slot through All roles.

Keep `id` and `riotId` stable to preserve saved drafts and pools. `jarvan` is the existing app ID for Riot's `JarvanIV`; `wukong` maps to Riot's `MonkeyKing`. `name` is the displayed name and `color` is the champion badge color.

Run `npm test` after editing to check roster coverage, complete ratings and valid values. TypeScript also checks field names when you build.

## Coverage and provenance

- **173 champions**, Data Dragon **16.19.1**, retrieved **October 4, 2026**. `roster-source.json` records the official IDs and source URLs.
- Names and roster coverage come from [Riot Data Dragon](https://ddragon.leagueoflegends.com/cdn/16.19.1/data/en_US/champion.json). [Ability descriptions](https://ddragon.leagueoflegends.com/cdn/16.19.1/data/en_US/championFull.json) were consulted for newer and reworked champions. [Riot documentation](https://developer.riotgames.com/docs/lol#data-dragon).
- Roles, ratings, identities and tradeoffs are provisional hand-authored design judgments, **not ratings supplied by Riot** and not calibrated against match outcomes. All original 25 profiles retain their original ratings and text.
- The dataset is bundled locally. There are no runtime network requests, API keys, or automatic updates that could overwrite your edits. The version identifies the roster snapshot, not proof that every estimate reflects patch balance.

For a future champion, add one full profile and update the roster manifest from Riot's roster. Preserve your existing entries when refreshing coverage.

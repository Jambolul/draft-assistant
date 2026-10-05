# Draft Assistant

A local React + TypeScript MVP based on the Draft Assistant Design conversation.

## Start

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Run `npm test` for engine tests and `npm run build` for the production build.

## MVP scope

- Switch between SoloQ and Coach, each with its own saved draft, side and bans.
- Choose your blue or red side and any of the five roles in SoloQ.
- Manually enter known picks for both teams, with duplicate-pick and banned-champion prevention.
- Search all 173 champions from Riot's Data Dragon 16.19.1 roster snapshot.
- Personal settings store separate champion pools and comfort ratings for all five roles.
- Team settings hold a named five-player roster, with a separate pool and comfort ratings for each role's player.
- Coach mode shows shortlists for every open role. Pick directly from a shortlist, inspect its reasoning, or enter a pick manually. Remaining shortlists update after each pick.
- Add up to ten bans, remove a pick to reopen its role, and show or hide analysis.
- Save both workspaces in this browser. Existing mid-lane settings migrate to SoloQ; the old browser entry is retained.

Champion traits are provisional, hand-authored design estimates. Scores are relative composition fit, not win probabilities or lane matchup statistics. This initial version has no Riot client connection, OCR, account, backend, AI service, or API key.

The shared heuristic now accepts a target role, a player's pool and comfort, and bans. Only mid retains the existing mid-waveclear baseline; no new statistical ranking model has been introduced. The score is not comparable across role shortlists or draft states. Coach shortlists are individual options, not an optimized full lineup. Multiple saved teams, movable player profiles, joint lineup search and measured matchup/synergy priorities remain later work.

## Structure

- `src/data/championProfiles.ts`: editable, named ratings and weaknesses for every champion.
- `src/data/README.md`: rating definitions, editing instructions and source notes.
- `src/data/champions.ts`: champion lookup and original mid pool.
- `src/engine/`: draft analysis and recommendation rules.
- `src/components/`: draft board, picker, pool, and recommendation views.
- `src/state.ts`: starter pools, per-mode persistence, migration and validation.

## Next steps

Validate the starting profiles and explanations against drafts you know and tune the named ratings. See [the editing guide](src/data/README.md). The dataset is local and never refreshed automatically over your edits. Next, investigate match collection and validated pick priorities; see [the data research](docs/data-and-modes-research.md). Large overall sample counts alone will not guarantee coverage of particular matchups and combinations.

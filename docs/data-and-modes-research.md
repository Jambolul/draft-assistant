**Draft Assistant: match data, recommendation logic, and SoloQ / Coach modes**

Research date: October 4, 2026. This is a research and design proposal; no statistical model has been trained or data integration enabled.

UI implementation update: SoloQ/Coach switching, separate persisted drafts/sides/bans, personal role selection and per-role pools, a named five-player coach roster with one pool per assigned role, direct picks and per-open-role shortlists are now available. The existing heuristic accepts the selected role and bans; the mid baseline is only applied to mid. Individual shortlists recompute after each pick. Multiple saved rosters, movable player profiles, flex reassignment and joint lineup search in the proposal below remain future work. Statistical priorities and collection are deferred until after this UI iteration.

**Recommendation**

Use Riot Match-V5 as the primary candidate for our own match collection. Retain editable champion traits for explanations and for situations where match evidence is weak. Start with an interpretable statistical baseline before attempting a large neural model. Make player role and pool explicit so the same recommendation engine can serve one player or an entire roster.

**What the sources establish**

| Source | What is available | Implication for this project |
| --- | --- | --- |
| [Riot Match-V5](https://developer.riotgames.com/apis#match-v5/GET_getMatch) | Match IDs by player, match records, and a separate timeline endpoint. Records include champion, inferred position, team, outcome, game version and queue. | Raw material for our own statistics and model; not a ready-made champion recommendation service. |
| [Riot Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon) | Static champion and item information. | Keep it for roster coverage and metadata. Our current 0–5 ratings are our estimates, not measured performance. |
| [LoLalytics API notice](https://a3.lolalytics.com/) | The notice identifies its API as private and says third parties may not use its data. | Do not build an integration around private endpoints. A data agreement would need to be established first. |
| [Coachless](https://coachless.gg/) | Describes separate pre-game and in-game models. The pre-game description includes champion strength, synergies, matchups and player skill. | Relevant evidence that this direction is feasible, but not evidence that its model is available to embed. |
| [Coachless WPA explanation](https://coachless.gg/wpa) | Describes item WPA as item win rate minus average predicted win probability before purchase, and identifies limitations. | Learn from its treatment of context and selection bias; do not equate raw win rate with item or champion impact. |
| [DraftRec research](https://arxiv.org/html/2204.12750v1) | A published personalized drafting model combining player preferences with interactions between players/champions; the authors link code and datasets. | Particularly relevant to personal pools and coach mode. It is a research reference, not a current-patch model ready for our app. |

The Coachless pages were read in the browser because their main content is rendered with JavaScript. I did not find documented public model/API access in the pages and searches checked. Its [terms, especially section 17](https://coachless.gg/terms-of-service), also restrict access to its databases and back-office services. A possible partnership remains an open question, not an available dependency.

[xPetu's 2024 master's thesis](https://sal.aalto.fi/publications/pdf-files/theses/mas/tjal24a_public.pdf) develops contextual action evaluation using win probability and applies it to items with an in-game model. That is related to our problem but does not directly deliver a champion-select predictor. In-game prediction can use gold, levels and objectives; draft prediction cannot use those future observations. Accuracy from one task does not establish performance on the other.

I also checked [Oracle's Elixir's downloads page](https://oracleselixir.com/tools/downloads), but it returned HTTP 403 in this research session. Current availability and reuse terms were not verified, so it is not a selected dependency.

**What WPA would and would not mean for us**

Coachless's public explanation acknowledges that purchase sequences have correlated values, universally selected items are not identifiable by this method, and estimates depend on the model and unmeasured confounders. Its formula is not simply a comparison of two items' raw win rates. [Methodology](https://coachless.gg/wpa).

Our first drafting model should instead compare candidate champions in the same observed draft context. The output would be a *model-estimated difference* between candidate A and candidate B, conditional on our assumptions about players and unfilled slots. It would not prove that switching the champion causes that improvement. Good outcome prediction alone does not resolve selection bias: specialists, counterpick timing and premade coordination can all affect which champions appear in which games.

Show model evidence and confidence separately from qualitative fit and comfort. Avoid converting the existing heuristic score into a percentage chance of winning or calling it WPA. For an incomplete draft, never silently treat unknown enemy picks as harmless; assess plausible completions and expose uncertainty.

**Problems in the current local engine**

Inspection of `src/engine/recommend.ts`, `src/engine/draft.ts`, and `src/state.ts` found:

- The recommendation candidates, protected draft slot and baseline waveclear rule are fixed to mid.
- Team traits are averaged, so a single excellent engager or one decisive anti-dash interaction can be diluted by the other members.
- Thresholds and weights are manually chosen and do not learn from outcomes.
- Matchup, champion-pair synergy, patch, rank and region are not modeled.
- The five-point comfort contribution changes its relative influence as the number of triggered rules changes.
- The displayed 0–100 score is normalized rule satisfaction. Scores across different draft states need not be directly comparable.

These are reasons to improve the engine, not reasons to discard the editable profiles. Traits still help explain *why* a draft might work, and they provide a fallback for rare combinations and new champions.

**Proposed data pipeline**

Collect unique ranked Summoner's Rift matches across a defined set of regions, ranks and dates. Do not sample only one streamer's match graph and treat it as representative. Keep Solo/Duo, Flex and organized play distinct. Deduplicate matches, normalize champion IDs and patch versions, flag unreliable role labels, and use a documented rule for remakes and malformed records.

Riot recommends `teamPosition` over `individualPosition`, but both are inferred rather than a guarantee of the role selected before the game. The match record also contains `gameVersion`, `queueId` and outcome fields. It does not provide a historical MMR value or a complete champion-pick sequence in the inspected schema. Do not treat today's rank as a player's exact historical rank, or use ban `pickTurn` as champion pick order. [Match reference](https://developer.riotgames.com/apis#match-v5/GET_getMatch).

For a first draft model, collect match summaries; full timelines can wait until we need time-dependent or item analysis. Keep the API key in a local service or backend, never the browser bundle. Store matches and aggregates locally initially; serve the app a small, versioned statistics/model artifact so drafting stays fast.

Development keys expire every 24 hours. Riot documents personal keys for private projects with limits of 20 requests/second and 100 requests/two minutes; public products need production access. Honor actual rate-limit headers and backoff. Large datasets require a maintained collection process, not a one-off browser request. [Access and limits](https://developer.riotgames.com/docs/portal#web-apis).

**First statistical model to try**

My proposed baseline is a regularized logistic model with champion-by-role strength, side, patch context, allied pair interactions and enemy interactions. Regularization should pull sparse matchup/synergy estimates toward the general baseline rather than rewarding spectacular results from a handful of matches. Use our composition traits as additional features only where validation supports them, without counting the same signal twice.

Compare this against a simple champion-role baseline and the current heuristic. Add more complex models only if they improve performance on later, unseen matches. Exact ten-champion lookup tables will be sparse; a useful system needs to generalize through roles and interactions.

Personal comfort should initially act as an eligibility constraint and a clearly shown preference. A champion outside a player's pool should not rank first solely because of a tiny statistical edge. If we later use player histories, only matches before the evaluated game belong in its features. Account for sample size and avoid treating a few wins as a reliable mastery estimate.

For validation, split by time and match ID, keep both teams from one match in the same split, and test on later patches. Check log loss, Brier score and calibration by role, rank and draft completeness; accuracy alone is insufficient. Check that partial drafts never receive withheld future picks, and that post-game gold, KDA or items do not enter a pre-game model. Measure data coverage and uncertainty alongside performance. Small differences should allow a tie or a comfort-based preference.

Prediction tests cannot by themselves establish the value of recommending an unplayed alternative. Add a curated set of drafts with coach/player reasoning, and later track prospective use without claiming causal improvement from that alone.

**Proposed user interface**

Keep the dark board and a small `SoloQ | Coach` switch. Keep Blue / Red as a separate control. Remember each mode's settings and draft separately so switching does not overwrite the other workspace.

| Feature | SoloQ mode | Coach mode |
| --- | --- | --- |
| Setup | Personal settings: default role, per-role pools and comfort; quick current-role override | Named team roster; assign five players to roles; each player has their own per-role pools and comfort |
| Draft focus | Your selected role is reserved for recommendations | Every allied role can be filled; select an open slot to inspect suggestions |
| Suggestions | A few candidates from your pool, with fit, matchup evidence, comfort and confidence | Shortlists for every open role, plus optional coherent lineup alternatives |
| Controls | Side, current role, picks and bans | Side, player assignment, picks, bans, locked picks and role/flex reassignment |
| Persistence | Personal profile and per-role pools | Multiple saved teams/rosters and separate player profiles |

Coach mode must consider the five pools jointly. Taking each role's independent number-one pick can produce duplicate champions, redundant damage or a missing frontline. Recompute suggestions after each pick; for full-team suggestions, search legal combinations that respect pools, roles, bans and locks. Flex picks should remain uncertain until assigned. A later version can model pick order, enemy responses and tournament formats such as Fearless; these are separate from the first coach workspace.

Data source and UI mode are different settings. A coach of an amateur team may prefer statistics near the team's level; professional results are not automatically the right reference merely because Coach mode is selected.

**Proposed build order**

1. Generalize role selection and scoring inputs; migrate the existing saved mid pool and draft without losing data.
2. Add per-role personal pools and a coach roster with separate player profiles, bans and locks. Reuse one role-aware recommendation interface.
3. Add a Riot-backed offline collection prototype and transparent champion-role/matchup/synergy evidence, with sample counts and freshness.
4. Train and validate the draft model; blend or replace heuristic ranking only when measured results support it.
5. Add joint lineup search, flex/pick-order planning and optional personalized histories.

No external data subscription, account access or API credential was used in this research. Live collection needs an appropriate Riot key; licensed third-party model access would require agreement with that provider. Riot's [game-integrity guidance](https://developer.riotgames.com/docs/lol#game-integrity) supports keeping multiple explained options and preserving player choice; hidden lobby identities should not be reconstructed.

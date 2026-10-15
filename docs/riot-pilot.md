# EUW Riot API collection

The collector targets **20,000 accepted, unique EUW ranked Solo/Duo matches** on patches **26.19 and 26.20**. It retains **all previously accepted games**, including the earlier Emerald+ sample. New collection uses **10,000 Diamond+ players** with up to **five games per player**. The evidence supports matchup inspection; it does not change draft recommendations.

## Run locally

Use **Node.js 24** (tested with 24.14.1). Built-in SQLite may print an experimental-feature warning. No database server is required.

1. Put `RIOT_API_KEY=your_key` in the project root's `.env` file. See [.env.example](../.env.example) and the [Riot developer portal](https://developer.riotgames.com/). Never use a `VITE_` prefix for the key.
2. Run `npm run data:collect`.
3. Start the app with `npm run dev` and open **Match data**. The overview refreshes every 15 seconds while open; Matchups reads the latest exported summaries when opened or refreshed.

```sh
npm run data:collect -- --target 20000
npm run data:status
```

The first `--` forwards options through npm. The target is the total accepted count, including reused games, not an additional download count. A smaller target does not delete data. Overrides apply to one command; use the same override when resuming or checking status.

Keep the terminal running during collection. The browser only displays reports. Requests fetch ranked lists, discovery players' histories and match details. There are **no per-participant rank requests**. Collection stops at the match target even if some selected players remain unsearched.

## Cached data and the new dataset

Configuration lives in [pilot.config.json](../scripts/riot/pilot.config.json). The active dataset is `euw-solo-26.19-26.20-diamond`. The original `euw-solo-26.19-pilot` Emerald+ database remains unchanged and is opened read-only for cache reuse.

To prepare cached data without a key or network requests:

```sh
npm run data:prepare
```

With `retainAcceptedMatches: true`, preparation restores **every accepted match from the source dataset**, including Emerald-sourced games and older histories with more than five games. Each is validated under its original rank rule and the active patch/date/region scope, then stored as a retained normalized snapshot. If an accepted source match cannot be validated, the entire restoration rolls back rather than silently omitting it. Rebuilds preserve these snapshots instead of imposing new rank requirements on them. Rejected source matches are not promoted by retention.

The restoration merges into an already populated dataset, preserving newer matches, saved histories, seed order and request counts. Shared match IDs count once and keep their earlier inclusion rule. Retained games do not add Emerald players to the new Diamond+ discovery pool. Full raw responses remain in the source database; normalized snapshots avoid copying the entire raw cache again. Cached ladder pages and up to five history IDs per qualifying old seed can still initialize the new discovery pool, independently of retaining all accepted historical games.

The next collection run expands the selected pool to 10,000 using cached lists and additional Diamond pages. Newly selected players receive fresh history requests within the new dataset's window. Match details found in the old cache are reused without downloading them again. Reused responses are reported separately; the new API request count starts at zero. Active rate-limit cooldowns carry over.

If the source dataset is absent, collection starts fresh. Restoration is atomic and repeatable: failures can be retried and subsequent runs do not duplicate games. Disabling retention later does not delete games already retained.

## Pause, resume and limits

Press Ctrl+C in the collector's terminal, then run the same command to resume. SQLite saves responses, candidate IDs, rank observations, completed histories and rate-limit state. Duplicate match IDs are collected once. A writer lock prevents simultaneous writers; a dead process's lock is reclaimed.

On 401/403, collection stops with `API key needed`. Renew the key in `.env` and resume. Existing environment variables take precedence over `.env`; remove an outdated shell `RIOT_API_KEY` if necessary. The collector never prints the key, HTTP headers or response bodies.

429 responses respect `Retry-After`. Application and method rate-limit headers are observed, with a conservative 1.3-second request gap. Temporary network/server errors retry with bounded backoff.

There are **no total download or per-run request caps by default**. Collection stops at the target, Ctrl+C, an API/access error or exhaustion of the sample. Optional positive `maxDownloadedMatches` and `maxRequestsPerRun` values restore caps; `--max-requests NUMBER` overrides the request cap and `--max-requests none` disables it. A download cap includes rejected and earlier downloads and must cover the target. Riot's rate limits always apply.

## Inclusion rules and rank meaning

These rank and history-size requirements apply to **new collection**. Earlier accepted games keep their original rules; they are included in totals and matchup results and labelled as retained data.

- EUW1, Summoner's Rift, ranked Solo/Duo (`queueId: 420`).
- Exact major/minor `gameVersion` prefix **16.19 or 16.20**, mapped to user-facing patch **26.19 or 26.20**. Each game retains its actual patch. Dates only narrow discovery.
- Match start within the configured window, starting September 22, 2026. The end is frozen at the earlier of dataset preparation/first collection and October 22, 2026. The new dataset does not inherit the old October 5 cutoff. Games after the new frozen cutoff require another dataset with a later cutoff.
- At least five minutes of gameplay and no `gameEndedInEarlySurrender` flag. This conservative exclusion can remove legitimate early surrenders; exclusions are reported.
- Ten distinct participants and champions, five distinct inferred `teamPosition` roles per team, and one winning team with consistent participant results.
- **The player whose history supplied the game has a cached Diamond, Master, Grandmaster or Challenger Solo/Duo rank and appears in the match.** Flex rank cannot qualify a player. Other participants' ranks do not determine eligibility.

League-V4 describes rank at lookup time, **not rank or MMR when the match happened**. Cached observations may have different dates. Missing participant observations are `not_checked`, never assumed Diamond. This samples games played by known Diamond+ players without guaranteeing ten Diamond+ participants. Five unique inferred roles cannot prove the actual positions played.

The current rule is `rankPolicy: "seed_diamond_plus"`. Code also supports `seed_emerald_plus` for explicitly configured datasets. Changing region, queue, patch set, discovery window, minimum rank or games-per-player setting requires a **new datasetId**. Raising the match target or expanding the selected pool preserves progress. Lowering a pool limit does not remove existing players.

## Sampling limitations

Discovery reads up to **ten ladder pages per Diamond division** and the Master, Grandmaster and Challenger lists. New players are selected by deterministic hash order, interleaving seven rank buckets. Imported players retain their order. Cached lists are reused, so rank observations need not be contemporaneous.

Up to five recent Solo/Duo games are requested per player for new collection within the frozen window. Older accepted histories may exceed five games and remain included. Duplicates and exclusions mean 10,000 players do not guarantee 50,000 accepted games. Reaching the target first leaves some players unsearched. With four first Diamond pages and the high-rank lists cached, expansion needs up to 36 additional Diamond-page requests before searching new histories.

Five games is a **history-discovery limit**, not a cap on total appearances: a player can appear in many other players' histories. Broader discovery reduces dependence on a small selected group but does not make outcomes independent.

The combined dataset includes the earlier Emerald+ sampling phase and newer Diamond+ collection. It is not a random or representative sample of all EUW games at either cutoff. Ladder pages, bucket allocation, recent histories, processing order, imported histories and repeat players can bias it. Rank-snapshot counts include cached ladder entries, not just participants in accepted matches.

A large dataset can still leave individual matchups poorly covered. The 30-game small-sample flag is a display aid, not a reliability threshold. No validated win probability or causal pick-strength estimate is claimed.

## Examine matchups

Open **Match data → Matchups** and select a patch, champion and role. The initial patch is the newest accepted patch with data. Each patch can be viewed separately, or select **All patches combined**. An accepted patch with no collected games shows an empty result. Combining patches can mix different balance states.

The table counts game outcomes against the enemy champion assigned to the same inferred role. Reversing a matchup reverses the win/loss perspective. These are game wins, not lane wins. Side, opponent search, minimum count and sorting controls help explore the sample.

The detail panel compares the matchup with games against **other opponents**, retaining the same patch, role and side filters. Searching or hiding rows does not change this baseline. The percentage-point difference does not isolate matchup effects from player skill, rank, allies or other enemies. Sample sensitivity shows the effect of changing one outcome, not a confidence interval.

Expand a game to inspect its patch, collection phase, original rank rule, date, duration, side, both compositions and cached rank observations. “Rank not checked” differs from unranked or unavailable observations. Player names and account identifiers are omitted. Bot and support comparisons are separate; compositions show both duos.

The explorer refreshes when collection completes or after preparation, export or rebuild. Its export time and count are separate from live progress. The UI rejects malformed exports and mismatched dataset, rank policy or patch metadata.

## Files and exports

Active private data lives under `data/riot/euw-solo-26.19-26.20-diamond/`:

- `pilot.sqlite` and sidecars: raw matches, ladder pages, observations and resume state. Raw responses contain player identifiers and stay local.
- `summary.json`: aggregate report, per-patch counts, pool settings and reused responses.
- `matches.normalized.jsonl`: produced by export, with identity, actual patch, duration, compositions, outcome, policy and available observations. `observedQualifyingParticipants` counts known qualifying observations, not the lobby's true rank makeup. Player identifiers, names and post-game performance are omitted.

Stop collection before exporting or rebuilding; these operations take the writer lock:

```sh
npm run data:export
npm run data:rebuild
```

Both commands re-evaluate cached data without a key or network access and refresh browser exports. Export also writes normalized JSONL. Building or opening the app never starts collection.

The app reads `public/data/riot-pilot.json` and `public/data/riot-matchups.json`. Both use **schema version 4** and declare dataset, patches, the new-collection rank policy, retained count and original retained policies. Each matchup game includes its patch, collection phase and rank rule. “Saved games” counts unique records across raw responses and retained snapshots. Allowlists exclude API keys, player names, account IDs and raw responses. Vite denies access to `.env` and `data/riot/`. Private data, the key and generated browser exports are ignored by Git. Generated public exports enter production builds if present; never publish the private data directory or `.env`.

If Windows reports `EPERM` replacing a public export, stop the dev server, rerun export and restart the server. Raw data remains saved.

## Verification

`npm test` runs app and collector tests with synthetic fixtures, temporary databases and fake HTTP. Coverage includes exact patch acceptance, rank qualification, participant membership, zero participant-rank requests, deduplication, resume, read-only cache reuse, atomic migration, five-game limits, 10,000 distinct discovery players, patch-filtered baselines, scope safeguards, rate limits, retries and locks. A synthetic 10,000-match collection checks stopping and restart without refetching. Rebuild streams raw matches to limit memory use. Test data is never published.

## References

- [Riot Match-V5](https://developer.riotgames.com/apis#match-v5) and [League-V4](https://developer.riotgames.com/apis#league-v4).
- [Riot rate limits and key access](https://developer.riotgames.com/docs/portal).
- [Queue definitions](https://static.developer.riotgames.com/docs/lol/queues.json) and [Data Dragon versions](https://ddragon.leagueoflegends.com/api/versions.json).
- [Patch 26.19 notes](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-19-notes/), [patch 26.20 notes](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-20-notes/) and [patch schedule](https://support.riotgames.com/en-us/league-of-legends/gameplay/patch-schedule-league-of-legends).

import { resolve } from "node:path";
import { loadConfig, projectRoot } from "./config.mjs";
import { Store, acquireLock } from "./store.mjs";
import { RiotClient, CollectionStopped } from "./client.mjs";
import { assertScope, bindScope, collect, rebuild } from "./collector.mjs";
import {
  openCacheSource,
  prepareFromCache,
  retainAcceptedFromCache,
} from "./cache-source.mjs";
import { buildReport, publishReport, writeAtomic } from "./report.mjs";
import { publishMatchupDataset } from "./matchups.mjs";

const [command = "status", ...args] = process.argv.slice(2);
let store,
  cacheSource,
  release,
  config,
  publicPath,
  localPath,
  scopeVerified = false;
const controller = new AbortController();
const stop = () =>
  controller.abort(
    new CollectionStopped(
      "paused",
      "Collection stopped. Run the same command to resume.",
    ),
  );
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  if (!["collect", "status", "export", "rebuild", "prepare"].includes(command))
    throw new Error("Use collect, status, export, rebuild or prepare.");
  config = loadConfig(args);
  const directory = resolve(projectRoot, "data/riot", config.datasetId);
  publicPath = resolve(projectRoot, "public/data/riot-pilot.json");
  localPath = resolve(directory, "summary.json");
  if (command !== "status") release = acquireLock(directory);
  store = new Store(resolve(directory, "pilot.sqlite"));
  assertScope(store, config);
  scopeVerified = true;
  if (command !== "status") {
    bindScope(store, config);
    cacheSource = openCacheSource(config);
    prepareFromCache(store, config, cacheSource);
    retainAcceptedFromCache(store, config, cacheSource);
  }
  const publish = () => publishReport(store, config, publicPath, localPath);
  const publishMatchups = () =>
    publishMatchupDataset(
      store,
      config,
      resolve(projectRoot, "public/data/riot-matchups.json"),
    );
  const print = (report) =>
    console.log(
      `${report.status.code}: ${report.acceptedMatches}/${report.targetMatches} accepted; ${report.downloadedMatches} saved; ${report.rejectedMatches} excluded; ${report.apiRequests} API requests.\n${report.status.message}`,
    );
  if (command === "collect") {
    try {
      let lastLoggedRequest = -1;
      const client = new RiotClient({
        key: process.env.RIOT_API_KEY,
        config,
        state: store.get("http") ?? {},
        save: (state) => {
          store.set("http", state);
          if (
            state.totalRequests % 25 === 0 &&
            state.totalRequests !== lastLoggedRequest
          ) {
            lastLoggedRequest = state.totalRequests;
            console.log(
              `${state.totalRequests} API requests; ${store.count("candidates", "status='accepted'")}/${config.targetMatches} accepted.`,
            );
            publish();
          }
        },
        signal: controller.signal,
        log: console.log,
      });
      console.log(
        `Starting/resuming ${config.region} Solo/Duo, patches ${config.patches.map((p) => p.label).join(", ")}; target ${config.targetMatches}; player pool ${config.maxSeedPlayers}; up to ${config.matchesPerSeed} games per player.`,
      );
      await collect({
        store,
        config,
        client,
        cacheSource,
        signal: controller.signal,
        publish,
        log: console.log,
      });
    } catch (error) {
      if (!(error instanceof CollectionStopped) && !controller.signal.aborted)
        throw error;
      const stopped = controller.signal.aborted
        ? controller.signal.reason
        : error;
      store.set("status", {
        code: stopped.status ?? "error",
        message: stopped.message,
      });
      process.exitCode = stopped.status === "paused" ? 0 : 2;
    }
    const report = publish();
    if (report.status.code === "complete") publishMatchups();
    print(report);
  } else if (command === "status") {
    print(buildReport(store, config));
  } else {
    bindScope(store, config);
    rebuild(store, config);
    if (command === "export") {
      const path = resolve(directory, "matches.normalized.jsonl");
      const records = store.accepted();
      writeAtomic(
        path,
        records.map((row) => JSON.stringify(row)).join("\n") +
          (records.length ? "\n" : ""),
      );
      console.log(`Exported ${records.length} accepted matches to ${path}.`);
    }
    print(publish());
    publishMatchups();
  }
} catch (error) {
  // Never print HTTP headers, response bodies, request URLs, or arbitrary error stacks.
  console.error(
    error instanceof Error
      ? error.message.replace(/RGAPI-[A-Za-z0-9-]+/g, "[redacted]")
      : "Collector failed.",
  );
  if (store && scopeVerified && command === "collect") {
    store.set("status", {
      code: "error",
      message:
        "Collection stopped on an unexpected error. Check the local terminal; downloaded progress is saved.",
    });
    try {
      publishReport(store, config, publicPath, localPath);
    } catch {
      /* Preserve the original failure. */
    }
  }
  process.exitCode = 1;
} finally {
  cacheSource?.close();
  store?.close();
  release?.();
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}

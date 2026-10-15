import { setTimeout as delay } from "node:timers/promises";
export class CollectionStopped extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const routes = new Set(["euw1", "europe"]);
const parseWindows = (value) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.split(":").map(Number))
    .filter(
      ([count, seconds]) =>
        Number.isFinite(count) &&
        count > 0 &&
        Number.isFinite(seconds) &&
        seconds > 0,
    );
export function retryDelay(value, now) {
  if (
    value !== null &&
    value !== undefined &&
    /^\d+(\.\d+)?$/.test(value.trim())
  )
    return Number(value) * 1000;
  const date = Date.parse(value ?? "");
  return Number.isFinite(date) ? Math.max(0, date - now) : 120000;
}
export class RiotClient {
  constructor({
    key,
    config,
    state = {},
    save = () => {},
    fetcher = fetch,
    now = Date.now,
    sleep = delay,
    signal,
    log = () => {},
  }) {
    if (
      typeof key !== "string" ||
      !key.trim() ||
      key.includes("\n") ||
      key.includes("\r")
    )
      throw new CollectionStopped(
        "needs_key",
        "Add RIOT_API_KEY to the local .env file, then run the collector again.",
      );
    this.key = key.trim();
    this.config = config;
    this.fetcher = fetcher;
    this.now = now;
    this.sleep = sleep;
    this.signal = signal;
    this.save = save;
    this.log = log;
    this.state = { lastRequest: 0, gates: {}, totalRequests: 0, ...state };
    this.requests = 0;
  }
  checkpoint() {
    this.save(this.state);
  }
  async wait(ms) {
    if (ms > 2000)
      this.log(
        `Respecting Riot rate limits; waiting ${Math.ceil(ms / 1000)} seconds.`,
      );
    while (ms > 0) {
      this.signal?.throwIfAborted();
      const part = Math.min(ms, 1000);
      await this.sleep(part, undefined, { signal: this.signal });
      ms -= part;
    }
  }
  applyHeaders(response, host, method) {
    for (const [name, gate] of [
      ["App", host],
      ["Method", `${host}:${method}`],
    ]) {
      const limits = new Map(
        parseWindows(response.headers.get(`X-${name}-Rate-Limit`)).map(
          ([count, seconds]) => [seconds, count],
        ),
      );
      for (const [count, seconds] of parseWindows(
        response.headers.get(`X-${name}-Rate-Limit-Count`),
      )) {
        if (limits.has(seconds) && count >= limits.get(seconds))
          this.state.gates[gate] = Math.max(
            this.state.gates[gate] ?? 0,
            this.now() + seconds * 1000 + 250,
          );
      }
    }
  }
  async get(route, path, method) {
    if (
      !routes.has(route) ||
      !path.startsWith("/lol/") ||
      path.includes("api_key") ||
      path.includes("#")
    )
      throw new Error("Unsupported Riot API route.");
    const host = `${route}.api.riotgames.com`;
    for (let attempt = 0; attempt < 6; attempt++) {
      this.signal?.throwIfAborted();
      if (
        this.config.maxRequestsPerRun != null &&
        this.requests >= this.config.maxRequestsPerRun
      )
        throw new CollectionStopped(
          "request_limit",
          "This run reached its request budget. Progress is saved; run again to continue.",
        );
      const ready = Math.max(
        this.state.lastRequest + this.config.requestSpacingMs,
        this.state.gates[host] ?? 0,
        this.state.gates[`${host}:${method}`] ?? 0,
      );
      await this.wait(Math.max(0, ready - this.now()));
      this.signal?.throwIfAborted();
      this.state.lastRequest = this.now();
      this.state.totalRequests++;
      this.requests++;
      this.checkpoint();
      let response;
      try {
        response = await this.fetcher(`https://${host}${path}`, {
          headers: { "X-Riot-Token": this.key, Accept: "application/json" },
          redirect: "error",
          signal: this.signal
            ? AbortSignal.any([this.signal, AbortSignal.timeout(30000)])
            : AbortSignal.timeout(30000),
        });
      } catch {
        this.signal?.throwIfAborted();
        if (attempt === 5)
          throw new CollectionStopped(
            "error",
            "Riot could not be reached after retries. Progress is saved.",
          );
        await this.wait(2000 * 2 ** attempt);
        continue;
      }
      this.applyHeaders(response, host, method);
      if (response.status === 429) {
        this.state.gates[host] = Math.max(
          this.state.gates[host] ?? 0,
          this.now() +
            retryDelay(response.headers.get("Retry-After"), this.now()) +
            250,
        );
        this.checkpoint();
        await response.body?.cancel();
        if (attempt === 5)
          throw new CollectionStopped(
            "paused",
            "Riot continued rate-limiting this run. Retry later; the cooldown and progress are saved.",
          );
        continue;
      }
      this.checkpoint();
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new CollectionStopped(
          "needs_key",
          "Riot rejected the API key (401/403). Check access or renew the key in .env, then resume.",
        );
      }
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (response.status >= 500) {
        await response.body?.cancel();
        if (attempt === 5)
          throw new CollectionStopped(
            "error",
            "Riot returned repeated server errors. Progress is saved.",
          );
        await this.wait(2000 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new CollectionStopped(
          "error",
          `Riot returned HTTP ${response.status}; check the collector configuration. Progress is saved.`,
        );
      }
      try {
        return await response.json();
      } catch {
        throw new CollectionStopped(
          "error",
          "Riot returned an invalid JSON response. Progress is saved.",
        );
      }
    }
  }
}

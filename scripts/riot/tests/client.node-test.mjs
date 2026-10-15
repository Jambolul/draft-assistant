import { test } from "node:test";
import assert from "node:assert/strict";
import { RiotClient, retryDelay } from "../client.mjs";
import { config } from "./fixtures.mjs";
function harness(responses, options = {}) {
  let time = 1000000;
  const requests = [],
    sleeps = [];
  let saved;
  const client = new RiotClient({
    key: "fixture-secret",
    config,
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    save: (s) => {
      saved = structuredClone(s);
    },
    fetcher: async (url, init) => {
      requests.push({ url, init, time });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    ...options,
  });
  return { client, requests, sleeps, saved: () => saved, now: () => time };
}
const ok = () => new Response("[]", { status: 200 });
test("requests use only the Riot hosts, header authentication, no redirects and conservative pacing", async () => {
  const h = harness([ok(), ok()]);
  await h.client.get("europe", "/lol/match/v5/matches/EUW1_1", "detail");
  await h.client.get("euw1", "/lol/league/v4/entries/by-puuid/example", "rank");
  assert.equal(h.requests[0].init.headers["X-Riot-Token"], "fixture-secret");
  assert.equal(h.requests[0].init.redirect, "error");
  assert.equal(h.requests[0].url.includes("fixture-secret"), false);
  assert.ok(h.requests[1].time - h.requests[0].time >= 1300);
  await assert.rejects(
    h.client.get("other.example.com", "/lol/anything", "bad"),
  );
  assert.equal(JSON.stringify(h.saved()).includes("fixture-secret"), false);
});
test("429 obeys Retry-After and persists cooldown before retrying", async () => {
  const h = harness([
    new Response("{}", { status: 429, headers: { "Retry-After": "5" } }),
    ok(),
  ]);
  await h.client.get("europe", "/lol/match/v5/matches/EUW1_1", "detail");
  assert.ok(h.requests[1].time - h.requests[0].time >= 5250);
  assert.equal(h.saved().totalRequests, 2);
  assert.equal(
    retryDelay(
      "Mon, 05 Oct 2026 00:00:10 GMT",
      Date.parse("2026-10-05T00:00:00Z"),
    ),
    10000,
  );
  assert.equal(retryDelay(null, 0), 120000);
});
test("app/method response limits gate later calls and survive a restart", async () => {
  const h = harness([
    new Response("[]", {
      headers: {
        "X-App-Rate-Limit": "20:1,100:120",
        "X-App-Rate-Limit-Count": "1:1,100:120",
        "X-Method-Rate-Limit": "1:10",
        "X-Method-Rate-Limit-Count": "1:10",
      },
    }),
  ]);
  await h.client.get("europe", "/lol/match/v5/matches/EUW1_1", "detail");
  const resumed = harness([ok()], { state: h.saved() });
  await resumed.client.get("europe", "/lol/match/v5/matches/EUW1_2", "detail");
  assert.ok(resumed.requests[0].time >= h.requests[0].time + 120250);
});
test("auth errors stop immediately; missing keys, budgets, network and 5xx failures are bounded", async () => {
  assert.throws(
    () => new RiotClient({ key: "", config }),
    (e) => e.status === "needs_key",
  );
  for (const status of [401, 403]) {
    const h = harness([new Response("fixture-secret", { status })]);
    await assert.rejects(
      h.client.get("europe", "/lol/test", "test"),
      (e) => e.status === "needs_key" && !e.message.includes("fixture-secret"),
    );
    assert.equal(h.requests.length, 1);
  }
  const budget = harness([ok()], {
    config: { ...config, maxRequestsPerRun: 1 },
  });
  await budget.client.get("europe", "/lol/test", "test");
  await assert.rejects(
    budget.client.get("europe", "/lol/test", "test"),
    (e) => e.status === "request_limit",
  );
  const missing = harness([new Response("{}", { status: 404 })]);
  assert.equal(await missing.client.get("europe", "/lol/test", "test"), null);
  const retry = harness([
    new Error("fixture-secret"),
    new Response("{}", { status: 503 }),
    ok(),
  ]);
  await retry.client.get("europe", "/lol/test", "test");
  assert.equal(retry.requests.length, 3);
  const failures = harness(
    Array.from({ length: 6 }, () => new Response("{}", { status: 503 })),
  );
  await assert.rejects(
    failures.client.get("europe", "/lol/test", "test"),
    (e) => e.status === "error",
  );
  assert.equal(failures.requests.length, 6);
});
test("abort stops a cooldown without making another API request", async () => {
  const controller = new AbortController();
  const h = harness([ok()], {
    signal: controller.signal,
    state: { lastRequest: 999999, gates: {}, totalRequests: 0 },
    sleep: async () => controller.abort(new Error("stopped")),
  });
  await assert.rejects(h.client.get("europe", "/lol/test", "test"), /stopped/);
  assert.equal(h.requests.length, 0);
});

test("an uncapped run continues beyond the old 20000-request budget", async () => {
  const h = harness([ok(), ok()], {
    config: { ...config, maxRequestsPerRun: null },
    state: { totalRequests: 20000 },
  });
  h.client.requests = 20000;
  await h.client.get("europe", "/lol/test", "test");
  await h.client.get("europe", "/lol/test", "test");
  assert.equal(h.requests.length, 2);
  assert.equal(h.saved().totalRequests, 20002);
  assert.ok(h.requests[1].time - h.requests[0].time >= config.requestSpacingMs);
});

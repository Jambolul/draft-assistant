import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  openSync,
  writeFileSync,
  closeSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";

export function acquireLock(directory) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "collector.lock");
  function create() {
    const fd = openSync(path, "wx");
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    } finally {
      closeSync(fd);
    }
    return () => unlinkSync(path);
  }
  try {
    return create();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let pid;
    try {
      pid = JSON.parse(readFileSync(path, "utf8")).pid;
    } catch {
      throw new Error(
        "The collector lock is unreadable. Check that no collector is running before removing collector.lock.",
      );
    }
    if (!Number.isInteger(pid) || pid < 1)
      throw new Error("Invalid collector lock; check collector.lock manually.");
    try {
      process.kill(pid, 0);
    } catch (probe) {
      if (probe.code === "ESRCH") {
        unlinkSync(path);
        return create();
      }
    }
    throw new Error(
      "A collector is already running for this dataset. Use data:status to inspect it.",
    );
  }
}
export class Store {
  constructor(path) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pages (key TEXT PRIMARY KEY, body TEXT NOT NULL, observed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS seeds (puuid TEXT PRIMARY KEY, bucket TEXT NOT NULL, ordering INTEGER NOT NULL, visited INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS candidates (match_id TEXT PRIMARY KEY, source_puuid TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reason TEXT, normalized TEXT);
      CREATE TABLE IF NOT EXISTS matches (match_id TEXT PRIMARY KEY, body TEXT, fetched_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ranks (puuid TEXT PRIMARY KEY, body TEXT, observed_at TEXT NOT NULL, source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS histories (puuid TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS retained_matches (match_id TEXT PRIMARY KEY, source_dataset_id TEXT NOT NULL, normalized TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS candidate_status ON candidates(status);`);
  }
  transaction(fn) {
    // Savepoints let bulk cache preparation include atomic history writes.
    // SQLite resolves repeated savepoint names to the innermost active one.
    this.db.exec("SAVEPOINT store_write");
    try {
      const result = fn();
      this.db.exec("RELEASE store_write");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK TO store_write; RELEASE store_write");
      throw error;
    }
  }
  get(key) {
    const row = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return row ? JSON.parse(row.value) : null;
  }
  set(key, value) {
    this.db
      .prepare(
        "INSERT INTO meta VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, JSON.stringify(value));
  }
  cache(table, key) {
    const columns = {
      pages: "key",
      matches: "match_id",
      ranks: "puuid",
      histories: "puuid",
    };
    if (!columns[table]) throw new Error("Unknown cache table.");
    const row = this.db
      .prepare(`SELECT * FROM ${table} WHERE ${columns[table]}=?`)
      .get(key);
    return row
      ? { ...row, body: row.body === null ? null : JSON.parse(row.body) }
      : null;
  }
  savePage(key, body, time) {
    this.db
      .prepare("INSERT OR IGNORE INTO pages VALUES (?, ?, ?)")
      .run(key, JSON.stringify(body), time);
  }
  saveRank(puuid, body, time, source) {
    this.db
      .prepare("INSERT OR IGNORE INTO ranks VALUES (?, ?, ?, ?)")
      .run(puuid, body === null ? null : JSON.stringify(body), time, source);
  }
  saveMatch(id, body, time) {
    this.db
      .prepare("INSERT OR IGNORE INTO matches VALUES (?, ?, ?)")
      .run(id, body === null ? null : JSON.stringify(body), time);
  }
  addSeed(puuid, bucket, ordering) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO seeds (puuid, bucket, ordering) VALUES (?, ?, ?)",
      )
      .run(puuid, bucket, ordering);
  }
  nextSeed() {
    return this.db
      .prepare(
        "SELECT * FROM seeds WHERE visited=0 ORDER BY ordering, puuid LIMIT 1",
      )
      .get();
  }
  saveHistory(puuid, ids) {
    this.transaction(() => {
      this.db
        .prepare("INSERT OR IGNORE INTO histories VALUES (?, ?)")
        .run(puuid, JSON.stringify(ids));
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO candidates (match_id, source_puuid) VALUES (?, ?)",
      );
      for (const id of ids) insert.run(id, puuid);
      this.db.prepare("UPDATE seeds SET visited=1 WHERE puuid=?").run(puuid);
    });
  }
  nextCandidate() {
    return this.db
      .prepare(
        "SELECT * FROM candidates WHERE status='pending' ORDER BY rowid LIMIT 1",
      )
      .get();
  }
  decide(id, reason, normalized = null) {
    this.db
      .prepare(
        "UPDATE candidates SET status=?, reason=?, normalized=? WHERE match_id=?",
      )
      .run(
        reason === null ? "accepted" : "rejected",
        reason,
        normalized ? JSON.stringify(normalized) : null,
        id,
      );
  }
  count(table, where = "") {
    if (
      !["seeds", "candidates", "matches", "ranks", "histories"].includes(
        table,
      ) ||
      ![
        "",
        "status='accepted'",
        "status='rejected'",
        "status='pending'",
        "visited=1",
      ].includes(where)
    )
      throw new Error("Invalid count query.");
    return this.db
      .prepare(
        `SELECT count(*) AS n FROM ${table}${where ? " WHERE " + where : ""}`,
      )
      .get().n;
  }
  accepted() {
    return this.db
      .prepare(
        "SELECT normalized FROM candidates WHERE status='accepted' ORDER BY match_id",
      )
      .all()
      .map((row) => JSON.parse(row.normalized));
  }
  savedMatchCount() {
    return this.db
      .prepare(
        "SELECT count(*) AS n FROM (SELECT match_id FROM matches UNION SELECT match_id FROM retained_matches)",
      )
      .get().n;
  }
  *cachedMatches() {
    const rows = this.db
      .prepare(
        "SELECT m.match_id, m.body, m.fetched_at, c.source_puuid FROM matches m JOIN candidates c ON c.match_id=m.match_id WHERE NOT EXISTS (SELECT 1 FROM retained_matches r WHERE r.match_id=m.match_id)",
      )
      .iterate();
    for (const row of rows) {
      yield {
        ...row,
        body: row.body === null ? null : JSON.parse(row.body),
      };
    }
  }
  close() {
    this.db.close();
  }
}

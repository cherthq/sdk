import { Database } from 'bun:sqlite';

export interface BrowserGrant {
  sessionId: string;
  openingHash: string;
  cookieHash: string | null;
  expiresAt: number;
}
export interface BrowserChallenge {
  sessionId: string;
  mode: 'register' | 'authenticate';
  challenge: string;
  expiresAt: number;
}
/** Use a separate owner-only service database; no secrets or raw browser tokens are stored. */
export class SqliteBrowserStore {
  private readonly db: Database;
  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS browser_grants (
        session_id TEXT PRIMARY KEY, opening_hash TEXT NOT NULL,
        cookie_hash TEXT, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS browser_challenges (
        session_id TEXT PRIMARY KEY, mode TEXT NOT NULL,
        challenge TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS request_rates (
        key TEXT PRIMARY KEY, started_at INTEGER NOT NULL, count INTEGER NOT NULL);`);
  }
  close(): void { this.db.close(); }
  create(grant: BrowserGrant): void {
    this.db.query('INSERT INTO browser_grants VALUES(?,?,?,?)')
      .run(grant.sessionId, grant.openingHash, grant.cookieHash, grant.expiresAt);
  }
  get(sessionId: string): BrowserGrant | undefined {
    const row = this.db.query('SELECT * FROM browser_grants WHERE session_id=?').get(sessionId) as
      { session_id: string; opening_hash: string; cookie_hash: string | null; expires_at: number } | null;
    return row ? { sessionId: row.session_id, openingHash: row.opening_hash, cookieHash: row.cookie_hash, expiresAt: row.expires_at } : undefined;
  }
  exchange(sessionId: string, openingHash: string, cookieHash: string, now: number): boolean {
    return this.db.query(`UPDATE browser_grants SET cookie_hash=?,opening_hash=''
      WHERE session_id=? AND opening_hash=? AND cookie_hash IS NULL AND expires_at>?`)
      .run(cookieHash, sessionId, openingHash, now).changes === 1;
  }
  putChallenge(value: BrowserChallenge): void {
    this.db.query(`INSERT INTO browser_challenges VALUES(?,?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET mode=excluded.mode,challenge=excluded.challenge,expires_at=excluded.expires_at`)
      .run(value.sessionId, value.mode, value.challenge, value.expiresAt);
  }
  /** Consume before asynchronous signature verification, including failed verification. */
  takeChallenge(sessionId: string, mode: BrowserChallenge['mode'], now: number): BrowserChallenge | undefined {
    return this.db.transaction(() => {
      const row = this.db.query('SELECT * FROM browser_challenges WHERE session_id=?').get(sessionId) as
        { session_id: string; mode: BrowserChallenge['mode']; challenge: string; expires_at: number } | null;
      if (!row || row.mode !== mode) return undefined;
      this.db.query('DELETE FROM browser_challenges WHERE session_id=?').run(sessionId);
      return row.expires_at > now ? { sessionId, mode: row.mode, challenge: row.challenge, expiresAt: row.expires_at } : undefined;
    }).immediate();
  }
  revoke(sessionId: string): void {
    this.db.transaction(() => {
      this.db.query('DELETE FROM browser_grants WHERE session_id=?').run(sessionId);
      this.db.query('DELETE FROM browser_challenges WHERE session_id=?').run(sessionId);
    }).immediate();
  }
  allow(key: string, now: number, windowMs: number, limit: number): boolean {
    return this.db.transaction(() => {
      const row = this.db.query('SELECT started_at,count FROM request_rates WHERE key=?').get(key) as { started_at: number; count: number } | null;
      if (!row || now - row.started_at >= windowMs) {
        this.db.query(`INSERT INTO request_rates VALUES(?,?,1) ON CONFLICT(key)
          DO UPDATE SET started_at=excluded.started_at,count=1`).run(key, now);
        return true;
      }
      if (row.count >= limit) return false;
      this.db.query('UPDATE request_rates SET count=count+1 WHERE key=?').run(key);
      return true;
    }).immediate();
  }
}

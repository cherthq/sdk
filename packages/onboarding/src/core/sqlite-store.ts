import {Database} from 'bun:sqlite';
import {randomUUID} from 'node:crypto';
import type {OnboardingStore,Session,UserIdentity,PasskeyIdentity,Outbox} from './types';
/** Server-only Bun SQLite store. The caller owns path permissions, backups and key custody. */
export class SqliteOnboardingStore implements OnboardingStore {
 private db:Database;
 constructor(options:{path:string}){this.db=new Database(options.path,{create:true});this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS onboarding_users(id TEXT PRIMARY KEY,phone_hash TEXT NOT NULL UNIQUE,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS onboarding_sessions(id TEXT PRIMARY KEY,version INTEGER NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS onboarding_passkeys(credential_id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES onboarding_users(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS onboarding_events(id TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS onboarding_rates(key TEXT PRIMARY KEY,started_at INTEGER NOT NULL,count INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS onboarding_outbox(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES onboarding_sessions(id),status TEXT NOT NULL,available_at INTEGER NOT NULL,lease_until INTEGER NOT NULL,lease_token TEXT NOT NULL DEFAULT '',data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS onboarding_outbox_due ON onboarding_outbox(status,available_at);`);if(!(this.db.query('PRAGMA table_info(onboarding_outbox)').all() as {name:string}[]).some(column=>column.name==='lease_token'))this.db.exec("ALTER TABLE onboarding_outbox ADD COLUMN lease_token TEXT NOT NULL DEFAULT ''");}
 close(){this.db.close();}
 transaction<T>(fn:()=>T):T{return this.db.transaction(fn).immediate();}
 private read<T>(table:string,key:string,value:string):T|undefined{const row=this.db.query(`SELECT data FROM ${table} WHERE ${key}=?`).get(value) as {data:string}|null;return row?JSON.parse(row.data) as T:undefined;}
 getSession(id:string){return this.read<Session>('onboarding_sessions','id',id);}
 insertSession(s:Session){this.db.query('INSERT INTO onboarding_sessions(id,version,data)VALUES(?,?,?)').run(s.id,s.version,JSON.stringify(s));}
 saveSession(s:Session,expectedVersion:number){return this.db.query('UPDATE onboarding_sessions SET version=?,data=? WHERE id=? AND version=?').run(s.version,JSON.stringify(s),s.id,expectedVersion).changes===1;}
 getUser(hash:string){return this.read<UserIdentity>('onboarding_users','phone_hash',hash);}
 putUser(u:UserIdentity){this.db.query('INSERT INTO onboarding_users(id,phone_hash,data)VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(u.id,u.phoneHash,JSON.stringify(u));}
 getPasskey(id:string){return this.read<PasskeyIdentity>('onboarding_passkeys','credential_id',id);}
 getPasskeys(userId:string){return (this.db.query('SELECT data FROM onboarding_passkeys WHERE user_id=?').all(userId) as {data:string}[]).map(row=>JSON.parse(row.data) as PasskeyIdentity);}
 putPasskey(p:PasskeyIdentity){this.db.query('INSERT INTO onboarding_passkeys(credential_id,user_id,data)VALUES(?,?,?) ON CONFLICT(credential_id) DO UPDATE SET data=excluded.data WHERE onboarding_passkeys.user_id=excluded.user_id').run(p.credentialId,p.userId,JSON.stringify(p));}
 putEvent(id:string){return this.db.query('INSERT OR IGNORE INTO onboarding_events(id)VALUES(?)').run(id).changes===1;}
 consumeRate(key:string,now:number,window:number,limit:number){const row=this.db.query('SELECT started_at,count FROM onboarding_rates WHERE key=?').get(key) as {started_at:number;count:number}|null;if(!row||now-row.started_at>=window){this.db.query('INSERT INTO onboarding_rates(key,started_at,count)VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET started_at=excluded.started_at,count=1').run(key,now);return true;}if(row.count>=limit)return false;this.db.query('UPDATE onboarding_rates SET count=count+1 WHERE key=?').run(key);return true;}
 addOutbox(o:Outbox){this.db.query('INSERT OR IGNORE INTO onboarding_outbox(id,session_id,status,available_at,lease_until,data)VALUES(?,?,?,?,?,?)').run(o.id,o.sessionId,o.status,o.availableAt,o.leaseUntil,JSON.stringify(o));}
 dueOutbox(now:number,limit:number){return (this.db.query("SELECT data FROM onboarding_outbox WHERE (status='pending' AND available_at<=?) OR (status='processing' AND lease_until<=?) ORDER BY available_at LIMIT ?").all(now,now,limit) as {data:string}[]).map(r=>JSON.parse(r.data) as Outbox);}
 claimOutbox(id:string,now:number,until:number){const token=randomUUID();return this.db.query("UPDATE onboarding_outbox SET status='processing',lease_until=?,lease_token=? WHERE id=? AND ((status='pending' AND available_at<=?) OR (status='processing' AND lease_until<=?))").run(until,token,id,now,now).changes===1?token:undefined;}
 ownsOutboxLease(id:string,token:string){return Boolean(this.db.query("SELECT id FROM onboarding_outbox WHERE id=? AND status='processing' AND lease_token=?").get(id,token));}
 saveOutbox(o:Outbox,token?:string){return this.db.query('UPDATE onboarding_outbox SET status=?,available_at=?,lease_until=?,data=? WHERE id=?'+(token===undefined?'':" AND status='processing' AND lease_token=?")).run(o.status,o.availableAt,o.leaseUntil,JSON.stringify(o),o.id,...(token===undefined?[]:[token])).changes===1;}
 cancelOutbox(id:string){this.db.query("UPDATE onboarding_outbox SET status='cancelled' WHERE session_id=? AND status!='done'").run(id);}
}

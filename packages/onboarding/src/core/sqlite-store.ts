import {Database} from 'bun:sqlite';
import {randomUUID} from 'node:crypto';
import type {OnboardingStore,Session,UserIdentity,PasskeyIdentity,Outbox,PaymentRecovery} from './types';
/** Server-only Bun SQLite store. The caller owns path permissions, backups and key custody. */
export class SqliteOnboardingStore implements OnboardingStore {
 private db:Database;
 constructor(options:{path:string}){this.db=new Database(options.path,{create:true});this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS onboarding_users(id TEXT PRIMARY KEY,phone_hash TEXT NOT NULL UNIQUE,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS onboarding_sessions(id TEXT PRIMARY KEY,version INTEGER NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS onboarding_passkeys(credential_id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES onboarding_users(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS onboarding_events(id TEXT PRIMARY KEY,binding TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS onboarding_payment_recovery(checkout_id TEXT PRIMARY KEY,data TEXT NOT NULL,resolved_reference TEXT);
 CREATE TABLE IF NOT EXISTS onboarding_rates(key TEXT PRIMARY KEY,started_at INTEGER NOT NULL,count INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS onboarding_outbox(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES onboarding_sessions(id),status TEXT NOT NULL,available_at INTEGER NOT NULL,lease_until INTEGER NOT NULL,lease_token TEXT NOT NULL DEFAULT '',data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS onboarding_outbox_due ON onboarding_outbox(status,available_at);`);if(!(this.db.query('PRAGMA table_info(onboarding_outbox)').all() as {name:string}[]).some(column=>column.name==='lease_token'))this.db.exec("ALTER TABLE onboarding_outbox ADD COLUMN lease_token TEXT NOT NULL DEFAULT ''");if(!(this.db.query('PRAGMA table_info(onboarding_events)').all() as {name:string}[]).some(column=>column.name==='binding'))this.db.exec("ALTER TABLE onboarding_events ADD COLUMN binding TEXT NOT NULL DEFAULT ''");}
 close(){this.db.close();}
 transaction<T>(fn:()=>T):T{return this.db.transaction(fn).immediate();}
 private read<T>(table:string,key:string,value:string):T|undefined{const row=this.db.query(`SELECT data FROM ${table} WHERE ${key}=?`).get(value) as {data:string}|null;return row?JSON.parse(row.data) as T:undefined;}
 recordPaymentRecovery(value:PaymentRecovery){const existing=this.db.query('SELECT data FROM onboarding_payment_recovery WHERE checkout_id=?').get(value.checkoutId) as {data:string}|null;const previous=existing?JSON.parse(existing.data) as PaymentRecovery:undefined;if(previous&&(previous.sessionId!==value.sessionId||previous.userId!==value.userId||previous.plan!==value.plan))throw new Error('payment_recovery_binding_mismatch');const merged=previous?{...previous,...(value.projectId?{projectId:value.projectId}:{}),...(value.allocationId?{allocationId:value.allocationId}:{})}:value;this.db.query('INSERT INTO onboarding_payment_recovery(checkout_id,data)VALUES(?,?) ON CONFLICT(checkout_id) DO UPDATE SET data=excluded.data').run(value.checkoutId,JSON.stringify(merged));}
 pendingPaymentRecoveries(){return (this.db.query('SELECT data FROM onboarding_payment_recovery WHERE resolved_reference IS NULL ORDER BY checkout_id').all() as {data:string}[]).map(row=>JSON.parse(row.data) as PaymentRecovery);}
 resolvePaymentRecovery(checkoutId:string,reference:string){if(!reference.trim()||reference.length>500)throw new Error('invalid_recovery_reference');return this.db.query('UPDATE onboarding_payment_recovery SET resolved_reference=? WHERE checkout_id=? AND resolved_reference IS NULL').run(reference,checkoutId).changes===1;}
 expiredSessions(now:number,limit:number){const bounded=Number.isFinite(limit)?Math.min(1000,Math.max(1,Math.floor(limit))):100;return (this.db.query("SELECT data FROM onboarding_sessions WHERE json_extract(data,'$.expiresAt')<=? AND json_extract(data,'$.state') NOT IN ('claimed','cancelled','expired','failed') ORDER BY json_extract(data,'$.expiresAt') LIMIT ?").all(now,bounded) as {data:string}[]).map(row=>JSON.parse(row.data) as Session);}
 getSession(id:string){return this.read<Session>('onboarding_sessions','id',id);}
 insertSession(s:Session){this.db.query('INSERT INTO onboarding_sessions(id,version,data)VALUES(?,?,?)').run(s.id,s.version,JSON.stringify(s));}
 saveSession(s:Session,expectedVersion:number){return this.db.query('UPDATE onboarding_sessions SET version=?,data=? WHERE id=? AND version=?').run(s.version,JSON.stringify(s),s.id,expectedVersion).changes===1;}
 getUser(hash:string){return this.read<UserIdentity>('onboarding_users','phone_hash',hash);}
 putUser(u:UserIdentity){this.db.query('INSERT INTO onboarding_users(id,phone_hash,data)VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(u.id,u.phoneHash,JSON.stringify(u));}
 getPasskey(id:string){return this.read<PasskeyIdentity>('onboarding_passkeys','credential_id',id);}
 getPasskeys(userId:string){return (this.db.query('SELECT data FROM onboarding_passkeys WHERE user_id=?').all(userId) as {data:string}[]).map(row=>JSON.parse(row.data) as PasskeyIdentity);}
 putPasskey(p:PasskeyIdentity){this.db.query('INSERT INTO onboarding_passkeys(credential_id,user_id,data)VALUES(?,?,?) ON CONFLICT(credential_id) DO UPDATE SET data=excluded.data WHERE onboarding_passkeys.user_id=excluded.user_id').run(p.credentialId,p.userId,JSON.stringify(p));}
 putEvent(id:string,binding=''){return this.db.query('INSERT OR IGNORE INTO onboarding_events(id,binding)VALUES(?,?)').run(id,binding).changes===1;}
 getEventBinding(id:string){return (this.db.query('SELECT binding FROM onboarding_events WHERE id=?').get(id) as {binding:string}|null)?.binding;}
 consumeRate(key:string,now:number,window:number,limit:number){const row=this.db.query('SELECT started_at,count FROM onboarding_rates WHERE key=?').get(key) as {started_at:number;count:number}|null;if(!row||now-row.started_at>=window){this.db.query('INSERT INTO onboarding_rates(key,started_at,count)VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET started_at=excluded.started_at,count=1').run(key,now);return true;}if(row.count>=limit)return false;this.db.query('UPDATE onboarding_rates SET count=count+1 WHERE key=?').run(key);return true;}
 addOutbox(o:Outbox){this.db.query('INSERT OR IGNORE INTO onboarding_outbox(id,session_id,status,available_at,lease_until,data)VALUES(?,?,?,?,?,?)').run(o.id,o.sessionId,o.status,o.availableAt,o.leaseUntil,JSON.stringify(o));}
 dueOutbox(now:number,limit:number){return (this.db.query("SELECT data FROM onboarding_outbox WHERE (status='pending' AND available_at<=?) OR (status='processing' AND lease_until<=?) ORDER BY available_at LIMIT ?").all(now,now,limit) as {data:string}[]).map(r=>JSON.parse(r.data) as Outbox);}
 claimOutbox(id:string,now:number,until:number){const token=randomUUID();return this.db.query("UPDATE onboarding_outbox SET status='processing',lease_until=?,lease_token=? WHERE id=? AND ((status='pending' AND available_at<=?) OR (status='processing' AND lease_until<=?))").run(until,token,id,now,now).changes===1?token:undefined;}
 ownsOutboxLease(id:string,token:string){return Boolean(this.db.query("SELECT id FROM onboarding_outbox WHERE id=? AND status='processing' AND lease_token=?").get(id,token));}
 saveOutbox(o:Outbox,token?:string){return this.db.query('UPDATE onboarding_outbox SET status=?,available_at=?,lease_until=?,data=? WHERE id=?'+(token===undefined?'':" AND status='processing' AND lease_token=?")).run(o.status,o.availableAt,o.leaseUntil,JSON.stringify(o),o.id,...(token===undefined?[]:[token])).changes===1;}
 cancelOutbox(id:string){this.db.query("UPDATE onboarding_outbox SET status='cancelled' WHERE session_id=? AND status!='done'").run(id);}
}

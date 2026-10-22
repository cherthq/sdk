import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';

// Test authenticator emits real COSE keys and signed assertions; no browser approval is simulated in production code.
function cbor(value: unknown): Buffer {
  const head = (major: number, n: number) => n < 24 ? Buffer.from([major << 5 | n]) : n < 256 ? Buffer.from([major << 5 | 24, n]) : Buffer.from([major << 5 | 25, n >> 8, n & 255]);
  if (typeof value === 'number') return head(value >= 0 ? 0 : 1, value >= 0 ? value : -1 - value);
  if (typeof value === 'string') { const b = Buffer.from(value); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  throw new Error('Unsupported test CBOR');
}
export function authenticator() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(32), id = credentialId.toString('base64url');
  const key = cbor(new Map<unknown, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]));
  return {
    register(challenge: string, origin: string, rpId = 'localhost', uv = true): RegistrationResponseJSON {
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
      const length = Buffer.alloc(2); length.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([createHash('sha256').update(rpId).digest(), Buffer.from([0x41 | (uv ? 4 : 0)]), Buffer.alloc(4), Buffer.alloc(16), length, credentialId, key]);
      return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: clientData.toString('base64url'), attestationObject: cbor(new Map<unknown, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]])).toString('base64url'), transports: ['internal'] } };
    },
    authenticate(challenge: string, origin: string, userId: string): AuthenticationResponseJSON {
      const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
      const counter = Buffer.alloc(4); counter.writeUInt32BE(1);
      const authData = Buffer.concat([createHash('sha256').update('localhost').digest(), Buffer.from([5]), counter]);
      const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(clientData).digest()]), pair.privateKey);
      return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: clientData.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: signature.toString('base64url'), userHandle: Buffer.from(userId).toString('base64url') } };
    },
  };
}

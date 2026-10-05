// Neru Remote framing: base64url(nonce24 || XChaCha20-Poly1305 ciphertext), no AAD.
// Same layout as the desktop's remote.rs; a frame sealed with another key fails to open.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

export function toBase64Url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
  return Uint8Array.from(s, ch => ch.charCodeAt(0));
}

export function seal(key: Uint8Array, nonce: Uint8Array, json: string) {
  const sealed = xchacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(json));
  const frame = new Uint8Array(24 + sealed.length);
  frame.set(nonce);
  frame.set(sealed, 24);
  return toBase64Url(frame);
}

/** Throws when the frame was not sealed with `key`. */
export function open(key: Uint8Array, frame: string) {
  const bytes = fromBase64Url(frame);
  return new TextDecoder().decode(xchacha20poly1305(key, bytes.subarray(0, 24)).decrypt(bytes.subarray(24)));
}

export type Pairing = { hosts: string[]; port: number; key: Uint8Array; name: string; endpoint?: string };

export function connectionUrls(p: Pairing): string[] {
  return [...(p.endpoint ? [p.endpoint] : []), ...p.hosts.map(h => `ws://${h}:${p.port}`)];
}

/** Parses `neru://pair?v=1&h=<ips>&p=<port>&k=<base64url key>&n=<name>`. */
export function parsePairing(text: string): Pairing {
  const m = text.trim().match(/^neru:\/\/pair\?(.*)$/);
  if (!m) throw new Error('This is not a Neru pairing code.');
  const q = Object.fromEntries(m[1].split('&').map(kv => { const i = kv.indexOf('='); return [decodeURIComponent(kv.slice(0, i)), decodeURIComponent(kv.slice(i + 1))]; }));
  const key = fromBase64Url(q.k ?? '');
  const port = Number(q.p);
  const hosts = (q.h ?? '').split(',').filter(Boolean);
  if (q.v !== '1' || key.length !== 32 || !Number.isInteger(port) || port < 1 || port > 65535 || (!hosts.length && !q.u)) throw new Error('This pairing code is incomplete or from a different Neru version.');
  if (hosts.some(h => !/^[a-z0-9.-]+$/i.test(h))) throw new Error('This pairing code has an invalid desktop address.');
  if (q.u) {
    const url = new URL(q.u);
    if (url.protocol !== 'wss:' || !url.hostname || url.username || url.password || url.hash) throw new Error('Internet pairing requires a secure WebSocket address.');
  }
  return { hosts, port, key, name: q.n || 'Desktop', endpoint: q.u || undefined };
}

// Signing in to a hosted MCP server from the phone: the server names its authorization server (RFC 9728), Neru
// registers itself there (RFC 7591) with the neru://mcp-auth redirect, and the user signs in in an in-app browser
// with PKCE. Tokens live in secure storage and refresh on their own.
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { t } from '@/i18n';

export const REDIRECT = 'neru://mcp-auth';

export type Token = { access: string; refresh?: string; expiresAt?: number; clientId: string; clientSecret?: string; tokenEndpoint: string; resource: string };

const base64url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const form = (fields: Record<string, string | undefined>) =>
  Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`).join('&');
// React Native's URL has no searchParams, so read the redirect's query by hand.
const query = (url: string) => Object.fromEntries((url.split('?')[1] ?? '').split('#')[0].split('&').filter(Boolean).map(p => p.split('=').map(s => decodeURIComponent(s.replace(/\+/g, ' '))) as [string, string]));
const split = (url: string) => {
  const m = /^(https?:\/\/[^/?#]+)([^?#]*)/.exec(url);
  return { origin: m?.[1] ?? url, path: (m?.[2] ?? '').replace(/\/$/, '') };
};

async function json(url: string) {
  const res = await fetch(url, { headers: { accept: 'application/json' } }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

/** The authorization server for a resource: from the 401's resource_metadata hint, or the well-known paths. */
async function discover(resource: string, wwwAuthenticate: string | null) {
  const { origin, path } = split(resource);
  const hint = wwwAuthenticate?.match(/resource_metadata="([^"]+)"/)?.[1];
  const prm = (hint && (await json(hint))) || (await json(`${origin}/.well-known/oauth-protected-resource${path}`)) || (await json(`${origin}/.well-known/oauth-protected-resource`));
  const issuer = (prm?.authorization_servers as string[] | undefined)?.[0] ?? origin;
  const at = split(issuer);
  const candidates = [
    `${at.origin}/.well-known/oauth-authorization-server${at.path}`,
    `${at.origin}/.well-known/openid-configuration${at.path}`,
    `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
    `${at.origin}/.well-known/oauth-authorization-server`,
  ];
  for (const url of candidates) {
    const meta = await json(url);
    if (meta?.authorization_endpoint && meta?.token_endpoint) {
      return { authorize: String(meta.authorization_endpoint), token: String(meta.token_endpoint), register: meta.registration_endpoint ? String(meta.registration_endpoint) : null, resource: (prm?.resource as string | undefined) ?? resource };
    }
  }
  throw new Error(t('This connector does not say where to sign in.'));
}

// Tokens can be longer than one secure-storage entry holds, so long ones are split.
const CHUNK = 1800;
async function save(key: string, value: string | null) {
  const old = Number((await SecureStore.getItemAsync(`${key}.n`)) ?? 0);
  for (let i = 0; i < old; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
  if (value === null) return SecureStore.deleteItemAsync(`${key}.n`);
  const parts = Math.ceil(value.length / CHUNK);
  for (let i = 0; i < parts; i++) await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
  await SecureStore.setItemAsync(`${key}.n`, String(parts));
}
async function load(key: string) {
  const n = Number((await SecureStore.getItemAsync(`${key}.n`)) ?? 0);
  if (!n) return null;
  let out = '';
  for (let i = 0; i < n; i++) out += (await SecureStore.getItemAsync(`${key}.${i}`)) ?? '';
  return out;
}
const keyFor = (id: string) => `mcp.token.${id.replace(/[^\w.-]/g, '_')}`;

export const loadToken = async (id: string): Promise<Token | null> => JSON.parse((await load(keyFor(id))) ?? 'null');
export const storeToken = (id: string, token: Token | null) => save(keyFor(id), token ? JSON.stringify(token) : null);

/** A pasted access token (GitHub, say), kept like a signed-in one but never refreshed. */
export const storeBearer = (id: string, url: string, access: string) => storeToken(id, { access, clientId: '', tokenEndpoint: '', resource: url });

function tokenFrom(body: Record<string, unknown>, base: Omit<Token, 'access'>, previous?: Token): Token {
  if (!body.access_token) throw new Error(String(body.error_description ?? body.error ?? t('Sign-in did not return a token.')));
  return {
    ...base,
    access: String(body.access_token),
    refresh: body.refresh_token ? String(body.refresh_token) : previous?.refresh,
    expiresAt: body.expires_in ? Date.now() + Number(body.expires_in) * 1000 - 60_000 : undefined,
  };
}

/** A fresh access token, refreshing an expired one. Null when there is none or it cannot be refreshed. */
export async function accessToken(id: string): Promise<string | null> {
  const token = await loadToken(id);
  if (!token) return null;
  if (!token.expiresAt || token.expiresAt > Date.now()) return token.access;
  if (!token.refresh || !token.tokenEndpoint) return null;
  const res = await fetch(token.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form({ grant_type: 'refresh_token', refresh_token: token.refresh, client_id: token.clientId, client_secret: token.clientSecret, resource: token.tokenEndpoint.includes('googleapis.com') ? undefined : token.resource }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const next = tokenFrom((await res.json().catch(() => ({}))) as Record<string, unknown>, token, token);
  await storeToken(id, next);
  return next.access;
}

/** Signs in to the connector at `url` in an in-app browser and keeps the token. */
export async function signIn(id: string, url: string, wwwAuthenticate: string | null) {
  const server = await discover(url, wwwAuthenticate);
  if (!server.register) throw new Error(t('This connector only lets known apps sign in, so Neru cannot sign in to it from the phone. Use it from your desktop while paired.'));
  const reg = await fetch(server.register, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_name: 'Neru', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
  });
  const client = (await reg.json().catch(() => ({}))) as { client_id?: string; client_secret?: string; error_description?: string; error?: string };
  if (!reg.ok || !client.client_id) {
    const why = client.error_description ?? client.error ?? `HTTP ${reg.status}`;
    throw new Error(/redirect/i.test(why) ? t('This connector does not accept sign-ins from phone apps yet. Use it from your desktop while paired.') : t('Could not register Neru with this connector: {error}', { error: why }));
  }
  const verifier = base64url(btoa(String.fromCharCode(...Crypto.getRandomBytes(32))));
  const challenge = base64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
  const state = Crypto.randomUUID();
  // The scope the server asked for in its 401, if any; otherwise its default (asking for every supported scope can fail).
  const scope = wwwAuthenticate?.match(/scope="([^"]+)"/)?.[1];
  const sep = server.authorize.includes('?') ? '&' : '?';
  const authUrl = `${server.authorize}${sep}${form({ response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, state, code_challenge: challenge, code_challenge_method: 'S256', resource: server.resource, scope })}`;
  const result = await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT);
  if (result.type !== 'success') throw new Error(t('Sign-in was cancelled.'));
  const back = query(result.url);
  if (back.state !== state) throw new Error(t('Sign-in could not be verified. Please try again.'));
  if (!back.code) throw new Error(back.error_description || back.error || t('The connector did not complete the sign-in.'));
  const res = await fetch(server.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form({ grant_type: 'authorization_code', code: back.code, redirect_uri: REDIRECT, client_id: client.client_id, client_secret: client.client_secret, code_verifier: verifier, resource: server.resource }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(body.error_description ?? body.error ?? t('Sign-in failed ({status}).', { status: res.status })));
  await storeToken(id, tokenFrom(body, { clientId: client.client_id, clientSecret: client.client_secret, tokenEndpoint: server.token, resource: server.resource }));
}

/**
 * Google's own MCP servers (Gmail, Calendar, Drive) sign in with Google, which does not register apps on the fly:
 * Neru uses the Google OAuth client ID from app.json (an iOS-type client, whose reversed ID is Neru's return link).
 */
export async function signInGoogle(id: string, clientId: string, scopes: string, resource: string) {
  if (!clientId) throw new Error(t('Google sign-in is not set up in this build. Add a Google OAuth client ID to app.json → extra.googleClientId, or use Gmail from your paired desktop.'));
  const redirect = `com.googleusercontent.apps.${clientId.replace(/\.apps\.googleusercontent\.com$/, '')}:/oauth2redirect`;
  const verifier = base64url(btoa(String.fromCharCode(...Crypto.getRandomBytes(32))));
  const challenge = base64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
  const state = Crypto.randomUUID();
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${form({ response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: scopes, state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' })}`;
  const result = await WebBrowser.openAuthSessionAsync(url, redirect);
  if (result.type !== 'success') throw new Error(t('Sign-in was cancelled.'));
  const back = query(result.url);
  if (back.state !== state) throw new Error(t('Sign-in could not be verified. Please try again.'));
  if (!back.code) throw new Error(back.error_description || back.error || t('Google did not complete the sign-in.'));
  const tokenEndpoint = 'https://oauth2.googleapis.com/token';
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form({ grant_type: 'authorization_code', code: back.code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(body.error_description ?? body.error ?? t('Sign-in failed ({status}).', { status: res.status })));
  await storeToken(id, tokenFrom(body, { clientId, tokenEndpoint, resource }));
}

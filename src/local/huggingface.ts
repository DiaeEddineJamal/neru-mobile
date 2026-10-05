// Sign in with Hugging Face, the way Google AI Edge Gallery does it: an in-app browser, PKCE (no client secret
// in the app), and the narrow `gated-repos` scope, which can only read public gated repos whose license the
// user accepted. The access token lives in secure storage and is only sent to huggingface.co.
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

const CLIENT_ID = (Constants.expoConfig?.extra?.huggingFaceClientId as string | undefined) ?? '';
const REDIRECT = 'neru://hf-auth';
const KEY = 'models.huggingface';

/** False until a Hugging Face OAuth app's client ID is set in app.json → extra.huggingFaceClientId. */
export const signInAvailable = CLIENT_ID.length > 0;

const base64url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const form = (fields: Record<string, string>) => Object.entries(fields).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
// React Native's URL has no searchParams, so read the redirect's query by hand.
const query = (url: string) => Object.fromEntries((url.split('?')[1] ?? '').split('#')[0].split('&').filter(Boolean).map(p => p.split('=').map(decodeURIComponent) as [string, string]));

export const savedToken = () => SecureStore.getItemAsync(KEY);
export const signOut = () => SecureStore.deleteItemAsync(KEY);

export async function signIn(): Promise<void> {
  if (!signInAvailable) throw new Error('Hugging Face sign-in is not set up in this build yet.');
  const verifier = base64url(btoa(String.fromCharCode(...Crypto.getRandomBytes(32))));
  const challenge = base64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
  const state = Crypto.randomUUID();
  const url = `https://huggingface.co/oauth/authorize?${form({ client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: 'openid profile gated-repos', state, code_challenge: challenge, code_challenge_method: 'S256' })}`;
  const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT);
  if (result.type !== 'success') throw new Error('Sign-in was cancelled.');
  const back = query(result.url);
  if (back.state !== state) throw new Error('Sign-in could not be verified. Please try again.');
  if (!back.code) throw new Error(back.error_description || 'Hugging Face did not complete the sign-in.');
  const res = await fetch('https://huggingface.co/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ grant_type: 'authorization_code', code: back.code, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: verifier }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(body.error_description || `Sign-in failed (${res.status}).`);
  await SecureStore.setItemAsync(KEY, body.access_token);
}

/** The signed-in Hugging Face username, or null when signed out or the session expired. */
export async function account(): Promise<string | null> {
  const token = await savedToken();
  if (!token) return null;
  const res = await fetch('https://huggingface.co/oauth/userinfo', { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res?.ok) return null;
  const me = (await res.json()) as { preferred_username?: string; name?: string };
  return me.preferred_username ?? me.name ?? 'Signed in';
}

/** Opens the model's page so its license can be accepted, and resolves when the browser closes. */
export const openLicense = (repo: string) => WebBrowser.openBrowserAsync(`https://huggingface.co/${repo}`);

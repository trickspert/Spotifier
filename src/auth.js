// Spotify login using the "Authorization Code with PKCE" flow.
// PKCE needs no client secret, so the whole app can run in the browser safely.
import { isNative, NATIVE_REDIRECT, openExternal } from './native.js';

const SCOPES = [
  'streaming', // Web Playback SDK (needs Premium)
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-top-read',
  'user-library-read',
  'user-library-modify', // the Save (heart) button
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

const KEY = {
  token: 'spotifier.token',
  verifier: 'spotifier.pkce_verifier',
  state: 'spotifier.pkce_state',
  client: 'spotifier.client_id',
  lastCode: 'spotifier.last_code',
};

export function getClientId() {
  return localStorage.getItem(KEY.client) || import.meta.env.VITE_SPOTIFY_CLIENT_ID || '';
}

export function setClientId(id) {
  localStorage.setItem(KEY.client, id.trim());
}

export function redirectUri() {
  if (isNative) return NATIVE_REDIRECT; // the Android app is opened through this deep link
  return import.meta.env.VITE_SPOTIFY_REDIRECT_URI || `${location.origin}/`;
}

/** True when the page is opened from an address Spotify will accept as a redirect. */
export function redirectLooksValid() {
  if (isNative) return true;
  const u = new URL(redirectUri());
  if (u.hostname === 'localhost') return false;
  return u.protocol === 'https:' || ['127.0.0.1', '[::1]'].includes(u.hostname);
}

function b64url(bytes) {
  let s = '';
  new Uint8Array(bytes).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len = 64) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return b64url(a);
}

async function sha256(text) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

export async function login() {
  const clientId = getClientId();
  if (!clientId) throw new Error('Add your Spotify Client ID first.');
  const verifier = randomString(64);
  const state = randomString(16);
  localStorage.setItem(KEY.verifier, verifier);
  localStorage.setItem(KEY.state, state);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: b64url(await sha256(verifier)),
    scope: SCOPES,
    state,
  });
  await openExternal(`https://accounts.spotify.com/authorize?${params}`);
}

function saveToken(json) {
  const prev = loadToken();
  const token = {
    access_token: json.access_token,
    // Spotify doesn't always send a new refresh token, so keep the old one.
    refresh_token: json.refresh_token || prev?.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
  };
  localStorage.setItem(KEY.token, JSON.stringify(token));
  return token;
}

function loadToken() {
  try {
    return JSON.parse(localStorage.getItem(KEY.token));
  } catch {
    return null;
  }
}

async function tokenRequest(body) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Token request failed (${res.status})`);
  return saveToken(json);
}

/**
 * Finishes the login when Spotify sends the user back with ?code=...
 * On the web that's this page's address; on Android it's the deep link.
 * Returns true if a login just completed.
 */
export async function handleCallback(href = location.href) {
  const fromPage = href === location.href;
  const p = new URL(href).searchParams;
  if (!p.has('code') && !p.has('error')) return false;
  // Android can hand us the same deep link twice (e.g. after a restart); a code only works once
  if (p.get('code') && p.get('code') === localStorage.getItem(KEY.lastCode)) return false;
  const clean = () => fromPage && history.replaceState(null, '', location.pathname + location.hash);
  if (p.has('error')) {
    clean();
    throw new Error(p.get('error') === 'access_denied' ? 'You cancelled the Spotify login.' : `Spotify said: ${p.get('error')}`);
  }
  const expected = localStorage.getItem(KEY.state);
  if (expected && p.get('state') !== expected) {
    clean();
    throw new Error('Login state did not match. Please try connecting again.');
  }
  localStorage.setItem(KEY.lastCode, p.get('code'));
  await tokenRequest({
    client_id: getClientId(),
    grant_type: 'authorization_code',
    code: p.get('code'),
    redirect_uri: redirectUri(),
    code_verifier: localStorage.getItem(KEY.verifier) || '',
  });
  localStorage.removeItem(KEY.verifier);
  localStorage.removeItem(KEY.state);
  clean();
  return true;
}

let refreshing = null;

/** Returns a valid access token, refreshing it if needed, or null if logged out. */
export async function getToken() {
  const t = loadToken();
  if (!t?.access_token) return null;
  if (Date.now() < t.expires_at - 60_000) return t.access_token;
  if (!t.refresh_token) return null;
  refreshing ||= tokenRequest({
    client_id: getClientId(),
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
  }).finally(() => (refreshing = null));
  try {
    return (await refreshing).access_token;
  } catch {
    logout();
    return null;
  }
}

export function isLoggedIn() {
  return !!loadToken()?.access_token;
}

export function logout() {
  localStorage.removeItem(KEY.token);
}

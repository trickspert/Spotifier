// Thin wrapper around the Spotify Web API.
import { getToken } from './auth.js';

const BASE = 'https://api.spotify.com/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(path, { method = 'GET', body, retry = true } = {}) {
  const token = await getToken();
  if (!token) {
    const e = new Error('Not connected to Spotify');
    e.status = 401;
    throw e;
  }
  const res = await fetch(path.startsWith('http') ? path : BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429 && retry) {
    await sleep((Number(res.headers.get('Retry-After')) || 1) * 1000);
    return api(path, { method, body, retry: false });
  }
  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* some player endpoints return plain text */
  }
  if (!res.ok) {
    const e = new Error(json?.error?.message || res.statusText || `Spotify error ${res.status}`);
    e.status = res.status;
    e.reason = json?.error?.reason;
    throw e;
  }
  return json;
}

const q = (o) => {
  const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return s.toString() ? `?${s}` : '';
};

export const Spotify = {
  me: () => api('/me'),
  playlists: () => api('/me/playlists?limit=50'),
  playlist: (id) => api(`/playlists/${id}`),
  // Spotify renamed /tracks to /items in Feb 2026. Try the new one first, fall back to the old one.
  playlistItems: async (id) => {
    try {
      return await api(`/playlists/${id}/items?limit=100`);
    } catch (e) {
      if ([400, 403, 404].includes(e.status)) return api(`/playlists/${id}/tracks?limit=100`);
      throw e;
    }
  },
  album: (id) => api(`/albums/${id}`),
  saved: () => api('/me/tracks?limit=50'),
  recent: () => api('/me/player/recently-played?limit=30'),
  top: () => api('/me/top/tracks?limit=20&time_range=short_term'),
  search: (text) => api(`/search${q({ q: text, type: 'track,album,playlist,artist', limit: 10 })}`),

  queue: () => api('/me/player/queue'),
  // Spotify merged the per-type save endpoints into /me/library in 2026; fall back to the old ones.
  isSaved: async (uri) => {
    try {
      return (await api(`/me/library/contains${q({ uris: uri })}`))?.[0];
    } catch (e) {
      if (![400, 403, 404].includes(e.status)) throw e;
      return (await api(`/me/tracks/contains${q({ ids: uri.split(':').pop() })}`))?.[0];
    }
  },
  setSaved: async (uri, on) => {
    const method = on ? 'PUT' : 'DELETE';
    try {
      return await api(`/me/library${q({ uris: uri })}`, { method });
    } catch (e) {
      if (![400, 403, 404].includes(e.status)) throw e;
      return api(`/me/tracks${q({ ids: uri.split(':').pop() })}`, { method });
    }
  },

  state: () => api('/me/player?additional_types=episode'),
  devices: () => api('/me/player/devices'),
  play: (body, device_id) => api(`/me/player/play${q({ device_id })}`, { method: 'PUT', body }),
  resume: (device_id) => api(`/me/player/play${q({ device_id })}`, { method: 'PUT' }),
  pause: (device_id) => api(`/me/player/pause${q({ device_id })}`, { method: 'PUT' }),
  next: () => api('/me/player/next', { method: 'POST' }),
  prev: () => api('/me/player/previous', { method: 'POST' }),
  seek: (ms) => api(`/me/player/seek${q({ position_ms: Math.round(ms) })}`, { method: 'PUT' }),
  volume: (pct) => api(`/me/player/volume${q({ volume_percent: Math.round(pct) })}`, { method: 'PUT' }),
  shuffle: (on) => api(`/me/player/shuffle${q({ state: on })}`, { method: 'PUT' }),
  repeat: (mode) => api(`/me/player/repeat${q({ state: mode })}`, { method: 'PUT' }),
  transfer: (id, play = false) => api('/me/player', { method: 'PUT', body: { device_ids: [id], play } }),
};

export function bestImage(images, prefer = 640) {
  if (!images?.length) return '';
  const sorted = [...images].sort((a, b) => (b.width || b.height || 0) - (a.width || a.height || 0));
  return (sorted.find((i) => (i.width || i.height || 0) <= prefer) || sorted[0]).url;
}

/** Turns any Spotify track/episode object (Web API or Playback SDK) into one simple shape. */
export function normTrack(t, albumFallback) {
  if (!t) return null;
  const album = t.album || albumFallback || {};
  return {
    id: t.id || t.uri,
    uri: t.uri,
    name: t.name || 'Unknown',
    artists: (t.artists || []).map((a) => a.name).join(', ') || t.show?.name || '',
    artistList: (t.artists || []).map((a) => a.name),
    album: album.name || t.show?.name || '',
    albumId: album.id || album.uri?.split(':').pop(),
    image: bestImage(album.images || t.images || t.show?.images),
    duration: t.duration_ms || t.duration || 0,
    explicit: !!t.explicit,
  };
}

/** Playlist entries are called "item" after the Feb 2026 rename and "track" before it. */
export const playlistEntryTrack = (entry) => entry?.item || entry?.track || null;

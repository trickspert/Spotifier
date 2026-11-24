// "About the artist": photo, genres and followers from Spotify (whatever Spotify still returns
// to apps), plus a short bio from Wikipedia's free summary API (shown with a credit link).
import { Spotify, bestImage } from './api.js';

const cache = new Map();
const MUSIC = /\b(singer|rapper|musician|band|group|songwriter|producer|dj|duo|trio|artist|composer|record|vocalist|hip[- ]hop|rock|pop|rap|music)\b/i;

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** Finds the Wikipedia page that's actually about this music artist (not a namesake). */
async function wikiSummary(name) {
  const q = new URLSearchParams({ action: 'query', list: 'search', srsearch: `${name} music`, srlimit: '5', format: 'json', origin: '*' });
  const hits = (await json(`https://en.wikipedia.org/w/api.php?${q}`))?.query?.search || [];
  const want = norm(name);
  for (const h of hits) {
    if (!norm(h.title).startsWith(want)) continue; // e.g. "Name", "Name (rapper)", "Name (band)"
    try {
      const s = await json(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(h.title.replace(/ /g, '_'))}`);
      if (s.type === 'disambiguation') continue;
      if (!MUSIC.test(`${s.description || ''} ${s.extract?.slice(0, 220) || ''}`)) continue;
      return { bio: s.extract, description: s.description, url: s.content_urls?.mobile?.page || s.content_urls?.desktop?.page, image: s.originalimage?.source || s.thumbnail?.source };
    } catch {
      /* try the next result */
    }
  }
  return null;
}

/**
 * @param {{id?:string, name:string}} artist
 * @param {{demo?:boolean, fallbackImage?:string}} opts
 */
export async function getArtistInfo(artist, { demo, fallbackImage } = {}) {
  const key = artist.id || artist.name;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    if (demo) {
      return {
        name: artist.name,
        image: fallbackImage,
        genres: ['Dream pop', 'Glass pop'],
        followers: null,
        bio: `${artist.name} is a made-up artist for Spotifier’s demo mode, so there’s no real bio yet. Connect your Spotify account and this space shows the photo, genres and story of whoever you’re listening to.`,
      };
    }
    let a = null;
    if (artist.id) a = await Spotify.artist(artist.id).catch(() => null);
    const name = a?.name || artist.name;
    const wiki = await wikiSummary(name).catch(() => null);
    return {
      id: artist.id,
      name,
      image: bestImage(a?.images, 640) || wiki?.image || fallbackImage,
      genres: a?.genres || [],
      followers: typeof a?.followers?.total === 'number' ? a.followers.total : null,
      bio: wiki?.bio || '',
      description: wiki?.description || '',
      wikiUrl: wiki?.url || '',
    };
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

export function clearArtistCache() {
  cache.clear();
}

export const compactNumber = (n) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

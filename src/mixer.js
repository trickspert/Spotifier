// Mix maker: turn a short description ("rainy day indie", "gym hype 2010s") into a playlist.
//
// Two engines:
//  - Smart (built in, no setup): reads moods, activities, genres and decades from the prompt,
//    searches Spotify for them, blends in artists you actually listen to, and spreads
//    artists out so the mix doesn't repeat itself.
//  - AI (optional): with your own Anthropic API key, Claude picks the songs (titles and
//    artists only) and each pick is matched on Spotify.
// The Anthropic SDK is loaded only when an AI mix is made, so it doesn't slow down app start.
const loadSdk = () => import('@anthropic-ai/sdk').then((m) => m.default);
import { Spotify, normTrack, api } from './api.js';

// ---------- smart engine ----------
const MOODS = [
  [/chill|relax|calm|mellow|lazy|sunday|cozy|cosy/, ['chill', 'mellow', 'acoustic chill', 'lofi']],
  [/sad|cry|heartbreak|breakup|lonely|melanchol|rain|rainy|blue/, ['sad songs', 'heartbreak', 'melancholy', 'rainy day']],
  [/gym|workout|run|running|hype|pump|energy|beast/, ['workout', 'hype', 'pump up', 'high energy']],
  [/party|dance|club|friday|turn up|pregame/, ['party', 'dance', 'club hits']],
  [/focus|study|work|code|coding|concentrat|read/, ['focus', 'study', 'instrumental', 'lofi beats']],
  [/sleep|night ?time|bed|dream/, ['sleep', 'ambient', 'calm piano']],
  [/drive|road ?trip|car|cruise|late night|night/, ['night drive', 'late night', 'road trip']],
  [/happy|good vibes|feel good|sunny|summer|beach/, ['feel good', 'summer', 'good vibes']],
  [/love|romantic|crush|date|valentine/, ['love songs', 'romantic', 'slow jams']],
  [/angry|rage|mad|aggressive/, ['rage', 'aggressive', 'hard']],
  [/throwback|nostalg|old school|classic/, ['throwback', 'classics']],
];
const GENRES = ['hip hop', 'rap', 'trap', 'drill', 'r&b', 'rnb', 'pop', 'indie', 'rock', 'alt', 'alternative', 'punk', 'emo', 'metal', 'edm', 'house', 'techno', 'jazz', 'soul', 'funk', 'country', 'latin', 'reggaeton', 'afrobeats', 'k-pop', 'kpop', 'lofi', 'lo-fi', 'phonk', 'hyperpop', 'shoegaze', 'grunge', 'folk', 'classical', 'gospel', 'disco', 'dubstep', 'dnb', 'drum and bass'];

function readPrompt(prompt) {
  const p = ` ${prompt.toLowerCase()} `;
  const terms = new Set();
  for (const [re, words] of MOODS) if (re.test(p)) words.forEach((w) => terms.add(w));
  const genres = GENRES.filter((g) => p.includes(` ${g} `) || p.includes(` ${g},`) || p.includes(` ${g}s `));
  let years = '';
  const dec = p.match(/\b(?:19|20)?([0-9])0'?s\b/); // 90s, 2010s, 80's
  if (dec) {
    const full = p.match(/\b(19[0-9]0|20[0-2]0)'?s\b/);
    const start = full ? Number(full[1]) : Number(dec[1]) >= 5 ? 1900 + Number(dec[1]) * 10 : 2000 + Number(dec[1]) * 10;
    years = `${start}-${start + 9}`;
  }
  // words we didn't recognise are still useful search terms ("phonk", an artist name, ...)
  const leftovers = prompt
    .replace(/\b(19|20)?[0-9]0'?s\b/gi, '')
    .replace(/\b(songs?|music|playlist|mix|vibes?|for|a|an|the|some|with|and|like|my|me|to|of|in|that|is|feel|feels)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { terms: [...terms], genres, years, leftovers };
}

async function searchTracks(q, limit = 10) {
  const r = await api(`/search?${new URLSearchParams({ q, type: 'track', limit: String(limit) })}`).catch(() => null);
  return (r?.tracks?.items || []).filter(Boolean).map((t) => normTrack(t));
}

/** Keeps the mix varied: no more than `perArtist` songs by the same main artist, no duplicates. */
function diversify(tracks, size, perArtist = 2) {
  const seen = new Set();
  const byArtist = new Map();
  const out = [];
  for (const t of tracks) {
    const key = `${t.name.toLowerCase().replace(/\s*[(-].*$/, '')}|${t.artistList?.[0]}`;
    if (!t.uri || seen.has(t.id) || seen.has(key)) continue;
    const a = t.artistList?.[0] || t.artists;
    if ((byArtist.get(a) || 0) >= perArtist) continue;
    seen.add(t.id);
    seen.add(key);
    byArtist.set(a, (byArtist.get(a) || 0) + 1);
    out.push(t);
    if (out.length >= size) break;
  }
  return out;
}

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

async function smartMix(prompt, size) {
  const { terms, genres, years, leftovers } = readPrompt(prompt);
  const yearQ = years ? ` year:${years}` : '';
  const queries = new Set();
  for (const g of genres.slice(0, 3)) queries.add(`genre:"${g.replace('rnb', 'r&b')}"${yearQ}`);
  for (const t of terms.slice(0, 5)) queries.add(`${t}${genres[0] ? ` ${genres[0]}` : ''}${yearQ}`);
  if (leftovers && leftovers.split(' ').length <= 6) queries.add(`${leftovers}${yearQ}`);
  if (!queries.size) queries.add(prompt);

  // personal touch: artists you actually play, searched with the same vibe
  const mine = await Spotify.top().catch(() => null);
  const myArtists = shuffle([...new Set((mine?.items || []).map((t) => t.artists?.[0]?.name).filter(Boolean))]).slice(0, 3);
  const vibe = terms[0] || genres[0] || '';
  for (const a of myArtists) queries.add(`artist:"${a}"${vibe ? ` ${vibe}` : ''}`);

  const results = await Promise.all([...queries].map((q) => searchTracks(q)));
  // interleave the result lists so every query contributes
  const pool = [];
  for (let i = 0; i < 10; i++) for (const list of results) if (list[i]) pool.push(list[i]);
  const tracks = diversify(pool, size);
  const title = prompt.trim().replace(/^./, (c) => c.toUpperCase()).slice(0, 60);
  return { title, tracks, engine: 'smart' };
}

// ---------- AI engine (Claude, with the user's own API key) ----------
const MIX_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    songs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, artist: { type: 'string' } },
        required: ['title', 'artist'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'songs'],
  additionalProperties: false,
};

async function aiMix(prompt, size, apiKey) {
  const Anthropic = await loadSdk();
  // The key belongs to the user and stays on their device; requests go straight to Anthropic.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const mine = await Spotify.top().catch(() => null);
  const taste = [...new Set((mine?.items || []).map((t) => `${t.artists?.[0]?.name}`).filter(Boolean))].slice(0, 12);
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: MIX_SCHEMA } },
    system:
      'You are a music curator building a playlist for a streaming app. Pick real, released songs that exist on Spotify and fit the request; ' +
      'favor a natural flow (energy that rises and settles) and variety (at most two songs per artist unless asked). ' +
      'Return only song titles and artist names, never lyrics. The title is a short, catchy playlist name.',
    messages: [
      {
        role: 'user',
        content: `Make a playlist of ${size} songs for: "${prompt}".${taste.length ? ` For taste, the listener often plays: ${taste.join(', ')}. Blend in a few of these artists only if they fit.` : ''}`,
      },
    ],
  });
  if (response.stop_reason === 'refusal') throw new Error('The AI declined this request. Try describing the vibe differently.');
  const text = response.content.find((b) => b.type === 'text')?.text || '';
  let plan;
  try {
    plan = JSON.parse(text);
  } catch {
    throw new Error('The AI sent back something unexpected. Try again.');
  }
  // find each suggestion on Spotify (a few at a time)
  const songs = (plan.songs || []).slice(0, size + 5);
  const found = [];
  for (let i = 0; i < songs.length; i += 5) {
    const batch = await Promise.all(
      songs.slice(i, i + 5).map(async (s) => (await searchTracks(`track:"${s.title}" artist:"${s.artist}"`, 1))[0] || (await searchTracks(`${s.title} ${s.artist}`, 1))[0]),
    );
    found.push(...batch.filter(Boolean));
  }
  return { title: plan.title || prompt, tracks: diversify(found, size, 3), engine: 'ai' };
}

/** Builds a mix. Uses Claude when an API key is saved, otherwise the built-in smart engine. */
export async function makeMix(prompt, { size = 25, apiKey = '', demo = false, demoTracks = [] } = {}) {
  if (demo) return { title: prompt ? prompt.replace(/^./, (c) => c.toUpperCase()) : 'Demo mix', tracks: shuffle([...demoTracks]).slice(0, size), engine: 'demo' };
  if (apiKey) {
    try {
      return await aiMix(prompt, size, apiKey);
    } catch (e) {
      const Anthropic = await loadSdk();
      if (e instanceof Anthropic.AuthenticationError) throw new Error('Your Anthropic API key was rejected. Check it in You → Mix maker.');
      if (e instanceof Anthropic.RateLimitError) throw new Error('The AI is busy right now (rate limited). Try again in a minute.');
      if (e instanceof Anthropic.APIError) throw new Error(`AI error ${e.status}: ${e.message}`);
      throw e;
    }
  }
  return smartMix(prompt, size);
}

/** Saves a mix as a private playlist in the user's Spotify library. */
export async function saveMix(title, tracks) {
  const pl = await api('/me/playlists', { method: 'POST', body: { name: title, description: 'Made with Spotifier', public: false } });
  const uris = tracks.map((t) => t.uri).filter((u) => u?.startsWith('spotify:track:'));
  for (let i = 0; i < uris.length; i += 100) await api(`/playlists/${pl.id}/items`, { method: 'POST', body: { uris: uris.slice(i, i + 100) } });
  return pl;
}

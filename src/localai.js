// Main-thread side of the on-device AI (see ai-worker.js).

export const LOCAL_MODEL = { name: 'Qwen 3 0.6B', by: 'Alibaba Qwen', license: 'Apache-2.0', size: '≈620 MB', id: 'onnx-community/Qwen3-0.6B-ONNX' };

let worker = null;
let readyKey = null;
let seq = 0;
const pending = new Map();
let onProgress = null;
let loading = null;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') onProgress?.(data.loaded, data.total);
    else if (data.type === 'ready') {
      readyKey = 'qwen3';
      loading?.resolve();
      loading = null;
    } else if (data.type === 'result') {
      pending.get(data.id)?.resolve(data.text);
      pending.delete(data.id);
    } else if (data.type === 'error') {
      const err = new Error(data.message);
      if (data.id && pending.has(data.id)) {
        pending.get(data.id).reject(err);
        pending.delete(data.id);
      } else {
        loading?.reject(err);
        loading = null;
      }
    }
  };
  return worker;
}

/** Downloads (first time) or loads (from the phone's cache) the model. */
export function loadModel(progress) {
  onProgress = progress;
  if (readyKey) return Promise.resolve();
  if (loading) return loading.promise;
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  loading = { promise, resolve, reject };
  getWorker().postMessage({ type: 'load' });
  return promise;
}

function ask(prompt) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: 'ask', id, prompt });
  });
}

// Words that carry no meaning in a search ("music that feels" finds nothing useful)
const FILLER = new Set(['music', 'songs', 'song', 'tracks', 'vibe', 'vibes', 'feel', 'feels', 'that', 'for', 'a', 'the', 'of', 'with', 'like', 'mood', 'moment', 'style', 'playlist']);

/** Turns a request into a few Spotify search phrases, written by the on-device model. */
export async function understand(prompt, progress) {
  await loadModel(progress);
  const text = await ask(prompt);
  const seen = new Set();
  return text
    .split(/\n+/)
    .map((l) => l.replace(/^[\s\-*•\d.)]+/, '').replace(/["“”]/g, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((l) => {
      const words = l.split(' ').filter((w) => w && !FILLER.has(w));
      const key = [...new Set(words)].sort().join(' ');
      if (words.length < 1 || l.length > 40 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

/** Is this model already saved on the phone? (transformers.js keeps files in Cache Storage) */
export async function isDownloaded() {
  try {
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    return keys.some((r) => r.url.includes(LOCAL_MODEL.id) && r.url.includes('.onnx'));
  } catch {
    return false;
  }
}

/** Deletes the downloaded model to free space. */
export async function deleteModels() {
  worker?.terminate();
  worker = null;
  readyKey = null;
  try {
    await caches.delete('transformers-cache');
  } catch {
    /* ignore */
  }
}

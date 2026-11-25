// On-device AI (runs in a background worker so the app never freezes).
// Qwen 3 0.6B (Apache-2.0) runs right on the phone via transformers.js: no account, no cost,
// nothing sent anywhere. It's downloaded once and then cached on the device.
// Its job: understand what you ask for and turn it into a few Spotify search phrases.
// (Tested: Gemma 3 270M and Qwen 2.5 0.5B weren't reliable enough for this; Qwen 3 0.6B is.)
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

const MODEL = { id: 'onnx-community/Qwen3-0.6B-ONNX', dtype: 'q8' };

let generator = null;

const SYSTEM =
  'You help find music on Spotify. For the request, write 4 short search phrases (2 to 4 words each) that would find songs ' +
  'matching its mood, genre and era. Use only words about the music; do not invent artist names. One phrase per line, nothing else.';

async function load() {
  if (generator) return;
  const files = new Map();
  generator = await pipeline('text-generation', MODEL.id, {
    dtype: MODEL.dtype,
    device: 'wasm',
    progress_callback: (p) => {
      if (p.status !== 'progress' || !p.total) return;
      files.set(p.file, [p.loaded, p.total]);
      let loaded = 0, total = 0;
      for (const [l, t] of files.values()) {
        loaded += l;
        total += t;
      }
      postMessage({ type: 'progress', loaded, total });
    },
  });
}

async function understand(request) {
  // thinking off: Qwen 3 answers straight away instead of reasoning out loud first
  const prompt = generator.tokenizer.apply_chat_template(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: request },
    ],
    { add_generation_prompt: true, tokenize: false, enable_thinking: false },
  );
  const out = await generator(prompt, { max_new_tokens: 60, do_sample: false, repetition_penalty: 1.1, return_full_text: false });
  return out[0].generated_text.replace(/<think>[\s\S]*?<\/think>/g, '');
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await load();
      postMessage({ type: 'ready' });
    } else if (data.type === 'ask') {
      await load();
      postMessage({ type: 'result', id: data.id, text: await understand(data.prompt) });
    }
  } catch (e) {
    postMessage({ type: 'error', id: data.id, message: String(e?.message || e) });
  }
};

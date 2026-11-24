// Demo mode: made-up artists and songs with original lyrics written for this app.
// It lets you explore the whole UI before connecting a Spotify account. No audio plays.

function cover(seed, [a, b, c]) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const bg = g.createLinearGradient(0, 0, 512, 512);
  bg.addColorStop(0, a);
  bg.addColorStop(0.55, b);
  bg.addColorStop(1, c);
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 512);
  g.filter = 'blur(28px)';
  for (let i = 0; i < 6; i++) {
    g.fillStyle = [a, b, c][i % 3];
    g.globalAlpha = 0.75;
    g.beginPath();
    g.arc(rnd() * 512, rnd() * 512, 70 + rnd() * 140, 0, Math.PI * 2);
    g.fill();
  }
  g.filter = 'none';
  // glassy bubbles
  for (let i = 0; i < 9; i++) {
    const x = rnd() * 512, y = rnd() * 512, r = 14 + rnd() * 70;
    const rg = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,.85)');
    rg.addColorStop(0.25, 'rgba(255,255,255,.18)');
    rg.addColorStop(0.85, 'rgba(255,255,255,.05)');
    rg.addColorStop(1, 'rgba(255,255,255,.55)');
    g.globalAlpha = 0.8;
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  return cv.toDataURL('image/jpeg', 0.9);
}

/** Lines are [seconds, text]. "♪" marks an instrumental break. */
const SONGS = [
  {
    name: 'Glass Ocean', artists: 'Lumen Vale', album: 'Refraction', seed: 11,
    colors: ['#3a1cff', '#00d9ff', '#ff5ccd'],
    lines: [
      [0, '♪'], [5, 'Underneath a sky of glass'], [9, 'every color learns to pass'],
      [13, 'through the window of your eyes'], [17, 'I can feel the tide arrive'],
      [21.5, 'Hold the light, don’t let it fall'], [25.5, 'we are bubbles after all'],
      [29.5, 'floating up and breaking free'], [33.5, 'into somewhere we can be'],
      [38, 'Glass ocean, pull me under'], [42, 'turn the silence into thunder'],
      [46, 'glass ocean, shining through'], [50, 'every wave is leading to you'],
      [55, '♪'], [60, 'Bend me into something new'], [64, 'a thousand shades of blue'],
      [68, 'glass ocean, pull me under'], [72.5, 'glass ocean, back to you'], [78, '♪'],
    ],
    duration: 84,
  },
  {
    name: 'Neon Halo', artists: 'The Prism Club', album: 'Afterlight', seed: 23,
    colors: ['#ff2bd6', '#7a2bff', '#00f0ff'],
    lines: [
      [0, '♪'], [4, 'City wakes up in violet'], [8, 'every street a little lit'],
      [12, 'you were dancing on the line'], [16, 'between the stars and the sign'],
      [20.5, 'Wear the night like a crown'], [24.5, 'we don’t ever slow it down'],
      [29, 'Neon halo, spin around me'], [33, 'all the colors that surround me'],
      [37, 'neon halo, burning bright'], [41, 'we’re the static in the light'],
      [46, '♪'], [51, 'Pink and cyan in the rain'], [55, 'running circles in the lane'],
      [59, 'neon halo, don’t you fade'], [63.5, 'we’re the brightest thing we made'], [69, '♪'],
    ],
    duration: 76,
  },
  {
    name: 'Bubble Gravity', artists: 'Mori & the Floaters', album: 'Soft Physics', seed: 37,
    colors: ['#ffb37a', '#ff6fae', '#a78bff'],
    lines: [
      [0, '♪'], [4.5, 'Light as air and twice as loud'], [8.5, 'we were laughing through the cloud'],
      [12.5, 'every word a little sphere'], [16.5, 'rising slowly, disappear'],
      [21, 'Nothing pulls us to the ground'], [25, 'when we’re spinning round and round'],
      [29.5, 'Bubble gravity, lift me higher'], [33.5, 'soap and sunlight, soft as fire'],
      [37.5, 'bubble gravity, never stop'], [41.5, 'float me up until we pop'],
      [46, '♪'], [50.5, 'Pop!'], [52, 'and then we start again'], [56, 'bubble gravity, my friend'], [61, '♪'],
    ],
    duration: 68,
  },
  {
    name: 'Afterglow Avenue', artists: 'Lumen Vale', album: 'Refraction', seed: 51,
    colors: ['#00c2a8', '#00e0ff', '#ffd36e'],
    lines: [
      [0, '♪'], [5, 'Headlights paint the evening gold'], [9, 'stories that we never told'],
      [13, 'windows down and hands up high'], [17, 'chasing every passing sky'],
      [22, 'Afterglow avenue'], [25.5, 'every light reminds me of you'],
      [29.5, 'afterglow avenue'], [33, 'take the long way, see it through'],
      [38, '♪'], [43, 'When the city falls asleep'], [47, 'we’ve got promises to keep'],
      [51, 'afterglow avenue'], [55, 'I’ll be waiting there for you'], [60, '♪'],
    ],
    duration: 66,
  },
];

let cache;
export function demoTracks() {
  if (cache) return cache;
  cache = SONGS.map((s, i) => ({
    id: `demo-${i}`,
    uri: `demo:track:${i}`,
    name: s.name,
    artists: s.artists,
    artistList: [s.artists],
    album: s.album,
    image: cover(s.seed, s.colors),
    duration: s.duration * 1000,
    demo: true,
    lyrics: s.lines.map(([t, text]) => ({ t: t * 1000, text })),
  }));
  return cache;
}

export function demoPlaylists() {
  const t = demoTracks();
  return [
    { id: 'demo-pl-1', name: 'Liquid Hours', owner: 'Spotifier', image: t[0].image, tracks: [t[0], t[1], t[2], t[3]], description: 'Glass, light and slow-motion bubbles.' },
    { id: 'demo-pl-2', name: 'Neon After Dark', owner: 'Spotifier', image: t[1].image, tracks: [t[1], t[3], t[0]], description: 'For midnight drives through glowing cities.' },
    { id: 'demo-pl-3', name: 'Soft Physics', owner: 'Spotifier', image: t[2].image, tracks: [t[2], t[0]], description: 'Weightless pop that floats away.' },
  ];
}

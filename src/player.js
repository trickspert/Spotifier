// Two players with the same interface:
//  - DemoPlayer: simulated playback for trying the UI without an account.
//  - SpotifyPlayer: real playback. Uses the Web Playback SDK (this browser becomes a
//    Spotify Connect device, Premium required) and can also remote-control your
//    phone/desktop app through the Web API.
import { getToken } from './auth.js';
import { Spotify, normTrack } from './api.js';
import { demoTracks } from './demo.js';
import { clamp, sleep } from './util.js';
import { isNative, openSpotifyApp } from './native.js';

class BasePlayer extends EventTarget {
  constructor() {
    super();
    this.state = { track: null, position: 0, duration: 0, paused: true, shuffle: false, repeat: 'off', volume: 0.7, device: '' };
    this._at = performance.now();
  }
  /** Current playback position in ms, interpolated between updates for smooth lyrics. */
  position() {
    const s = this.state;
    if (!s.track) return 0;
    if (s.paused) return s.position;
    return Math.min(s.duration || Infinity, s.position + (performance.now() - this._at));
  }
  set(patch) {
    if (!('position' in patch)) patch.position = this.position();
    Object.assign(this.state, patch);
    this._at = performance.now();
    this.dispatchEvent(new Event('change'));
  }
  error(message) {
    this.dispatchEvent(new CustomEvent('error', { detail: message }));
  }
}

export class DemoPlayer extends BasePlayer {
  constructor() {
    super();
    this.mode = 'demo';
    this.queue = [];
    this.index = 0;
    this.state.device = 'Demo mode';
    setInterval(() => this._tick(), 250);
  }
  play({ tracks, index = 0 }) {
    this.queue = tracks;
    this.index = index;
    this._load(true);
  }
  _load(autoplay) {
    const t = this.queue[this.index];
    this.set({ track: t, duration: t.duration, position: 0, paused: !autoplay });
  }
  toggle() {
    if (!this.state.track) return this.play({ tracks: demoTracks(), index: 0 });
    this.set({ paused: !this.state.paused });
  }
  next() {
    if (!this.queue.length) return;
    if (this.state.shuffle && this.queue.length > 1) {
      let i;
      do i = Math.floor(Math.random() * this.queue.length);
      while (i === this.index);
      this.index = i;
    } else this.index = (this.index + 1) % this.queue.length;
    this._load(true);
  }
  prev() {
    if (this.position() > 3000 || !this.queue.length) return this.seek(0);
    this.index = (this.index - 1 + this.queue.length) % this.queue.length;
    this._load(true);
  }
  seek(ms) {
    this.set({ position: clamp(ms, 0, this.state.duration) });
  }
  setVolume(v) {
    this.set({ volume: v });
  }
  setShuffle(on) {
    this.set({ shuffle: on });
  }
  setRepeat(mode) {
    this.set({ repeat: mode });
  }
  _tick() {
    const s = this.state;
    if (!s.track || s.paused || this.position() < s.duration) return;
    if (s.repeat === 'track') this.seek(0);
    else if (s.repeat === 'off' && !s.shuffle && this.index === this.queue.length - 1) this.set({ paused: true, position: s.duration });
    else this.next();
  }
}

export class SpotifyPlayer extends BasePlayer {
  constructor() {
    super();
    this.mode = 'spotify';
    this.deviceId = null; // our in-browser device
    this.sdk = null;
    this.sdkActive = false; // true when this browser is the device playing
    this.remote = null; // { id, name } when another device (phone, desktop app) is active
    this._volTimer = null;
    this.pending = null; // a play request waiting for the Spotify app to wake up (Android)
    // Spotify's in-browser player doesn't run inside phone apps, so on Android we remote-control
    // the Spotify app instead (Spotify Connect).
    if (!isNative) this._initSDK();
    this._pollLoop();
  }

  _initSDK() {
    window.onSpotifyWebPlaybackSDKReady = () => {
      const p = new window.Spotify.Player({
        name: 'Spotifier (liquid glass)',
        getOAuthToken: (cb) => getToken().then((t) => cb(t)),
        volume: this.state.volume,
      });
      p.addListener('ready', ({ device_id }) => {
        this.deviceId = device_id;
        this.dispatchEvent(new Event('ready'));
      });
      p.addListener('not_ready', () => (this.deviceId = null));
      p.addListener('player_state_changed', (s) => this._fromSDK(s));
      p.addListener('initialization_error', ({ message }) =>
        this.error(`This browser can't play Spotify directly (${message}). You can still control the Spotify app on your phone or computer.`));
      p.addListener('authentication_error', ({ message }) => this.error(`Spotify login problem: ${message}. Try disconnecting and connecting again.`));
      p.addListener('account_error', () => this.error('Playing in the browser needs Spotify Premium. Make sure you logged in with your Premium account.'));
      p.addListener('playback_error', ({ message }) => this.error(`Playback error: ${message}`));
      p.connect();
      this.sdk = p;
    };
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    document.head.append(s);
  }

  _fromSDK(s) {
    if (!s) {
      this.sdkActive = false;
      return;
    }
    this.sdkActive = true;
    this.remote = null;
    const t = s.track_window?.current_track;
    this.set({
      track: normTrack(t),
      duration: s.duration,
      position: s.position,
      paused: s.paused,
      shuffle: s.shuffle,
      repeat: ['off', 'context', 'track'][s.repeat_mode] || 'off',
      device: 'This browser',
    });
  }

  async refresh() {
    const r = await Spotify.state();
    if (!r || !r.device) {
      if (!this.sdkActive && this.state.track && !this.state.paused) this.set({ paused: true });
      this.remote = null;
      return;
    }
    const mine = r.device.id && r.device.id === this.deviceId;
    if (mine && this.sdkActive) return; // the SDK already gives us better data
    this.sdkActive = mine && this.sdkActive;
    this.remote = mine ? null : { id: r.device.id, name: r.device.name };
    // Spotify sometimes reports no song for a moment (between tracks, while buffering).
    // Keep showing the current one instead of flashing an empty player.
    const item = r.item ? normTrack(r.item) : this.state.track;
    const same = item && this.state.track && item.id === this.state.track.id;
    const s = this.state;
    const next = {
      track: same ? s.track : item,
      duration: r.item?.duration_ms || s.duration,
      paused: !r.is_playing,
      shuffle: !!r.shuffle_state,
      repeat: r.repeat_state || 'off',
      volume: r.device.volume_percent != null ? r.device.volume_percent / 100 : s.volume,
      device: mine ? 'This browser' : r.device.name,
    };
    // Skip updates that change nothing visible (small position drift is smoothed locally)
    const drift = Math.abs((r.progress_ms || 0) - this.position());
    if (same && drift < 1500 && Object.entries(next).every(([k, v]) => k === 'track' || s[k] === v)) return;
    this.set({
      ...next,
      position: r.progress_ms || 0,
    });
  }

  async _pollLoop() {
    for (;;) {
      try {
        if (!document.hidden) await this.refresh();
      } catch {
        /* network blip, try again next round */
      }
      await sleep(this.sdkActive ? 15000 : 3500);
    }
  }

  _target() {
    return this.remote ? undefined : this.deviceId || undefined;
  }

  async _do(fn) {
    try {
      await fn();
    } catch (e) {
      if (e.status === 404)
        this.error(isNative ? 'Spotify isn’t awake yet. Tap Device → Open Spotify, then come back.' : 'No active Spotify device. Wait a moment for the browser player to connect, or open Spotify on your phone or computer.');
      else if (e.status === 403) this.error('Spotify refused that action. Playback control requires Spotify Premium.');
      else this.error(e.message);
    }
    setTimeout(() => this.refresh().catch(() => {}), 600);
  }

  /** Start playback of a context (playlist/album) or a list of track URIs. */
  play({ contextUri, offsetUri, uris, offsetIndex }) {
    this.sdk?.activateElement?.();
    const body = {};
    if (contextUri) {
      body.context_uri = contextUri;
      if (offsetUri) body.offset = { uri: offsetUri };
    } else if (uris) {
      body.uris = uris;
      if (offsetIndex) body.offset = { position: offsetIndex };
    }
    return this._do(async () => {
      try {
        await Spotify.play(body, this._target());
      } catch (e) {
        if (e.status === 404 && isNative) return this._wakeSpotify(body);
        if (e.status !== 404 || !this.deviceId) throw e;
        await Spotify.transfer(this.deviceId);
        await sleep(500);
        await Spotify.play(body, this.deviceId);
      }
    });
  }

  /** Android: open the Spotify app so it registers as a device, then play when the user comes back. */
  _wakeSpotify(body) {
    this.pending = body;
    this.error('Opening Spotify so it can play. Come back to Spotifier and your song will start.');
    setTimeout(openSpotifyApp, 900);
  }

  /** Called when the Android app comes back to the foreground. */
  async onResume() {
    const body = this.pending;
    this.pending = null;
    if (body) {
      try {
        const { devices = [] } = (await Spotify.devices()) || {};
        const d = devices.find((x) => x.is_active) || devices.find((x) => x.type === 'Smartphone') || devices[0];
        if (d) await Spotify.play(body, d.id);
      } catch (e) {
        this.error(e.message);
      }
    }
    setTimeout(() => this.refresh().catch(() => {}), body ? 800 : 0);
  }

  /** Move playback from your phone/desktop to this browser. */
  playHere() {
    if (!this.deviceId) return this.error('The browser player is still connecting. Try again in a few seconds.');
    this.sdk?.activateElement?.();
    this.remote = null;
    return this._do(() => Spotify.transfer(this.deviceId, !this.state.paused));
  }

  toggle() {
    this.sdk?.activateElement?.();
    if (this.sdkActive) return this.sdk.togglePlay();
    if (!this.state.track) return this.error('Pick a song to start playing.');
    const wasPaused = this.state.paused;
    this.set({ paused: !wasPaused });
    return this._do(() => (wasPaused ? Spotify.resume(this._target()) : Spotify.pause()));
  }
  next() {
    return this.sdkActive ? this.sdk.nextTrack() : this._do(() => Spotify.next());
  }
  prev() {
    return this.sdkActive ? this.sdk.previousTrack() : this._do(() => Spotify.prev());
  }
  seek(ms) {
    this.set({ position: ms });
    return this.sdkActive ? this.sdk.seek(Math.round(ms)) : this._do(() => Spotify.seek(ms));
  }
  setVolume(v) {
    this.set({ volume: v });
    if (this.sdkActive) return this.sdk.setVolume(v);
    clearTimeout(this._volTimer);
    this._volTimer = setTimeout(() => this._do(() => Spotify.volume(v * 100)), 250);
  }
  setShuffle(on) {
    this.set({ shuffle: on });
    return this._do(() => Spotify.shuffle(on));
  }
  setRepeat(mode) {
    this.set({ repeat: mode });
    return this._do(() => Spotify.repeat(mode));
  }
}

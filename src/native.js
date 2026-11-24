// Android (Capacitor) helpers. On the web these do nothing or fall back to browser behavior.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export const isNative = Capacitor.isNativePlatform();

/** Spotify sends the user back to this address after login on Android. */
export const NATIVE_REDIRECT = 'com.spotifier.glass://callback';

/** Opens a page in the system browser on Android, or navigates there on the web. */
export async function openExternal(url) {
  if (isNative) await Browser.open({ url });
  else location.href = url;
}

export function closeBrowser() {
  if (isNative) Browser.close().catch(() => {});
}

/** Calls back with deep links like com.spotifier.glass://callback?code=… */
export async function onAppUrl(cb) {
  if (!isNative) return;
  App.addListener('appUrlOpen', ({ url }) => cb(url));
  const launch = await App.getLaunchUrl().catch(() => null);
  if (launch?.url) cb(launch.url);
}

export function onBackButton(cb) {
  if (isNative) App.addListener('backButton', cb);
}

export function onResume(cb) {
  if (isNative) App.addListener('resume', cb);
}

export function minimize() {
  if (isNative) App.minimizeApp().catch(() => {});
}

export function setStatusBar(mode) {
  if (!isNative) return;
  // Style.Dark = light icons (for dark backgrounds)
  StatusBar.setStyle({ style: mode === 'light' ? Style.Light : Style.Dark }).catch(() => {});
}

/** Wakes the Spotify app so it shows up as a device Spotifier can control. */
export function openSpotifyApp() {
  location.href = 'spotify:';
}

/** A light tap of vibration, like iOS buttons (Android app only). */
let hapticsOn = true;
export function setHaptics(on) {
  hapticsOn = on;
}
export function haptic(strength = 'Light') {
  if (isNative && hapticsOn) Haptics.impact({ style: ImpactStyle[strength] || ImpactStyle.Light }).catch(() => {});
}

// "Now playing" notification that keeps music running in the background (android/.../PlaybackPlugin.java)
const Playback = isNative ? registerPlugin('Playback') : null;
let shown = null;
/** Publishes the current song to Android: Now Bar, status bar chip, lock screen, quick settings. */
export function showNowPlaying({ title, artist, album = '', artUrl = '', playing, position = 0, duration = 0 }) {
  if (!Playback) return;
  // resend when the song or play state changes, or the position drifts (Android extrapolates in between)
  const key = `${title}|${artist}|${artUrl}|${playing}|${Math.round(position / 3000)}`;
  if (key === shown) return;
  shown = key;
  Playback.show({ title, artist, album, artUrl, playing, position: Math.round(position), duration: Math.round(duration) }).catch(() => {});
}
export function hideNowPlaying() {
  if (!Playback || shown === null) return;
  shown = null;
  Playback.hide().catch(() => {});
}
export function onNowPlayingAction(cb) {
  Playback?.addListener('action', ({ action, position }) => cb(action, position));
}

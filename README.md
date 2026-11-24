# Spotifier: a Liquid Glass music player

A Spotify player for **Android and the web**, designed in the style of iOS 26's Liquid Glass:

- **Round glass "bubble" buttons and pill bars** that really bend what's behind their edges (lens refraction), with bright rims and a soft squish when you press them
- **The album cover melts into the screen.** Now Playing shows the cover edge to edge, dissolving into a slowly swirling backdrop made from the cover itself. Tapping the cover morphs it into full-screen lyrics.
- **Lyric bubbles:** the line being sung becomes a glass bubble whose words shift through the album's colors (also *Karaoke* and *Glow* styles). Tap any line to jump there.
- **Clean, modern layout:** home with quick picks and big cards, a library, search, album and playlist pages, and a floating glass mini player and tab bar
- **Customize it** (the *You* tab): themes, dark/light mode, colors that follow the album art, refraction strength, frost, glass tint, roundness, motion, cursor light, optional floating soap bubbles, and title and lyric styles
- **Demo mode** with made-up songs, so you can try it before connecting

---

## 1. Create your Spotify app (once, about 2 minutes)

1. Go to **https://developer.spotify.com/dashboard** and log in with your **Spotify Premium** account. Accept the developer terms if asked.
2. Press **Create app**. Give it any name and description.
3. Under **Redirect URIs** add both of these, exactly, pressing **Add** after each:
   - `com.spotifier.glass://callback` (for the Android app)
   - `http://127.0.0.1:5173/` (for the computer version; use `127.0.0.1`, because Spotify no longer allows `localhost`)
4. Under **Which API/SDKs are you planning to use?** tick **Web API** and **Web Playback SDK**. Accept and **Save**.
5. Open your app's **Settings** and copy the **Client ID**. You'll paste it into Spotifier.

## 2a. Android

1. Copy `Spotifier.apk` to your phone and tap it. If Android asks, allow your browser or file manager to **install unknown apps**.
2. Open Spotifier and paste your **Client ID** into the Connect screen, then tap **Connect Spotify** and log in.
3. Press play. Spotifier tries to **play the music itself**, using Spotify's own player built into the app (Premium needed). Allow notifications when asked: a "now playing" notification keeps the music going when the screen is off, with play/pause and next buttons.
   - This is experimental. Spotify officially supports its built-in player on computers, so it may not work on every phone. If your phone can't, Spotifier says so and switches to controlling the **Spotify app** instead (keep it installed and logged in; if nothing plays, tap **Device → Open Spotify**).
   - You can choose either way in **You → Playback → Play inside Spotifier**.
   - While music plays inside Spotifier it shows up like any music app: in Samsung's **Now Bar** and the status bar chip, on the lock screen, and in the quick-settings media player. Skip, play/pause and scrub the song from any of them.

**Getting a fresh APK**
- Every push to GitHub builds one automatically: open the repo's **Actions** tab, pick the latest **Android APK** run, and download **Spotifier-apk**.
- Or build it yourself with Node.js 22, JDK 21 and the Android SDK (or Android Studio) installed: `npm install`, then `npm run android:apk`. The APK appears at `android/app/build/outputs/apk/debug/app-debug.apk`.

It's a debug-signed APK for personal use. If you build it on a different computer, uninstall the old one first, because Android only updates apps signed with the same key.

## 2b. Computer (web)

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm run dev
```

Open **http://127.0.0.1:5173**, paste your Client ID, and connect. On a computer the music can play right in the browser (Spotify's Web Playback SDK, Premium only), or Spotifier can control Spotify on your phone or desktop app.

## Tips

- **Lyrics light up word by word.** When a song's lyrics only have line timing, Spotifier estimates the song's tempo and lines the words up with the beat. If the words run early or late, open **⋯ → Lyrics timing** (or the clock button in full-screen lyrics) and nudge them. It's saved per song.
- **Swipe down** to close Now Playing or full-screen lyrics. **Swipe the mini player** left or right to skip, or up to open it.
- **Tap the cover** for full-screen lyrics. **Double-tap** it to like the song.
- **Sleep timer:** ⋯ → Sleep timer (15–60 minutes, or the end of the song).
- Full-screen lyrics keep your screen on, and the controls fade away until you touch the screen.
- In the **You** tab you can choose left-aligned or centered lyrics, the lyric style and size, and how strong the glass refraction is.

## If something goes wrong

| What you see | Fix |
| --- | --- |
| `INVALID_CLIENT: Invalid redirect URI` | The redirect in the dashboard must match exactly: `com.spotifier.glass://callback` for Android, `http://127.0.0.1:5173/` for the browser. |
| "User not registered in the Developer Dashboard" | In your Spotify app's dashboard, open **User Management** and add your Spotify account's name and email. |
| Android: "Spotify isn't awake yet" | Open the Spotify app once (or tap **Device → Open Spotify**), then come back to Spotifier and press play again. |
| Browser: no sound | Wait a few seconds for the browser player to connect, then tap **Device** and pick *Spotifier (liquid glass)*. Some Linux Chromium builds can't play protected audio. |
| A playlist shows no songs | Spotify only lets apps list songs in playlists *you own or collaborate on*. Press **Play** and it still plays. |
| No glass refraction | Edge refraction works in Chrome, Edge, Brave, Opera and the Android app. Firefox and Safari get frosted glass. |

## Good to know

- **Lyrics** are looked up while you listen from [LRCLIB](https://lrclib.net), a free, community-run lyrics library, because Spotify doesn't share its lyrics with other apps. Some songs won't have lyrics.
- **Privacy:** there's no server. Your login stays on your device, and Spotify's PKCE login means the app never sees your password.
- **Spotify's rules for personal apps:** new apps start in *Development Mode*, which needs Premium and allows up to 5 users you add under User Management.

## Keyboard shortcuts (computer)

`Space` play/pause · `←` `→` seek 5 s · `P` open/close Now Playing · `L` full-screen lyrics · `/` search · `Esc` close

## Project layout

```
index.html              page structure: pages, glass dock, Now Playing, full-screen lyrics
src/main.js             app logic: pages, routing, player, settings
src/styles.css          the Liquid Glass look
src/lens.js             real edge refraction for glass buttons and bars
src/fx.js               cover backdrop, melt filter, cursor light, tilt, optional soap bubbles
src/player.js           demo player + Spotify player (Web Playback SDK and remote control)
src/lyrics.js           lyrics lookup (LRCLIB) and the lyric-bubble view
src/auth.js, api.js     Spotify login (PKCE) and Web API calls
src/native.js           Android bits: login deep link, back button, status bar
src/theme.js, demo.js   themes and settings, demo songs (original, made up for this app)
android/                Android project (Capacitor)
scripts/android-assets.cjs   renders the app icon and splash screen
```

# Spotifier ✦ liquid glass music player

A Spotify player with a liquid-glass look: floating, refracting glass panels; soap bubbles you can pop;
lighting that follows your cursor; chrome titles; and lyrics that float as glass bubbles and change color as each line is sung.

- **Queue, Now Playing, Lyrics** as three floating glass panels side by side on a computer, or switched with a tab bar on a phone
- **Liquid glass refraction:** the panels bend the light behind them (Chrome, Edge, Brave, Arc and Opera; other browsers get frosted glass)
- **Album-reactive colors:** the background aurora (or the whole UI) takes its colors from the album art
- **Lyric bubbles:** synced lyrics with a liquid fill that sweeps through each line. You can switch to *Karaoke* (words fill as they're sung) or *Glow*. Click any line to jump to it.
- **Full-screen lyrics:** press the ⤢ button or the `L` key
- **Customize everything** (sliders icon, top right): six themes, dark/light mode, your own colors, refraction, frost, panel solidity, roundness, phone-style rims, tilt, motion, cursor light, bubble count, title style (Chrome / Bubbly / Serif), lyric style and size
- **Real playback** in the browser through the Spotify Web Playback SDK (Premium), or remote control of the Spotify app on your phone or computer
- **Demo mode** with made-up songs, so you can try everything before connecting

## 1. Run it

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Use that address, **not** `localhost`: Spotify doesn't allow `localhost` for logins anymore.

## 2. Connect your Spotify Premium account

You only do this once. It takes about two minutes.

1. Go to **https://developer.spotify.com/dashboard** and log in with your Spotify Premium account. Accept the developer terms if asked.
2. Press **Create app**.
   - **App name / description:** anything, e.g. `Spotifier`
   - **Redirect URIs:** paste `http://127.0.0.1:5173/` *exactly* (including the slash at the end), then press **Add**
   - **Which API/SDKs are you planning to use?** tick **Web API** and **Web Playback SDK**
   - Accept the terms and press **Save**
3. On your new app's page, open **Settings** and copy the **Client ID**.
4. In Spotifier, paste the Client ID into the **Connect your account** window and press **Connect Spotify**.
   (You can reopen that window any time from Customize → Account. You can also put the ID in a `.env` file; see `.env.example`.)
5. Spotify asks you to approve access. Press **Agree**, and you're back in the app with your music.

### If something goes wrong

| What you see | Fix |
| --- | --- |
| `INVALID_CLIENT: Invalid redirect URI` | The Redirect URI in the dashboard must match the address in your browser exactly. Use `http://127.0.0.1:5173/`, not `localhost`. |
| "User not registered in the Developer Dashboard" | In your app on the dashboard, open **User Management** and add the name and email of your Spotify account. |
| "Playing in the browser needs Spotify Premium" | Log out of Spotify in your browser and log in with the Premium account. |
| No sound / "No active device" | Wait a few seconds for the browser player to connect, then tap **Device** and pick *Spotifier (liquid glass)*. Some browsers (e.g. many Linux builds of Chromium) can't play protected audio; use Chrome, Edge or Firefox, or control the Spotify app on your phone instead. |
| A playlist shows no songs | Spotify only lets apps list songs in playlists *you own or collaborate on*. Press the big play button and it will still play. |

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | Seek 5 seconds |
| `L` | Full-screen lyrics |
| `/` | Search |
| `Esc` | Close panels |

## Good to know

- **Lyrics** come from [LRCLIB](https://lrclib.net), a free, community-run lyrics database, because Spotify doesn't share its lyrics with other apps. Most popular songs have time-synced lyrics; if a song isn't there yet, you'll see "No lyrics found".
- **Privacy:** there's no server. Your login token stays in your browser's storage, and the app uses Spotify's PKCE login, so it never sees your password or needs a client secret.
- **Spotify's limits for personal apps:** new apps start in *Development Mode*, which needs a Premium account and allows up to 5 users you add under User Management. That's plenty for personal use.
- **Hosting it online:** run `npm run build`, upload the `dist` folder to any static host (Netlify, Vercel, GitHub Pages…), and add that site's `https://…/` address as another Redirect URI in your Spotify app.

## Project layout

```
index.html          page structure (three panes, drawers, full-screen lyrics)
src/main.js         app logic: rendering, controls, library, search, settings
src/player.js       demo player + Spotify player (Web Playback SDK and Web API)
src/auth.js         Spotify login (PKCE)
src/api.js          Spotify Web API calls
src/lyrics.js       lyrics fetching (LRCLIB) and the glass-bubble lyrics view
src/fx.js           aurora, bubbles, cursor lighting, refraction, tilt
src/theme.js        themes, settings, album color extraction
src/demo.js         demo songs (original, made up for this app)
src/styles.css      the liquid-glass look
```

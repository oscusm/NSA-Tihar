# Katti Garo — audio files

Every sound is a plain `.mp3` file. **To replace a sound, drop a new file in with the exact same
name** and reload the big screen. There's no code to change.

If a group sound or effect file is missing, the game plays a built-in synthesized sound instead.
If a music file is missing, there's no music.

## 1. Team sounds: `public/sounds/`

These play on the **big screen** and on the **phones of that team** when the team buzzes first.
The name must match the `sound` column in the Groups sheet.

| File | Included? | Notes |
|---|---|---|
| `crow.mp3` | yes | Kag Tihar |
| `dog.mp3` | yes | Kukur Tihar |
| `cow.mp3` | yes | Gai Tihar |
| `ox.mp3` | yes (a cow recording, pitched down) | Goru Tihar. Replace it if you find a real ox/bull. |
| `rooster.mp3`, `goat.mp3`, `cat.mp3`, `duck.mp3`, `sheep.mp3` | yes | extras for more teams |

Want a new animal? Add for example `elephant.mp3` here and write `elephant` in the sound column.
**Length: 1–3 seconds.**

## 2. Game effects: `public/sounds/effects/` (all cut from the Nepali comedy sound pack; see `CREDITS.md` and `preview/nepali/`)

All of these play on the **big screen** only.

| File | When it plays | Length | Suggested search |
|---|---|---|---|
| `intro.mp3` | Host picks a category (the big category splash) | 1–2 s | "whoosh", "drum hit", "swoosh transition" |
| `open.mp3` | Buzzers open | < 1 s | "ding", "bell", "game start beep" |
| `tick.mp3` | Each of the last 3 seconds of the countdown (very quiet) | < 0.2 s | "clock tick", "click" |
| `timeup.mp3` | Nobody buzzed in time | ~1 s | "time up", "fail jingle" |
| `correct.mp3` | Host taps Correct | 1–2 s | "correct answer", "success chime", "applause short" |
| `wrong.mp3` | Host taps Wrong | ~1 s | "wrong answer", "error buzzer" |
| `reveal.mp3` | Answer shown with no winner | ~1 s | "reveal", "notification" |
| `winner.mp3` | Final scores / podium | 3–6 s | "victory fanfare", "crowd cheer" |
| `join.mp3` | A player joins (lobby only) | < 0.3 s | "pop", "bubble" |

## 3. Background music: `public/sounds/music/`

Music loops on the big screen. `lobby.mp3` plays through the whole game. Press **M** on the big
screen to mute or unmute it.

| File | When it loops | Tip |
|---|---|---|
| `lobby.mp3` | The whole game, nonstop and quiet (stops only for the winner podium) | Included: Nepali comedy loop, 7.68 s seamless loop |
| `board.mp3` | Not used any more; the board plays `lobby.mp3` | |

Pick a track that loops cleanly (1–3 minutes) and keep it under about 5 MB.

## Where to get free sounds

- **Pixabay**: https://pixabay.com/sound-effects/ and https://pixabay.com/music/
  These are free to use, even at events, and need no credit. Download, rename, and drop the file in.
- **Freesound**: https://freesound.org. Free account required. Filter by License → "Creative Commons 0".
- **Wikimedia Commons**: https://commons.wikimedia.org. This is where the included animal sounds
  came from; see `CREDITS.md`.

Don't use songs from YouTube or Spotify. They're copyrighted.

## Making a file the right length (optional)

If you have `ffmpeg` installed, this keeps seconds 2 to 5 and converts the result to MP3:
```bash
ffmpeg -ss 2 -t 3 -i input.wav -ac 1 -b:a 128k public/sounds/effects/correct.mp3
```
You can also use the free online editor https://audiotrimmer.com.

Volumes are set per track in `MUSIC_VOLUMES` at the top of `public/sounds.js` (lobby 0.08; effects play at 0.7).

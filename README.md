# Katti Garo

A live, team-vs-team buzzer quiz for the Nepalese Student Association at Southern Miss.
A projector shows a category board. The host picks a category from their phone, the question
appears on the big screen, and players buzz in from their own phones.

| Page | Who uses it | What it does |
|---|---|---|
| `/screen` | Projector / big TV | QR code, category board, questions, countdown, who buzzed, scores, winner podium |
| `/remote?pin=YOURPIN` | Host's phone | Pick categories, Correct / Wrong, +/- points, load questions |
| `/play` | Every player's phone | Join a team, giant BUZZ button |

> **Everything is kept in memory.** If the server restarts, scores and players are reset.
> On Render's free plan the server also **sleeps after 15 minutes without visitors**.
> See [On the day of the event](#on-the-day-of-the-event).

---

## Contents
1. [Run it on your laptop](#1-run-it-on-your-laptop)
2. [Make your questions (Google Sheet or CSV)](#2-make-your-questions)
3. [Logo, title and sounds](#3-logo-title-and-sounds)
4. [Deploy to Render (free)](#4-deploy-to-render-free)
5. [Test with your phone](#5-test-with-your-phone)
6. [How to host the game](#6-how-to-host-the-game)
7. [On the day of the event](#on-the-day-of-the-event)
8. [Troubleshooting](#troubleshooting)
9. [How the code works](#how-the-code-works)

---

## 1. Run it on your laptop

You need **Node.js 18 or newer** ([nodejs.org](https://nodejs.org), pick "LTS"). Check with `node -v`.

```bash
cd buzzer-quiz
npm install        # first time only
npm start          # starts the server
```

You'll see:
```
Quiz running on http://localhost:3000
  Big screen: http://localhost:3000/screen
  Host:       http://localhost:3000/remote?pin=1234
  Players:    http://localhost:3000/play
```

- Open **/screen** on the laptop and click once (this turns on sound). Press **F** for full
  screen and **M** to mute or unmute the music.
- Your phone must be on the **same Wi-Fi**. Scan the QR code on the screen. It automatically
  uses your laptop's Wi-Fi address (like `http://192.168.1.20:3000/play`).
- The default PIN is `1234`. To use another one locally: `HOST_PIN=5678 npm start`
- Run the automated tests (40 fake players buzzing at once): `npm test`
- Stop the server with **Ctrl + C**.

> If your phone can't open the page, your laptop's firewall is probably blocking port 3000.
> On Linux run `sudo ufw allow 3000`. On Windows, click "Allow" when it asks about Node.js.

The game starts with 4 sample teams (Crow, Dog, Cow, Ox) and 12 sample questions in
4 categories (Tihar, Nepal, Southern Miss, Food), so you can try it right away.

---

## 2. Make your questions

### The format: column A = question, column B = answer

There are **no categories** in the game. The host announces the topic out loud.

| | A | B |
|---|---|---|
| 1 | Question | Answer |
| 2 | What is the capital of Nepal? | Kathmandu |
| 3 | How many days is Tihar celebrated? | Five days |

- **Column A** is the question and **column B** is the answer. Other columns are ignored.
- The header row (`Question | Answer`) is optional. If row 1 says "Question" / "Answer", it's skipped.
- Questions play **top to bottom**. Each one is worth **10 points** with a **15 s** timer.
- The big screen shows "Question 4 of 30" and the remote has one big **▶ Next question** button.
  The remote's "See all questions & answers" list lets you play any one out of order.
- Excel (`.xlsx`) files can be uploaded directly on the remote; the first sheet is used.

**Groups** tab (the teams):

| name | emoji | color | sound |
|---|---|---|---|
| Crow | 🐦‍⬛ | #3a3f8f | crow |
| Dog | 🐶 | #0f9d76 | dog |
| Cow | 🐄 | #d9622b | cow |
| Ox | 🐂 | #c0263a | ox |

- **color**: a hex color like `#0f9d76` (pick one at [htmlcolorcodes.com](https://htmlcolorcodes.com)).
- **sound**: one of **crow, dog, cow, ox, rooster, goat, cat, duck, sheep**, or a full
  `https://…mp3` link.

Ready-made templates are on the running site at `/templates/questions.csv` and
`/templates/groups.csv`, or in `public/templates/`.

### Option A — Google Sheet (recommended, no API key)

1. Go to [sheets.new](https://sheets.new) to create a sheet, for example "Katti Garo".
2. Rename the first tab (bottom left) to **Questions** and type the column headers in row 1.
3. Click **+** to add a second tab named **Groups**, and fill it in the same way.
4. Go to **File → Share → Publish to web**.
   - In the first dropdown pick **Questions**, and in the second pick **Comma-separated values (.csv)**.
   - Click **Publish**, then **OK**. Copy the link (it ends in `output=csv`).
   - Switch the first dropdown to **Groups** and copy that link too.
5. Use the links in one of two ways:
   - On the **remote**: open "Questions & teams", paste them, and tap **Load from Google Sheet**.
   - As **environment variables** on Render (`QUESTIONS_CSV_URL`, `GROUPS_CSV_URL`), so they
     load every time the server starts. **Use this for the real event.**

After editing the sheet, wait about 1 minute (Google caches the published file), then tap
**Load from Google Sheet** again. Scores, and which questions were already played, are kept.

> The answers are in the published sheet, so don't share its link. The game itself never
> sends answers to the players or the screen before the host reveals them.

### Option B — Upload a CSV file

Make the table in Excel, Google Sheets or Numbers, then choose **File → Download → CSV**.
On the remote, open "Questions & teams" and tap **Upload questions CSV** (and/or teams).
Uploaded files are lost when the server restarts, so use Option A for the event.

---

## 3. Logo, title and sounds

| What | How |
|---|---|
| **Logo** | Put `logo.png` (square, for example 512×512) in `public/img/`. Without it, a gold "NSA" badge is shown. |
| **Title** | Env var `EVENT_TITLE` (default `Katti Garo`). |
| **Subtitle** | Env var `EVENT_SUBTITLE` (default `Nepalese Student Association · Southern Miss`). |
| **Sounds** | See **[`public/sounds/README.md`](public/sounds/README.md)** for every sound file, when it plays, and where to get free ones. To replace a sound, drop in a file with the same name. |

The theme uses Southern Miss black and gold, with Nepali prayer flags, a marigold garland and
floating diyo lights. The colors are at the top of `public/style.css` (`--gold`, `--black`, …).

---

## 4. Deploy to Render (free)

Render runs the server on the internet, so everyone can join on mobile data or any Wi-Fi.
WebSockets work on the free plan.

### Step 1 — Put the code on GitHub
1. Create a free account at [github.com](https://github.com), click **New repository**, name it
   `katti-garo`, and click **Create**. It can be private.
2. In the project folder run:
   ```bash
   git init
   git add .
   git commit -m "Katti Garo"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/katti-garo.git
   git push -u origin main
   ```

### Step 2 — Create the web service
1. Sign up at [render.com](https://render.com) with your GitHub account.
2. Click **New + → Web Service** and pick your repository.
3. Fill in:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
4. Under **Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `HOST_PIN` | a PIN only you know, e.g. `7391` (**don't leave it as 1234**) |
   | `QUESTIONS_CSV_URL` | your published Questions CSV link |
   | `GROUPS_CSV_URL` | your published Groups CSV link |
   | `PUBLIC_URL` | *(optional)* e.g. `https://katti-garo.onrender.com`, only if the QR shows the wrong address |
   | `EVENT_TITLE`, `EVENT_SUBTITLE` | *(optional)* change the names shown on screen |
   | `POINTS_WRONG`, `INTRO_SECONDS` | *(optional)* `-5` and `3` by default |
   | `WRONG_REOPENS` | *(optional)* `true` = after a wrong answer the other teams get `REOPEN_SECONDS` (default 10) to buzz. Default: the game moves on |

5. Click **Create Web Service**. After 2–3 minutes the log says `Quiz running on …` and the status is **Live**.

Your links:
- Screen: `https://YOUR-APP.onrender.com/screen`
- Host: `https://YOUR-APP.onrender.com/remote?pin=YOUR-PIN`
- Players: `https://YOUR-APP.onrender.com/play` (shown as a QR code on the screen)

> Shortcut: this repo includes `render.yaml`. In Render you can choose **New + → Blueprint**
> instead, pick the repo, and Render asks for the env vars.

**Changing questions later:** edit the Google Sheet, then tap **Load from Google Sheet**.
**Changing code later:** run `git add . && git commit -m "update" && git push`. Render redeploys
automatically, which restarts the server and **resets scores**, so never push during the event.

---

## 5. Test with your phone

1. Open `/screen` on your laptop and click once to turn on sound.
2. Scan the QR code with your phone, type a name, pick a team and tap **Join**. You appear on the big screen.
3. Open `/remote?pin=YOUR-PIN` on a second device (or another tab) and tap **Open category board**.
4. Tap a category. The big screen shows the category splash, then the question, then "Buzzers open".
5. Tap **BUZZ** on your phone. The big screen turns your team's color and plays its sound,
   and your phone plays it too (turn off silent mode).
6. Try **Wrong**: your team loses 5 points, the answer is shown, and you pick the next question.
7. Reload the phone page. It rejoins automatically with the same name and team.
8. When you're done testing, open **Game** on the remote and tap **Reset game**, then **Remove all players**.

The best test is with 3–4 friends all buzzing at once.

---

## 6. How to host the game

```
Lobby (players join via QR)
  └─ Open category board
       └─ tap a category + difficulty ──▶ splash ──▶ question, 3 s "get ready" ──▶ buzzers open
             ├─ a team buzzes → the question is hidden; walk to that team, they answer out loud
             │     ├─ Correct → points + answer on screen
             │     └─ Wrong   → −5 + answer on screen (no second chance)
             └─ time's up → Reveal answer
       ◀── Back to the board (or tap the next category straight away)
  └─ when every question is played: Show final scores → podium + confetti
```

The remote always shows **the answer, privately**, and only the buttons that make sense right now:

| Button | What it does |
|---|---|
| **Open category board** | Moves from the lobby to the board |
| **Pick a question grid** | One column per category, one button per difficulty/points. Tap one to play it. Played ones are greyed out |
| **See all questions & answers…** | Every question with its answer. **Play** asks it; **Skip** marks it as played without asking |
| **Open buzzers now** | Skips the 3-second "get ready" |
| **Correct** | Gives the question's points to the team that buzzed and shows the answer |
| **Wrong** | −5 to that team and shows the answer; then pick the next question |
| **Reveal answer** | Shows the answer without giving points |
| **Back to the board** | Returns to the category board |
| **− / +** next to a team | Takes away or gives the "Amount" (default 5) at any time |
| **Game → End game now** | Jumps to the winner podium |
| **Game → Reset game** | Scores back to 0, all questions unplayed, back to the lobby (players stay) |

---

## On the day of the event

- **Open the site about 10 minutes early.** The free Render server sleeps after 15 minutes
  without visitors and takes 30–60 seconds to wake up. Opening `/screen` wakes it.
  If there's a long break before you start, reload `/screen` and check the remote again.
  (Want zero risk? Render's cheapest paid plan never sleeps. You can switch for one day and switch back.)
- **A server restart resets scores and players.** Don't push code during the event. If it
  happens anyway, phones rejoin automatically; re-add the scores with the +/− buttons.
- Check that the remote shows the right number of questions and categories.
- Plug the laptop into the room speakers and click the screen once.
- Tell players: "Turn off silent mode" and "Pick your team carefully, you can't switch."
- Bookmark your remote link. Refreshing it never loses anything.
- Before starting, tap **Remove all players** if test players are still listed.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| QR shows `localhost` or the wrong address | Set `PUBLIC_URL` on Render to your real address |
| Phone can't open the page (laptop) | Same Wi-Fi? Firewall: `sudo ufw allow 3000`. Some campus/guest Wi-Fi blocks device-to-device traffic, so use Render instead |
| "Wrong PIN" on the remote | The link must be `/remote?pin=` plus the exact `HOST_PIN` |
| No sound on the big screen | Click the screen once and check the laptop's volume and output device |
| No sound on a phone | Turn off silent mode, turn up the volume, tap the screen once |
| "Got a web page instead of CSV" | You copied the normal sheet link. Use **File → Share → Publish to web → CSV** |
| Sheet changes don't show | Wait 1–5 minutes (Google caching), then reload on the remote |
| Drive image doesn't show | Share the image as "Anyone with the link" |
| "That name is already taken" | Use a different name. If it's you on a new phone, join the same team with the same name; it lets you take it over once the old phone is offline |
| Fonts look plain | The fonts load from Google Fonts. Without internet the game still works, just with system fonts |
| Site takes a minute to load | The Render free tier was asleep. That's normal; wait 60 s |
| Everyone was kicked / scores are 0 | The server restarted. See "On the day of the event" |

---

## How the code works

```
server.js          The brain: game state, rules, who buzzed first, PIN check
sheets.js          Reads CSV (Google Sheet or upload), categories, points, Drive image links
sample-data.js     Starter teams + questions
public/
  play.html/.js    Player phone
  screen.html/.js/.css   Big screen
  remote.html/.js/.css   Host remote
  theme.js         Title/logo from the server, prayer flags, sparkles
  sounds.js        Plays the mp3s (with synthesized fallbacks) and background music
  style.css        Theme colors + shared styles + player page
  img/             Your logo goes here
  sounds/          Team sounds, effects/, music/ (see sounds/README.md)
  templates/       Example CSVs
test/
  buzz-race.js     40 fake players buzz at once → exactly one winner, category flow
  sheets.js        CSV / link conversion checks
```

**Why buzzing is fair:** phones only send "I buzzed". The server handles one message at a time,
so the first buzz that *arrives* switches the game to "buzzed" and every later buzz is ignored,
even one that arrives a millisecond later. Each time the buzzers open, a new `roundId` is used,
so a slow tap from an earlier round can never count. Buzzes during the 3-second "get ready" are
ignored too. Double taps are blocked on the phone *and* on the server.

**Why answers can't leak:** the board only sends points and played/unplayed, never question
text. A question's answer is added to the shared state only after the host reveals it. The host
gets answers through a private channel that requires the PIN.

**Socket.IO messages:**

| From → To | Message |
|---|---|
| player → server | `player:join`, `player:buzz` |
| host → server | `host:auth`, `host:start`, `host:pick`, `host:next`, `host:correct`, `host:wrong`, `host:points`, `host:toggleUsed`, `host:reload`, `host:upload`, `host:end`, `host:reset`, `host:kickAll` |
| server → everyone | `state` (whole game, no answers), `buzzed` (play team sound), `effect`, `kicked` |
| server → host only | `hostSecret` (answers, all questions, sheet links, settings) |

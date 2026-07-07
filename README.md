# KACHING — Beat the Market

> The first World Cup prediction game where you score on timing, not just being right.

**Built for the TxLINE World Cup Hackathon on Superteam Earn**

---

## What is Kaching?

Kaching puts a live win-probability bar in the hands of every football fan watching the World Cup. Powered by TxLINE consensus odds, the bar moves in real time as the global betting market reacts to what is happening on the pitch.

Players tap YES or NO on prediction questions, but they are not scored simply for being right. They are scored on **timing**. Call it early, before the odds move, and earn a multiplier of up to **3x**. Call it after the market has already reacted, and earn almost nothing.

An AI commentator, voiced by ElevenLabs with a UK broadcast feel and powered by Groq, covers the whole match like a real world-feed commentator — calling kickoff, goals, red cards, halftime, the second-half restart and full time, and delivering regular colour commentary built only from live data.

---

## What makes it different?

The three starter ideas all use scores and stats as their data. Kaching uses the **live betting odds** as the primary engine — turning market intelligence into gameplay.

| Inspired by | What Kaching takes from it |
|---|---|
| AI Pundit Bot | Live voice commentary reacting to match events and predictions |
| Hi-Lo Stats Game | Predict before the next update mechanic and streak system |
| Group Sweepstake | Live leaderboard updated directly from TxLINE data |

The result is familiar enough that any fan understands it in five seconds, and original enough that no similar product exists.

---

## Business Model

**Today:** Free to play, zero financial risk, fully legal everywhere.

**Near-term:** Optional micro-stake prediction pools. Players opt into a paid round. Their prediction is recorded on Solana. TxLINE on-chain verified odds settle the outcome trustlessly. The platform takes a small rake.

This is the unique commercial angle: **TxLINE is not just a data layer. It is the settlement oracle.** That makes the on-chain version legally clean and technically trustless.

Additional revenue paths:
- Premium AI voices — ElevenLabs voice packs and celebrity commentator personalities
- Sponsored rounds — brands buy featured question slots during high-profile matches
- White-label licensing — sports media publishers wanting a live engagement layer

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express, Socket.io |
| Frontend | Plain HTML, CSS, JavaScript (no build step) |
| Database | SQLite via sql.js (pure JS, persisted to disk) |
| AI Text | Groq, llama-3.3-70b-versatile |
| AI Voice | ElevenLabs, eleven_turbo_v2_5 |
| Blockchain | Solana mainnet, on-chain TxLINE subscription |
| Auth | Username and bcrypt password, session-based |
| Data | TxLINE Service Level 12, real-time, mainnet |

### Key technical decisions

**Beat-the-market scoring** — Each prediction is timestamped at submission. When it resolves, the server calculates how many seconds before the odds moved the player called it. Earlier calls earn multipliers up to 3x.

**Professional timing model** — Every question has two independent clocks, the way real in-play markets work. Players get a **60-second answer window** to lock in YES or NO. The question itself then watches the match for **3–5 match minutes**, measured against the real match clock — not wall time — so stoppages and slow feeds never desync a result from what actually happened on the pitch. "Happens" questions (goal, corner, card, odds move) settle YES the instant the event occurs, like a real in-play market; "hold" questions settle when the window closes. A wall-clock hard cap guarantees no question can ever hang on a stalled feed, and a 5-second resolution sweep announces results on time even when the feed goes quiet.

**Match lifecycle engine** — One central transition engine reacts the moment the match changes phase. Kickoff resets the game state and arms the first question for ~2 minutes after the whistle. Halftime settles all open predictions and pauses questions. The second-half restart re-arms everything instantly. Full time force-settles every open prediction, kills any question card still on screen across all clients, silences all commentary, and hands over to a next-match countdown that ticks every second inside the final minute and flips straight into the live feed at kickoff.

**Broadcast-accurate match clock** — The scoreboard behaves exactly like television. First-half stoppage displays **45+1' → 45+6'**, never a false jump to 46'. The feed's clock convention (per-half vs cumulative) is auto-detected and latched per match. Halftime and full time are detected by two independent signals — the clock **stopping** and the clock **freezing** while the feed still claims it is running — and once declared, the break is **latched**: feeds that keep reporting `Period: 1, Running: true` through the break cannot drag the display back. The latch releases only on genuine second-half evidence: an explicit period signal or the clock visibly moving again.

**Team-aware questions** — Questions are rendered with real team names at ask time — "Will *Brazil* score in the next 3 minutes?" — and the resolver checks *that specific team's* goals, so an opposition goal never settles the wrong side. Sixteen question types are filtered by live context: no window may span halftime or run past 90', probability questions require flowing odds, and threshold questions never ask about a level the market has already passed.

**AI broadcast commentator** — A single persona covers the whole match: measured, professional, present tense, in the tradition of great television commentators. Colour lines land on a ~75-second broadcast rhythm and are generated **only from real live data** — the exact displayed minute (including 45+X), true score, corner and card totals, live market percentages, and a rolling log of actual recent events — with an explicit instruction never to invent an incident. Event calls (kickoff, goals, red cards, halftime, second half, full time, extra time) interrupt the rhythm the moment they happen, and periodic commentary yields whenever anything spoke in the last 25 seconds so lines never pile up.

**Atomic voice + text playback** — On the client, a commentator line's text and voice are one inseparable unit: the text appears the instant its clip starts and leaves only when its clip finishes. Playback is strictly serial — the current clip is always stopped before the next may begin, making overlap impossible — with a short breath between lines and a capped queue that drops stale lines so the audio never lags the match.

**Market-accurate probabilities** — The win-probability bar shows the true market consensus. Implied probabilities are extracted from live TxLINE prices and normalised to remove the bookmaker overround, matching professional trading screens. If a message cannot be parsed, the engine returns nothing rather than inventing a value — the bar only ever moves on real data.

**Reconnect-proof results** — Mobile sockets drop and reopen constantly. Prediction results are broadcast with the player's session ID and filtered client-side, so the win card — points, timing label, and question recap — always reaches the player who earned it, no matter how many times their connection cycled during the question window.

**Replay engine** — TxLINE historical score snapshots are fetched and converted to timed event sequences, then played back through the live game engine at configurable speed. The same handlers process replay and live events — zero code duplication. A Python build script rebuilds the replay from the most recent finished match automatically.

**Demo mode isolation** — A "Watch Demo Match" button plays a completed match replay to a single socket without affecting any live players. A `demoSockets` Set tracks which connections are in demo mode. Every broadcast — match state, questions, pundit, countdown — skips demo sockets. Demo predictions resolve against the actual replay match state using the same resolver, validity rules and lifecycle announcements as live mode, and results are saved to the real database.

**Reconnect guard** — All TxLINE streams are wrapped in an exponential backoff reconnect layer that holds last-known values on screen during a hiccup. The UI never freezes.

**Score persistence** — Scores are written to a SQLite database via sql.js after every prediction result. An auto-save runs every 30 seconds as a safety net. On page refresh, the session is restored via a GET endpoint that never creates a new player, ensuring scores survive restarts and reconnects.

**On-chain subscription** — The TxLINE data feed is activated by a confirmed Solana transaction subscribing to Service Level 12.

**Auto fixture discovery** — On startup and every 30 minutes, the server fetches the fixture list from TxLINE and builds the upcoming match countdown automatically. No hardcoded teams, no hardcoded timestamps.

---

## TxLINE Endpoints Used

| Endpoint | Purpose |
|---|---|
| `POST /auth/guest/start` | Guest JWT for API access, auto-refreshed every 45 minutes |
| `POST /api/token/activate` | Activate token via on-chain subscription signature |
| `GET /api/fixtures/snapshot` | Fetch fixture list, team names and kickoff times |
| `GET /api/scores/snapshot/:id` | Historical scores for replay recordings |
| `GET /api/scores/stream` | Live SSE stream — goals, cards, corners, clock, period |
| `GET /api/odds/stream` | Live SSE stream — win probabilities and market prices |

---

## TxLINE API Feedback

**What worked well:**

- Normalised schema made switching between replay and live require zero code changes
- Zero-cost hackathon access kept the focus entirely on product
- On-chain subscription design is genuinely novel — no traditional sports API has this
- Scores stream richness — everything the game engine needed was in one stream
- Fixture snapshot returned team names and kickoff timestamps enabling a fully automatic countdown with zero hardcoded values

**Where friction appeared:**

- Activation flow is multi-step and unfamiliar to non-Solana builders — a dashboard API key would help
- Historical odds snapshots returned empty for recently finished matches — replay had to simulate odds from score data
- World Cup fixture bundle used competition ID 72, not 17 as the docs suggested — caused silent 403 errors
- Guest JWT TTL is not documented — makes proactive refresh logic harder to reason about
- SSE only — bidirectional games need a separate Socket.io connection alongside the stream, adding complexity
- Clock semantics vary by fixture — `Clock.Period` and `Running` are sometimes reported unchanged through the halftime break, and numeric fields can arrive as strings. Kaching handles this with numeric coercion, frozen-clock detection and break latching, but documented clock-state semantics would save every builder this work

---

## Project Structure

```
kaching-beat-the-market/
├── backend/
│   ├── server.js                   entry point, lifecycle engine, clock logic
│   ├── config/                     env, TxLINE config, Solana
│   ├── data/                       live streams, replay switch, reconnect guard
│   ├── replay/
│   │   ├── replayEngine.js         plays recordings back in real time
│   │   └── recordings/
│   │       ├── scores.json         score event recording
│   │       └── odds.json           odds event recording
│   ├── game/                       questions, resolver, scoring, probability
│   ├── pundit/                     Groq text + ElevenLabs voice pipeline
│   ├── players/                    auth, database, scoring, leaderboard
│   ├── chain/                      wallet verification, stake pool stub
│   ├── realtime/                   Socket.io push helpers
│   └── routes/                     auth, session, predictions, leaderboard
├── frontend/
│   ├── index.html
│   └── src/
│       ├── main.js
│       ├── components/             MatchView, PredictionCard, PunditPlayer,
│       │                           ResultFlash, StreakDisplay, Leaderboard,
│       │                           HowItWorks, ConnectWallet
│       └── services/               socket, api, wallet, flags
└── shared/
    ├── questions.js                16 team-aware question types with context filters
    └── scoringRules.js             timing bands and multipliers
```

---

## Running Locally

```bash
cp .env.example .env
# Fill in TXLINE_API_TOKEN, TXLINE_JWT, GROQ_API_KEY, ELEVENLABS_API_KEY
npm install
node backend/server.js
```

The demo is accessible in-app via the **Watch Demo Match** button — no separate mode needed.

---

## Submission Details

| | |
|---|---|
| **Live App** | https://kaching-beat-the-market-production.up.railway.app |
| **Demo Video** | https://[loom-or-youtube-link] |
| **GitHub** | https://github.com/cutlerjay109-create/kaching-beat-the-market |
| **Subscription Tx** | `2nVfBkAS5emXCBqPEgaTTjFdnVMH1f6Rz2DfxpDqSghZ3MyBnGeC4iiV6gwafpQ5MkxTxzquZs13FpNAZtRxJiii` |
| **Wallet** | `HXyv3RHndummXVjMcXTRaQo1L1sQtxutQtbgfnVC2Hxg` |
| **Network** | Solana Mainnet |
| **Service Level** | 12, real-time, World Cup bundle |

---

*Built by Levronex for the TxLINE World Cup Hackathon on Superteam Earn.*

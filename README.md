# KACHING — Beat the Market

> The first World Cup prediction game where you score on timing, not just being right.

**Built for the TxLINE World Cup Hackathon on Superteam Earn**

---

## What is Kaching?

Kaching puts a live win-probability bar in the hands of every football fan watching the World Cup. Powered by TxLINE consensus odds, the bar moves in real time as the global betting market reacts to what is happening on the pitch.

Players tap YES or NO on prediction questions, but they are not scored simply for being right. They are scored on **timing**. Call it early, before the odds move, and earn a multiplier of up to **3x**. Call it after the market has already reacted, and earn almost nothing.

An AI pundit, voiced by ElevenLabs with a UK broadcast commentator feel and powered by Groq, reacts to every goal, odds shift, and prediction in real time.

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
| Database | SQLite via sql.js (pure JS) |
| AI Text | Groq, llama-3.3-70b-versatile |
| AI Voice | ElevenLabs, eleven_turbo_v2_5 |
| Blockchain | Solana mainnet, on-chain TxLINE subscription |
| Auth | Username and bcrypt password, session-based |
| Data | TxLINE Service Level 12, real-time, mainnet |

### Key technical decisions

**Beat-the-market scoring** — Each prediction is timestamped at submission. When it resolves, the server calculates how many seconds before the odds moved the player called it. Earlier calls earn multipliers up to 3x.

**Replay engine** — TxLINE historical score snapshots are converted to timed event sequences and played back through the live game engine. The same handlers process replay and live events, making the demo fully reproducible after matches end.

**Reconnect guard** — All TxLINE streams are wrapped in an exponential backoff reconnect layer that holds last-known values on screen during a hiccup. The UI never freezes.

**Context-aware questions** — 16 question types are filtered by match state before being offered. Halftime questions only appear before minute 40. Probability questions only fire when odds data is flowing.

**On-chain subscription** — The TxLINE data feed is activated by a confirmed Solana transaction subscribing to Service Level 12.

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

---

## Project Structure

```
kaching-beat-the-market/
├── backend/
│   ├── server.js                   entry point
│   ├── config/                     env, TxLINE config, Solana
│   ├── data/                       live streams and replay switch
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
│       ├── components/             MatchView, PredictionCard, Pundit, Leaderboard
│       └── services/               socket, api, wallet, flags
└── shared/
    ├── questions.js                16 question types
    └── scoringRules.js             timing bands and multipliers
```

---

## Running Locally

```bash
cp .env.example .env
# Fill in TXLINE_API_TOKEN, TXLINE_JWT, GROQ_API_KEY, ELEVENLABS_API_KEY
npm install
node backend/server.js

# Demo/replay mode
SOURCE_MODE=replay node backend/server.js
```

---

## Submission Details

| | |
|---|---|
| **Live App** | https://[deployed-url] |
| **Demo Video** | https://[loom-or-youtube-link] |
| **GitHub** | https://github.com/cutlerjay109-create/kaching-beat-the-market |
| **Subscription Tx** | `2nVfBkAS5emXCBqPEgaTTjFdnVMH1f6Rz2DfxpDqSghZ3MyBnGeC4iiV6gwafpQ5MkxTxzquZs13FpNAZtRxJiii` |
| **Wallet** | `HXyv3RHndummXVjMcXTRaQo1L1sQtxutQtbgfnVC2Hxg` |
| **Network** | Solana Mainnet |
| **Service Level** | 12, real-time, World Cup bundle |

---

*Built by Levronex for the TxLINE World Cup Hackathon on Superteam Earn.*


KACHING — BEAT THE MARKET
Live World Cup Prediction Game
TxLINE World Cup Hackathon on Superteam Earn
Builder: Levronex (@levr_nx on X)
Network: Solana Mainnet

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

01  WHAT IS KACHING?

The first prediction game where you beat the betting market, not just the final score.

Kaching puts a live win-probability bar in the hands of every football fan watching the World Cup. Powered by TxLINE consensus odds, the bar moves in real time as the global betting market reacts to what is happening on the pitch. Players tap YES or NO on prediction questions, but they are not scored simply for being right.

They are scored on timing. Call it early, before the odds move, and earn a multiplier of up to 3x. Call it after the market has already reacted, and earn almost nothing. This single mechanic makes every fan feel like a sharp analyst without them ever placing a real bet.

An AI pundit, voiced by ElevenLabs with a UK broadcast commentator feel and powered by Groq, reacts to every goal, odds shift, and prediction in real time. The experience is designed to feel like watching the match with the sharpest friend in the room.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

02  WHAT MAKES IT DIFFERENT?

The three starter ideas all use scores and stats as their data. Kaching uses the live betting odds as the primary engine. That is a genuinely different product because it turns market intelligence into gameplay. Players learn to read the market, not just watch the game.

Kaching absorbs the best parts of all three suggested ideas and builds something that sits in the space between them:

  From the AI Pundit Bot:     the live voice commentary layer, reacting to the match and to each prediction.
  From the Hi-Lo Stats Game:  the predict-before-the-next-update mechanic and the streak system.
  From the Group Sweepstake:  the live leaderboard updated directly from TxLINE data.

The result is familiar enough that any fan understands it in five seconds, and original enough that no similar product exists.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

03  BUSINESS MODEL

Today: free to play, zero financial risk, fully legal everywhere.

The near-term monetization model is optional micro-stake prediction pools. Players who want to put something on the line opt into a paid round. Their prediction is recorded on Solana. TxLINE on-chain verified odds and score roots settle the outcome trustlessly, with no manual intervention and no intermediary. The platform takes a small rake on each pool.

This is the unique commercial angle: TxLINE is not just a data layer in this model. It is the settlement oracle. That makes the on-chain version legally clean and technically trustless because the outcome is provably determined by a neutral source neither party controls.

Additional revenue paths:
  Premium AI voices:       ElevenLabs voice packs, celebrity commentator personalities.
  Sponsored rounds:        A brand buys a featured question slot during a high-profile match.
  White-label licensing:   Sports media publishers who want a live engagement layer on their coverage.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

04  TECH STACK

  Backend       Node.js, Express, Socket.io
  Frontend      Plain HTML, CSS, JavaScript (no build step)
  Database      SQLite via sql.js (pure JS, no native build)
  AI Text       Groq, llama-3.3-70b-versatile
  AI Voice      ElevenLabs, eleven_turbo_v2_5, UK broadcast voice
  Blockchain    Solana mainnet, on-chain TxLINE subscription
  Auth          Username and bcrypt password, session-based
  Data          TxLINE Service Level 12, real-time, mainnet

Five decisions worth noting:

  Beat-the-market scoring
  Each prediction is timestamped at submission. When it resolves, the server calculates
  how many seconds before the odds moved the player called it. Earlier calls earn higher
  multipliers up to 3x for calls made more than two minutes early.

  Replay engine
  TxLINE historical score snapshots are converted to timed event sequences and played
  back through the live game engine at configurable speed. The same handlers process
  replay and live events, making the demo video fully reproducible after matches end.

  Reconnect guard
  All TxLINE streams are wrapped in an exponential backoff reconnect layer that holds
  last-known values on screen during a hiccup. The UI never freezes.

  Context-aware questions
  16 question types are filtered by match state before being offered. Halftime questions
  only appear before minute 40. Probability questions only fire when odds data is flowing.
  Short-window questions are reserved for the second half.

  On-chain subscription
  The TxLINE data feed is activated by a confirmed Solana transaction subscribing to
  Service Level 12. This satisfies the sign-up through Solana requirement at the
  infrastructure level.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

05  TXLINE ENDPOINTS USED

  POST /auth/guest/start
  Obtain a short-lived guest JWT for API access. Called on server start and refreshed proactively.

  POST /api/token/activate
  Activate the API token by providing the on-chain subscription transaction signature
  and a wallet-signed message.

  GET /api/fixtures/snapshot
  Fetch the list of World Cup fixtures available in the subscription bundle to identify match IDs.

  GET /api/scores/snapshot/:id
  Fetch historical score event snapshots for a finished match.
  Used to build replay recordings for the demo.

  GET /api/scores/stream
  Live SSE stream of score events including goals, cards, corners, clock and period.
  Drives goal detection, question resolution and pundit triggers.

  GET /api/odds/stream
  Live SSE stream of consensus odds updates including win probabilities and market prices.
  Drives the probability bar and the beat-the-market timing engine.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

06  TXLINE API FEEDBACK

What worked well:

  Normalised schema
  Switching between replay and live required zero changes to the game engine because
  the same handler processed both. The shape was identical across all match types.

  Zero-cost access
  Service Level 12 being free for the hackathon removed the biggest barrier to entry.
  The focus stayed entirely on product.

  On-chain subscription design
  Linking data access to a Solana transaction creates a genuinely novel crypto-native
  onboarding flow. No traditional sports API has this and it opens real product possibilities.

  Scores stream richness
  Goals, cards, corners, clock, period and game state in a single normalised event.
  Everything the game engine needed was present in one stream.

Where friction appeared:

  Activation complexity
  The multi-step activation flow (guest JWT, sign message, activate token) is not common
  in sports APIs and took significant implementation time. A simpler API key from a
  dashboard would lower the barrier for builders who are not already Solana-native.

  Historical odds retention
  Historical odds snapshots returned empty arrays for recently finished matches. The replay
  engine had to simulate odds from score data rather than replaying real odds movement,
  which reduces replay accuracy.

  Competition ID mismatch
  The World Cup fixture bundle used competition ID 72, not the 17 suggested in the World
  Cup documentation. This caused silent 403 errors that were not immediately obvious.

  JWT expiry undocumented
  The guest JWT is short-lived but the exact TTL is not documented. A documented expiry
  time would make proactive refresh logic more predictable.

  SSE only
  For a game that needs bidirectional data flow, maintaining a separate Socket.io connection
  alongside the SSE stream adds complexity. A WebSocket option would simplify the architecture.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

07  PROJECT STRUCTURE

kaching-beat-the-market/
├── package.json                    project dependencies and scripts
├── .env.example                    blank key template for contributors
├── .gitignore                      keeps secrets out of GitHub
├── README.md                       project overview
│
├── backend/
│   ├── server.js                   entry point, wires all pieces together
│   ├── config/
│   │   ├── env.js                  loads and validates all env vars
│   │   ├── txline.js               TxLINE endpoint URLs and stream config
│   │   └── solana.js               Solana network and program addresses
│   ├── data/
│   │   ├── source.js               live vs replay switch
│   │   ├── oddsStream.js           TxLINE live odds SSE connection
│   │   ├── scoresStream.js         TxLINE live scores SSE connection
│   │   └── reconnectGuard.js       exponential backoff reconnect wrapper
│   ├── replay/
│   │   ├── replayEngine.js         plays recorded match back in real time
│   │   └── recordings/             odds.json and scores.json for demo
│   ├── game/
│   │   ├── questionEngine.js       decides which question to ask and when
│   │   ├── resolver.js             checks if a prediction won or lost
│   │   ├── scoring.js              beat-the-market timing multipliers
│   │   └── probability.js          converts raw odds to win probability
│   ├── pundit/
│   │   ├── pundit.js               orchestrates text and voice pipeline
│   │   ├── generateText.js         Groq generates commentary text
│   │   └── generateVoice.js        ElevenLabs speaks the commentary
│   ├── players/
│   │   ├── db.js                   SQLite database connection
│   │   ├── auth.js                 signup and login with bcrypt
│   │   ├── scoreStore.js           points, streaks, player records
│   │   └── leaderboard.js          rankings and rank lookup
│   ├── chain/
│   │   ├── wallet.js               Phantom signature verification
│   │   └── saveStreak.js           reserved for on-chain stake pool feature
│   ├── realtime/
│   │   └── push.js                 Socket.io broadcast helpers
│   └── routes/
│       ├── auth.js                 signup and login endpoints
│       ├── session.js              session management
│       ├── predictions.js          receive player prediction taps
│       └── leaderboard.js          serve leaderboard data
│
├── frontend/
│   ├── index.html                  single page shell
│   └── src/
│       ├── main.js                 boots the app, wires all components
│       ├── components/             MatchView, PredictionCard, Pundit,
│       │                           ResultFlash, Streak, Leaderboard,
│       │                           HowItWorks, ConnectWallet
│       ├── services/               socket.js, api.js, wallet.js, flags.js
│       └── styles/                 styles.css (broadcast-inspired design)
│
└── shared/
    ├── questions.js                16 question types with context filters
    └── scoringRules.js             timing bands and point multipliers

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

08  RUNNING LOCALLY

cp .env.example .env
# Fill in your API keys in .env
npm install
node backend/server.js

# For replay/demo mode:
SOURCE_MODE=replay node backend/server.js

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

09  SUBMISSION DETAILS

  Live App           https://[deployed-url]
  Demo Video         https://[loom-or-youtube-link]
  GitHub Repo        https://github.com/cutlerjay109-create/kaching-beat-the-market
  Subscription Tx    2nVfBkAS5emXCBqPEgaTTjFdnVMH1f6Rz2DfxpDqSghZ3MyBnGeC4iiV6gwafpQ5MkxTxzquZs13FpNAZtRxJiii
  Wallet             HXyv3RHndummXVjMcXTRaQo1L1sQtxutQtbgfnVC2Hxg
  Network            Solana Mainnet
  Service Level      12, real-time, World Cup bundle

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Built by Levronex for the TxLINE World Cup Hackathon on Superteam Earn.

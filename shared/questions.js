// shared/questions.js — all possible prediction question types.
//
// PROFESSIONAL TIMING MODEL:
//   • windowMinutes = MATCH minutes the question watches (3–5, never longer —
//     broadcast-style micro-predictions, resolved in sync with the match clock)
//   • Placeholders {home} {away} {leading} {trailing} {team} are rendered with
//     real team names at ask time by the question engine.
//   • target tells the resolver WHICH team the question is about:
//     "home" | "away" | "leading" | "either"

module.exports = [
  // ── GOALS ──────────────────────────────────────────────────
  {
    id:      "team_goal_next_3",
    text:    "Will {team} score in the next 3 minutes?",
    type:    "yes_no",
    source:  "scores",
    field:   "team_goals",
    target:  "leading",          // rendered as the team on top of the market
    windowMinutes: 3,
  },
  {
    id:      "team_goal_next_5",
    text:    "Will {team} find the net in the next 5 minutes?",
    type:    "yes_no",
    source:  "scores",
    field:   "team_goals",
    target:  "either",           // random side — keeps it varied
    windowMinutes: 5,
  },
  {
    id:      "goal_next_5",
    text:    "A goal — either end — in the next 5 minutes?",
    type:    "yes_no",
    source:  "scores",
    field:   "goals",
    windowMinutes: 5,
  },
  {
    id:      "goal_next_3",
    text:    "Will the deadlock shift in the next 3 minutes?",
    type:    "yes_no",
    source:  "scores",
    field:   "goals",
    windowMinutes: 3,
  },
  {
    id:      "no_goal_next_5",
    text:    "Will it stay goalless for the next 5 minutes?",
    type:    "yes_no",
    source:  "scores",
    field:   "no_goals",
    windowMinutes: 5,
  },

  // ── CORNERS ────────────────────────────────────────────────
  {
    id:      "corner_next_3",
    text:    "A corner kick in the next 3 minutes?",
    type:    "yes_no",
    source:  "scores",
    field:   "corners",
    windowMinutes: 3,
  },
  {
    id:      "corner_next_5",
    text:    "Will {home} or {away} win a corner in the next 5 minutes?",
    type:    "yes_no",
    source:  "scores",
    field:   "corners",
    windowMinutes: 5,
  },
  {
    id:      "two_corners_next_5",
    text:    "Two or more corners in the next 5 minutes?",
    type:    "yes_no",
    source:  "scores",
    field:   "corners_2plus",
    windowMinutes: 5,
  },

  // ── CARDS ──────────────────────────────────────────────────
  {
    id:      "card_next_5",
    text:    "Will the referee reach for a card in the next 5 minutes?",
    type:    "yes_no",
    source:  "scores",
    field:   "cards",
    windowMinutes: 5,
  },
  {
    id:      "card_next_3",
    text:    "A booking in the next 3 minutes?",
    type:    "yes_no",
    source:  "scores",
    field:   "cards",
    windowMinutes: 3,
  },

  // ── ODDS / PROBABILITY ─────────────────────────────────────
  {
    id:       "prob_climb_60",
    text:     "Will {leading}'s win chance climb past 60% in the next 4 minutes?",
    type:     "yes_no",
    source:   "odds",
    field:    "probability",
    threshold: 0.60,
    windowMinutes: 4,
  },
  {
    id:       "prob_climb_70",
    text:     "Will {leading}'s win chance climb past 70% in the next 5 minutes?",
    type:     "yes_no",
    source:   "odds",
    field:    "probability",
    threshold: 0.70,
    windowMinutes: 5,
  },
  {
    id:       "prob_shift_5",
    text:     "Will the market move 5% in the next 3 minutes?",
    type:     "yes_no",
    source:   "odds",
    field:    "probability_shift",
    threshold: 0.05,
    windowMinutes: 3,
  },
  {
    id:       "prob_shift_10",
    text:     "Will the win probability swing 10% in the next 5 minutes?",
    type:     "yes_no",
    source:   "odds",
    field:    "probability_shift",
    threshold: 0.10,
    windowMinutes: 5,
  },
  {
    id:       "prob_stay_above_65",
    text:     "Will {leading} hold above a 65% win chance for the next 4 minutes?",
    type:     "yes_no",
    source:   "odds",
    field:    "probability_hold",
    threshold: 0.65,
    windowMinutes: 4,
  },
  {
    id:       "market_stays_tight",
    text:     "Will {home} and {away} stay within 10% of each other for the next 4 minutes?",
    type:     "yes_no",
    source:   "odds",
    field:    "probability_tight",
    threshold: 0.10,
    windowMinutes: 4,
  },
];

// backend/pundit/generateText.js
//
// PERSONA: a world-class live TV football commentator — the measured authority
// of a lead broadcast voice. Professional, vivid, precise. Builds drama with
// rhythm and word choice, never with slang, hype-words or exclamation spam.

const Groq = require("groq-sdk");
const { GROQ_API_KEY } = require("../config/env");
const groq = new Groq({ apiKey: GROQ_API_KEY });

// Shared persona header keeps every reaction consistent and broadcast-grade.
const PERSONA = `You are the lead live commentator on the World Cup world feed — a seasoned professional broadcast voice in the tradition of the great television commentators.
Style rules you always follow:
- Broadcast English. Polished, precise, authoritative. Present tense.
- Build drama through rhythm and vivid verbs, never slang, never hype-words like "epic" or "insane".
- No emojis, no hashtags, no quotation marks around your own words.
- One single spoken line, natural to say aloud, maximum 22 words.
- You may use a brief dramatic pause written as an ellipsis (…) where a commentator would breathe.`;

async function generatePunditText(event) {
  const { type, data } = event;
  let prompt = "";

  if (type === "kickoff") {
    prompt = `${PERSONA}

The referee's whistle has just gone — ${data.home} against ${data.away} is UNDERWAY at the World Cup.
Deliver ONE opening line of a professional broadcast — the classic "and we are underway" moment. Set the stage, name both teams, controlled anticipation.`;
  }
  else if (type === "half_time") {
    prompt = `${PERSONA}

The referee brings the first half to a close. Halftime: ${data.home} ${data.score} ${data.away}.
Deliver ONE halftime line a lead commentator gives as the players walk off — sum up the state of the contest in a sentence, invite the audience to stay with us.`;
  }
  else if (type === "second_half") {
    prompt = `${PERSONA}

The teams are back out and the second half is underway — ${data.home} ${data.score} ${data.away}.
Deliver ONE "back underway" line, the classic restart call — brisk, fresh energy, forty-five minutes to settle it.`;
  }
  else if (type === "full_time") {
    prompt = `${PERSONA}

The final whistle goes. FULL TIME: ${data.home} ${data.score} ${data.away}.
Deliver ONE full-time call — the definitive closing line of a broadcast, stating the result with the weight it deserves.`;
  }
  else if (type === "question_asked") {
    prompt = `${PERSONA}

The interactive prediction has just gone live for viewers: "${data.question}"
Deliver ONE commentator line inviting the audience in and framing the moment — like a broadcaster teeing up an in-play market. Confident, composed, a touch of intrigue.`;
  }
  else if (type === "prediction_result") {
    const { correct, timingLabel, secondsBefore, question, answer } = data;
    if (correct) {
      prompt = `${PERSONA}

A viewer read the game perfectly. The question was "${question}", they answered ${answer}, and the match proved them right — called it ${timingLabel}, ${secondsBefore} seconds ahead of the market.
Deliver ONE commentator line crediting their reading of the game, the way a broadcaster salutes a sharp pundit's call.`;
    } else {
      prompt = `${PERSONA}

A viewer's call didn't come off. The question was "${question}", they answered ${answer}, and the match went the other way.
Deliver ONE commentator line acknowledging it gracefully — the game is a cruel judge — and keeping them in the contest. Respectful, never mocking.`;
    }
  }
  else if (type === "goal") {
    prompt = `${PERSONA}

GOAL at minute ${data.minute || "now"}. ${data.team} have scored. It is now ${data.score}.
Deliver ONE electrifying goal call — the signature moment of a great commentator. Maximum energy through word choice and rhythm, still controlled and professional.`;
  }
  else if (type === "odds_shift") {
    prompt = `${PERSONA}

The live market has moved sharply: ${data.team}'s win probability has gone from ${data.before}% to ${data.after}%.
Deliver ONE commentator line interpreting what the market is telling us about the flow of this match — the tone of an analyst who understands numbers and football.`;
  }
  else if (type === "red_card") {
    prompt = `${PERSONA}

RED CARD at minute ${data.minute} — ${data.home} against ${data.away}, the score ${data.score}. A player has been sent off.
Deliver ONE commentator line on the dismissal — the gravity of going down to ten men, controlled shock, professional.`;
  }
  else if (type === "commentary") {
    const { minute, homeTeam, awayTeam, homeProb, awayProb, score, period, corners, cards, recentEvents } = data;
    const leading     = homeProb > awayProb ? homeTeam : awayTeam;
    const leadingProb = Math.max(homeProb, awayProb);
    const trailing    = homeProb > awayProb ? awayTeam : homeTeam;
    const phase =
        period === "1H" && String(minute).includes("+") ? "first-half stoppage time"
      : period === "2H" && String(minute).includes("+") ? "second-half stoppage time — the closing moments"
      : period === "1H" ? "the first half"
      : period === "2H" ? "the second half"
      : "extra time";
    const eventsLine = recentEvents && recentEvents.length
      ? `Recent events from the feed: ${recentEvents.join("; ")}.`
      : "No goals, cards or corners in the last few minutes — a quieter spell.";
    prompt = `${PERSONA}

You are LIVE. This is the REAL current state of the match — every fact below is true right now, use ONLY these facts:
- ${homeTeam} ${score} ${awayTeam}, minute ${minute}, ${phase}.
- Market: ${leading} favoured at ${leadingProb}%, ${trailing} at ${Math.min(homeProb, awayProb)}%.
- Match totals so far: ${corners || 0} corners, ${cards || 0} cards.
- ${eventsLine}

Deliver ONE line of live colour commentary about THIS exact moment. Reference something real from the facts above (the scoreline, the phase of the game, a recent event, or what the market is saying). Never invent an incident that is not listed.`;
  }
  else if (type === "reconnecting") {
    return "Bear with us a moment… we are just re-establishing the live feed from the stadium.";
  }

  if (!prompt) return null;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 70,
      temperature: 0.75,
    });
    let text = completion.choices[0]?.message?.content?.trim() || null;
    // Strip any stray surrounding quotes the model adds despite instructions
    if (text) text = text.replace(/^["'“”]+|["'“”]+$/g, "").trim();
    return text || null;
  } catch (e) {
    console.error("[generateText] Groq error:", e.message);
    return null;
  }
}

module.exports = { generatePunditText };

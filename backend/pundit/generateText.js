// backend/pundit/generateText.js

const Groq = require("groq-sdk");
const { GROQ_API_KEY } = require("../config/env");
const groq = new Groq({ apiKey: GROQ_API_KEY });

async function generatePunditText(event) {
  const { type, data } = event;
  let prompt = "";

  if (type === "question_asked") {
    prompt = `You are a sharp UK football pundit commentating live on a World Cup match.
A prediction question just appeared: "${data.question}"
Write ONE pundit line (max 20 words) building excitement. No emojis. Present tense.`;
  }
  else if (type === "prediction_result") {
    const { correct, timingLabel, secondsBefore, question, answer } = data;
    if (correct) {
      prompt = `You are a sharp UK football pundit. A viewer predicted "${question}" correctly, answered ${answer}.
Called it ${timingLabel} — ${secondsBefore} seconds early. ONE line (max 20 words) praising them. No emojis.`;
    } else {
      prompt = `You are a sharp UK football pundit. A viewer predicted "${question}", answered ${answer} — wrong.
ONE line (max 20 words) commiserating, sharp but not harsh. No emojis.`;
    }
  }
  else if (type === "goal") {
    prompt = `You are a sharp UK football pundit. ${data.team} just scored! Score is now ${data.score}.
ONE line (max 20 words). Sound electric. No emojis.`;
  }
  else if (type === "odds_shift") {
    prompt = `You are a sharp UK football pundit. ${data.team} win probability moved from ${data.before}% to ${data.after}%.
ONE line (max 20 words) explaining what the market is saying. No emojis.`;
  }
  else if (type === "commentary") {
    const { minute, homeTeam, awayTeam, homeProb, awayProb, score, period } = data;
    const leading     = homeProb > awayProb ? homeTeam : awayTeam;
    const leadingProb = Math.max(homeProb, awayProb);
    const trailing    = homeProb > awayProb ? awayTeam : homeTeam;
    prompt = `You are a sharp UK football pundit doing live commentary on ${homeTeam} vs ${awayTeam}.
Minute ${minute}, ${period || "in progress"}. Score: ${score}.
${leading} favoured at ${leadingProb}%, ${trailing} at ${Math.min(homeProb, awayProb)}%.
ONE sharp observation (max 20 words). Present tense. No emojis.`;
  }
  else if (type === "reconnecting") {
    return "Bear with us, we are just reconnecting to the live feed.";
  }

  if (!prompt) return null;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 60,
      temperature: 0.8,
    });
    return completion.choices[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error("[generateText] Groq error:", e.message);
    return null;
  }
}

module.exports = { generatePunditText };

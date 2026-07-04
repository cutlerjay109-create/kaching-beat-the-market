// backend/pundit/generateText.js — uses Groq to generate pundit reactions.

const Groq = require("groq-sdk");
const { GROQ_API_KEY } = require("../config/env");

const groq = new Groq({ apiKey: GROQ_API_KEY });

// Generate a pundit reaction to a match event or prediction result.
async function generatePunditText(event) {
  const { type, data } = event;

  let prompt = "";

  if (type === "question_asked") {
    prompt = `You are a sharp, witty UK football pundit commentating live on a World Cup match.
A prediction question just appeared for viewers: "${data.question}"
Write ONE short pundit line (max 20 words) building excitement around this question.
Sound like a real commentator. No emojis. No hashtags. Present tense.`;
  }

  else if (type === "prediction_result") {
    const { correct, timingLabel, secondsBefore, oddsBefore, oddsAfter, question, answer } = data;
    if (correct) {
      prompt = `You are a sharp UK football pundit. A viewer predicted "${question}" and answered ${answer}.
They were correct and called it ${timingLabel} — ${secondsBefore} seconds before the odds moved
(odds shifted from ${Math.round(oddsBefore*100)}% to ${Math.round(oddsAfter*100)}%).
Write ONE pundit line (max 20 words) praising their sharp call. Sound excited and genuine.`;
    } else {
      prompt = `You are a sharp UK football pundit. A viewer predicted "${question}" and answered ${answer}.
They were wrong. The odds moved from ${Math.round((oddsBefore||0.5)*100)}% to ${Math.round((oddsAfter||0.5)*100)}%.
Write ONE pundit line (max 20 words) reacting to the miss. Commiserating but sharp. Not harsh.`;
    }
  }

  else if (type === "goal") {
    prompt = `You are a sharp UK football pundit commentating live. ${data.team} just scored!
Score is now ${data.score}. Write ONE pundit line (max 20 words). Sound electric.`;
  }

  else if (type === "odds_shift") {
    prompt = `You are a sharp UK football pundit. The live odds just shifted significantly.
${data.team}'s win probability moved from ${data.before}% to ${data.after}%.
Write ONE pundit line (max 20 words) explaining what the market is saying. Sharp and informed.`;
  }

  else if (type === "reconnecting") {
    return "Bear with us, we are just reconnecting to the live feed.";
  }

  if (!prompt) return null;

  try {
    const completion = await groq.chat.completions.create({
      model:       "llama-3.3-70b-versatile",
      messages:    [{ role: "user", content: prompt }],
      max_tokens:  60,
      temperature: 0.8,
    });
    return completion.choices[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error("[generateText] Groq error:", e.message);
    return null;
  }
}

module.exports = { generatePunditText };

// browserpod/fate.mjs
// Gemini Fate Weaver — stdin/stdout sidecar for BrowserPod.
// Reads JSON lines: { question, answer, history } from stdin.
// Calls Gemini REST API.
// Writes JSON result to stdout: { effect_type, effect_amount, effect_description, next_question, suggested_choices }.
// The GEMINI_API_KEY is passed in via env when `pod.run` is called.
import { createInterface } from 'readline';

const GEMINI_KEY  = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-1.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function safeResult() {
  return {
    effect_type: 'none',
    effect_amount: 0,
    effect_description: 'The Fates are silent.',
    next_question: 'The echoes fade. Do you continue deeper?',
    suggested_choices: ['Continue', 'Turn back'],
  };
}

async function callGemini(payload) {
  if (!GEMINI_KEY) {
    console.error('[fate] Missing GEMINI_API_KEY'); return safeResult();
  }
  const systemPrompt = [
    'You are the Fate Weaver in a Martian roguelike called Fatebinder.',
    'Players explore caves, mine ore, and make moral decisions that affect future explorers.',
    'Given the latest player free-text answer and the question, produce ONLY a JSON object with keys:',
    'effect_type, effect_amount, effect_description, next_question, suggested_choices.',
    'effect_type is one of: hp_gain, hp_loss, ore_gain, ore_loss, world_event, none',
    'effect_amount is a positive integer (0 if none)',
    'effect_description is a 1-sentence flavour text',
    'next_question is the next fate prompt (1 sentence)',
    'suggested_choices is an array of 2-3 short string options for the next prompt',
    'Never output anything except that JSON object.',
  ].join(' ');

  const body = {
    contents: [{
      parts: [
        { text: systemPrompt },
        { text: 'Game payload (JSON): ' + JSON.stringify(payload) },
      ],
    }],
  };

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error('[fate] Gemini HTTP error', res.status, await res.text());
    return safeResult();
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // Strip markdown fences
  const cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('[fate] JSON parse error', e, 'raw:', text);
    return safeResult();
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on('line', async (line) => {
  try {
    const payload = JSON.parse(line);
    const result = await callGemini(payload);
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error('[fate] processing error:', e);
    console.log(JSON.stringify(safeResult()));
  }
});
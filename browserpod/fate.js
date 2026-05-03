// BrowserPod Node.js Fate Weaver sidecar
// Exposes POST /fate-ai and calls Google Gemini HTTP API
//
// ENVIRONMENT SETUP:
//   1. Install Node.js (v18+ recommended)
//   2. No external npm dependencies required — uses built-in `http` module and native `fetch`
//   3. Required environment variables:
//        GEMINI_API_KEY   — Your Google Gemini API key
//        FATE_POD_PORT    — (optional) port for this server, defaults to 8080
//   4. Run: node fate.js
//   5. The server will listen on FATE_POD_PORT (default 8080) and expose POST /fate-ai
//   6. The main game server must have its FATE_POD_URL env var pointing to this service
//        e.g. FATE_POD_URL=http://localhost:8080/fate-ai node ../server/target/debug/fatebinder-server

const http = require('http');

const PORT = process.env.FATE_POD_PORT || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_KEY) {
  console.error('Missing GEMINI_API_KEY in environment. Set process.env.GEMINI_API_KEY');
}

async function callGeminiFateWeaver({ playerAnswer, worldSummary, previousQuestions }) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not set');

  const prompt = `You are the Fate Weaver, an AI that creates morally-charged consequences in a mining world game.\n\n` +
    `Player answer: "${playerAnswer.replace(/"/g, '\\"')}"\n\n` +
    `World summary: "${worldSummary.replace(/"/g, '\\"')}"\n\n` +
    `Previous questions (most recent first):\n${previousQuestions.slice(0,5).map((q,i)=>`${i+1}. ${q}`).join('\n')}\n\n` +
    `Respond with ONLY valid JSON using this exact schema and nothing else:\n` +
    `{
  "title": string,
  "effect": {
    "hp_delta": integer,
    "ore_multiplier": number,
    "world_note": string
  },
  "next_question": string
}
Make sure the response is strict JSON; do NOT include any markdown, explanation, or extra fields.`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ]
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  // Navigate to data.candidates[0].content.parts[0].text
  try {
    const candidate = data.candidates && data.candidates[0];
    const text = candidate.content.parts[0].text;
    // strip ```json fences if present
    const cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    // basic validation
    if (!parsed.title || !parsed.effect || typeof parsed.next_question !== 'string') {
      throw new Error('Parsed JSON missing required fields');
    }
    return parsed;
  } catch (err) {
    const raw = JSON.stringify(data);
    const e = new Error(`Failed to parse Gemini response as JSON: ${err.message} -- raw: ${raw}`);
    e.raw = data;
    throw e;
  }
}

function jsonResponse(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(s);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/fate-ai') {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body);
      const { playerAnswer, worldSummary, previousQuestions } = payload;
      if (typeof playerAnswer !== 'string') return jsonResponse(res, 400, { error: 'playerAnswer required' });

      const result = await callGeminiFateWeaver({ playerAnswer, worldSummary: worldSummary || '', previousQuestions: previousQuestions || [] });
      return jsonResponse(res, 200, result);
    } catch (err) {
      console.error('Error handling /fate-ai:', err);
      return jsonResponse(res, 500, { error: err.message || String(err) });
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`Fate Pod listening on port ${PORT}`);
});

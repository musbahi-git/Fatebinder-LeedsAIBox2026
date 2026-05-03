// client/main.js — Fatebinder browser client
// Full instrumentation for Fate Weaver flow:
//   FatePrompt -> modal -> BrowserPod+Gemini -> ResolvedMoralChoice -> FateResult
//
// Keys read from window.FATEBINDER_CONFIG (client/config.local.js).
// NEVER put real keys in source.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

// ─────────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────────
const CFG = window.FATEBINDER_CONFIG ?? {};
const BROWSERPOD_API_KEY = CFG.BROWSERPOD_API_KEY ?? '';
const GEMINI_API_KEY     = CFG.GEMINI_API_KEY ?? '';

if (!BROWSERPOD_API_KEY) {
  console.warn('[Fatebinder] Missing BROWSERPOD_API_KEY — set it in client/config.local.js');
}
if (!GEMINI_API_KEY) {
  console.warn('[Fatebinder] Missing GEMINI_API_KEY — set it in client/config.local.js');
}

// ─────────────────────────────────────────────────────────────
//  BROWSERPOD BOOT
// ─────────────────────────────────────────────────────────────
let fatePod     = null;
let fateProcess = null;

async function initFatePod() {
  if (fatePod) return fatePod;
  console.log('[FATE POD] Booting BrowserPod…');
  if (!BROWSERPOD_API_KEY) throw new Error('Missing BROWSERPOD_API_KEY');
  const { BrowserPod } = await import('https://cdn.skypack.dev/@leaningtech/browserpod');
  fatePod = await BrowserPod.boot({ apiKey: BROWSERPOD_API_KEY });
  console.log('[FATE POD] BrowserPod pod booted');
  return fatePod;
}

// ─────────────────────────────────────────────────────────────
//  FATE.MJS SCRIPT  (built as plain strings — no template literals)
//  Written to BrowserPod FS at /fate.mjs and run with `node`.
//  All `${` inside Node template literals are escaped as `${'$'}{...}`
//  so they become literal `${}` in the written file, not JS interpolations.
// ─────────────────────────────────────────────────────────────
async function ensureFateScript(pod) {
  console.log('[FATE POD] Writing /fate.mjs into pod…');
  const file = await pod.createFile('/fate.mjs', 'utf-8');

  const lines = [
    'import readline from "readline";',
    '',
    'const GEMINI_KEY  = process.env.GEMINI_API_KEY;',
    'const GEMINI_MODEL = "gemini-1.5-flash";',
    'const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${"$"}{GEMINI_MODEL}:generateContent`;',
    '',
    'function safeResult() {',
    '  return {',
    '    effect_type: "none",',
    '    effect_amount: 0,',
    '    effect_description: "The Fates are silent.",',
    '    next_question: "The echoes fade. Do you continue deeper?",',
    '    suggested_choices: ["Continue", "Turn back"]',
    '  };',
    '}',
    '',
    'async function callGemini(payload) {',
    '  if (!GEMINI_KEY) {',
    '    console.error("Missing GEMINI_API_KEY");',
    '    return safeResult();',
    '  }',
    '',
    '  const systemPrompt = [',
    '    "You are the Fate Weaver in a Martian roguelike called Fatebinder.",',
    '    "Players explore caves, mine ore, and make moral decisions that affect future explorers.",',
    '    "Given the latest player\'s free-text answer and a short history of previous choices,",',
    '    "produce ONLY a JSON object with keys:",',
    '    "effect_type, effect_amount, effect_description, next_question, suggested_choices.",',
    '    "Never output anything except that JSON object.",',
    '  ].join(" ");',
    '',
    '  const body = {',
    '    contents: [{',
    '      parts: [',
    '        { text: systemPrompt },',
    '        { text: "Game payload (JSON): " + JSON.stringify(payload) }',
    '      ]',
    '    }]',
    '  };',
    '',
    '  const res = await fetch(GEMINI_URL, {',
    '    method: "POST",',
    '    headers: {',
    '      "Content-Type": "application/json",',
    '      "x-goog-api-key": GEMINI_KEY',
    '    },',
    '    body: JSON.stringify(body)',
    '  });',
    '',
    '  if (!res.ok) {',
    '    console.error("Gemini HTTP error", res.status, await res.text());',
    '    return safeResult();',
    '  }',
    '',
    '  const data = await res.json();',
    '  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";',
    '',
    '  try {',
    '    return JSON.parse(text);',
    '  } catch (e) {',
    '    console.error("Gemini JSON parse error", e, text);',
    '    return safeResult();',
    '  }',
    '}',
    '',
    'const rl = readline.createInterface({',
    '  input: process.stdin,',
    '  output: process.stdout,',
    '  terminal: false',
    '});',
    '',
    'rl.on("line", async (line) => {',
    '  try {',
    '    const payload = JSON.parse(line);',
    '    const result = await callGemini(payload);',
    '    console.log(JSON.stringify(result));',
    '  } catch (e) {',
    '    console.error("Fate AI error", e);',
    '    console.log(JSON.stringify(safeResult()));',
    '  }',
    '});',
  ];

  await file.write(lines.join('\n'));
  await file.close();
  console.log('[FATE POD] /fate.mjs written');
}

// ─────────────────────────────────────────────────────────────
//  CALL FATE WEAVER  — the main exported function
// ─────────────────────────────────────────────────────────────
export async function callFateWeaver(input) {
  console.log('[FATE POD] callFateWeaver input:', input);
  const pod = await initFatePod();

  if (!fateProcess) {
    console.log('[FATE POD] Spawning node /fate.mjs process…');
    await ensureFateScript(pod);
    fateProcess = await pod.run('node', ['/fate.mjs'], {
      stdio: 'pipe',
      env: { GEMINI_API_KEY },
    });
    console.log('[FATE POD] Process spawned');
  }

  const line = JSON.stringify(input) + '\n';
  console.log('[FATE POD] Sending payload:', line.trim());
  const resultLine = await fateProcess.request(line);
  console.log('[FATE POD] Raw result:', resultLine);

  try {
    return JSON.parse(resultLine);
  } catch (e) {
    console.error('[FATE POD] JSON parse error:', e, resultLine);
    return {
      effect_type: 'none',
      effect_amount: 0,
      effect_description: 'The Fates are silent.',
      next_question: 'The echoes fade. Do you continue deeper?',
      suggested_choices: ['Continue', 'Turn back'],
    };
  }
}

// ─────────────────────────────────────────────────────────────
//  GLOBAL STATE
// ─────────────────────────────────────────────────────────────
const ROOM_ID = 'test';
let ws             = null;
let myId           = null;
let otherPlayers   = {};
let chunks         = {};
const CHUNK_SIZE   = 16;

let oreCount        = 0;
let lastPingTime    = 0;
let dilemmaActive   = false;   // true while fate modal is shown
let currentQuestion = '';       // question text for the active modal
let moralHistory    = [];       // local cache of past questions/answers

// ─────────────────────────────────────────────────────────────
//  THREE.JS SETUP
// ─────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x440000);
scene.fog        = new THREE.Fog(0x440000, 10, 60);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xff6600, 0x440000, 1.0));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

const controls = new PointerLockControls(camera, document.body);
const instructions = document.getElementById('instructions');
instructions.addEventListener('click', () => controls.lock());
controls.addEventListener('lock',   () => { instructions.style.display = 'none'; });
controls.addEventListener('unlock', () => { instructions.style.display = 'flex';  });

// ─────────────────────────────────────────────────────────────
//  PROCEDURAL WORLD
// ─────────────────────────────────────────────────────────────
const simplex = new SimplexNoise();
const voxelGeometry = new THREE.BoxGeometry(1, 1, 1);
const voxelMaterial = new THREE.MeshLambertMaterial({ color: 0xcc4400 });

class Chunk {
  constructor(cx, cy, cz) {
    this.cx = cx; this.cy = cy; this.cz = cz;
    this.voxels = new Int8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
    this.mesh = null;
    this.generate();
    this.buildMesh();
  }

  generate() {
    const ox = this.cx * CHUNK_SIZE, oy = this.cy * CHUNK_SIZE, oz = this.cz * CHUNK_SIZE;
    let i = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const nx = (ox + x) / 15, ny = (oy + y) / 15, nz = (oz + z) / 15;
          if (simplex.noise3d(nx, ny, nz) > 0.3) this.voxels[i] = 1;
          i++;
        }
      }
    }
  }

  buildMesh() {
    if (this.mesh) { scene.remove(this.mesh); if (this.mesh.geometry !== voxelGeometry) this.mesh.geometry.dispose(); }
    let count = 0;
    for (let i = 0; i < this.voxels.length; i++) if (this.voxels[i] === 1) count++;
    if (count === 0) return;
    this.mesh = new THREE.InstancedMesh(voxelGeometry, voxelMaterial, count);
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          if (this.voxels[x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE] === 1) {
            dummy.position.set(this.cx * CHUNK_SIZE + x, this.cy * CHUNK_SIZE + y, this.cz * CHUNK_SIZE + z);
            dummy.updateMatrix();
            this.mesh.setMatrixAt(idx++, dummy.matrix);
          }
        }
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  setVoxel(x, y, z, solid) {
    if (x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || y >= CHUNK_SIZE || z >= CHUNK_SIZE) return;
    this.voxels[x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE] = solid ? 1 : 0;
  }

  removeVoxel(x, y, z) {
    const idx = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE;
    if (this.voxels[idx] === 1) { this.voxels[idx] = 0; this.buildMesh(); return true; }
    return false;
  }
}

function updateWorld() {
  const pcx = Math.floor(camera.position.x / CHUNK_SIZE);
  const pcy = Math.floor(camera.position.y / CHUNK_SIZE);
  const pcz = Math.floor(camera.position.z / CHUNK_SIZE);
  const activeChunks = new Set();
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const key = `${pcx + x},${pcy + y},${pcz + z}`;
        activeChunks.add(key);
        if (!chunks[key]) chunks[key] = new Chunk(pcx + x, pcy + y, pcz + z);
      }
    }
  }
  for (const key in chunks) {
    if (!activeChunks.has(key)) {
      if (chunks[key].mesh) scene.remove(chunks[key].mesh);
      delete chunks[key];
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  INPUT
// ─────────────────────────────────────────────────────────────
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
let prevTime = performance.now();

document.addEventListener('keydown', e => {
  switch (e.code) {
    case 'ArrowUp':    case 'KeyW': moveForward  = true; break;
    case 'ArrowLeft':  case 'KeyA': moveLeft     = true; break;
    case 'ArrowDown':  case 'KeyS': moveBackward = true; break;
    case 'ArrowRight': case 'KeyD': moveRight    = true; break;
  }
});
document.addEventListener('keyup', e => {
  switch (e.code) {
    case 'ArrowUp':    case 'KeyW': moveForward  = false; break;
    case 'ArrowLeft':  case 'KeyA': moveLeft     = false; break;
    case 'ArrowDown':  case 'KeyS': moveBackward = false; break;
    case 'ArrowRight': case 'KeyD': moveRight    = false; break;
  }
});

// ─────────────────────────────────────────────────────────────
//  WEBSOCKET + MESSAGE DISPATCHER
// ─────────────────────────────────────────────────────────────
function connect() {
  ws = new WebSocket('ws://localhost:3000');

  ws.onopen = () => {
    console.log('[WS] Connected to server');
    document.getElementById('hud-room').innerText = `Room: ${ROOM_ID}`;
    ws.send(JSON.stringify({ Join: { room_id: ROOM_ID, name: 'Miner_' + Math.floor(Math.random() * 1000) } }));
    setInterval(() => { lastPingTime = performance.now(); }, 1000);
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    console.log('[WS MESSAGE]', msg);

    // ── FatePrompt ──────────────────────────────────────────────
    if (msg.FatePrompt) {
      const { question, choices } = msg.FatePrompt;
      console.log('[FATE PROMPT] question:', question, '| choices:', choices);
      currentQuestion = question;
      showFateModal(question, choices);
      return;
    }

    // ── FateResult ─────────────────────────────────────────────
    if (msg.FateResult) {
      const { effect } = msg.FateResult;
      console.log('[FATE RESULT] Server says:', effect);
      hudLog('Fate: ' + effect);
      showEchoNotification('Fate: ' + effect);
      return;
    }

    // ── ResolvedFate (full AI resolution) ──────────────────────
    if (msg.ResolvedFate) {
      const rf = msg.ResolvedFate;
      console.log('[RESOLVED FATE]', rf);
      if (rf.player_id === myId && rf.effect) {
        const hpEl = document.getElementById('hud-hp');
        if (hpEl) {
          const cur = parseInt(hpEl.innerText.replace(/[^0-9-]/g, ''), 10) || 100;
          hpEl.innerText = `HP: ${Math.max(0, Math.min(100, cur + rf.effect.hp_delta))}`;
        }
        const oreEl = document.getElementById('hud-ore');
        if (oreEl) {
          const cur = parseInt(oreEl.innerText.replace(/[^0-9-]/g, ''), 10) || 0;
          oreEl.innerText = `Ore: ${Math.round(cur * rf.effect.ore_multiplier)}`;
        }
      }
      moralHistory.push({
        question:  rf.next_question || '(AI next)',
        answer:    rf.player_answer,
        title:     rf.title,
        world_note: rf.effect?.world_note ?? '',
        timestamp:  Date.now(),
      });
      showEchoNotification(`Fate: ${rf.title} — ${rf.effect?.world_note ?? ''}`);
      return;
    }

    // ── StateSync ───────────────────────────────────────────────
    if (msg.StateSync) {
      const sync = msg.StateSync;
      for (const [uuid, pData] of Object.entries(sync.players)) {
        if (uuid === myId) {
          oreCount = pData.ore_count ?? oreCount;
          document.getElementById('hud-ore').innerText = `Ore: ${oreCount}`;
          continue;
        }
        if (!otherPlayers[uuid]) {
          const mesh = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.5, 1, 4, 8),
            new THREE.MeshLambertMaterial({ color: 0x00ff00 }),
          );
          scene.add(mesh);
          otherPlayers[uuid] = { mesh, targetPos: new THREE.Vector3().fromArray(pData.position) };
        } else {
          otherPlayers[uuid].targetPos.fromArray(pData.position);
        }
      }
      for (const uuid in otherPlayers) {
        if (!sync.players[uuid]) { scene.remove(otherPlayers[uuid].mesh); delete otherPlayers[uuid]; }
      }

      if (sync.chunk_deltas) {
        const grouped = new Map();
        for (const d of sync.chunk_deltas) {
          const key = `${d.chunk_x},${d.chunk_y},${d.chunk_z}`;
          (grouped.get(key) ?? (grouped.set(key, []), grouped.get(key))).push(d);
        }
        for (const [key, changes] of grouped.entries()) {
          if (!chunks[key]) {
            const [cx, cy, cz] = key.split(',').map(Number);
            chunks[key] = new Chunk(cx, cy, cz);
          }
          const c = chunks[key];
          for (const ch of changes) c.setVoxel(ch.x, ch.y, ch.z, ch.solid);
          c.buildMesh();
        }
      }
      return;
    }

    // ── Welcome ─────────────────────────────────────────────────
    if (msg.Welcome) {
      myId = msg.Welcome.id;
      console.log('[WS] Welcome, my id:', myId);
      camera.position.set(8, 32, 8);
      return;
    }

    // ── FateEvent ───────────────────────────────────────────────
    if (msg.FateEvent) {
      const msgDiv = document.getElementById('hud-msg');
      msgDiv.innerText = msg.FateEvent.msg;
      let shakeTime = 0.5;
      const iv = setInterval(() => {
        if (shakeTime <= 0) { clearInterval(iv); setTimeout(() => { msgDiv.innerText = ''; }, 3000); return; }
        camera.position.x += (Math.random() - 0.5) * 0.5;
        camera.position.y += (Math.random() - 0.5) * 0.5;
        camera.position.z += (Math.random() - 0.5) * 0.5;
        shakeTime -= 0.05;
      }, 50);
      return;
    }

    // ── Error ───────────────────────────────────────────────────
    if (msg.Error) {
      console.error('[WS] Server error:', msg.Error);
    }
  };

  ws.onclose = () => {
    document.getElementById('hud-room').innerText = 'Disconnected. Retrying…';
    setTimeout(connect, 3000);
  };
}

connect();

// ─────────────────────────────────────────────────────────────
//  FATE MODAL
// ─────────────────────────────────────────────────────────────
function showFateModal(question, choices) {
  dilemmaActive = true;
  const modal      = document.getElementById('fate-modal');
  const questionEl = document.getElementById('fate-question');
  const choicesEl  = document.getElementById('fate-choices');

  questionEl.textContent = question;
  choicesEl.innerHTML = '';

  // Quick-choice buttons pre-fill the textarea
  for (const choice of choices) {
    const btn = document.createElement('button');
    btn.className = 'fate-btn';
    btn.textContent = choice;
    btn.addEventListener('click', () => {
      document.getElementById('fate-answer').value = choice;
    });
    choicesEl.appendChild(btn);
  }

  modal.classList.add('show');
  document.getElementById('fate-answer').value = '';
  document.getElementById('fate-answer').focus();
}

// Submit button from index.html — bound once here so it works even if the
// script module runs before the DOM is fully painted.
document.getElementById('fate-submit').addEventListener('click', async () => {
  if (!dilemmaActive) return;
  const answer = document.getElementById('fate-answer').value.trim();
  if (!answer) { alert('Please enter an answer first.'); return; }
  const question = currentQuestion;
  dilemmaActive = false;
  document.getElementById('fate-modal').classList.remove('show');
  await submitFateQuestion(question, answer);
});

function showEchoNotification(text) {
  const n = document.getElementById('echoNotif');
  n.textContent = text;
  n.style.display = 'block';
  setTimeout(() => { n.style.display = 'none'; }, 6000);
}

function hudLog(text) {
  const el = document.getElementById('hud-msg');
  if (el) el.innerText = text;
}

// ─────────────────────────────────────────────────────────────
//  SUBMIT FATE QUESTION — BrowserPod + Gemini, then server
// ─────────────────────────────────────────────────────────────
async function submitFateQuestion(question, answer) {
  console.log('[FATE] submitFateQuestion called', { question, answer });

  const hp  = document.getElementById('hud-hp')?.innerText.replace(/[^0-9-]/g, '') || '100';
  const ore = document.getElementById('hud-ore')?.innerText.replace(/[^0-9-]/g, '') || '0';

  const payload = {
    question,
    answer,
    worldSummary: `HP:${hp} Ore:${ore}`,
    previousQuestions: moralHistory.slice(-5).map(h => h.question || h.title || ''),
  };

  let ai;
  try {
    ai = await callFateWeaver(payload);
    console.log('[FATE] callFateWeaver returned:', ai);
  } catch (e) {
    console.error('[FATE] callFateWeaver threw:', e);
    ai = {
      effect_type: 'none',
      effect_amount: 0,
      effect_description: 'The Fates are silent.',
      next_question: 'The echoes fade. Do you continue deeper?',
      suggested_choices: ['Continue', 'Turn back'],
    };
  }

  // Map effect_type -> hp_delta / ore_multiplier for the Rust server
  const hpDelta = ai.effect_type === 'hp_gain'  ?  ai.effect_amount
                : ai.effect_type === 'hp_loss'  ? -ai.effect_amount : 0;
  const oreMult = ai.effect_type === 'ore_gain' ? 1.0 + ai.effect_amount / 100
                : ai.effect_type === 'ore_loss' ? 1.0 - ai.effect_amount / 100 : 1.0;

  const fateEffect = {
    hp_delta:          hpDelta,
    ore_multiplier:    oreMult,
    world_note:        ai.effect_description,
    effect_type:       ai.effect_type,
    effect_amount:     ai.effect_amount,
    suggested_choices: ai.suggested_choices ?? ['Continue', 'Turn back'],
  };

  console.log('[FATE] Sending ResolvedMoralChoice:', {
    player_id:    myId,
    title:        ai.effect_description.split('.')[0] || 'Fate resolved',
    effect:       fateEffect,
    next_question: ai.next_question,
    player_answer: answer,
  });

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      ResolvedMoralChoice: {
        player_id:     myId,
        title:         ai.effect_description.split('.')[0] || 'Fate resolved',
        effect:        fateEffect,
        next_question: ai.next_question,
        player_answer: answer,
      },
    }));
  }

  showEchoNotification(`Fate: ${ai.effect_description}`);
}

// ─────────────────────────────────────────────────────────────
//  POSITION BROADCAST (~10 Hz)
// ─────────────────────────────────────────────────────────────
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN && controls.isLocked) {
    const p = camera.position;
    ws.send(JSON.stringify({ Move: { position: [p.x, p.y, p.z], rotation: [0, 0] } }));
  }
}, 100);

// ─────────────────────────────────────────────────────────────
//  MINING
// ─────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const particles = [];

function createMineParticles(pos) {
  const count = 20;
  const positions = new Float32Array(count * 3);
  const velocities = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3]     = pos.x;
    positions[i * 3 + 1] = pos.y;
    positions[i * 3 + 2] = pos.z;
    velocities.push(new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5));
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const pts = new THREE.Points(geom, new THREE.PointsMaterial({ color: 0xcc4400, size: 0.2 }));
  scene.add(pts);
  particles.push({ mesh: pts, velocities, age: 0 });
}

document.addEventListener('mousedown', e => {
  if (!controls.isLocked || e.button !== 0 || dilemmaActive) return;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  let bestDst = Infinity, best = null, bestChunk = null;
  for (const key in chunks) {
    if (!chunks[key].mesh) continue;
    const hits = raycaster.intersectObject(chunks[key].mesh);
    if (hits.length > 0 && hits[0].distance < 8 && hits[0].distance < bestDst) {
      bestDst = hits[0].distance; best = hits[0]; bestChunk = chunks[key];
    }
  }
  if (bestChunk && best) {
    const p = best.point.clone().sub(best.face.normal.clone().multiplyScalar(0.5));
    const gx = Math.round(p.x), gy = Math.round(p.y), gz = Math.round(p.z);
    let lx = ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    let ly = ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    let lz = ((gz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    if (bestChunk.removeVoxel(lx, ly, lz)) {
      createMineParticles(new THREE.Vector3(gx, gy, gz));
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          Mine: { chunk_x: bestChunk.cx, chunk_y: bestChunk.cy, chunk_z: bestChunk.cz, x: lx, y: ly, z: lz },
        }));
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────
//  RENDER LOOP
// ─────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const delta = (now - prevTime) / 1000;
  prevTime = now;

  updateWorld();

  if (controls.isLocked) {
    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;
    velocity.y -= 9.8 * 2.0 * delta;
    direction.z = Number(moveForward) - Number(moveBackward);
    direction.x = Number(moveRight) - Number(moveLeft);
    direction.normalize();
    const speed = 50.0;
    if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
    if (moveLeft   || moveRight)    velocity.x -= direction.x * speed * delta;
    controls.moveRight(-velocity.x * delta);
    controls.moveForward(-velocity.z * delta);
    camera.position.y += velocity.y * delta;
    if (camera.position.y < 32) { velocity.y = 0; camera.position.y = 32; }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += delta;
    if (p.age > 0.5) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      particles.splice(i, 1);
    } else {
      const pos = p.mesh.geometry.attributes.position.array;
      for (let j = 0; j < pos.length; j += 3) {
        pos[j]     += p.velocities[j / 3].x * delta;
        pos[j + 1] += p.velocities[j / 3].y * delta;
        pos[j + 2] += p.velocities[j / 3].z * delta;
        p.velocities[j / 3].y -= 9.8 * delta;
      }
      p.mesh.geometry.attributes.position.needsUpdate = true;
    }
  }

  for (const uuid in otherPlayers) {
    otherPlayers[uuid].mesh.position.lerp(otherPlayers[uuid].targetPos, 0.2);
  }

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

console.log('3D Multiplayer Ready  (BrowserPod + Gemini instrumented)');
animate();
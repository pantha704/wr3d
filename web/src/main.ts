/**
 * Browser build. Owns nothing but presentation + input:
 * the simulation lives in ./sim and is shared with the Roblox port.
 */
import * as THREE from 'three';
import { FRAME_RATE, STAT } from './sim/formulas';
import { createMatch, type Fighter } from './sim/match';
import { createArenaFromMatch, stepArena, drainEvents, type Intent, ARENA_RADIUS } from './sim/arena';
import { aiIntent, createAiMemory } from './sim/ai';
import { mulberry32 } from './sim/prng';
import { mountTouchControls } from './ui/touch';
import { mountErrorBoundary, mountIntro } from './ui/shell';
import { applyResult, load as loadRecord, save as saveRecord, type MatchRecord } from './state/record';
import roster from '../../shared/data/roster.generated.json';

type RosterEntry = {
  id: number;
  name: string;
  epithet?: string;
  stats: Record<string, number>;
};

const SEED = 20261024;
const rng = mulberry32(SEED);
const aiRng = mulberry32(SEED + 7);
let aiMem = createAiMemory();
let record: MatchRecord = loadRecord(localStorage);
let resultCounted = false;

function statVector(entry: RosterEntry): number[] {
  const v = new Array(9).fill(0);
  for (const [name, idx] of Object.entries(STAT)) {
    v[idx as number] = entry.stats[name] ?? 70;
  }
  return v;
}

function pickTwo(): [RosterEntry, RosterEntry] {
  const a = roster[0] as RosterEntry;
  const b = roster[1 + (Math.floor(rng() * (roster.length - 1)) % (roster.length - 1))] as RosterEntry;
  return [a, b];
}

let [heroEntry, rivalEntry] = pickTwo();

function newArena() {
  return createArenaFromMatch(createMatch(
    { id: 1, name: heroEntry.name, stats: statVector(heroEntry) },
    { id: 2, name: rivalEntry.name, stats: statVector(rivalEntry) },
  ));
}

let arena = newArena();

// ---------------------------------------------------------------- scene
const viewport = document.getElementById('viewport')!;
const hud = document.getElementById('hud')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = false;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0d);
scene.fog = new THREE.Fog(0x0b0b0d, 16, 34);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x14141a, 1.15));
const key = new THREE.DirectionalLight(0xffffff, 1.35);
key.position.set(4, 9, 6);
scene.add(key);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(26, 18),
  new THREE.MeshStandardMaterial({ color: 0x161c26, roughness: 0.95 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const ringMesh = new THREE.Mesh(
  new THREE.RingGeometry(ARENA_RADIUS, ARENA_RADIUS + 0.3, 72),
  new THREE.MeshBasicMaterial({ color: 0x4a6fa5, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
);
ringMesh.rotation.x = -Math.PI / 2;
ringMesh.position.y = 0.01;
scene.add(ringMesh);

const COLORS = [0xff6b57, 0x57b0ff];

function makeFighterMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 1.05, 6, 16),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 }),
  );
  body.position.y = 1.0;
  body.name = 'body';
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 20, 16),
    new THREE.MeshStandardMaterial({ color: 0xffd9c0, roughness: 0.8 }),
  );
  head.position.y = 1.92;
  g.add(head);
  return g;
}

const meshes = COLORS.map((c) => {
  const m = makeFighterMesh(c);
  scene.add(m);
  return m;
});

// ---------------------------------------------------------------- input
const held = new Set<string>();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  held.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === 'r') restart();
});
addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));

function playerIntent(): Intent {
  const left = held.has('a') || held.has('arrowleft');
  const right = held.has('d') || held.has('arrowright');
  const up = held.has('w') || held.has('arrowup');
  const down = held.has('s') || held.has('arrowdown');
  const pad = touchIntent();
  return {
    moveX: clamp((right ? 1 : 0) - (left ? 1 : 0) + pad.moveX),
    moveZ: clamp((down ? 1 : 0) - (up ? 1 : 0) + pad.moveZ),
    strike: held.has('j') || held.has(' ') || pad.strike,
    grapple: held.has('k') || pad.grapple,
  };
}

const clamp = (v: number): number => Math.max(-1, Math.min(1, v));

// ---------------------------------------------------------------- hud
hud.innerHTML = `
  <h2>Match</h2>
  <div id="fighters" role="group" aria-label="Fighter status"></div>
  <div id="record" class="hint"></div>
  <h2>Controls</h2>
  <p class="hint">Move <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · Strike <kbd>J</kbd> / Space · Grapple <kbd>K</kbd> · Rematch <kbd>R</kbd></p>
  <p class="hint">seed ${SEED} · 18 Hz</p>
  <h2>Feed</h2>
  <div id="log" aria-live="polite" aria-atomic="false"></div>
  <div id="result" hidden></div>
`;

const touchIntent = mountTouchControls(viewport);

const fightersEl = hud.querySelector<HTMLDivElement>('#fighters')!;
const logEl = hud.querySelector<HTMLDivElement>('#log')!;
const resultEl = hud.querySelector<HTMLDivElement>('#result')!;
const recordEl = hud.querySelector<HTMLDivElement>('#record')!;

function renderRecord(): void {
  recordEl.textContent =
    record.wins + record.losses === 0
      ? 'no matches yet'
      : `${record.wins}W · ${record.losses}L` + (record.lastOpponent ? ` · last vs ${record.lastOpponent}` : '');
}

function log(line: string): void {
  logEl.textContent = `${line}\n${logEl.textContent ?? ''}`.slice(0, 3000);
}

function bar(f: Fighter): string {
  const hpPct = Math.max(0, (f.health / f.maxHealth) * 100);
  const poisePct = Math.max(0, Math.min(100, (f.poise / 1000) * 100));
  return `
    <div class="fighter">
      <div class="name">${f.name}</div>
      <div class="bar hp" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${hpPct.toFixed(0)}" aria-label="${f.name} health">
        <i style="width:${hpPct.toFixed(1)}%"></i>
      </div>
      <div class="meta"><span>HP ${Math.round(f.health)} / ${f.maxHealth}</span><span>${hpPct.toFixed(0)}%</span></div>
      <div class="bar poise"><i style="width:${poisePct.toFixed(1)}%"></i></div>
      <div class="meta"><span>POISE ${Math.round(f.poise)}</span><span>cap ${Math.round(f.maxHealth / 5)}</span></div>
    </div>`;
}

function renderHud(): void {
  fightersEl.innerHTML = arena.match.fighters.map(bar).join('');
  if (arena.match.over) {
    settle();
    resultEl.hidden = false;
    resultEl.textContent = `${arena.match.winner?.name ?? 'nobody'} wins — press R for a rematch`;
  } else {
    resultEl.hidden = true;
  }
}

function settle(): void {
  if (resultCounted) return;
  resultCounted = true;
  const won = arena.match.winner?.id === 1;
  record = applyResult(record, won, arena.match.fighters[1]!.name);
  saveRecord(localStorage, record);
  renderRecord();
}

// ---------------------------------------------------------------- loop
function restart(): void {
  [heroEntry, rivalEntry] = pickTwo();
  arena = newArena();
  aiMem = createAiMemory();
  resultCounted = false;
  logEl.textContent = '';
  log(`sim 18 Hz · ${heroEntry.name} vs ${rivalEntry.name}`);
  renderHud();
  renderRecord();
}

const TICK_MS = 1000 / FRAME_RATE; // 18 Hz, spec §0
let acc = 0;
let last = performance.now();

function syncMeshes(): void {
  arena.match.fighters.forEach((f, i) => {
    const m = meshes[i]!;
    m.position.set(f.x, 0, f.z);
    m.rotation.y = -f.facing + Math.PI / 2;
    const body = m.getObjectByName('body') as THREE.Mesh;
    const winding = arena.combat[i]!.windup > 0;
    body.scale.setScalar(reducedMotion ? 1 : winding ? 1.12 : 1);
  });
}

function frame(now: number): void {
  const dt = Math.min(now - last, 200);
  last = now;
  acc += dt;

  while (acc >= TICK_MS && !arena.match.over) {
    acc -= TICK_MS;
    stepArena(arena, [playerIntent(), aiIntent(
      arena.match.fighters[1]!,
      arena.match.fighters[0]!,
      aiMem,
      aiRng,
    )], rng);
    const events = drainEvents(arena);
    for (const e of events) log(e);
    if (events.length) renderHud();
  }
  if (arena.match.over && acc >= TICK_MS) {
    acc = 0;
    renderHud();
  }

  syncMeshes();

  const mid = {
    x: (arena.match.fighters[0]!.x + arena.match.fighters[1]!.x) / 2,
    z: (arena.match.fighters[0]!.z + arena.match.fighters[1]!.z) / 2,
  };
  camera.position.lerp(new THREE.Vector3(mid.x * 0.6, 5.6, mid.z * 0.6 + 9.8), reducedMotion ? 1 : 0.12);
  camera.lookAt(mid.x * 0.4, 1.2, mid.z * 0.4);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize(): void {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
mountErrorBoundary();
mountIntro(() => log('fight'));
restart();
requestAnimationFrame(frame);

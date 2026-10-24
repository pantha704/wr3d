/**
 * Grey-box: proves the sim runs at the shipped 18 Hz tick and drives a 3D view.
 * No art, no input beyond buttons — this exists to validate loop + state.
 */
import * as THREE from 'three';
import { mulberry32 } from './sim/prng';
import { STAT, FRAME_RATE } from './sim/formulas';
import { applyStrike, createMatch, stepMatch, type Fighter, type MatchState } from './sim/match';

const rng = mulberry32(20261024);

// ---------------------------------------------------------------- stats
const stat = (o: Partial<Record<keyof typeof STAT, number>>): number[] => {
  const v = new Array(9).fill(0);
  v[STAT.Popularity] = o.Popularity ?? 70;
  v[STAT.Strength] = o.Strength ?? 75;
  v[STAT.Skill] = o.Skill ?? 75;
  v[STAT.Agility] = o.Agility ?? 75;
  v[STAT.Stamina] = o.Stamina ?? 70;
  v[STAT.Toughness] = o.Toughness ?? 75;
  v[STAT.Attitude] = o.Attitude ?? 75;
  v[STAT.Happiness] = o.Happiness ?? 75;
  return v;
};

let match: MatchState = createMatch(
  { id: 1, name: 'Mat Dickie', stats: stat({ Strength: 75, Toughness: 65 }) },
  { id: 2, name: 'Sumorai', stats: stat({ Strength: 80, Toughness: 70 }), charHealth: 92 },
);

// ---------------------------------------------------------------- scene
const viewport = document.getElementById('viewport')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0d);
scene.fog = new THREE.Fog(0x0b0b0d, 14, 30);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 5.2, 9.5);
camera.lookAt(0, 1.1, 0);

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x14141a, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(4, 9, 6);
scene.add(key);

const mat = new THREE.Mesh(new THREE.PlaneGeometry(24, 16), new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.95 }));
mat.rotation.x = -Math.PI / 2;
scene.add(mat);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(5.2, 5.5, 64),
  new THREE.MeshBasicMaterial({ color: 0x4a6fa5, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.01;
scene.add(ring);

const COLORS = [0xff6b57, 0x57b0ff];

function makeFighterMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 1.1, 6, 16),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 }),
  );
  body.position.y = 1.0;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 20, 16),
    new THREE.MeshStandardMaterial({ color: 0xffd9c0, roughness: 0.8 }),
  );
  head.position.y = 1.95;
  g.add(head);
  return g;
}

const meshes = match.fighters.map((f, i) => {
  const m = makeFighterMesh(COLORS[i]!);
  m.position.set(i === 0 ? -1.6 : 1.6, 0, 0);
  m.rotation.y = i === 0 ? Math.PI / 2 : -Math.PI / 2;
  scene.add(m);
  return m;
});

// ---------------------------------------------------------------- hud
const hud = document.getElementById('hud')!;
hud.innerHTML = `
  <h2>Match</h2>
  <div id="fighters"></div>
  <h2>Actions</h2>
  <button class="primary" id="strikeA">Strike — Mat Dickie (x2)</button>
  <button id="powerA">Power strike — Mat Dickie (x6)</button>
  <button class="primary" id="strikeB">Strike — Sumorai (x2)</button>
  <button id="reset">Reset match</button>
  <div id="log"></div>
`;

const logEl = hud.querySelector<HTMLDivElement>('#log')!;
const fightersEl = hud.querySelector<HTMLDivElement>('#fighters')!;

function log(line: string): void {
  logEl.textContent = `${line}\n${logEl.textContent ?? ''}`.slice(0, 4000);
}

function bar(f: Fighter): string {
  const hpPct = (f.health / f.maxHealth) * 100;
  const poisePct = Math.max(0, Math.min(100, (f.poise / 1000) * 100));
  return `
    <div class="fighter">
      <div class="name">${f.name}</div>
      <div class="bar hp"><i style="width:${hpPct.toFixed(1)}%"></i></div>
      <div class="meta"><span>HP ${Math.round(f.health)} / ${f.maxHealth}</span><span>${hpPct.toFixed(1)}%</span></div>
      <div class="bar poise"><i style="width:${poisePct.toFixed(1)}%"></i></div>
      <div class="meta"><span>POISE ${Math.round(f.poise)}</span><span>cap ${Math.round(f.maxHealth / 5)}</span></div>
    </div>`;
}

function renderHud(): void {
  fightersEl.innerHTML = match.fighters.map(bar).join('');
}

// ---------------------------------------------------------------- loop
const TICK_MS = 1000 / FRAME_RATE; // 18 Hz, matches MainTimeline.as:131192
let acc = 0;
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(now - last, 250);
  last = now;
  acc += dt;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    stepMatch(match);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function hit(attackerIdx: 0 | 1, mult: number): void {
  if (match.over) return;
  const atk = match.fighters[attackerIdx];
  const def = match.fighters[attackerIdx === 0 ? 1 : 0];
  const res = applyStrike(atk, def, mult, rng);
  log(
    `f${match.frame} ${atk.name} x${mult} → ${def.name}: -${res.damage} hp, -${res.poiseLoss.toFixed(0)} poise` +
      (res.knockedDown ? ' · KNOCKDOWN' : ''),
  );
  renderHud();
}

hud.querySelector<HTMLButtonElement>('#strikeA')!.onclick = () => hit(0, 2);
hud.querySelector<HTMLButtonElement>('#powerA')!.onclick = () => hit(0, 6);
hud.querySelector<HTMLButtonElement>('#strikeB')!.onclick = () => hit(1, 2);
hud.querySelector<HTMLButtonElement>('#reset')!.onclick = () => {
  match = createMatch(
    { id: 1, name: 'Mat Dickie', stats: stat({ Strength: 75, Toughness: 65 }) },
    { id: 2, name: 'Sumorai', stats: stat({ Strength: 80, Toughness: 70 }), charHealth: 92 },
  );
  logEl.textContent = '';
  renderHud();
};

function resize(): void {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderHud();
log('sim tick 18 Hz · 10,000 HP · poise gate active');
requestAnimationFrame(frame);

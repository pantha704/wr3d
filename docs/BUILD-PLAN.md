# WR3D — build plan: web + Roblox

Target: rebuild `Wrestling Revolution 3D` (air.WR3DFree 1.750.64) as (a) a browser game and (b) a Roblox experience, from the reverse-engineered spec in `docs/`.

## 0. What we are actually rebuilding

| Part | Difficulty | Why |
|---|---|---|
| Mechanics / sim | **easy** | fully extracted, 271 code citations, formulas are plain arithmetic |
| Roster data | **easy** | 300 chars, 335-field schema solved, `roster_game.json` ready |
| Career / booking economy | **easy** | formulas + tables extracted |
| Menus / UI | **medium** | ~40 screens in the original, but they are conventional UI |
| **3D visuals + animation** | **hard** | the original uses **Flare3D** (`flare/core/Pivot3D.as`, `flare/flsl/FLSLEngine.as`) — a Flash 3D engine. Meshes + limb animations live inside the SWF as AS3 data, not as glTF. This is a re-authoring job, not a conversion. |

Everything except the art pipeline ports 1:1. Plan the schedule around that: mechanics first, visuals second.

## 1. Cross-platform strategy: one truth, two renderers

Do **not** write the sim twice. Write it once as a pure, engine-free reference and make both platforms conform to it.

```
shared/
  data/roster.json          # 300 characters
  data/anim-table.json      # anim id -> range/angle/pain/speed (extracted)
  data/economy.json         # worth/salary/manager/gate tables
  vectors/*.json            # conformance test vectors (input -> expected output)
  SPEC.md                   # the 245 KB mechanics spec
```

Both `web/` and `roblox/` must pass the **same vector files**. That is the whole trick: the sim is arithmetic, so it can be pinned by golden values regardless of language.

Generate the vectors once from a reference implementation (TypeScript), then Luau must match them exactly. Any drift is caught in CI, not by playing the game.

## 2. Web stack

| Concern | Choice | Why |
|---|---|---|
| Build | **Vite + TypeScript** (strict) | instant HMR, zero config, static output |
| Package | **pnpm** | fast, disk-efficient (VPS has 17 GB free) |
| 3D | **Three.js** r16x | mature, small, matches Flare3D's scope (3D scene, no heavy engine) |
| Physics | **none** | the original is kinematic — positions, not rigid bodies. Do not introduce a physics engine |
| ECS / loop | **bitecs** (ECS) + fixed `1/18 s` tick | the original is frame-locked at 18 fps; a fixed tick is mandatory for identical behaviour |
| Animation | Three.js `AnimationMixer`, clips keyed by the recovered anim-id table | keeps the extracted tables valid |
| Menus/UI | **React + Tailwind**, rendered as a DOM overlay above the canvas | career mode is 40 screens of forms/lists; do not build that in WebGL |
| State | **Zustand** | small, no boilerplate, survives React overlay |
| Save | **Dexie** (IndexedDB), schema mirrors the 5 `SharedObject`s | drop-in port of `System`/`Career`/`Characters`/`Rosters`/`Options` |
| Audio | **Howler.js** | simple, handles sprite/loop needs |
| Tests | **Vitest** + the shared vectors | CI gate |
| Deploy | **Cloudflare Pages** | free, fast, already in the stack |
| Multiplayer (later) | **Cloudflare Durable Objects** | one DO per match = authoritative 18 Hz loop |

Determinism rules (non-negotiable, from the source):
- port `Rnd(min,max)` as `Math.round(rng() * (max - min)) + min` — **endpoints get half weight**, this changes distributions
- use one seeded PRNG (`mulberry32`), never `Math.random()`
- all arrays 1-indexed in the spec → subtract 1 at the boundary only

## 3. Roblox stack

| Concern | Choice | Why |
|---|---|---|
| Sync | **Rojo 7** (`default.project.json`) | files ↔ Studio, git-friendly |
| Language | **Luau** + **Selene** (lint) + **StyLua** (format) | standard toolchain |
| Architecture | **Knit** (services/controllers) | matches the "one big state machine" shape without a monolith |
| Packages | **Wally** (only if a package earns its place) | keep dependency surface small |
| Tests | **Lune** + `TestEZ` | headless Luau, runs the same vectors in CI |
| CI | GitHub Actions: `rojo build` → `.rbxlx` artifact + `lune run tests` | every push verifiable |
| Saves | **DataStoreService**, one key per player, schema = the 5 SharedObjects | server-side, authoritative |
| Match loop | server-authoritative `RunService.Heartbeat` accumulator at 18 Hz, `RemoteEvent` snapshots at ~10 Hz | Roblox requires server authority |
| Animation | **R15 rig**, `Animation` assets, same numeric ids | player-visible, so reuse stock R15 anims where they exist |
| Roster | one `ModuleScript` returning the 300-entry table (≈500 KB) | loads once, no DataStore cost |

Roblox-specific gotchas:
- **Server authority**: the web version can trust the client, Roblox cannot. Keep the sim pure and run it only on the server; clients get snapshots.
- **18 Hz sim ≠ 60 Hz render**: interpolate on the client, never tick the sim per frame.
- **R15 ≠ 16-limb rig**: the original renders 16 limb slots per costume. Map to R15 body parts and accept fewer cosmetic slots, or build a custom rig with `Motor6D` (more faithful, more work).

## 4. Repo layout

```
wr3d/
├── README.md
├── docs/                     # the mechanics spec (source of truth)
│   ├── WR3D-FULL-SPEC.md
│   ├── BUILD-PLAN.md
│   └── assets-extraction.md
├── shared/
│   ├── data/                 # roster, anim table, economy tables
│   └── vectors/              # conformance test vectors
├── web/                      # Vite + TS + Three.js
├── roblox/                   # Rojo project (src/ shared, server, client)
└── tools/                    # extractors: roster_parse.py, as3 miners
```

## 5. Milestones

| # | Milestone | Output |
|---|---|---|
| 0 | Repo + spec + data + vectors | this scaffold |
| 1 | Sim core, headless, vectors green | `shared/sim` in TS, no rendering |
| 2 | Web grey-box: two fighters, one move, HP/poise/pin | playable prototype |
| 3 | Full match sandbox (all anim ids, contests, specials) | feature-complete match |
| 4 | Menus + save + career economy | single-player career |
| 5 | Roblox port of the same sim, vectors green in Luau | parity proof |
| 6 | Art pass: rig, meshes, animations | looks like a game |

Milestones 1-4 and 5 can run in parallel after 1; 6 is the long tail.

## 6. Honest risks

1. **Art**: Flare3D meshes/animations are not exported — expect a full re-authoring pass. Nothing in the spec helps here.
2. **Frame-exactness**: the original's behaviour is anim-frame driven. Frame-perfect parity needs the animation timing tables, which are partly inside the SWF frame scripts (recoverable, not yet mined).
3. **Legal**: the roster contains real-ish wrestler likenesses owned by MDickie. A public release needs original characters. Mechanics are not copyrightable; names/likenesses are.

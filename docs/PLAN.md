# WR3D Rebuild — Implementation Plan

**Goal:** a public, deployable, original-IP 3D wrestling game sharing one verified mechanics core between a browser build and a Roblox build.

**Architecture:** engine-free TypeScript sim (`web/src/sim`) + Luau mirror (`roblox/src/shared/Sim`), both pinned by the same conformance vectors. Rendering is swappable; the simulation is not.

**Stack:** Vite + TypeScript + Three.js (web) · Rojo + Luau (Roblox) · Vitest + Lune (tests) · GitHub Actions + Pages (CI/CD).

---

## 0. Where we actually are (verified, not assumed)

| Fact | State |
|---|---|
| Mechanics spec | 5,947 lines, 271 code citations (`docs/WR3D-FULL-SPEC.md`) |
| Conformance vectors | 210 values, 6 formula families (`shared/vectors/conformance.json`) |
| Web sim | health, poise, strikes, contests, worth, rescale — **8/8 tests green** |
| Roblox sim | same formulas in Luau — **213/213 green** |
| Rendering | grey-box only: two capsules, buttons, HUD |
| Gameplay loop | none (no input, no AI, no match flow) |
| Roster | extracted MDickie roster — **not shippable** (see R1) |
| Deploy | none |
| Remote | not created |

## 1. Non-goals (deliberate, YAGNI)

- Multiplayer. Single-player first; the sim is deterministic, so netcode is a later bolt-on.
- Faithful art reproduction. Flare3D meshes cannot be exported (spec §0); art is re-authored.
- Mobile-native apps. Web build is responsive; Roblox covers mobile natively.
- Backend. No accounts, no server, no telemetry — saves live in IndexedDB.

## 2. Milestones

| # | Milestone | Definition of done |
|---|---|---|
| **M0** | Repo & license hygiene | LICENSE + NOTICE + SECURITY + CONTRIBUTING; IP-bearing data out of the public tree |
| **M1** | Original roster | seeded generator produces 300 original wrestlers; IP guard test proves no name collision with the extracted roster |
| **M2** | Playable match | keyboard/touch input, movement, strike/grapple resolution, AI opponent, match end + result screen |
| **M3** | Public shell | responsive layout, a11y (focus, aria-live HUD, reduced-motion), error boundary, how-to-play, offline-capable |
| **M4** | Deploy | GitHub Pages workflow green from `main`; production URL serves M2 build |
| **M5** | Roblox parity | same vectors green in Luau in CI; `rojo build` artifact downloadable |
| **M6** | Art pass | original rig + animations, replace capsules |

## 3. Risk register — every countermeasure we will actually implement

| # | Risk | Impact | Countermeasure (concrete) |
|---|---|---|---|
| **R1** | **IP infringement** — extracted roster contains real-performer-style names; shipping it invites a takedown and kills the project | Fatal | Public data is *generated* only (`shared/data/roster.generated.json`). Extracted artefacts move to `private/` and are gitignored. CI test fails if any shipped name matches an extracted name. |
| R2 | Engine drift between web and Roblox | Silent desync | One `conformance.json`; **both** CI jobs must pass it; adding a formula requires adding vectors first. |
| R3 | Determinism loss from `Math.random()` sneaking in | Unreproducible bugs | Single seeded PRNG module; lint-style test greps `src/sim` for `Math.random` and fails. |
| R4 | Save corruption / schema drift | Lost careers | Versioned save envelope `{v, data}`, migration function, and a round-trip test. |
| R5 | Frame-rate dependence | Physics differs across devices | Fixed 18 Hz accumulator already enforced; render interpolates only. Test asserts N ticks per simulated second. |
| R6 | Accessibility regression | Unusable for some players | Keyboard-only play path, `aria-live` for match events, visible focus ring, `prefers-reduced-motion` honoured. Checked in review. |
| R7 | Bundle bloat | Slow first load on mobile | Budget: ≤ 600 KB gzip. CI fails if exceeded. |
| R8 | Unpinned toolchain | "Works on my machine" | `pnpm-lock.yaml`, `rokit.toml`, Node 22 pinned in CI. |
| R9 | Cheating/save editing | Leaderboards meaningless | No leaderboards in v1. If added: server-side verification required first. |
| R10 | Legal/C&D on mechanics | Project blocked | Mechanics are not copyrightable; names, art and audio are. Clean-room code, original assets, NOTICE documents this. |

## 4. Quality gates (CI must be green to merge)

1. `pnpm test` — conformance vectors + unit tests
2. `pnpm build` — typecheck + bundle budget
3. `lune run roblox/tests/conformance.luau` — cross-platform parity
4. `rojo build` — place file compiles
5. Determinism grep — no `Math.random(` inside `web/src/sim`
6. IP grep — no extracted names in `shared/`

## 5. Task breakdown

### M0 — repo hygiene (30 min)
- **T0.1** `LICENSE` (MIT, code+vectors), `NOTICE` (clean-room statement: no MDickie code/assets shipped)
- **T0.2** `SECURITY.md` (no backend, report privately), `CONTRIBUTING.md` (setup, gates, commit style)
- **T0.3** Move `shared/data/{roster.json,characters-raw.txt,roster_summary.csv,Game-app.xml}` → `private/`; add `private/` to `.gitignore`
- **Verify:** `git ls-files | grep -c private` → 0

### M1 — original roster (45 min)
- **T1.1** `tools/gen_roster.py` — seeded synthesizer: name pools (multicultural), team naming, stats 55-95, age 18-45, build/height bands, 3 costumes. Deterministic per seed.
- **T1.2** Emit `shared/data/roster.generated.json` (300 entries, same schema as `roster_game.json`)
- **T1.3** `web/test/roster.test.ts` — schema valid, 300 entries, stat ranges, unique names, **zero overlap with `private/roster.json` names**
- **Verify:** `pnpm test` green; `jq '.[0].stats' roster.generated.json`

### M2 — playable match (largest; 4-6 h)
- **T2.1** input layer: WASD/arrows + Space strike + Shift grapple, touch zones
- **T2.2** movement integrator at 18 Hz using Agility (`pTravel`, spec §3)
- **T2.3** strike resolution: geometry hit test (`FindImpacts`, spec §2) replacing the button
- **T2.4** grapple → move tree (spec §4 tables) implemented as data
- **T2.5** AI opponent: distance-keeping + attack windows driven by Skill
- **T2.6** match flow: count-down, health/poise, KO/pin end, result screen
- **Verify:** playable 2-minute match headlessly (sim-only test asserting a winner emerges)

### M3 — public shell (1-2 h)
- **T3.1** responsive layout + safe-area insets
- **T3.2** a11y: focus rings, `aria-live="polite"` match log, reduced-motion guard
- **T3.3** error boundary + "reload" affordance
- **T3.4** how-to-play overlay (first run), stored in localStorage
- **T3.5** IndexedDB save via Dexie, versioned envelope (R4)

### M4 — deploy (30 min)
- **T4.1** `.github/workflows/deploy.yml` — build `web/dist`, publish to GitHub Pages
- **T4.2** `web/vite.config.ts` `base` set from `GITHUB_REPOSITORY` for Pages
- **T4.3** README: live URL, controls, screenshot
- **Verify:** workflow green; URL returns 200

### M5 — Roblox parity (already green; 20 min)
- **T5.1** confirm CI job uploads `.rbxlx`
- **T5.2** README Roblox section with Rojo instructions

## 6. Files likely to change

```
LICENSE  NOTICE  SECURITY.md  CONTRIBUTING.md  README.md  .gitignore
.github/workflows/{ci,deploy}.yml
tools/gen_roster.py
shared/data/roster.generated.json  shared/data/README.md
web/test/{roster,determinism,budget}.test.ts
web/src/sim/{input,movement,ai,match}.ts
web/src/ui/{hud,overlay,error-boundary}.ts
private/  (gitignored)
```

## 7. Open questions

1. GitHub Pages or Cloudflare Pages? Pages needs no secrets — recommended unless you want the Cloudflare domain.
2. Repo name: `wr3d` or something neutral to steer clear of trademark (`ringside`, `apron`)?
3. Ship the extracted mechanics spec publicly? It is analysis of a shipped binary; publishing it is defensible but increases visibility with the original author. Default: publish (it is factual analysis), but keep the *roster* private.

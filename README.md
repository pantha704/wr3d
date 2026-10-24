# WR3D — rebuild

Cross-platform rebuild of **Wrestling Revolution 3D** (`air.WR3DFree` 1.750.64) as a browser game and a Roblox experience.

Reverse-engineered from the shipped APK: Adobe AIR / Flare3D, 137,493 lines of ActionScript in one frame script, 393 classes, 300-character roster. Every mechanic in `docs/` is cited to a source line.

## Layout

```
docs/       mechanics spec (source of truth), build plan, investigation log
shared/     roster + conformance vectors shared by both platforms
web/        Vite + TypeScript + Three.js
roblox/     Rojo + Luau project
tools/      extractors and vector generator
```

## Status

| Milestone | State |
|---|---|
| 0 — repo, spec, data, vectors | **done** |
| 1 — headless sim core, vectors green | next |
| 2 — web grey-box prototype | |
| 3 — full match sandbox | |
| 4 — menus, save, career economy | |
| 5 — Roblox parity (vectors green in Luau) | |
| 6 — art pass | |

## What is already extracted

- **Roster** — 300 characters × 335 fields, schema recovered by porting the shipped loader; parser asserts zero drift (`tools/roster_parse.py`).
- **Stats** — `1 Popularity · 2 Strength · 3 Skill · 4 Agility · 5 Stamina · 6 Toughness · 7 Attitude · 8 Happiness`.
- **Match engine** — 10,000 HP default, nose-to-nose hit geometry (no to-hit roll), poise pool as the knockdown gate, per-frame stat rescaling, 3-count pins at 18 fps.
- **Economy** — bank, wages, `worth = chunk³/15`, contract filters, manager cut, event ledger.
- **Progression** — generation algorithm, training, ageing, injury model.
- **Conformance vectors** — 210 values across 6 formula families (`shared/vectors`).

## Non-negotiable porting rules

1. The sim runs at a **fixed 18 Hz** tick; render interpolates.
2. `Rnd(min,max)` = `Math.round(rng() * (max - min)) + min` — endpoints get **half weight**. Use one seeded PRNG (`mulberry32`), never `Math.random()`.
3. Source arrays are **1-indexed**; convert at the boundary only.
4. Web and Roblox must both pass `shared/vectors/conformance.json` **exactly**. Any drift is a bug in the port, not a design choice.

## Quickstart

```bash
# web
pnpm --dir web install && pnpm --dir web dev

# roblox
rojo serve roblox/default.project.json   # then connect from Studio

# data + vectors
python3 tools/roster_parse.py            # regenerate roster
python3 tools/gen_vectors.py             # regenerate conformance vectors
```

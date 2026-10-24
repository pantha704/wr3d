# Contributing

## What this project is

An original, clean-room rebuild of a 3D wrestling game: one mechanics core,
two renderers (browser + Roblox). The mechanics were derived from public
behavioural analysis; **no code, art, audio or roster data from any commercial
game is accepted here** (see `NOTICE`).

## Setup

```bash
pnpm --dir web install
pnpm --dir web dev        # http://127.0.0.1:5173
pnpm --dir web test       # conformance + roster + determinism
lune run roblox/tests/conformance.luau
rojo build roblox/default.project.json -o /tmp/wr3d.rbxlx
```

Tool versions are pinned in `rokit.toml` and CI. Node 22, pnpm 11.

## The one rule that matters

**Both platforms must pass `shared/vectors/conformance.json` exactly.**

If you change a formula:

1. add or update vectors in `shared/vectors/conformance.json`
2. implement it in `web/src/sim`
3. implement it in `roblox/src/shared/Sim`
4. both suites must go green in the same PR

A change that only updates one side is a desync, not a feature.

## Determinism

The sim never calls `Math.random()`. Use the seeded PRNG in `web/src/sim/prng.ts`
(mirrored in `Prng.luau`). `web/test/determinism.test.ts` enforces this.

Simulation runs at a fixed 18 Hz tick; rendering interpolates. Do not tick the
sim from the render loop.

## Data

Anything derived from an inspected commercial binary goes in `private/`
(gitignored). Shipped data lives in `shared/data/` and must be generated or
original. See `shared/data/README.md`.

## Commits

Conventional-ish prefixes: `feat:`, `fix:`, `docs:`, `test:`, `chore:`,
`data:`. Keep the subject under 72 characters.

## Pull requests

CI must be green: web tests, web build, Luau conformance, Rojo build, bundle
budget. Describe the player-visible change, not the file list.

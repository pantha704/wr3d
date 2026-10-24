# Shipped data

These files are part of the public build and must contain **original content
only**. See `NOTICE` at the repository root.

| File | Origin | Notes |
|---|---|---|
| `roster.generated.json` | `tools/gen_roster.py`, seed `20261024` | 300 synthetic wrestlers |
| `characters-raw.txt` | *removed* | reference-only, lives in gitignored `private/` |

## Rules

1. Regenerate with `python3 tools/gen_roster.py` — never hand-edit the output.
2. Any new data file here needs a test in `web/test/` that proves its shape.
3. Anything derived from an inspected commercial binary belongs in `private/`,
   never here. `web/test/roster.test.ts` fails if a shipped name appears in the
   private reference roster.

## Why a generated roster

The mechanics are the interesting, unprotected part. The names are not ours to
ship. Generating 300 unique wrestlers from first-principles name pools keeps
the game playable while keeping the repository clean.

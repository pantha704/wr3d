# What is moddable in WR3D (and what that means for our build)

Derived from the decompiled artifact (`air.WR3DFree` 1.750.64). This documents the **modding surface** — which parts of a shipped build are data, which are state, and which are code — because the same map is the content pipeline for our own game.

> Scope note: this is analysis of what is technically editable in an APK the device owner already holds. It is not a crack, and no patched build of the original is produced or distributed here.

## Tier 1 — pure data, no code touched

| Surface | Where | Difficulty | Notes |
|---|---|---|---|
| Roster | `assets/Characters.txt` | **none** | 300 slots × 335 fields, `\|`-delimited, plain text. Parser already written (`tools/roster_parse.py`) |
| Stats / ratings | same file, fields 16-23 | **none** | Popularity…Happiness, 0-100 |
| Move sets | same file, fields 287-335 | **none** | attack[8], crush[8], move[20], back[7], ground[2][3] |
| Appearance | fields 24-31 + costume blocks 32-280 | **none** | build, height, eyes, brows, beard, hair, per-limb RGB |
| Teams / federations | field 2 | **none** | 289 distinct values in the stock roster |
| Save data | `SharedObject` files | **none** | `System` (entitlements, careers), `Career`/`Booking` (bank, date, 48-slot schedule), `NewCharacters`, `NewRosters`, `Options` — all plain key/value |

Tier 1 needs no repackaging, no signing, no code. Drop a new `Characters.txt` into the APK's assets or edit the save files on the device. **This is where 90% of real mods live** — and it is exactly the pipeline our own game needs.

## Tier 2 — ActionScript edits (SWF surgery)

The logic is one 10.7 MB SWF with 393 AS3 classes. Editing it means: decompile → edit → recompile/repack → re-sign the APK.

| Surface | Function (line) | Effort |
|---|---|---|
| Damage model | `FindImpacts` (97003), `MoveImpact` (68342) | medium — one arithmetic expression |
| Stat caps / rescaling | `56024-56051` | medium |
| Contest odds | `RiskStruggle` (67939) and siblings | medium |
| Career economy | `CalculateWorth` (114779), `CountWages` (54579), `CalculateFinances` | medium — many call sites |
| Match length / tick rate | `optLength` (131183), `optFrameRate` (131192) | **easy** — single literals in `frame1()` |
| Entitlement logic | `LegitPurchase` (3861), `ActivatePurchase` (3876) | **easy in principle**, see below |
| AI / move selection | `AttackViable` (96166), `GenerateAttacks` | hard — interlocked state machine |
| Ads | DEX side (AppLovin, ironSource, Pangle, Vungle, Bigo, Unity, InMobi, MBridge, BidMachine, Moloco) | hard — native, not AS3 |

Practical reality of Tier 2: FFDEC can patch constants and simple branches but does **not** round-trip arbitrary AS3 cleanly. Anything beyond a literal or a single condition risks a corrupted SWF. Any repackaged APK must also be re-signed, which means uninstall/reinstall and loss of existing saves, and it will not update through Play.

### On the entitlement specifically

The analysis found `LegitPurchase` returns success by default and entitlement lives in a local `SharedObject`, with no server receipt check. That is a **design observation**, not an invitation: the same file also contains `FailPurchase`, which sets `gamHacked` and permanently blocks purchases once the game decides it has been tampered with.

Worth stating plainly for our own build: this is also the single most common mistake in indie monetisation. Any port we ship should validate entitlements server-side, or don't charge for them.

## Tier 3 — not realistically moddable

- Native `.so` libraries (Flare3D runtime, ad SDKs)
- The AIR runtime itself
- Anything requiring the original signing key

## What actually transfers to our game

| Original surface | Our equivalent |
|---|---|
| `Characters.txt` 335-field rows | `shared/data/roster.json` — already converted, same semantics |
| `SharedObject` saves | Dexie (web) / DataStore (Roblox), same 5-object schema |
| `optLength` / `optFrameRate` literals | tunables in one config module, not scattered magic numbers |
| Tier-1 data edits | **exposed as a first-class mod loader** — roster packs, custom characters, stat presets |
| Tier-2 code edits | exposed as a typed rules module both platforms import, so balance changes don't need a fork |

The takeaway: the original's modding strength is that roster and saves are plain data, and its weakness is that everything else is buried in a 137k-line frame script. Our build should keep the first property and fix the second.

# WR3D — COMPLETE MECHANICS SPEC

Compiled from decompiled ActionScript (`air.WR3DFree` 1.750.64). Every claim carries a `MainTimeline.as:line` citation.

Parts: 1 overview/schema · 2 match engine · 3 career economy · 4 character & progression.

---


# PART 1 — 00-OVERVIEW.md

# WR3D — reimplementation spec (web + Roblox)

Source of truth: `air.WR3DFree` v1.750.64, sha256 `77dbf50c…`, decompiled with REA + JADX 0.7.1 and JPEXS 26.4.0.
All mechanics claims in the numbered sections carry `file:line` into `as3/scripts/Game_fla/MainTimeline.as`.

## What the game actually is

| Layer | Reality |
|---|---|
| Runtime | Adobe AIR (Flash) — `assets/Game.swf`, 10.7 MB, 393 ActionScript classes |
| Logic | ~99% in a single frame script: `Game_fla.MainTimeline` — 137,493 lines, 790 functions, 2,267 instance vars |
| DEX | ad/IAP SDK glue only (AppLovin, ironSource, Pangle, Vungle, Bigo, Unity Ads, InMobi, MBridge, BidMachine, Moloco, Yodo1) |
| Data | `assets/Characters.txt` — 300 characters × 335 fields |
| Persistence | 5 `SharedObject`s: `System`, `Career`/`Booking`, `NewCharacters`, `NewRosters`, `Options` |

Consequence for a port: **there is no engine to reverse — it is one giant imperative state machine.** A reimplementation is a rewrite against extracted formulas, not a decompilation port.

## Stat model (the Rosetta stone)

`textStat = ["", "Popularity","Strength","Skill","Agility","Stamina","Toughness","Attitude","Happiness"]` — line **131372**.

| # | Stat | Observed role in code |
|---|---|---|
| 1 | Popularity | special-meter gain (`100 + pStat[1] + Rnd(0,100)`), crowd/reaction chance |
| 2 | Strength | `pain` source (`pain = pStat[2]`), submission/pin contests |
| 3 | Skill | move-success contests, transition timing |
| 4 | Agility | speed, travel, attack speed, transitions |
| 5 | Stamina | endurance checks, fatigue |
| 6 | Toughness | resist/kick-out chances |
| 7 | Attitude | career behaviour/negotiation |
| 8 | Happiness | morale, career drift |

Roster ranges (all 300, measured from the shipped data):
Popularity 55-95 · Strength 60-95 · Skill 60-95 · Agility 60-95 · Stamina 60-95 · Toughness 60-95 · Attitude 55-95 · Happiness 55-95.
Age 18-60 · build 1-9 · height 90-110 · role {1:279, 2:14, 3:7} · heel {0:157, 1:143} · gender {0:284, 1:16}.

## Deliverables in this folder

| File | Contents |
|---|---|
| `00-OVERVIEW.md` | this document — architecture, stat model, port strategy |
| `01-match-engine.md` | health/damage, attack resolution, movement, momentum, pins, match flow |
| `02-career-economy.md` | bank, wages, contracts, manager cut, event revenue, gates |
| `03-character-progression.md` | roles, relationships, move sets, generation, training, injuries |
| `../roster_game.json` | 300 characters, game-ready schema (stats named, moves, costumes) |
| `../roster_summary.csv` | flat table for spreadsheets |
| `../roster_parse.py` | schema-exact parser, asserts on drift |
| `../function_index.csv` | all 1,918 functions across 393 classes, with file:line |

## Target schema (web + Roblox)

Game-ready roster entry (`roster_game.json`):

```json
{
  "id": 1,
  "name": "Mat Dickie",
  "team": "Team Dickie",
  "gender": 0, "age": 32, "role": 2, "heel": 1,
  "stats": {"Popularity":65,"Strength":75,"Skill":75,"Agility":70,
            "Stamina":65,"Toughness":65,"Attitude":70,"Happiness":75},
  "build": 5, "height": 99,
  "appearance": {"eyes":2,"brows":1,"beard":0,"shave":0,"hairStyle":6,"hairLength":0},
  "relationships": [0,0,8,176,7,176],
  "moves": {"attack":[],"crush":[],"move":[],"backMove":[],"stance":0,"walk":0,"taunt":[]},
  "costumes": [ ... 3 outfits ... ]
}
```

Mapping notes:

- **Web**: stats are 0-100 ints — store as-is. Match loop runs on a fixed tick; the AS3 code is frame-driven (`ENTER_FRAME`) with animation ids as the state machine, so the port needs an explicit tick → state table.
- **Roblox**: one `ModuleScript` per roster entry (or one `ModuleScript` returning the whole table; 300 entries ≈ 500 KB), stats in a `Configuration` folder for designer tuning; the match loop maps to `RunService.Heartbeat` with the same tick constants; animation ids map to `Animation` assets, keeping the shipped id numbering so the extracted tables stay valid.
- **Determinism**: the original uses `Rnd(min,max)` and `Math.random()` inline. To reproduce exact behaviour, port `Rnd` as a seeded integer PRNG — do not use `math.random` per call site.

## Status

- Roster format: **solved and verified** (zero token drift over 100,500 tokens).
- Entitlement logic: **solved** — client-side only, no server validation.
- Match / economy / progression: being written up in 01-03 from verbatim code.



# PART 2 — 01-match-engine.md

# 01 — WR3D Match Engine (mechanics spec)

**Source:** `as3/scripts/Game_fla/MainTimeline.as` (137,493 lines), decompiled with JPEXS from
`assets/Game.swf` in `air.WR3DFree` **1.750.64**. All line references are to that file and are
verbatim. Arrays are 1-indexed. Nothing in this document is inferred from gameplay — every formula
is quoted from source.

**Frame model.** The engine is a per-frame state machine. `stage.frameRate` defaults to
`optFrameRate = 18` (line 131192); the options screen exposes 15–60 in steps of 1
(`BrowseOption(optFrameRate, n, 1, 2, 15, 60, 0)`, 122135). Every timer in this document
(`pAnimTim`, `pCountTim`, `pDT`, `pHeat`, …) counts **frames**, not seconds. Converting to seconds
requires dividing by the *local* `optFrameRate`.

This is the single most important fact for a reimplementation. All combat logic is driven from
`Event.ENTER_FRAME` and every decrement is a literal `- 1` per tick (e.g. 55884, 55917, 56009), so the
frame-rate option is not a rendering setting — it scales **simulation speed**. A port must adopt a fixed
tick (recommended 18 Hz to match the default) and treat the frame-rate option as display-only, or
explicitly divide every constant by the chosen rate.

### 0.1 Engine tuning constants (defaults, line 131170–131195)

| Constant | Default | Range | Role |
|---|---|---|---|
| `optFrameRate` | **18** | 15–60 (122135) | sim tick rate |
| `optLength` | **2** | 1–3 (122132) | match length → **HP pool = `optLength * 5000`** |
| `optLevel` | **2** | — | difficulty; `>= 5` triggers human ±0.05 stat scaling (56036) |
| `optLieTim` | **150** | — | `pDT` threshold for "lying long enough to be KO-able" (46835) |
| `optCrawlTim` | **50** | — | `pDT` threshold in the KO-viability test (46821) |
| `optHealthTim` | **250** | — | health-bar related timer |
| `optGore` | >0 | — | enables blood (56464) |
| `optExpressions` | 0 | — | if 0, `pDizzy` is converted to `pBlind` (55827–55834) |

**The default HP pool is therefore 10,000**, not 5,000. `optLength` is additionally forced to `1`
(`= 5000 HP`) for fist-fight presets and `matchPreset == 1`:

```as3
if(this.matchFists > 0 || this.matchPreset == 1) { this.optLength = 1; }     // 44331-44334
```

All the arithmetic examples in this document are stated at `optLength = 2` (default) unless marked
otherwise, and every formula is written with `optLength` explicit so it scales.

---

## 1. Health & damage model

### 1.1 Three separate resource pools

| Pool | Range | Meaning | Set at |
|---|---|---|---|
| `pHealth[cyc]` | `0 .. optLength*5000` | Match "health"/energy. Reaching 0 is the KO/defeat condition. | 55389 |
| `pHealthLimit[cyc]` | `>= 1250*optLength` | Decaying ceiling on `pHealth` — the "you can't fully recover" clamp. | 55390, 55882–55893 |
| `pHP[cyc]` | `0 .. pHealth/5` (min 200) | **Poise/guard.** Not health. `pHP == 0` means "this hit knocks me down". | 55902–55910, 55867 |

`optLength` is the match-length option (default **2**, so a fresh wrestler starts at **10,000** HP; see
§0.1).

```as3
this.pHealth[cyc] = this.optLength * 5000;          // 55389
this.pHealthLimit[cyc] = this.pHealth[cyc];          // 55390
this.pHP[cyc] = 1000;                                // 55391
this.pDT[cyc] = 0;                                   // 55392
```

Career mode scales starting health by the persistent fitness stat `charHealth` (0–100):

```as3
if(this.gamMode > 0)
{
   this.pHealth[cyc] = int(this.pHealth[cyc] * (this.charHealth[this.char] / 100));  // 55398
   this.pInjured[cyc] = this.charInjured[this.char];                                  // 55399
}
```

Identity at 53739–53742 uses `PercentOf` instead of a raw multiply (equivalent, one rounding path):

```as3
this.pHealth[cyc] = this.optLength * 5000;                                   // 53739
...
this.pHealth[cyc] = this.PercentOf(this.pHealth[cyc],this.charHealth[this.char]);  // 53742
```

**Body scale.** `pScale[cyc] = charHeight[char] / 100` (55498; forced to `1` at 55501 when a
condition holds). Height is 0–100-ish in the roster, so `pScale ≈ 0.99` for a default wrestler.
`pScale` multiplies strike *reach* and *vertical hit boxes*, and is used in the size-difference
contest, but **not** base health.

### 1.2 Per-frame upkeep (`MonitorStatus`, 55811)

`MonitorStatus` runs every frame for every active wrestler. Order matters — this is the whole
"stamina/regeneration" model:

```as3
// 55870 — Skill (stat 5, Stamina) gates natural regeneration
this.randy = Math.random();
if(this.randy < this.pStat[cyc][5] / 100 || tempSpecial > 0 || this.gamTutorial == 99)
{
   if(this.pGrappler[cyc] == 0 && this.pInjured[cyc] == 0 && this.pDizzy[cyc] == 0 && this.pBlind[cyc] == 0)
   {
      this.pHealth[cyc] += 1;          // +1 HP per frame, probability = Stamina/100
   }
   if(this.pHP[cyc] > 0)
   {
      this.pHP[cyc] += 1;              // +1 poise, deterministic while above 0
   }
}
```

So natural regen is **1 HP/frame × P(Stamina/100)**. At Stamina 50 and 18 fps that is ~9 HP/s against a
10,000 HP pool — **0.09 %/s**, i.e. 18 minutes to refill from empty if nothing else interfered. This is
why matches are damage-dominated, not stamina-dominated; Stamina mostly governs *recovery between
exchanges*, and even that contribution is trivial compared to a single 450-damage power strike.

Then the ceiling decays and clamps:

```as3
if(this.pHealthLimit[cyc] > this.pHealth[cyc])
{
   this.pHealthLimit[cyc] = this.pHealthLimit[cyc] - 1;        // 55884  ceiling falls 1/frame
}
if(this.pHealthLimit[cyc] < 1250 * this.optLength)
{
   this.pHealthLimit[cyc] = 1250 * this.optLength;             // 55886-55889  floor = 25% max
}
if(this.pHealth[cyc] > this.pHealthLimit[cyc])
{
   this.pHealth[cyc] = this.pHealthLimit[cyc];                 // 55890-55893  hard clamp
}
if(this.pInjured[cyc] > 0)
{
   this.pHealth[cyc] = this.pHealth[cyc] - 1;                  // 55894-55897  injured bleeds 1/frame
}
if(this.pHealth[cyc] < 0)
{
   this.pHealth[cyc] = 0;                                      // 55898-55901
}
healthChunk = this.pHealth[cyc] / 5;
if(healthChunk < 200)
{
   healthChunk = 200;                                          // 55902-55906  poise floor
}
if(this.pHP[cyc] > healthChunk)
{
   this.pHP[cyc] = healthChunk;                                // 55907-55910  poise ceiling = 20% HP
}
```

**Consequence for a port:** the ceiling is a ratchet. Once you take damage, `pHealthLimit` starts
falling at 1/frame toward `pHealth` and never rises again by itself; the floor of `1250*optLength`
means a wrestler always has a theoretical 25 % reserve. So the last quarter of the bar can only be
refilled by the `pHealth += 1` regen, which is clamped by the ceiling — i.e. **health never comes back
in any meaningful quantity.** This is why the HUD reads as a one-way bar.

### 1.3 Collapse check

```as3
this.chance = 0;
if(this.pInjured[cyc] > 0)          { this.chance = 1000; }     // 55846-55849
if(this.pDizzy[cyc] > 0 || this.pBlind[cyc] > 0)
{
   if(this.pAnim[cyc] == 10) { this.chance = 200; } else { this.chance = 400; }  // 55850-55860
}
if(this.chance > 0 && this.pSeat[cyc] == 0)
{
   this.randy = this.Rnd(0,this.chance);
   if(this.randy <= 1 && Boolean(this.CollapseViable(cyc)))
   {
      this.PainSound(cyc,Math.random());
      this.pHP[cyc] = 0;                                        // 55867  forced knockdown
   }
}
```

Collapse is a poise wipe (knockdown), not a KO. Probability is `1/(chance+1)` per frame ≈
`1/1001` when injured, `1/401` when dizzy/blind, `1/201` when dizzy *and* in anim 10.

### 1.4 Down-time (`pDT`) — the knockdown timer

`pDT` is the number of frames a wrestler stays on the mat. It is **added to** by damage and **decayed**
every frame by several rules:

```as3
if(this.pInjured[cyc] > 0 || this.pHealth[cyc] <= 0)
{
   this.pDT[cyc] -= this.Rnd(0,1);            // 55911-55914  injured/empty: slows decay
}
else
{
   this.pDT[cyc] = this.pDT[cyc] - 1;          // 55917
}
if(this.pAnim[cyc] == 96)      { this.pDT[cyc] -= 1; }              // 55919-55922  (getting up)
if(this.pPinner[cyc] > 0 && this.pPinCount[cyc] > 0) { this.pDT[cyc] -= this.Rnd(0,8); }  // 55923-55926
if(this.pDT[cyc] < 0)          { this.pDT[cyc] = 0; }               // 55927-55930
```

Then a probabilistic "shake it off" roll, only while `pDT > 0` and not in anim 92:

```as3
this.chance = 300 - this.pPop[cyc] * 1.5;                                  // 55933
this.chance += (5000 * this.optLength - this.pHealth[cyc]) / (10 * this.optLength);  // 55934
if(this.pInjured[cyc] > 0 || this.pHealth[cyc] <= 0)  { this.chance *= 2; }   // 55935-55938
if(this.matchActive > 2 || this.matchType >= 2 && this.matchType <= 4) { this.chance *= 1.25; } // 55939-55942
if(this.matchKOs == 2)                               { this.chance *= 2; }   // 55943-55946
if(tempSpecial > 0)                                  { this.chance /= 10; }  // 55947-55950
if(this.pPinCount[cyc] > 0)                          { this.chance /= 2; }   // 55951-55954
this.randy = this.Rnd(0,this.chance);
if(this.randy <= 4)   { this.pDT[cyc] *= 0.9; }                             // 55956-55959
if(this.randy == 5)   { this.pDT[cyc] *= 0.75; }                            // 55960-55963
if(this.randy == 6)   { this.pDT[cyc] *= 0.5; }                             // 55964-55967
if(this.randy == 7)   { this.pDT[cyc] = 0; }                                // 55968-55971
```

Note `pPop` is Popularity (stat 1) — **popularity shortens your down-time** (`300 - pPop*1.5`), and
being behind on health raises the escape chance. `pDT *= 0.9` fires on ~5 out of every `chance` frames,
so the effective decay is roughly `-10%` per `chance/5` frames.

### 1.5 Where damage actually comes from

`GetDT` converts a raw pain number into down-time, scaled by **remaining health fraction**:

```as3
public function GetDT(cyc:int, pain:int) : int
{
   this.factor = this.pHealth[cyc] / (this.optLength * 5000) * 100;   // 97945  % health left
   this.factor = (250 - this.factor) / 5;                             // 97946  full HP -> 30, empty -> 50
   newDT = pain / 100 * this.factor;                                  // 97947
   return int(newDT * (0.75 + Math.random() * 0.5));                  // 97948  ±25% jitter
}
```

So `newDT = pain/100 * (250 - hp%)/5 * U(0.75,1.25)`. At full health a 300-pain hit gives
`300/100*30 = 90` → 67–112 frames of down-time. At near-zero health the same hit gives 150 → 112–187
frames. **Damage-to-down-time is directly proportional to how hurt you already are** — the snowball.

`AddDT` is the alternative used where pain is already a DT-scale number:

```as3
this.factor = 0.5 + Math.random() * 0.5;      // 97954
return int(pain * this.factor);                // 97955
```

### 1.6 Damage sources and their magnitudes

**(a) Strikes** — `FindImpacts` (96995) / damage applied 97217. Base:

```as3
pain = Math.round(this.pStat[cyc][2] * pain);   // 97003   Strength × per-anim pain multiplier
if(this.pSpecial[cyc] > 0)  { pain *= 1.25; }   // 97004-97007  special meter active
if(this.pRunUp[cyc] > 0)    { pain *= 1.25; }   // 97008-97011  running strike
if(this.Rnd(0,10) == 0)     { pain *= 2; }      // 97012-97015  10% critical
```

then:

```as3
this.pHealth[this.v] -= pain;                                          // 97217
this.pDT[this.v] = this.GetDT(this.v,pain);                            // 97218  (assign, not add)
this.pHP[this.v] -= pain / 50 * (150 - this.pStat[this.v][6]);         // 97219  poise vs Toughness
if(this.pRunUp[this.v] > 0 || this.pAnim[cyc] == 99 || this.pAnim[cyc] == 1081
   || this.pAnim[cyc] >= 1100 && this.pAnim[cyc] < 1200)
{
   this.pHP[this.v] = 0;                                               // 97220-97224  guaranteed knockdown
   this.pRun[this.v] = 0;
}
if(this.pAnim[cyc] >= 1080 && this.pAnim[cyc] < 1090 && this.Rnd(0,6) == 0)
{
   this.pHP[this.v] = 0;                                               // 97225-97228
}
if(this.pAnim[cyc] >= 1100 && this.pAnim[cyc] < 1200)
{
   this.pHP[cyc] -= this.Rnd(0,100);                                   // 97229-97232  recoil on big moves
}
this.pHeat[cyc] += pain / 10;                                          // 97233  momentum gain
this.pHeat[this.v] -= pain / 10;                                       // 97234  momentum loss
this.entScore += pain / 2;                                             // 97235  rating score
```

The poise subtraction `pain/50 * (150 - Toughness)` is the **toughness stat's main job**.

Poise is initialised to **1000** (55391) but capped at `health/5` (55907–55910) — which at the default
10,000 HP is **2000**. So a fresh wrestler is at half poise and it climbs back at +1/frame while above
zero (55879). It is *not* a "guard bar that breaks once"; it is a small buffer that refills.

| Attacker pain | Toughness | Poise removed | Hits to knockdown from 1000 | from cap 2000 |
|---|---|---|---|---|
| 150 (basic, S75) | 75 | `150/50*75 = 225` | 4.4 | 8.9 |
| 450 (power, S75) | 75 | `450/50*75 = 675` | 1.5 | 3.0 |
| 450 (power, S75) | 98 | `450/50*52 = 468` | 2.1 | 4.3 |
| 450 (power, S75) | 50 | `450/50*100 = 900` | 1.1 | 2.2 |

Toughness 98 vs 50 moves a power strike from 1.1 to 2.1 knockdowns-to-break — worth exactly **one extra
hit**, which is why it reads as "resilience" rather than "armour". Because the cap is `health/5`, poise
collapses in step with health: at 25 % health the cap is 500, so **two basic strikes knock you down
regardless of Toughness**. That is the mechanism behind the death spiral.

**(b) Grapple / move impact** — `MoveImpact` (68342):

```as3
this.pain = (50 + this.pStat[cyc][2] / 2) * level;      // 68384  Strength/2 + 50, × level
if(this.pRunUp[v] > 0) { this.pain += this.pain / 10; } // 68385-68388  +10% if victim was running
this.pHealth[v] -= this.pain;                           // 68389
this.pDT[v] += this.GetDT(v,this.pain);                 // 68390  (add, unlike strikes)
this.pHeat[cyc] += this.pain / 10;                      // 68392
this.pHeat[v] -= this.pain / 10;                        // 68393
```

with `level` clamped:

```as3
level = ...                                  // caller-supplied move level, typically 1..10
if(level > 8) { level = 8; }                 // 68350-68353  (when not a 500-599 attack and no assist)
if(this.pOldAnim[v] == 410 || this.pOldAnim[v] == 450 || this.pOldAnim[cyc] == 465
   || this.pAnim[cyc] == 251 && this.pOldAnim[cyc] == 252)
{
   if(level > 5) { level = 5; }              // 68355-68361
}
if(this.pSpecial[cyc] > 0) { level = 10; }    // 68362-68365  special meter maxes the move
```

So a Strength-75 wrestler's level-5 move does `(50+37.5)*5 = 437`. A special-meter level-10 move does
`(50+37.5)*10 = 875` — **8.75 % of a 10,000 HP bar in one move**, and it forces the `level = 10` clamp
on every grapple while the meter is up.

Premature-finisher recoil (failed finisher hurts the attacker):

```as3
if(this.PrematureFinisher(cyc))
{
   ...
   if(this.pSpecial[cyc] <= 0)
   {
      this.pHealth[cyc] -= this.pain;        // 68420
      this.pHP[cyc] = 0;                     // 68421
      this.pDT[cyc] += this.GetDT(cyc,this.pain / 2);  // 68422
   }
}
if(this.pSpecial[cyc] > 10) { this.pSpecial[cyc] = int(this.pSpecial[cyc] / 3); }  // 68429-68432
```

**(c) Self-inflicted on a whiffed strike** — the attacker can hurt themselves:

```as3
this.randy = this.Rnd(0,this.pStat[cyc][3]);          // 68433  Skill (stat 3)
if(this.randy <= 1)
{
   this.pDT[cyc] += this.GetDT(cyc,this.pain / 2);    // 68436
   this.pHP[cyc] = 0;                                 // 68437
   this.pTravelA[cyc] = this.Rnd(0,359);              // 68438  spin out
   this.pTravel[cyc] = 1;                             // 68439
}
```

**(d) Weapon / prop damage** — flat table, independent of stats (`iDamage`, 132424–132540):

| id | Item | `iDamage` | Flammable |
|---|---|---|---|
| 1 | Desk | 100 | 1 |
| 2 | Ladder | 200 | 0 |
| 3 | Table | 100 | 1 |
| 4 | Chair | 50 | 1 |
| 5 | Steps | 200 | 0 |
| 6 | Crate | 100 | 1 |
| 7 | Cardboard Box | 50 | 1 |

Applied at 19912 (`this.pHealth[cyc] -= this.iDamage[this.iType[this.v]];`), 68465–68466, and
31052–31071 (`* 2` for a smash).

**(e) Ring-environment / hard-coded**

| Site | Damage |
|---|---|
| 19863 | `this.pain = this.Rnd(1,3) * 100;` — running into a barrier/ropes |
| 21842, 22008 | `this.pHealth[cyc] -= this.Rnd(200,500);` — corner/structural |
| 31011–31012 | `this.pHealth[cyc] -= this.pScale[v] * 100;` — collision, symmetric |
| 56454–56499 | `RiskHeadDamage` — bleeding/blind/dizzy, no direct HP loss |
| 56521 | `this.pHealth[cyc] /= 2;` — **injury halves current health** |
| 56523 | `this.pHeat[cyc] /= 2;` — and halves momentum |
| 97657 | `this.pHealth[cyc] -= this.pStat[v][2];` — `DoubleImpact` clash, Strength of the *other* guy |
| 99929 | `this.pHealth[cyc] -= 100;` — fall |
| 55977 | `this.pHealth[cyc] = 0;` — falling out of the arena (`arenaShape == -1`, `pY < -50`) |

### 1.7 Injury (`RiskInjury`, 56503)

```as3
this.chance = this.pStat[cyc][6] * 5;          // 56507  Toughness × 5
if(risk < 0) { this.chance *= 10; risk = 0; }  // 56508-56512
this.randy = this.Rnd(0,this.chance);
if(this.randy <= risk && this.pInjured[cyc] == 0)
{
   ...
   this.pHealth[cyc] /= 2;                     // 56521
   this.pHP[cyc] = 0;                          // 56522
   this.pHeat[cyc] /= 2;                       // 56523
   if(bodyPart == 0) { bodyPart = this.Rnd(1,3); }
   if(bodyPart == 3) { this.pInjured[cyc] = this.Rnd(1,4); }    // 56534
   if(bodyPart == 2) { this.pInjured[cyc] = this.Rnd(4,8); }    // 56538
   if(bodyPart == 1) { this.pInjured[cyc] = 10; }               // 56542
}
```

`pInjured` 1–4 = light, 4–8 = moderate, 10 = severe. Any non-zero `pInjured` costs 1 HP/frame
forever (55896) and doubles collapse chance. Injury is the *only* way to lose more than the damage
number and is the main "work the body part" payoff.

### 1.8 Head damage → blood / blind / dizzy (`RiskHeadDamage`, 56454)

```as3
this.chance = this.pStat[cyc][6];                       // 56458  Toughness
this.randy = this.Rnd(0,this.chance * 2);
if(this.matchBlood > 0 && this.matchPins == 0 && this.matchSubs == 0 && this.matchKOs == 0)
{
   this.randy = this.Rnd(0,this.chance);                // 56460-56463  hardcore: twice as likely to bleed
}
if(this.randy <= risk && this.optGore > 0 && this.pBlood[cyc] < 5)
{
   this.randy = this.Rnd(1,5);
   if(this.pBlood[cyc] < this.randy) { this.pBlood[cyc] = this.randy; }
   else                             { this.pBlood[cyc] += 1; }
   ...
   this.pBlind[cyc] = this.Rnd(this.pBlood[cyc] * 10,this.pBlood[cyc] * 40);   // 56486
}
this.randy = this.Rnd(0,this.chance);
if(this.randy <= risk && this.pBlind[cyc] <= 0)
{
   this.pBlind[cyc] = this.Rnd(50,200);                 // 56489-56493
}
this.randy = this.Rnd(0,this.chance);
if(this.randy <= risk && this.pDizzy[cyc] <= 0)
{
   this.pDizzy[cyc] = this.Rnd(50,200);                 // 56494-56499
}
```

Blood is a 0–5 counter that decays at `P((150-Toughness)*10)` per frame (55816–55822) and re-rolls
blindness. `pBlind` and `pDizzy` are 50–200 frame timers; dizzy is *far* worse because it drives the
`AttackViable` / collapse paths.

---

## 2. Attack resolution & hit chance

**There is no to-hit roll.** A strike connects if, and only if, geometry says so and the target is
*attackable*. This is the biggest structural difference from a conventional RPG-style combat model.

### 2.1 Attackable state (`AttackViable`, 96166)

`AttackViable(cyc)` returns the target's damage-state class. It is the gate for whether a strike can
even register, and it also selects *which* hit location is used:

| Return | Meaning |
|---|---|
| `0` | Cannot be hit by a normal strike |
| `1` | Standing, hittable |
| `2` | Reeling / mid-sell, hittable (head height only) |
| `3` | Grounded, hittable (leg/low), requires `impactY < pY + 10*pScale` |
| `4` | Fully down / out of range of normal strikes (needs `LyingContact`) |

Representative rules from that function:

```as3
viable = 1;                                            // 96172 default
if(anim == 95) { viable = animTim <= 4 ? 3 : 2; }      // 96175-96185  getting up
if(anim == 96 || anim == 98 && animTim >= 10) { viable = 2; }   // 96186-96189  knocked back
if(anim >= 102 && anim <= 104) { viable = 2; }         // 96190-96193
if(anim >= 93 && anim <= 94) { viable = 3; }           // 96202-96205  down
if(anim == 79) { viable = 3; }                         // 96206-96209
if(anim == 100) { viable = 3; }                        // 96210-96213
if(anim >= 109 && anim <= 111) { viable = 3; }         // 96214-96217
if(anim == 1082) { viable = 3; }                       // 96218-96221
if(anim >= 58 && anim <= 59) { viable = 4; }           // 96222-96225
if(anim >= 70 && anim <= 89 && anim != 75 && anim != 79 && anim != 84) { viable = 4; }  // 96226-96229
if(anim == 75 && this.pAnimTim[cyc] < 15) { viable = 0; }        // 96230-96233  invulnerable window
if(anim >= 90 && anim <= 92 || anim == 98 && animTim < 10) { viable = 4; }
if(anim == 101) { viable = 4; }
if(anim >= 700 && anim < 800)                                   // 96242-96256  rope/grapple states
{
   if(anim >= 740 && anim <= 742) { viable = 3; } else { viable = 4; }
   if(anim == 701) { viable = 2; }
}
if(anim >= 1108 && anim <= 1109 && animTim >= 107) { viable = 0; }   // 96257-96260  recovery frames
if((anim == 1110 || anim == 1111 || anim == 1117 || anim == 1118) && animTim >= 103) { viable = 0; }
if(anim >= 1210 && anim < 1300) { if(animTim >= 104) { viable = 0; } }   // 96265-96271
```

Grappling states force `viable = 0` unless the victim is stretched or being pinned:

```as3
if(anim >= 210 && anim < 300 || anim >= 310 && anim < 400 || anim >= 410 && anim < 500
   || anim >= 510 && anim < 600 || anim >= 800 && anim < 1000)
{
   viable = 0;                                            // 96273-96275
   if(this.pStretched[v] != 0 || this.pPinning[cyc] > 0) { viable = 1; }   // 96276-96278
   ... // per-anim escalation to 2/3/4 for specific grapple moves
}
```

**This is the mechanic that makes WR3D feel like wrestling**: during a grapple animation neither party
can be struck, so a strike that lands during a grapple physically cannot connect.

### 2.2 Geometric hit test (`FindImpacts`, 96995)

```as3
range *= this.pScale[cyc] * 0.9;                     // 97001  reach scales with height
impactY = this.pY[cyc] + impactY * this.pScale[cyc]; // 97002  hit height scales with height
pain = Math.round(this.pStat[cyc][2] * pain);        // 97003
...
for(this.v = 1; this.v <= this.no_plays; ++this.v)
{
   if(cyc != this.v && this.pActive[this.v] > 0 && this.pSting[cyc] > 0)
   {
      if(this.pTeam[this.v] != this.pTeam[cyc] || this.pFoc[cyc] == this.v || passV == 0)  // 97024
      {
         this.viable = (this.pAnim[cyc] == 200) ? this.GrabViable(this.v) : this.AttackViable(this.v);
         if(this.viable > 0)
         {
            this.distance = this.GetDistance(this.pX[cyc],this.pZ[cyc],this.pX[this.v],this.pZ[this.v]);
            if(this.pAnim[this.v] >= 500 && this.pAnim[this.v] <= 504) { this.distance *= 1.25; }  // 97037-97040
            if(this.distance < range && impactY > this.pY[this.v] - 5)                              // 97041
            {
               this.angle = this.LookAngle(...);
               angleRange = 25 * (range / this.distance);        // 97044  wider cone when closer
               if(this.pAnim[cyc] == 1082) { angleRange *= 1.25; }  // 97045-97049  hind kick
               if(this.AngleDistance(this.angle,this.pA[cyc] + sweetSpot) <= angleRange
                  || this.distance <= 5)                          // 97050
```

So the hit condition is exactly:

```
distance  <  range * pScale_attacker * 0.9
impactY   >  victim.pY - 5
angular offset from facing+sweetSpot  <=  25 * (range / distance)   OR  distance <= 5
```

**Hit chance is therefore binary and deterministic given positions.** The only randomness enters
afterwards (critical ×2, and the target's `pSting` cooldown).

### 2.3 Contact height selects the reaction (`contact`)

```as3
this.contact = 0;
if(this.viable >= 1 && this.viable <= 2 && impactY < this.pY[this.v] + 50 * this.pScale[this.v])
{
   this.contact = 11;                                          // 97055  head/upper
   if(impactY < this.pY[this.v] + 25 * this.pScale[this.v]) { this.contact = 12; }   // 97058  chest
   if(this.contact == 12 && this.Rnd(0,2) == 0) { this.contact = this.Rnd(13,14); }
   if(impactY <= this.pY[this.v] + 16 * this.pScale[this.v])
   {
      if(this.pAnim[cyc] >= 1030 && this.pAnim[cyc] <= 1039) { this.contact = 13; }  // 97066-97069  kick
      else                                                  { this.contact = 14; }  // 97072  low
      if(this.Rnd(0,2) == 0) { this.contact = this.Rnd(13,14); }
   }
   if((this.pAnim[cyc] == 1082 || this.pAnim[cyc] == 1083) && this.Rnd(0,2) == 0)
   {
      this.contact = this.Rnd(13,14);
   }
}
if(this.viable >= 3 && impactY < this.pY[this.v] + 10 * this.pScale[this.v] && this.pAnim[cyc] != 200)
{
   this.impactX = this.pX[cyc] + this.AdvanceX(this.pA[cyc],range);      // 97086
   this.impactZ = this.pZ[cyc] + this.AdvanceZ(this.pA[cyc],range);
   this.contact = this.LyingContact(this.v,this.impactX,this.impactZ,10); // 97088  grounded contact
}
```

`contact` codes drive `HitReaction` (97504): `11` = head (also `RiskHeadDamage(cyc,1)` at 97553),
`12` = body, `13/14` = mid/low sell variants. `1..3` route to `GroundReaction`.

### 2.4 Immunity / "can't be hit right now" windows

```as3
if(this.contact > 0 && this.pFoc[this.v] == cyc && this.pSting[this.v] > 0 && this.pAnimTim[this.v] <= 107)
{
   if(this.MidAttack(this.v) < 0 && this.Rnd(0,1) == 0)          // 97113  target is winding up
   {
      if(this.Facing(this.v,this.pX[cyc],this.pZ[cyc],45) > 0)
      {
         this.contact = 0;                                        // 97117  he saw it coming
      }
   }
   if(this.MidAttack(this.v) > 0 && this.Rnd(0,2) > 0)           // 97121  target is mid-swing
   {
      if(this.Facing(this.v,this.pX[cyc],this.pZ[cyc],45) > 0)
      {
         this.contact = 0;                                        // 97125
      }
   }
}
```

`MidAttack` (96412) returns:

```as3
-1  when anim == 200 && animTim > 100  (grapple attempt winding up)
-1  when 1000 < anim < 1300 && animTim > 100  (strike recovery, i.e. endlag)
 1  when animTim >= 104 and anim ∈ {1102,1108,1109,1110,1111,1112,1116,1117,1118}  (active frames)
 1  when 1210 <= anim < 1300
 1  when 1300 < anim < 1400
```

So: `-1` = "I am committed and vulnerable" (2/3 chance of being hit anyway), `1` = "I am in active
frames and can armour through / trade". **This is the counter-hit / trade system.**

### 2.5 Parry (`RiskParry`, 97671)

```as3
if(this.pPlatform[v] == this.pPlatform[cyc] && this.pY[cyc] == this.pY[v] && this.pGrappling[v] == 0
   && this.pRun[v] >= 0 && this.pSpecial[cyc] == 0 && this.pDizzy[v] <= 0 && this.pBlind[v] <= 0
   && this.pRole[cyc] != 3)
{
   if(this.pGrappler[v] == 0 || this.pGrappler[v] == cyc)
   {
      this.chance = 150 - this.pStat[v][3];              // 97679  Skill defends
      this.chance *= this.SizeDifference(cyc,v);          // 97680
      if(this.pRunUp[cyc] > 0 || this.pRunUp[v] > 0) { this.chance *= 2; }   // 97681-97684
      if(this.optLevel >= 5 && this.pControl[cyc] > 0) { this.chance *= 0.75; }  // 97685-97688
      if(this.pSpecial[v] > 0 && this.pAnim[cyc] != 200) { this.chance /= 10; }  // 97689-97692
      if(this.pHolding[cyc] > 0 && this.weapWear[this.pHolding[cyc]] == 0) { this.chance /= 2; }
      if(this.pAnim[cyc] == 1082) { this.chance /= 2; }
      ...
```

Parry rate ≈ `risk / (150 - Skill)` per connecting blow. Called from 97173 for `contact 11..12` only,
and gated on `pSpecial[cyc] == 0` — **you cannot parry a special-meter attack.**

### 2.6 Double-impact clash (`DoubleImpact`, 97642)

```as3
if(this.pFoc[v] == cyc && this.MidAttack(v) != 0 && this.pAnim[cyc] != 200 && this.pAnim[v] != 200)
{
   this.chance = this.pStat[cyc][6] / 5;                 // 97646  Toughness/5
   this.randy = this.Rnd(0,this.chance);
   if(this.randy <= 1)
   {
      if(this.Facing(v,this.pX[cyc],this.pZ[cyc],45) > 0)
      {
         if(this.AttackViable(cyc) >= 1 && this.AttackViable(cyc) <= 2
            && this.AttackViable(v) >= 1 && this.AttackViable(v) <= 2)
         {
            this.pHealth[cyc] -= this.pStat[v][2];        // 97657  victim's Strength hits attacker
            this.pHP[cyc] = 0;                            // 97658
            this.pHP[v] = 0;                              // 97659
            this.pHeat[cyc] -= 25;                        // 97660
            this.HitReaction(cyc,11);                     // 97662
```

Both fighters swinging at each other produces a clash where **the attacker eats the defender's
Strength stat as damage.** `Toughness/5` → at Toughness 75 that is `Rnd(0,15) <= 1`, ~12 % per exchange.

### 2.7 The contested-action model — the *real* "to-hit" system

Everything that is not a geometric strike is resolved by one shared template. This is the mechanism a
port must reproduce exactly; it is where Skill/Strength/Agility actually compete.

```as3
this.chance = this.pStat[cyc][3];                                 // 67944  Skill
if(style == 1) { this.chance = this.pStat[cyc][2]; }              // 67945-67948  Strength
if(style == 2) { this.chance = this.pStat[cyc][4]; }              // 67949-67952  Agility
this.chance += 150 - this.pStat[v][3];                            // 67953  + (150 - defender Skill)
this.chance *= this.SizeDifference(cyc,v);                        // 67954
if(this.pRunUp[cyc] != 0 || this.pRunUp[v] != 0) { this.chance *= 0.75; }   // 67955-67958
if(this.optLevel >= 5 && this.pControl[cyc] > 0)  { this.chance *= 0.75; }  // 67959-67962
if(this.PrematureFinisher(cyc)) { this.chance /= 2; risk *= 2; }            // 67963-67967
if(this.chance < risk * 2) { this.chance = risk * 2; }                      // 67968-67971  floor
this.randy = int(Math.random() * this.chance);                              // 67972
if(this.randy <= risk && this.FindStruggle(v) > 0 && this.pReverse[v] == 0
   && this.pRunUp[v] >= 0 && this.pSpecial[cyc] <= 0)                       // 67973
```

The universal contest formula is therefore:

```
chance = attackerStat(style) + (150 - defenderSkill)
chance *= SizeDifference
chance *= 0.75 if either party is running
chance *= 0.75 if optLevel>=5 and the attacker is human-controlled
chance /= 2  and risk *= 2  if this is a premature finisher
chance  = max(chance, FLOOR * risk)
success = randy <= SUCCESS * risk     where randy = int(random() * chance)
P(success) ≈ (SUCCESS * risk) / max(chance, FLOOR * risk)
```

| Function | Line | `style` stat | FLOOR | SUCCESS | Effect |
|---|---|---|---|---|---|
| `RiskStruggle` | 67939 | 0 Skill / 1 Str / 2 Agi | 2 | 1 | victim reverses the *direction* of a hold (`pReverse[v] = rewind`) |
| `RiskReversal` | 67990 | always Skill | 6 | 3 | victim fully reverses; `pReverse[v] = -1` |
| `RiskCounter` | 68038 | defender's stat, per anim | 2 | 1 | victim counters into `newAnim`/`newTim` |
| `BreakMove` | 68109 | 0 Skill / 1 Str / 2 Agi | 6 | 3 | victim breaks the grapple entirely |

Because of the floor, **no contest is ever worse than 50 % for the initiator** (SUCCESS/FLOOR = 0.5 in
all four), and `RiskReversal`/`BreakMove` are always at least 50 % when `chance <= 6*risk`. This is the
design that keeps the game readable: a hopeless defender still reverses half the time on a low-risk
move. The way to beat it is to raise `risk` — high-risk moves are genuinely high-risk.

`RiskCounter` additionally special-cases the defender's special meter:

```as3
this.chance = (150 - this.pStat[v][3]) * 2;                        // 68043  Skill defends
if(newAnim >= 211 && newAnim <= 213) { this.chance = (150 - this.pStat[v][2]) * 2; }   // 68044-68047  Strength
if(newAnim == 216 || newAnim >= 280 && newAnim <= 286 || newAnim == 319
   || newAnim == 320 || newAnim == 322)
{
   this.chance = (150 - this.pStat[v][4]) * 2;                     // 68048-68051  Agility
}
...
if(this.pSpecial[v] > 0 && this.pSpecial[cyc] <= 0)
{
   this.chance /= 2;                                                // 68074-68076
   if(newAnim == this.charMove[this.pChar[v]][15] || newAnim == this.charBackMove[this.pChar[v]][4])
   {
      this.chance = 0;                                              // 68077-68080  cannot counter a finisher
   }
}
```

`RiskReversal` has the mirror: `if(pSpecial[v] > 0 && pSpecial[cyc] <= 0) { randy = 0; }` (68015–68018)
— a specialed defender **always** reverses.

`SizeDifference` (67921) — the size contest multiplier:

```as3
differ = this.pScale[cyc] - this.pScale[v];        // 67925
if(differ < 1) { differ *= 2; }                    // 67926-67929  (always true; scale max ~1)
if(differ < -0.9) { differ = -0.9; }               // 67930-67933
differ = 1 + differ;                               // 67934
weightFactor = 1 + (this.charBuild[cyc] - this.charBuild[v]) * 0.1;   // 67935
return differ * weightFactor;                      // 67936
```

`ScaleDifference = 1 + 2*(height_a - height_b)/100`, clamped to `[0.1, 3]`, times
`1 + 0.1*(build_a - build_b)`. Note `build` is a 1–5 body-type index, so the weight factor spans
0.6–1.4 — **body build matters as much as height**.

`FindStruggle` (12364) is the human/AI input gate: `1` if any direction is pressed, `2` if any action
(grapple/attack/run/pickup) is pressed, and for AI it is `Rnd(1,2)` — **AI always struggles**.

### 2.8 Special-meter attacks cannot be beaten

Repeated throughout the AI and contest code:

```as3
if((this.pSpecial[cyc] <= 0 || this.pSpecial[v] > 0) && ...)     // 67636, 84417
if(this.pSpecial[v] > 0 && this.pSpecial[cyc] <= 0) { ... }      // 68015, 68074
this.chance /= 10;   // when the *defender* has special and you don't      67636-area
```

A fighter with `pSpecial > 0` wins or heavily favours essentially every contested interaction
(reversal, escape, parry, strike trade). This is the design purpose of the meter.

---

## 3. Movement / speed / transition formulas

### 3.1 Attack animation speed

```as3
public function GetAttackSpeed(stat:int) : int
{
   speed = 8 - Math.round(this.pStat[this.cyc][4] / 18);      // 96795   Agility
   if(speed < 3) { speed = 3; }
   if(speed > 5) { speed = 5; }
   return speed;
}
```

| Agility | raw `8 - round(A/18)` | final |
|---|---|---|
| 0–8 | 8 | 5 (clamped) |
| 9–26 | 7 | 5 (clamped) |
| 27–44 | 6 | 5 (clamped) |
| 45–62 | 5 | 5 |
| 63–80 | 4 | 4 |
| 81–98 | 3 | 3 |

So agility only has **three distinct breakpoints**: ≤62 → 5, 63–80 → 4, ≥81 → 3. This is the
"frames per animation step" for a strike — lower is faster. Per-anim modifiers adjust it:
`--this.s` (1005, 1030, 1040, 1190, 1191) and `++this.s` (1010, 1017, 1018, 1021, 1034, 1035).

### 3.2 Movement speed (`speeder`)

`speeder` is computed **only inside the walk state** (`pAnim[cyc] == 10`) and is the literal per-frame
movement distance:

```as3
if(this.pAnim[cyc] == 10)
{
   this.angle = this.pTA[cyc];
   this.speeder = 1 + 0.0375 * (this.pStat[cyc][4] - 50);        // 57384  Agility
```

Then a chain of modifiers, in order:

```as3
   if(this.matchState == 0 && this.matchEnter > 0 && cyc != this.matchEnter)   // 57386 entrance walk
   {
      if(this.pTeam[cyc] == this.pTeam[this.matchEnter])
      {
         pace = 1 + 0.0375 * (this.pStat[this.matchEnter][4] - 50);            // 57389
         if(this.speeder > pace) { this.speeder = pace; }                      // 57391-57394  keep pace with leader
      }
   }
   if(this.pGamepad[cyc] > 0) { this.speeder *= this.GetAnalog(this.pGamepad[cyc]); }   // 57397-57400
   if(this.pDizzy[cyc] > 0 || this.pBlind[cyc] > 0 || this.pInjured[cyc] != 0 || this.screen == 60)
   {
      this.pAccel[cyc] = 0.5;                                                  // 57401-57404
   }
   if(this.pHealth[cyc] < 100 * this.optLength && this.pSpecial[cyc] <= 0 && this.pRun[cyc] == 0)
   {
      this.pAccel[cyc] = 0.5;                                                  // 57405-57408  near-death crawl
   }
   this.speeder *= this.pAccel[cyc];                                            // 57409
   if(this.pAccel[cyc] < 1) { this.pAccel[cyc] += 0.1; }                         // 57410-57413  ramp 0.5 -> 1.0
   ...
   this.speeder *= 2;                                                           // 57498  walking (pRun >= 0)
```

and the actual move:

```as3
this.pTravelA[cyc] = this.angle;
this.pTravel[cyc] = this.speeder;              // 57576
this.Advance(cyc,this.pTravelA[cyc],this.pTravel[cyc]);   // 57577
```

**Effective walk speed:**

```
speeder = (1 + 0.0375*(Agility - 50)) * analog * pAccel * 2
```

| Agility | `1+0.0375*(A-50)` | final (×2, accel 1.0) |
|---|---|---|
| 0 | 0.4375 (-56 %) | 0.875 |
| 25 | 0.5625 | 1.125 |
| 50 | 1.0 | 2.0 |
| 75 | 1.9375 | 3.875 |
| 98 | 2.8 | 5.6 |

Agility 98 is **6.4× faster** than Agility 0. This is by far the most aggressive stat curve in the
game and the reason Agility is the dominant mobility stat.

**`pAccel` is a start-up ramp**: it begins at 0.5 and adds 0.1/frame → full speed after 5 frames, and
is knocked back to 0.5 by being dizzy, blind, injured, in `screen == 60`, or below
`100*optLength` health with no special meter while not running. So a hurt wrestler restarts the ramp
on every step.

**Animation cadence derived from speed:**

```as3
this.pTransition[cyc] = Math.round(6 - this.speeder);        // 57491  walking
this.s = Math.round(this.pTransition[cyc] * 0.75);           // 57492
```

with `speeder` already ×2, so `pTransition` goes negative / small at high agility and the clamp on
`pTurnSpeed` handles it. **Faster movement = faster leg animation**, automatically.

### 3.3 Transition / turn speed

There is no single global transition formula — it is per state:

```as3
// idle / breathing (57176-57181)
this.pTransition[cyc] = this.pBreathe[cyc];
this.pTurnSpeed[cyc] = 5;
if(this.pAnimTim[cyc] < 10 && this.pTransition[cyc] > 20 && tired == 0) { this.pTransition[cyc] = 20; }

// walking (57491)
this.pTransition[cyc] = Math.round(6 - this.speeder);

// running / no-fit path (57503-57512)
this.GetWalk(cyc);
this.pTransition[cyc] = Math.round((3 - this.speeder) * 5);
if(this.pTransition[cyc] < 5) { this.pTransition[cyc] = 5; }

// anim 11 (57594) — a specific signature anim, not a generic case
this.pTransition[cyc] = Math.round(8 - this.pStat[cyc][4] / 20);

// turn speed follows the transition, then debuffs (57514-57522)
this.pTurnSpeed[cyc] = this.pTransition[cyc];
if(this.pDizzy[cyc] > 0 || this.pBlind[cyc] > 0)         { this.pTurnSpeed[cyc] *= 2; }
else if(this.pControl[cyc] > 0 && this.pSwitchTim[cyc] >= 15) { this.pTurnSpeed[cyc] /= 2; }
```

Note the **counter-intuitive sign**: for dizzy/blind the *turn speed number grows* (`*= 2`). Lower
`pTransition` = faster animation, so `*2` makes turning **slower**. Direction matters when porting.
`pSwitchTim >= 15` (you just switched characters) halves the number, i.e. turns faster — a control
convenience.

`pTransition` is also used as the animation blend duration directly:
`this.pTransition[cyc] = transition;` in `HoldEffects` (88291), and it is tripled while the victim
struggles a submission (`88357`).

### 3.4 Breathing / idle animation timing

```as3
this.pBreathe[cyc] = 20;                                            // 55357 initial
this.pBreathe[cyc] = this.Rnd(10,20);                               // 68400-68401 after a move impact
this.pTransition[cyc] = this.pBreathe[cyc];                         // 57176
if(this.pAnimTim[cyc] < 10 && this.pTransition[cyc] > 20 && tired == 0)
{
   this.pTransition[cyc] = 20;                                      // 57178-57181  cap at 20 when idle
}
```

`pBreathe` is randomised 10–20 after every impact, so a winded wrestler visibly animates slower.

### 3.5 Tired-state animation overrides

```as3
if(this.pInjured[cyc] != 0) { /* animID[3]+59 / +57 */ tired = 1; }              // 57153-57158
if(this.pHealth[cyc] < 500 * this.optLength && this.pSpecial[cyc] <= 0)
{
   /* animID[5]+22 / +23 */ tired = 1;                                          // 57159-57164  <10% HP
}
if(this.pInjured[cyc] == 10) { /* animID[3]+88 / +89 */ tired = 1; }             // 57165-57170  severe
if(this.pBlind[cyc] > 0) { /* animID[9]+74 / +73 */ }                           // 57171-57175
```

At `< 500*optLength` (10 % of max) with no special meter, the character permanently uses the
"exhausted" idle. **This is a visible, purely-threshold state — no continuous speed penalty.**

### 3.6 Attack charge (`CockAttack`, 96807) — the damage multiplier

```as3
if(this.pAnimTim[cyc] <= 1) { this.pCharge[cyc] = 1; }
else if(this.pCharge[cyc] < 2) { this.pCharge[cyc] += 0.1; }      // 96810-96817
...
travel *= this.pStat[cyc][4] / 90;                                // 96831  forward travel scales with Agility
if(this.pRunUp[cyc] > 0 && this.pOldAnim[cyc] != 701)
{
   if(travel < 2) { travel = 2; }
   travel *= this.pStat[cyc][4] / 50;                             // 96832-96839  running lunge
}
```

`pCharge` ramps 1.0 → 2.0 at +0.1/frame and **is the pain multiplier for basic strikes** (see §4.1).

**Critical finding — the charge mechanic is vestigial.** `CockAttack` is called on every windup frame,
i.e. only while `animTim < 100`:

```as3
if(this.animTim < 100)                       // 94062
{
   this.pAnimFrame[cyc] = this.startFrame;
   this.pTransition[cyc] = this.s * 2;
   this.CockAttack(cyc,this.s - 3 + linger,1);   // 94066  -> pCharge += 0.1 each frame
}
```

and the hit window only opens at frame `99 + s + linger` (94076), i.e. frame ≥ 102. `pCharge` reaches
its 2.0 cap by frame 10. Therefore **every strike that lands, lands at `pCharge == 2.0`**. The
"hold to charge" mechanic that the variable implies does not exist in the shipped build. A port can
substitute the constant `2.0` with no behavioural change — but keep the variable if you intend to
restore the intended design.

The only way `pCharge` is not 2.0 at impact is an attack that reaches its hit window in under
10 frames, which cannot happen because the window is gated on `animTim >= 100`.

---

## 4. Attack catalogue (anim → geometry → pain)

Extracted from `AttackAnims` (93721–96165) and `GetAttackRange` (96613). `angle` is the sweet-spot
offset from facing, `range` the forward reach in engine units, `rangeY` the vertical hit-box centre,
`smod` the added to `GetAttackSpeed` result. **`pain` is the multiplier passed to `FindImpacts`,
which then multiplies by Strength.**

### 4.1 Basic strikes — anim 1001–1024 (`weapon = 1`)

| anim | angle | range | rangeY | s | pain mult |
|---|---|---|---|---|---|
| 1001 | 5 | 20 | 30 | 0 | `pCharge` |
| 1002 | 10 | 18 | 35 | 0 | `pCharge` |
| 1003 | 5 | 18 | 35 | 0 | `pCharge` |
| 1004 | 0 | 20 | 35 | 0 | `pCharge` |
| 1005 | 10 | 22 | 35 | -1 | `pCharge` |
| 1006 | 5 | 22 | 35 | 0 | `pCharge` |
| 1007 | 10 | 22 | 30 | 0 | `pCharge` |
| 1008 | 10 | 22 | 35 | 0 | `pCharge` |
| 1009 | 10 | 21 | 35 | 0 | `pCharge` |
| 1010 | 10 | 23 | 35 | +1 | `pCharge` |
| 1011 | 15 | 20 | 35 | 0 | `pCharge` |
| 1012 | 5 | 21 | 35 | 0 | `pCharge` |
| 1013 | 10 | 21 | 35 | 0 | `pCharge` |
| 1014 | 10 | 24 | 35 | 0 | `pCharge` |
| 1015 | 10 | 23 | 35 | 0 | `pCharge` |
| 1016 | 5 | 25 | 35 | 0 | `pCharge` |
| 1017 | 15 | 23 | 35 | +1 | `pCharge` |
| 1018 | 5 | 25 | 35 | +1 | `pCharge` |
| 1019 | 5 | 25 | 35 | 0 | `pCharge` |
| 1020 | -10 | 22 | 35 | 0 | `pCharge` |
| 1021 | -5 | 23 | 35 | +1 | `pCharge` |
| 1022 | -5 | 21 | 35 | 0 | `pCharge` |
| 1023 | -5 | 25 | 35 | 0 | `pCharge` |
| 1024 | 5 | 24 | 35 | 0 | `pCharge` |

Basic strikes therefore do **`Strength * pCharge`**, and `pCharge` is effectively **always 2.0** at the
moment of impact — see §3.6. A Strength-75 basic strike is therefore **150 HP** (1.5 % of a 10,000 bar).
The `pCharge` variable is a vestigial charge mechanic: the hit window opens at frame `99+s+linger`
(≥ 102) while `pCharge` saturates at frame 10. Treat the multiplier as the constant `2.0` unless you
deliberately re-introduce a charge system.

### 4.2 Kicks — anim 1030–1045 (`weapon = 0`)

| anim | angle | range | rangeY | s | pain mult |
|---|---|---|---|---|---|
| 1030 | 5 | 18 | 20 | -1 | `pCharge` |
| 1031 | 5 | 20 | 20 | 0 | `pCharge` |
| 1032 | 5 | 20 | 20 | 0 | `pCharge` |
| 1033 | 5 | 21 | 20 | 0 | `pCharge` |
| 1034 | 5 | 25 | 20 | +1 | `pCharge` |
| 1035 | 10 | 22 | 20 | +1 | `pCharge` |
| 1036 | 5 | 25 | 20 | 0 | `pCharge` |
| 1037 | 10 | 24 | 20 | 0 | `pCharge` |
| 1038 | 10 | 22 | 10 | 0 | `pCharge` |
| 1039 | 10 | 22 | 10 | 0 | `pCharge` |
| 1040 | -5 | 18 | 20 | -1 | `pCharge` |
| 1041 | -5 | 20 | 20 | 0 | `pCharge` |
| 1042 | -5 | 25 | 20 | 0 | `pCharge` |
| 1043 | -10 | 24 | 20 | 0 | `pCharge` |
| 1044 | -10 | 22 | 10 | 0 | `pCharge` |
| 1045 | -10 | 22 | 10 | 0 | `pCharge` |

Note `rangeY 20/10` vs `30/35` for punches: **kicks have a low hit box**, so they whiff on a standing
opponent's head height and are the tool that reaches a grounded opponent (`AttackViable == 3`).

Both tables share the block condition `pAnim >= 1001 && pAnim < 1050` (93730), the same 3-frame active
window (94078) and the same `pCharge` pain multiplier (94080/94084). Anim ids 1025–1029 and 1046–1049
do not exist in the source table; an attack id in those gaps falls through to the `range = 20` default
of `GetAttackRange` (96616) and has no `startFrame`/`angle` assignment, so they are never selected by
`SelectAttack`.

`weapon = 1` on 1001–1024 and `0` on 1030–1045 is the `weapon` argument to `FindImpacts`, which gates
whether a held weapon participates (`WeaponImpact`, 97236–97239). It is **not** "armed vs unarmed" —
it is "this limb can carry a weapon's impact".

### 4.3 Special / signature strikes — anim 1050, 1051, 1052, 1080–1083, 1090

| anim | sweetSpot | range | rangeY | pain mult | weapon |
|---|---|---|---|---|---|
| 1050 | 5 | 22 | 20 | `pCharge` | 0 |
| 1051 | 0 | 18 | 30 | `pCharge` | 1 |
| 1052 | 0 | `105 + 22 - animTim` | 35 | `pCharge` | 0 |
| 1080 (clothesline) | 30 / 0 | 15 / 19 | 20 | `pCharge` | 1 |
| 1081 (running?) | 135 | 17 | 20 | `pCharge * 2` | 0.5 |
| 1082 (hind kick) | 150 / 170 | 15 / 20 | 20 | `pCharge * 1.25` / `pCharge * 2` | 0 |
| 1090 (weapon swing) | 10 | `22 + weapSize[weapType[w]]` | 35 | `pCharge` | 1 |

Note there is no `--this.s` for these; 1050/1051/1052 are inside the 1001–1049 speed block, so they
still use `GetAttackSpeed`. `1052` expands its reach over time (`105 + 22 - animTim`).

### 4.4 Power / running strikes — anim 1101–1122, 1190–1191 (`weapon` 0 or 1)

| anim | sweetSpot | range | rangeY | pain mult | weapon |
|---|---|---|---|---|---|
| 1101 | 10 | 21 | 30 | `3 + pCharge` | 1 |
| 1102 | 10 | 21 | 30 | `3 + pCharge` | 1 |
| 1103 | 20 | `this.range` | 30 | `3 + pCharge` | 1 |
| 1104 | 90 | 17 | 30 | `3 + pCharge` | 1 |
| 1105 | 5 | 17 | 30 | `3 + pCharge` | 1 |
| 1106 | 5 | 17 | 30 | `4 + pCharge` | 1 |
| 1107 | 15 | 23 | 35 | `4 + pCharge` | 1 |
| 1108 | 20 | 17 | 30 | `3 + pCharge` | 1 |
| 1109 | 20 | 17 | 30 | `3 + pCharge` | 1 |
| 1110 | 0 | 23 | 30 | `3 + pCharge` | 0 |
| 1111 | 0 | 23 | 30 | `3 + pCharge` | 0 |
| 1112 | 0 | `26 + (animTim - 108)` | 30 | `3 + pCharge` | 0 |
| 1113 | 0 | `26 + (animTim - 109)` | 35 | `4 + pCharge` | 0 |
| 1114 | 0 | `24 + (animTim - 109)` | 35 | `4 + pCharge` | 0 |
| 1115 | 0 | `22 + (animTim - 107)` | 35 | `3 + pCharge` | 0 |
| 1116 | 0 | 20 | 30 | `3 + pCharge` | 0 |
| 1117 | 0 | `24 - (110 - animTim)` | 30 | `3 + pCharge` | 0 |
| 1118 | 0 | 15 | 30 | `4 + pCharge` | 0 |
| 1119 | 0 | `this.range` | 30 | `4 + pCharge` | 0 |
| 1120 | 10 | 22 | 20 | `4 + pCharge` | 0 |
| 1121 | -10 | 17 | 30 | `4 + pCharge` | 1 |
| 1122 | 0 | `106 + 22 - animTim` | 35 | `3 + pCharge` | 0 |
| 1190 (weapon) | 10 | `22 + weapSize` | 35 | `3 + pCharge` | 1 |
| 1191 (weapon) | 5 | `22 + weapSize` | 35 | `3 + pCharge` | 1 |

These are the **heavy strikes**: `Strength * (3..6)` with `pCharge` pinned at 2.0, so effectively
`Strength * 5` or `Strength * 6`. A Strength-75 wrestler's 1106 does `75 * 6 = 450` — 4.5 % of the bar
— and forces a knockdown (`pHP = 0`, 97220–97224) because `1100 <= anim < 1200`.

### 4.5 Range lookup (`GetAttackRange`, 96613) — verbatim, all 43 entries

This function is used **only** to reject long-range-inappropriate attacks during AI selection
(96602). It is *not* the hit test; the hit test uses the per-anim `range` in §4.1–4.4.

| range | anim ids (verbatim, 43 total) |
|---|---|
| 18 | 1002, 1003, 1030, 1040, 1051 |
| 20 | 1001, 1004, 1011, 1031, 1032, 1033, 1038, 1041, 1044 |
| 21 | 1009, 1012, 1013, 1022 |
| 22 | 1005, 1006, 1007, 1008, 1020, 1035, 1050, 1052 |
| 23 | 1010, 1015, 1017, 1021, 1039, 1045 |
| 24 | 1014 |
| 25 | 1016, 1018, 1019, 1023, 1024, 1034, 1036, 1037, 1042, 1043 |

The rejection rule only cares about the `<= 20` boundary:

```as3
this.satisfied = 1;
if(attack != 1019)
{
   if(this.GetAttackRange(attack) <= 20 && this.distance > 20)
   {
      this.satisfied = 0;              // 96604  reroll this attack
   }
}
```

So the whole 43-entry table collapses to **"range 18/20 attacks cannot be chosen beyond distance 20;
21–25 can"**. `1019` is exempt.

### 4.6 Active hit windows

The per-anim attack blocks do **not** run `FindImpacts` every frame; each has an explicit active window,
which is what makes strike timing matter:

```as3
// basic strikes 1001-1045 (94078-94086)
if(this.animTim >= 99 + this.s + linger && this.animTim <= 101 + this.s + linger)
{
   if(this.pAnim[cyc] >= 1035 && this.pAnim[cyc] <= 1039 || this.pAnim[cyc] >= 1042 && this.pAnim[cyc] <= 1045)
   {
      this.FindImpacts(cyc,this.angle,this.range + (this.animTim - (101 + this.s + linger)),this.rangeY,this.pCharge[cyc],weapon);  // 94080  growing reach
   }
   else
   {
      this.FindImpacts(cyc,this.angle,this.range,this.rangeY,this.pCharge[cyc],weapon);   // 94084
   }
}

// power strikes, e.g. 1101 (94717-94720)
if(this.animTim <= 100 + this.s + 1)
{
   this.FindImpacts(cyc,5,17,30,3 + this.pCharge[cyc],1);
}
```

So a basic strike is live for exactly **3 frames** (`99+s+linger` … `101+s+linger`), and `s` comes from
`GetAttackSpeed` — a faster wrestler's whole window slides *earlier*, which is why Agility reads as
"starts the swing sooner" rather than "recovers faster". Kicks 1035–1039/1042–1045 get **reach that
grows across the window** rather than a fixed range.

`pSting` enforces one hit per swing:

```as3
if(cyc != this.v && this.pActive[this.v] > 0 && this.pSting[cyc] > 0)   // 97022
...
this.pSting[cyc] = -this.v;                                            // 97135  consumed
...
if(this.pSting[cyc] <= 0) { break; }                                    // 97142-97145  stop scanning
```

### 4.7 AI attack selection (`SelectAttack`, 96483)

```as3
this.distance = this.Rnd(15,30);                                  // 96489  (when no target)
if(v > 0) { this.distance = this.GetDistance(...); }              // 96492
if(level == 0) { level = (this.Rnd(0,2) == 0) ? 2 : 1; }           // 96498-96508  light vs heavy
```

**Light (level 1) branch:**

```as3
if(this.Rnd(0,2) == 0 && this.w == 0)
{
   attack = this.Rnd(1020,1021);                                  // 96520  backhand
   if(this.distance > 25 || this.distance > 20 && this.Rnd(0,1) == 0)
   {
      attack = this.Rnd(1022,1023);                               // 96523  longer backhand
   }
}
else
{
   attack = this.Rnd(1007,1014);                                  // 96528  default punch pool
   if(this.distance < 15)
   {
      attack = this.Rnd(1001,1006);                               // 96531  close pool
      if(this.Rnd(0,5) == 0) { attack = 1051; }                   // 96534
   }
   if(this.distance > 25 || this.distance > 20 && this.Rnd(0,1) == 0)
   {
      attack = this.Rnd(1015,1019);                               // 96539  long pool (running)
   }
   if(this.charStat[char][4] >= 80 && this.Rnd(0,10) == 0 && this.charAttack[char][1] != 1019)
   {
      attack = 1019;                                              // 96541-96544  agility ≥ 80 signature
   }
   if(this.distance > 20 && this.distance < 25 && this.Rnd(0,10) == 0) { attack = 1052; }   // 96545-96548
   if(attack >= 1002 && attack <= 1003 && this.Rnd(0,1) == 0) { attack = 1010; }            // 96549-96552
   if(attack >= 1007 && attack <= 1009 && this.Rnd(0,1) == 0) { attack = 1011; }            // 96553-96556
}
if(this.Rnd(0,2) == 0 && this.charAttack[char][1] > 0) { attack = int(this.charAttack[char][1]); }  // 96558-96561
```

**Heavy (level 2) branch:**

```as3
if(this.Rnd(0,2) == 0 && this.w == 0)
{
   attack = this.Rnd(1040,1041);
   if(this.Rnd(0,1) == 0 || this.distance > 25) { attack = this.Rnd(1042,1045); }   // 96567-96571
}
else
{
   attack = this.Rnd(1030,1033);                                                   // 96575
   if(this.distance > 25 || this.distance > 20 && this.Rnd(0,2) == 0) { attack = 1034; }  // 96576-96579
   this.randy = this.Rnd(0,5);
   if(this.randy == 0) { attack = this.Rnd(1036,1038); }                            // 96581-96584
   if(this.randy == 1) { attack = 1035; }                                           // 96585-96588
   if(this.randy == 2) { attack = 1050; }                                           // 96589-96592
}
if(this.Rnd(0,2) == 0 && this.charAttack[char][2] > 0) { attack = int(this.charAttack[char][2]); }  // 96594-96597
```

Then a rejection loop:

```as3
this.satisfied = 1;
if(attack != 1019)
{
   if(this.GetAttackRange(attack) <= 20 && this.distance > 20)
   {
      this.satisfied = 0;                                            // 96604  reroll
   }
}
...
while(this.satisfied == 0);                                          // 96609
```

So: an attack with `range <= 20` is **never** chosen from further than 20 units. `charAttack[char][1]`
and `[2]` are the roster's per-character custom light/heavy attack ids, used 1/3 of the time each.

### 4.8 Weapon reach

```as3
range = 22 + this.weapSize[this.weapType[this.w]]                 // 1090, 1190, 1191
```

`weapSize`/`weapType` are per weapon item; `pHolding`/`weapWear` gate whether the weapon is usable
(`weapWear > 0` → treated as unarmed, 96510–96513).

---

## 5. Momentum & special meter

Two coupled resources: `pHeat` (momentum, shown on the HUD) and `pSpecial` (the "signature ready"
counter). They are **not** the same variable.

### 5.1 `pHeat` — momentum, 0–1000

Initial value `500` (55405). Gains/losses:

| Site | Delta |
|---|---|
| 22046–22047 | `+50` attacker / `-50` victim (corner slam) |
| 55989 | `-1` at `P(1/(101+Popularity))` per frame — **passive decay** |
| 55999–56002 | clamped to `1000` |
| 56005 | forced to `250` when `tempSpecial == 1` |
| 56523 | `/= 2` on injury |
| 62719–62722 | `-50` (counter) |
| 67979, 68027, 68091, 68156 | `-25` to `-50` (failed grapple/reversal) |
| 68392–68393 | `± pain / 10` (move impact) |
| 68400 | *(n/a)* |
| 58718 | `+ Rnd(0,1)` per frame in some state |
| 97233–97234 | `± pain / 10` (strike) |
| 97280–97281 | `± 10` (grab/instant move) |
| 97660 | `-25` on double-impact clash |
| 88409–88410 | `+1` / `-1` per frame in a submission hold |
| 45990 | set to `900` (scripted) |

Passive decay from 55986–55993:

```as3
this.chance = 100 + this.pStat[cyc][1];          // 55981  100 + Popularity
if(this.gamTutorial == 99 && cyc == this.matchPlayer) { this.chance = 10; }
this.randy = this.Rnd(0,this.chance);
if(this.randy <= 1) { this.pHeat[cyc] = this.pHeat[cyc] - 1; }   // 55987-55990
if(this.pHeat[cyc] < 0) { this.pHeat[cyc] = 0; }                  // 55991-55994
```

**Popularity slows momentum decay** — `1/(101+Pop)` per frame. At Pop 50 that is ~1 per 151 frames
(≈8.4 s at 18 fps). Momentum is *not* consumed by using a special; it is a rating/hype meter that
also feeds `entScore`.

HUD mapping: `meterClip.HeatMeter.scaleX = pShowHeat / 1000` (56148).

### 5.2 `pSpecial` — signature-move counter

**Acquisition.** `pSpecial` is set by performing a taunt (anim 1):

```as3
if(this.pAnim[cyc] == 1)
{
   ...
   if(this.pAnimTim[cyc] == 4)
   {
      if(this.crowdSize > 0) { this.Pop(cyc,10,1); } else { this.ProduceSound(this.sCrowd[0],0,0,1); }
      this.pSpecial[cyc] = 100 + this.pStat[cyc][1] + this.Rnd(0,100);   // 57230
      this.entScore += this.pPop[cyc];
   }
   if(this.pAnimTim[cyc] > 8)
   {
      ...
      this.pHP[cyc] = 1000;                                                // 57243  full poise refund
   }
}
```

So **`pSpecial = 100 + Popularity + Rnd(0,100)`** — range 100–298 for a normal wrestler. It is a
*frame budget*, not a boolean: it decrements by 1 every frame while active:

```as3
if(tempSpecial > 0)
{
   this.pSpecial[cyc] = this.pSpecial[cyc] - 1;                     // 56009
   this.anim = this.pAnim[cyc];
   if(this.anim >= 210 && this.anim < 300 || this.anim >= 310 && this.anim < 400
      || this.anim >= 410 && this.anim < 500 || this.anim >= 510 && this.anim < 600
      || this.anim >= 900 && this.anim < 1000)
   {
      if(this.pStretched[this.pGrappling[cyc]] == 0 && this.pPinning[cyc] == 0)
      {
         this.pSpecial[cyc] += 1;                                   // 56015  refund if not mid-grapple
      }
      if(this.pStretched[this.pGrappling[cyc]] != 0)
      {
         this.pSpecial[cyc] += this.Rnd(0,1);                        // 56019  slow drain during a hold
      }
   }
}
```

That is: the special meter only actually drains **while you are doing a grapple move** (anim
210–299, 310–399, 410–499, 510–599, 900–999). Idle/striking frames refund it. At `100 + Pop + Rnd(0,100)`
≈ 200 frames of special, a wrestler gets roughly 200 frames of "empowered" grappling.

Effects while `pSpecial > 0`:

| Effect | Site |
|---|---|
| Strike pain ×1.25 | 97004–97007 |
| Grapple `level = 10` (max) | 68362–68365 |
| Cannot be parried | 97689–97692 (`chance /= 10` for the *defender*) |
| Contest chance ×10 / ÷10 | 88489–88496, 67636, 68015 |
| Move transition halved | 88287–88290 |
| `pDizzy`/`pBlind` cleared | 55840–55844 |
| Health regen regardless of Stamina | 55871 (`tempSpecial > 0` bypass) |
| Improves the submission escape contest | 88489–88496 |
| Hurts the defender's parry | 97689–97692 |

After a move it is divided by 3 if still large:

```as3
if(this.pSpecial[cyc] > 10) { this.pSpecial[cyc] = int(this.pSpecial[cyc] / 3); }   // 68429-68432
```

`tempSpecial` is the *persistent* version (set outside the match), used to bypass the normal check.
`tempSpecial == 1` forces `pHeat = 250` and `pHeat = 1000` (55999–56006).

### 5.3 `entScore` — the rating score

Every damage instance adds to `entScore`, which becomes the match rating:

| Contribution | Site |
|---|---|
| `+= pain` | 22048 |
| `+= pain / 2` | 97235, 68394 |
| `+= pop[cyc]` | 57231, 68417, 97519 |
| `+= pop * 4` (blood, legal) | 56483 |
| `+= pop * 10` (injury) | 56519 |
| `+= pop * pinCount` | 97394, 97414 |
| `+= (pop_a + pop_b) * 2` | 88426 |
| `+= 1 + Rnd(0,power)` | 88376 |
| `+= power * 10` | 88388 |
| `+= pop / 4 * (outCount / 2)` | 46992 |
| `+= 2` (special attack) | 88365 |

`GetMatchRating(score)` (51521) converts. This is the "star rating" pipeline — see §8.

### 5.4 The five stats, mapped to their mechanical job

| # | Stat | Where it actually matters |
|---|---|---|
| 1 | Popularity | Momentum decay `1/(101+Pop)`; **`pSpecial` size** `100+Pop+Rnd(0,100)`; down-time escape `300 - Pop*1.5`; `entScore` per action; match-making |
| 2 | Strength | **All damage**: `pain = Strength * mult` (97003), `(50+Str/2)*level` (68384), clash damage (97657) |
| 3 | Skill | Self-injury on whiff (`Rnd(0,Skill) <= 1`, 68433); hold-break `100 + Skill*5` (88488); pin move DT (88604); parry denominator (150-Skill) |
| 4 | Agility | Attack speed `8 - round(Agi/18)`; move speed `1+0.0375*(Agi-50)`; transition `8-Agi/20`; attack travel `Agi/90`; AI attack pool gating at `>= 80` |
| 5 | Stamina | Regen probability `Stamina/100` per frame (55871) |
| 6 | Toughness | **Poise loss** `pain/50*(150-Tou)` (97219); injury chance `Tou*5` (56507); bleed/dizzy/blind chance `Rnd(0,Tou)` (56458); clash `Tou/5` (97646); bleed decay (55818) |
| 7 | Attitude | *Not used in the match engine paths found here* — career/booking only. See UNKNOWNS. |
| 8 | Happiness | *Not used in the match engine paths found here* — career/booking only. See UNKNOWNS. |

### 5.5 Live stat scaling during a match

Stats 2–6 are **re-derived every frame** from the roster value and a health factor:

```as3
this.char = this.pChar[cyc];
for(this.count = 2; this.count <= 6; ++this.count)
{
   if(this.count != 5)                                  // Stamina (5) is excluded
   {
      if(tempSpecial > 0) { this.factor = 1.25; }
      else                { this.factor = 0.75 + this.pHealth[cyc] / (this.optLength * 5000) / 4; }
      if(this.optLevel >= 5 && this.pRole[cyc] == 1)
      {
         if(this.pControl[cyc] > 0 || this.pTeam[cyc] == this.pTeam[this.matchPlayer]) { this.factor -= 0.05; }
         else                                                                          { this.factor += 0.05; }
      }
      this.pStat[cyc][this.count] = this.charStat[this.char][this.count] * this.factor;
      if(this.pStat[cyc][this.count] > 98) { this.pStat[cyc][this.count] = 98; }
   }
}
```

**This is a critical, easily-missed mechanic.** Effective Strength/Skill/Agility/Toughness are:

```
factor = 0.75 + (hp%) / 4                      // 0.75 at 0 HP → 1.00 at full HP
       = 1.25                                  // if special meter active
pStat[n] = min(98, charStat[n] * factor)       // n ∈ {2,3,4,6}  (Stamina excluded)
```

So a wrestler at 50 % health fights at `0.875×` their listed Strength/Skill/Agility/Toughness; at 0 %
they fight at `0.75×`. With the special meter they fight at `1.25×` — a **1.67× swing** versus a
depleted opponent. That is the game's entire "momentum shift" mechanic in one line. The difficulty
scaling `optLevel >= 5` adds ±0.05 based on whether you control the character.

---

## 6. Pin / submission / KO conditions

Match rules come from `GetMatchRules` (44422), which is a large `if(match == n)` chain. Each preset
sets `no_wrestlers`, `no_refs`, `matchType`, `matchRules`, `matchTeams`, `matchPins`, `matchSubs`,
`matchKOs`, `matchBlood`, `matchCountOuts`, `matchTimeLim`.

### 6.1 Rule flags

| Field | Meaning |
|---|---|
| `matchPins > 0` | Pins can win the match |
| `matchSubs > 0` | Submissions can win |
| `matchKOs == 1` | KO (health to 0) wins |
| `matchKOs == 2` | KO by count-out (10-count) |
| `matchBlood > 0` | Blood legal (raises bleed chance ×2) |
| `matchCountOuts` | 0 = off, 1/2 = count-out limit |
| `matchRules >= 2` | Rope-break rule active |
| `matchTeams` | Tag match |
| `matchType` | 0 = singles, 1–5 = gimmick variants (see table) |

Presets 0–7 verbatim:

| # | wrestlers | refs | type | rules | teams | pins | subs | KOs | blood | countout | timelim |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 2 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 |
| 1 | 2 | 0 | 5 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| 2 | 2 | 1 | 1 | 2 | 0 | 1 | 1 | 0 | 0 | 2 | 10 |
| 3 | 2 | 1 | 2 | 2 | 0 | 1 | 1 | 0 | 0 | 2 | 0 |
| 4 | 2 | 1 | 3 | 2 | 0 | 1 | 1 | 0 | 0 | 2 | 10 |
| 5 | 2 | 1 | 4 | 2 | 0 | 1 | 1 | 0 | 0 | 2 | 10 |
| 6 | 2 | 1 | 1 | 2 | 0 | 0 | 1 | 0 | 0 | 1 | 10 |
| 7 | 2 | 0 | 5 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 |

### 6.2 Pin viability (`PinViable`, 12558)

```as3
if(cyc > 0 && v > 0 && cyc != v && this.matchState > 0 && this.matchPins > 0)
{
   if(this.pPinning[cyc] == 0 && this.pPinner[cyc] == 0 && this.pPinning[v] == 0 && this.pPinner[v] == 0
      && this.pTeam[cyc] != this.pTeam[v])
   {
      if(this.pGround[cyc] == this.pGround[v] && this.pPlatform[cyc] == this.pPlatform[v])
      {
         if(Boolean(this.FallsCount(cyc)) && Boolean(this.LegalMan(cyc)) && Boolean(this.LegalMan(v)))
         {
            if(anim == 0 || anim == 10 && this.pRun[cyc] >= 0 || anim == 91 || anim >= 93 && anim <= 97)
            {
               if(this.pAnimTim[cyc] >= 0 && this.AttackViable(v) >= 3
                  && (this.pDT[cyc] < this.pDT[v] || this.pDT[cyc] <= 0))
               {
                  if(this.GetDistance(this.pX[cyc],this.pZ[cyc],this.pX[v],this.pZ[v]) < 20
                     || this.GetDistance(this.pX[cyc],this.pZ[cyc],this.LimbX(v,3),this.LimbZ(v,3)) < 20)
                  {
                     if(this.RisingImmunity(v) == 0) { viable = 1; }
                  }
               }
            }
         }
      }
   }
}
```

Conditions to be allowed to pin: same surface, not already pinned/pinning, different teams, falls
remaining, both legal, attacker in a neutral/downed-adjacent anim, **victim must be `AttackViable >= 3`
(i.e. down)**, attacker's `pDT` must be less than the victim's (you can't pin someone who is more hurt
than you), within 20 units of body or of limb 3 (head), and victim not in rising-immunity.

### 6.3 Pin count (`AutoRef`, 46885) — no-referee mode

```as3
this.v = this.pPinning[cyc];
if(this.v > 0)
{
   if(this.RefViable(this.v) == 1)
   {
      this.pRefVictim[cyc] = this.v;
      this.pCountTim[cyc] += 1;                                        // 46899  1/frame
      if(this.pCountTim[cyc] > 25 && this.matchRules >= 2 && this.pChecked[this.v] == 0)
      {
         if(Boolean(this.TouchingRopes(cyc)) || Boolean(this.TouchingRopes(this.v)))
         {
            ...
            this.PostMessage("Rope Break!");                            // 46907
            this.pAnimTim[cyc] = 9990;                                  // 46909  force release
            this.pChecked[this.v] = 1;
         }
      }
      if(this.pCountTim[cyc] > 25 && this.pChecked[this.v] == 0)
      {
         this.pPinCount[this.v] += 1;                                   // 46915
         this.pCountTim[cyc] = 0;                                       // 46916
         this.StepSound(cyc,0.75);
         this.entScore += this.pPop[cyc];
         this.ProduceSound(this.sCount[this.pPinCount[this.v]],...);    // 46920  "1"/"2"/"3"
         this.CauseChaos(100);
      }
   }
}
this.v = this.pRefVictim[cyc];
if(this.pPinCount[this.v] >= 3 && this.pDeclare[cyc] == 0 && this.pChecked[cyc] == 0)
{
   this.pDeclare[cyc] = 1;                                              // 46928  fall declared
   this.pDeclareDelay[cyc] = 0;
   this.pChecked[cyc] = 1;
}
if(this.pDeclare[cyc] == 1 && this.pDeclareDelay[cyc] >= 10)
{
   this.matchWinStyle = this.pDeclare[cyc];                             // 46934
   this.pDeclare[cyc] = 0;
   this.DeclareFall(cyc,this.pRefVictim[cyc]);                           // 46936
}
```

**A pin is 3 counts of 26 frames = 78 frames ≈ 4.3 s at 18 fps**, plus a 10-frame declaration delay.
Rope break is checked at the *moment* of the count, not continuously.

`ReleasePin` (88618) shows the escape: `abort = -1` if the victim's `pDT <= 0` and they press any
direction/action (88624–88630), `abort = 1` if the pinner presses grapple (88631–88634). `pAnimTim`
`sentinels 9980 / 9990 / 10000` are used as "force release" flags.

### 6.4 Submission (`HoldEffects`, 88269)

Submission holds use `pStretched` (1–4, a *side* indicator — which way the joint is being bent) and
`pTapping` (1–6, a 6-frame tap animation loop).

Escalation is driven by the attacker's directional input and the "sway" of the hold:

```as3
if(this.pControl[cyc] > 0 && this.DirPressed(cyc) && this.screen != 60)
{
   if(this.pAnim[cyc] != 254)
   {
      this.tA = this.LookAngle(...);
      if(sway == 4)
      {
         if(this.AngleDistance(this.tA,this.pA[cyc]) <= 45)          { this.pStretched[v] = 1; }
         if(this.AngleDistance(this.tA,this.pA[cyc] + 90) <= 45)     { this.pStretched[v] = 2; }
         if(this.AngleDistance(this.tA,this.pA[cyc] + 180) <= 45)    { this.pStretched[v] = 3; }
         if(this.AngleDistance(this.tA,this.pA[cyc] + 270) <= 45)    { this.pStretched[v] = 4; }
      }
      else
      {
         if(this.AngleDistance(this.tA,this.pA[cyc]) < 90)           { this.pStretched[v] = 1; }
         if(this.AngleDistance(this.tA,this.pA[cyc] + 180) < 90)     { this.pStretched[v] = 3; }
      }
      if(this.pStretchTim[v] > 10)
      {
         this.pTransition[cyc] *= 3;                                 // 88357  struggle slows the hold
         this.pTransition[v] = this.pTransition[cyc];
      }
   }
}
if(this.pSpecial[cyc] > 0) { power += 2; this.entScore += 2; }        // 88362-88366
if(weapon > 0 && this.pHolding[cyc] > 0)
{
   power += this.Rnd(0,1);
   if(this.weapFire[this.pHolding[cyc]] > 0) { power += this.Rnd(0,1); }
}
this.pHealth[v] -= power + this.Rnd(0,power);                        // 88375  damage per frame of hold
...
this.chance = (50 + this.pHealth[v] / 50) * (50 + this.pStat[v][6] / 2);   // 88411  tap resistance
if(this.pInjured[v] > 0 || this.pHealth[v] <= 0 && this.matchSubs > 0 && this.matchPins == 0)
{
   this.chance /= 2;                                                 // 88412-88415
}
if(this.gamTutorial == 20) { this.chance = 100; }
this.randy = this.Rnd(0,this.chance);
if(this.randy <= power && this.pTapping[v] == 0)
{
   ...
   this.pHealth[v] /= 2;                                             // 88427
   this.pHeat[v] /= 2;                                               // 88428
   this.pDT[v] = this.GetDT(v,500);                                  // 88429
   this.RiskInjury(v,0,10);                                          // 88430
   this.pTapping[v] = 1;                                             // 88431  committed to tap
}
```

**Tap-out contest:** `P(tap) = power / ((50 + hp_victim/50) * (50 + Tough_victim/2))` per frame, with
`power` being the move's per-frame damage rate (+2 with special). A victim at 2500 HP with Toughness 75
gives `chance = (50+50)*(50+37) = 8700`; a `power` of 5 taps at ~0.06 %/frame — but that's *per frame*,
so over 100 frames of hold it is ~6 %. Power scales the whole thing linearly, which is why the special
meter (+2) roughly doubles tap probability.

Once `pTapping[v] == 1` the victim is done — `AutoRef` sees `pTapping > 0` and awards:

```as3
if(this.matchSubs > 0 && v > 0 && this.pStretched[cyc] != 0 && this.pStretched[cyc] != 99)
{
   if(Boolean(this.LegalMan(v)) && this.pTeam[cyc] != this.pTeam[v])
   {
      if(this.pTapping[cyc] > 0) { viable = 12; } else { viable = 2; }     // 46856-46863
   }
}
...
if(this.viable == 12 && this.pDeclare[cyc] == 0 && this.pChecked[cyc] == 0)
{
   this.pDeclare[cyc] = 2;                                                 // 46959  submission win
   this.pDeclareDelay[cyc] = 0;
   this.pRefAward[cyc] = this.pGrappler[cyc];
   this.pChecked[cyc] = 1;
}
```

`pDeclare` 1 = pinfall, 2 = submission, 3 = count-out. `matchWinStyle` is then set from it (46934,
46966) — this is the value that feeds the post-match text.

### 6.5 KO / count-out (`matchKOs == 2`)

```as3
if(this.viable == 3 && this.matchKOs == 2)
{
   this.pCountTim[cyc] += 1;
   if(this.pCountTim[cyc] > 20)
   {
      for(this.v = 1; this.v <= this.no_plays; ++this.v)
      {
         if(this.RefViable(this.v) == 3)
         {
            this.pOutCount[this.v] += 1;                                // 46981
            if(this.pOutCount[this.v] > 10) { this.pOutCount[this.v] = 10; }
            ...
         }
      }
   }
}
```

`pOutCount` 0–10 is the ten-count; `RefViable == 3` means "down and not defending". At
`pOutCount >= 10` the AI marks `viable = 13` (46846–46849) → `pDeclare = 3` (47009) → count-out win.

```as3
if(this.matchKOs == 2)
{
   if(this.pDT[cyc] > this.optLieTim || this.pOutCount[cyc] > 0)
   {
      if(this.pAnim[cyc] >= 70 && this.pAnim[cyc] <= 98) { viable = 3; }
      if((this.pAnim[cyc] == 0 || this.pAnim[cyc] == 10) && this.pDizzy[cyc] > 0 && this.pOutCount[cyc] > 0)
      {
         viable = 3;
      }
   }
   if(this.pOutCount[cyc] >= 10) { viable = 13; }                       // 46846-46849
}
```

### 6.6 `pPinCount` consequences

A wrestler being pinned suffers accelerated down-time decay (`pDT -= Rnd(0,8)` per frame, 55923–55926)
and a halved down-time escape (`chance /= 2`, 55951–55954). This is the "kick out is harder the longer
you're down" pressure.

### 6.7 `pFalls` / `teamFalls` and `DeclareFall` (47275)

`DeclareFall(cyc, v)` is the single exit point for every fall (pin, submission, count-out, elimination).
It rings the bell, resolves who gets credited, and mutates the elimination state:

```as3
if(this.matchBellTim <= 0) { this.ProduceSound(this.sBell,0,0,1); this.matchBellTim = 10; }   // 47278-47282
if(this.matchCountOuts < 3) { this.CauseChaos(100); }                                         // 47283-47286
this.matchDeclareTim = 5;                                                                     // 47287
this.crowdVol = 1; this.crowdTarget = 1;
if(this.LegalMan(cyc) == 0) { cyc = 0; }                                                       // 47290-47293  illegal man cannot be credited
if(cyc > 0) { matchScorer = cyc; }                                                             // 47294-47297
action = 0;
if(cyc > 0 && this.matchType <= 4) { action = 1; }                                             // 47300-47303  award a fall
if(cyc == 0 && this.matchType >= 2 && this.matchType <= 4)
{
   action = 2;                                                                                 // 47304-47306  punish instead
   if(this.matchTeams <= 0 && this.matchRemaining > 2) { action = 0; }
   if(this.matchTeams > 0 && this.teamSize[this.pTeam[v]] > 1) { action = 0; }
}
```

| `action` | Branch | Effect |
|---|---|---|
| 0 | elimination (47316–47363) | `pEliminated[v] = 1`, `pChaosTim[v] = 200`, `matchLoser = v`, `GetNewLegal(v,0)`, message "…has been eliminated!" |
| 1 | award fall (47365–47397) | `pFalls[cyc] += 1`, `teamFalls[pTeam[cyc]] += 1`, message "…has scored his Nth fall!" |
| 2 | punish (47398–47406) | **`pFalls[v] -= 1`** and `teamFalls[pTeam[v]] -= 1` — the illegal man loses a fall |

Fall crediting is gated on `matchWinStyle`:

```as3
if(this.matchWinStyle >= 3 && this.matchWinStyle <= 5 || this.matchWinStyle == 7)
{
   if(cyc == 0 && this.pAttacker[v] > 0) { cyc = int(this.pAttacker[v]); }   // 47324-47327  credit the attacker
   this.pFalls[cyc] += 1;
   this.teamFalls[this.pTeam[cyc]] += 1;
}
```

And a KO-style finish force-lands the loser:

```as3
if(this.matchWinStyle == 3 || this.matchWinStyle == 4)
{
   this.pHP[v] = 0;
   this.pDT[v] += 1000;          // 47334-47337  effectively permanent down-time
   this.pDizzy[v] += 1000;
}
```

`matchWinStyle` values proven by `DeclareFall` and `AutoRef`:

| value | Meaning | Evidence |
|---|---|---|
| 1 | Pinfall (`pDeclare == 1`) | 46934, 47300 |
| 2 | Submission (`pDeclare == 2`) | 46966 |
| 3 | Count-out / KO (`pDeclare == 3`) | 46966, 47322, 47332 |
| 4 | variant of 3 (force-lands, 47332) | 47332–47337 |
| 5 | variant of 3 (in the 3..5 fall-crediting set) | 47322 |
| 6 | Disqualification — prints "has been disqualified!" | 47356–47358 |
| 7 | elimination-style (in the crediting set, not force-landed) | 47322 |

### 6.8 `RefViable` — the referee's decision table (46726)

`RefViable(cyc)` returns a code the referee AI (`AutoRef`) acts on. This is the **actual rules engine**
for "what is the ref looking at right now":

| code | Condition | Line |
|---|---|---|
| `21` | illegal man / needs to leave or tag (`LegalMan == 0` and in-ring, or tag partner not viable) | 46746, 46751, 46764 |
| `14` | down and bleeding heavily (`pBlood > 1`) | 46780 |
| `4` | down and bleeding slightly (`pBlood == 1`) | 46784 |
| `5` | outside the ring while count-outs are on | 46793 |
| `15` | count-out complete (`pOutCount >= 10`, or `matchCountOuts` 3/4 off-ring rule) | 46804, 46813 |
| `13` | near-death KO candidate (`pHealth < 100`) | 46825 |
| `3` | KO-able — down, `pDT > optCrawlTim`, `pHealth < 1250*optLength` | 46821–46829 |
| `2` | stretched in a submission hold (not yet tapping) | 46862 |
| `12` | tapping out | 46858 |
| `1` | being pinned | 46871 |
| `11` | pin count already >= 3 | 46874 |

```as3
if(this.matchState > 0 && this.matchPromo == 0 && cyc > 0 && this.pActive[cyc] > 0
   && this.matchEnter != cyc && this.pRole[cyc] != 3)                    // 46732  ref ignores intros & refs
{
   if(this.pChaosTim[cyc] <= 0)                                          // 46734  no decisions during chaos
   {
      if(this.LegalMan(cyc) == 0)
      {
         if(this.pGround[cyc] == this.ringGround && this.AttackViable(cyc) < 3)
         {
            if(this.pPlatform[cyc] == 0 || this.pRole[cyc] != 1 || this.pEliminated[cyc] > 0) { ... viable = 21; }
         }
      }
   }
   ...
}
```

Note the KO branch requires **all** of: `AttackViable >= 3` (down), `pDT > optCrawlTim`, and
`pHealth < 1250*optLength` (25 % max). You cannot be counted out on health alone while you are still
standing up.

### 6.9 `RisingImmunity` — the anti-cheese window (99425)

```as3
if(this.pDT[cyc] <= 0 && this.gamTutorial == 0)
{
   this.anim = this.pAnim[cyc];
   if(this.anim >= 70 && this.anim <= 98 && this.anim != 83)     // 99432  getting-up animations
   {
      if(this.pControl[cyc] == 0) { rising = 1; }                // 99434-99437  AI: always immune
      if(this.pControl[cyc] > 0)
      {
         if(this.DirPressed(cyc) || this.ActionPressed(cyc)) { rising = 1; }   // 99438-99444
      }
   }
}
```

While `RisingImmunity` is non-zero you **cannot be pinned** (`PinViable` requires it to be 0, 12578) and
you cannot be re-grappled. This is the invulnerability window on wake-up, and it is player-controlled:
mashing a direction while rising does *not* remove it — it *extends* it, because the immunity is
granted the moment input is pressed.

---

## 7. Match flow state machine

### 7.1 Screen ids (`this.screen`)

`this.screen` selects the active `ENTER_FRAME` handler. All values assigned in the source:

| Value | Role | Evidence |
|---|---|---|
| `-1` | no-op / blank state | 121571, 121666 |
| `1` | main menu | 121416, 122118 |
| `2`, `3` | sub-menus | 121561, 121615 |
| `5` | purchase/IAP overlay | 121543, 93 (`FailPurchase`) |
| `6` | sub-menu | 121428 |
| `8`, `9`, `10` | sub-menus | 121605, 122646, 121739 |
| `12`, `13`, `14` | card / booking / roster menus | 121595, 121587, 123062 |
| `20` | career menu | 121758, 123099 |
| `25` | transitional screen | 123087 |
| **`50`** | **the match** | **123081** — set immediately after `ReadCard()` + `PrepareMatchAd()`, and at 10890 |
| `60` | training / practice arena (`editChar = 100`) | 121580, 121577 |
| `70`, `71` | post-match / results screens | 8513, 103384, 114022 |

`screen == 50` is the match: it is the guard on `RiskStruggle` (67942), `RiskReversal` (67993),
`RiskCounter` (68041), `BreakMove` (68112) and `FindImpacts`' caller chain, and `GetMatchRules` is only
meaningful there.

`screen == 60` is a *training* context, not a replay. Evidence: it is entered from the menu with
`editChar = 100` (121577–121580), and it disables player locomotion rather than the whole sim:

```as3
if(this.pControl[cyc] > 0 && this.DirPressed(cyc) && this.screen != 60)   // 88320  no struggle input
if(this.pDizzy[cyc] > 0 || this.pBlind[cyc] > 0 || this.pInjured[cyc] != 0 || this.screen == 60)
{
   this.pAccel[cyc] = 0.5;                                                // 57401-57404  capped speed
}
if((this.pSpecial[cyc] <= 0 || this.pSpecial[v] > 0) && this.screen != 60 && this.gamTutorial == 0)  // 67636
```

There is a separate `screenAgenda` sub-state (e.g. `screenAgenda = 3` with `screen = 60`, `screenAgenda
= 2` with `screen = 14`).

### 7.2 `matchActive` / `matchState`

* `matchState > 0` = the match is live and outcomes count (guards at 12564, 46852, 88584, 88377).
* `matchActive` 0..3 = phase; `matchActive > 2` increases down-time escape by 25 % (55939).
* `matchPromo` = promo/angle insertion; `0` means "wrestling", non-zero means a story beat is playing.
  Many tutorial hooks read `this.matchPromo == 0` before firing.
* `gamTutorial` — non-zero switches on the tutorial script; `99` marks the "free play" tutorial end
  (55982, 55871).
* `matchPlayer` — the single human-controlled character index.

### 7.3 Reset / setup

```as3
public function ResetMatch() : void   // 44314
...
this.pHealth[cyc] = this.optLength * 5000;      // 55389
```

`SetupPlayers` (55424) appends animation sets, then `LoadPlayers`. Each wrestler is fully re-initialised
at 55340–55421: animations, limbs, sell state, grapple state, pin state, health, poise, heat, special.

### 7.4 Per-frame order

From the call sites, one frame of a live match is roughly:

1. `MonitorStatus(cyc)` — regen, ceiling, poise, down-time, momentum decay, stat rescaling (55811)
2. Input read (`FindStruggle`, `ControllerActivated`)
3. Animation state machine (`AttackAnims` 93721, `CrushAnims` 97958, `GroundAnims`, …)
4. `CockAttack` → `FindImpacts` → `ImpactChecks` → `HitReaction` (strike pipeline)
5. `HoldEffects` (88269) — submission pipeline
6. `AutoRef` (46885) — pin counts, rope breaks, declarations
7. `ManageMatch` (46245) — rules, eliminations, count-outs
8. `EndMatch` (47494) when `pDeclare` resolves

### 7.5 Ending

```as3
public function EndMatch(cyc:int) : void     // 47494
...
public function GetMatchVerdict() : void     // 113123
public function PostMatchAngles() : void     // 43634
```

`DeclareFall(cyc, victim)` is called from `AutoRef` for `pDeclare` 1/2/3 and sets
`matchWinStyle = pDeclare[cyc]` before the call (46934, 46966). `pFalls`/`teamFalls` increment there.
`EndMatch` then runs the verdict, `GetMatchRating` (51521) turns `entScore` into stars, and
`PostMatchAngles` (43634) runs the story fallout.

### 7.6 Animation id namespace

| Range | Meaning | Evidence |
|---|---|---|
| 0 | Idle/neutral | 57241, `anim == 0` pin check 12572 |
| 1 | Taunt (grants `pSpecial`) | 57214–57244 |
| 4 | Sitting | 57246 |
| 10 | Walk | 55852, 12572 |
| 12, 14 | Block/brace | 97090 |
| 15 | Run | 19857, 97455 |
| 22–23, 37–38 | Duck/crouch | 97097 |
| 32, 43 | Special sell states | 97511 |
| 50–51 | Sell (hit reaction) | 97513 |
| 58–59 | `AttackViable 4` (fully down) | 96222 |
| 70–89 | Down / grounded | 96226, 46837 |
| 90–92 | Getting up / stunned | 96234 |
| 93–97 | Knocked down, pin-able | 96202, 12572 |
| 95–96 | Knocked back | 96175, 56186 |
| 98 | Stagger | 96186 |
| 99 | Running attack | 97220 |
| 100–101 | Pinned / being pinned | 96210, 97400 |
| 102–104 | Sell variants | 96190 |
| 109–111, 114 | Sell variants | 96214, 96194 |
| 139–149 | Pick-up | 97477 |
| 200 | Grapple attempt | 96422, 97026 |
| 201–209 | Grapple hold (upper) | 97295 |
| 210–299 | Grapple move (upper) | 96273 |
| 301–309 | Grapple hold (lower) | 97295 |
| 310–399 | Grapple move (lower) | 96273 |
| 400–401, 410, 450 | Ground grapple | 97344 |
| 410–499 | Ground move | 96273 |
| 510–599 | Submission/aerial move | 96273 |
| 700–799 | Rope/grapple states | 96242 |
| 800–999 | Aerial / top-rope move | 96273 |
| 1001–1045 | Basic strikes (punches) | 93730, §4.1 |
| 1030–1045 | Kicks | §4.2 |
| 1050, 1051, 1052 | Special strikes | §4.3 |
| 1080–1083 | Running/clothesline/hind kick | §4.3 |
| 1090 | Weapon swing | §4.3 |
| 1101–1122 | Power strikes | §4.4 |
| 1190–1191 | Weapon power strikes | §4.4 |
| 1210–1299 | Finishers | 96265, 96435 |
| 1300–1399 | Special/ultimate | 96441, 97466 |

---

## 8. Rating (`entScore` → 1–10)

```as3
public function GetMatchRating(score:int) : int
{
   rating = 1;
   if(score >= 1000) { rating = 2; }
   if(score >= 1500) { rating = 3; }
   if(score >= 2000) { rating = 4; }
   if(score >= 2500) { rating = 5; }
   if(score >= 3000) { rating = 6; }
   if(score >= 3500) { rating = 7; }
   if(score >= 4000) { rating = 8; }
   if(score >= 4500) { rating = 9; }
   if(score >= 5000) { rating = 10; }
   return rating;
}
```

| `entScore` | rating |
|---|---|
| < 1000 | 1 |
| 1000–1499 | 2 |
| 1500–1999 | 3 |
| 2000–2499 | 4 |
| 2500–2999 | 5 |
| 3000–3499 | 6 |
| 3500–3999 | 7 |
| 4000–4499 | 8 |
| 4500–4999 | 9 |
| >= 5000 | 10 |

The bands are 500 points wide except the first (1000). `entScore` accumulates per §5.3 — most of it
comes from `pain/2` on every hit, so a 10,000-HP pool fully drained contributes ~5000 from damage alone
— enough on its own for a rating of 10 — plus `pPop` bonuses for blood/injury/momentum. A short squash
(a few thousand damage) lands around 4–5.

---

## 9. Reimplementation notes — web and Roblox

### 9.1 Tick model (do this first)

The engine is frame-locked. All timers are frame counts at `optFrameRate` (default 18, user 15–60).
For a port:

* Fix the simulation at **18 Hz** (`dt = 1/18 s`) and interpolate rendering. This reproduces the
  shipped default exactly.
* Do **not** copy constants as seconds. `pCountTim > 25` means 25 ticks, not 1.4 s.
* If you want 60 fps smoothness, run the sim at 18 Hz and lerp visual transforms. Running the sim at
  60 Hz makes every timer 3.33× faster — that is a real bug class in this engine, not a feature.

### 9.2 Data model

```ts
interface Fighter {
  // identity
  char: number;            // roster index
  scale: number;           // charHeight / 100
  // pools
  health: number;          // 0 .. optLength*5000
  healthLimit: number;     // >= 1250*optLength, decays 1/tick
  poise: number;           // 0 .. health/5 (min 200)
  downTime: number;        // frames on the mat
  heat: number;            // 0..1000 momentum
  special: number;         // frame budget, 0 = inactive
  // debuffs
  injured: number;         // 0..10
  blood: number;           // 0..5
  blind: number; dizzy: number;   // frame timers
  // live stats (recomputed each tick)
  stat: [number, number, number, number, number, number, number, number];
}
```

Recompute `stat[2..4,6]` **every tick** (§5.5) — do not snapshot at match start.

### 9.3 What maps to what

| WR3D | Web (TS) | Roblox (Luau) |
|---|---|---|
| `pHealth` | `number` on a `Fighter` class | `IntValue` in a per-player folder, or an attribute |
| `pHealthLimit` | `number` | attribute |
| `pHP` (poise) | `number` | attribute |
| `pDT` | `number` (frames) | attribute |
| `pHeat` / `pSpecial` | `number` | attribute |
| `pStat[1..8]` | `Float64Array(9)` | `table` in a ModuleScript, or attributes |
| `pSting[cyc]` | attack "hasn't hit yet" flag | `boolean` |
| `pAnim` + `pAnimTim` | `{id, t}` tuple in a state machine | same, in a ModuleScript |
| `pTransition`, `pBreathe` | animation blend duration | `AnimationTrack:AdjustSpeed` / `:Play(fadeTime)` |
| `pSell`/`pLeftSell`/`pRightSell` | procedural hit-reaction weights | additive animation weights |
| `pTravel*` | knockback velocity | `LinearVelocity` / `ApplyImpulse` |
| `pScale` | model scale | `Humanoid.BodyHeightScale` / `BodyWidthScale` |
| `iDamage` table | `const ITEM_DAMAGE` | same in a ModuleScript |
| `entScore` | `number` | attribute / `leaderstats` style |

**Roblox specifics**

* The 3D character rig maps to `Humanoid` + `Motor6D`; `pAnim` ids map to `Animation` instances in
  `ReplicatedStorage.Animations`, keyed by the same numeric ids (keep the ids — the whole engine
  branches on ranges like `210..299`).
* Hit boxes: use `workspace:GetPartBoundsInBox` with a **forward offset box**, not a raycast. The
  original test is a distance + angle-cone test (§2.2), which is closer to a cone query than a ray.
  Implement it literally: `dist < range*scale*0.9 && impactY > victimY-5 && angleDelta <= 25*(range/dist)`.
* Frame timing: `RunService.Heartbeat` at 18 Hz via an accumulator, not `task.wait()` drift.
* Physics: do **not** use Roblox ragdoll physics for `pDT`. It is a pure timer; the visual is a
  cosmetic animation. Driving knockdowns from physics will desync combat.
* `pTravel` knockback is `travel = range / distance` (97243) — a normalised impulse, clamp it.

**Web specifics**

* Keep the same three.js/WebGL model, but drive it from a single `fixedTick(1/18)` loop. Never read
  `performance.now()` inside combat logic.
* Store the roster's `charStat[1..8]` as the *immutable* base and compute `stat[]` per tick. Two
  separate arrays — conflating them silently breaks the whole difficulty curve.
* Hit detection: same cone test in 2D (`x,z`) plus a `y` band. Do not use capsule colliders.

### 9.4 Faithful-implementation checklist

1. Health = `optLength * 5000` (**optLength default 2 → 10,000**), poise = 1000, heat = 500,
   special = 0. Constants: `optFrameRate 18`, `optLevel 2`, `optLieTim 150`, `optCrawlTim 50`.
2. Every tick: regen roll (Stamina/100 → +1 health), ceiling -1 clamp, poise clamp to `health/5`
   (min 200), down-time decay + escape roll, heat decay roll.
3. Recompute effective stats from `0.75 + hp%/4` (or 1.25 if special).
4. Strike: geometry test (distance/angle/height, §2.2) → `pain = round(Strength * animMult)` where
   `animMult` is `2.0` for basics and `5..6` for power strikes → `×1.25` special → `×1.25` running
   → 10 % `×2` crit → `health -= pain`, `downTime = GetDT(pain)`,
   `poise -= pain/50 * (150 - Toughness)`, heat `±pain/10`. Live active window is 3 frames.
5. Heavy strikes (`1100..1199`) force `poise = 0` (knockdown).
6. Grapple move: `pain = (50 + Strength/2) * level`, `level` clamped 8, forced 10 with special.
7. Pin: 3 counts × 26 ticks, rope break checked at each count, `downTime` must be lower than victim's.
8. Submission: per-tick `power` damage, tap roll `power / ((50+hp/50)*(50+Tough/2))`.
9. Special: `100 + Popularity + Rnd(0,100)` ticks, drains only during grapple anims, ×1.25 stats and
   ×1.25 strike pain, unparryable.
10. Rating: accumulate `entScore` per §5.3.

### 9.5 Deliberate design traps to preserve (or consciously drop)

* **Popularity is not cosmetic.** It sets special-meter size, momentum decay, and down-time escape.
* **Toughness is a double-edged stat**: it reduces poise loss but *also* reduces injury chance — both
  good — yet the poise formula `(150 - Toughness)` means Toughness **above 150 would invert**; the game
  caps stats at 98 in the live recompute (56048–56051), which is exactly why.
* **The `pHealthLimit` ratchet** means healing items/comebacks must be explicit exceptions; natural
  regen cannot restore a bar.
* **`GetAttackSpeed` has only 3 breakpoints** — a "stat 0–98" curve that actually has 3 values. Any
  port that interpolates it will feel completely different.

---

## 10. UNKNOWNS

Things this pass could **not** prove from source. Do not treat them as settled.

1. **Attitude (stat 7) and Happiness (stat 8) in-match role.** No read of `pStat[cyc][7]` or `[8]` was
   found in `MonitorStatus`, `FindImpacts`, `HoldEffects`, `MoveImpact`, `AutoRef`, `PinViable`,
   `RiskInjury`, `RiskHeadDamage`, `RiskStruggle`, `RiskReversal`, `RiskCounter`, `BreakMove`,
   `RiskParry` or `GetDT`. The live rescale loop is explicitly `count = 2..6` (56024) so neither is
   rescaled. They are used in career/booking code. A cross-reference of `pStat[` across all 393
   classes is still outstanding — an in-match read via a local alias cannot be ruled out.
2. **`matchType` 0–5 semantic names.** The numeric rule sets are proven (§6.1). The display strings
   live in `DescribeMatch` (45433) and the menu code, which was not walked. Do not label the types
   "cage"/"ladder"/etc. without reading `DescribeMatch`.
3. **`optHealthTim` (250) semantics.** `optLieTim` (150) and `optCrawlTim` (50) were located at
   131179–131180, but `optHealthTim` is only initialised — the code that consumes it was not traced.
4. **`PrematureFinisher(cyc)` internals.** It gates the `/2 chance, ×2 risk` penalty in every contest
   and the self-damage at 68420, but its body was not read — the definition of "premature" (anim
   window vs. whiff) is unproven.
5. **`this.range` for anims 1103, 1119.** These two pass `this.range` (the per-anim field) rather than
   a literal. For all other anims in §4.4 the literal is quoted. `sweetSpot`, `rangeY` and pain
   multipliers throughout §4.3–4.4 are verbatim and reliable.
6. **`pCharge` exact ceiling.** `pCharge += 0.1` while `< 2` (96814) implies ~2.0, but float
   accumulation can overshoot to ~2.09. Immaterial in practice: the value saturates long before the hit
   window opens (§3.6), so every landing strike is at the cap either way.
7. **`tempSpecial` origin.** Set outside the match loop. 45990 sets `pHeat = 900` on one path, but the
   trigger for `tempSpecial` itself was not traced.
8. **`pReverse` semantics.** It is set to `rewind` (67982) and `-1` (68030) and consumed in anim
   handling that was not read. The *contest* is proven; how the rewind index maps to an animation
   rollback is not.
9. **`GetMatchVerdict` (113123)** — read at the call site only. The win/loss bookkeeping into career
   records is unproven, though `matchWinStyle` and `pFalls`/`teamFalls` (§6.7) are the inputs.
10. **Tag-match specifics.** `matchTeams`, `teamLegal`, `teamSize`, `TagViable`, `GetNewLegal` are
    referenced (§6.8, 46742–46752, 47206) but the tag legality/hot-tag rules were not walked end to
    end. `LegalMan` (47192) itself *is* proven: `pRole == 1 && pEliminated == 0 &&
    (cyc == teamLegal[pTeam] || matchTeams <= 1)`.

### 10.1 Corrections to the task's starting anchors

All six supplied anchors resolve to real code. Four are exact as stated; three needed a scope correction
(the line is right, the generalisation drawn from it was not):

| Anchor | Status |
|---|---|
| 53739 / 55389 `pHealth = optLength*5000` then `× charHealth/100` | **verified** (53739/53742 use `PercentOf`; 55389/55398 use a raw multiply) |
| 22043 `this.pain = this.pStat[cyc][2]` (Strength drives pain) | **verified**, but it is one *specific* corner-slam path. The general strike formula is `pain = round(Strength * animMult)` at 97003 and `(50 + Strength/2) * level` at 68384. |
| 96792 `GetAttackSpeed` `8 - round(pStat[4]/18)` clamp 3..5 | **verified** exactly |
| 57384 `speeder = 1 + 0.0375*(pStat[4]-50)` | **verified** — but it is scoped to `pAnim == 10` (walk) and is subsequently `× analog × pAccel × 2`; the raw expression is not the final speed (§3.2) |
| 57594 `pTransition = round(8 - pStat[4]/20)` | **verified line, wrong scope** — it belongs to `pAnim == 11` only, not a global transition formula (§3.3) |
| 96613 `GetAttackRange`, 19864/19912 damage sites | **verified** |



# PART 3 — 02-career-economy.md

# 02 — CAREER & BOOKING ECONOMY (WR3D 1.750.64)

Reimplementation spec derived from the decompiled ActionScript of
`as3/scripts/Game_fla/MainTimeline.as` (137,493 lines, JPEXS output of
`air.WR3DFree` v1.750.64). Every figure below carries a `MainTimeline.as:LINE`
anchor with the verbatim source. Anything not proven is in **UNKNOWNS**.

Conventions: all arrays are **1-indexed**. `Rnd(min,max)` is
`int(Math.round(Math.random()*(max-min)) + min)` — a *rounded* uniform, so the
endpoints are half-weighted (`MainTimeline.as:3311-3315`). `RndDec(min,max)` is
a true uniform `Number` (`:3332-3336`). `RoundOff(num,degree)` is
`Math.round(num/degree)*degree` (`:3577-3580`). `PercentOf(num,pct)` is
`num/100*pct` (`:3567-3569`).

---

## 1. Starting capital & mode differences

### 1.1 The three modes

`gamMode` gates the whole economy:

| gamMode | Meaning | Economy owner |
|---|---|---|
| 0 | Exhibition / single match | none (no `gamBank` use) |
| 1 | **Career** (wrestler) — save slot `Career` | you are an employee: you earn a salary, pay a manager and lifestyle |
| 2 | **Booking** (booker) — save slot `Booking` | you are the promoter: you take the gate and pay the whole roster |

Save-slot split, `MainTimeline.as:8536-8543`:

```
8546|            this.gamBank = saveFile.data.gamBank;
...
8538|            saveFile = SharedObject.getLocal("Booking");
8542|            saveFile = SharedObject.getLocal("Career");
```

### 1.2 `GenerateCareer()` — the canonical start-of-career state

```
8335|      public function GenerateCareer() : void
8340|         if(this.gamMode == 2)
8342|            this.gamBooker = this.gamChar;
8343|            this.charRole[this.gamChar] = 2;
8347|            this.gamWrestler = this.gamChar;
8348|            this.charRole[this.gamChar] = 1;
8365|         this.charWorth[this.gamChar] = this.CalculateWorth(this.gamChar);
8374|         if(this.gamMode == 2)
8376|            this.gamBank = 250000;
8380|            this.gamBank = 10000;
8382|         if(this.gamMode == 1 && this.charSalary[this.gamChar] > 1000)
8384|            this.gamBank = this.charSalary[this.gamChar] * 10;
8386|         this.gamBankMilestone = 0;
8387|         this.gamCostumeChanges = 0;
```

Starting bank, therefore:

```
BANK_start =
  gamMode == 2                                  -> 250,000
  gamMode == 1 and charSalary[player] <= 1000   -> 10,000
  gamMode == 1 and charSalary[player] >  1000   -> charSalary[player] * 10
```

Note the ordering: the 10,000 is written first and then **overwritten** by the
`*10` rule when the imported wrestler already has a salary above 1,000. That is
how a "legend" career starts richer than a rookie.

Also at generation (`:8366-8373`), if the player has never been paid
(`gamPaid[1] == 0`), the player's own contract is wiped to a token deal:

```
8366|         if(this.gamPaid[1] == 0)
8368|            this.charContract[this.gamChar] = 0;
8369|            this.charSalary[this.gamChar] = 0;
8370|            this.charClause[this.gamChar][1] = 1;
8371|            this.charClause[this.gamChar][2] = 0;
8372|            this.charClause[this.gamChar][3] = 0;
```

i.e. clause 1 (creative control) is granted free, clauses 2 and 3 are not.

Other economy-relevant resets in the same function:

```
8418|         this.gamProduction = 0;
8419|         if(this.gamMode == 2 || this.gamChar == this.gamWrestler + this.gamBooker)
8421|            this.gamTicket = 13;
8394|         this.gamDate = this.GetDate(this.GetRealMonth(),this.GetRealWeek());
8395|         this.gamYear = this.GetRealYear();
8396|         this.gamStartYear = this.gamYear;
```

Booking mode seeds the TV shows with popularity:
```
8501|               this.showPop[this.cyc] = this.Rnd(70,90);
```

### 1.3 `StartBookingCareer(fed)` — taking over an existing promotion

This is the second entry point into Booking mode (you buy/are handed a fed).
It is the **only** place a budget is derived from the roster's payroll:

```
8511|      public function StartBookingCareer(fed:int) : void
8524|         this.gamBank = this.CountWages(fed) * 2;
8525|         this.gamBank = this.RoundOff(this.gamBank,1000);
```

So: **starting budget = 2 × the promotion's total weekly wage bill, rounded to
the nearest 1,000.** See §2 for `CountWages`.

### 1.4 Default / reset values

```
131698|         this.gamAttendance = 0;
131699|         this.gamTicket = 13;
131708|         this.gamBank = 10000;
131709|         this.gamBankMilestone = 0;
131713|         this.gamProduction = 0;
```

Ticket price default is **$13** everywhere (`:8421`, `:131699`), clamped to the
10–16 band by world events (§6.4).

---

## 2. Wages / salary model

### 2.1 The state

```
2267|       public var charWorth:Array;
2269|       public var charContract:Array;
2275|       public var charSalary:Array;
2281|       public var charClause:Array;
```

Per character: `charWorth[c]` (market value, recomputed), `charSalary[c]` (per-show
wage actually charged), `charContract[c]` (weeks remaining), `charClause[c][1..3]`.

### 2.2 `CountWages(fed)` — the promotion's weekly wage bill

```
54579|      public function CountWages(cyc:int) : int
54581|         var wages:int = 0;
54582|         wages = 0;
54583|         for(this.count = 1; this.count <= this.fedSize[cyc]; ++this.count)
54585|            this.char = this.fedRoster[cyc][this.count];
54586|            wages += this.charSalary[this.char];
54588|         return wages;
```

Pure sum of `charSalary` over the roster. No caps, no averages, no per-federation
multiplier. It is the **only** aggregate wage figure in the codebase, and it is
what the promotion profile screen shows:

```
54501|         statClip.Name.text = "Wages:";
54503|         statClip.Stat.text = "$" + this.DisplayFigure(this.CountWages(cyc)) + " per week";
```

**There is no stored per-federation budget variable.** `grep` for
`budget|Budge|fedWealth|fedMoney` returns **0 matches** in the whole file. A
promotion's "budget" is always derived: either `CountWages(fed)*2` at takeover
(§1.3) or the stored `gamBank` of the booker who owns it.

### 2.3 `charWorth` — market value

```
114743|      public function StatAverage(char:int, bias:int) : int
114747|         for(this.count = 1; this.count <= 6; ++this.count)
114749|            average += this.charStat[char][this.count];
114750|            if(bias == this.count)
114752|               average += this.charStat[char][this.count] * 4;
114755|         if(bias > 0)
114757|            average /= 9;
114761|            average /= 5;
```

`StatAverage(c,1)` = (sum of stats 1..6 + 4×stat[1]) / 9 — i.e. a
**popularity-weighted** average where `pStat[1]` (Popularity) carries 5/9 of the
weight and Strength..Toughness share the rest.

```
114779|      public function CalculateWorth(char:int) : int
114784|         chunk = this.StatAverage(char,1) - 40;
114785|         if(chunk < 15)
114787|            chunk = 15;
114789|         this.factor = chunk / 15;
114790|         worth = chunk * chunk * this.factor;
114791|         if(this.charFed[char] == 7)
114793|            worth /= 2;
114795|         if(this.charFed[char] == 8)
114797|            worth *= 1.5;
114799|         if(this.charInjured[char] > 0)
114801|            worth *= 0.75;
114803|         champ = this.TitleHolder(char);
114804|         if(champ == 1)
114806|            worth *= 1.5;
114808|         if(champ == 2 || champ == 3)
114810|            worth *= 1.25;
114812|         if(char == this.fedBooker[this.charFed[char]])
114814|            worth *= 1.5;
114816|         worth = this.RoundOff(worth,10);
114817|         if(worth < 100)
114819|            worth = 100;
```

Restated:

```
chunk = max(15, StatAverage(c,1) - 40)
worth = chunk^3 / 15
worth *= 0.5  if fed == 7   (fed 7 = the "free"/training promotion, see §2.6)
worth *= 1.5  if fed == 8   (fed 8 = the biggest promotion)
worth *= 0.75 if injured
worth *= 1.5  if world champion (TitleHolder == 1)
worth *= 1.25 if secondary/tertiary champion (TitleHolder == 2 or 3)
worth *= 1.5  if the character is the promotion's booker
worth = round(worth/10)*10, floor 100
```

Because `worth` is cubic in the stat surplus, popularity dominates everything:
a 90-popularity worker is `(50³)/15 = 8,333`, a 60-popularity worker is
`(20³)/15 = 533` — a **15.6×** gap for 30 points.

### 2.4 `GenerateContract(char)` — how every AI salary is created

```
115171|      public function GenerateContract(char:int) : void
115173|         this.charContract[char] = this.Rnd(8,48);
115176|            if(this.fedPolicy[this.charFed[char]] == 3)
115178|               this.charContract[char] = this.Rnd(4,24);
115180|            if(this.fedPolicy[this.charFed[char]] == 4)
115182|               this.charContract[char] = this.Rnd(24,48);
115185|         this.charSalary[char] = this.CalculateWorth(char);
115186|         this.charSalary[char] *= 0.5 + Math.random() / 2;
115187|         for(this.count = 1; this.count <= 3; ++this.count)
115189|            this.charClause[char][this.count] = this.Rnd(-2,1);
115190|            this.charClause[char][this.count] += this.Rnd(0,this.ClauseEntitled(char,this.count,this.charFed[char]));
115191|            if(this.charClause[char][this.count] < 0)
115193|               this.charClause[char][this.count] = 0;
...
115223|         this.charSalary[char] = this.ContractFilter(this.charSalary[char],this.charContract[char],this.charFed[char]);
115224|         this.charSalary[char] = this.ClauseFilter(char,this.charSalary[char],this.charClause[char][1],this.charClause[char][2],this.charClause[char][3],this.charFed[char]);
115225|         this.charSalary[char] = this.RoundOff(this.charSalary[char],100);
115228|            if(this.fedPolicy[this.charFed[char]] == 1)
115230|               this.charSalary[char] = 0;
```

Pipeline in words:

1. `contract = Rnd(8,48)` weeks. Policy 3 forces `Rnd(4,24)`; policy 4 forces `Rnd(24,48)`.
2. `salary = CalculateWorth(char)`.
3. `salary *= 0.5 + random()/2` → uniform in **[0.5×, 1.0×]** worth.
4. Each clause: `Rnd(-2,1) + Rnd(0, entitled)`, floored at 0. So a clause is
   usually 0–1 and can reach 2 when entitlement is 1 (the `Rnd(-2,1)` roll of 1
   plus a `Rnd(0,1)` of 1). It can never exceed 2 from generation.
5. `ContractFilter` (length modifier), then `ClauseFilter` (clause cost), then
   round to 100.
6. Policy 1 ("no salaries") zeroes the wage outright.

`ContractFilter` — long deals pay *more* per week, short deals pay *less*:

```
114824|      public function ContractFilter(sum:int, contractLength:int, promotion:int) : int
114826|         this.factor = 1;
114827|         if(contractLength < 24)
114829|            this.factor = (24 - (24 - contractLength) / 3) / 24;
114831|         if(contractLength > 24)
114833|            this.factor = (24 + (contractLength - 24) / 4) / 24;
114835|         return Math.round(sum * this.factor);
```

```
factor = 1                                        if len == 24
       = (24 - (24-len)/3) / 24                   if len <  24   → 0.833 @ 12w, 0.958 @ 21w, 0.667 @ 0w
       = (24 + (len-24)/4) / 24                   if len >  24   → 1.125 @ 36w, 1.25 @ 48w
```

`ClauseFilter` — every clause the player extracts costs them salary:

```
114890|      public function ClauseFilter(char:int, sum:int, clauseA:int, clauseB:int, clauseC:int, promotion:int) : int
114892|         this.factor = 1;
114893|         if(clauseA > 0)
114895|            if(this.ClauseEntitled(char,1,promotion) == 0)
114897|               this.factor -= 0.2;
114901|               this.factor -= 0.1;
114904|         if(clauseB > 0)
114906|            if(this.ClauseEntitled(char,2,promotion) == 0)
114908|               this.factor -= 0.4;
114912|               this.factor -= 0.2;
114915|         if(clauseC > 0)
114917|            if(this.ClauseEntitled(char,3,promotion) == 0)
114919|               this.factor -= 0.1;
114923|               this.factor -= 0.05;
114926|         return Math.round(sum * this.factor);
```

| Clause | Unentitled cost | Entitled cost |
|---|---|---|
| 1 | −20% salary | −10% salary |
| 2 | −40% salary | −20% salary |
| 3 | −10% salary | −5% salary |

All three unentitled = factor `1 − 0.2 − 0.4 − 0.1 = 0.30` → **salary cut to 30%**.

`ClauseEntitled` — a clause can only be *demanded cheaply* if your popularity
meets the promotion's:

```
114838|      public function ClauseEntitled(char:int, clause:int, promotion:int) : int
114844|            if(this.charStat[char][1] >= this.fedPop[promotion])
114846|               entitled = 1;
114848|            if(this.fedPolicy[promotion] == 5)
114850|               entitled = 0;
114852|            if(this.fedPolicy[promotion] == 6)
114854|               entitled = 1;
114859|            if(this.charStat[char][1] >= this.fedPop[promotion])
114861|               entitled = 1;
114863|            if(this.fedPolicy[promotion] == 7)
114865|               entitled = 0;
114867|            if(this.fedPolicy[promotion] == 8)
114869|               entitled = 1;
114874|            if(this.charStat[char][1] >= this.fedPop[promotion])
114876|               entitled = 1;
114878|            if(this.fedPolicy[promotion] == 9)
114880|               entitled = 0;
114882|            if(this.fedPolicy[promotion] == 10)
114884|               entitled = 1;
```

So: `entitled = (Popularity >= fedPop[promotion])`, overridden by policy —
5/7/9 force **not** entitled, 6/8/10 force **entitled** for clauses 1/2/3
respectively.

### 2.5 Fed-specific salary overrides

```
115226|         if(this.charFed[char] > 0)
115228|            if(this.fedPolicy[this.charFed[char]] == 1)
115230|               this.charSalary[char] = 0;
115233|         if(this.charFed[char] >= 7 && this.charFed[char] <= 8)
115235|            if(char != this.fedBooker[this.charFed[char]])
115237|               this.charContract[char] = 0;
115238|               if(this.charFed[char] == 7)
115240|                  this.charSalary[char] = 0;
115241|                  this.charClause[char][1] = 1;
115242|                  this.charClause[char][2] = 0;
115243|                  this.charClause[char][3] = 0;
```

- **Policy 1 = "no salaries"** — every wage is 0.
- **fed 7 and 8 are non-contract promotions**: everyone except the booker has
  `charContract = 0`. In fed 7 wages are also 0 with only clause 1 granted
  (this is the free/training promotion — matches `CalculateWorth` halving worth
  for fed 7 and `CalculateFinances` treating fed 7 "TV Taping" as a training
  session, §5).
- **fed 8 (the largest)** pays 1.5× worth but still issues no contracts.

In Booking mode the player-booker is forced onto a zero deal:

```
115247|         if(this.gamMode == 2 && char == this.gamChar)
115249|            this.charContract[char] = 0;
115250|            this.charSalary[char] = 0;
```

### 2.6 Worked example (deterministic, worth = 1,000)

| Contract length | ContractFilter | Clause multiplier | Final salary |
|---|---|---|---|
| 12 weeks | 0.833 → 833 | ×0.30 (3 unentitled) → 250 | **300** |
| 24 weeks | 1.000 → 1,000 | none | **1,000** |
| 24 weeks | 1.000 → 1,000 | ×0.65 (3 entitled) → 650 | **700** |
| 48 weeks | 1.250 → 1,250 | none | **1,300** |
| 48 weeks | 1.250 → 1,250 | ×0.30 → 375 | **400** |

Rounding is `RoundOff(x,100)` = `round(x/100)*100`, so 250→300 and 650→700.
Note the interaction: a long contract can *partly pay for* demanding every
clause — 48 weeks with three unentitled clauses still beats 12 weeks with none
(400 vs 300).

---

## 3. Contract negotiation

There are **two** negotiation engines and they must not be confused:

| Engine | Who is player | Entry | Prepares | Verdicts |
|---|---|---|---|---|
| Career | the wrestler | `screen 71` from `FindMeetings` | `PrepareContract()` `:114066` | `GetContractVerdict(char)` `:114929` |
| Booking | the promoter | `screen 71` | `PrepareBookingContract()` `:115343` | `GetBookingVerdict(char)` `:116200`-ish |

Both share `ContractFilter`, `ClauseFilter`, `ClauseEntitled`, the clause
bitmask, and the `neg*` state block.

### 3.1 Clause semantics (proven from the rejection strings)

| # | `charClause[c][n]` | UI control | Meaning | Exact quote |
|---|---|---|---|---|
| 1 | `[1]` | `CreativeBox` | **Creative control** — you may change your costume/weapon, billed to you | `"No, we can't trust you with creative control."` `:114558` |
| 2 | `[2]` | `PerformBox` | **Unconditional pay** — paid even when you lose or don't perform | `"No, we can't give you unconditional pay!"` `:114563` |
| 3 | `[3]` | `HealthBox` | **Health cover** — paid while injured / on days off | `"No, you're not an ideal candidate for health cover."` `:114568` |

Note the UI boxes at `:129921-129970` (`CreativeBox`, `PerformBox`, `HealthBox`)
toggle `negClause[1..3]` between 0 and 1 only — the player can never ask for 2.

### 3.2 Career mode: `PrepareContract()` — the offer you are given

```
114066|      public function PrepareContract() : void
114068|         this.negWorth = this.CalculateWorth(this.gamChar);
114069|         if(this.fed == 8)
114071|            this.negWorth *= 2;
114073|         this.negWorth *= 0.5 + Math.random() / 2;
114074|         this.negSalary = this.negWorth * (0.6 + Math.random() / 2);
114075|         this.negContract = this.Rnd(4,44);
114076|         if(this.fedPolicy[this.fed] == 3)
114078|            this.negContract = this.Rnd(4,24);
114080|         if(this.fedPolicy[this.fed] == 4)
114082|            this.negContract = this.Rnd(24,48);
114084|         if(this.fed == 8)
114086|            this.negContract = this.Rnd(2,8);
114088|         if(this.negContract < this.charInjuryTime[this.gamChar])
114090|            this.negContract = this.charInjuryTime[this.gamChar];
```

- `negWorth` = worth ×2 if fed 8, then ×[0.5,1.0].
- `negSalary` = `negWorth × [0.6, 1.1]` — **note the range exceeds 1.0**, so a
  first offer can be above "worth".
- Length: `Rnd(4,44)`; policy 3 → `Rnd(4,24)`; policy 4 → `Rnd(24,48)`;
  **fed 8 → `Rnd(2,8)`** (short "appearance" deals); then raised to at least the
  wrestler's remaining injury time.

Clauses (`:114092-114122`): `negClause[n] = max(0, Rnd(-1,1))` → 0 or 1,
then policy 5/7/9 force 0 and 6/8/10 force 1. Same shape as `GenerateContract`
but with the narrower `Rnd(-1,1)`.

Then both filters are applied to the *offer*:

```
114124|         this.negSalary = this.ContractFilter(this.negSalary,this.negContract,this.fed);
114125|         this.negSalary = this.ClauseFilter(this.gamChar,this.negSalary,this.negClause[1],this.negClause[2],this.negClause[3],this.fed);
```

### 3.3 The up-front / weekly split

```
114126|         this.randy = this.Rnd(-8,4);
114127|         if(this.fedPolicy[this.fed] == 1)
114129|            this.randy = 4;
114131|         if(this.fedPolicy[this.fed] == 2)
114133|            this.randy = 0;
114135|         if(this.randy <= 0)
114137|            this.negPayOff = 0;
114139|         if(this.randy == 1)
114141|            this.negPayOff = this.negSalary * this.negContract * 0.25;
114142|            this.negSalary *= 0.75;
114144|         if(this.randy == 2)
114146|            this.negPayOff = this.negSalary * this.negContract * 0.5;
114147|            this.negSalary *= 0.5;
114149|         if(this.randy == 3)
114151|            this.negPayOff = this.negSalary * this.negContract * 0.75;
114152|            this.negSalary *= 0.25;
114154|         if(this.randy == 4)
114156|            this.negPayOff = this.negSalary * this.negContract;
114157|            this.negSalary = 0;
114159|         this.negSalary = this.RoundOff(this.negSalary,100);
114160|         this.negPayOff = this.RoundOff(this.negPayOff,1000);
```

`Rnd(-8,4)` means **9/13 ≈ 69% of offers are pure weekly wage with zero
up-front** (`randy <= 0`). The other 4/13 use this conversion table:

| randy | up-front | weekly after |
|---|---|---|
| 1 | 25% of (salary × weeks) | 75% |
| 2 | 50% | 50% |
| 3 | 75% | 25% |
| 4 | 100% | 0 |

Policy 1 pins `randy = 4` (the promotion only pays lump sums — matches
`"we prefer to pay talent upfront"` `:114595`). Policy 2 pins `randy = 0`
(weekly only — `:114600`).

Both `PrepareContract` and `PrepareBookingContract` end by granting the player
a finite number of counter-offers:

```
114216|         this.negChances = this.Rnd(0,8);
115450|         this.negChances = this.Rnd(0,10);
```

`negChances` is consumed by `PushLuck` (§3.5) — it is the "how many times can I
argue" budget, and it can be **0**, meaning the very first rejection ends the
meeting.

### 3.4 The free-version gate (`gamPaid[1] == 0`)

`gamPaid` is the **in-app-purchase flag**, not a career stat:

```
131027|         this.gamPaid = new Array();
131028|         this.gamPaid[1] = 0;
131029|         this.gamPaid[2] = 0;
7628|            if(this.gamMode > 0 && this.gamPaid[1] == 0)
7630|               viable = 1;                      // ads only run while unpaid
```

`gamPaid[1] > 0` means the player bought the career/booking unlock. While
**unpaid**, negotiation is deliberately crippled — each negotiable item has a
1-in-16 chance of being forbidden at offer time, and the corresponding
`neg*Limit` flag is what produces verdicts 40–45 later:

```
114161|         if(this.gamPaid[1] == 0)
114163|            if(this.Rnd(0,15) == 0)
114165|               this.negPayOffLimit = 1;
114166|               this.negPayOff = 0;
114172|            if(this.Rnd(0,15) == 0)
114174|               this.negSalaryLimit = 1;
114175|               this.negSalary = 0;
114183|               if(this.Rnd(0,15) == 0)
114185|                  this.negClauseLimit[this.count] = 1;
114186|                  this.negClause[this.count] = 0;
114193|            if(this.Rnd(0,15) == 0)
114195|               this.negContractLimit = 1;
114196|               this.negContract = 4;
```

The refusal is dressed in-fiction as a licensing rule — up-front money, weekly
salary, creative control, guaranteed pay, health cover and any contract longer
than 4 weeks can each be refused with *"you don't have a professional
license"* (`:114630-114656`). Similar unpaid-only penalties exist elsewhere:
`112458` (manager refuses 1-in-11), `113126` (match verdict 7, 1-in-11),
`116233` (verdict **100**, can't sign from another fed, 1-in-11).

**Do not model this as progression** — it is purely the paywall. A
reimplementation with no paywall should delete the whole `gamPaid[1] == 0`
branch and always set the `neg*Limit` flags to 0.

### 3.5 `GetContractVerdict` — the accept/reject engine

```
114929|      public function GetContractVerdict(char:int) : void
114934|         this.negContractWorth = this.ContractFilter(this.negWorth,this.negContract,this.fed);
114936|         this.negClauseWorth = this.ClauseFilter(char,this.negContractWorth,this.negClause[1],this.negClause[2],this.negClause[3],this.fed);
114938|         this.negPayment = this.negSalary * this.negContract + this.negPayOff;
114939|         this.negOldPayment = this.negOldSalary * this.negOldContract + this.negOldPayOff;
114940|         this.negMax = this.negClauseWorth * this.negContract;
```

**`negMax` is the single budget number the AI compares against.** It is
"worth, adjusted for length and for the clauses you demanded, times the length".

Decision order (first hit wins, later rules overwrite earlier ones):

| # | Condition (verbatim anchors) | Verdict | Text |
|---|---|---|---|
| A | `negPayment > negClauseWorth*negContract` → rolls `Rnd(1,9)` up to 100× | 19 / 17 / 18 / 15 / 13 / 11 | see below |
| B | `negPayOff > negMax/2 && negPayOff > negOldPayOff && policy != 1` | **9** | "you can't receive $X of your payment upfront" `:114553` |
| C | `negPayment > negMax*2 && Rnd(0,1)==0` | **8** | "Who do you think you are to make those demands?!" `:114548` |
| D | `negContract != negOldContract` and (`negContract <= 4 && negPayment > negMax/2 && policy != 3` or `negContract <= 1`) | **2** | "What's the point in signing up for just N weeks?!" `:114518` |
| E | `policy == 1 && negSalary > 0` | **31** | "we prefer to pay talent upfront" `:114595` |
| F | `policy == 2 && negPayOff > 0` | **32** | "we prefer to pay talent weekly" `:114600` |
| G | `policy == 3 && negContract > 24 && changed` | **33** | "N weeks is too long" `:114605` |
| H | `policy == 4 && negContract < 24 && changed` | **34** | "N weeks is too short" `:114610` |
| I | `policy == 5 && clause1 > 0` | **35** | "we don't give creative control" `:114615` |
| J | `policy == 7 && clause2 > 0` | **37** | "we don't give unconditional pay" `:114620` |
| K | `policy == 9 && clause3 > 0` | **39** | "we don't offer health cover" `:114625` |
| L | `fed == 8 && contract changed` | **50** | "You don't get to choose how long a job lasts!" `:114660` |
| M | `negChances <= 1 && verdict > 0 && negPayment < negMax*2` and `Rnd(0,2)==0` | **-1** | *accepted with a grumble* `:114490-114499` |
| N | `gamPaid[1]==0` limits: clause2→**44**, clause1→**43**, clause3→**45**, contract→**42**, payoff→**40**, salary→**41** | various | paywall refusals, worded as *"professional license"* |

Block A in detail (`:114941-114985`) — only entered when the total payment
exceeds the fair maximum. It loops up to 100 times rolling `Rnd(1,9)`, and only
sets a verdict when the *shape* of the deal is insulting:

```
114948|               if(this.negClause[1] < this.negOldClause[1] || ... || this.negClause[1] + this.negClause[2] + this.negClause[3] == 0)
114950|                  if(this.randy == 1)
114952|                     this.negVerdict = 19;
114957|                  if(this.negClause[1] + ... >= this.negOldClause[1] + ...)
114959|                     if(this.randy == 2 && this.negSalary + this.negPayOff > this.negOldSalary + this.negOldPayOff)
114961|                        this.negVerdict = 17;
114964|                  if(this.negClause[1] + ... > this.negOldClause[1] + ...)
114966|                     if(this.randy == 3 && this.negSalary + this.negPayOff >= this.negOldSalary + this.negOldPayOff)
114968|                        this.negVerdict = 18;
114972|               if(this.randy >= 4 && this.randy <= 5 && this.negClause[3] > this.negOldClause[3] && this.negClause[3] > this.ClauseEntitled(char,3,this.fed))
114974|                  this.negVerdict = 15;
114976|               if(this.randy >= 6 && this.randy <= 7 && this.negClause[2] > this.negOldClause[2] && ... )
114978|                  this.negVerdict = 13;
114980|               if(this.randy >= 8 && this.randy <= 9 && this.negClause[1] > this.negOldClause[1] && ... )
114982|                  this.negVerdict = 11;
```

| Verdict | Text (`:114556-114585`) |
|---|---|
| 11 | "we can't trust you with creative control" |
| 13 | "we can't give you unconditional pay" |
| 15 | "you're not an ideal candidate for health cover" |
| 17 | "You want big money AND a cushy contract?!" |
| 18 | "You can't have a cushier contract for the same money!" |
| 19 | "even those sacrifices don't justify what you're asking for" |

Block "ignore clauses" (`:114987-115045`) — if the deal *changed*, `Rnd(0,3)`
rolls 0 (or ≤1 for verdicts 17-19) → clause demands are ignored and the AI
judges on money alone. This second loop is what produces the purely financial
refusals:

| Verdict | Condition | Text |
|---|---|---|
| 5 | `salary > oldSalary && payoff <= oldPayoff` | "I don't see you earning $X per week!" `:114533` |
| 4 | `payoff > oldPayoff && salary <= oldSalary` | "you're not worth that much to <fed>" `:114528` |
| 3 | `payoff > oldPayoff && salary > oldSalary` | "not getting $X now AND $Y per week!" `:114523` |
| 7 | `contract < oldContract && policy != 3` | "we can't invest that much for just N weeks" `:114543` |
| 6 | `contract > oldContract && policy != 4` | "even a N-week contract isn't worth that much" `:114538` |
| 20 | `charWorth*contract > negPayment` (you undervalued yourself) | "those days are behind you now!" `:114590` |

Verdict **0** = clean accept (`"OK, I'm happy to sign off on that contract"`),
verdict **-1** = grudging accept. In `ContractScripts` (`:114663-114666`) every
rejection burns one chance: `if(this.negVerdict > 0 && this.promoPage > 1) this.PushLuck(1);`

`PushLuck` (`:115133-115150`): decrement `negChances`; if still > 0, back to
stage 3 (edit the deal again), else go to stage 5 (leave).

### 3.6 Booking mode: buying or re-signing someone

`PrepareBookingContract()` (`:115343`) — the promoter's side:

```
115345|         this.negBuyOut = 0;
115346|         if(this.charContract[this.negChar] > 2 && this.charFed[this.negChar] != this.fed && this.negTopic != 4 && this.negTopic != 5)
115348|            if(this.charSalary[this.negChar] > 0)
115350|               this.negBuyOut = this.charContract[this.negChar] * this.charSalary[this.negChar];
115354|               this.negBuyOut = this.charContract[this.negChar] * this.charWorth[this.negChar];
115357|         this.negPayOff = this.negBuyOut;
115386|         this.negWorth = this.CalculateWorth(this.negChar);
115387|         if(this.negTopic == 4 || this.negTopic == 5)
115389|            this.negWorth /= 2;
115391|         this.negWorth *= 0.5 + Math.random() / 2;
115392|         this.negSalary = this.charSalary[this.negChar];
115393|         if(this.negTopic == 4 || this.negTopic == 5)
115395|            this.negSalary = 0;
115397|         this.negContract = this.Rnd(8,48);
115398|         if(this.charFed[this.negChar] == 8)
115400|            this.negContract /= 2;
```

**`negBuyOut` = remaining weeks × (current salary, or worth if unpaid)**, and it
is the minimum up-front payment (`:129995-130001` clamps
`negPayOff >= negBuyOut`).
You cannot poach a contracted wrestler for nothing. Topics 4/5 (special
appearances) halve worth and force salary 0.

The AI's own preferences (`:115402-115431`) then decide whether they like the
deal:

```
115409|            this.negClausePrefer[this.count] = this.Rnd(-2,1);
115412|               this.negClausePrefer[this.count] += this.Rnd(0,this.charClause[this.negChar][this.count]);
115418|            if(this.negClausePrefer[this.count] > 1)
115420|               this.negClausePrefer[this.count] = 1;
115423|         this.negPayOffPrefer = 0;
115424|         this.randy = this.Rnd(-3,1);
115427|            this.negPayOffPrefer = -1;                          // hates up-front money
115431|            this.negPayOffPrefer = 0.25 * this.Rnd(1,4);        // 0.25 / 0.5 / 0.75 / 1.0
115433|         if(this.gamBank < this.negWorth * this.negContract * this.negPayOffPrefer)
115435|            this.negPayOffPrefer = 0;                            // you can't afford it, they don't insist
```

`negPayOffPrefer` is the fraction of the deal they want as a lump sum
(**-1 means they refuse up-front money entirely**).

`GetBookingVerdict` hard blocks (`:116459-116492`):

| Verdict | Condition | Meaning |
|---|---|---|
| 5 | `negPayOff > gamBank` | you cannot afford the lump sum |
| 10 | `negPayOff < negBuyOut` | bid below the buy-out clause |
| 2 | target is their booker and `negPayment < negWorth*100` | "franchise player" premium |
| 4 | `charRelationship[char][6] == gamChar && negPayment < negMax*2` | your friend won't come cheap |
| 47 | released from your fed and `negPayment < negMax*2` | won't come back cheap |
| 6 | target is *your own* fed's owner | owner is unsignable |
| 3 | `charFed[char] == 0` | free agent handled elsewhere |
| 1 | `gamNegotiated[char] > 0` | already spoke to them this week |

### 3.7 Applying the signed deal

```
130318|                     this.gamBank -= this.negPayOff;     // booking: you pay the up-front
130322|                     this.gamBank += this.negPayOff;     // career: you receive it
130324|                  this.charContract[this.char] = this.negContract;
130325|                  this.charSalary[this.char] = this.negSalary;
130327|                  while(this.count <= 3)
130329|                     this.charClause[this.char][this.count] = this.negClause[this.count];
130332|                  if(this.gamMode == 2 && this.negVerdict == -1)
130334|                     this.charStat[this.char][8] = this.charStat[this.char][8] - 1;
130338|                     this.charStat[this.char][8] += 1;
```

Signing changes the worker's **Happiness** (`pStat[8]`): +1 normally, **−1** if
they only signed grudgingly (`negVerdict == -1`).

Rejection (`go <= 0`) releases the player to fed 7 with
`pStat[1] -= 1` and `pStat[8] -= 1` (`:130349-130351`).

### 3.8 Editing clamps (the UI contract)

```
129890|                           this.negSalary -= 100;      // left arrow
129895|                           this.negSalary += 100;      // right arrow
129912|                           --this.negContract;
129917|                           this.negContract += 1;
129989|               if(this.negPayOff > 1000000)
129991|                  this.negPayOff = 1000000;
130004|               if(this.negPayOff < 0)
130006|                  this.negPayOff = 0;
130008|               if(this.negSalary < 0)
130010|                  this.negSalary = 0;
130012|               if(this.negSalary > 100000)
130014|                  this.negSalary = 100000;
130016|               if(this.negContract < 1)
130018|                  this.negContract = 1;
130020|               if(this.negContract > 48)
130022|                  this.negContract = 48;
```

**Hard caps for reimplementation:** salary 0…100,000/week in steps of 100;
contract 1…48 weeks in steps of 1; up-front 0…1,000,000 in steps that follow
the up-front editor; up-front additionally clamped to `negBuyOut … gamBank` in
Booking mode (`:129995-130001`).

---

## 4. Manager cut

### 4.1 State & defaults

```
995|       public var gamManagerCut:int;
131711|         this.gamManagerCut = 10;
```

Default **10%**, persisted in the save (`:8869`, `:8552-8554`). Reset to 0 when
you have no manager:

```
103756|             this.gamManagerCut = 0;
111631|                   this.gamManagerCut = 0;
112240|                      this.gamManagerCut = 0;
112304|                      this.gamManagerCut = 0;
```

The manager relationship is `charRelationship[player][1]` (`:42284`,
`:111494`) — slot **1** = manager, slot **2** = tag partner, slot **3** = ally,
slot **4/5/6** = enemy/other (§3.6).

### 4.2 What a prospective manager demands — `GetManagerCut`

```
112563|      public function GetManagerCut(char:int) : int
112566|         cut = this.charStat[char][1] - 50;
112567|         cut = this.Rnd(cut * 0.75,cut * 1.25);
112568|         cut = this.RoundOff(cut,5);
112569|         if(cut < 5)
112571|            cut = 5;
```

```
cut = max(5, round5( Rnd( (Pop-50)*0.75 , (Pop-50)*1.25 ) ))
```

A 90-popularity manager asks `Rnd(30,50)` → 30–50% in 5% steps. A 50-popularity
manager asks the 5% floor. This is the **only** place the hire price is
computed (`:111468`, `:112405`).

### 4.3 What you actually pay

```
126408|            if(this.charRelationship[this.gamChar][1] > 0)
126410|               this.gamFinances[3][1] = int(this.PercentOf(this.gamFinances[2][1],this.gamManagerCut));
126411|               if(this.gamFinances[3][1] < this.gamManagerCut * 10)
126413|                  this.gamFinances[3][1] = this.gamManagerCut * 10;
```

```
management_fee = max( salary_this_show * gamManagerCut/100 , gamManagerCut * 10 )
```

The `gamManagerCut * 10` floor is a **flat retainer**: at the default 10% the
manager gets at least **$100 per show even when you earn nothing**. This is why
a 0-salary show still costs you money.

Display (`:126551-126559`): if the fee equals the floor the UI prints
`"$100 (Minimum)"`, otherwise `"$X (N%)"`.

### 4.4 Manager demands a raise

Managers periodically demand a bigger cut. Accepting:

```
111426|                  this.gamBank -= this.negPayOff;
111428|                  if(this.gamManagerCut < 90)
111430|                     this.gamManagerCut += 10;
111432|                  this.charStat[this.gamChar][7] += 1;   // your Attitude
111433|                  this.charStat[this.gamChar][8] = this.charStat[this.gamChar][8] - 1;  // your Happiness
111434|                  this.charStat[this.negChar][7] = this.charStat[this.negChar][7] - 1;  // his Attitude
111435|                  this.charStat[this.negChar][8] += 1;                                  // his Happiness
```

**Hard cap 90%.** Refusing turns the manager into an enemy
(`BecomeEnemies`, `:111448`) and costs −1 Attitude.

### 4.5 Affordability gate

```
112450|         if(this.gamBank < this.gamManagerCut * 10)
112452|            this.negVerdict = 5;
```

You cannot even open negotiations for a manager whose retainer exceeds your
bank. Note this compares against `gamManagerCut*10` — the *current* cut, not the
candidate's — so the check is only meaningful once a cut has been quoted.

---

## 5. Event / match revenue

### 5.1 The seven-line ledger

`CalculateFinances()` (`:126361-126501`) builds `gamFinances[1..7]`, each row a
2-slot array: `[0]` = animated display value, `[1]` = true target. The screen
animates `[0]` toward `[1]` with `PursueInt` and only commits the bank when the
animation lands:

```
126310|                     if(this.gamFinances[this.cyc][0] == this.gamFinances[this.cyc][1] && this.gamFinances[this.cyc][0] != 0)
126312|                        if(this.cyc == 7)
126315|                           this.gamBank = this.gamFinances[7][1];
```

| Row | Label in UI | Career meaning | Booking meaning |
|---|---|---|---|
| 1 | Revenue | — (unused) | **gate money** |
| 2 | Salary | your wage | **whole roster's wages** |
| 3 | Management | manager's cut | wages of no-show talent (guarantees) |
| 4 | Gimmick | costume/weapon spend | injury cover payouts |
| 5 | Lifestyle | living costs | **production costs** |
| 6 | Profit | net | net |
| 7 | Balance | bank before → after | same |

Labels proven by the UI bindings `:126507-126597`.

### 5.2 Attendance

```
126369|         if(this.gamSchedule[this.gamDate] == 0 || this.gamSchedule[this.gamDate] == 10)
126371|            this.gamAttendance = 0;
126373|         if(this.fed == 7 && this.gamSchedule[this.gamDate] == 1)
126375|            this.gamAttendance = this.fedSize[this.fed];
126377|         if(this.gamMode == 2 && this.gamSchedule[this.gamDate] == 4)
126379|            this.gamAttendance = int(this.gamAttendance / 2);
```

Generated when the arena is generated, not at show time
(`GenerateArena`, `:17812-17817`):

```
17814|            this.gamCity[this.gamDate] = this.Rnd(1,15);
17815|            this.gamAttendance = this.GenerateAttendance(fed);
17816|            this.gamDraw[this.gamDate] = this.gamAttendance;
```

```
17822|      public function GenerateAttendance(fed:int) : int
17830|         fedFactor = this.fedPop[fed] - 40;
17831|         champFactor = fedFactor;
17832|         if(this.fedChamp[fed][1] > 0)
17834|            champFactor = this.charStat[this.fedChamp[fed][1]][1] - 40;
17836|         if(this.gamSchedule[this.gamDate] == 6 && this.fedSize[0] > 0)
17838|            fedFactor = champFactor = this.charStat[this.fedRoster[0][this.fedSize[0]]][1] - 40;
17840|         attendance = fedFactor * champFactor;
17841|         attendance *= (fedFactor + champFactor) / 20;
17842|         attendance *= this.RndDec(0.75,1);
17843|         if(this.gamSchedule[this.gamDate] > 1)
17845|            attendance *= 1.5;
17847|         if(fed == 7 && this.gamSchedule[this.gamDate] == 1)
17849|            attendance = 0;
```

```
ff = fedPop[fed] - 40                      // promotion popularity
cf = ff                                    // default: champion == promotion
cf = champPop - 40                         // if a champion exists
ff = cf = (last member of fedRoster[0]).Pop - 40   // Memorial show (schedule 6)

attendance = ff * cf
attendance *= (ff + cf) / 20
attendance *= RndDec(0.75, 1.0)
attendance *= 1.5   if schedule > 1        // PPV / Tournament / Inter-Promotional / Charity / Memorial
attendance  = 0     if fed == 7 && schedule == 1   // training session has no crowd
```

This is **quadratic-ish in popularity**: at fedPop 90 and champ 90 you get
`50*50*5 = 12,500` before the random and the 1.5× PPV bonus. At fedPop 60 and
champ 60 you get `20*20*2 = 800`. A ten-point swing in both numbers roughly
doubles the gate.

### 5.3 Gate revenue and ticket price

```
126381|         this.gamFinances[1][1] = int(this.gamAttendance * this.gamTicket);
126382|         if(this.gamMode == 2 && this.CountSegments() == 0)
126384|            this.gamFinances[1][1] = 0;
```

`Revenue = int(attendance × ticket)`. In Booking mode a card with **zero
segments is refunded in full** (UI prints `"Refunded"`, `:126516`).

Ticket price starts at **$13** (`:8421`, `:131699`) and is moved by world events
within **$10…$16**:

```
120475|                this.gamTicket += 1;
120478|                this.eText[this.no_events] = "Ticket prices have risen to $" + this.gamTicket + ", resulting in higher profits for wrestling shows.";
120482|                --this.gamTicket;
120485|                this.eText[this.no_events] = "Ticket prices have fallen to $" + this.gamTicket + ", resulting in lower profits for wrestling shows.";
117531|          if(this.randy == 0 && this.gamTicket < 16)
117535|          if(this.randy == 1 && this.gamTicket > 10)
```

So gate revenue is bounded by `attendance × 16` at the top and
`attendance × 10` at the bottom.

### 5.4 Career-mode costs

```
126388|            this.gamFinances[2][1] = this.charSalary[this.gamChar];
126389|            if(this.gamSchedule[this.gamDate] == 2 || this.gamSchedule[this.gamDate] >= 4 && this.gamSchedule[this.gamDate] <= 6)
126391|               this.gamFinances[2][1] = this.RoundOff(this.charSalary[this.gamChar] * 1.2,10);
```

**You are paid a 1.2× bonus for PPV (2), Inter-Promotional (4), Charity (5) and
Memorial (6)** — rounded to 10. Tournament (3) gets **no** bonus even though it
gets the 1.5× attendance.

```
126393|            if(this.charClause[this.gamChar][2] == 0)
126395|               if(this.gamResult[this.gamDate] < 1)
126397|                  this.gamFinances[2][1] = 0;
126399|               if(this.gamSchedule[this.gamDate] == 0 || this.gamSchedule[this.gamDate] == 10)
126401|                  this.gamFinances[2][1] = 0;
126404|            if(this.gamSchedule[this.gamDate] == 5 || this.gamSchedule[this.gamDate] == 6)
126406|               this.gamFinances[2][1] = 0;
```

- **No unconditional-pay clause (2) → you earn nothing if you lose**, and
  nothing on an off-day or while injured.
- **Charity (5) and Memorial (6) shows are unpaid work** — salary zeroed
  regardless of clauses, and the UI tags it `" (Donated)"` (`:126540`).

Gimmick spend (row 4), only if you have creative control:

```
126417|            if(this.charClause[this.gamChar][1] > 0)
126419|               this.gamFinances[4][1] = this.gamCostumeChanges;
126420|               if(this.charProp[this.gamChar] > 0 && this.charEditBlock[this.gamChar] != 10)
126422|                  this.gamFinances[4][1] += this.weapCost[this.charProp[this.gamChar]];
```

Lifestyle (row 5) — a **wealth tax**:

```
126425|            this.gamFinances[5][1] = int(this.gamBank / 50);
126426|            if(this.gamFinances[5][1] < this.charSalary[this.gamChar] / 5)
126428|               this.gamFinances[5][1] = int(this.charSalary[this.gamChar] / 5);
126430|            if(this.gamFinances[5][1] > this.charWorth[this.gamChar] / 5)
126432|               this.gamFinances[5][1] = int(this.charWorth[this.gamChar] / 5);
126434|            if(this.gamFinances[5][1] < 100)
126436|               this.gamFinances[5][1] = 100;
```

```
lifestyle = clamp( bank/50 , salary/5 , worth/5 )   then floor 100
```

i.e. **2% of your bank per show**, but never less than 20% of your weekly wage
and never more than 20% of your market worth, minimum $100. This is a soft
wealth cap in Career mode: the richer you get the more you bleed, up to the
worth ceiling.

Career profit:

```
126456|            this.gamFinances[6][1] = this.gamFinances[2][1] - (this.gamFinances[3][1] + this.gamFinances[4][1] + this.gamFinances[5][1]);
```

**In Career mode row 1 (gate) is not added to your profit** — you are an
employee and the gate belongs to the promotion.

### 5.5 Booking-mode costs

```
126460|            for(this.count = 1; this.count <= this.fedSize[this.fed]; ++this.count)
126462|               this.char = this.fedRoster[this.fed][this.count];
126463|               if(this.charArrived[this.char] > 0)
126465|                  if(this.charWorked[this.char] != 0)
126467|                     this.gamFinances[2][1] += this.charSalary[this.char];
126469|                  if(this.charClause[this.char][2] > 0 && this.charWorked[this.char] == 0)
126471|                     this.gamFinances[3][1] += this.charSalary[this.char];
126473|                  if(this.charClause[this.char][3] > 0 && this.charInjured[this.char] > 0)
126475|                     if(this.charSalary[this.char] > this.charWorth[this.char])
126477|                        this.gamFinances[4][1] += this.charSalary[this.char];
126481|                        this.gamFinances[4][1] += this.charWorth[this.char];
126486|            if(this.gamSchedule[this.gamDate] > 0)
126488|               this.gamFinances[5][1] = this.gamProduction;
126490|            this.gamFinances[6][1] = this.gamFinances[1][1] - (this.gamFinances[2][1] + this.gamFinances[3][1] + this.gamFinances[4][1] + this.gamFinances[5][1]);
126491|            if(this.gamSchedule[this.gamDate] == 5 || this.gamSchedule[this.gamDate] == 6)
126493|               if(this.gamFinances[6][1] > 0)
126495|                  this.gamFinances[6][1] = 0;
```

Booking rules, restated:

- You pay `charSalary` for **every roster member who arrived and worked**.
- **Unconditional-pay clause (2) means you pay them even when they didn't
  work** — that is row 3 ("Management" in the UI, but functionally it is
  *dead-money guarantees*).
- **Health cover (3) means you pay an injured worker their salary, or their
  worth if worth is higher** — row 4.
- Production is your arena spend for this show (row 5, = `gamProduction`).
- **Charity and Memorial shows can never make a profit** — profit is clamped to
  ≤ 0, and the UI prints `"Donated"` (`:126582-126587`).

`gamProduction` accumulates arena edits when you leave the arena editor:

```
124895|                     this.gamProduction += this.ArenaCosts();
```

### 5.6 `ArenaCosts()` — the production cost table

```
17901|      public function ArenaCosts() : int
17905|         if(this.arenaShape != this.gamArena[1])
17907|            cost += 1000;
17909|         if(this.arenaDecor != this.gamArena[0])
17911|            cost += 1000;
17913|         if(this.arenaShape > 0 && this.arenaBarriers != this.gamArena[2])
17915|            cost += 100;
17917|         if(this.ringShape > 0)
17919|            if(this.ringShape != this.gamArena[3])
17921|               cost += this.ringShape * 500;
17923|            if(this.ringSize != this.gamArena[4])
17925|               cost += Math.abs(this.ringSize - this.gamArena[4]) * 1000;
17927|            if(this.arenaRopes != 0)
17929|               if(this.arenaRopes != this.gamArena[5])
17931|                  cost += 100;
17933|               if(this.arenaPosts != this.gamArena[6])
17935|                  cost += 100;
17937|               if(this.arenaPads != this.gamArena[7])
17939|                  cost += 100;
17942|            if(this.arenaApron != this.gamArena[8])
17944|               cost += 100;
17946|            if(this.arenaApronLogo > 0 && this.arenaApronLogo != this.gamArena[9])
17948|               cost += 100;
17950|            if(this.arenaCanvas != this.gamArena[11])
17952|               cost += 100;
17954|            if(this.arenaMat > 0 && this.arenaMat != this.gamArena[12])
17956|               cost += 100;
17959|         if(this.arenaCage > 0)
17961|            cost += 1000;
17963|         if(this.no_items > 0)
17965|            cost += this.no_items * 20;
17967|         if(this.no_weaps > 0)
17969|            cost += this.no_weaps * 10;
```

| Change | Cost |
|---|---|
| Arena shape change | $1,000 |
| Arena décor change | $1,000 |
| Barriers change | $100 |
| Ring shape change | `ringShape × 500` |
| Ring size change | `abs(new − old) × 1000` (size is 0.8–1.0, so $0–$200 typically) |
| Ropes / posts / pads / apron / apron logo / canvas / mat | $100 each |
| Cage present | $1,000 |
| Furniture | **$20 each** |
| Weapons | **$10 each** |

Costs are **only charged for differences from the saved arena**
(`gamArena[...]`), so re-saving the same set is free. `no_items` and `no_weaps`
are charged unconditionally when non-zero — they are consumables, not edits.
Budget shown live in the editor as `gamProduction + ArenaCosts()`
(`:124800`, `:128654`).

`arenaCage` is a *match* flag, not an arena part: it is set 0–5 during match
setup (`:44921-45208`) and is **not** in `gamArena[]` (`SaveArena`, `:17854`),
so the `$1,000` cage charge fires whenever a cage match happens to be loaded
when `ArenaCosts` is evaluated. Treat it as "cage matches cost $1,000 of
production" in a remake.

### 5.7 Costume & weapon pricing (Career, needs clause 1)

`FindCostumeChanges(char, old)` diffs the character against a snapshot:

```
29007|      public function FindCostumeChanges(char:int, old:int) : int
29032|                  if(this.charLimb[char][coz][limb] > 0 && this.charLimb[char][coz][limb] != this.charLimb[old][coz][limb])
29034|                     changes += 25;
29039|         if(this.charHairStyle[char] > 0 && this.charHairStyle[char] != this.charHairStyle[old])
29041|            changes += 25;
29043|         if(this.charHairLength[char] > 0 && this.charHairLength[char] != this.charHairLength[old])
29045|            changes += 25;
29047|         if(this.charShave[char] > 0 && this.charShave[char] != this.charShave[old])
29049|            changes += 25;
29051|         if(this.charBeard[char] > 0 && this.charBeard[char] != this.charBeard[old])
29053|            changes += 25;
29055|         if(this.charTheme[char] > 0 && this.charTheme[old] != this.charTheme[char] || this.charDeviceTheme[char] > 0 && this.charDeviceTheme[old] != this.charDeviceTheme[char])
29057|            changes += 1000;
29059|         if(this.charLight[char] > 0 && this.charLight[old] != this.charLight[char])
29061|            changes += 250;
```

| Edit | Price |
|---|---|
| Each changed body-part texture, per costume slot 1–3 | **$25** |
| Hair style | $25 |
| Hair length | $25 |
| Shave | $25 |
| Beard | $25 |
| Attire theme **or** device theme | **$1,000** |
| Light | $250 |

`changes` accumulates into `gamCostumeChanges` on leaving the editor
(`:128875`) and is then billed weekly in `gamFinances[4]` (`:126419`).

Weapon prices (`weapCost`, `:132585-132800`):

| Weapon | Cost |
|---|---|
| None | 0 |
| World / Inter / Tag Title | 1,000 each |
| Microphone | 100 |
| Baseball Bat | 50 |
| Chair | 100 |
| Bell | 100 |
| Cane | 50 |
| Pipe | 50 |
| Plank | 50 |
| Nightstick | 50 |
| Trophy | 500 |
| Brass Knucks | 100 |
| Briefcase | 100 |
| Broom | 50 |
| Dumbbell | 100 |
| Hammer | 100 |
| Wooden Board | 100 |
| Cage Piece | 100 |

### 5.8 Clause interaction matrix

Reading the branch order of `CalculateFinances` (`:126388-126455`) exactly:

| Clause 2 (guaranteed) | Clause 3 (health) | Blank week (0) | Lost match | Injured week (10) | Charity/Memorial |
|---|---|---|---|---|---|
| no | no | $0 | $0 | $0 | $0 |
| no | **yes** | $0 | $0 | `max(lifestyle, salary)` | $0 |
| **yes** | no | **full salary** | **full salary** | $0 (clause 2 zeroes it first, nothing restores) | $0 |
| **yes** | **yes** | full salary | full salary | `max(lifestyle, salary)` | $0 |

Charity (5) and Memorial (6) always pay **$0** and always override everything
(`:126404-126407` runs after both clause branches).

---

## 6. Weekly cash flow & bankruptcy

### 6.1 The calendar

There is **no day/week/month hierarchy in the economy** — there are 48 *dates*
per year, and one date = one week:

```
116496|      public function AdvanceDate() : void
116499|         this.gamDate += 1;
116500|         if(this.gamDate > 48)
116502|            this.gamDate = 1;
116503|            this.gamYear += 1;
116504|            this.ResetSchedule(this.gamDate);
116506|         this.gamCostumeChanges = 0;
```

Called from `frame15` (`:136121`) — the "next week" transition — immediately
before the finance screen (`frame19`, `:136438 this.CalculateFinances();`).

Note `gamCostumeChanges = 0` every week: the costume charge in §5.4 is
**per-week, not per-change**.

`ResetSchedule` builds the year's card:

```
9038|      public function ResetSchedule(startDate:int) : void
9041|         rotor = this.Rnd(1,6);
9042|         if(rotor >= 5)
9044|            rotor -= 2;
9046|         for(this.date = startDate; this.date <= 48; ++this.date)
9048|            this.ResetDate(this.date);
9049|            this.gamSchedule[this.date] = 1;
9050|            if(rotor >= 4)
9052|               this.gamSchedule[this.date] = 2;
9053|               rotor = 0;
9055|            rotor += 1;
9056|            if(this.Rnd(0,4) == 0 || this.date < this.gamDate)
9058|               this.gamSchedule[this.date] = 0;
```

So a year is: mostly **TV Taping (1)**, a PPV **(2)** roughly every 4th week,
and **1 in 5 dates blank (0)**. With 48 dates and 20% blanks, expect **~38
shows/year**.

### 6.2 The tax/perf tick (this is the whole cash flow)

One ledger per show date, computed when the finance screen opens and committed
when the counter animation lands:

```
136438|         this.CalculateFinances();
126315|                           this.gamBank = this.gamFinances[7][1];
```

There is **no** interest, no daily drain, no separate payroll run. Career mode
charges you on dates you are paid; booking mode charges you on dates you run a
show. The only recurring cost that is not tied to your own participation is
Career `lifestyle` (§5.4), and it is charged **on every date**, including blank
ones, because `gamFinances[5][1]` is computed unconditionally.

Consequence worth stating plainly: **a blank date is not free in Career mode.**
You pay `clamp(bank/50, salary/5, worth/5, min 100)` and receive nothing unless
you hold guaranteed pay (clause 2), which pays your full salary even on a
schedule-0 date (`:126393-126403`).

### 6.3 Negative balance — what actually happens

There is **no bankruptcy state and no game over**. `grep` for
`bankrupt|sacked|fired` returns no game-flow logic — the balance is an unguarded
`int` that can go arbitrarily negative:

```
54529|          this.gProfile.Bank.text = "$" + this.DisplayFigure(this.gamBank);
54531|          if(this.gamBank <= 0)
```

`DisplayFigure` handles the minus (`:4258-4262`). The only consequences of debt
are soft gates, and one hard one:

1. **Money-pressure storyline fires.** Career, checked on the meeting roll:

```
103301|            if(this.randy == 9 && this.gamBank < 100000 && this.fed != 7 || this.gamBank < 0)
103303|               this.negTopic = 209;
```

Booking, on the weekly event roll:

```
107368|            if(this.randy == 0 && this.gamBank < 1000000 || this.gamBank < 0)
107370|               this.negTopic = 209;
```

Because `&&` binds tighter than `||`, this parses as
`(randy == 9 && bank < 100,000 && fed != 7) || (bank < 0)` — so **any negative
balance guarantees the storyline**, and a sub-$100k career can hit it by roll.

2. **The storyline sets a savings target and a deadline** (`:113415-113430`):

```
113415|               this.gamDeadline = this.gamDate + this.Rnd(4,8);
113416|               this.gamTarget = this.RoundOff(this.gamBank + this.charWorth[this.gamChar] * 2,100);
...
113420|               if(this.gamBank >= 0)
113422|                  this.promoLineA = "Amass savings of $" + this.DisplayFigure(this.gamTarget) + " by the " + ...
113427|                  this.promoLineA = "Get out of debt by the " + this.DescribeDate(this.gamDeadline,-1) + " or";
113429|                  this.gamTarget = 0;
```

Career target: `bank + 2×worth`, rounded to 100. In debt the target is simply
**0** (get back to zero). Deadline is **4–8 weeks**.

Booking equivalent (`:113739-113755`) is `bank + CountWages(fed)` — i.e. **one
extra week of payroll in the bank** — rounded to 100, same 4–8 week deadline.

3. **Failure is the only "bankruptcy" outcome.** Mission topic 251 is the
firing:

```
129579|               if(this.negTopic == 251)
129581|                  if(this.fed == 7 || this.gamMode == 2)
129583|                     this.MoveChar(this.gamChar,0);
129586|                        this.gamBooker = 0;
129590|                        this.gamWrestler = 0;
129597|                     this.MoveChar(this.gamChar,7);
```

Career: dropped to the free promotion (fed 7). Booking: **the career ends** —
you lose the booker slot and are moved out of the world (`MoveChar(...,0)`).

4. **Small-money social gate** — a friend offers to help below $20k:

```
103550|            if(this.randy == 1 && this.gamBank < 20000 || this.gamBank < 0)
103552|               this.negTopic = 45;
```

### 6.4 The millionaire milestone

```
117470|                     if(this.gamBank > 1000000 && this.gamBankMilestone < 1000000)
117472|                        this.AddEvent(this.char,413);
120751|            if(newsEvent == 413)
120753|               this.eHeadline[this.no_events] = "Million Dollar Man";
120755|               this.eText[this.no_events] = "Congratulations to " + this.charName[char] + " for becoming a millionaire with an estimated fortune of $" + this.DisplayFigure(this.gamBank) + "!";
120756|               this.charNewStat[char][8] += this.Rnd(1,5);
120757|               this.gamBankMilestone = 1000000;
```

A one-shot worldwide news story at the first $1,000,000, granting **+1..5
Happiness**. `gamBankMilestone` is the latch and it is saved (`:8868`), so the
story never repeats. This is the only scripted reward for wealth.

### 6.5 Persistence

```
8867|          saveFile.data.gamBank = this.gamBank;
8868|          saveFile.data.gamBankMilestone = this.gamBankMilestone;
8869|          saveFile.data.gamManagerCut = this.gamManagerCut;
8870|          saveFile.data.gamCostumeChanges = this.gamCostumeChanges;
8896|          saveFile.data.gamAttendance = this.gamAttendance;
8897|          saveFile.data.gamTicket = this.gamTicket;
8907|          saveFile.data.gamProduction = this.gamProduction;
```

Saved: bank, milestone, manager cut, costume-change counter, attendance, ticket
price, production. **Not saved: `gamFinances`** — the ledger is rebuilt each
week from state, which is why it can be recomputed deterministically on load.

---

## 7. Progression gates (what money actually unlocks)

### 7.1 Hard numeric thresholds found in code

| Threshold | Where | Effect |
|---|---|---|
| **$0** | `103301`, `107368` | negative balance always triggers the financial-pressure storyline |
| **$10,000** | `8380`, `131708` | default starting bank |
| **$20,000** | `103550` | below this a friend offers financial help (topic 45) |
| **$100,000** | `103301` | career: below this the money storyline can fire on a roll |
| **$250,000** | `8376` | Booking-mode starting bank |
| **$1,000,000** | `107368` | booking: below this the money storyline can fire on a roll |
| **$1,000,000** | `117470` | "Million Dollar Man" one-shot achievement |
| **$1,000,000** | `129989` | absolute cap on any single up-front payment |
| **$100,000** | `130012` | absolute cap on weekly salary |
| **$1,000** | `8382` | career start: salary above this multiplies starting bank ×10 |
| **$10 × managerCut** | `112450` | minimum bank required to even discuss hiring a manager |
| **arena cost** | `124800` | production is charged the moment you leave the arena editor |

### 7.2 Non-numeric gates that money feeds

- **Creative control (clause 1)** is what lets you spend on costumes and
  weapons at all (`:126417-126422`). Without it, `gamFinances[4]` is 0 and you
  cannot change your look — money alone does not unlock this.
- **Health cover (clause 3)** converts your bank into injury income; without it
  an injury is pure loss.
- **Unconditional pay (clause 2)** is the only way to earn on a losing week or
  a blank week.
- **Booking mode**: nothing is gated by money except the two hard clamps —
  up-front ≤ bank (`:130001`) and no bid above bank (`:116461`). You can run a
  show with a negative bank; you just cannot buy talent.

### 7.3 Missions that are money conditions

```
103334|            if(this.gamMission == 9 && this.gamBank >= this.gamTarget)
103336|               this.negTopic = 250;
```

Mission 9 is literally "reach `gamTarget` in the bank" and is the only mission
type evaluated against `gamBank`. Its target is set by the storylines above
(`bank + 2×worth` career, `bank + CountWages` booking).

```
103356|            if(this.gamMission == 15 && this.gamPaid[1] > 0)
```
(`:103356`, `:107436`) — mission 15 completes when the IAP is bought. The
economy and the paywall are entangled here; a reimplementation should drop
mission 15.

### 7.4 What money does **not** unlock

Worth checking before designing a remake: `charWorth`, `charSalary`, `fedPop`,
`fedRep`, `showPop` and title holds are the only inputs to the economy, and
**none of them reads `gamBank`**. Wealth never buys popularity, a title push, a
better fed, or a TV slot. The only purchases in the game are:

1. up-front signing payments (Booking),
2. manager retainers (Career),
3. costumes / weapons (Career, needs clause 1),
4. arena production (Booking).

That is the complete spend surface.

---

## 8. Reimplementation notes

### 8.1 Core data model

```ts
type Economy = {
  bank: number;              // int, may be negative
  bankMilestone: number;     // 0 | 1000000
  managerCut: number;        // 0..90, default 10
  ticket: number;            // 10..16, default 13
  attendance: number;
  production: number;
  costumeChanges: number;
  date: number;              // 1..48
  year: number;
  schedule: Int8Array;       // 1..48 -> 0 none,1 TV,2 PPV,3 Tournament,4 Inter,5 Charity,6 Memorial,10 Injured
};
type Character = {
  worth: number; salary: number; contract: number;   // weeks
  clause: [number, number, number];                  // creative, guaranteed, health
  fed: number; injured: boolean; arrived: boolean; worked: boolean;
};
```

Keep the ledger as a **pure function** — it has no side effects in the original
and re-deriving it every frame is what the port does:

```ts
function calculateFinances(state): Row[7]   // rows: revenue, salary, mgmt, gimmick, lifestyle, profit, balance
```

### 8.2 Order of operations that matters

The original's results depend on these quirks; preserve them or document the
deviation:

1. `ContractFilter` runs **before** `ClauseFilter` (§2.4).
2. `RoundOff(x,100)` is applied **last**, so a 0.30 clause multiplier can round
   a $1,000 wage to $300, not $250.
3. `Rnd(min,max)` is `round(random*(max-min)) + min` — **endpoints are
   half-weighted**. Using `floor(random*(max-min+1))+min` will shift every
   distribution, especially the `Rnd(-8,4)` up-front split (69% zero).
4. Career revenue row 1 is computed and displayed but **excluded from profit**;
   Booking includes it. Do not "fix" this.
5. `lifestyle` uses the bank **before** this week's profit (`gamFinances[7][0]
   = gamBank` is written after row 5 is computed, `:126499`).
6. Charity/Memorial clamp profit to ≤0 in Booking and zero the wage in Career.
7. Booking pays injured workers `max(salary, worth)` under clause 3 — the only
   place worth is used as a *cost*.

### 8.3 Suggested module split

```
econ/
  worth.ts        CalculateWorth, StatAverage
  salary.ts       GenerateContract, ContractFilter, ClauseFilter, ClauseEntitled
  negotiate.ts    PrepareContract, PrepareBookingContract, verdict tables
  finance.ts      CalculateFinances, ArenaCosts, GenerateAttendance
  manager.ts      GetManagerCut, management fee
  storylines.ts   money-pressure (209), firing (251), millionaire (413)
```

All five are pure except `storylines`, which mutates schedule/date.

### 8.4 Web implementation

- Store `bank` as a plain `number` (int32 is enough: cap 1,000,000 up-front,
  but the bank itself is uncapped and can go negative — do **not** clamp).
- Round exactly where the original rounds; do not use `toFixed` for money.
- The finance screen is an **animation** (`PursueInt`, `:121027`); the truth is
  `gamFinances[i][1]`. Commit `bank = balance[1]` only when the tween finishes,
  or just commit immediately and animate cosmetically — the end state is
  identical.
- Persist `{bank, bankMilestone, managerCut, costumeChanges, attendance,
  ticket, production, date, year, schedule}`. Drop `gamFinances` and recompute.

### 8.5 Roblox implementation

- **Server-authoritative.** All of `bank`, `salary`, `contract`, `clause`,
  `ticket`, `production` live in `ServerStorage`/module state or in `IntValue`s
  under a per-player folder that the client can only read. Never let the client
  write `bank` — this is the single easiest exploit in a port.
- `bank` → `IntValue` (`IntValue` is int32; the bank can exceed 2.1B only in
  absurd runs, so int64 via a `NumberValue` is safer if you expect long games).
- Persist with `DataStoreService` as a single table per player; save on
  `PlayerRemoving` **and** on `game:BindToClose`.
- Model the weekly tick as a server function called once per round, not a
  `while true do task.wait()` loop — the original is event-driven (`AdvanceDate`
  on transition), and a polling loop will drift.
- Reuse the ledger as a single `RemoteFunction:GetFinances()` returning the
  seven rows for the UI; compute on the server, render on the client.
- For the negotiation UI, the client can hold `negSalary`, `negContract` and
  the three clause booleans (they are just a draft), but `GetContractVerdict`
  **must** run on the server and must re-derive `negWorth`, `negBuyOut` and
  `negMax` itself — otherwise a client can send `negVerdict = 0`.
- `Rnd` must be `math.floor(x + 0.5)` on the server's `Random.new()` to match
  the rounded-uniform behaviour.
- Money display: `DisplayFigure` prints `$1.234m` style — implement as a
  formatting-only helper, never as the stored value.

### 8.6 Balance dials (highest leverage first)

If the remake needs tuning, these five constants control almost everything:

| Dial | Original | Effect of raising |
|---|---|---|
| `ticket` | 13 (10–16) | linear on all gate revenue |
| `fedPop` floor | 60–65 | quadratic on attendance via `GenerateAttendance` |
| `StatAverage` bias | 5/9 on Popularity | how fast worth (and therefore wages) explode |
| `ContractFilter` slope | 1/3 short, 1/4 long | cost of long deals |
| `lifestyle` divisor | `bank/50` | how hard wealth is taxed in Career |

The single most sensitive formula in the game is
`attendance = ff*cf*(ff+cf)/20` — a 10-point rise in both factors roughly
doubles the gate, and gate is the only revenue line in Booking mode.

---

## 9. UNKNOWNS

Resolved during write-up and folded into the body above: costume pricing
(§5.7), weapon prices (§5.7), the `arenaCage` charge (§5.6) and the blank-week
guaranteed-pay branch (§5.8).

Still unproven:

1. **`TitleHolder` return values 1/2/3** — proved that 1 → ×1.5 worth and 2|3 →
   ×1.25 (`:114803-114811`), but which belt each number denotes lives in
   `TitleHolder` (`:10574`), which I did not read. Affects naming only, not the
   arithmetic.
2. **`fedPolicy` enumeration** — the *effects* of policies 1–10 are fully
   proven (§2.5, §3.5), but their human-readable names live in the options menu,
   not in this file. The mapping above is behavioural, not nominal.
3. **The exact yearly mix of schedule types** — `ResetSchedule` gives the base
   distribution (§6.1), but `AdjustSchedule` (`:9084`) can rewrite dates to
   Inter-Promotional (4) and I read only its first 14 lines. The ~38 shows/year
   figure is therefore a floor, not an exact count.
4. **`no_limbs`** — the costume diff loops `limb = 1..no_limbs` and skips 6, 7,
   15, 17, 19 unconditionally plus 3/18/19/21 on costume slots 2–3 (`:29016-29029`).
   The value of `no_limbs` is not in this file, so the per-costume maximum
   number of $25 charges is bounded but not exact.
5. **Whether `negBuyOut` is charged *in addition* to salary** — the code adds
   `negPayOff - negBuyOut` into `negPayment` for the AI's valuation
   (`:116230`) but the bank is debited the full `negPayOff` (`:130318`), whose
   `negBuyOut` portion is the poaching fee paid to the *other* promotion. I
   infer that split from the strings (*"$X of that is for <fed>"*, `:115725`)
   rather than from a money-transfer line to the other fed — no such line
   exists in this file, so in the game the buy-out fee may simply vanish.
6. **`gamProduction` reset points** — set to 0 at `:8418`, `:116739`, `:131713`
   and accumulated at `:124895`/`:128879`; I did not prove it is zeroed after
   every show, so a reimplementation should zero it explicitly at the end of
   the ledger.

---

## 10. Appendix — every hardcoded constant, in one place

| Constant | Value | Anchor |
|---|---|---|
| Booking starting bank | 250,000 | `:8376` |
| Career starting bank | 10,000 (or `salary*10` if `salary > 1000`) | `:8380-8384` |
| Takeover budget | `RoundOff(CountWages(fed)*2, 1000)` | `:8524-8525` |
| Ticket default | 13 | `:8421`, `:131699` |
| Ticket bounds | 10 … 16 | `:117531-117535` |
| Manager cut default | 10% | `:131711` |
| Manager cut cap | 90% | `:111428` |
| Manager raise step | +10% | `:111430` |
| Manager retainer floor | `cut * 10` | `:126411` |
| `GetManagerCut` base | `Pop − 50`, ×0.75…1.25, round5, floor 5 | `:112566-112571` |
| Worth stat offset | `StatAverage(c,1) − 40` | `:114784` |
| Worth minimum chunk | 15 | `:114785-114787` |
| Worth curve | `chunk³ / 15` | `:114789-114790` |
| Worth fed-7 penalty | ×0.5 | `:114791-114793` |
| Worth fed-8 bonus | ×1.5 | `:114795-114797` |
| Worth injury penalty | ×0.75 | `:114799-114801` |
| Worth champion bonuses | ×1.5 / ×1.25 / ×1.25 | `:114803-114810` |
| Worth booker bonus | ×1.5 | `:114812-114814` |
| Worth rounding / floor | round 10 / min 100 | `:114816-114819` |
| AI salary variance | ×[0.5, 1.0] | `:115186` |
| AI contract length | `Rnd(8,48)`; policy3 `Rnd(4,24)`; policy4 `Rnd(24,48)` | `:115173-115182` |
| ContractFilter pivot | 24 weeks | `:114827-114833` |
| ContractFilter short slope | `(24 − (24−len)/3)/24` | `:114829` |
| ContractFilter long slope | `(24 + (len−24)/4)/24` | `:114833` |
| Clause cost — creative | −0.20 / −0.10 | `:114897`, `:114901` |
| Clause cost — guaranteed | −0.40 / −0.20 | `:114908`, `:114912` |
| Clause cost — health | −0.10 / −0.05 | `:114919`, `:114923` |
| Salary rounding | `RoundOff(_,100)` | `:115225` |
| Offer worth (career) | `worth ×2 if fed 8`, ×[0.5,1.0] | `:114068-114073` |
| Offer salary (career) | `worth × [0.6, 1.1]` | `:114074` |
| Offer length (career) | `Rnd(4,44)`; fed8 `Rnd(2,8)` | `:114075-114086` |
| Up-front split rolls | `Rnd(-8,4)` → 25/50/75/100% | `:114126-114157` |
| Buy-out | `contract × (salary or worth)` | `:115350-115354` |
| Negotiation chances | career `Rnd(0,8)`, booking `Rnd(0,10)` | `:114216`, `:115450` |
| Salary editor cap | 100,000 | `:130012` |
| Up-front cap | 1,000,000 | `:129989` |
| Contract editor bounds | 1 … 48 | `:130016-130022` |
| Salary editor step | 100 | `:129890-129895` |
| Attendance stat offset | −40 (fed and champion) | `:17830-17834` |
| Attendance curve | `ff*cf*(ff+cf)/20` | `:17840-17841` |
| Attendance random | ×[0.75, 1.0] | `:17842` |
| Attendance big-show bonus | ×1.5 when schedule > 1 | `:17843-17845` |
| Career show bonus | ×1.2 for schedule 2, 4, 5, 6 | `:126389-126391` |
| Lifestyle divisor | `bank / 50` | `:126425` |
| Lifestyle floor / ceiling | `salary/5` … `worth/5`, min 100 | `:126426-126436` |
| Arena shape / decor | 1,000 each | `:17905-17911` |
| Arena barriers | 100 | `:17913-17915` |
| Ring shape | `ringShape × 500` | `:17919-17921` |
| Ring size | `abs(delta) × 1000` | `:17923-17925` |
| Arena trims (ropes, posts, pads, apron, logo, canvas, mat) | 100 each | `:17927-17956` |
| Cage | 1,000 | `:17959-17961` |
| Furniture / weapons | 20 / 10 each | `:17963-17969` |
| Costume limb / hair / shave / beard | 25 each | `:29032-29053` |
| Costume theme | 1,000 | `:29055-29057` |
| Costume light | 250 | `:29059-29061` |
| Millionaire story | > 1,000,000 | `:117470`, `:120751-120757` |
| Money-storyline threshold (career) | < 100,000 | `:103301` |
| Money-storyline threshold (booking) | < 1,000,000 | `:107368` |
| Friend-bailout threshold | < 20,000 | `:103550` |
| Money-storyline deadline | `gamDate + Rnd(4,8)` | `:113415` |
| Career savings target | `RoundOff(bank + worth*2, 100)`, 0 if in debt | `:113416-113429` |
| Booking savings target | `RoundOff(bank + CountWages(fed), 100)`, 0 if in debt | `:113740-113755` |
| Dates per year | 48 | `:116500-116504` |
| Blank-date probability | 1 in 5 (`Rnd(0,4)==0`) | `:9056` |
| PPV cadence | rotor `Rnd(1,6)`, −2 if ≥5, fires at ≥4 | `:9041-9053` |



# PART 4 — 03-character-progression.md

# 03 — CHARACTER MODEL & PROGRESSION

**Game:** Wrestling Revolution 3D (`air.WR3DFree` 1.750.64) — Adobe AIR / ActionScript 3
**Source:** `as3/scripts/Game_fla/MainTimeline.as` (137,493 lines, JPEXS decompile)
**Convention:** all game arrays are **1-indexed**; `[0]` is unused or a sentinel.
**Status:** every claim below is quoted from decompiled code with `file:line`.

---

## 0. Two ways a character comes into existence

| Path | Entry point | Used when |
|---|---|---|
| **Shipped roster** | `LoadedDefaultChars()` — `MainTimeline.as:52154` | Normal play. Reads `Characters.txt`, 300 records × 335 fields (see `roster_parse.py`). |
| **Generated roster** | `GenerateRosters()` — `MainTimeline.as:54307` | "Randomise roster" / new career from scratch. Calls `GenerateCharacter()` for all 300. |

Both produce the same 300-slot schema. The shipped roster is authored data; the generated
roster is the algorithm in §5. A website/Roblox rebuild should ship the authored 300 and
keep `GenerateCharacter()` only as a "new promotion" tool.

```as3
// MainTimeline.as:54307
public function GenerateRosters() : void
...
while(this.char <= this.no_chars)
{
   this.GenerateCharacter(this.char);
   ++this.char;
}
```
`no_chars` is fixed at 300 (`MainTimeline.as:133627`: `this.no_chars = 300;`).

---

## 1. The character record

Fields that survive a save (`SaveCharacter`, `MainTimeline.as:53020-53120`) and their
authoritative ranges. Values come from three sources: shipped file, generator, or the
in-game editor (ranges proven in §1.1).

| Field | Type | Domain | Meaning |
|---|---|---|---|
| `charName` | String | free text | Display name, `"First Last"` or a nickname. |
| `charTeamName` | String | free text | Tag/stable name. Generator default `"Team " + lastWord(name)`. |
| `charGender` | int | 0–1 | 0 = Male, 1 = Female. |
| `charAge` | int | 16–99 | Age **at career start**; live age is derived (§7.6). |
| `charRole` | int | 1–3 | Wrestler / Manager / Referee (§2). |
| `charHeel` | int | 0–1 | 0 = Face, 1 = Heel. |
| `charTheme` | int | 1–`no_themes` | Entrance music index. |
| `charLight` | int | 0–12 | Entrance lighting preset (§3.3). |
| `charProp` | int | 0, 4–20 | Signature weapon index (§3.4). |
| `charRelationship[1..6]` | int[6] | 0–300 | Character indices, 0 = none (§4). |
| `charStat[1..8]` | int[8] | 50–99 | The eight visible stats (§7). |
| `charBuild` | int | 1–9 | Body morph (§3.5). |
| `charHeight` | int | 86–110 | Height scale, percent; 100 = baseline. |
| `charEyes/Brows/Beard/Shave/HairStyle/HairLength` | int | see §5.2 | Appearance. |
| `charCostume[1..3]` | nested | 3 × 16 limbs | Per-limb colour + flesh/pads/baggy flags (doc 02). |

### 1.1 Editor-proven ranges (the hard bounds the UI enforces)

`MainTimeline.as:127577-127643` — the character editor, `BrowseOption(start, menuID, increment, delay, min, max, cycle)`:

```as3
this.charAge[this.char]     = this.BrowseOption(this.charAge[this.char],2,1,1,16,99,0);
this.charGender[this.char]  = this.BrowseOption(this.charGender[this.char],3,1,5,0,1,1);
this.charHeight[this.char]  = this.BrowseOption(this.charHeight[this.char],this.n,1,2,86,110,0);
this.charBuild[this.char]   = this.BrowseOption(this.charBuild[this.char],this.n,1,3,this.min,this.max,1);
this.charRole[this.char]    = this.BrowseOption(this.charRole[this.char],this.n,1,5,1,3,1);
this.charHeel[this.char]    = this.BrowseOption(this.charHeel[this.char],this.n,1,5,0,1,1);
```
with `min/max` for build set just above (`127594-127603`):
```as3
if(this.charGender[this.char] == 1) { this.min = 1; this.max = 2; }
else                                { this.min = 3; this.max = this.no_builds; }
```
`no_builds = 9` (`MainTimeline.as:132297`). So **females can only be build 1–2**, males 3–9.
Stats are edited separately with a point budget (`127650-127665`):
```as3
this.editPoints = 350;          // screenAgenda == 3, i.e. character creation
...
this.editPoints = 999;          // free edit
...
this.count = 2; while(this.count <= 6) { this.editPoints -= this.charStat[this.char][this.count]; ++this.count; }
```
Only stats **2–6** are purchasable at creation (350 points), so a starting build is
Strength+Skill+Agility+Stamina+Toughness ≤ 350, i.e. ≤ 70 average.

---

## 2. `charRole` — 1 Wrestler, 2 Manager, 3 Referee

The display table is the authority (`MainTimeline.as:131377`):

```as3
this.textRole = new Array("None","Wrestler","Manager","Referee");
```

| Value | Name | Behavioural consequences (all verified) |
|---|---|---|
| 0 | None | Never assigned by the game; `textRole[0]` exists only as padding. |
| **1** | **Wrestler** | Bookable in matches. The *only* role accepted by the match-racer and by "best wrestler" queries. |
| **2** | **Manager** | Not bookable as a competitor; may accompany someone to ringside; every fed's head booker is role 2. |
| **3** | **Referee** | Officiates; excluded from booking, trading and relationships; can be bribed/biased. |

### 2.1 Proof that role 1 is the "can compete" gate

Auto-booking an exhibition — it re-rolls until it lands on someone present, fit **and** role 1
(`MainTimeline.as:45410`):
```as3
while(this.charVacant[startChar] > 0 || this.charInjured[startChar] > 0 || this.charRole[startChar] != 1)
```
"Best wrestler in the promotion" (`MainTimeline.as:53766`):
```as3
if(this.charRole[char] == 1)
{
   if(category == 0)
   {
      if(this.StatAverage(char,0) > hi)
```
"Was this person booked on the last show?" check (`MainTimeline.as:117336`):
```as3
... && this.charArrived[this.char] > 1 && this.charRole[this.char] == 1)
```

### 2.2 Proof that role 2 = manager / head booker

Career start, booking mode (`MainTimeline.as:8340-8348`):
```as3
if(this.gamMode == 2)
{
   this.gamBooker = this.gamChar;
   this.charRole[this.gamChar] = 2;
}
else
{
   this.gamWrestler = this.gamChar;
   this.charRole[this.gamChar] = 1;
}
```
Every promotion's booker is forced to role 2 (`MainTimeline.as:54315-54319`):
```as3
for(this.fed = 1; this.fed <= this.no_feds; ++this.fed)
{
   this.fedOwner[this.fed] = this.fedRoster[8][this.fed];
   this.fedBooker[this.fed] = this.fedRoster[this.fed][1];
   this.charRole[this.fedRoster[this.fed][1]] = 2;
```
Managers are used as ringside seconds, not competitors (`MainTimeline.as:54660-54672`) —
note a **partner outranks a manager** for the corner slot:
```as3
if(this.charRelationship[this.char][2] > 0)
{
   if(this.FindCharacter(this.charRelationship[this.char][2]) == 0)
   {
      this.pManager[this.cyc] = this.charRelationship[this.char][2];
   }
}
if(this.charRelationship[this.char][1] > 0)
{
   if(this.FindCharacter(this.charRelationship[this.char][1]) == 0)
   {
      this.pManager[this.cyc] = this.charRelationship[this.char][1];
   }
}
```

### 2.3 Proof that role 3 = referee

Referees are addressed as a dedicated cast slot (`pChar[no_wrestlers + 1]`) and the code
explicitly checks "is this person *not* a referee" when it wants a wrestler
(`MainTimeline.as:10474`):
```as3
if(this.no_refs > 0 && this.charRole[ref] != 3 && ref != this.fedBooker[7] && ...)
```
Referees are stripped of all relationships every week (`MainTimeline.as:116619-116629`):
```as3
if(this.gamMode == 1)
{
   if(this.charRole[this.char] == 3 || this.char == this.fedBooker[7])
   {
      this.count = 1;
      while(this.count <= 6)
      {
         this.charRelationship[this.char][this.count] = 0;
```
Referees are never traded (`MainTimeline.as:117103`):
```as3
if(this.fedSize[this.fed] > 18 && (this.charRole[this.char] != 3 || this.gamMode == 2))
```
A referee who is your friend/partner/enemy deliberately skews the finish — the check reads
relationship slots 1, 2, 3 against the **winner** and slot 4 against the **loser**
(`MainTimeline.as:43676-43680`):
```as3
if(this.pChar[this.no_wrestlers + 1] == this.charRelationship[this.pChar[this.matchWinner]][1] ||
   this.pChar[this.no_wrestlers + 1] == this.charRelationship[this.pChar[this.matchWinner]][2] ||
   this.pChar[this.no_wrestlers + 1] == this.charRelationship[this.pChar[this.matchWinner]][3])
...
if(this.pChar[this.no_wrestlers + 1] == this.charRelationship[this.pChar[this.matchLoser]][4])
```

### 2.4 Role changes during play

Roles are mutable: a wrestler can be promoted to manager and back
(`MainTimeline.as:119859`, `119893`, `119924`, `120339`), and the editor can cycle 1→2→3→1
(§1.1). Career logic reads the role before offering a role-switch storyline
(`MainTimeline.as:112505`):
```as3
if(this.charRole[this.negChar] != 1)
```

---

## 3. `charGender`, `charHeel`, `charLight`, `charProp`

### 3.1 `charGender` — 0 Male, 1 Female

```as3
// MainTimeline.as:131373
this.textGender = new Array("Male","Female");
```
Gender is not cosmetic; it gates appearance and is used in pronoun text
(`MainTimeline.as:131374`: `this.He = new Array("He","She");`). It changes the legal build
range (§1.1), forces female eye/brow variants (§5.2), and shrinks generated height
(`MainTimeline.as:27839-27842`):
```as3
if(this.charGender[char] == 1)
{
   this.charHeight[char] -= this.Rnd(5,10);
}
```

### 3.2 `charHeel` — 0 Face, 1 Heel

```as3
// MainTimeline.as:131378
this.textAllegiance = new Array("Face","Heel");
```
Used for crowd reaction, promo tone, and booker bias. It is *also* baked into the face at
generation time — heels always get brow style 1 (`MainTimeline.as:28508-28515`):
```as3
if(this.charHeel[char] > 0)
{
   this.charBrows[char] = 1;
}
else
{
   this.charBrows[char] = this.Rnd(2,3);
}
```
Alignment is compared directly against a target allegiance when casting
(`MainTimeline.as:54556`):
```as3
if(this.charHeel[this.char] == allegiance && this.charRole[this.char] != 3)
```

### 3.3 `charLight` — 0–12 entrance lighting preset

```as3
// MainTimeline.as:132248
this.no_lights = 12;
// MainTimeline.as:131380
this.textLight = new Array("None","Pitch Black","Dark","Fast Disco","Smooth Disco",
   "Fast Murkiness","Smooth Murkiness","Red","Green","Blue","Pink","Yellow","Bright");
```

| id | Preset | id | Preset |
|---|---|---|---|
| 0 | None | 7 | Red |
| 1 | Pitch Black | 8 | Green |
| 2 | Dark | 9 | Blue |
| 3 | Fast Disco | 10 | Pink |
| 4 | Smooth Disco | 11 | Yellow |
| 5 | Fast Murkiness | 12 | Bright |
| 6 | Smooth Murkiness | | |

Editor: `BrowseOption(...,0,this.no_lights,1)` → 0–12, wraps. Applied when the character
makes an entrance (`MainTimeline.as:45939`):
```as3
this.lightSetting = this.charLight[this.char];
```

### 3.4 `charProp` — signature weapon

`0` = none. Otherwise it is an index into `weapName[]`, but only the range **4–20** is ever
generated for a character (`MainTimeline.as:28015-28019`):
```as3
this.charProp[char] = 0;
if(this.Rnd(0,10) == 0)
{
   this.charProp[char] = this.Rnd(4,this.no_weaptypes);
}
```
`no_weaptypes = 20` (`MainTimeline.as:132812`: `this.no_weaptypes = this.n;` after `this.n = 20;`).

| id | Weapon | id | Weapon | id | Weapon |
|---|---|---|---|---|---|
| 4 | Microphone | 10 | Plank | 16 | Dumbbell |
| 5 | Baseball Bat | 11 | Nightstick | 17 | Hammer |
| 6 | Chair | 12 | Trophy | 18 | Wooden Board |
| 7 | Bell | 13 | Brass Knucks | 19 | Cage Piece |
| 8 | Cane | 14 | Briefcase | 20 | Camera |
| 9 | Pipe | 15 | Broom | | |

(ids 1–3 exist in `weapName` for other systems but are never assigned to a character).
The prop is spawned into the character's hand at match start (`MainTimeline.as:31489-31491`):
```as3
if(this.charProp[this.char] > 0)
{
   newWeapon = int(this.charProp[this.char]);
```
and is quoted in promos (`MainTimeline.as:35205-35207`):
```as3
if(this.charProp[this.promoChar[1]] > 0)
{
   this.namer = this.weapName[this.charProp[this.promoChar[1]]].toLowerCase();
```

### 3.5 `charBuild` — body morph, 1–9

```as3
// MainTimeline.as:131403-131412
this.textBuild[1] = "Slim Female";
this.textBuild[2] = "Busty Female";
this.textBuild[3] = "Gaunt";
this.textBuild[4] = "Slim";
this.textBuild[5] = "Normal";
this.textBuild[6] = "Muscular";
this.textBuild[7] = "Chubby";
this.textBuild[8] = "Fat";
this.textBuild[9] = "Obese";
```
Build shifts over a career via `ChangeWeight(char, ±1)` (news events 45/46, §7.5).

---

## 4. `charRelationship[1..6]` — six character indices

**Values are character indices 1–300; 0 means "none".** Proven by the save format writing
`charRelationship[char][count]` and load reading `charName[charRelationship[...]]`
(`MainTimeline.as:128206`):
```as3
this.menuVariable[this.count + 1] = this.charName[this.charRelationship[this.char][this.count]];
if(this.charRelationship[this.char][this.count] == 0)
{
   this.menuVariable[this.count + 1] = "None";
}
```

The type of each slot is fixed by the editor's menu labels, which are laid out in the same
order as slots 1–6 (`MainTimeline.as:6665-6695`, rendered against `count + 1`):

| Slot | Editor label | Meaning |
|---|---|---|
| **1** | `Manager` | Their manager. Secondary corner-man source. |
| **2** | `Partner` | Tag-team partner. **Primary** corner-man source and the tag-title link. |
| **3** | `Story Friend` | In-kayfabe ally. |
| **4** | `Story Enemy` | In-kayfabe rival. |
| **5** | `Real Friend` | Genuine backstage friend. |
| **6** | `Real Enemy` | Genuine backstage enemy. |

That these are the *types* and not free-form is proven by the mutators, which compute the
slot arithmetically from a `real` flag (`MainTimeline.as:112627-112655`):
```as3
public function BecomeFriends(char:int, v:int, real:int) : void
{
   if(this.gamMode > 0)
   {
      this.charRelationship[char][3 + real * 2] = v;
      if(this.charRelationship[char][4 + real * 2] == v)
      {
         this.charRelationship[char][4 + real * 2] = 0;
      }
      this.charRelationship[v][3 + real * 2] = char;
      ...
public function BecomeEnemies(char:int, v:int, real:int) : void
{
   ... this.charRelationship[char][4 + real * 2] = v;
```
`real = 0` → slots 3/4 (story). `real = 1` → slots 5/6 (real). Friendship and enmity are
mutually exclusive per pair within each layer. `FormTeam` writes slot 2 both ways
(`MainTimeline.as:112617-112623`):
```as3
public function FormTeam(char:int, v:int) : void
{
   if(this.gamMode > 0)
   {
      this.ResetRelationship(char,v);
      this.charRelationship[char][2] = v;
      this.charRelationship[v][2] = char;
```
and `ResetRelationship` clears the pair from *every* slot in both directions
(`MainTimeline.as:112601-112616`) — relationships are strictly reciprocal.

Slot 2 is also auto-repaired to mirror the tag championships every week
(`MainTimeline.as:116631-116640`):
```as3
if(this.fedChamp[this.fed][3] != this.fedChamp[this.fed][4])
{
   if(this.char == this.fedChamp[this.fed][3] && this.charFed[this.fedChamp[this.fed][4]] == this.fed)
   {
      this.charRelationship[this.char][2] = this.fedChamp[this.fed][4];
   }
```
Relationships only persist for characters in the same promotion — cross-promotion links are
wiped (`MainTimeline.as:53955-53961`):
```as3
if(this.charRelationship[this.char][1] > 0 && this.charFed[this.char] != this.charFed[this.charRelationship[this.char][1]])
{
   this.charRelationship[this.char][1] = 0;
}
```


---

## 5. Move sets — what the ids index, and how they are derived

Every move field stores an **animation id** (`textMove[id]` gives its name). Ids are not
arbitrary: each is drawn from a per-slot library, and the library is what gives the slot its
meaning.

### 5.1 The five move arrays

| Field | Slots | Library | Semantic role |
|---|---|---|---|
| `charAttack[1..8]` | 8 | `libAttack[1..8]` | Stand-and-strike attacks, by situation |
| `charCrush[1..8]` | 8 | `libCrush[1..8]` | Downed-opponent attacks (stomps, subs, dives) |
| `charMove[1..20]` | 20 | `charMove[13..20]` re-rolled | Front/back/rope/ground repertoire |
| `charBackMove[1..7]` | 7 | copied from an idol | Responses when the opponent is behind you |
| `charGroundMove[1..2][1..3]` | 2×3 | `libGroundMove[1..2]` | Ground control, split upper body / legs |

### 5.2 `charAttack[1..8]` — eight named situations

The editor page 151 lists exactly eight rows, in array order
(`MainTimeline.as:6325-6376`), and page 151 renders `textMove[charAttack[char][count]]`
(`MainTimeline.as:128108-128111`):

| Slot | Editor label |
|---|---|
| 1 | Favoured Upper |
| 2 | Favoured Lower |
| 3 | Big Attack |
| 4 | Running Attack |
| 5 | Flying Attack |
| 6 | 2nd Rope Attack |
| 7 | Springboard Attack |
| 8 | Diving Attack |

Slot 1 and 2 are the bread-and-butter standing strikes and are the ones consulted in normal
exchanges (`MainTimeline.as:96558-96596`):
```as3
if(this.Rnd(0,2) == 0 && this.charAttack[char][1] > 0)
{
   attack = int(this.charAttack[char][1]);
...
if(this.Rnd(0,2) == 0 && this.charAttack[char][2] > 0)
{
   attack = int(this.charAttack[char][2]);
```
Slot 3 is the "big attack" and slot 4 the running attack, both gated on being non-zero
(`MainTimeline.as:11928-11945`):
```as3
if(this.charAttack[this.char][3] > 0)
...
if(this.charAttack[this.char][4] > 0)
```

### 5.3 `charCrush[1..8]` — eight downed-opponent situations

Page 152 has **seven** rows and indexes `charCrush[char][count + 1]`, i.e. slots 2–8
(`MainTimeline.as:128112-128115`):
```as3
if(this.screenPage == 152)
{
   this.menuVariable[this.count] = this.textMove[this.charCrush[this.char][this.count + 1]];
}
```

| Array slot | Editor row | Label |
|---|---|---|
| 2 | 1 | Stomp |
| 3 | 2 | Crush |
| 4 | 3 | Running Crush |
| 5 | 4 | Flying Crush |
| 6 | 5 | 2nd Rope Crush |
| 7 | 6 | Springboard Crush |
| 8 | 7 | Diving Crush |

`charCrush[1]` is **never shown in the editor and never generated independently** — the
library aliases it to slot 2 (`MainTimeline.as:134429-134430`):
```as3
this.libCrush[2] = new Array(0,1201,1202,1203,1204,1205);
this.libCrush[1] = this.libCrush[2];
```

### 5.4 `charMove[1..20]` — front / rope / high

Page 153 = "Front Basics", 8 rows, straight 1:1 with slots 1–8
(`MainTimeline.as:6425-6476`):

| Slot | Label | Slot | Label |
|---|---|---|---|
| 1 | Attack + Up | 5 | Run + Up |
| 2 | Attack + Centre | 6 | Run + Centre |
| 3 | Attack + Side | 7 | Run + Side |
| 4 | Attack + Down | 8 | Run + Down |

Page 154 = "Front Specials", 7 rows — but the mapping is **not sequential**
(`MainTimeline.as:128120-128137`):

| Editor row | Label | Array slot |
|---|---|---|
| 1 | Pick + Up | `charMove[9]` |
| 2 | Pick + Centre | `charMove[10]` |
| 3 | Pick + Side | `charMove[11]` |
| 4 | Pick + Down | `charMove[12]` |
| 5 | Momentum | `charMove[14]` |
| 6 | Running | `charMove[13]` |
| 7 | Special | `charMove[15]` |

```as3
if(this.count <= 4)
{
   this.menuVariable[this.count] = this.textMove[this.charMove[this.char][8 + this.count]];
}
if(this.count == 5) { this.menuVariable[this.count] = this.textMove[this.charMove[this.char][14]]; }
if(this.count == 6) { this.menuVariable[this.count] = this.textMove[this.charMove[this.char][13]]; }
if(this.count == 7) { this.menuVariable[this.count] = this.textMove[this.charMove[this.char][15]]; }
```

Page 156 = "High Moves", 5 rows, contiguous from 16 (`MainTimeline.as:128170-128173`):
```as3
if(this.screenPage == 156)
{
   this.menuVariable[this.count] = this.textMove[this.charMove[this.char][15 + this.count]];
}
```

| Slot | Label |
|---|---|
| 16 | Flying Move |
| 17 | Flying Counter |
| 18 | Front Drag |
| 19 | Rear Drag |
| 20 | Corner Move |

**`charMove[15]` is the finisher.** It is the move announced as the character's signature
(`MainTimeline.as:36054`), chosen when a special is triggered (`MainTimeline.as:67270-67272`):
```as3
if(this.pSpecial[cyc] > 0 && this.pAnim[cyc] != 203 && this.charMove[this.char][15] > 0)
{
   this.anim = this.charMove[this.char][15];
```
`charMove[13]` (Running) and `charMove[14]` (Momentum) are the other situational specials
(`MainTimeline.as:67244-67261`).

### 5.5 `charBackMove[1..7]` — when the opponent is behind you

Page 155 has 7 rows but maps **out of order** (`MainTimeline.as:128139-128168`):

| Editor row | Label | Array slot |
|---|---|---|
| 1 | Attack + Centre | `charBackMove[1]` |
| 2 | Attack + Direction | `charBackMove[5]` |
| 3 | Run + Centre | `charBackMove[2]` |
| 4 | Run + Direction | `charBackMove[6]` |
| 5 | Pick + Centre | `charBackMove[3]` |
| 6 | Pick + Direction | `charBackMove[7]` |
| 7 | Special | `charBackMove[4]` |

```as3
if(this.count == 1) { ...this.charBackMove[this.char][1]... }
if(this.count == 2) { ...this.charBackMove[this.char][5]... }
if(this.count == 3) { ...this.charBackMove[this.char][2]... }
if(this.count == 4) { ...this.charBackMove[this.char][6]... }
if(this.count == 5) { ...this.charBackMove[this.char][3]... }
if(this.count == 6) { ...this.charBackMove[this.char][7]... }
if(this.count == 7) { ...this.charBackMove[this.char][4]... }
```
So the slot numbering is grouped by *input* (attack / run / pick) with the "centre" move first
and the "directional" variant 4 slots later; slot 4 is the rear special.

### 5.6 `charGroundMove[1..2][1..3]` — ground control

`bodyPart 1` = upper body / head, `bodyPart 2` = legs. Page 157 renders both halves
(`MainTimeline.as:128174-128181`):
```as3
if(this.screenPage == 157 && this.count <= 3)
{
   this.menuVariable[this.count] = this.textMove[this.charGroundMove[this.char][1][this.count]];
}
if(this.screenPage == 157 && this.count >= 4)
{
   this.menuVariable[this.count] = this.textMove[this.charGroundMove[this.char][2][this.count - 3]];
}
```

| Slot | Label | Library source |
|---|---|---|
| `[1][1]` | Head Attack | `libGroundMove[1]` |
| `[1][2]` | Head Run | `libGroundMove[1]` |
| `[1][3]` | Head Pick | `libGroundMove[1]` |
| `[2][1]` | Leg Attack | `libGroundMove[2]` |
| `[2][2]` | Leg Run | `libGroundMove[2]` |
| `[2][3]` | Leg Pick | `libGroundMove[2]` |

Index `[bodyPart][0]` is a **fixed default**, not a player choice (`MainTimeline.as:28126`):
```as3
this.charGroundMove[char][bodyPart][0] = this.libGroundMove[bodyPart][1];
```

### 5.7 The libraries (verbatim, `MainTimeline.as:134297-134351, 134428-134436`)

```as3
this.libGroundMove[1] = new Array(0,414,412,413,415,416,417,418,419,421,422,423,424,425,814);
this.libGroundMove[2] = new Array(0,452,453,454,455,456,457,458,459,460,461,462,463,464,465,810);

this.libAttack[1][0] = 0;                       // then 1001..1023, plus 1051, 1052
this.libAttack[2] = new Array(0,1030,1031,1032,1033,1034,1035,1036,1037,1038,1039,1040,1041,1042,1043,1044,1045,1050);
this.libAttack[3] = new Array(0,1101,1102,1103,1105,1106,1107,1108,1109,1110,1111,1112,1113,1114,1115,1116,1117,1118,1119,1120,1121,1122);
this.libAttack[4] = this.libAttack[3];
this.libAttack[5] = new Array(0,1302,1303,1304,1305,1306,1307,1308,1309,1310,1321,1322,1350,1351,1352,1355);
this.libAttack[6] = this.libAttack[5];
this.libAttack[7] = this.libAttack[5];
this.libAttack[8] = new Array(0,1304,1305,1307,1311,1350,1351,1352,1354,1355,1356,1357,1358,1359);

this.libCrush[2]  = new Array(0,1201,1202,1203,1204,1205);
this.libCrush[1]  = this.libCrush[2];
this.libCrush[3]  = new Array(0,1210,1211,1212,1213,1214,1215,1216,1217,1218,1219,1220,1221,1222,1223);
this.libCrush[4]  = this.libCrush[3];
this.libCrush[5]  = new Array(0,1350,1351,1352,1353,1354,1355,1356,1357,1358,1359,1360,1361,1362,1363);
this.libCrush[6]  = this.libCrush[5];
this.libCrush[7]  = this.libCrush[5];
this.libCrush[8]  = new Array(0,1311,1350,1351,1352,1354,1355,1356,1357,1358,1359);
```
`libAttack[1]` is built in a loop, not literal (`MainTimeline.as:134335-134344`):
```as3
this.libAttack[1] = new Array();
this.libAttack[1][0] = 0;
this.count = 1;
while(this.count <= 23)
{
   this.libAttack[1][this.count] = 1000 + this.count;
   ++this.count;
}
this.libAttack[1][24] = 1051;
this.libAttack[1][25] = 1052;
```
Slot 1 therefore allows **1001–1023 plus 1051, 1052** (25 entries).

### 5.8 How a generated move set is actually derived — the "idol" copy chain

`GenerateMoves` never invents a move. It copies whole slots from a randomly chosen **idol**
and then, for the high slots only, re-copies each one from a *fresh* idol
(`MainTimeline.as:28075-28143`):

```as3
public function GenerateMoves(char:int, idolize:int) : void
{
   var bodyPart:int = 0;
   this.charMove[char] = new Array();
   do { this.idol = this.Rnd(1,this.no_chars); } while(this.idol == char);
   if(idolize > 0) { this.idol = idolize; }
   this.count = 1;
   while(this.count <= 20)
   {
      this.charMove[char][this.count] = this.charMove[this.idol][this.count];
      ++this.count;
   }
   if(idolize == 0)
   {
      for(this.count = 13; this.count <= 20; ++this.count)
      {
         do { this.idol = this.Rnd(1,this.no_chars); } while(this.idol == char);
         this.charMove[char][this.count] = this.charMove[this.idol][this.count];
      }
   }
   ...
```

Consequences to preserve if you reimplement:

1. `charMove[1..20]` initially all come from **one** wrestler — a generated character
   inherits an entire front/rope repertoire intact.
2. `charMove[13..20]` are then **overwritten one at a time from 8 different wrestlers**, so a
   generated wrestler ends up with 12 moves from wrestler A and 8 from wrestlers B..I. Because
   `charMove[13..15]` are Running/Momentum/**Finisher**, this is how finishers get mixed
   around.
3. `charBackMove[1..7]` are all copied from **one** idol (`28106-28121`).
4. `charGroundMove` is copied **per body part**, each from its own idol — so head work and
   leg work can come from different wrestlers (`28122-28142`).
5. `idolize > 0` forces a single idol for *everything* (used when a wrestler is cloned or
   when a trainee adopts a mentor's style).

`GenerateAttacks` uses the same idol trick but with a per-slot coin flip
(`MainTimeline.as:28026-28072`):
```as3
do { this.idol = this.Rnd(1,this.no_chars); } while(this.idol == char);
if(idolize > 0) { this.idol = idolize; }
this.charAttack[char][this.count] = this.charAttack[this.idol][this.count];
if(idolize == 0 && this.Rnd(0,1) == 0)
{
   this.charAttack[char][this.count] = this.RndArray(this.libAttack[this.count],1);
}
```
so each of the 8 attack slots is **50 % inherited from the idol, 50 % re-rolled from that
slot's library**. Same for crushes, except the crush idol is chosen **once** for all 8 slots
(`28046-28072`), while the attack idol is re-chosen per slot.

`RndArray` is inclusive of both ends (`MainTimeline.as:3632-3635`):
```as3
public function RndArray(array:Array, min:int) : *
{
   return array[this.Rnd(min,array.length - 1)];
}
```

### 5.9 Gimmick fields generated alongside the moves

`GenerateGimmick(char, 0)` sets stance/walk/taunt/theme/light/prop
(`MainTimeline.as:27985-28019`):
```as3
this.charStance[char] = this.Rnd(1,this.no_stances);          // no_stances = 10  (134124)
if(this.charGender[char] == 1)
{
   if(this.Rnd(0,1) == 0) { this.charStance[char] = 7; }      // female "diva" stance
}
else if(this.charStance[char] == 7 && this.Rnd(0,2) > 0)
{
   this.charStance[char] = 1;
}
if(this.charStance[char] >= 2 && this.charStance[char] <= 5 && this.Rnd(0,2) > 0)
{
   this.charStance[char] = 1;
}
this.charWalk[char] = 1;
this.charTaunt[char] = new Array();
this.count = 1;
while(this.count <= 4)
{
   this.charTaunt[char][this.count] = this.Rnd(0,this.tauntStandard.length - 1);
   ++this.count;
}
this.charTheme[char] = this.Rnd(1,this.no_themes);
this.charLight[char] = this.Rnd(0,this.no_lights);
if(this.Rnd(0,1) == 0) { this.charLight[char] = 4; }
```
`charWalk` is always 1 for a generated character — walk style is a hand-authored field only.
`charTaunt[1..4]` index the 94-entry `tauntStandard` table (`MainTimeline.as:134126`, populated
at `57024`, indices 0–93), which
is resolved to an animation when the taunt fires (`MainTimeline.as:59164`):
```as3
this.pTauntAnim[cyc] = this.tauntStandard[this.charTaunt[char][this.anim]];
```


---

## 6. `GenerateCharacter()` — the full algorithm

`MainTimeline.as:27760-27894`. This is the only character factory; it is called for new
signings (`AddEvent` 27 → `119231`) and for a wholesale roster rebuild (`54312`).

### 6.0 The random primitive (get this exactly right)

Every roll in the game goes through `Rnd` (`MainTimeline.as:3311-3315`):

```as3
public function Rnd(min:int, max:int) : int
{
   var returner:int = Math.round(Math.random() * (max - min));
   return int(returner + min);
}
```

It is **round, not floor**, so both endpoints get *half* the weight of the interior:

- `P(min) = P(max) = 0.5 / (max - min)`
- `P(any interior value) = 1 / (max - min)`
- `Rnd(n, n)` always returns `n`.

For `Rnd(0,1)` this is a clean coin flip (0.5 / 0.5). For `Rnd(0,10)` the value 0 has
probability 0.05, and that is used as the "1 in 20" gate throughout. A faithful port that
uses `floor(random * (max-min+1))` instead will shift every distribution in the game — do not
"fix" it.

### 6.1 Order of operations

```as3
// MainTimeline.as:27760
public function GenerateCharacter(char:int) : void
{
   if(this.Rnd(0,10) == 0)  { this.charGender[char] = 1; }      // 5% female
   else                     { this.charGender[char] = 0; }
   this.charName[char] = this.GenerateName(char);
   this.charTeamName[char] = "Team " + this.ShortName(this.charName[char],1);
   if(this.Rnd(0,1) == 0)   { this.charAge[char] = this.Rnd(21,45); }   // 50%
   else                     { this.charAge[char] = this.Rnd(16,60); }
   this.charRole[char] = 1;
   this.charHeel[char] = this.Rnd(0,1);
   ... allocate charLimb/charR/charG/charB/charFlesh/charPads/charBaggy for coz 1..3 ...
   this.GenerateFace(char);
   this.GenerateHairStyle(char);
   this.GenerateHairColour(char);
   this.GenerateBeard(char);
   this.coz = 1;
   while(this.coz <= 3) { this.GenerateCostume(char,this.coz); ++this.coz; }
   this.WearReferee(char,3);
```

### 6.2 Name

`GenerateName` (`MainTimeline.as:4408-4425`):

```as3
this.randy = this.Rnd(0,3);
if(this.randy == 0)
{
   namer = this.textNickName[this.Rnd(0,this.textNickName.length - 1)];
}
if(this.randy > 0 && this.charGender[char] == 0)
{
   namer = this.textFirstName[...] + " " + this.textSurname[...];
}
if(this.randy > 0 && this.charGender[char] == 1)
{
   namer = this.textFemaleName[...] + " " + this.textSurname[...];
}
```
`Rnd(0,3)` → 25 % nickname, 75 % "First Surname" (gendered first-name list). The team name
takes the **last** word of the name (`MainTimeline.as:4398-4406`):
```as3
public function ShortName(namer:String, detail:int) : String
{
   var words:Array = namer.split(" ");
   if(detail > 0) { return words[words.length - 1]; }
   return words[0];
}
```

### 6.3 Age

50 / 50 between **21–45** (established worker) and **16–60** (full spread). No age is ever
generated below 16.

### 6.4 Build

```as3
// 27810-27818
this.charBuild[char] = this.Rnd(3,this.no_builds);   // 3..9
if(this.Rnd(0,1) == 0) { this.charBuild[char] = 5; } // 50% "Normal"
if(this.charGender[char] == 1) { this.charBuild[char] = this.Rnd(1,2); }
```
Males: 50 % Normal (5), otherwise uniform-ish over Gaunt..Obese (3–9). Females: always
1 (Slim Female) or 2 (Busty Female) — the female override runs last, so it wins.

### 6.5 Height — the "idol" inheritance

```as3
// 27819-27864
this.idol = 0;
if(this.Rnd(0,1) == 0)                       // 50%: inherit a same-gender idol's height
{
   do { this.idol = this.Rnd(1,this.no_chars); }
   while(this.charGender[this.idol] != this.charGender[char] || char == this.idol);
}
if(this.idol > 0)
{
   this.charHeight[char] = this.charHeight[this.idol];
}
else
{
   this.charHeight[char] = this.Rnd(95,105);
   if(this.charAge[char] < 18)
   {
      this.charHeight[char] = this.Rnd(70,80) + this.charAge[char];   // teens still growing
   }
   if(this.charGender[char] == 1)
   {
      this.charHeight[char] -= this.Rnd(5,10);
   }
   this.randy = this.Rnd(0,10);
   if(this.randy <= 2) { this.charHeight[char] += this.Rnd(-5,5); }
   if(this.randy == 3 && this.charGender[char] == 0) { this.charHeight[char] += this.Rnd(-5,10); }
   if(this.randy == 4) { this.charHeight[char] = this.Rnd(86,110); }
   if(this.charHeight[char] < 86)  { this.charHeight[char] = 86; }
   if(this.charHeight[char] > 110) { this.charHeight[char] = 110; }
}
```

Notes for a rebuild:
- The **clamp only applies to the non-idol branch**. Half of all characters inherit a height
  verbatim from another character, so the true data range is whatever is in the roster file.
- The teen formula `Rnd(70,80) + age` yields 86–97 for ages 16–17, i.e. teens are short but
  never below the clamp.
- The do/while will spin forever if no same-gender character exists (impossible at 300 with
  ~5 % female, but guard it in a port).

### 6.6 Stats

`GenerateStats` (`MainTimeline.as:27896-27939`), called at `27865`:

```as3
this.charStat[char] = new Array();
this.charOldStat[char] = new Array();
this.charNewStat[char] = new Array();
for(this.count = 1; this.count <= 8; ++this.count)
{
   this.charStat[char][this.count] = this.Rnd(10,19);

   if(this.charFed[char] == 7)                          // fed 7 = the wrestling school
   {
      if(this.count == 1)                          { this.charStat[char][this.count] = this.Rnd(10,14); }
      if(this.count >= 2 && this.count <= 6)       { this.charStat[char][this.count] = this.Rnd(10,16); }
      if(this.count == 8)                          { this.charStat[char][this.count] = this.Rnd(10,17); }
   }
   else
   {
      if(this.count == 1)                          { this.charStat[char][this.count] = this.Rnd(12,19); }
      if(this.count >= 2 && this.count <= 6 && this.charStat[char][this.count] <= 13)
      {
         this.charStat[char][this.count] = this.Rnd(this.charStat[char][this.count],16);
      }
   }

   this.charStat[char][this.count] *= 5;

   if(this.Rnd(0,2) == 0 && this.count >= 2 && this.count <= 8)   // 1/3: copy a peer's stat
   {
      this.charStat[char][this.count] = this.charStat[this.Rnd(1,this.no_chars)][this.count];
   }
}
this.charPeaked[char] = 0;
this.ResetOldStats(char);
this.ResetNewStats(char);
```

Resulting distribution (16..19 → 80..95 before the copy):

| Stat | Non-school range | School (fed 7) range |
|---|---|---|
| 1 Popularity | `Rnd(12,19)*5` = 60–95 | 50–70 |
| 2–6 Physical | 50–95, but any roll ≤ 13 is re-rolled upward into `[roll,16]`, so the distribution is **skewed high** while the floor stays 50 | 50–80 |
| 7 Attitude | 50–95 (no special case) | 50–95 |
| 8 Happiness | 50–95 | 50–85 |

So a newly generated wrestler averages noticeably above 72 in every physical stat
(the `Rnd(roll,16)` lift removes most of the 50–65 mass), is 60–95 in popularity, and 50–95
in attitude/happiness — before the 1-in-3 peer copy, which can overwrite any stat 2–8 with
whatever a random existing character has (50–99).

**Measured** (40,000 simulated generations, non-school, copying from the shipped 300-man
roster): stat1 60–95 mean 77.6 · stats 2–6 50–95 mean 75.4–76.3 · stat7 50–95 mean 73.5 ·
stat8 50–95 mean 73.9. The `Rnd(0,10)`/`Rnd(0,1)` distributions were verified separately at
exactly 5 %/10 %/5 % and 49.9 %/50.1 %.

⚠️ **Ordering bug worth preserving or deliberately fixing:** `GenerateStats` is called at
`27865`, but `charHealth` is not initialised until `27887`, so `ResetOldStats` (called inside
`GenerateStats`) snapshots an undefined `charHealth`/`charSalary`/`charContract`. The values
are re-established later in the same function, so nothing breaks in play — but a straight port
must not treat `charOldHealth` as meaningful for a freshly generated character.

### 6.7 Everything else

```as3
// 27866-27892
this.GenerateGimmick(char,0);        // stance/walk/taunt/theme/light/prop — see §5.9
this.GenerateAttacks(char,0);        // see §5.8
this.GenerateMoves(char,0);          // see §5.8
this.charContract[char] = 0;
this.charSalary[char] = 0;
this.charClause[char] = new Array();
this.count = 1;
while(this.count <= 3) { this.charClause[char][this.count] = 0; ++this.count; }
this.charWorth[char] = this.CalculateWorth(char);
if(this.charFed[char] > 0) { this.GenerateContract(char); }
this.charVacant[char] = 0;
this.charOldVacant[char] = 0;
this.charInjured[char] = 0;
this.charOldInjured[char] = 0;
this.charHealth[char] = 100;
this.charOldHealth[char] = this.charHealth[char];
this.charTraining[char] = 0;
this.charArrived[char] = 1;
this.charWorked[char] = 0;
this.GenerateRelationships(char);
```

`GenerateRelationships` (`MainTimeline.as:27941-27964`) is promotion-aware:

```as3
f = this.charFed[char];
this.charRelationship[char] = new Array();
for(this.count = 1; this.count <= 6; ++this.count)
{
   this.charRelationship[char][this.count] = 0;
   if(f > 0)
   {
      if(this.count <= 2 && this.Rnd(0,10) == 0)      // 5% manager / 5% partner, from own fed
      {
         this.charRelationship[char][this.count] = this.fedRoster[f][this.Rnd(1,this.fedSize[f])];
      }
      if(this.count >= 3 && this.count <= 4 && this.Rnd(0,2) == 0)   // 33% story friend/enemy
      {
         this.charRelationship[char][this.count] = this.fedRoster[f][this.Rnd(1,this.fedSize[f])];
      }
   }
   if(this.count >= 5 && this.Rnd(0,2) == 0)          // 33% real friend/enemy, ANY character
   {
      this.charRelationship[char][this.count] = this.Rnd(1,this.no_chars);
   }
}
```
Slots 1–4 never leave the promotion; slots 5–6 are global. Nothing prevents self-reference
or the same person occupying two slots — the reciprocal-invariant is only enforced by the
`BecomeFriends`/`FormTeam` mutators, not by generation.

### 6.8 Appearance generators (summary)

| Field | Rule | Line |
|---|---|---|
| `charFace` (limb 3) | `Rnd(1,no_faces)`, rejected unless `GenderCompatible` and not `MaskedFace` (75 % of the time a masked face is rejected) | 28492-28498 |
| face tint | 50 %: RGB ≈ `RndDec(0.9,1.1)` with ±0.1 channels | 28502-28507 |
| `charBrows` | heel → 1; face → `Rnd(2,3)` | 28508-28515 |
| `charEyes` | `Rnd(1,no_eyes)`; female 50 % → 10 | 28516-28522 |
| `charHairStyle` | 33 % copy a same-gender idol's hair; else `Rnd(1,no_hairstyles)`, 1-in-11 bald (0); length 0 for style 16/17/20 | 28249-28290 |
| `charHairColour` | `GenerateHairColour` — derives from the face/limb-18 colour with a shade multiplier | 28348 |
| `charBeard` | **males only**: 25 % → `Rnd(1,no_beards)`; if still 0, another 25 % → alpha beard 1..`no_alpha_beards` | 28455-28464 |
| beard colour | hair colour × 0.5 (light hair) or × 0.9 | 28466-28476 |
| `WearReferee(char,3)` | outfit 3 is always overwritten with the referee kit at generation | 27809 |


---

## 7. Stats and progression

### 7.1 The three parallel stat arrays

| Array | Role |
|---|---|
| `charStat[char][1..8]` | The **live, committed** value. This is what matches, the UI and `StatAverage` read. |
| `charOldStat[char][1..8]` | Snapshot taken at the **start** of the weekly tick. Used to answer "did this stat move this week?" and, for peaked characters, to nail physical stats to last week's value. |
| `charNewStat[char][1..8]` | The **pending** value. All weekly events write here; the news screen animates `charStat` toward it, and `UnreportEvent` commits it instantly. |

Same pattern for `charHealth` / `charOldHealth` / `charNewHealth` and for salary/contract.

The commit path is `PursueInt` during the news animation (`MainTimeline.as:120860-120875`):
```as3
for(this.count = 1; this.count <= 8; ++this.count)
{
   if(this.eStatFoc == this.count)
   {
      if(this.charStat[this.char][this.count] == this.charNewStat[this.char][this.count])
      {
         if(this.eStatChange[this.eStatFoc] == 0) { this.eStatFoc += 1; }
      }
      else
      {
         this.charStat[this.char][this.count] = this.PursueInt(this.charStat[this.char][this.count],this.charNewStat[this.char][this.count],10,1);
         this.eStatChange[this.eStatFoc] = 5;
      }
   }
```
and the instant path is `UnreportEvent` (`MainTimeline.as:120790-120805`):
```as3
public function UnreportEvent(char:int) : void
{
   if(this.no_events > 1)
   {
      --this.no_events;
      this.count = 1;
      while(this.count <= 8)
      {
         this.charStat[char][this.count] = this.charNewStat[char][this.count];
         ++this.count;
      }
      this.charHealth[char] = this.charNewHealth[char];
```

### 7.2 Snapshot and clamp helpers

`ResetOldStats` (`MainTimeline.as:120962-120973`):
```as3
public function ResetOldStats(char:int) : void
{
   this.count = 1;
   while(this.count <= 8)
   {
      this.charOldStat[char][this.count] = this.charStat[char][this.count];
      ++this.count;
   }
   this.charOldHealth[char] = this.charHealth[char];
   this.charOldSalary[char] = this.charSalary[char];
   this.charOldContract[char] = this.charContract[char];
}
```
`ResetNewStats` (`120975-120986`) is the identical copy from `charStat` into `charNewStat` —
it **discards** any pending change, so it is only ever called at the end of a fully-resolved
tick, or right after generation.

`CheckStatLimits` (`120988-121025`) is the single clamp for the whole game:
```as3
if(this.charStat[char][this.count] < 50) { this.charStat[char][this.count] = 50; }
if(this.charStat[char][this.count] > 99) { this.charStat[char][this.count] = 99; }
if(this.charNewStat[char][this.count] < 50) { this.charNewStat[char][this.count] = 50; }
if(this.charNewStat[char][this.count] > 99) { this.charNewStat[char][this.count] = 99; }
...
if(this.charHealth[char] < 0)    { this.charHealth[char] = 0; }
if(this.charHealth[char] > 100)  { this.charHealth[char] = 100; }
if(this.charNewHealth[char] < 0) { this.charNewHealth[char] = 0; }
if(this.charNewHealth[char] > 100) { this.charNewHealth[char] = 100; }
```
So **every stat is permanently bounded to 50–99 and health to 0–100.** There is no "0
strength" character in this game; 50 is the floor.

### 7.3 The weekly tick, in order

`AdvanceDate()` (`MainTimeline.as:116496`) advances one week; 48 weeks = 1 year
(`116499-116505`):
```as3
this.gamDate += 1;
if(this.gamDate > 48)
{
   this.gamDate = 1;
   this.gamYear += 1;
   this.ResetSchedule(this.gamDate);
}
```
Then, for each character on each roster (`116570-116723`), in this exact order:

1. `ResetOldStats(char)` — snapshot (`116574`).
2. `charOldInjured = charInjured`; decrement `charInjuryTime`; clear injury at 0 (`116575-116583`).
3. `charOldHealth = charHealth` (`116584`).
4. Health: if injured → 0, else `+= stamina * (0.5..1.0)` (`116585-116593`).
5. Vacancy countdown, contract countdown, relationships repair (`116598-116645`).
6. Booker popularity/happiness pulled toward `fedPop` (`116646-116663`).
7. Random ±1 drift and the peak freeze (`116665-116693`).
8. Training (`116695-116715`).
9. `CheckStatLimits(char)` then `ResetNewStats(char)` (`116716-116717`).

Step 4, verbatim (`116585-116593`):
```as3
if(this.charInjured[this.char] > 0)
{
   this.charHealth[this.char] = 0;
}
else
{
   this.factor = 0.5 + Math.random() / 2;
   this.charHealth[this.char] += this.charStat[this.char][5] * this.factor;
}
```
A healthy wrestler at 60 stamina recovers 30–60 health per week, so a beaten-up wrestler is
fully fit again in 1–3 weeks. Injury sets health to 0 and keeps it there until `charInjuryTime`
runs out.

Step 7, verbatim (`116665-116693`):
```as3
if(this.gamMode == 1 && this.char != this.gamChar && this.char != this.gamOpponent[this.gamDate]
   || this.gamMode == 2 && this.fed != this.charFed[this.gamChar])
{
   if(this.Rnd(0,1) == 0 && this.charHealth[this.char] > 0 && this.fed != 8)
   {
      this.charHealth[this.char] = this.Rnd(0,this.charStat[this.char][5]);
      if(this.gamMode == 1 && this.char == this.charRelationship[this.gamChar][2])
      {
         this.charHealth[this.char] = this.Rnd(this.charStat[this.char][5] / 2,this.charStat[this.char][5]);
      }
      if(this.Rnd(0,1000) == 0 && this.charInjured[this.char] == 0)
      {
         this.charInjured[this.char] = this.Rnd(1,4);
         this.charInjuryTime[this.char] = this.Rnd(1,4);
      }
      for(this.count = 1; this.count <= 8; ++this.count)
      {
         if(this.Rnd(0,1) == 0)
         {
            this.charStat[this.char][this.count] += this.Rnd(-1,1);
         }
         if(this.charPeaked[this.char] > 0 && this.count >= 2 && this.count <= 6)
         {
            if(this.charStat[this.char][this.count] > this.charOldStat[this.char][this.count])
            {
               this.charStat[this.char][this.count] = this.charOldStat[this.char][this.count];
            }
         }
      }
   }
}
```
Read carefully: for **off-screen** characters (not the player, not this week's opponent — or,
in booking mode, anyone outside your promotion) there is a 50 % chance per week of a full
"simulation pulse" that resets health to `Rnd(0, stamina)` and nudges **all eight stats by
−1/0/+1**. This is the engine that makes the rest of the world drift while you're not looking,
and it is why unplayed rosters still change over time.

### 7.4 `PursueStat` — the growth curve

`MainTimeline.as:121059-121115`. Given a current value target, it returns a *step*, scaled by
how far away the value is:

```as3
if(current < target)            { increment = 1; }
if(current > target)            { increment = -1; }
if(current < target - 10)       { increment = this.Rnd(2,4); }
if(current > target + 10)       { increment = -this.Rnd(2,4); }
if(current < target - 20)       { increment = this.Rnd(3,6); }
if(current > target + 20)       { increment = -this.Rnd(3,6); }
if(current < target - 30)       { increment = this.Rnd(4,8); }
if(current > target + 30)       { increment = -this.Rnd(4,8); }
if(current < target - 40)       { increment = this.Rnd(5,10); }
if(current > target + 40)       { increment = -this.Rnd(5,10); }
if(limit > 0)
{
   if(increment > limit)  { increment = limit; }
   if(increment < -limit) { increment = -limit; }
}
return increment;
```
Cumulative table (target = 99 for growth, 50 for decline):

| Distance from target | Step |
|---|---|
| < 10 | ±1 |
| 10–19 | ±2–4 |
| 20–29 | ±3–6 |
| 30–39 | ±4–8 |
| ≥ 40 | ±5–10 |

Verified by simulation: `pursueStat(50, 99, 0)` returns exactly 5–10, `(98,99,0)` returns 1,
`(99,99,0)` returns 0, and `(99,50,0)` returns −5..−10.

This is why a 50-rated rookie can jump 5–10 points in a good week, while a 95-rated veteran
crawls +1.

### 7.5 The weekly drift events

These fire inside the per-character loop (`MainTimeline.as:117212-117231`) and are the main
non-training source of stat change:

```as3
if(this.charFed[this.char] == this.charFed[this.gamChar] && this.charInjured[this.char] == 0)
{
   this.chance = (110 - this.charStat[this.char][7]) * 50;      // attitude 50..99 -> 550..3000
   this.randy = Math.round(Math.random() * this.chance);
   if(this.randy == 1 || this.randy >= 2 && this.randy <= 6 && this.charPeaked[this.char] == 0
      || this.randy >= 7 && this.randy <= 8 && this.char != this.gamChar)
   {
      if(this.charStat[this.char][this.randy] < 90)
      {
         this.AddEvent(this.char,46 + this.randy);
      }
   }
   this.chance = this.charStat[this.char][7] * 20;              // attitude 50..99 -> 1000..1980
   this.randy = Math.round(Math.random() * this.chance);
   if(this.randy >= 1 && this.randy <= 6 || this.randy >= 7 && this.randy <= 8 && this.char != this.gamChar)
   {
      if(this.charStat[this.char][this.randy] > 60)
      {
         this.AddEvent(this.char,54 + this.randy);
      }
   }
}
```

Decoding that: the rolled index **is the stat number**.

- **Improvement** (`event 46 + n` → stat n): fires for `randy == 1` (popularity, always), or
  `randy` 2–6 **only if not peaked**, or 7–8 only for other people. Gated on the stat being
  `< 90`. Note `randy` is produced by `Math.round`, so 0 and the top of the range are half-weight
  and — importantly — `randy` can be **0**, which would index stat 0; the conditions
  `randy == 1` / `>= 2` carefully exclude 0. A port must keep that exclusion.
- **Decline** (`event 54 + n` → stat n): fires for `randy` 1–6 (anyone) or 7–8 (others only),
  gated on the stat being `> 60`. **Decline is never blocked by peaking.**

Both are applied through `PursueStat` (`MainTimeline.as:119380-119422`):
```as3
if(newsEvent >= 47 && newsEvent <= 54)
{
   this.charNewStat[char][newsEvent - 46] += this.PursueStat(this.charStat[char][newsEvent - 46],99,0);
...
if(newsEvent >= 55 && newsEvent <= 62)
{
   this.charNewStat[char][newsEvent - 54] += this.PursueStat(this.charStat[char][newsEvent - 54],50,0);
```
with flavour headlines per stat ("The Next Big Thing" for popularity, "Getting Stronger" for
strength, "Skills To Pay The Bills", "Fancy Footwork", "Going The Distance", "Tough Enough",
"Model Employee", "The Pursuit Of Happiness") and the mirrored negatives ("Old News",
"Power Cut", "Out Of Touch", "Slow Motion", "Out Of Breath", "Glass Jaw", "Problem Child",
"The Great Depression").

Two more progression levers live in the same block:
- **Body recomposition** — events 45/46 call `ChangeWeight` and move Strength vs
  Agility/Stamina in opposite directions by `Rnd(1,5)` (`119356-119378`).
- **Popularity ceiling** — after a match, popularity is capped at the promotion's own
  popularity +5 (`MainTimeline.as:118187-118196`):
  ```as3
  if(this.charNewStat[this.char][1] >= this.fedPop[this.charFed[this.char]] + 5)
  {
     this.charNewStat[this.char][1] = this.fedPop[this.charFed[this.char]] + 5;
     if(this.charOldStat[this.char][1] > this.fedPop[this.charFed[this.char]] + 5)
     {
        this.charNewStat[this.char][1] = this.charOldStat[this.char][1];
     }
  ```
  You cannot outgrow your promotion: in a fed with `fedPop` 75, nobody can exceed 80
  popularity. Moving to a bigger promotion is the only way up. `fedPop` itself defaults to
  `Rnd(50,100)` per promotion (`MainTimeline.as:133761`), so the five-point headroom is
  proportional to the promotion's own standing.

Match results themselves only move **popularity and happiness**, via `WinEffects`
(`MainTimeline.as:121267-121293`):
```as3
if(win > 0)
{
   if(this.charNewStat[char][1] < this.charOldStat[char][1]) { this.charNewStat[char][1] = this.charOldStat[char][1]; }
   if(this.charNewStat[char][8] < this.charOldStat[char][8]) { this.charNewStat[char][8] = this.charOldStat[char][8]; }
}
else
{
   if(this.charNewStat[char][1] > this.charOldStat[char][1]) { this.charNewStat[char][1] = this.charOldStat[char][1]; }
   if(this.charNewStat[char][8] > this.charOldStat[char][8]) { this.charNewStat[char][8] = this.charOldStat[char][8]; }
}
this.charNewStat[char][1] += this.Rnd(0,win);
this.charNewStat[char][8] += this.Rnd(0,win);
```
i.e. "a win cancels this week's losses in pop/happiness then adds 0-or-1; a loss cancels this
week's gains then adds 0-or-−1". **Matches never change Strength/Skill/Agility/Stamina/
Toughness.** Those move only through training and the drift events above.

### 7.6 Training

**Assignment.** In booking mode, clicking a physical stat row on the roster profile toggles
that stat as the trainee's programme (`MainTimeline.as:123418-123432`):
```as3
for(this.count = 2; this.count <= 6; ++this.count)
{
   ...
   if(this.charTraining[this.char] == this.count)
   {
      this.charTraining[this.char] = 0;
   }
   else
   {
      this.charTraining[this.char] = this.count;
   }
```
So `charTraining` is **0 = none, or 2–6** = the stat index being trained. Only the five
physical stats are trainable; popularity, attitude and happiness are not.

**Weekly effect** (`MainTimeline.as:116695-116715`):
```as3
if(this.charVacant[this.char] > 0 || this.charInjured[this.char] > 0 || this.fed != this.charFed[this.gamChar])
{
   this.charTraining[this.char] = 0;
}
if(this.gamMode == 2 && this.charTraining[this.char] > 0 && this.charHealth[this.char] > 50)
{
   this.charHealth[this.char] = 50;
   if(this.charPeaked[this.char] == 0)
   {
      for(this.count = 2; this.count <= 6; ++this.count)
      {
         if(this.charTraining[this.char] == this.count)
         {
            this.charStat[this.char][this.count] += 1;
            this.TrainingSideEffects(this.char,this.count);
            this.charStat[this.char][7] += this.Rnd(-1,1);
            this.charStat[this.char][8] += this.Rnd(-1,1);
         }
      }
   }
}
```
Costs and conditions, exactly:
- Training is cancelled if the wrestler is vacant, injured, or in another promotion.
- Requires **health > 50**; the session then **sets health to exactly 50**.
- Gives **+1 to the trained stat**, **only if not peaked**.
- Always applies the side-effect penalty and ±1 to Attitude and Happiness.

**Side effects** (`MainTimeline.as:41336-41393`) — training one stat costs another:

| Trained stat | Penalties (each 50 % chance of −0..1) |
|---|---|
| 2 Strength | −Agility, −Stamina |
| 3 Skill | −Strength, −Toughness |
| 4 Agility | −Strength, −Toughness |
| 5 Stamina | −Strength, −Happiness |
| 6 Toughness | −Skill, −Agility |

```as3
if(stat == 2)
{
   if(this.Rnd(0,1) == 0) { this.charStat[char][4] -= this.Rnd(0,1); }
   if(this.Rnd(0,1) == 0) { this.charStat[char][5] -= this.Rnd(0,1); }
}
if(stat == 3)
{
   if(this.Rnd(0,1) == 0) { this.charStat[char][2] -= this.Rnd(0,1); }
   if(this.Rnd(0,1) == 0) { this.charStat[char][6] -= this.Rnd(0,1); }
}
...
```
Because `Rnd(0,1)` is 0 half the time, a "penalty" is often zero. Training is roughly
+1/−0.5 net, gated behind a week of half health — which is why training and working house
shows compete for the same resource.

**Interactive training** (`TrainingEffects`, `MainTimeline.as:41296-41334`) is the same
mechanic played as a mini-game. It subtracts 25 health and scales the reward by how well you
did (`trainProgress`):
```as3
this.charHealth[char] -= 25;
...
if(this.charPeaked[char] == 0)
{
   if(this.trainProgress >= 1125) { this.charStat[char][this.screenPage] += this.Rnd(0,1); }
   if(this.trainProgress >= 2250) { this.charStat[char][this.screenPage] += this.Rnd(0,2); }
   if(this.trainProgress >= 3375) { this.charStat[char][this.screenPage] += this.Rnd(0,3); }
}
if(this.charStat[char][this.screenPage] > this.trainOldStat)
{
   this.TrainingSideEffects(char,this.screenPage);
   this.charStat[char][7] += this.Rnd(0,1);
   this.charStat[char][8] += this.Rnd(-1,1);
}
else
{
   this.charStat[char][7] -= this.Rnd(0,1);
   this.charStat[char][8] -= this.Rnd(0,1);
}
this.CheckStatLimits(char);
```
Note the thresholds are **cumulative** — a perfect 3375-point session grants all three
increments (+Rnd(0,1), +Rnd(0,2), +Rnd(0,3)), i.e. up to +6 in one session, and only pays the
side effects once.

### 7.7 Ageing and the peak

**Age is not stored incrementally.** `charAge` is the age at career start and never changes;
live age is derived (`MainTimeline.as:8988-8995`):
```as3
public function CareerAge(char:int) : int
{
   if(this.gamMode > 0)
   {
      return this.charAge[char] + (this.gamYear - this.gamStartYear);
   }
   return this.charAge[char];
}
```
`gamYear` starts at the real-world year (`8395-8396`) or 2014 in the default config
(`131677-131678`) and increments every 48 weeks (§7.3).

**The peak event.** Every week, per character (`MainTimeline.as:117151-117160`):
```as3
this.chance = (100 - age) * (100 - age);
if(this.char == this.gamChar || this.gamMode == 2 && this.fed == this.charFed[this.gamChar])
{
   this.chance /= 2;
}
this.randy = int(Math.random() * this.chance);
if(this.randy == 0 && age >= 40)
{
   this.AddEvent(this.char,40);
}
```
So the chance per week is `1 / (100 − age)²` — about 1 in 3600 at 40, 1 in 2500 at 50, 1 in
900 at 70 — and is impossible before 40. The event itself (`MainTimeline.as:119321-119327`):
```as3
if(newsEvent == 40)
{
   this.eHeadline[this.no_events] = "Over The Hill";
   this.eText[this.no_events] = "At the age of " + age + ", " + this.charName[char] + " has reached " + this.His[this.g].toLowerCase() + " physical peak and is as good as " + this.He[this.g].toLowerCase() + " will ever be.";
   this.charPeaked[char] = age;
   this.charNewStat[char][8] = this.charNewStat[char][8] - 1;
}
```
`charPeaked` is therefore **0 (not peaked) or the age at which the peak was declared (≥ 40)**.

**What peaking does** — three separate locks:
1. Physical stats can no longer be **raised** by the weekly drift event (`117216`, gated on
   `charPeaked == 0`).
2. Physical stats can no longer be **trained** (`116702`).
3. Random weekly drift that would push a physical stat up is **reverted to last week's value**
   (`116685-116691`).

What it does **not** do: it never forces stats down. Decline still comes from events 55–62,
which remain available, so a peaked wrestler slowly erodes rather than cliff-edging. Popularity
(stat 1), Attitude (7) and Happiness (8) are entirely unaffected by peaking.

### 7.8 Complete cap table

| Quantity | Floor | Ceiling | Enforced by |
|---|---|---|---|
| `charStat[1..8]` | 50 | 99 | `CheckStatLimits` (`120992-120998`) |
| `charNewStat[1..8]` | 50 | 99 | `CheckStatLimits` (`121000-121006`) |
| `charStat[1]` (popularity) | 50 | `fedPop + 5` | match news (`118187`) |
| `charHealth` / `charNewHealth` | 0 | 100 | `CheckStatLimits` (`121009-121024`) |
| `charStat[2..6]` after peak | — | last week's value | peak freeze (`116685`) |
| `charHeight` (generated, non-idol) | 86 | 110 | `27856-27863` |
| `charStat[2..6]` at creation | — | budget 350 total | editor (`127650-127665`) |


---

## 8. Health and the injury model

### 8.1 The three fields

| Field | Type | Meaning |
|---|---|---|
| `charHealth` | int 0–100 | Condition. Scales match starting health; gates training and booking. |
| `charInjured` | int 0–10 | **0 = fit.** Non-zero = a body-part code, not a severity. |
| `charInjuryTime` | int | Weeks of recovery remaining. |

### 8.2 Health

- Starts at 100 for every generated character (`MainTimeline.as:27887`).
- Clamped 0–100 by `CheckStatLimits` (§7.2).
- **Regenerates weekly** by `stamina × Random(0.5,1.0)` while uninjured (`116589-116593`).
- **Zeroed weekly while injured** (`116585-116588`), so an injured wrestler is also at 0 %
  condition and cannot be booked.
- Off-screen characters get a random reset instead: `charHealth = Rnd(0, stamina)` (`116669`).
- Directly sets match starting health (`MainTimeline.as:55398`):
  ```as3
  this.pHealth[cyc] = int(this.pHealth[cyc] * (this.charHealth[this.char] / 100));
  ```
  A wrestler at 50 health starts the match at half HP — this is the entire point of the field.

Injury also cancels training (`116697`) and disqualifies the wrestler from booking
(`MainTimeline.as:9513`):
```as3
if(this.Rnd(0,2) <= 1 && this.charHealth[v] < 50 || this.charInjured[v] > 0 || this.charVacant[v] > 0)
{
   this.satisfied = 0;
}
```
(and again at `9524`, plus a booking-mode variant at `9531-9538`).

### 8.3 How an injury is inflicted in a match

`RiskInjury(cyc, bodyPart, risk)` — `MainTimeline.as:56503-56547`:

```as3
public function RiskInjury(cyc:int, bodyPart:int, risk:int) : void
{
   if(cyc > 0)
   {
      this.chance = this.pStat[cyc][6] * 5;          // Toughness x 5  (so 250..495)
      if(risk < 0)
      {
         this.chance *= 10;
         risk = 0;
      }
      this.randy = this.Rnd(0,this.chance);
      if(this.randy <= risk && this.pInjured[cyc] == 0)
      {
         ...
         this.pHealth[cyc] /= 2;
         this.pHP[cyc] = 0;
         this.pHeat[cyc] /= 2;
         if(this.no_refs > 0 && cyc != this.no_wrestlers + 1)
         {
            this.pReaction[this.no_wrestlers + 1] = -48;   // referee reacts
         }
         if(bodyPart == 0) { bodyPart = this.Rnd(1,3); }
         if(bodyPart == 3) { this.pInjured[cyc] = this.Rnd(1,4); }
         if(bodyPart == 2) { this.pInjured[cyc] = this.Rnd(4,8); }
         if(bodyPart == 1) { this.pInjured[cyc] = 10; }
      }
   }
}
```
So toughness makes injury **less** likely (bigger denominator). `bodyPart` selects the code:
1 → head (10), 2 → 4–8, 3 → 1–4, 0 → random of the three.

### 8.4 What the body-part code means

`ApplyInjury(char, limb, degree)` — `MainTimeline.as:121117-121176` — is the only consumer of
the code for stat damage:

```as3
if(limb == 9) { limb = 10; }
this.charInjured[char] = limb;
this.charInjuryTime[char] = this.Rnd(1,5);
if(degree == 2) { this.charInjuryTime[char] = this.Rnd(4,10); }
this.charNewStat[char][7] += this.Rnd(-5,5);
this.charNewStat[char][8] -= this.Rnd(1,5) * degree;
if(limb >= 1 && limb <= 3)
{
   this.count = 2;
   while(this.count <= 6)
   {
      this.charNewStat[char][this.count] -= this.Rnd(1,2) * degree;
      ++this.count;
   }
}
if(limb >= 4 && limb <= 9)
{
   for(this.count = 2; this.count <= 6; ++this.count)
   {
      if(this.count == 2 || this.count == 5 || this.count == 6)
      {
         this.charNewStat[char][this.count] -= this.Rnd(1,5) * degree;
      }
      else
      {
         this.charNewStat[char][this.count] -= this.Rnd(0,degree);
      }
   }
}
if(limb == 10)
{
   this.charNewStat[char][2] -= this.Rnd(0,degree);
   this.charNewStat[char][3] -= this.Rnd(1,5) * degree;
   this.charNewStat[char][4] -= this.Rnd(2,8) * degree;
   this.charNewStat[char][5] -= this.Rnd(0,degree);
   this.charNewStat[char][6] -= this.Rnd(1,5) * degree;
}
if(degree == 99)
{
   this.charInjuryTime[char] = this.Rnd(8,16);
   this.charNewStat[char][1] += this.PursueStat(this.charStat[char][1],99,0);
   for(this.count = 2; this.count <= 8; ++this.count)
   {
      if(this.count != 7)
      {
         this.charNewStat[char][this.count] = 50;
      }
   }
}
this.charNewHealth[char] = 0;
this.charTraining[char] = 0;
```

| Code | Reads as | Stat damage (per `degree`) | Recovery |
|---|---|---|---|
| 1–3 | upper limb / shoulder | **All** of 2–6 lose `Rnd(1,2)` | 1–5 weeks |
| 4–8 | lower limb / leg | Strength, Stamina, Toughness lose `Rnd(1,5)`; Skill, Agility lose `Rnd(0,degree)` | 1–5 weeks |
| 9 | remapped to 10 | — | — |
| 10 | head / neck | Skill `Rnd(1,5)`, Agility `Rnd(2,8)`, Toughness `Rnd(1,5)`, Strength/Stamina `Rnd(0,degree)` | 1–5 weeks |

Always on top: Attitude `±Rnd(-5,5)`, Happiness `−Rnd(1,5)×degree`, health → 0, training → 0.

**Severity (`degree`) is chosen at match end**, not during the match
(`MainTimeline.as:118389-118412`):
```as3
if(this.pInjured[this.cyc] > 0 && this.charInjured[this.char] == 0)
{
   this.randy = this.Rnd(0,10);
   if(this.randy == 0)
   {
      this.pInjured[this.cyc] = 0;
      this.charNewStat[this.char][8] += 1;          // shook it off
   }
   if(this.randy >= 1 && this.randy <= 6)
   {
      this.ApplyInjury(this.char,this.pInjured[this.cyc],1);   // 60%: minor
   }
   if(this.randy >= 7 && this.randy <= 8)
   {
      this.ApplyInjury(this.char,this.pInjured[this.cyc],2);   // 20%: serious
   }
   if(this.randy == 9)
   {
      this.ApplyInjury(this.char,this.pInjured[this.cyc],99);  // 10%: career-threatening
   }
```
So **10 % of in-match injuries are catastrophic**: 8–16 weeks out, popularity still advances,
and every stat except Attitude is **reset to 50**. That is the "career ruined" outcome, and it
is the single largest stat event in the game.

### 8.5 Recovery

Weekly (`MainTimeline.as:116575-116583`):
```as3
if(this.charInjuryTime[this.char] > 0)
{
   this.charInjuryTime[this.char] = this.charInjuryTime[this.char] - 1;
}
if(this.charInjuryTime[this.char] <= 0)
{
   this.charInjured[this.char] = 0;
}
```
Recovery is announced as "Back In Action" (event 13), which also grants `+1 Happiness`
(`MainTimeline.as:118999-119003`).

Two storyline modifiers:
- **Setback** (event 17) — `charInjuryTime += 4`, Happiness −1 (`119040-119046`).
- **Fast healer** (event 18) — `charInjuryTime = int(charInjuryTime[gamChar] / 2)`, Happiness −1
  (`119047-119060`). NOTE: this reads `charInjuryTime[this.gamChar]`, not `[char]` — a genuine
  bug in the shipped code that halves the *player's* timer regardless of who is healing.

Injury is also visible in the news animation by code band (`MainTimeline.as:120773-120783`):
```as3
if(this.charInjured[char] >= 1 && this.charInjured[char] <= 3) { this.eAnim[...] = this.animID[4] + 1; }
if(this.charInjured[char] >= 4 && this.charInjured[char] <= 9) { this.eAnim[...] = this.animID[4] + 2; }
if(this.charInjured[char] == 10)                               { this.eAnim[...] = this.animID[4] + 34; }
```
— three visuals: arm/shoulder, leg, head.

### 8.6 Injury at roster initialisation

When a career starts, the *other* 299 characters are randomised (`MainTimeline.as:8456-8467`):
```as3
this.charHealth[this.char] = this.Rnd(0,200);
if(this.charHealth[this.char] > 100) { this.charHealth[this.char] = 100; }
this.randy = this.Rnd(0,50);
if(this.randy == 0)
{
   this.charInjured[this.char] = this.Rnd(1,4);
   this.charInjuryTime[this.char] = this.Rnd(1,4);
   this.charHealth[this.char] = 0;
}
if(this.randy == 1)
{
   this.charVacant[this.char] = this.Rnd(1,4);
}
```
Health is `min(Rnd(0,200),100)` (so ~50 % of the roster starts below 100), 1-in-51 starts
injured for 1–4 weeks, and 1-in-51 starts "vacant" (absent) for 1–4 weeks.

---

## 9. Derived values a rebuild must reproduce

### 9.1 `StatAverage(char, bias)` — the overall rating

`MainTimeline.as:114743-114765`:
```as3
average = 0;
for(this.count = 1; this.count <= 6; ++this.count)
{
   average += this.charStat[char][this.count];
   if(bias == this.count)
   {
      average += this.charStat[char][this.count] * 4;
   }
}
if(bias > 0) { average /= 9; } else { average /= 5; }
return average;
```
- **Only stats 1–6 count.** Attitude and Happiness are *not* part of the overall.
- `bias = 0` → plain mean of 1–6 (`/5`, a 5-divisor over 6 terms — an off-by-one in the
  original that inflates the average by 20 %; preserve or normalise deliberately).
- `bias = n` → that stat is weighted 5× (`(sum + 4×stat) / 9`).

`PhysicalAverage(char)` averages stats 2–6 only (`114767-114777`).

### 9.2 `CalculateWorth(char)` — market value

`MainTimeline.as:114779+`:
```as3
chunk = this.StatAverage(char,1) - 40;
if(chunk < 15) { chunk = 15; }
this.factor = chunk / 15;
worth = chunk * chunk * this.factor;
if(this.charFed[char] == 7) { worth /= 2; }
if(this.charFed[char] == 8) { worth *= 1.5; }
if(this.charInjured[char] > 0) { ... }
```
Worth is cubic in `(popularity-weighted average − 40)`, halved in the developmental fed (7),
×1.5 in fed 8, and reduced by injury. This is the number contracts and transfers are priced
against.

### 9.3 The eight stats again, with their gameplay role

| # | Name (`textStat`, line 131372) | Used for |
|---|---|---|
| 1 | Popularity | Drawing power, card position, `pPop`, championship eligibility, ceiling `fedPop+5`. |
| 2 | Strength | Damage, weight shifts, power moves. |
| 3 | Skill | Technical moves, counter success. |
| 4 | Agility | Speed, aerial moves, dodge. |
| 5 | Stamina | Health regeneration rate; match pacing. |
| 6 | Toughness | **Injury resistance** (`RiskInjury` denominator) and damage soak. |
| 7 | Attitude | Weekly **improvement** odds (lower attitude = more improvement events) and backstage behaviour. |
| 8 | Happiness | Weekly **decline** odds, morale, contract/quit behaviour. |

Counter-intuitive but verified: **low Attitude improves you** — the improvement roll is
`chance = (110 − attitude) * 50` (`117214`), so a 50-attitude wrestler rolls in a range of 3000
while a 99-attitude wrestler rolls in 550. High Attitude makes someone a model employee and a
static wrestler.


---

## 10. Reimplementation notes

### 10.1 The one thing that must match exactly: `rnd()`

```ts
// TypeScript — matches Rnd(min,max) bit-for-bit in distribution
export const rnd = (min: number, max: number): number =>
  Math.round(Math.random() * (max - min)) + min;
```
```lua
-- Luau: no math.round, so express round-half-up explicitly
local function rnd(min: number, max: number): number
	local r = math.floor(math.random() * (max - min) + 0.5)
	return r + min
end
```
`Math.round` in AS3/JS rounds .5 toward +∞, which `floor(x + 0.5)` reproduces for all
non-negative inputs; `Rnd`'s argument is always `Math.random()*(max-min) >= 0`, so the two
agree exactly. `min` is added afterwards in both implementations. Add the distribution test
in 10.5 before trusting a port.

### 10.2 Core loop pseudocode

```ts
function weeklyTick(c: Character, ctx: World): void {
  c.old = { ...c.stat };                       // ResetOldStats
  c.oldHealth = c.health;
  if (c.injuryTime > 0) c.injuryTime -= 1;
  if (c.injuryTime <= 0) c.injured = 0;

  // health
  if (c.injured > 0) c.health = 0;
  else c.health += c.stat[5] * (0.5 + Math.random() / 2);

  // off-screen simulation pulse
  const offScreen = ctx.mode === 1
    ? (c.id !== ctx.playerId && c.id !== ctx.opponentOfWeek)
    : (c.fed !== ctx.playerFed);
  if (offScreen && rnd(0, 1) === 0 && c.health > 0 && c.fed !== 8) {
    c.health = rnd(0, c.stat[5]);
    if (ctx.mode === 1 && c.id === ctx.playerPartnerId)
      c.health = rnd(c.stat[5] / 2, c.stat[5]);
    if (rnd(0, 1000) === 0 && c.injured === 0) {
      c.injured = rnd(1, 4);
      c.injuryTime = rnd(1, 4);
    }
    for (let s = 1; s <= 8; s++) {
      if (rnd(0, 1) === 0) c.stat[s] += rnd(-1, 1);
      if (c.peaked > 0 && s >= 2 && s <= 6 && c.stat[s] > c.old[s]) c.stat[s] = c.old[s];
    }
  }

  // training is applied elsewhere — see §7.6
  clampStats(c);        // CheckStatLimits
  c.new = { ...c.stat }; // ResetNewStats
}
```

### 10.3 Deterministic seeding

The original is unseeded `Math.random()`. For a web/Roblox rebuild you want reproducible
rosters, so thread a PRNG through `rnd` rather than reading a global:

```ts
type Rng = () => number;                     // returns [0,1)
export const makeRnd = (rng: Rng) =>
  (min: number, max: number) => Math.round(rng() * (max - min)) + min;
```
Seed per character (`seed = hash(worldSeed, charId)`) so that regenerating one wrestler does
not shift everyone else's rolls — the original's order dependence (§5.8 note 2) is otherwise a
reproducibility trap.

### 10.4 Web data schema

```ts
// types/character.ts
export type StatIndex = 1|2|3|4|5|6|7|8;
export type Role = 0|1|2|3;              // None|Wrestler|Manager|Referee
export type Gender = 0|1;

export interface Character {
  id: number;                 // 1..300
  name: string;
  teamName: string;
  gender: Gender;
  age: number;                // 16..99, age at career start
  role: Role;
  heel: 0|1;
  theme: number;
  light: number;              // 0..12
  prop: number;               // 0 | 4..20
  relationships: [number,number,number,number,number,number]; // 1..6 -> charId, 0 = none
  stats: Record<StatIndex, number>;   // 50..99 live
  oldStats: Record<StatIndex, number>;// snapshot at tick start
  newStats: Record<StatIndex, number>;// pending
  build: number;              // 1..9
  height: number;             // 86..110 (authored data may exceed)
  appearance: { eyes:number; brows:number; beard:number; shave:number;
                hairStyle:number; hairLength:number };
  costumes: Costume[];        // 3 entries, 16 drawn limbs each
  stance: number;             // 1..10
  walk: number;               // 1..4
  taunts: [number,number,number,number]; // 0..93
  moves: {
    attack:     number[];     // 8, ids from libAttack
    crush:      number[];     // 8, ids from libCrush
    front:      number[];     // 20, front/rope/high; [15] = finisher
    back:       number[];     // 7
    ground:     [number[], number[]]; // [upper 3, legs 3]
  };
  health: number;             // 0..100
  oldHealth: number;
  newHealth: number;
  injured: number;            // 0..10 body-part code
  injuryTime: number;         // weeks
  peaked: number;             // 0 | age at peak (>= 40)
  training: number;           // 0 | 2..6
  contract: number; salary: number; worth: number;
  clauses: [number,number,number];
  arrived: number; worked: number; vacant: number;
  fed: number;                // 0 = free agent, 7 = school, 8 = ?, 9 = ?
}
```
**Indexing:** keep the source's 1-based stat keys (`StatIndex`, `relationships[1..6]`,
`moves.front[1..20]`) in the domain layer; only convert at the render/serialisation boundary.
Silently 0-basing `charMove` will move the finisher from slot 15 to 14 and break every
character.

### 10.5 Test cases to lock the port

| Test | Expected |
|---|---|
| `rnd(0,10)` over 100 k samples | 0 and 10 each ≈ 5 %, 1–9 each ≈ 10 % |
| `rnd(5,5)` | always 5 |
| `pursueStat(50, 99, 0)` | 5..10 |
| `pursueStat(98, 99, 0)` | 1 |
| `pursueStat(99, 99, 0)` | 0 |
| `generateStats` for a fed-7 character, 10 k samples | all physical ≤ 80 |
| `clampStats` | never < 50, never > 99; health 0..100 |
| peaked character, 100 ticks | physical stats never increase from the drift pulse |
| `applyInjury(c, 10, 99)` | injuryTime 8..16, stats 2–6 and 8 == 50, stat 7 unchanged |
| popularity after a win in a fedPop-75 promotion | ≤ 80 |

### 10.6 Roblox schema (Luau)

```lua
--!strict
export type StatMap = { [number]: number } -- [1..8]

export type Character = {
	id: number,
	name: string,
	teamName: string,
	gender: number,   -- 0 male, 1 female
	age: number,
	role: number,     -- 1 wrestler, 2 manager, 3 referee
	heel: number,     -- 0 face, 1 heel
	theme: number,
	light: number,
	prop: number,
	relationships: { [number]: number }, -- [1..6] -> id, 0 = none
	stats: StatMap,
	oldStats: StatMap,
	newStats: StatMap,
	build: number,
	height: number,
	-- ... appearance / costume / moves as in 10.4
	health: number,
	injured: number,
	injuryTime: number,
	peaked: number,
	training: number,
	fed: number,
}

local function rnd(min: number, max: number): number
	return math.floor(math.random() * (max - min) + 0.5) + min
end

local function pursueStat(current: number, target: number, limit: number): number
	local inc = 0
	if current < target then inc = 1 end
	if current > target then inc = -1 end
	if current < target - 10 then inc = rnd(2, 4) end
	if current > target + 10 then inc = -rnd(2, 4) end
	if current < target - 20 then inc = rnd(3, 6) end
	if current > target + 20 then inc = -rnd(3, 6) end
	if current < target - 30 then inc = rnd(4, 8) end
	if current > target + 30 then inc = -rnd(4, 8) end
	if current < target - 40 then inc = rnd(5, 10) end
	if current > target + 40 then inc = -rnd(5, 10) end
	if limit > 0 then
		inc = math.clamp(inc, -limit, limit)
	end
	return inc
end
```

Roblox-specific guidance:
- **DataStore**: persist `stats`, `oldStats`, `newStats` as three arrays of 8 ints, not a map —
  JSON round-trips maps with numeric keys as strings and you will lose the 1-based contract.
  Use `{stats = {50,50,...}}` and index with `stats[i]`.
- **Saving size**: do not persist `costumes` per character per save if you ship the authored
  roster — persist a `costumeRevision` and rebuild from the static asset table.
- **Health/injury** should be server-authoritative; the client only displays. `RiskInjury`
  decides outcomes that permanently reset stats, so it must never run client-side.
- **Tick cadence**: the original ticks on a 48-week year with one match per week. If you run a
  real-time loop, keep the *event probabilities per tick* identical and change only tick
  length; do not "balance" the numbers.

### 10.7 Progressions summary (one paragraph to hand a designer)

A wrestler is 8 stats in 50–99. Physical stats rise only from training (+1/week, costs half
your health, never after peaking, and always at the cost of a neighbouring stat) and from a
weekly random event whose odds are governed by Attitude (low attitude = more improvement
events). They fall from a mirrored event governed by Happiness, from injuries, and from age
once peaked. Popularity and Happiness move with match results and are hard-capped at the
promotion's own popularity +5. At some point after 40 a wrestler is declared "Over The Hill",
which freezes all future physical gains forever while leaving decline fully active — so every
career is a rise, a plateau, and a slow erosion.

---

## 11. UNKNOWNS

Items I could **not** prove from this file. Do not treat any of these as settled.

1. **Exact anatomical labels for injury codes 4–8.** `ApplyInjury` only branches on ranges
   (1–3, 4–9, 10) and `RiskInjury` only generates 1–4, 4–8 and 10. The mapping "4–8 = leg" is
   inferred from the stat pattern (Strength/Stamina/Toughness hit hardest) and the leg-limp
   animation, not from a label string. Codes 1–3 are likewise inferred as arm/shoulder.
2. **`charWorked` semantics.** It is read as a booking/attitude modifier (`9539`, `118216`)
   and reset in several places, but I did not trace every writer; treat as "matches worked
   this week" with caution.
3. **`charFed` 8 and 9 meanings.** Fed 7 is explicitly the wrestling school
   (`119249-119251`: "has started training") and fed 8 is excluded from several progression
   paths (`116667`, `118063`). I did not establish what 8 and 9 are narratively.
4. **`no_themes`.** Defined as `this.sTheme.length - 1` (`131468`) — the theme-music table is
   populated elsewhere and I did not enumerate it, so `charTheme`'s valid range is
   `1..no_themes` without a proven numeric bound.
5. **Training mini-game scoring.** `trainProgress` is accumulated by `TrainingScripts` /
   `TrainingAnims` (`40959`, `41103`); I documented the *thresholds* (1125/2250/3375) but not
   how points are awarded, because that is animation-driven rather than stat-driven.
6. **`charPeaked` restore on load.** Load restores it (`52532-52538`) but `GenerateStats`
   resets it to 0 (`27936`), and `GenerateCareer` resets it for the player (`8353`). Whether a
   *loaded* career preserves peaking across a roster regeneration is untested.
7. **`StatAverage` divisor.** `bias == 0` divides a 6-term sum by 5 (`114757-114762`). I
   report this as an off-by-one in the original; I cannot prove it was intentional.
8. **`libAttack[1]` upper bound.** Built as 1001–1023 plus 1051/1052 (25 entries). Whether
   every id in that set is reachable by a real animation is unverified — `textMove` may not
   define all of them.
9. **Fed popularity range above 100.** The default is `this.fedPop[this.fed] = this.Rnd(50,100)`
   (`133761`), so a promotion can be authored up to 100 — meaning a wrestler's popularity
   ceiling (`fedPop + 5`) can legitimately exceed the 99 stat clamp. The clamp wins, so in a
   fedPop-100 promotion there is no headroom at all. Whether any real promotion reaches 100
   depends on save data I do not have.
10. **`charInjured` values above 10.** Nothing generates them, but no clamp exists either;
    `ApplyInjury` would fall through all branches and only set health/time. A save edited to
    contain 11 would behave as a permanent invisible injury.

---

*End of document. Companion specs: 01 roster file format, 02 rendering/costume model, 04 match
engine, 05 economy/contracts.*


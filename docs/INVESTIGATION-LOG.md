# WR3D 1.750.64 — REA initial investigation

**Target:** `wrestling-revolution-3d-1-750-64.apk`
**sha256:** `77dbf50c1ca1dced98a001aef86f9f186e0d8c3c0533241b281462c9936cd7af`
**Package:** `air.WR3DFree` · v1.750.64 (1750064) · minSdk 24 · targetSdk 35 · compileSdk 36
**Size:** 139.83 MB · 2,831 files · 10 DEX · 190.8 MB unpacked
**Toolchain:** REA 6.4.0 / `jadx-headless-mcp 0.7.1` (sha256 `6e5eacf5…ff75`) / JDK 21.0.12.1 / JPEXS ffdec 26.4.0

Evidence ID (package inspection): `ev_d315e38b5bcdfafd1b026baa3a2d5aad8a371f470308f1967721f0f8df510b22`

## 1. Engine

Not a native Android game. **Adobe AIR (Flash) runtime.**

- `assets/Game.swf` — 10.69 MB, `CWS3` (zlib-deflated SWF) → 12.57 MB decompressed
- `assets/Game-app.xml`, `assets/META-INF/AIR/application.xml`
- `android:name="air.WR3DFree.AIRAppEntry"`, `initialcontent="Game.swf"`, `namespaceVersion 51.1`
- DEX carries only SDK glue: AppLovin, ironSource/LevelPlay, Bigo, Pangle (ByteDance), Vungle, Unity Ads, InMobi, MBridge, BidMachine, Moloco, Yodo1 MAS 4.17.1, distriqt ANEs

**Consequence:** jadx/DEX analysis alone cannot see the game. 393 ActionScript classes were recovered from the SWF with JPEXS.

## 2. IAP flow (ActionScript, `Game_fla/MainTimeline`)

Event path recovered from the SWF string table:
```
purchaseRequest_shouldAddPurchaseHandler → makePurchase
purchases_updatedHandler → getPurchasesCompleteHandler
restorePurchases → getPurchases → restorePurchases_successHandler
```

### 2.1 `LegitPurchase` — hardcoded pass

```as3
public function LegitPurchase(token:String) : int
{
   var legit:int = 1;                 // ← always starts at 1
   this.productToken = token;
   if(legit == 0)                     // ← dead: checked before the only decrement
   {
      this.testReport = "Invalid token: " + this.productToken;
   }
   if(this.optPurchases < 2)
   {
      legit = 0;                     // ← only real rejection path
   }
   return legit;
}
```

- No receipt signature check, no server call, no nonce. `transactionReceipt` is stored verbatim in `productToken` and never validated.
- The `legit == 0` branch is unreachable as written — the variable is 1 at that point.

### 2.2 `ActivatePurchase` — unlock is a local write

```as3
public function ActivatePurchase() : void
{
   if(this.gamPaid[1] + this.gamPaid[2] != 2)
   {
      this.sCash.play();
      this.gamPaid[1] = 1;
      this.gamPaid[2] = 1;
      if(this.padConnected[1] > 0) { this.optGamepad = 1; this.optControl = 2; }
      this.SaveSystem();
   }
}
```

### 2.3 Persistence — `SharedObject.getLocal("System")`

```as3
saveFile.data.gamPaid[1] = this.gamPaid[1];
saveFile.data.gamPaid[2] = this.gamPaid[2];
saveFile.data.gamHacked = this.gamHacked;
```

Load path merges upward and **collapses to full unlock if either flag is set**:

```as3
if(saveFile.data.gamPaid[1] > this.gamPaid[1]) { this.gamPaid[1] = saveFile.data.gamPaid[1]; }
if(saveFile.data.gamPaid[2] > this.gamPaid[2]) { this.gamPaid[2] = saveFile.data.gamPaid[2]; }
if(this.gamPaid[1] + this.gamPaid[2] > 0)      { this.gamPaid[1] = 1; this.gamPaid[2] = 1; }
```

One flag set → both products unlocked.

### 2.4 Anti-tamper

```as3
public function FailPurchase(evil:int) : void
{
   this.sBlock.play();
   if(this.screen == 5) { this.gotim = -100; }
   if(evil > 0)
   {
      this.sCrowd[3].play();
      this.optPurchases = -1;    // blocks all later purchases (<2 test)
      this.gamHacked = 1;        // persisted
      this.SaveSystem();
   }
}
```
Consumed at `optDevice >= 2 && gamHacked > 0` (line 134537) and via the `optPurchases` gates.

## 3. Gate sites (`gamPaid`)

| Line | Condition | Meaning |
|---|---|---|
| 5300 | `gamPaid[1] > 0 && gamPaid[2] > 0` | full-unlock menu branch |
| 5317 | `gamPaid[1] == 0 \|\| gamPaid[2] == 0` | locked-state branch |
| 7624 | `gamMode == 0 && gamCard >= 0 && gamPaid[1]+gamPaid[2] == 0` | career gate (mode 0) |
| 7628 | `gamMode > 0 && gamPaid[1] == 0` | career gate (other modes) |
| 8366 | `gamPaid[1] == 0` | further gate |

## 4. Verdict

Purchase validation and content unlocking are **entirely client-side**, with no server-side receipt verification anywhere in the shipped artifact. `LegitPurchase` returns success by default; entitlement lives in a `SharedObject` written by the client. The only defence is a soft flag (`gamHacked`) set by the game's own failure handler.

Classified as **entitlement logic implemented client-side (by design of the AIR build)** — not a vulnerability in a third party's system. This is analysis of a shipped single-player game the device owner runs locally.

## 5. Reproduction

```bash
export REA_JADX_MCP_JAR=$HOME/.local/share/rea/android/jadx-headless-mcp-0.7.1-all.jar
npx -y rea-agents@latest inspect-android-package ./wrestling-revolution-3d-1-750-64.apk --format json
npx -y rea-agents@latest search-android-classes ./wrestling-revolution-3d-1-750-64.apk Billing --format json
npx -y rea-agents@latest trace-android-references ./wrestling-revolution-3d-1-750-64.apk com.distriqt.extension.inappbilling.InAppBilling --format json

unzip -o wrestling-revolution-3d-1-750-64.apk 'assets/Game.swf' -d swf/
java -jar ffdec.jar -export script as3 swf/assets/Game.swf
grep -n -A14 "function LegitPurchase" as3/scripts/Game_fla/MainTimeline.as
```

## 6. Roster format — `assets/Characters.txt` (solved)

One single line, `|`-delimited. `token[0]` = character count (300), then 300 fixed records of **exactly 335 fields**, trailing delimiter at EOF.

Schema recovered 1:1 from `LoadedDefaultChars` and **verified**: a sequential port consumed all 100,500 tokens with zero drift.

| Fields | Name | Notes |
|---|---|---|
| 1 | `charName` | string |
| 2 | `charTeamName` | rewritten to `Team <ShortName>` when it starts with "Team" |
| 3-9 | `charGender`, `charAge`, `charRole`, `charHeel`, `charTheme`, `charLight`, `charProp` | ints |
| 10-15 | `charRelationship[1..6]` | **character indices**, 0 = none |
| 16-23 | `charStat[1..8]` | 0-100 wrestling attributes |
| 24-31 | `charBuild`, `charHeight`, `charEyes`, `charBrows`, `charBeard`, `charShave`, `charHairStyle`, `charHairLength` | ints |
| 32-280 | `charCostume[1..3]` | 3 outfits × 16 limbs × `(limb, R, G, B)` + conditional `flesh`/`pads`/`baggy` |
| 281-282 | `charStance`, `charWalk` | |
| 283-286 | `charTaunt[1..4]` | |
| 287-294 | `charAttack[1..8]` | |
| 295-302 | `charCrush[1..8]` | |
| 303-322 | `charMove[1..20]` | |
| 323-329 | `charBackMove[1..7]` | |
| 330-335 | `charGroundMove[1..2][1..3]` | interleaved in the loader |

Costume constants that make 335 exact: `no_limbs = 22`, limbs `6,7,15,16,17,19` skipped → 16 rendered per outfit. Flesh on `{2,4,5,8,9,10,11,12,13,14,20}` (11), pads on `{4,8,11}` (3), baggy on `{2,4,5,9,12}` (5).
`31 + 3*(16*4+11+3+5) + 1 + 1 + 4 + 8 + 8 + 20 + 7 + 6 = 335`

Example: `Mat Dickie`, 32, build 5, height 99, stats `[65,75,75,70,65,65,70,75]`.
289 distinct federations, no duplicate names.

## 7. Save schema — five `SharedObject`s

| Object | Keys | Set by |
|---|---|---|
| `System` | `gamPaid[1]`, `gamPaid[2]`, `gamHacked`, `gamCrossoverOffered`, `gamWrestler`, `gamBooker` | `SaveSystem()` |
| `Career` (mode ≠ 2) / `Booking` (mode 2) | `gamBank`, `gamBankMilestone`, `gamManagerCut`, `gamCostumeChanges`, `eFatality`, `gamDate`, `gamYear`, `gamStartYear`, `gamSchedule[1..48]` | `SaveProgress()` |
| `NewCharacters` (Android) / `Characters` (`optDevice<=1`) / `BackupChars` (`screenAgenda==-4`) | per-`Array` fields `charName[1..n]`, `charTeamName[1..n]`, `charGender[1..n]`, … | `SaveDeviceChars()` |
| `NewRosters` / `Rosters` / `BackupRosters` | `fedLeader`, `fedLoser`, `fed…` per federation | `SaveDeviceRosters()` |
| `Options` | `optControl`, `optGamepad`, … | `LoadOptions()` |

`optRestore` (default `1`, set in `frame1()`) gates whether device saves are written or read: `1` = write/read, `2` = alternate path, `0` = off. `SaveSystem()` is a no-op when `optRestore <= 0`.

## 8. Deliverables

- `roster_parse.py` — schema-exact parser (port of the shipped loader, asserts on drift)
- `roster_named.json` — all 300 characters, fully named, costumes included (1.8 MB)
- `roster_summary.csv` — 300 rows, name/team/demographics/eight stats
- `roster.csv` — raw 335-column dump
- `as3/` — 393 decompiled ActionScript classes (7.7 MB)

## 9. Open questions

- Career mode gating: 5 `gamPaid` branch sites map to menu/career screens but the mode-2 (booking) path is not yet walked end to end.
- `charRelationship[1..6]` holds character indices; the relationship *type* table has not been located.
- `Characters.txt` covers the stock roster; user-generated characters live in the `NewCharacters` SharedObject with a different writer path.

#!/usr/bin/env python3
"""Generate cross-platform conformance vectors for the WR3D sim.

Every formula here is transcribed verbatim from the decompiled ActionScript
(`MainTimeline.as`) and cited by line. Web (TypeScript) and Roblox (Luau)
implementations must reproduce these numbers exactly.

Vectors are DERIVED from source, not captured from the running game: they pin
the formulas, not the frame timing.
"""
import json

# ---------------------------------------------------------------- PRNG
# AS3 uses Math.random() (unseeded). To make a port deterministic we pin a
# PRNG: mulberry32. Both platforms must use the same one.
def mulberry32(seed: int):
    a = seed & 0xFFFFFFFF
    while True:
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        yield ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


def js_round(x: float) -> int:
    """ActionScript Math.round: half-up toward +inf (NOT banker's rounding)."""
    import math
    return math.floor(x + 0.5)


def Rnd(rng, lo: int, hi: int) -> int:
    """MainTimeline.as:3313  ->  Math.round(Math.random()*(max-min)) + min"""
    return int(js_round(next(rng) * (hi - lo)) + lo)


def build():
    out = {"_source": "MainTimeline.as (air.WR3DFree 1.750.64)", "prng": "mulberry32", "vectors": {}}

    # --- Rnd endpoint weighting --------------------------------------- 3313
    rng = mulberry32(1234)
    out["vectors"]["rnd"] = {
        "spec": "Math.round(Math.random()*(max-min))+min  — endpoints receive half weight",
        "seeds": [{"seed": 1234, "lo": 0, "hi": 100, "first10": [Rnd(rng, 0, 100) for _ in range(10)]}],
    }
    rng2 = mulberry32(1234)
    out["vectors"]["rnd"]["seeds"].append(
        {"seed": 1234, "lo": 5, "hi": 10, "first10": [Rnd(rng2, 5, 10) for _ in range(10)]}
    )

    # --- strike damage ------------------------------------------------- 97003
    # pain = Math.round(pStat[cyc][2] * pain)   (Strength * anim multiplier)
    # + 1.25x while pSpecial > 0                                    97004-97007
    mults = [1, 2, 5, 6]
    out["vectors"]["strike_damage"] = {
        "spec": "pain = Math.round(Strength * mult); *1.25 if special active",
        "cases": [
            {"strength": s, "mult": m, "special": sp,
             "expected": js_round(js_round(s * m) * (1.25 if sp else 1))}
            for s in (60, 75, 90, 95) for m in mults for sp in (False, True)
        ],
    }

    # --- poise --------------------------------------------------------- 97219
    # pHP[v] -= pain/50 * (150 - pStat[v][6])     (Toughness = stat 6)
    out["vectors"]["poise"] = {
        "spec": "pHP -= pain/50 * (150 - Toughness); cap = health/5; starts 1000",
        "cases": [
            {"pain": pn, "toughness": t, "expected": pn / 50 * (150 - t)}
            for pn in (150, 450) for t in (60, 75, 95)
        ],
    }

    # --- special meter ------------------------------------------------- 57230
    # pSpecial = 100 + pStat[cyc][1] + Rnd(0,100)
    rng3 = mulberry32(77)
    out["vectors"]["special_meter"] = {
        "spec": "100 + Popularity + Rnd(0,100)",
        "cases": [{"popularity": pop, "seed": 77, "expected": 100 + pop + Rnd(rng3, 0, 100)}
                  for pop in (65, 95)],
    }

    # --- contest chance -------------------------------------------- 67944-67954
    # chance = atkStat; chance += 150 - defSkill; chance *= SizeDifference; *0.75 if run-up
    out["vectors"]["contest_chance"] = {
        "spec": "chance = atkStat + (150 - defSkill); *sizeDiff; *0.75 if either run-up",
        "cases": [
            {"atkStat": a, "defSkill": d, "sizeDiff": sd, "runUp": ru,
             "expected": (a + (150 - d)) * sd * (0.75 if ru else 1)}
            for a in (60, 75, 90) for d in (60, 90) for sd in (1, 1.2) for ru in (False, True)
        ],
    }

    # --- character worth --------------------------------------- 114779-114821
    # chunk = max(15, StatAverage(char,1) - 40); worth = chunk^3 / 15
    # fed7 /2, fed8 *1.5, injured *0.75, champ1 *1.5, champ2|3 *1.25, booker *1.5
    # RoundOff(worth,10); floor 100
    def worth(avg, fed=0, injured=False, champ=0, booker=False):
        chunk = max(15, avg - 40)
        w = chunk * chunk * (chunk / 15)
        if fed == 7:
            w /= 2
        if fed == 8:
            w *= 1.5
        if injured:
            w *= 0.75
        if champ == 1:
            w *= 1.5
        if champ in (2, 3):
            w *= 1.25
        if booker:
            w *= 1.5
        w = js_round(w / 10) * 10
        return max(100, w)

    out["vectors"]["char_worth"] = {
        "spec": "chunk=max(15,StatAvg-40); worth=chunk^3/15; modifiers; round10; floor 100",
        "cases": [
            {"statAvg": a, "fed": f, "injured": i, "champ": c, "booker": b,
             "expected": worth(a, f, i, c, b)}
            for a in (60, 75, 90, 99) for f in (0, 7, 8) for i in (False, True)
            for c in (0, 1, 2) for b in (False, True)
        ],
    }
    return out


if __name__ == "__main__":
    data = build()
    path = "/home/ubuntu/wr3d/shared/vectors/conformance.json"
    with open(path, "w") as f:
        json.dump(data, f, indent=1)
    n = sum(len(v.get("cases", v.get("seeds", []))) for v in data["vectors"].values())
    print(f"wrote {path} — {len(data['vectors'])} formula families, {n} vectors")

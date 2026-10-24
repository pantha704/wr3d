#!/usr/bin/env python3
"""WR3D (air.WR3DFree) Characters.txt schema parser.

Field order ported 1:1 from the shipped ActionScript loader
`Game_fla/MainTimeline.LoadedDefaultChars` (REA/JPEXS recovery).

Verified arithmetically: no_limbs=22, 3 costumes, 335 fields/record.
  31 header + 3*(16*4 + 11 + 3 + 5) + (1 stance + 1 walk + 4 taunt
  + 8 attack + 8 crush + 20 move + 7 backmove + 6 groundmove) = 335
"""
import csv
import json
import sys

NO_LIMBS = 22
SKIP_LIMBS = {6, 7, 15, 16, 17, 19}
FLESH_LIMBS = {2, 4, 5, 8, 9, 10, 11, 12, 13, 14, 20}
PADS_LIMBS = {4, 8, 11}
BAGGY_LIMBS = {2, 4, 5, 9, 12}
FIELDS_PER_RECORD = 335


def parse_record(toks, pos):
    """Consume one character record; return (dict, new_pos)."""
    r = {}

    def take(n=1, cast=int):
        nonlocal pos
        if n == 1:
            v = cast(toks[pos])
            pos += 1
            return v
        out = [cast(toks[pos + i]) for i in range(n)]
        pos += n
        return out

    r["charName"] = take(cast=str)
    r["charTeamName"] = take(cast=str)
    r["charGender"] = take()
    r["charAge"] = take()
    r["charRole"] = take()
    r["charHeel"] = take()
    r["charTheme"] = take()
    r["charLight"] = take()
    r["charProp"] = take()
    r["charRelationship"] = take(6)          # 1..6, char indices (0 = none)
    r["charStat"] = take(8)                  # 1..8
    r["charBuild"] = take()
    r["charHeight"] = take()
    r["charEyes"] = take()
    r["charBrows"] = take()
    r["charBeard"] = take()
    r["charShave"] = take()
    r["charHairStyle"] = take()
    r["charHairLength"] = take()

    costumes = []
    for coz in range(1, 4):
        c = {}
        for limb in range(1, NO_LIMBS + 1):
            if limb in SKIP_LIMBS:
                continue
            entry = {
                "limb": take(),
                "R": take(cast=float),
                "G": take(cast=float),
                "B": take(cast=float),
            }
            if limb in FLESH_LIMBS:
                entry["flesh"] = take()
            if limb in PADS_LIMBS:
                entry["pads"] = take()
            if limb in BAGGY_LIMBS:
                entry["baggy"] = take()
            c[str(limb)] = entry
        costumes.append(c)
    r["charCostume"] = costumes

    r["charStance"] = take()
    r["charWalk"] = take()
    r["charTaunt"] = take(4)
    r["charAttack"] = take(8)
    r["charCrush"] = take(8)
    r["charMove"] = take(20)
    r["charBackMove"] = take(7)
    g1, g2 = [], []
    for _ in range(3):  # loader interleaves: groundMove[1][n], groundMove[2][n]
        g1.append(take())
        g2.append(take())
    r["charGroundMove"] = {"1": g1, "2": g2}
    return r, pos


def parse(path):
    toks = open(path, "r", encoding="latin-1").read().split("|")
    count = int(toks[0])
    body = toks[1:]
    while body and body[-1].strip() == "":  # file ends with a trailing delimiter
        body.pop()
    if len(body) != count * FIELDS_PER_RECORD:
        raise SystemExit(
            f"size mismatch: {len(body)} tokens, expected {count * FIELDS_PER_RECORD}"
        )
    out, pos = [], 0
    for _ in range(count):
        rec, pos = parse_record(body, pos)
        out.append(rec)
    return out


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "/home/ubuntu/.hermes/profiles/bounty/cache/scratch/tgdl/swf/assets/Characters.txt"
    chars = parse(src)
    with open("/home/ubuntu/.hermes/profiles/bounty/cache/scratch/tgdl/roster_named.json", "w") as f:
        json.dump(chars, f, indent=1)
    with open("/home/ubuntu/.hermes/profiles/bounty/cache/scratch/tgdl/roster_summary.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["idx", "name", "team", "gender", "age", "role", "heel", "build", "height", *[f"stat{i}" for i in range(1, 9)]])
        for i, c in enumerate(chars, 1):
            w.writerow([i, c["charName"], c["charTeamName"], c["charGender"], c["charAge"], c["charRole"], c["charHeel"], c["charBuild"], c["charHeight"], *c["charStat"]])
    print(f"parsed {len(chars)} characters -> roster_named.json + roster_summary.csv")
    print("sample:", json.dumps(chars[0]["charName"]), chars[0]["charAge"], "age | stats", chars[0]["charStat"])

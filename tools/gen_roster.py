#!/usr/bin/env python3
"""Generate an entirely original 300-wrestler roster.

Why this exists: the extracted roster from the analysed binary must never ship
(see NOTICE). This synthesizer produces names and attributes from first
principles so the public repo carries no third-party data.

Deterministic: same seed -> byte-identical output.
"""
from __future__ import annotations

import json
import random
import sys

STATS = ["Popularity", "Strength", "Skill", "Agility", "Stamina", "Toughness", "Attitude", "Happiness"]

FIRST = [
    # deliberately mixed origins; each name is a common given name, not a performer
    "Arlo", "Kenji", "Mateo", "Rafael", "Dmitri", "Ifeanyi", "Tariq", "Soren", "Emeka", "Luca",
    "Nikolai", "Amara", "Kofi", "Yusuf", "Bodhi", "Ivo", "Rashid", "Santiago", "Kwame", "Emilio",
    "Hiroshi", "Andrei", "Malik", "Teodor", "Joaquin", "Obi", "Kai", "Zane", "Marek", "Rohan",
    "Dario", "Ezra", "Anton", "Cyrus", "Nico", "Solomon", "Viktor", "Arjun", "Bastian", "Tobias",
    "Oskar", "Ismail", "Renzo", "Dante", "Femi", "Bram", "Hugo", "Leandro", "Yuri", "Casimir",
    "Rhea", "Ines", "Nadia", "Saoirse", "Priya", "Ilse", "Zaria", "Mira", "Talia", "Freya",
    "Anika", "Selin", "Marisol", "Lena", "Dalia", "Ivy", "Thandi", "Noor", "Camila", "Rani",
]

LAST = [
    "Vance", "Okoro", "Marchetti", "Halvorsen", "Kovac", "Adeyemi", "Barros", "Lindqvist", "Duarte",
    "Novak", "Serrano", "Balogun", "Ferreira", "Ozdemir", "Kaur", "Rasmussen", "Delgado", "Mbeki",
    "Tanaka", "Petrov", "Achebe", "Costa", "Sokolov", "Nakamura", "Haddad", "Ferraro", "Brandt",
    "Moreau", "Cortez", "Nyberg", "Ibarra", "Kowalski", "Salgado", "Voss", "Dumont", "Aguilar",
    "Takeda", "Aziz", "Bergman", "Castellanos", "Mwangi", "Larsen", "Ricci", "Vargas", "Sorensen",
    "Kaur", "Bianchi", "Ortega", "Nilsen", "Fontaine",
]

EPITHET = [
    "the Anvil", "the Surgeon", "the Undertow", "the Quiet", "the Hurricane", "the Cartographer",
    "the Deadline", "the Last Word", "the Iron Ledger", "the Long Winter", "the Red Shift",
    "the Doorway", "the Static", "the Ninth Hour", "the Clean Break", "the Paper Tiger",
    "the Cold Read", "the Undertaker's Son", "the Bright Lie", "the Second Wind",
]

TEAM_PREFIX = [
    "Iron", "Neon", "Harbor", "Vandal", "Copper", "Midnight", "Granite", "Signal", "Riot", "Lantern",
    "Ash", "Cobalt", "Static", "Marble", "Hollow", "Sable", "Cinder", "Falcon", "Nomad", "Vault",
]


def make_name(rng: random.Random, used: set[str]) -> str:
    for _ in range(10_000):
        first = rng.choice(FIRST)
        last = rng.choice(LAST)
        name = f"{first} {last}"
        if name not in used:
            used.add(name)
            return name
    raise SystemExit("name pool exhausted — widen the pools")


def build(seed: int = 20261024, count: int = 300) -> list[dict]:
    rng = random.Random(seed)
    used: set[str] = set()
    roster = []
    for i in range(1, count + 1):
        name = make_name(rng, used)
        stats = {s: rng.randint(55, 95) for s in STATS}
        roster.append(
            {
                "id": i,
                "name": name,
                "epithet": rng.choice(EPITHET),
                "team": f"{rng.choice(TEAM_PREFIX)} {rng.choice(['Club', 'Union', 'Crew', 'Order', 'Works'])}",
                "gender": 0 if rng.random() > 0.2 else 1,
                "age": rng.randint(19, 44),
                "role": 1,
                "heel": rng.randint(0, 1),
                "theme": rng.randint(1, 12),
                "stats": stats,
                "build": rng.randint(2, 9),
                "height": rng.randint(92, 108),
                "appearance": {
                    "eyes": rng.randint(1, 6),
                    "brows": rng.randint(0, 3),
                    "beard": rng.randint(0, 8),
                    "shave": rng.randint(0, 2),
                    "hairStyle": rng.randint(0, 12),
                    "hairLength": rng.randint(0, 3),
                },
                "moves": {
                    "attack": [rng.randint(1, 8) for _ in range(8)],
                    "crush": [rng.randint(1, 8) for _ in range(8)],
                    "move": [rng.randint(1, 20) for _ in range(20)],
                    "backMove": [rng.randint(1, 7) for _ in range(7)],
                    "stance": rng.randint(1, 4),
                    "walk": rng.randint(1, 3),
                    "taunt": [rng.randint(1, 4) for _ in range(4)],
                },
            }
        )
    return roster


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "shared/data/roster.generated.json"
    data = build()
    with open(out, "w") as f:
        json.dump(data, f, indent=1, sort_keys=True)
    names = [c["name"] for c in data]
    assert len(names) == len(set(names)) == 300
    print(f"wrote {out}: {len(data)} original wrestlers, {len(set(names))} unique names")

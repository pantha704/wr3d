--!nonstrict
-- Cross-platform conformance test. Runs headlessly: `lune run roblox/tests/conformance.luau`
-- The same vectors must pass in web/test/conformance.test.ts.

local fs = require("@lune/fs")
local serde = require("@lune/serde")

local Prng = require("../src/shared/Sim/Prng")
local Formulas = require("../src/shared/Sim/Formulas")

local function loadVectors(): any
	local candidates = {
		"shared/vectors/conformance.json",
		"../shared/vectors/conformance.json",
		"../../shared/vectors/conformance.json",
	}
	for _, path in candidates do
		if fs.isFile(path) then
			return serde.decode("json", fs.readFile(path))
		end
	end
	error("conformance.json not found — run from the repo root")
end

local vectors = loadVectors()
local pass, fail = 0, 0
local failures: { string } = {}

local function check(label: string, got: any, want: any, eps: number?)
	local ok
	if typeof(want) == "number" and eps then
		ok = math.abs(got - want) <= eps
	elseif typeof(want) == "table" then
		ok = true
		for i = 1, #want do
			if math.abs(got[i] - want[i]) > 1e-9 then
				ok = false
				break
			end
		end
	else
		ok = got == want
	end
	if ok then
		pass += 1
	else
		fail += 1
		table.insert(failures, string.format("%s  got=%s want=%s", label, tostring(got), tostring(want)))
	end
end

-- rnd -------------------------------------------------------------------
for _, sc in vectors.vectors.rnd.seeds do
	local rng = Prng.mulberry32(sc.seed)
	local got = {}
	for i = 1, 10 do
		got[i] = Prng.Rnd(rng, sc.lo, sc.hi)
	end
	check(`rnd(seed={sc.seed}, {sc.lo}..{sc.hi})`, got, sc.first10)
end

-- health pool -----------------------------------------------------------
check("healthPool default", Formulas.healthPool(), 10000)
check("healthPool(1)", Formulas.healthPool(1), 5000)
check("healthPool charHealth 92", Formulas.healthPool(2, 92), 9200)

-- strike damage ---------------------------------------------------------
for _, c in vectors.vectors.strike_damage.cases do
	-- 1-indexed like the source: slot 2 is Strength, slot 1 is unused
	local stats: { number } = {}
	stats[Formulas.STAT.Strength] = c.strength
	check(`strike(strength={c.strength}, mult={c.mult}, special={c.special})`, Formulas.strikeDamage(stats, c.mult, c.special), c.expected)
end

-- poise -----------------------------------------------------------------
for _, c in vectors.vectors.poise.cases do
	check(`poise(pain={c.pain}, toughness={c.toughness})`, Formulas.poiseDamage(c.pain, c.toughness), c.expected, 1e-9)
end

-- special meter ---------------------------------------------------------
do
	local seed = vectors.vectors.special_meter.cases[1].seed
	local rng = Prng.mulberry32(seed)
	for _, c in vectors.vectors.special_meter.cases do
		local roll = Prng.Rnd(rng, 0, 100)
		check(`special(pop={c.popularity})`, Formulas.specialMeter(c.popularity, roll), c.expected)
	end
end

-- contest chance --------------------------------------------------------
for _, c in vectors.vectors.contest_chance.cases do
	check(
		`contest(atk={c.atkStat}, def={c.defSkill}, size={c.sizeDiff}, runUp={c.runUp})`,
		Formulas.contestChance(c.atkStat, c.defSkill, c.sizeDiff, c.runUp),
		c.expected,
		1e-9
	)
end

-- character worth -------------------------------------------------------
for _, c in vectors.vectors.char_worth.cases do
	check(
		string.format("worth(avg=%d, fed=%d, inj=%s, champ=%d, booker=%s)", c.statAvg, c.fed, tostring(c.injured), c.champ, tostring(c.booker)),
		Formulas.charWorth({
			statAverage = c.statAvg,
			fed = c.fed,
			injured = c.injured,
			championship = c.champ,
			booker = c.booker,
		}),
		c.expected
	)
end

print(string.format("Luau conformance: %d passed, %d failed", pass, fail))
if fail > 0 then
	for i, f in failures do
		if i > 25 then
			print(string.format("... and %d more", #failures - 25))
			break
		end
		print("  FAIL " .. f)
	end
	error("conformance failed")
end
print("parity with the TypeScript sim: OK")

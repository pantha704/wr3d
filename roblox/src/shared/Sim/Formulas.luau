--!strict
-- Core formulas, transcribed from the decompiled ActionScript.
-- Mirrors web/src/sim/formulas.ts exactly; both must pass shared/vectors.

local Formulas = {}

-- MainTimeline.as:131372 textStat
Formulas.STAT = {
	Popularity = 1,
	Strength = 2,
	Skill = 3,
	Agility = 4,
	Stamina = 5,
	Toughness = 6,
	Attitude = 7,
	Happiness = 8,
}

Formulas.DEFAULT_OPT_LENGTH = 2 -- MainTimeline.as:131183
Formulas.HP_PER_LENGTH = 5000 -- MainTimeline.as:53739
Formulas.FRAME_RATE = 18 -- MainTimeline.as:131192

-- MainTimeline.as:53739 — pHealth = optLength * 5000 (then scaled by charHealth/100)
function Formulas.healthPool(optLength: number?, charHealth: number?): number
	local length = optLength or Formulas.DEFAULT_OPT_LENGTH
	local hp = charHealth or 100
	return math.floor(length * Formulas.HP_PER_LENGTH * (hp / 100))
end

-- MainTimeline.as:97003 — pain = round(Strength * mult), *1.25 while special
function Formulas.strikeDamage(stats: { number }, animMultiplier: number, specialActive: boolean?): number
	local raw = stats[Formulas.STAT.Strength] * animMultiplier
	local pain = math.floor(raw + 0.5)
	if specialActive then
		return math.floor(pain * 1.25 + 0.5)
	end
	return pain
end

-- MainTimeline.as:97219 — pHP -= pain/50 * (150 - Toughness)
function Formulas.poiseDamage(pain: number, toughness: number): number
	return (pain / 50) * (150 - toughness)
end

function Formulas.poiseCap(health: number): number
	return health / 5
end

-- MainTimeline.as:57230 — pSpecial = 100 + Popularity + Rnd(0,100)
function Formulas.specialMeter(popularity: number, roll: number): number
	return 100 + popularity + roll
end

-- MainTimeline.as:67944-67958 — universal contest template
function Formulas.contestChance(
	attackerStat: number,
	defenderSkill: number,
	sizeDifference: number,
	runUp: boolean?
): number
	local chance = attackerStat + (150 - defenderSkill)
	chance *= sizeDifference
	if runUp then
		chance *= 0.75
	end
	return chance
end

-- MainTimeline.as:114779-114821 — CalculateWorth
function Formulas.charWorth(input: {
	statAverage: number,
	fed: number?,
	injured: boolean?,
	championship: number?,
	booker: boolean?,
}): number
	local chunk = math.max(15, input.statAverage - 40)
	local worth = chunk * chunk * (chunk / 15)
	local fed = input.fed or 0
	if fed == 7 then
		worth /= 2
	end
	if fed == 8 then
		worth *= 1.5
	end
	if input.injured then
		worth *= 0.75
	end
	local champ = input.championship or 0
	if champ == 1 then
		worth *= 1.5
	elseif champ == 2 or champ == 3 then
		worth *= 1.25
	end
	if input.booker then
		worth *= 1.5
	end
	local rounded = math.floor(worth / 10 + 0.5) * 10
	return math.max(100, rounded)
end

-- MainTimeline.as:56024-56051 — live stat rescaling, per frame
function Formulas.rescaleStats(charStats: { number }, healthPercent: number, specialActive: boolean?): { number }
	local out = table.clone(charStats)
	for i = Formulas.STAT.Strength, Formulas.STAT.Toughness do
		local base = charStats[i] * (0.75 + healthPercent / 4)
		local v = if specialActive then base * 1.25 else base
		out[i] = math.min(98, math.floor(v * 1000) / 1000)
	end
	return out
end

return Formulas

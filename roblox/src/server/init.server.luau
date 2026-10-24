--!strict
-- Server-authoritative match service (skeleton).
-- The sim runs only here; clients receive snapshots. See docs/BUILD-PLAN.md §3.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Sim = Shared:WaitForChild("Sim")
local Formulas = require(Sim:WaitForChild("Formulas"))
local Prng = require(Sim:WaitForChild("Prng"))

local TICK_HZ = Formulas.FRAME_RATE -- 18 Hz, MainTimeline.as:131192
local TICK_DT = 1 / TICK_HZ

type Fighter = {
	id: number,
	name: string,
	charStats: { number },
	stats: { number },
	health: number,
	maxHealth: number,
	poise: number,
	downTimer: number,
	special: number,
}

local MatchService = {}

local rng = Prng.mulberry32(os.time())

local function statVector(seed: number): { number }
	local v = {}
	for i = 1, 8 do
		v[i] = 60 + (seed * 7 + i * 13) % 36
	end
	return v
end

function MatchService.createFighter(id: number, name: string): Fighter
	local stats = statVector(id)
	local maxHealth = Formulas.healthPool(nil, 100)
	return {
		id = id,
		name = name,
		charStats = stats,
		stats = table.clone(stats),
		health = maxHealth,
		maxHealth = maxHealth,
		poise = 1000, -- POISE_START, mirrors web/src/sim/match.ts
		downTimer = 0,
		special = 0,
	}
end

function MatchService.strike(attacker: Fighter, defender: Fighter, mult: number)
	local pain = Formulas.strikeDamage(attacker.stats, mult, attacker.special > 0)
	defender.health = math.max(0, defender.health - pain)
	defender.downTimer = pain
	defender.poise -= Formulas.poiseDamage(pain, defender.stats[Formulas.STAT.Toughness])
	local cap = Formulas.poiseCap(defender.health)
	if defender.poise > cap then
		defender.poise = cap
	end
	if defender.poise <= 0 then
		defender.poise = 0
		-- knockdown: hand control to the pin state machine (not yet ported)
	end
	return pain
end

-- Fixed-tick accumulator: the sim never runs per rendered frame.
local accumulator = 0
RunService.Heartbeat:Connect(function(dt)
	accumulator += dt
	while accumulator >= TICK_DT do
		accumulator -= TICK_DT
		-- step every active match here once matchmaking lands
	end
end)

Players.PlayerAdded:Connect(function(player)
	player:SetAttribute("WR3D_TickHz", TICK_HZ)
end)

print(`[WR3D] server up · sim tick {TICK_HZ} Hz · rng seeded {os.time()}`)

return MatchService

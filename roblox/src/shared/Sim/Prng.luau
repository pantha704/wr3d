--!strict
-- Deterministic PRNG for the WR3D sim.
-- Must stay bit-identical to web/src/sim/prng.ts and tools/gen_vectors.py.

local Prng = {}

local TWO32 = 4294967296

-- Exact 32-bit multiply (Luau numbers are doubles; a*b overflows 2^53).
local function imul(a: number, b: number): number
	local aLo = a % 65536
	local aHi = math.floor(a / 65536)
	local bLo = b % 65536
	local bHi = math.floor(b / 65536)
	local lo = aLo * bLo
	local mid = (((aHi * bLo) % 65536) + ((aLo * bHi) % 65536)) * 65536
	return (lo + mid) % TWO32
end

local function bor(a: number, b: number): number
	return bit32.bor(a, b)
end

local function bxor(a: number, b: number): number
	return bit32.bxor(a, b)
end

local function rshift(a: number, n: number): number
	return bit32.rshift(a % TWO32, n)
end

export type Rng = () -> number

function Prng.mulberry32(seed: number): Rng
	local a = seed % TWO32
	return function(): number
		a = (a + 0x6D2B79F5) % TWO32
		local t = a
		t = imul(bxor(t, rshift(t, 15)), bor(t, 1))
		t = bxor(t, (t + imul(bxor(t, rshift(t, 7)), bor(t, 61))) % TWO32)
		return bxor(t, rshift(t, 14)) / TWO32
	end
end

-- ActionScript Math.round: half-up toward +Infinity.
function Prng.jsRound(x: number): number
	return math.floor(x + 0.5)
end

-- MainTimeline.as:3313 -> Math.round(Math.random() * (max - min)) + min
function Prng.Rnd(rng: Rng, min: number, max: number): number
	return Prng.jsRound(rng() * (max - min)) + min
end

function Prng.RndOr(rng: Rng, optionA: number, optionB: number): number
	return if Prng.jsRound(rng()) == 0 then optionA else optionB
end

return Prng

--!strict
-- Client: renders HUD from server snapshots, interpolates between ticks.
-- The 18 Hz sim must never be ticked here.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Formulas = require(Shared:WaitForChild("Sim"):WaitForChild("Formulas"))

local screenGui = Instance.new("ScreenGui")
screenGui.Name = "WR3DHud"
screenGui.ResetOnSpawn = false
screenGui.Parent = player:WaitForChild("PlayerGui")

local label = Instance.new("TextLabel")
label.Size = UDim2.fromScale(0.28, 0.12)
label.Position = UDim2.fromScale(0.02, 0.02)
label.BackgroundTransparency = 0.35
label.BackgroundColor3 = Color3.fromRGB(16, 16, 20)
label.TextColor3 = Color3.fromRGB(232, 230, 227)
label.Font = Enum.Font.Code
label.TextSize = 14
label.TextXAlignment = Enum.TextXAlignment.Left
label.Text = string.format("WR3D grey-box\nsim %d Hz\nawaiting snapshot", Formulas.FRAME_RATE)
label.Parent = screenGui

-- Placeholder for the snapshot stream; wire to the server's RemoteEvent.
player:SetAttribute("WR3D_ClientReady", true)
print(`[WR3D] client ready · sim {Formulas.FRAME_RATE} Hz (server-authoritative)`)

function kick(reason: string) {
  return `local Players = game:GetService("Players")
local LocalPlayer = Players.LocalPlayer
if LocalPlayer then
    LocalPlayer:Kick("[Kingmor] ${reason}")
end
return`;
}

export function wrapLua(opts: {
  base: string;
  scriptId: string;
  source: string;
  key: string;
  freeMode: boolean;
}) {
  const { base, scriptId, source, key, freeMode } = opts;
  if (freeMode) {
    return `-- Kingmor Protection System
local _km_hwid = ""
pcall(function()
    _km_hwid = tostring(game:GetService("RbxAnalyticsService"):GetClientId())
end)
pcall(function()
    game:HttpGet("${base}/api/hwid/check?scriptId=${scriptId}&hwid=" .. _km_hwid)
end)

-- User script
${source}`;
  }

  return `-- Kingmor Protection System
local _km_HttpService = game:GetService("HttpService")
local _km_Players = game:GetService("Players")
local _km_lp = _km_Players.LocalPlayer

local _km_hwid = ""
pcall(function()
    _km_hwid = tostring(game:GetService("RbxAnalyticsService"):GetClientId())
end)

local _km_key = "${key}"
local _km_checkUrl = "${base}/api/hwid/check?scriptId=${scriptId}&key=" .. _km_key .. "&hwid=" .. _km_hwid

local _km_success, _km_body = pcall(function()
    return game:HttpGet(_km_checkUrl)
end)

if not _km_success or not _km_body then
    _km_lp:Kick("[Kingmor] HWID Check Failed")
    return
end

local _km_data = _km_HttpService:JSONDecode(_km_body)
if not _km_data or not _km_data.valid then
    local _km_reason = (type(_km_data) == "table" and _km_data.reason) or "Invalid Key"
    _km_lp:Kick("[Kingmor] " .. _km_reason)
    return
end

-- User script
${source}`;
}

export { kick };

export function isExecutorRequest(ua: string) {
  return /Roblox|Lua|Synapse|Krnl|Fluxus|Hydrogen|ScriptWare|Electron/i.test(ua);
}

export function getBaseUrl(request: Request) {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

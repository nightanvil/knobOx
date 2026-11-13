-- knobOx probe: shows on the E16 display which Lua events and APIs arrive.
--
-- Title at start: H/C/M/S/G = setHoldTime, clock, midi.listen, store, controller.get
-- (1 = present, 0 = missing). After that the title shows the last event.
--
-- Page 1: encoder i = turn id i, push id 16+i. Pushes 1-8 use mode Press only,
--   pushes 9-16 mode Press + Release.
--   Labels: t<scaled> turn, *<scaled> turn while pushed, P<n> press,
--   R<tenths of s> release, HOLD hold. Turns while pushed are only tracked with API 1.3.
--   Title: T<id> i<increment> s<scaled> [H<count of turns while pushed>]
--          P<id> #<presses> tk<tick>
--          R<id> <held_ms from firmware> d<ms measured between press and release>
-- Page 2: encoder 1 = turn id 200 / push 201, encoder 2 = turn 50 / push 51,
--   encoder 3 = manual turn id 52 (label m<0-31>) / push 53.
--   Slots 9-12: clock pulses, transport, source, BPM. 13-16: note, velocity, CC, value.
--
--@assign id=1 abbr="T1" name="Turn 1"
--@assign id=2 abbr="T2" name="Turn 2"
--@assign id=3 abbr="T3" name="Turn 3"
--@assign id=4 abbr="T4" name="Turn 4"
--@assign id=5 abbr="T5" name="Turn 5"
--@assign id=6 abbr="T6" name="Turn 6"
--@assign id=7 abbr="T7" name="Turn 7"
--@assign id=8 abbr="T8" name="Turn 8"
--@assign id=9 abbr="T9" name="Turn 9"
--@assign id=10 abbr="T10" name="Turn 10"
--@assign id=11 abbr="T11" name="Turn 11"
--@assign id=12 abbr="T12" name="Turn 12"
--@assign id=13 abbr="T13" name="Turn 13"
--@assign id=14 abbr="T14" name="Turn 14"
--@assign id=15 abbr="T15" name="Turn 15"
--@assign id=16 abbr="T16" name="Turn 16"
--@assign id=50 abbr="I50" name="Turn 50"
--@assign id=52 abbr="Man" name="Manual 52" manual=true
--@assign id=200 abbr="I200" name="Turn 200"

local P1, P2 = {}, {}
local tk, pend, cur = 0, nil, 1
local pressTk, pressN, held, ht = {}, {}, {}, 0
local pul, mv = 0, 8192
local api13 = controller.setHoldTime ~= nil
local log = print or function() end

local function title(s)
  pend = s
  log(s)
end

local function draw()
  local L = cur == 1 and P1 or cur == 2 and P2 or nil
  for i = 1, 16 do
    if L and L[i] then slots.update(i, L[i]) else slots.reset(i) end
  end
end

local function put(pg, i, s)
  local L = pg == 1 and P1 or pg == 2 and P2 or nil
  if not L or i < 1 or i > 16 then return end
  L[i] = s:sub(1, 4)
  if pg == cur then slots.update(i, L[i]) end
end

local function int(x)
  return type(x) == "number" and math.floor(x) or -1
end

function controller.onEncoderTurn(enc)
  local pg, i, id = enc.page or cur, enc.index or 0, enc.id or -1
  local inc = enc.increment or 0
  if id == 52 then
    mv = mv + inc * 512
    if mv < 0 then mv = 0 elseif mv > 16383 then mv = 16383 end
    controller.set(52, "v", mv)
    put(pg, i, "m" .. mv // 512)
    title("M52 i" .. inc .. " v" .. int(enc.value))
    return
  end
  local h = held[pg * 100 + i]
  if h then ht = ht + 1 end
  local sc = int(enc.scaled)
  put(pg, i, (h and "*" or "t") .. sc)
  title("T" .. id .. " i" .. inc .. " s" .. sc .. (h and " H" .. ht or ""))
end

function controller.onEncoderPress(enc)
  local pg, i, id = enc.page or cur, enc.index or 0, enc.id or -1
  local k = pg * 100 + i
  held[k] = api13 or nil
  pressTk[k] = tk
  pressN[k] = (pressN[k] or 0) + 1
  put(pg, i, "P" .. pressN[k] % 1000)
  title("P" .. id .. " #" .. pressN[k] .. " tk" .. tk)
end

function controller.onEncoderRelease(enc, ms)
  local pg, i, id = enc.page or cur, enc.index or 0, enc.id or -1
  local k = pg * 100 + i
  local hm = int(enc.held_ms or ms)
  local d = (tk - (pressTk[k] or tk)) * 50
  held[k] = nil
  put(pg, i, "R" .. math.min(hm // 100, 999))
  title("R" .. id .. " " .. hm .. " d" .. d)
end

function controller.onEncoderHold(enc)
  put(enc.page or cur, enc.index or 0, "HOLD")
  title("H" .. (enc.id or -1))
end

function page.onPageChange(prev, curr)
  cur = curr
  draw()
  title("Page " .. curr)
end

local function setupClock()
  function clock.onPulse(b, pos, s)
    pul = pul + 1
    put(2, 9, "C" .. pul % 1000)
    put(2, 11, "s" .. int(s))
  end
  function clock.onStart(s) put(2, 10, "PLAY") put(2, 11, "s" .. int(s)) end
  function clock.onStop(s) put(2, 10, "STOP") end
  function clock.onContinue(s) put(2, 10, "CONT") put(2, 11, "s" .. int(s)) end
  clock.listen(true, 4)
end

local function setupMidi()
  function midi.onNote(port, ch, n, v)
    put(2, 13, "n" .. int(n))
    put(2, 14, "v" .. int(v))
    title("N" .. int(n) .. " v" .. int(v) .. " c" .. int(ch) .. " p" .. int(port))
  end
  function midi.onCC(port, ch, c, v)
    put(2, 15, "c" .. int(c))
    put(2, 16, "=" .. int(v))
    title("CC" .. int(c) .. " =" .. int(v) .. " c" .. int(ch) .. " p" .. int(port))
  end
  midi.listen({ notes = true, cc = true })
end

function page.onInit()
  cur = controller.getPage() or 1
  local f = (controller.setHoldTime and "H1" or "H0") .. (clock and " C1" or " C0")
    .. (midi.listen and " M1" or " M0") .. (store and " S1" or " S0")
    .. (controller.get and " G1" or " G0")
  if controller.setHoldTime then pcall(controller.setHoldTime, 600) end
  pcall(controller.set, 52, { manual = true, v = mv })
  if clock and not pcall(setupClock) then f = f .. "!" end
  if midi.listen and not pcall(setupMidi) then f = f .. "?" end
  P2[9], P2[10], P2[11], P2[12] = "C-", "----", "s-", "b-"
  P2[13], P2[14], P2[15], P2[16] = "n-", "v-", "c-", "=-"
  draw()
  title(f)
  system.setUpdateRate(50)
end

-- The title is only set from the update tick: setTitle inside callbacks can freeze the header.
function system.update()
  tk = tk + 1
  if pend then
    page.setTitle(pend:sub(1, 15))
    pend = nil
  end
  if cur == 2 and tk % 20 == 0 and clock and clock.getBpm then
    local ok, b = pcall(clock.getBpm)
    if ok and type(b) == "number" then put(2, 12, "b" .. math.floor(b)) end
  end
end

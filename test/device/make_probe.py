#!/usr/bin/env python3
"""Builds probe.oxie16 from probe.lua: a scene whose encoders are wired to the probe script."""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "probe.lua"
OUT = HERE / "probe.oxie16"


def turn(kind=0, script_id=0, lower=0, upper=127):
    return {
        "instrument": 127, "parameter": 0, "type": kind, "display": 10, "mode": 14,
        "channel": 0, "lower": lower, "upper": upper, "defaultValue": 0,
        "nr1": 0, "nr2": 0, "output": 12, "scriptId": script_id,
    }


def push(kind=0, script_id=0, mode=0):
    return {
        "instrument": 127, "parameter": 0, "type": kind, "display": 0, "mode": mode,
        "channel": 0, "lower": 0, "upper": 0, "nr1": 0, "nr2": 0, "output": 15,
        "scriptId": script_id,
    }


def encoder(abbr="", turn_id=0, push_id=0, push_mode=0, color=0):
    return {
        "name": abbr, "abbr": abbr, "color": color,
        "push_action": push(12 if push_id else 0, push_id, push_mode),
        "turn_actions": [turn(11 if turn_id else 0, turn_id), turn()],
        "color2": 0,
    }


def page(title, encoders):
    return {"title": title, "output": 0, "channel": 1, "encoders": encoders}


def minify(lua):
    # Drops full-line comments, indentation and empty lines; no string literal in probe.lua starts a line with "--".
    lines = (l.strip() for l in lua.splitlines())
    return "\n".join(l for l in lines if l and not l.startswith("--"))


def main():
    lua = SRC.read_text(encoding="utf-8")
    code = minify(lua)

    # Page 1: turn ids 1-16, push ids 17-32; pushes 9-16 use mode 1 (Press + Release).
    p1 = [encoder(f"T{i}", i, 16 + i, 0 if i <= 8 else 1, 18 if i <= 8 else 50) for i in range(1, 17)]
    # Page 2: high script ids, a manual control, display slots for clock and MIDI input.
    p2 = [encoder("I200", 200, 201, 0, 34), encoder("I50", 50, 51, 0, 34), encoder("Man", 52, 53, 0, 6)]
    p2 += [encoder() for _ in range(13)]
    pages = [page("Events", p1), page("IDs+In", p2)]
    pages += [page(f"P.{n}", [encoder() for _ in range(16)]) for n in range(3, 13)]

    scene = {
        "title": "knobOx Probe", "icon": "list", "selectedPreset": 0, "color": 82,
        "transmitMode": 0, "pcOnEntry": 0, "bankOnEntry": 65535, "recentPage": 0,
        "recentPreset": 0, "transmitOnSceneEntry": 0, "transmitOnPageSwitch": 0,
        "transmitOnPresetLoad": 0, "smartTransmit": 15, "outputOnEntry": 0,
        "holdMode": 0, "acceleration": 3,
        "code": {"code": code, "fullScript": lua.replace("\n", "\r\n"), "scriptName": "knobox_probe"},
        "pages": pages,
    }
    OUT.write_text(json.dumps(scene, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{OUT.name}: script {len(code.encode('utf-8'))} bytes (limit 8000)")


if __name__ == "__main__":
    main()

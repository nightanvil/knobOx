/*
 * Script modules: ready-made E16 Lua functions that are configured with forms instead of code.
 *
 *   parse(scene)                      -> module configuration stored in the scene, or null
 *   foreignScript(scene)              -> true if the scene carries a script that knobOx did not generate
 *   refresh(scene, config)            -> updates module positions from the wiring in the scene
 *   build(scene, config, pageChannel) -> writes the Lua script and wires the encoders; returns { bytes }
 *
 * The configuration lives as one JSON comment line in code.fullScript ("--@knobox {...}"). The uploaded
 * code.code is generated from it. Module encoders use script IDs from ID_BASE on; every build first
 * unwires all script actions in that range, then wires the current modules again.
 * Works in the browser (window.E16Modules) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  const MARK = '--@knobox ';
  const ID_BASE = 100, ID_MAX = 199;
  const SCRIPT_LIMIT = 8000;   // upload limit of the OXI App for code.code
  const SCRIPT_NAME_LEN = 18;  // scriptName field in the scene header
  const VERSION = 1;

  /* Printable ASCII only (the E16 font), at most n characters. */
  function label(s, n) { return String(s || '').replace(/[^\x20-\x7e]/g, '').slice(0, n); }
  /*
   * Script name for generated code: "kx_<title>_<hash>", at most 18 characters. The hash of the code makes
   * the name change with every different script, so a name found on the E16 identifies exactly one version
   * in the script library.
   */
  function scriptName(title, code) {
    let h = 0x811c9dc5;
    for (let i = 0; i < code.length; i++) { h ^= code.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    const slug = String(title || '').replace(/[^A-Za-z0-9]/g, '').slice(0, SCRIPT_NAME_LEN - 10) || 'scene';
    return 'kx_' + slug + '_' + h.toString(16).padStart(8, '0').slice(0, 6);
  }
  function luaStr(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
  function clamp(v, lo, hi) { v = Math.round(Number(v)); return Number.isNaN(v) ? lo : Math.max(lo, Math.min(hi, v)); }

  /*
   * Module types. Per type:
   *   label, desc     shown in the UI
   *   fields          form fields: { key, label, kind: 'num' | 'text' | 'channel', min, max, len, hint }
   *   defaults(enc)   initial configuration for an encoder
   *   ids             number of script IDs per module (turn id = first, push id = second)
   *   lua             Lua code shared by all modules of this type (defines the handler table)
   *   entry(m, ctx)   Lua table literal for one module
   *   wire(enc, m, ids)  sets the encoder's actions to Script with the module's IDs
   *   assign(m, ids, n)  --@assign lines for the OXI App
   */
  const TYPES = {
    shift: {
      label: 'Shift layer',
      desc: 'Turning sends CC A. Turning while the encoder is pushed sends CC B. Each layer keeps its own value, the ring shows the active one. The encoder\'s push and Dest 2 are used by the module.',
      fields: [
        { key: 'ch', label: 'Channel', kind: 'channel' },
        { key: 'ccA', label: 'CC A (turn)', kind: 'num', min: 0, max: 127 },
        { key: 'ccB', label: 'CC B (push + turn)', kind: 'num', min: 0, max: 127 },
        { key: 'valA', label: 'Start value A', kind: 'num', min: 0, max: 127, hint: 'Value of layer A when the scene is loaded' },
        { key: 'valB', label: 'Start value B', kind: 'num', min: 0, max: 127, hint: 'Value of layer B when the scene is loaded' },
        { key: 'labelA', label: 'Label A', kind: 'text', len: 4, hint: 'Shown on the E16 normally (the encoder\'s Abbr)' },
        { key: 'labelB', label: 'Label B', kind: 'text', len: 4, hint: 'Shown on the E16 while the encoder is pushed. Empty: no change' },
      ],
      defaults: enc => {
        const d1 = (enc.turn_actions || [])[0] || {};
        const cc = d1.nr1 >= 0 && d1.nr1 <= 126 ? d1.nr1 : 1;
        return { ch: 0, ccA: cc, ccB: cc + 1, valA: 0, valB: 0, labelA: label(enc.abbr, 4), labelB: '' };
      },
      ids: 2,
      lua: [
        'local SH={}',
        'function SH.init(m) controller.set(m.t,{manual=true,l=0,h=127,v=m.a[2]*129}) end',
        'function SH.turn(m,e) local i=e.increment or 0 if i==0 then return end',
        ' local l=m.h and m.b or m.a l[2]=cl(l[2]+i) midi.sendCC(0,m.c,l[1],l[2]) controller.set(m.t,"v",l[2]*129) end',
        'function SH.press(m) m.h=true controller.set(m.t,"v",m.b[2]*129)',
        ' if m.lb~="" and controller.getPage()==m.g then slots.update(m.x,m.lb) end end',
        'function SH.release(m) m.h=false controller.set(m.t,"v",m.a[2]*129) if m.lb~="" then slots.reset(m.x) end end',
      ].join('\n'),
      entry: (m, ctx) => '{k=SH,t=' + ctx.ids[0] + ',p=' + ctx.ids[1] + ',c=' + (ctx.channel - 1) + ',g=' + (m.page + 1) + ',x=' + (m.enc + 1)
        + ',a={' + clamp(m.ccA, 0, 127) + ',' + clamp(m.valA, 0, 127) + '},b={' + clamp(m.ccB, 0, 127) + ',' + clamp(m.valB, 0, 127) + '}'
        + ',lb=' + luaStr(label(m.labelB, 4)) + '}',
      wire: (enc, m, ids) => {
        const t = enc.turn_actions[0];
        Object.assign(t, { type: 11, scriptId: ids[0], lower: 0, upper: 127 });
        if (enc.turn_actions[1]) Object.assign(enc.turn_actions[1], { type: 0, scriptId: 0 });
        Object.assign(enc.push_action, { type: 12, scriptId: ids[1] });
        const a = label(m.labelA, 4);
        if (a) { enc.abbr = a; enc.name = a; }
      },
      assign: (m, ids, n) => [
        '--@assign id=' + ids[0] + ' abbr=' + luaStr(label(m.labelA, 4) || 'Sh' + n) + ' name=' + luaStr('Shift ' + n + ' turn') + ' l=0 h=127 manual=true g=' + n,
        '--@assign id=' + ids[1] + ' abbr=' + luaStr(label(m.labelA, 4) || 'Sh' + n) + ' name=' + luaStr('Shift ' + n + ' push') + ' p=true g=' + n,
      ],
    },
  };

  function parse(scene) {
    const full = scene && scene.code && scene.code.fullScript;
    if (!full) return null;
    const line = String(full).split(/\r?\n/).find(l => l.startsWith(MARK));
    if (!line) return null;
    try {
      const cfg = JSON.parse(line.slice(MARK.length));
      return cfg && Array.isArray(cfg.modules) ? cfg : null;
    } catch (e) { return null; }
  }

  function foreignScript(scene) {
    const c = scene && scene.code;
    return !!(c && (c.code || c.fullScript) && !parse(scene));
  }

  function emptyConfig() { return { v: VERSION, modules: [] }; }

  /* New module of a type for an encoder (0-based page and encoder index). */
  function create(type, scene, page, enc) {
    const t = TYPES[type];
    return Object.assign({ type, page, enc }, t.defaults(scene.pages[page].encoders[enc]));
  }

  function idsFor(config) {
    let next = ID_BASE;
    return config.modules.map(m => {
      const n = TYPES[m.type] ? TYPES[m.type].ids : 0;
      const ids = [];
      for (let k = 0; k < n; k++) ids.push(next++);
      return ids;
    });
  }

  function unwire(scene) {
    const ours = id => id >= ID_BASE && id <= ID_MAX;
    scene.pages.forEach(p => p.encoders.forEach(e => {
      (e.turn_actions || []).forEach(a => { if (a && a.type === 11 && ours(a.scriptId)) { a.type = 0; a.scriptId = 0; } });
      const pa = e.push_action;
      if (pa && pa.type === 12 && ours(pa.scriptId)) { pa.type = 0; pa.scriptId = 0; }
    }));
  }

  /*
   * Encoders can move (Pages swapped, encoders dragged or pasted). A module follows the encoder that
   * carries its turn script ID; if that ID is nowhere in the scene, the module keeps its position.
   */
  function relocate(scene, mods, ids) {
    mods.forEach((m, i) => {
      const id = ids[i][0];
      const at = scene.pages[m.page] && scene.pages[m.page].encoders[m.enc];
      const has = e => e && (e.turn_actions || []).some(a => a && a.type === 11 && a.scriptId === id);
      if (has(at)) return;
      for (let p = 0; p < scene.pages.length; p++) {
        const e = scene.pages[p].encoders.findIndex(has);
        if (e >= 0) { m.page = p; m.enc = e; return; }
      }
    });
  }

  /* Lua code for the configuration, without comments. */
  function generate(scene, config, pageChannel) {
    const mods = config.modules.filter(m => TYPES[m.type]);
    if (!mods.length) return '';
    const ids = idsFor({ modules: mods });
    const used = [...new Set(mods.map(m => m.type))];
    const entries = mods.map((m, i) => {
      const ch = m.ch > 0 ? m.ch : pageChannel(m.page);
      return TYPES[m.type].entry(m, { ids: ids[i], channel: clamp(ch, 1, 16) });
    });
    return [
      'local function cl(v) return v<0 and 0 or v>127 and 127 or v end',
      ...used.map(t => TYPES[t].lua),
      'local M={' + entries.join(',\n') + '}',
      'local T,P={},{}',
      'for _,m in ipairs(M) do if m.t then T[m.t]=m end if m.p then P[m.p]=m end end',
      'function page.onInit() for _,m in ipairs(M) do if m.k.init then m.k.init(m) end end end',
      'function controller.onEncoderTurn(e) local m=T[e.id] if m and m.k.turn then m.k.turn(m,e) end end',
      'function controller.onEncoderPress(e) local m=P[e.id] if m and m.k.press then m.k.press(m,e) end end',
      'function controller.onEncoderRelease(e) local m=P[e.id] if m and m.k.release then m.k.release(m,e) end end',
    ].join('\n') + '\n';
  }

  /*
   * Writes the configuration into the scene: unwires old module encoders, wires the current ones and
   * replaces the script. With no modules left, the script is removed.
   */
  function build(scene, config, pageChannel, opts) {
    let mods = config.modules.filter(m => TYPES[m.type]);
    if (!opts || opts.relocate !== false) relocate(scene, mods, idsFor({ modules: mods }));
    unwire(scene);
    mods = mods.filter(m => scene.pages[m.page] && scene.pages[m.page].encoders[m.enc]);
    const ids = idsFor({ modules: mods });
    mods.forEach((m, i) => TYPES[m.type].wire(scene.pages[m.page].encoders[m.enc], m, ids[i]));
    const code = generate(scene, { modules: mods }, pageChannel);
    if (!code) {
      scene.code = { code: '', fullScript: '', scriptName: '' };
      return { bytes: 0 };
    }
    const cfg = { v: VERSION, modules: mods };
    const assigns = mods.flatMap((m, i) => TYPES[m.type].assign(m, ids[i], i + 1));
    const full = [
      '-- Generated by knobOx (Modules tab). Edit the modules in knobOx; changes made here are overwritten.',
      MARK + JSON.stringify(cfg),
      ...assigns,
      '',
      code,
    ].join('\n');
    scene.code = { code, fullScript: full.replace(/\r?\n/g, '\r\n'), scriptName: scriptName(scene.title, code) };
    return { bytes: new TextEncoder().encode(code).length };
  }

  /* Module that drives an encoder (0-based page and index), or null. */
  function moduleAt(config, page, enc) {
    return config ? config.modules.find(m => m.page === page && m.enc === enc) || null : null;
  }

  function refresh(scene, config) {
    const mods = config.modules.filter(m => TYPES[m.type]);
    relocate(scene, mods, idsFor({ modules: mods }));
  }

  const api = { refresh, scriptName, TYPES, MARK, ID_BASE, ID_MAX, SCRIPT_LIMIT, parse, foreignScript, emptyConfig, create, build, generate, moduleAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.E16Modules = api;
})(typeof window !== 'undefined' ? window : globalThis);

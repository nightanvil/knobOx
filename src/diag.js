/*
 * Diagnostic log: a ring buffer of timestamped entries kept in memory only.
 * Nothing is sent anywhere; the user copies, shares or downloads the text from the help overlay.
 * Uncaught errors and unhandled promise rejections are recorded automatically.
 */
(function (root) {
  'use strict';
  const MAX = 800;
  const entries = [];
  const t0 = Date.now();

  function stamp() {
    const ms = Date.now() - t0;
    return '+' + (ms / 1000).toFixed(3).padStart(8, ' ') + 's';
  }

  function fmt(v) {
    if (v === undefined) return '';
    if (v instanceof Error) return v.name + ': ' + v.message + (v.stack ? '\n    ' + String(v.stack).split('\n').slice(0, 6).join('\n    ') : '');
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }

  function log(cat, msg, detail) {
    entries.push(stamp() + ' [' + cat + '] ' + fmt(msg) + (detail !== undefined ? ' ' + fmt(detail) : ''));
    if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  }

  /* First n bytes of a byte sequence as hex, plus the total length. */
  function bytes(b, n) {
    if (!b) return String(b);
    const len = b.length;
    const head = [];
    for (let i = 0; i < Math.min(len, n || 16); i++) head.push((b[i] & 0xFF).toString(16).padStart(2, '0'));
    return len + ' B [' + head.join(' ') + (len > (n || 16) ? ' …' : '') + ']';
  }

  function env() {
    const n = root.navigator || {};
    const lines = [
      'knobOx diagnostic log',
      'Time:      ' + new Date().toISOString(),
      'Page:      ' + (root.location ? root.location.href : '?'),
      'Version:   ' + ((root.document && document.getElementById('appVersion')) ? document.getElementById('appVersion').textContent : '?'),
      'UserAgent: ' + (n.userAgent || '?'),
      'Platform:  ' + (n.platform || '?') + (n.maxTouchPoints ? ', touch points ' + n.maxTouchPoints : ''),
      'Secure:    ' + root.isSecureContext,
      'Web MIDI:  ' + (typeof n.requestMIDIAccess),
      'Folders:   ' + (typeof root.showDirectoryPicker),
      'Entries:   ' + entries.length + (entries.length >= MAX ? ' (oldest dropped)' : ''),
    ];
    return lines.join('\n');
  }

  function text() { return env() + '\n\n' + entries.join('\n') + '\n'; }
  function clear() { entries.length = 0; log('diag', 'Log cleared'); }

  if (root.addEventListener) {
    root.addEventListener('error', e => log('error', e.error || (e.message + ' at ' + e.filename + ':' + e.lineno + ':' + e.colno)));
    root.addEventListener('unhandledrejection', e => log('error', 'Unhandled rejection:', e.reason));
  }
  log('diag', 'Page loaded');

  root.E16Diag = { log, bytes, text, clear };
})(typeof window !== 'undefined' ? window : globalThis);

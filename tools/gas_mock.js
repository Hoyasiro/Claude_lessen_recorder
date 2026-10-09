#!/usr/bin/env node
/**
 * Apps Script 코드(apps-script/*.js)를 Node에서 돌려 보기 위한 최소 모의 환경 + HTTP 서버.
 * 시트는 메모리에만 있고 실제 Google 시트에는 아무것도 쓰지 않는다.
 * 사용: node tools/gas_mock.js <snapshot.json> [port]   → http://localhost:<port>/exec 가 웹 앱 주소 역할
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const crypto = require('crypto');

function colNum(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
function fmt(v) {
  if (v === true) return 'TRUE'; if (v === false) return 'FALSE';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v == null ? '' : String(v);
}

class Sheet {
  constructor(name, rows) { this.name = name; this.rows = rows || []; this.fx = {}; }
  cell(r, c) { return (this.rows[r - 1] || [])[c - 1]; }
  set(r, c, v) { while (this.rows.length < r) this.rows.push([]); const row = this.rows[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
  getRange(a, b, nr, nc) {
    let r1, c1, r2, c2;
    if (typeof a === 'string') {
      const m = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(a);
      c1 = colNum(m[1]); r1 = m[2] ? +m[2] : 1; c2 = m[3] ? colNum(m[3]) : c1; r2 = m[4] ? +m[4] : (m[2] && !m[3] ? r1 : Math.max(this.rows.length, 1));
    } else { r1 = a; c1 = b; r2 = a + (nr || 1) - 1; c2 = b + (nc || 1) - 1; }
    return new Range(this, r1, c1, r2, c2);
  }
  getDataRange() { const w = Math.max(1, ...this.rows.map((r) => r.length)); return new Range(this, 1, 1, Math.max(1, this.rows.length), w); }
  getLastRow() { return this.rows.length; }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  appendRow(v) { this.rows.push(v.slice()); }
}
class Range {
  constructor(sh, r1, c1, r2, c2) { Object.assign(this, { sh, r1, c1, r2, c2 }); }
  grid(f) { const out = []; for (let r = this.r1; r <= this.r2; r++) { const row = []; for (let c = this.c1; c <= this.c2; c++) row.push(f(r, c)); out.push(row); } return out; }
  getValues() { return this.grid((r, c) => { const v = this.sh.cell(r, c); return v == null ? '' : v; }); }
  getDisplayValues() { return this.grid((r, c) => this.sh.display(r, c)); }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r1 + i, this.c1 + j, x))); return this; }
  setValue(x) { this.sh.set(this.r1, this.c1, x); return this; }
  setFormulas(v) { return this.setValues(v); }
  setNumberFormat() { return this; }
}

function makeDb(snapshot) {
  const n = require(path.join(__dirname, '..', 'apps-script', 'Normalize.js'));
  const r = n.normalizeLegacy(JSON.parse(fs.readFileSync(snapshot, 'utf8')), { today: '2026-10-09' });
  const status = { P06: '진행중', P08: '진행중', P10: '진행중' };
  const student = (id) => (id === 'P07' ? '엄마아빠' : id === 'P11' ? '엄마' : '준희');
  const programs = new Sheet('programs', [['프로그램ID', '프로그램', '종목', '세부', '대상', '코치', '메모', '상태', '첫 레슨', '마지막 레슨', '레슨 수', '결제 횟수']]
    .concat(r.programs.map((p) => [p.program_id, p.program, p.sport, p.detail, student(p.program_id), p.coach, p.memo, status[p.program_id] || '종료', '', '', '', ''])));
  const lessons = new Sheet('lessons', [['레슨ID', '날짜', '요일', '프로그램ID', '프로그램', '대상', '코치', '결제', '메모', '상태', '원본셀', '진행']]
    .concat(r.lessons.map((l) => [l.lesson_id, l.date, '', l.program_id, l.program, '', l.coach, l.payment, l.note, '', l.source_cell, '완료'])));
  // 시트 수식(요일·대상·상태) 흉내
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const progRow = (id) => programs.rows.find((x) => x[0] === id) || [];
  lessons.display = function (r, c) {
    const row = this.rows[r - 1] || [];
    if (r > 1 && row[0]) {
      if (c === 3) return WEEK[new Date(fmt(row[1]) + 'T00:00:00Z').getUTCDay()];
      if (c === 6) return fmt(progRow(row[3])[4]);
      if (c === 10) return fmt(progRow(row[3])[7]);
    }
    return fmt(row[c - 1]);
  };
  programs.display = function (r, c) { return fmt((this.rows[r - 1] || [])[c - 1]); };
  const sheets = { lessons, programs };
  return {
    sheets,
    getSheetByName: (nm) => sheets[nm] || null,
    insertSheet: (nm) => { sheets[nm] = new Sheet(nm, []); sheets[nm].display = programs.display; return sheets[nm]; }
  };
}

function loadGas(db, base, pushLog) {
  const props = {};
  const ctx = {
    console, BigInt, JSON, Math, Date,
    SpreadsheetApp: { openById: () => db },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log: (...a) => console.log('[gas]', ...a) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    ScriptApp: {
      getProjectTriggers: () => [], deleteTrigger() {},
      newTrigger: () => { const t = { timeBased: () => t, everyDays: () => t, atHour: () => t, nearMinute: () => t, inTimezone: () => t, create: () => t }; return t; },
      getService: () => ({ getUrl: () => base + '/exec' })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => [...crypto.createHash('sha256').update(String(s), 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map((b) => b & 255))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      getUuid: () => crypto.randomUUID(),
      formatDate: () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
    },
    UrlFetchApp: { fetch: (url, opt) => { pushLog.push({ url, auth: opt.headers.Authorization }); return { getResponseCode: () => 201, getContentText: () => '' }; } }
  };
  vm.createContext(ctx);
  for (const f of ['Normalize.js', 'Code.js', 'WebPush.js', 'Api.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8').replace(/if \(typeof module[^\n]*\n?(\s*module\.exports[\s\S]*?\n\})?/g, ''), ctx, { filename: f });
  }
  return { ctx, props };
}

if (require.main === module) {
  const [snapshot, port = '8787'] = process.argv.slice(2);
  const base = 'http://localhost:' + port;
  const db = makeDb(snapshot), pushLog = [];
  const { ctx, props } = loadGas(db, base, pushLog);
  ctx.setup();
  ctx.handle_({ action: 'saveSettings', settings: { programs: { P10: { cycle: 10, short: '필라' }, P06: { short: '패런', slots: [{ dow: 3, time: '19:00' }] } } } });
  http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    const u = new URL(req.url, base);
    if (u.pathname === '/__push') { res.writeHead(200, cors); return res.end(JSON.stringify(pushLog)); }
    if (u.pathname === '/__db') { res.writeHead(200, cors); return res.end(JSON.stringify({ lessons: db.sheets.lessons.rows.slice(-3), subs: (db.sheets.push_subs || {}).rows })); }
    if (u.pathname !== '/exec') { res.writeHead(404); return res.end(); }
    if (req.method === 'GET') { res.writeHead(200, cors); return res.end(ctx.doGet({ parameter: Object.fromEntries(u.searchParams) }).text); }
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => { res.writeHead(200, cors); res.end(ctx.doPost({ postData: { contents: body } }).text); });
  }).listen(+port, () => console.log('mock api on ' + base + '/exec token=' + props.API_TOKEN));
}

module.exports = { makeDb, loadGas };

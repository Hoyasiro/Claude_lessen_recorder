// 레슨 수첩 API (자동 생성 tools/build_gas.js). 처음 한 번: 배포 → 새 배포 → 웹 앱(실행: 나, 액세스: 모든 사용자) → 함수 setup 실행.
var CONFIG = {
  SOURCE_SPREADSHEET_ID: '1zBlSYl_p5X8bN5AwX4RkftcxmMknvGTYwBg4txDRu8U', // 준희 키_v2
  SOURCE_SHEET_NAME: '레슨기록',
  DB_SPREADSHEET_ID: '1T7Asxbs7RtM7V6avTNQQQ-rPFQuX-WLIbEu_8tDp7ts', // 레슨기록_DB (2026-10-08 생성)
  DB_NAME: '레슨기록_DB',
  TZ: 'Asia/Seoul',
  TABS: { LESSONS: 'lessons', PROGRAMS: 'programs', ISSUES: 'migration_issues' }
};
function todayIso_() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd'); }
function lastDataRow_(sheet) {
  var ids = sheet.getRange('A:A').getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (ids[i][0] !== '') return i + 1;
  return 0;
}
var P256 = (function () {
  var P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
  var N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  var A = P - BigInt(3);
  var G = [BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
           BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')];
  var ZERO = BigInt(0), ONE = BigInt(1), TWO = BigInt(2), THREE = BigInt(3);
  function mod(a, m) { var r = a % m; return r < ZERO ? r + m : r; }
  function inv(a, m) { // 확장 유클리드
    var lm = ONE, hm = ZERO, low = mod(a, m), high = m;
    while (low > ONE) { var r = high / low; var nm = hm - lm * r, nw = high - low * r; hm = lm; lm = nm; high = low; low = nw; }
    return mod(lm, m);
  }
  function add(p1, p2) {
    if (!p1) return p2; if (!p2) return p1;
    var l;
    if (p1[0] === p2[0]) {
      if (mod(p1[1] + p2[1], P) === ZERO) return null;
      l = mod((THREE * p1[0] * p1[0] + A) * inv(TWO * p1[1], P), P);
    } else {
      l = mod((p2[1] - p1[1]) * inv(p2[0] - p1[0], P), P);
    }
    var x = mod(l * l - p1[0] - p2[0], P);
    return [x, mod(l * (p1[0] - x) - p1[1], P)];
  }
  function mul(k, pt) {
    var r = null, q = pt;
    while (k > ZERO) { if (k & ONE) r = add(r, q); q = add(q, q); k >>= ONE; }
    return r;
  }
  function toBig(bytes) { var h = '0x'; for (var i = 0; i < bytes.length; i++) h += ((bytes[i] & 255) + 256).toString(16).slice(1); return BigInt(h); }
  function toBytes(v, len) { var h = v.toString(16); while (h.length < len * 2) h = '0' + h; var out = []; for (var i = 0; i < len; i++) out.push(parseInt(h.substr(i * 2, 2), 16)); return out; }
  return {
    N: N,
        publicKey: function (d) { var q = mul(d, G); return [4].concat(toBytes(q[0], 32), toBytes(q[1], 32)); },
        keyFromRandom: function (bytes) { return mod(toBig(bytes), N - ONE) + ONE; },
        sign: function (hash, d, rnd) {
      var e = toBig(hash), k, r, s;
      for (var i = 0; ; i++) {
        k = mod(toBig(rnd) + BigInt(i), N - ONE) + ONE;
        r = mod(mul(k, G)[0], N); if (r === ZERO) continue;
        s = mod(inv(k, N) * (e + r * d), N); if (s === ZERO) continue;
        return toBytes(r, 32).concat(toBytes(s, 32));
      }
    },
    toBytes: toBytes,
    toBig: toBig
  };
})();
function vapidHeader(endpoint, privHex, pubB64, subject, nowSec, io) {
  var aud = endpoint.match(/^https?:\/\/[^/]+/)[0];
  var header = io.b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  var claims = io.b64url(JSON.stringify({ aud: aud, exp: nowSec + 12 * 3600, sub: subject }));
  var unsigned = header + '.' + claims;
  var sig = P256.sign(io.sha256(unsigned), BigInt('0x' + privHex), io.random(32));
  return 'vapid t=' + unsigned + '.' + io.b64url(sig) + ', k=' + pubB64;
}
var APP = {
  PAGES_URL: 'https://hoyasiro.github.io/Claude_lessen_recorder/',
  VAPID_SUBJECT: 'https://hoyasiro.github.io',
  CONFIG_TAB: 'app_config',
  SUBS_TAB: 'push_subs',
  NOTIFY_HOUR: 9,
  NOTIFY_OFFSETS: [[0, '오늘'], [1, '내일'], [7, '다음 주']]
};
var PLAN = '예정', CANCEL = '취소', DONE = '완료';
function props_() { return PropertiesService.getScriptProperties(); }
function db_() { return SpreadsheetApp.openById(CONFIG.DB_SPREADSHEET_ID); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function addDaysIso_(iso, n) {
  var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function tab_(name) {
  var ss = db_(), sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}
function randomBytes_(n) {
  var out = [];
  while (out.length < n) {
    var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Math.random() + Date.now());
    for (var i = 0; i < d.length && out.length < n; i++) out.push(d[i] & 255);
  }
  return out;
}
var IO_ = {
  sha256: function (s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8).map(function (b) { return b & 255; }); },
  random: randomBytes_,
  b64url: function (v) {
    var enc = typeof v === 'string' ? Utilities.base64EncodeWebSafe(v, Utilities.Charset.UTF_8)
      : Utilities.base64EncodeWebSafe(v.map(function (b) { return b > 127 ? b - 256 : b; }));
    return enc.replace(/=+$/, '');
  }
};
function setup() {
  var p = props_();
  if (!p.getProperty('API_TOKEN')) p.setProperty('API_TOKEN', IO_.b64url(randomBytes_(24)));
  if (!p.getProperty('VAPID_PRIV')) {
    var d = P256.keyFromRandom(randomBytes_(32));
    p.setProperty('VAPID_PRIV', d.toString(16));
    p.setProperty('VAPID_PUB', IO_.b64url(P256.publicKey(d)));
  }
  var cfg = tab_(APP.CONFIG_TAB);
  if (!cfg.getRange('A1').getValue()) {
    cfg.getRange('A1').setValue(JSON.stringify({ programs: {} }));
    cfg.getRange('A2').setValue('레슨 수첩 앱 설정(JSON). 앱에서 바뀌니 직접 고치지 마세요.');
  }
  var subs = tab_(APP.SUBS_TAB);
  if (!subs.getRange('A1').getValue()) subs.getRange('A1:C1').setValues([['endpoint', 'subscription', 'created']]);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyPush') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyPush').timeBased().everyDays(1).atHour(APP.NOTIFY_HOUR).nearMinute(0).inTimezone(CONFIG.TZ).create();
  var api = ScriptApp.getService().getUrl();
  if (!api) { Logger.log('먼저 "배포 → 새 배포 → 웹 앱"으로 배포한 뒤 setup()을 다시 실행하세요.'); return; }
  if (/\/dev$/.test(api)) {
    Logger.log('주의: 테스트용 주소(/dev)가 잡혔어요. 배포 → 배포 관리에서 웹 앱 URL(/exec)을 복사해, 앱의 [서버 주소 바꾸기]에 붙여 넣으세요.');
  }
  var link = APP.PAGES_URL + '#connect=' + IO_.b64url(JSON.stringify({ api: api, token: p.getProperty('API_TOKEN') }));
  Logger.log('연결 링크 (휴대폰에서 열기, 다른 사람과 공유하지 마세요):\n' + link);
}
function resetToken() { props_().deleteProperty('API_TOKEN'); setup(); }
function doGet(e) {
  var q = (e && e.parameter) || {};
  if (q.token !== props_().getProperty('API_TOKEN')) return json_({ error: 'unauthorized' });
  if (q.action === 'digest') return json_(digest_(todayIso_()));
  if (q.payload) {
    var b; try { b = JSON.parse(q.payload); } catch (err) { return json_({ error: 'bad_json' }); }
    b.token = q.token;
    return run_(b);
  }
  return json_({ ok: true, version: 2 });
}
function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ error: 'bad_json' }); }
  return run_(body);
}
function run_(body) {
  if (body.token !== props_().getProperty('API_TOKEN')) return json_({ error: 'unauthorized' });
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    return json_(handle_(body));
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}
function handle_(b) {
  switch (b.action) {
    case 'load': return load_();
    case 'addLessons': return { rows: addLessons_(b.list) };
    case 'updateLesson': updateLesson_(b.lesson); return { ok: true };
    case 'removeLesson': removeLesson_(b.lesson); return { ok: true };
    case 'addProgram': return { row: addProgramRow_(b.program) };
    case 'updateProgram': updateProgram_(b.program); return { ok: true };
    case 'saveSettings': tab_(APP.CONFIG_TAB).getRange('A1').setValue(JSON.stringify(b.settings || { programs: {} })); return { ok: true };
    case 'vapid': return { publicKey: props_().getProperty('VAPID_PUB') };
    case 'subscribe': return subscribe_(b.subscription);
    case 'unsubscribe': return unsubscribe_(b.endpoint);
    case 'testPush': return { sent: sendAll_(true) };
    default: throw new Error('알 수 없는 요청: ' + b.action);
  }
}
function load_() {
  var ss = db_();
  var lessons = ss.getSheetByName(CONFIG.TABS.LESSONS).getRange('A:L').getDisplayValues();
  var programs = ss.getSheetByName(CONFIG.TABS.PROGRAMS).getRange('A:L').getDisplayValues();
  var cut = function (rows) { var last = 0; rows.forEach(function (r, i) { if (r[0]) last = i + 1; }); return rows.slice(0, last); };
  var raw = tab_(APP.CONFIG_TAB).getRange('A1').getValue();
  var settings; try { settings = JSON.parse(raw || '{}'); } catch (err) { settings = {}; }
  if (!settings.programs) settings.programs = {};
  return { lessons: cut(lessons), programs: cut(programs), settings: settings };
}
function writeLessonRow_(sh, row, l) {
  sh.getRange(row, 1, 1, 2).setValues([[l.id, l.date]]);
  sh.getRange(row, 4, 1, 2).setValues([[l.programId, l.program]]);
  sh.getRange(row, 7, 1, 3).setValues([[l.coach || '', !!l.payment, l.note || '']]);
  sh.getRange(row, 11, 1, 2).setValues([[l.source || '', l.state || DONE]]);
  sh.getRange(row, 2).setNumberFormat('yyyy-mm-dd');
}
function addLessons_(list) {
  var sh = db_().getSheetByName(CONFIG.TABS.LESSONS), start = lastDataRow_(sh) + 1;
  (list || []).forEach(function (l, i) { writeLessonRow_(sh, start + i, l); });
  return (list || []).map(function (_, i) { return start + i; });
}
function checkRow_(sh, row, id) {
  if (!row || sh.getRange(row, 1).getDisplayValue() !== id) throw new Error('시트가 바뀌었어요. 새로고침 후 다시 시도해 주세요.');
}
function updateLesson_(l) {
  var sh = db_().getSheetByName(CONFIG.TABS.LESSONS);
  checkRow_(sh, l.row, l.id); writeLessonRow_(sh, l.row, l);
}
function removeLesson_(l) {
  var sh = db_().getSheetByName(CONFIG.TABS.LESSONS);
  checkRow_(sh, l.row, l.id); sh.deleteRow(l.row);
}
function programCells_(p) { return [p.id, p.name, p.sport || '', p.detail || '', p.student || '', p.coach || '', p.memo || '', p.status || '']; }
function addProgramRow_(p) {
  var sh = db_().getSheetByName(CONFIG.TABS.PROGRAMS), r = lastDataRow_(sh) + 1;
  sh.getRange(r, 1, 1, 8).setValues([programCells_(p)]);
  sh.getRange(r, 9, 1, 4).setFormulas([[
    '=IF($K' + r + '=0,"",MINIFS(lessons!$B:$B,lessons!$D:$D,$A' + r + '))',
    '=IF($K' + r + '=0,"",MAXIFS(lessons!$B:$B,lessons!$D:$D,$A' + r + '))',
    '=COUNTIF(lessons!$D:$D,$A' + r + ')',
    '=COUNTIFS(lessons!$D:$D,$A' + r + ',lessons!$H:$H,TRUE)']]);
  return r;
}
function updateProgram_(p) {
  var sh = db_().getSheetByName(CONFIG.TABS.PROGRAMS);
  checkRow_(sh, p.row, p.id);
  sh.getRange(p.row, 1, 1, 8).setValues([programCells_(p)]);
}
function subscribe_(sub) {
  if (!sub || !sub.endpoint) throw new Error('구독 정보가 없어요.');
  var sh = tab_(APP.SUBS_TAB), rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) if (rows[i][0] === sub.endpoint) return { ok: true, count: rows.length - 1 };
  sh.appendRow([sub.endpoint, JSON.stringify(sub), new Date()]);
  return { ok: true, count: rows.length };
}
function unsubscribe_(endpoint) {
  var sh = tab_(APP.SUBS_TAB), rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) if (rows[i][0] === endpoint) sh.deleteRow(i + 1);
  return { ok: true };
}
function digest_(today) {
  var data = load_(), slots = {};
  Object.keys(data.settings.programs).forEach(function (pid) { slots[pid] = data.settings.programs[pid].slots || []; });
  var week = ['일', '월', '화', '수', '목', '금', '토'];
  var student = {}; data.programs.slice(1).forEach(function (r) { student[r[0]] = r[4]; });
  var lines = [];
  APP.NOTIFY_OFFSETS.forEach(function (o) {
    var d = addDaysIso_(today, o[0]), dw = new Date(d + 'T00:00:00Z').getUTCDay();
    data.lessons.slice(1).filter(function (r) { return r[1] === d && r[11] === PLAN; }).forEach(function (r) {
      var s = (slots[r[3]] || []).filter(function (x) { return +x.dow === dw; })[0];
      var when = o[1] + (o[0] === 7 ? ' ' + (+d.slice(5, 7)) + '/' + (+d.slice(8)) + '(' + week[dw] + ')' : '') + (s && s.time ? ' ' + s.time : '');
      lines.push(when + ' · ' + r[4] + (student[r[3]] ? ' (' + student[r[3]] + ')' : '') + (r[7] === 'TRUE' ? ' · 결제' : ''));
    });
  });
  return { title: '레슨 수첩', body: lines.join('\n'), count: lines.length, date: today };
}
function dailyPush() { sendAll_(false); }
function sendAll_(force) {
  if (!force && digest_(todayIso_()).count === 0) return 0;
  var sh = tab_(APP.SUBS_TAB), rows = sh.getDataRange().getValues(), p = props_(), sent = 0, dead = [];
  for (var i = 1; i < rows.length; i++) {
    var endpoint = rows[i][0]; if (!endpoint) continue;
    var auth = vapidHeader(endpoint, p.getProperty('VAPID_PRIV'), p.getProperty('VAPID_PUB'), APP.VAPID_SUBJECT, Math.floor(Date.now() / 1000), IO_);
    var res = UrlFetchApp.fetch(endpoint, { method: 'post', payload: '', muteHttpExceptions: true,
      headers: { Authorization: auth, TTL: '43200', Urgency: 'high' } });
    var code = res.getResponseCode();
    if (code === 404 || code === 410) dead.push(i + 1); else if (code < 300) sent++;
    else Logger.log('푸시 실패 ' + code + ': ' + res.getContentText().slice(0, 200));
  }
  dead.reverse().forEach(function (r) { sh.deleteRow(r); });
  return sent;
}

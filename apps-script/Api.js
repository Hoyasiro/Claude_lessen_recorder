/**
 * 레슨 수첩 웹앱(PWA)용 API + 푸시 알림.
 * 알림: 1주 전·하루 전은 오전 9시, 당일은 레슨 시작 3시간 전 (레슨 시간이 없으면 당일 오전 9시).
 * 15분마다 도는 트리거(pushTick)가 보낼 알림이 있는지 확인한다.
 *
 * 처음 한 번:
 *   1) 배포 → 새 배포 → 유형 "웹 앱", 실행: 나, 액세스: 모든 사용자 → 배포
 *   2) 편집기에서 setup() 실행 → 실행 로그의 "연결 링크"를 휴대폰에서 열기
 *
 * 저장 위치(모두 레슨기록_DB 안):
 *   - lessons / programs 탭: 레슨·프로그램 (기존 그대로)
 *   - app_config 탭 A1: 앱 설정 JSON (결제 주기, 레슨 주기, 색, 짧은 이름)
 *   - push_subs 탭: 알림을 받을 기기 목록
 * 스크립트 속성: API_TOKEN, VAPID_PRIV, VAPID_PUB, PUSH_SENT(오늘 보낸 알림), PUSH_LAST(마지막 알림 내용), TRIGGER_VER
 */

var APP = {
  PAGES_URL: 'https://hoyasiro.github.io/Claude_lessen_recorder/',
  VAPID_SUBJECT: 'https://hoyasiro.github.io',
  CONFIG_TAB: 'app_config',
  SUBS_TAB: 'push_subs',
  MORNING: ['09:00', '12:00'], // 1주 전·하루 전 알림을 보내는 시간대 (트리거가 늦게 돌아도 이 안이면 보낸다)
  AHEAD: [[1, '내일'], [7, '다음 주']],
  BEFORE_HOURS: 3,               // 당일 알림: 레슨 시작 몇 시간 전
  TICK_MINUTES: 15
};
var TRIGGER_VER = '2'; // 트리거 구성이 바뀌면 올린다 → 다음 요청 때 자동으로 다시 만든다
var PLAN = '예정', CANCEL = '취소', DONE = '완료';

// ---------- 공통 ----------
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

// ---------- 처음 설정 ----------
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

  p.deleteProperty('TRIGGER_VER'); ensureTriggers_();

  var api = ScriptApp.getService().getUrl();
  if (!api) { Logger.log('먼저 "배포 → 새 배포 → 웹 앱"으로 배포한 뒤 setup()을 다시 실행하세요.'); return; }
  if (/\/dev$/.test(api)) {
    Logger.log('주의: 테스트용 주소(/dev)가 잡혔어요. 배포 → 배포 관리에서 웹 앱 URL(/exec)을 복사해, 앱의 [서버 주소 바꾸기]에 붙여 넣으세요.');
  }
  var link = APP.PAGES_URL + '#connect=' + IO_.b64url(JSON.stringify({ api: api, token: p.getProperty('API_TOKEN') }));
  Logger.log('연결 링크 (휴대폰에서 열기, 다른 사람과 공유하지 마세요):\n' + link);
}

/** 알림 트리거(15분마다 pushTick). 예전 9시 트리거(dailyPush)는 지운다 */
function ensureTriggers_() {
  var p = props_();
  if (p.getProperty('TRIGGER_VER') === TRIGGER_VER) return;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['dailyPush', 'pushTick'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pushTick').timeBased().everyMinutes(APP.TICK_MINUTES).create();
  p.setProperty('TRIGGER_VER', TRIGGER_VER);
}

/** 연결 링크를 바꾸고 싶을 때(유출 의심 등): 토큰을 새로 만들고 링크를 다시 출력 */
function resetToken() { props_().deleteProperty('API_TOKEN'); setup(); }

// ---------- 라우팅 ----------
function doGet(e) {
  var q = (e && e.parameter) || {};
  // JSONP(?callback=이름): 브라우저가 fetch를 막을 때 <script>로 불러간다
  var out = function (obj) {
    if (q.callback && /^[A-Za-z_$][\w$]{0,40}$/.test(q.callback)) {
      return ContentService.createTextOutput(q.callback + '(' + JSON.stringify(obj) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return json_(obj);
  };
  if (q.token !== props_().getProperty('API_TOKEN')) return out({ error: 'unauthorized' });
  if (q.action === 'digest') return out(lastPush_());
  // POST가 막히는 브라우저용: ?payload=<JSON> 으로 같은 요청을 받는다
  if (q.payload) {
    var b; try { b = JSON.parse(q.payload); } catch (err) { return out({ error: 'bad_json' }); }
    b.token = q.token;
    return out(run_(b));
  }
  return out({ ok: true, version: 4 });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ error: 'bad_json' }); }
  return json_(run_(body));
}

function run_(body) {
  if (body.token !== props_().getProperty('API_TOKEN')) return { error: 'unauthorized' };
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    try { ensureTriggers_(); } catch (err) { Logger.log('트리거 설정 실패: ' + err); } // 코드만 바꿔 배포해도 새 알림 트리거로 옮겨 간다
    return handle_(body);
  } catch (err) {
    return { error: String(err && err.message || err) };
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
    case 'testPush': return { sent: sendAll_(preview_(nowKst_().slice(0, 10))) };
    default: throw new Error('알 수 없는 요청: ' + b.action);
  }
}

// ---------- 데이터 ----------
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

// lessons 열: A ID B 날짜 C 요일(수식) D 프로그램ID E 프로그램 F 대상(수식) G 코치 H 결제 I 메모 J 상태(수식) K 원본셀 L 진행
// 수식 열(C·F·J)은 건드리지 않도록 나눠서 쓴다
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

// ---------- 알림 ----------
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

function nowKst_() { return Utilities.formatDate(new Date(), CONFIG.TZ, "yyyy-MM-dd'T'HH:mm"); }
function minusHours_(hm, h) {
  var m = Math.max(0, +hm.slice(0, 2) * 60 + +hm.slice(3, 5) - h * 60);
  return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
}

/** 알림 계산에 필요한 시트 데이터를 한 번에 읽는다 */
function pushContext_() {
  var data = load_(), student = {};
  data.programs.slice(1).forEach(function (r) { student[r[0]] = r[4]; });
  return { data: data, student: student };
}
/** 그날의 예정 레슨: { id, time(레슨 주기의 시간, 없으면 ''), text } */
function plannedOn_(ctx, iso) {
  var dw = new Date(iso + 'T00:00:00Z').getUTCDay(), progs = ctx.data.settings.programs;
  return ctx.data.lessons.slice(1).filter(function (r) { return r[1] === iso && r[11] === PLAN; }).map(function (r) {
    var s = ((progs[r[3]] || {}).slots || []).filter(function (x) { return +x.dow === dw; })[0];
    return { id: r[0], time: (s && s.time) || '',
      text: r[4] + (ctx.student[r[3]] ? ' (' + ctx.student[r[3]] + ')' : '') + (r[7] === 'TRUE' ? ' · 결제' : '') };
  }).sort(function (a, b) { return (a.time || '99').localeCompare(b.time || '99'); });
}
/** 오전 9시 알림 줄: 내일·다음 주(7일 뒤) 레슨 + 시간이 정해지지 않은 오늘 레슨 */
function morningLines_(ctx, today) {
  var week = ['일', '월', '화', '수', '목', '금', '토'], lines = [];
  plannedOn_(ctx, today).forEach(function (x) { if (!x.time) lines.push('오늘 · ' + x.text); });
  APP.AHEAD.forEach(function (o) {
    var d = addDaysIso_(today, o[0]), dw = new Date(d + 'T00:00:00Z').getUTCDay();
    var label = o[1] + (o[0] === 7 ? ' ' + (+d.slice(5, 7)) + '/' + (+d.slice(8)) + '(' + week[dw] + ')' : '');
    plannedOn_(ctx, d).forEach(function (x) { lines.push(label + (x.time ? ' ' + x.time : '') + ' · ' + x.text); });
  });
  return lines;
}
function message_(lines, now) {
  return { title: '레슨 수첩', body: lines.join('\n'), count: lines.length, date: now.slice(0, 10), tag: 'lesson-' + now };
}
/** 테스트 알림 내용: 오늘(시간 있는 레슨 포함) + 내일·다음 주 */
function preview_(today) {
  var ctx = pushContext_();
  var lines = plannedOn_(ctx, today).filter(function (x) { return x.time; }).map(function (x) { return '오늘 ' + x.time + ' · ' + x.text; });
  return message_(lines.concat(morningLines_(ctx, today)), nowKst_());
}

/**
 * 15분마다 실행. now = 'yyyy-MM-ddTHH:mm'(한국 시간)
 * - 당일 레슨: 시작 3시간 전 ~ 시작 전 사이에 한 번
 * - 오전 9시(~12시) 사이 첫 실행 때 한 번: 내일·다음 주 레슨, 시간 없는 오늘 레슨
 * 보낸 것은 PUSH_SENT에 적어 두고 날짜가 바뀌면 비운다. 한 번에 보낼 것이 여럿이면 알림 하나로 묶는다.
 */
function tick_(now) {
  var today = now.slice(0, 10), hm = now.slice(11, 16), p = props_();
  var sent; try { sent = JSON.parse(p.getProperty('PUSH_SENT') || '{}'); } catch (err) { sent = {}; }
  if (sent.date !== today) sent = { date: today, keys: [] };
  var ctx = pushContext_(), lines = [];
  plannedOn_(ctx, today).forEach(function (x) {
    if (!x.time || sent.keys.indexOf(x.id) >= 0) return;
    if (hm >= minusHours_(x.time, APP.BEFORE_HOURS) && hm < x.time) { lines.push('오늘 ' + x.time + ' · ' + x.text); sent.keys.push(x.id); }
  });
  if (hm >= APP.MORNING[0] && hm < APP.MORNING[1] && sent.keys.indexOf('am') < 0) {
    lines = lines.concat(morningLines_(ctx, today)); sent.keys.push('am');
  }
  p.setProperty('PUSH_SENT', JSON.stringify(sent));
  return lines.length ? sendAll_(message_(lines, now)) : 0;
}
function pushTick() { tick_(nowKst_()); }
function dailyPush() { pushTick(); } // 예전 9시 트리거가 남아 있어도 동작하도록

/** 서비스워커가 푸시를 받으면 이 내용을 가져가 알림으로 띄운다 (푸시에는 내용을 싣지 않는다) */
function lastPush_() {
  var last; try { last = JSON.parse(props_().getProperty('PUSH_LAST') || 'null'); } catch (err) { last = null; }
  if (last && Date.now() - last.at < 6 * 3600e3) return last.msg;
  return preview_(nowKst_().slice(0, 10));
}

function sendAll_(msg) {
  props_().setProperty('PUSH_LAST', JSON.stringify({ msg: msg, at: Date.now() }));
  var sh = tab_(APP.SUBS_TAB), rows = sh.getDataRange().getValues(), p = props_(), sent = 0, dead = [];
  for (var i = 1; i < rows.length; i++) {
    var endpoint = rows[i][0]; if (!endpoint) continue;
    var auth = vapidHeader(endpoint, p.getProperty('VAPID_PRIV'), p.getProperty('VAPID_PUB'), APP.VAPID_SUBJECT, Math.floor(Date.now() / 1000), IO_);
    var res = UrlFetchApp.fetch(endpoint, { method: 'post', payload: '', muteHttpExceptions: true,
      headers: { Authorization: auth, TTL: '10800', Urgency: 'high' } });
    var code = res.getResponseCode();
    if (code === 404 || code === 410) dead.push(i + 1); else if (code < 300) sent++;
    else Logger.log('푸시 실패 ' + code + ': ' + res.getContentText().slice(0, 200));
  }
  dead.reverse().forEach(function (r) { sh.deleteRow(r); });
  return sent;
}

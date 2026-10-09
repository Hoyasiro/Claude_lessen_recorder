// 레슨 수첩 Apps Script (자동 생성: node tools/build_gas.js). 이 파일 하나를 편집기에 붙여 넣으세요.

// ===== Normalize.js =====
/**
 * 레슨기록(가로형) → 정형 DB(세로형) 변환 로직.
 * Apps Script 와 Node(로컬 미리보기/테스트) 양쪽에서 그대로 동작하도록 순수 함수로만 작성한다.
 *
 * 원본 형태: 1행=프로그램명, 2행=코치, 3행~=레슨 날짜("YYYY-MM-DD", 뒤에 "+" 또는 메모가 붙을 수 있음).
 */

/**
 * DB 스키마. key 는 변환 결과 객체의 필드, label 은 시트 헤더.
 * formula 가 있는 컬럼은 헤더 셀에 배열 수식을 넣어 값이 자동 계산된다(데이터 쓰기 시 비워 둔다).
 */
var LESSON_COLUMNS = [
  { key: 'lesson_id', label: '레슨ID' },
  { key: 'date', label: '날짜' },
  { key: 'weekday', label: '요일', formula: '={"요일";ARRAYFORMULA(IF(LEN(B2:B),CHOOSE(WEEKDAY(B2:B),"일","월","화","수","목","금","토"),))}' },
  { key: 'program_id', label: '프로그램ID' },
  { key: 'program', label: '프로그램' },
  { key: 'student', label: '대상', formula: '={"대상";ARRAYFORMULA(IF(LEN(D2:D),IFERROR(VLOOKUP(D2:D,programs!A:E,5,FALSE)&"",""),))}' },
  { key: 'coach', label: '코치' },
  { key: 'payment', label: '결제' },
  { key: 'note', label: '메모' },
  { key: 'status', label: '상태', formula: '={"상태";ARRAYFORMULA(IF(LEN(D2:D),IFERROR(VLOOKUP(D2:D,programs!A:H,8,FALSE)&"",""),))}' },
  { key: 'source_cell', label: '원본셀' }
];

/** programs 의 집계 컬럼은 행마다 수식({r} = 행 번호) */
var PROGRAM_COLUMNS = [
  { key: 'program_id', label: '프로그램ID' },
  { key: 'program', label: '프로그램' },
  { key: 'sport', label: '종목' },
  { key: 'detail', label: '세부' },
  { key: 'student', label: '대상' },
  { key: 'coach', label: '코치' },
  { key: 'memo', label: '메모' },
  { key: 'status', label: '상태' },
  { key: 'first_date', label: '첫 레슨', rowFormula: '=IF($K{r}=0,"",MINIFS(lessons!$B:$B,lessons!$D:$D,$A{r}))' },
  { key: 'last_date', label: '마지막 레슨', rowFormula: '=IF($K{r}=0,"",MAXIFS(lessons!$B:$B,lessons!$D:$D,$A{r}))' },
  { key: 'lesson_count', label: '레슨 수', rowFormula: '=COUNTIF(lessons!$D:$D,$A{r})' },
  { key: 'payment_count', label: '결제 횟수', rowFormula: '=COUNTIFS(lessons!$D:$D,$A{r},lessons!$H:$H,TRUE)' }
];

var ISSUE_COLUMNS = [
  { key: 'level', label: '구분' },
  { key: 'type', label: '유형' },
  { key: 'program', label: '프로그램' },
  { key: 'source_cell', label: '원본셀' },
  { key: 'original', label: '원본값' },
  { key: 'action', label: '처리' }
];

var STATUS_VALUES = ['진행중', '종료'];

var WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
var DATE_CELL_RE = /^(\d{4})-(\d{2})-(\d{2})\s*(\+)?\s*(.*)$/;

function columnLetter_(index) {
  var s = '';
  for (var n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function toIso_(y, m, d) {
  return y + '-' + pad2_(m) + '-' + pad2_(d);
}

function isValidDate_(y, m, d) {
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function weekdayKo_(iso) {
  var p = iso.split('-');
  return WEEKDAYS_KO[new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()];
}

/** 프로그램명에 대상이 드러난 경우만 채우고 나머지는 수기 입력 */
function guessStudent_(name) {
  if (/엄빠/.test(name)) return '엄빠';
  if (/준희/.test(name)) return '준희';
  return '';
}

/** "야구(서구 대회)" → { sport: "야구", detail: "서구 대회" } */
function splitProgramName_(name) {
  var m = /^([^(]+)\((.*)\)\s*$/.exec(name);
  if (m) return { sport: m[1].trim(), detail: m[2].trim() };
  return { sport: name.trim(), detail: '' };
}

/**
 * @param {Array<Array<string>>} values 원본 시트 값(첫 행부터)
 * @param {Object} opts { sheetName, today: 'YYYY-MM-DD' }
 * @return {{programs: Array<Object>, lessons: Array<Object>, issues: Array<Object>}}
 */
function normalizeLegacy(values, opts) {
  opts = opts || {};
  var sheetName = opts.sheetName || '레슨기록';
  var today = opts.today;
  var header = values[0] || [];
  var coachRow = values[1] || [];

  var programs = [];
  var rawLessons = [];
  var issues = [];

  for (var c = 0; c < header.length; c++) {
    var name = String(header[c] || '').trim();
    if (!name) continue;
    var parts = splitProgramName_(name);
    var program = {
      program_id: 'P' + pad2_(programs.length + 1),
      program: name,
      sport: parts.sport,
      detail: parts.detail,
      coach: String(coachRow[c] || '').trim(),
      student: guessStudent_(name),
      memo: [],
      status: ''
    };
    programs.push(program);

    var seen = {};
    var prevIso = null;
    for (var r = 2; r < values.length; r++) {
      var raw = String((values[r] || [])[c] || '').trim();
      if (!raw) continue;
      var cell = sheetName + '!' + columnLetter_(c) + (r + 1);
      var m = DATE_CELL_RE.exec(raw);

      if (!m) {
        // 날짜가 아닌 값: 추가 코치/대상 정보 등 → 프로그램 메모로 보존
        program.memo.push(raw);
        issues.push({ level: 'info', type: '날짜 아님→메모', program: name, source_cell: cell, original: raw, action: '프로그램 메모로 이동' });
        continue;
      }

      var y = +m[1], mo = +m[2], d = +m[3];
      if (!isValidDate_(y, mo, d)) {
        issues.push({ level: 'error', type: '잘못된 날짜', program: name, source_cell: cell, original: raw, action: '제외' });
        continue;
      }
      var iso = toIso_(y, mo, d);

      // 미래 연도 오타 (예: 2035-04-26) → 직전 레슨의 연도로 보정 시도
      if (today && iso > today && prevIso) {
        var fixed = toIso_(+prevIso.slice(0, 4), mo, d);
        if (isValidDate_(+prevIso.slice(0, 4), mo, d) && fixed >= prevIso && fixed <= today) {
          issues.push({ level: 'warn', type: '연도 오타 보정', program: name, source_cell: cell, original: raw, action: fixed + ' 로 보정' });
          iso = fixed;
        }
      }

      if (seen[iso]) {
        issues.push({ level: 'warn', type: '중복 날짜', program: name, source_cell: cell, original: raw, action: '중복 제외 (최초: ' + seen[iso] + ')' });
        continue;
      }
      if (prevIso && iso < prevIso) {
        issues.push({ level: 'info', type: '순서 뒤바뀜', program: name, source_cell: cell, original: raw, action: '날짜순 정렬로 해결' });
      }
      seen[iso] = cell;
      prevIso = iso;

      var note = (m[5] || '').trim();
      if (/종료/.test(note)) program.status = '종료';
      rawLessons.push({
        date: iso,
        weekday: weekdayKo_(iso),
        program_id: program.program_id,
        program: name,
        coach: program.coach,
        payment: !!m[4],
        note: note,
        source_cell: cell
      });
    }
  }

  rawLessons.sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.program_id < b.program_id ? -1 : 1);
  });
  var lessons = rawLessons.map(function (l, i) {
    var row = { lesson_id: 'L' + ('0000' + (i + 1)).slice(-4) };
    for (var k in l) row[k] = l[k];
    return row;
  });

  programs.forEach(function (p) {
    var mine = lessons.filter(function (l) { return l.program_id === p.program_id; });
    p.lesson_count = mine.length;
    p.first_date = mine.length ? mine[0].date : '';
    p.last_date = mine.length ? mine[mine.length - 1].date : '';
    p.payment_count = mine.filter(function (l) { return l.payment; }).length;
    p.memo = p.memo.join(', ');
  });

  return { programs: programs, lessons: lessons, issues: issues };
}

/**
 * 객체 배열 → 시트에 쓸 2차원 배열(헤더 포함).
 * formula 컬럼은 헤더에 배열 수식, 데이터는 null(쓰지 않음). rowFormula 컬럼은 행별 수식.
 * @param {number=} firstRow 첫 데이터 행 번호(기본 2)
 */
function toSheetRows(objects, columns, firstRow) {
  firstRow = firstRow || 2;
  var header = columns.map(function (c) { return c.formula || c.label; });
  return [header].concat(objects.map(function (o, i) {
    return columns.map(function (c) {
      if (c.formula) return null;
      if (c.rowFormula) return c.rowFormula.replace(/\{r\}/g, String(firstRow + i));
      var v = o[c.key];
      return v === undefined ? '' : v;
    });
  }));
}

/** 미리보기용: 수식 대신 계산된 값으로 채운 2차원 배열 */
function toPreviewRows(objects, columns) {
  return [columns.map(function (c) { return c.label; })].concat(objects.map(function (o) {
    return columns.map(function (c) {
      var v = o[c.key];
      return v === true ? '☑' : v === false ? '☐' : v === undefined ? '' : v;
    });
  }));
}

if (typeof module !== 'undefined') {
  module.exports = {
    normalizeLegacy: normalizeLegacy,
    toSheetRows: toSheetRows,
    toPreviewRows: toPreviewRows,
    weekdayKo: weekdayKo_,
    LESSON_COLUMNS: LESSON_COLUMNS,
    PROGRAM_COLUMNS: PROGRAM_COLUMNS,
    ISSUE_COLUMNS: ISSUE_COLUMNS,
    STATUS_VALUES: STATUS_VALUES
  };
}


// ===== Code.js =====
/**
 * 레슨 기록 DB (Google Apps Script)
 *
 * - previewMigration()     : 드라이런. 아무것도 쓰지 않고 변환 결과 요약만 로그로 출력
 * - migrateLegacyLessons() : 원본 '레슨기록' 탭을 정형화해 새 스프레드시트(DB)를 원본과 같은 폴더에 생성
 * - addLesson(...)         : DB에 레슨 1건 추가
 * - addProgram(...)        : DB에 프로그램 1개 추가 (집계 수식 포함)
 *
 * 원본 시트는 읽기만 하고 절대 수정하지 않는다.
 * 상태(진행중/종료)는 programs 탭에서 수기로 바꾸면 lessons 탭의 해당 레슨 전체에 수식으로 반영된다.
 */

var CONFIG = {
  SOURCE_SPREADSHEET_ID: '1zBlSYl_p5X8bN5AwX4RkftcxmMknvGTYwBg4txDRu8U', // 준희 키_v2
  SOURCE_SHEET_NAME: '레슨기록',
  DB_SPREADSHEET_ID: '1T7Asxbs7RtM7V6avTNQQQ-rPFQuX-WLIbEu_8tDp7ts', // 레슨기록_DB (2026-10-08 생성)
  DB_NAME: '레슨기록_DB',
  TZ: 'Asia/Seoul',
  TABS: { LESSONS: 'lessons', PROGRAMS: 'programs', ISSUES: 'migration_issues' }
};

var DB_ID_PROP = 'LESSON_DB_SPREADSHEET_ID';

function todayIso_() {
  return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd');
}

function colIndex_(columns, key) {
  for (var i = 0; i < columns.length; i++) if (columns[i].key === key) return i;
  throw new Error('unknown column: ' + key);
}

function readLegacy_() {
  var sheet = SpreadsheetApp.openById(CONFIG.SOURCE_SPREADSHEET_ID).getSheetByName(CONFIG.SOURCE_SHEET_NAME);
  if (!sheet) throw new Error('원본 탭을 찾을 수 없음: ' + CONFIG.SOURCE_SHEET_NAME);
  var values = sheet.getDataRange().getDisplayValues();
  return normalizeLegacy(values, { sheetName: CONFIG.SOURCE_SHEET_NAME, today: todayIso_() });
}

function previewMigration() {
  var r = readLegacy_();
  Logger.log('프로그램 %s개, 레슨 %s건, 이슈 %s건', r.programs.length, r.lessons.length, r.issues.length);
  r.issues.forEach(function (i) {
    Logger.log('[%s] %s %s %s → %s', i.level, i.type, i.source_cell, i.original, i.action);
  });
}

/** 체크박스(FALSE)가 빈 행까지 차 있어 getLastRow()를 쓸 수 없으므로 A열 기준으로 마지막 데이터 행을 찾는다 */
function lastDataRow_(sheet) {
  var ids = sheet.getRange('A:A').getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (ids[i][0] !== '') return i + 1;
  return 0;
}

function dbId_() {
  return CONFIG.DB_SPREADSHEET_ID || PropertiesService.getScriptProperties().getProperty(DB_ID_PROP);
}

function getDb_() {
  var id = dbId_();
  if (!id) throw new Error('DB가 없습니다. CONFIG.DB_SPREADSHEET_ID를 지정하거나 migrateLegacyLessons()를 실행하세요.');
  return SpreadsheetApp.openById(id);
}

function migrateLegacyLessons() {
  if (dbId_()) throw new Error('이미 DB가 있습니다: ' + dbId_());
  var r = readLegacy_();

  var db = SpreadsheetApp.create(CONFIG.DB_NAME);
  db.setSpreadsheetTimeZone(CONFIG.TZ);
  // 원본과 같은 드라이브 폴더로 이동
  var folder = DriveApp.getFileById(CONFIG.SOURCE_SPREADSHEET_ID).getParents().next();
  DriveApp.getFileById(db.getId()).moveTo(folder);

  var lessons = db.getSheets()[0].setName(CONFIG.TABS.LESSONS);
  var programs = db.insertSheet(CONFIG.TABS.PROGRAMS);
  var issues = db.insertSheet(CONFIG.TABS.ISSUES);

  writeTable_(programs, toSheetRows(r.programs, PROGRAM_COLUMNS));
  writeTable_(lessons, toSheetRows(r.lessons, LESSON_COLUMNS));
  writeTable_(issues, toSheetRows(r.issues, ISSUE_COLUMNS));
  formatDb_(db);

  PropertiesService.getScriptProperties().setProperty(DB_ID_PROP, db.getId());
  Logger.log('DB 생성 완료: %s (레슨 %s건)', db.getUrl(), r.lessons.length);
  return db.getUrl();
}

/** null 셀(배열 수식이 채울 칸)은 건너뛰고 쓴다 */
function writeTable_(sheet, rows) {
  var width = rows[0].length;
  for (var c = 0; c < width; c++) {
    var col = rows.map(function (row) { return [row[c]]; });
    if (col.slice(1).every(function (v) { return v[0] === null; })) {
      sheet.getRange(1, c + 1).setValue(col[0][0]);
    } else {
      sheet.getRange(1, c + 1, col.length, 1).setValues(col);
    }
  }
}

function formatDb_(db) {
  var lessons = db.getSheetByName(CONFIG.TABS.LESSONS);
  var programs = db.getSheetByName(CONFIG.TABS.PROGRAMS);
  [lessons, programs, db.getSheetByName(CONFIG.TABS.ISSUES)].forEach(function (s) {
    s.getRange(1, 1, 1, s.getLastColumn()).setFontWeight('bold').setBackground('#e8eef7');
    s.setFrozenRows(1);
  });
  lessons.getRange('B2:B').setNumberFormat('yyyy-mm-dd');
  lessons.getRange('H2:H').insertCheckboxes();
  programs.getRange('I2:J').setNumberFormat('yyyy-mm-dd');
  programs.getRange('H2:H').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUS_VALUES, true).setAllowInvalid(false).build());
}

/**
 * 레슨 1건 추가.
 * @param {string} dateIso 'YYYY-MM-DD'
 * @param {string} programId 예: 'P08'
 * @param {{payment: boolean, note: string}=} opts
 */
function addLesson(dateIso, programId, opts) {
  opts = opts || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) throw new Error('날짜 형식은 YYYY-MM-DD');
  var db = getDb_();
  var program = db.getSheetByName(CONFIG.TABS.PROGRAMS).getDataRange().getValues()
    .filter(function (p) { return p[0] === programId; })[0];
  if (!program) throw new Error('알 수 없는 프로그램ID: ' + programId);

  var sheet = db.getSheetByName(CONFIG.TABS.LESSONS);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var n = Math.max(lastDataRow_(sheet) - 1, 0);
    var existing = n ? sheet.getRange(2, 1, n, 4).getDisplayValues() : [];
    if (existing.some(function (r) { return r[1] === dateIso && r[3] === programId; })) {
      throw new Error('이미 등록된 레슨: ' + dateIso + ' ' + programId);
    }
    var maxNo = existing.reduce(function (m, r) { return Math.max(m, parseInt(r[0].slice(1), 10) || 0); }, 0);
    var row = {
      lesson_id: 'L' + ('0000' + (maxNo + 1)).slice(-4),
      date: dateIso,
      program_id: programId,
      program: program[colIndex_(PROGRAM_COLUMNS, 'program')],
      coach: program[colIndex_(PROGRAM_COLUMNS, 'coach')],
      payment: !!opts.payment,
      note: opts.note || '',
      source_cell: '수기입력 ' + todayIso_()
    };
    var values = toSheetRows([row], LESSON_COLUMNS)[1];
    var target = n + 2;
    // 배열 수식 칸(null)은 건드리지 않고, 연속된 값 구간만 쓴다
    values.forEach(function (v, c) {
      if (v !== null) sheet.getRange(target, c + 1).setValue(v);
    });
    sheet.getRange(target, 2).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(target, colIndex_(LESSON_COLUMNS, 'payment') + 1).insertCheckboxes().setValue(!!opts.payment);
    return row.lesson_id;
  } finally {
    lock.releaseLock();
  }
}

/**
 * 프로그램 추가. 예: addProgram('야구(준희 엘리트)', '준희', '문서후 코치님')
 */
function addProgram(name, student, coach, memo) {
  var sheet = getDb_().getSheetByName(CONFIG.TABS.PROGRAMS);
  var last = lastDataRow_(sheet);
  var ids = sheet.getRange(2, 1, Math.max(last - 1, 1), 1).getValues();
  var maxNo = ids.reduce(function (m, r) { return Math.max(m, parseInt(String(r[0]).slice(1), 10) || 0); }, 0);
  var m = /^([^(]+)\((.*)\)\s*$/.exec(name);
  var program = {
    program_id: 'P' + (maxNo + 1 < 10 ? '0' : '') + (maxNo + 1),
    program: name,
    sport: m ? m[1].trim() : name,
    detail: m ? m[2].trim() : '',
    student: student || '',
    coach: coach || '',
    memo: memo || '',
    status: '진행중'
  };
  var row = last + 1;
  sheet.getRange(row, 1, 1, PROGRAM_COLUMNS.length).setValues([toSheetRows([program], PROGRAM_COLUMNS, row)[1]]);
  return program.program_id;
}


// ===== WebPush.js =====
/**
 * 웹 푸시(VAPID) 발송. Apps Script에는 ECDSA가 없어서 P-256 ES256 서명을 BigInt로 직접 구현한다.
 * 페이로드 없는 푸시만 보낸다(암호화 불필요). 알림 내용은 서비스워커가 받은 뒤 API(digest)에서 가져온다.
 * Node에서도 동작하도록 순수 함수로 작성하고, 바이트 처리(해시·난수·base64)만 주입받는다.
 */

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
    /** 개인키 d(BigInt) → 비압축 공개키 65바이트 */
    publicKey: function (d) { var q = mul(d, G); return [4].concat(toBytes(q[0], 32), toBytes(q[1], 32)); },
    /** 난수 바이트 → 유효한 개인키 */
    keyFromRandom: function (bytes) { return mod(toBig(bytes), N - ONE) + ONE; },
    /** ES256 서명(r||s 64바이트). hash = SHA-256(msg) 바이트, rnd = 32바이트 이상 난수 */
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

/**
 * VAPID Authorization 헤더 값을 만든다.
 * io = { sha256(string) → bytes, random(n) → bytes, b64url(bytes|string) → string }
 */
function vapidHeader(endpoint, privHex, pubB64, subject, nowSec, io) {
  var aud = endpoint.match(/^https?:\/\/[^/]+/)[0];
  var header = io.b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  var claims = io.b64url(JSON.stringify({ aud: aud, exp: nowSec + 12 * 3600, sub: subject }));
  var unsigned = header + '.' + claims;
  var sig = P256.sign(io.sha256(unsigned), BigInt('0x' + privHex), io.random(32));
  return 'vapid t=' + unsigned + '.' + io.b64url(sig) + ', k=' + pubB64;
}

if (typeof module !== 'undefined') module.exports = { P256: P256, vapidHeader: vapidHeader };


// ===== Api.js =====
/**
 * 레슨 수첩 웹앱(PWA)용 API + 매일 아침 푸시 알림.
 *
 * 처음 한 번:
 *   1) 배포 → 새 배포 → 유형 "웹 앱", 실행: 나, 액세스: 모든 사용자 → 배포
 *   2) 편집기에서 setup() 실행 → 실행 로그의 "연결 링크"를 휴대폰에서 열기
 *
 * 저장 위치(모두 레슨기록_DB 안):
 *   - lessons / programs 탭: 레슨·프로그램 (기존 그대로)
 *   - app_config 탭 A1: 앱 설정 JSON (결제 주기, 레슨 주기, 색, 짧은 이름)
 *   - push_subs 탭: 알림을 받을 기기 목록
 * 스크립트 속성: API_TOKEN, VAPID_PRIV, VAPID_PUB
 */

var APP = {
  PAGES_URL: 'https://hoyasiro.github.io/Claude_lessen_recorder/',
  VAPID_SUBJECT: 'https://hoyasiro.github.io',
  CONFIG_TAB: 'app_config',
  SUBS_TAB: 'push_subs',
  NOTIFY_HOUR: 9,
  NOTIFY_OFFSETS: [[0, '오늘'], [1, '내일'], [7, '다음 주']]
};
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

  // 매일 오전 9시 근처(±15분) 알림 트리거
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
  if (q.action === 'digest') return out(digest_(todayIso_()));
  // POST가 막히는 브라우저용: ?payload=<JSON> 으로 같은 요청을 받는다
  if (q.payload) {
    var b; try { b = JSON.parse(q.payload); } catch (err) { return out({ error: 'bad_json' }); }
    b.token = q.token;
    return out(run_(b));
  }
  return out({ ok: true, version: 3 });
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
    case 'testPush': return { sent: sendAll_(true) };
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

/** 오늘·내일·7일 뒤의 예정 레슨으로 알림 문구를 만든다 */
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

/** 매일 9시 트리거. 알릴 레슨이 없으면 보내지 않는다 */
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

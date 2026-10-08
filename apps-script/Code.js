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

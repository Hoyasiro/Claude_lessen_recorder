/**
 * 레슨 기록 DB (Google Apps Script)
 *
 * - previewMigration()     : 드라이런. 아무것도 쓰지 않고 변환 결과 요약만 로그로 출력
 * - migrateLegacyLessons() : 원본 '레슨기록' 탭을 정형화해 새 스프레드시트(DB)를 원본과 같은 폴더에 생성
 * - addLesson(...)         : DB에 레슨 1건 추가
 *
 * 원본 시트는 읽기만 하고 절대 수정하지 않는다.
 */

var CONFIG = {
  SOURCE_SPREADSHEET_ID: '1zBlSYl_p5X8bN5AwX4RkftcxmMknvGTYwBg4txDRu8U', // 준희 키_v2
  SOURCE_SHEET_NAME: '레슨기록',
  DB_NAME: '레슨기록_DB',
  TZ: 'Asia/Seoul',
  TABS: { LESSONS: 'lessons', PROGRAMS: 'programs', ISSUES: 'migration_issues' }
};

var DB_ID_PROP = 'LESSON_DB_SPREADSHEET_ID';

function todayIso_() {
  return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd');
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

function getDb_() {
  var id = PropertiesService.getScriptProperties().getProperty(DB_ID_PROP);
  if (!id) throw new Error('DB가 아직 없습니다. migrateLegacyLessons()를 먼저 실행하세요.');
  return SpreadsheetApp.openById(id);
}

function migrateLegacyLessons() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(DB_ID_PROP)) {
    throw new Error('이미 DB가 있습니다 (' + props.getProperty(DB_ID_PROP) + '). 다시 만들려면 스크립트 속성 ' + DB_ID_PROP + '를 지우세요.');
  }
  var r = readLegacy_();

  var db = SpreadsheetApp.create(CONFIG.DB_NAME);
  db.setSpreadsheetTimeZone(CONFIG.TZ);
  // 원본과 같은 드라이브 폴더로 이동
  var folder = DriveApp.getFileById(CONFIG.SOURCE_SPREADSHEET_ID).getParents().next();
  DriveApp.getFileById(db.getId()).moveTo(folder);

  var lessons = db.getSheets()[0].setName(CONFIG.TABS.LESSONS);
  writeTable_(lessons, toRows(r.lessons, LESSON_HEADERS));
  lessons.getRange('B2:B').setNumberFormat('yyyy-mm-dd');

  var programs = db.insertSheet(CONFIG.TABS.PROGRAMS);
  writeTable_(programs, toRows(r.programs, PROGRAM_HEADERS));
  addProgramFormulas_(programs, r.programs.length);

  writeTable_(db.insertSheet(CONFIG.TABS.ISSUES), toRows(r.issues, ISSUE_HEADERS));

  props.setProperty(DB_ID_PROP, db.getId());
  Logger.log('DB 생성 완료: %s (레슨 %s건)', db.getUrl(), r.lessons.length);
  return db.getUrl();
}

function writeTable_(sheet, rows) {
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sheet.getRange(1, 1, 1, rows[0].length).setFontWeight('bold').setBackground('#eef2f7');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, rows[0].length);
}

/** first_date / last_date / lesson_count 를 수식으로 바꿔 이후 추가되는 레슨도 자동 반영 */
function addProgramFormulas_(sheet, count) {
  var col = function (h) { return PROGRAM_HEADERS.indexOf(h) + 1; };
  for (var row = 2; row <= count + 1; row++) {
    var id = 'A' + row;
    sheet.getRange(row, col('first_date')).setFormula('=IFERROR(1/(1/MINIFS(lessons!B:B,lessons!D:D,' + id + ')),"")');
    sheet.getRange(row, col('last_date')).setFormula('=IFERROR(1/(1/MAXIFS(lessons!B:B,lessons!D:D,' + id + ')),"")');
    sheet.getRange(row, col('lesson_count')).setFormula('=COUNTIF(lessons!D:D,' + id + ')');
  }
  sheet.getRange(2, col('first_date'), count, 2).setNumberFormat('yyyy-mm-dd');
}

/**
 * 레슨 1건 추가.
 * @param {string} dateIso 'YYYY-MM-DD'
 * @param {string} programId 예: 'P08'
 * @param {{plus: boolean, note: string}=} opts
 */
function addLesson(dateIso, programId, opts) {
  opts = opts || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) throw new Error('날짜 형식은 YYYY-MM-DD');
  var db = getDb_();
  var programs = db.getSheetByName(CONFIG.TABS.PROGRAMS).getDataRange().getValues();
  var program = programs.filter(function (p) { return p[0] === programId; })[0];
  if (!program) throw new Error('알 수 없는 program_id: ' + programId);

  var sheet = db.getSheetByName(CONFIG.TABS.LESSONS);
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ids = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
    var dup = sheet.getRange(2, 2, Math.max(sheet.getLastRow() - 1, 1), 3).getDisplayValues()
      .some(function (r) { return r[0] === dateIso && r[2] === programId; });
    if (dup) throw new Error('이미 등록된 레슨: ' + dateIso + ' ' + programId);
    var maxNo = ids.reduce(function (m, r) { return Math.max(m, parseInt(String(r[0]).slice(1), 10) || 0); }, 0);
    var row = {
      lesson_id: 'L' + ('0000' + (maxNo + 1)).slice(-4),
      date: dateIso,
      weekday: weekdayKo_(dateIso),
      program_id: programId,
      program: program[1],
      coach: program[4],
      plus_mark: opts.plus ? 'Y' : '',
      note: opts.note || '',
      source_cell: 'manual ' + todayIso_()
    };
    sheet.appendRow(LESSON_HEADERS.map(function (h) { return row[h]; }));
    return row.lesson_id;
  } finally {
    lock.releaseLock();
  }
}

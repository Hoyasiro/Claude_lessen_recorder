/**
 * 레슨 기록 DB (Google Apps Script)
 *
 * - previewMigration()     : 드라이런. 아무것도 쓰지 않고 변환 결과 요약만 로그로 출력
 * - migrateLegacyLessons() : 원본 '레슨기록' 탭을 정형화해 새 스프레드시트(DB)를 원본과 같은 폴더에 생성 (2026-10-08 실행 완료)
 *
 * 레슨·프로그램 추가/수정은 레슨 수첩 앱(Api.js)이 맡는다. 원본 시트는 읽기만 하고 절대 수정하지 않는다.
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

/** 체크박스(FALSE)가 빈 행까지 차 있어 getLastRow()를 쓸 수 없으므로 A열 기준으로 마지막 데이터 행을 찾는다 */
function lastDataRow_(sheet) {
  var ids = sheet.getRange('A:A').getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (ids[i][0] !== '') return i + 1;
  return 0;
}

function migrateLegacyLessons() {
  if (CONFIG.DB_SPREADSHEET_ID) throw new Error('이미 DB가 있습니다: ' + CONFIG.DB_SPREADSHEET_ID);
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

  Logger.log('DB 생성 완료: %s (레슨 %s건). CONFIG.DB_SPREADSHEET_ID에 %s를 넣으세요.', db.getUrl(), r.lessons.length, db.getId());
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

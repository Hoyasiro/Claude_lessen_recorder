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

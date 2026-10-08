/**
 * 레슨기록(가로형) → 정형 DB(세로형) 변환 로직.
 * Apps Script 와 Node(로컬 미리보기/테스트) 양쪽에서 그대로 동작하도록 순수 함수로만 작성한다.
 *
 * 원본 형태: 1행=프로그램명, 2행=코치, 3행~=레슨 날짜("YYYY-MM-DD", 뒤에 "+" 또는 메모가 붙을 수 있음).
 */

var LESSON_HEADERS = ['lesson_id', 'date', 'weekday', 'program_id', 'program', 'coach', 'plus_mark', 'note', 'source_cell'];
var PROGRAM_HEADERS = ['program_id', 'program', 'sport', 'detail', 'coach', 'memo', 'first_date', 'last_date', 'lesson_count', 'status'];
var ISSUE_HEADERS = ['level', 'type', 'program', 'source_cell', 'original', 'action'];

var WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
var DATE_CELL_RE = /^(\d{4})-(\d{2})-(\d{2})\s*(\+)?\s*(.*)$/;
var INACTIVE_AFTER_DAYS = 60;

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

function daysBetween_(isoA, isoB) {
  return Math.round((Date.parse(isoB) - Date.parse(isoA)) / 86400000);
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
      memo: [],
      ended: false
    };
    programs.push(program);

    var seen = {};
    var prevIso = null;
    for (var r = 2; r < values.length; r++) {
      var raw = String((values[r] || [])[c] || '').trim();
      if (!raw) continue;
      var cell = "'" + sheetName + "'!" + columnLetter_(c) + (r + 1);
      var m = DATE_CELL_RE.exec(raw);

      if (!m) {
        // 날짜가 아닌 값: 추가 코치/대상 정보 등 → 프로그램 메모로 보존
        program.memo.push(raw);
        issues.push({ level: 'info', type: '날짜 아님→메모', program: name, source_cell: cell, original: raw, action: '프로그램 memo로 이동' });
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
      if (/종료/.test(note)) program.ended = true;
      rawLessons.push({
        date: iso,
        weekday: weekdayKo_(iso),
        program_id: program.program_id,
        program: name,
        coach: program.coach,
        plus_mark: m[4] ? 'Y' : '',
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
    if (!mine.length) p.status = '기록없음';
    else if (p.ended || (today && daysBetween_(p.last_date, today) > INACTIVE_AFTER_DAYS)) p.status = '종료';
    else p.status = '진행중';
    p.memo = p.memo.join(', ');
    delete p.ended;
  });

  return { programs: programs, lessons: lessons, issues: issues };
}

/** 객체 배열 → 헤더 순서대로 2차원 배열 */
function toRows(objects, headers) {
  return [headers].concat(objects.map(function (o) {
    return headers.map(function (h) { return o[h] === undefined ? '' : o[h]; });
  }));
}

if (typeof module !== 'undefined') {
  module.exports = {
    normalizeLegacy: normalizeLegacy,
    toRows: toRows,
    LESSON_HEADERS: LESSON_HEADERS,
    PROGRAM_HEADERS: PROGRAM_HEADERS,
    ISSUE_HEADERS: ISSUE_HEADERS
  };
}

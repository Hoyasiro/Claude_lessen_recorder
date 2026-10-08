#!/usr/bin/env node
/**
 * 로컬 데모용 HTML 생성: web/lesson-app.html 에 스냅샷 데이터를 주입해 시트 연결 없이 동작하게 한다.
 * 결과물에는 실제 데이터가 들어가므로 저장소에 커밋하지 않는다.
 * 사용: node tools/build_demo.js <snapshot.json> <out.html> [YYYY-MM-DD]
 */
const fs = require('fs');
const path = require('path');
const n = require(path.join(__dirname, '..', 'apps-script', 'Normalize.js'));

const [snapshot, out, today = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (!snapshot || !out) {
  console.error('usage: node tools/build_demo.js <snapshot.json> <out.html> [today]');
  process.exit(1);
}
const r = n.normalizeLegacy(JSON.parse(fs.readFileSync(snapshot, 'utf8')), { today });
const demo = {
  programs: r.programs.map((p, i) => ({ row: i + 2, id: p.program_id, name: p.program, sport: p.sport, detail: p.detail, student: p.student, coach: p.coach, memo: p.memo, status: p.status })),
  lessons: r.lessons.map((l, i) => ({ row: i + 2, id: l.lesson_id, date: l.date, programId: l.program_id, program: l.program, coach: l.coach, payment: l.payment, note: l.note, source: l.source_cell, state: '완료' })),
  // 앱 설정 예시: 사용자가 알려 준 필라테스 10회권
  settings: { programs: { P10: { cycle: 10, color: 4, short: '필라' } } }
};

// 예시 일정: 최근 60일 동안 레슨이 있던 프로그램을 가장 잦은 요일에 3주치 예정으로 넣는다
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
let nextNo = demo.lessons.length;
const recent = addDays(today, -60);
const examples = [];
demo.programs.forEach((p) => {
  const mine = demo.lessons.filter((l) => l.programId === p.id && l.date >= recent);
  if (!mine.length) return;
  const cnt = [0, 0, 0, 0, 0, 0, 0]; mine.forEach((l) => cnt[dow(l.date)]++);
  const wd = cnt.indexOf(Math.max(...cnt));
  let d = addDays(today, ((wd - dow(today) + 7) % 7) || 7);
  for (let i = 0; i < 3; i++, d = addDays(d, 7)) {
    examples.push({ id: 'L' + String(++nextNo).padStart(4, '0'), date: d, programId: p.id, program: p.name, coach: p.coach, payment: false, note: '', source: '예시 일정', state: '예정' });
  }
});
// 사정상 취소한 예시 1건, 지난 예정(확인 필요) 예시 1건
if (examples[1]) { examples[1].state = '취소'; examples[1].note = '우천 취소 (예시)'; }
const p0 = demo.programs.find((p) => p.id === (examples[0] || {}).programId);
if (p0) examples.push({ id: 'L' + String(++nextNo).padStart(4, '0'), date: addDays(today, -1), programId: p0.id, program: p0.name, coach: p0.coach, payment: false, note: '', source: '예시 일정', state: '예정' });
examples.forEach((l, i) => demo.lessons.push({ ...l, row: demo.lessons.length + 2 }));
const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'lesson-app.html'), 'utf8');
const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' +
  '<script>window.LESSON_DEMO=' + JSON.stringify(demo).replace(/</g, '\\u003c') + ';</script>' + page + '</body></html>';
fs.writeFileSync(out, html);
console.log(`wrote ${out}: ${demo.programs.length} programs, ${demo.lessons.length} lessons`);

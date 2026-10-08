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
  programs: r.programs.map((p) => ({ id: p.program_id, name: p.program, student: p.student, coach: p.coach, memo: p.memo, status: p.status })),
  lessons: r.lessons.map((l, i) => ({ row: i + 2, id: l.lesson_id, date: l.date, programId: l.program_id, program: l.program, coach: l.coach, payment: l.payment, note: l.note, source: l.source_cell }))
};
const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'lesson-app.html'), 'utf8');
const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' +
  '<script>window.LESSON_DEMO=' + JSON.stringify(demo).replace(/</g, '\\u003c') + ';</script>' + page + '</body></html>';
fs.writeFileSync(out, html);
console.log(`wrote ${out}: ${demo.programs.length} programs, ${demo.lessons.length} lessons`);

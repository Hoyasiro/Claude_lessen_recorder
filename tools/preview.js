#!/usr/bin/env node
/**
 * 원본 스냅샷(JSON 2차원 배열)을 변환해 DB 미리보기 HTML 을 만든다. 드라이브에는 아무것도 쓰지 않는다.
 * 사용: node tools/preview.js <snapshot.json> <out.html> [today=YYYY-MM-DD]
 */
const fs = require('fs');
const path = require('path');
const n = require(path.join(__dirname, '..', 'apps-script', 'Normalize.js'));

const [snapshot, out, today = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (!snapshot || !out) {
  console.error('usage: node tools/preview.js <snapshot.json> <out.html> [today]');
  process.exit(1);
}

const r = n.normalizeLegacy(JSON.parse(fs.readFileSync(snapshot, 'utf8')), { today });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const table = (rows, cls = '') =>
  `<div class="scroll ${cls}"><table><thead><tr>${rows[0].map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
  rows.slice(1).map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') +
  '</tbody></table></div>';

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>레슨기록 DB 미리보기</title>
<style>
:root{--bg:#fff;--fg:#1f2328;--muted:#656d76;--line:#d0d7de;--head:#f6f8fa;--accent:#0969da;--warn:#9a6700;--warnbg:#fff8c5}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8d96a0;--line:#30363d;--head:#161b22;--accent:#4493f8;--warn:#d29922;--warnbg:#2b2111}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;margin:0;padding:16px;max-width:1100px;margin-inline:auto}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}p{color:var(--muted);margin:4px 0}
.kpis{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.kpi{border:1px solid var(--line);border-radius:8px;padding:10px 14px;min-width:110px}
.kpi b{display:block;font-size:22px}.kpi span{color:var(--muted);font-size:12px}
.scroll{overflow:auto;border:1px solid var(--line);border-radius:8px;max-height:420px}.short{max-height:none}
table{border-collapse:collapse;width:100%;font-size:13px;white-space:nowrap}th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left}
th{background:var(--head);position:sticky;top:0}.note{background:var(--warnbg);color:var(--warn);border-radius:8px;padding:10px 14px;margin-top:12px}
</style></head><body>
<h1>레슨기록_DB 미리보기 (데모)</h1>
<p>원본: 준희 키_v2 › 레슨기록 탭 · 기준일 ${esc(today)} · <b>아직 드라이브에 생성되지 않음</b></p>
<div class="kpis">
<div class="kpi"><b>${r.programs.length}</b><span>프로그램</span></div>
<div class="kpi"><b>${r.lessons.length}</b><span>레슨 기록</span></div>
<div class="kpi"><b>${r.issues.filter((i) => i.level !== 'info').length}</b><span>보정/제외</span></div>
<div class="kpi"><b>${r.lessons.filter((l) => l.payment).length}</b><span>결제 표시</span></div>
</div>
<h2>탭 1 · programs (프로그램 마스터)</h2>
<p>첫/마지막 레슨, 레슨 수, 결제 횟수는 수식이라 새 레슨을 추가하면 자동으로 갱신돼요. 대상과 상태는 직접 입력하는 칸이고, 상태를 바꾸면 lessons 탭의 해당 레슨 전체에 반영돼요.</p>
${table(n.toPreviewRows(r.programs, n.PROGRAM_COLUMNS), 'short')}
<h2>탭 2 · migration_issues (정제 내역)</h2>
${table(n.toPreviewRows(r.issues, n.ISSUE_COLUMNS), 'short')}
<h2>탭 3 · lessons (레슨 1건 = 1행, 날짜순)</h2>
${table(n.toPreviewRows(r.lessons.map((l) => ({ ...l, student: r.programs.find((p) => p.program_id === l.program_id).student, status: r.programs.find((p) => p.program_id === l.program_id).status })), n.LESSON_COLUMNS))}
</body></html>`;

fs.writeFileSync(out, html);
console.log(`wrote ${out}: ${r.programs.length} programs, ${r.lessons.length} lessons, ${r.issues.length} issues`);

#!/usr/bin/env node
/** apps-script/*.js 를 Apps Script 편집기에 한 번에 붙여 넣을 수 있는 한 파일로 합친다 → apps-script/dist/LessonApp.gs */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'apps-script');
const parts = ['Normalize.js', 'Code.js', 'WebPush.js', 'Api.js'].map((f) => '// ===== ' + f + ' =====\n' + fs.readFileSync(path.join(dir, f), 'utf8'));
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
fs.writeFileSync(path.join(dir, 'dist', 'LessonApp.gs'), '// 레슨 수첩 Apps Script (자동 생성: node tools/build_gas.js). 이 파일 하나를 편집기에 붙여 넣으세요.\n\n' + parts.join('\n\n'));
console.log('wrote apps-script/dist/LessonApp.gs');

// 경량판: API·알림에 필요한 것만 (dist/LessonApi.gs). 처음 설정은 이 파일 하나면 된다.
const strip = (src) => src.replace(/\/\*\*[\s\S]*?\*\/\n?/g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\n\s*\n+/g, '\n');
const code = fs.readFileSync(path.join(dir, 'Code.js'), 'utf8');
const cfg = code.slice(code.indexOf('var CONFIG = {'), code.indexOf('var DB_ID_PROP'));
const helpers = `function todayIso_() { return Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd'); }
function lastDataRow_(sheet) {
  var ids = sheet.getRange('A:A').getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (ids[i][0] !== '') return i + 1;
  return 0;
}
`;
const wp = fs.readFileSync(path.join(dir, 'WebPush.js'), 'utf8').replace(/if \(typeof module !== 'undefined'\) module\.exports = [^\n]*/, '');
const api = fs.readFileSync(path.join(dir, 'Api.js'), 'utf8');
fs.writeFileSync(path.join(dir, 'dist', 'LessonApi.gs'), '// 레슨 수첩 API (자동 생성 tools/build_gas.js). 처음 한 번: 배포 → 새 배포 → 웹 앱(실행: 나, 액세스: 모든 사용자) → 함수 setup 실행.\n' + strip(cfg + helpers + wp + api));
console.log('wrote apps-script/dist/LessonApi.gs');

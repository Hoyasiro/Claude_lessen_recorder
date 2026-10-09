#!/usr/bin/env node
/**
 * apps-script/*.js → Apps Script 편집기에 한 번에 붙여 넣는 한 파일.
 *   dist/LessonApp.gs : 전체 (이관 함수 포함)
 *   dist/LessonApi.gs : API·알림에 필요한 것만, 주석 제거 (처음 설정은 이 파일 하나면 된다)
 */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'apps-script');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const dropExports = (src) => src.replace(/\nif \(typeof module !== 'undefined'\)[\s\S]*$/, '\n');
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });

const full = ['Normalize.js', 'Code.js', 'WebPush.js', 'Api.js'].map((f) => '// ===== ' + f + ' =====\n' + read(f));
fs.writeFileSync(path.join(dir, 'dist', 'LessonApp.gs'), '// 레슨 수첩 Apps Script (자동 생성: node tools/build_gas.js). 이 파일 하나를 편집기에 붙여 넣으세요.\n\n' + full.join('\n\n'));
console.log('wrote apps-script/dist/LessonApp.gs');

// Code.js에서 API가 쓰는 선언만 가져온다 (최상위 선언은 다음 줄의 "}" 또는 "};"로 끝난다)
const code = read('Code.js');
const pick = (head) => {
  const i = code.indexOf(head);
  if (i < 0) throw new Error('Code.js에 없음: ' + head);
  const end = code.indexOf('\n}', i);
  return code.slice(i, code.indexOf('\n', end + 1) + 1);
};
const shared = ['var CONFIG = {', 'function todayIso_(', 'function lastDataRow_('].map(pick).join('');
const strip = (src) => src.replace(/\/\*\*[\s\S]*?\*\/\n?/g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\n\s*\n+/g, '\n');
fs.writeFileSync(path.join(dir, 'dist', 'LessonApi.gs'),
  '// 레슨 수첩 API (자동 생성 tools/build_gas.js). 처음 한 번: 배포 → 새 배포 → 웹 앱(실행: 나, 액세스: 모든 사용자) → 함수 setup 실행.\n' +
  strip(shared + dropExports(read('WebPush.js')) + read('Api.js')));
console.log('wrote apps-script/dist/LessonApi.gs');

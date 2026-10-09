#!/usr/bin/env node
/** apps-script/*.js 를 Apps Script 편집기에 한 번에 붙여 넣을 수 있는 한 파일로 합친다 → apps-script/dist/LessonApp.gs */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'apps-script');
const parts = ['Normalize.js', 'Code.js', 'WebPush.js', 'Api.js'].map((f) => '// ===== ' + f + ' =====\n' + fs.readFileSync(path.join(dir, f), 'utf8'));
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
fs.writeFileSync(path.join(dir, 'dist', 'LessonApp.gs'), '// 레슨 수첩 Apps Script (자동 생성: node tools/build_gas.js). 이 파일 하나를 편집기에 붙여 넣으세요.\n\n' + parts.join('\n\n'));
console.log('wrote apps-script/dist/LessonApp.gs');

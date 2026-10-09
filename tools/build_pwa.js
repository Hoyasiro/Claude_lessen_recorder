#!/usr/bin/env node
/**
 * web/lesson-app.html → docs/index.html (GitHub Pages로 배포하는 설치형 앱).
 * 같은 화면 코드를 쓰고, 설치형 앱용 head(매니페스트·아이콘)와 서비스워커 등록만 덧붙인다.
 * 사용: node tools/build_pwa.js
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'web', 'lesson-app.html'), 'utf8');
const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1f6b4f">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-192.png">
<style>:root{padding-top:env(safe-area-inset-top,0px)}body{margin:0}[hidden]{display:none!important}</style>
<script>
window.LESSON_PWA = true;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
</script>
</head>
<body>
${page}
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'docs', 'index.html'), html);
console.log('wrote docs/index.html');

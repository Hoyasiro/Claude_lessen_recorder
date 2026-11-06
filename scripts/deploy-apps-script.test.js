// scripts/deploy-apps-script.sh와 scripts/setup-deploy.sh를 가짜 clasp로 실행해
// 비밀값 없음 분기, 배포 자동 탐지, 파일 목록·매니페스트 점검, check_only, 명령 순서, 실패 처리, 비밀값 비노출을 확인한다.
// 실행: node --test scripts/*.test.js
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const DEPLOY = path.join(__dirname, 'deploy-apps-script.sh');
const SETUP = path.join(__dirname, 'setup-deploy.sh');
const REPO_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps-script', 'appsscript.json'), 'utf8'));
const CLASPRC = { tokens: { default: { refresh_token: 'secret-refresh-token', client_secret: 'secret-client-secret' } } };
const SCRIPT_ID = 'secret-script-id-0123456789';
const DEPLOYMENT_ID = 'AKfy-secret-deployment-id';
const CODE = '// 레슨 수첩 API (빌드 결과)\nfunction doGet() {}\n';
const ONE = JSON.stringify([
  { deploymentId: 'AKfy-head-deployment', description: 'Head' },
  { deploymentId: DEPLOYMENT_ID, versionNumber: 7, description: 'web app' },
]);
const TWO = JSON.stringify([
  { deploymentId: 'AKfy-head-deployment' },
  { deploymentId: 'AKfy-first-deployment', versionNumber: 3, description: 'old' },
  { deploymentId: DEPLOYMENT_ID, versionNumber: 7, description: 'web app' },
]);

const lessonDeploy = (extra = {}) => JSON.stringify({ clasprc: CLASPRC, scriptId: SCRIPT_ID, ...extra });

/**
 * 가짜 clasp: 받은 인자와 그때의 파일 상태를 기록한다.
 * FAKE_CLASP_FAIL에 맞는 명령은 실패하고, list-deployments는 FAKE_DEPLOYMENTS를,
 * pull은 ctx.live 폴더(현재 프로젝트) 파일을 현재 폴더로 복사하고, push는 올린 파일을 ctx.pushed에 복사하고, login은 인증 파일을 만든다.
 * live: 현재 프로젝트 파일 { 이름: 내용 } (기본: 이전 코드 + 저장소와 같은 매니페스트)
 */
function setup(live = { 'Code.js': '// old code\n', 'appsscript.json': JSON.stringify(REPO_MANIFEST) }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'));
  const gas = path.join(root, 'LessonApi.gs');
  fs.writeFileSync(gas, CODE);
  const manifest = path.join(root, 'appsscript.json');
  fs.writeFileSync(manifest, JSON.stringify(REPO_MANIFEST, null, 2));
  const liveDir = path.join(root, 'live');
  for (const [name, text] of Object.entries(live)) {
    fs.mkdirSync(path.dirname(path.join(liveDir, name)), { recursive: true });
    fs.writeFileSync(path.join(liveDir, name), text);
  }
  fs.mkdirSync(liveDir, { recursive: true });
  const pushed = path.join(root, 'pushed');
  const log = path.join(root, 'clasp.log');
  const clasp = path.join(root, 'fake-clasp.sh');
  fs.writeFileSync(
    clasp,
    `#!/usr/bin/env bash
auth="$2"; cmd="$3"
if [ "$cmd" = login ]; then echo '${JSON.stringify(CLASPRC)}' > "$auth"; echo "login|$*" >> "${log}"; exit 0; fi
echo "$cmd|$*|auth=$(cat "$auth")|project=$(cat .clasp.json 2>/dev/null)|files=$(ls | tr '\\n' ' ')" >> "${log}"
if [ "$cmd" = "\${FAKE_CLASP_FAIL:-}" ]; then echo "Error: User has not enabled the Apps Script API. token=secret-refresh-token id=${SCRIPT_ID}" >&2; exit 1; fi
if [ "$cmd" = list-deployments ]; then echo "\${FAKE_DEPLOYMENTS:-[]}"; fi
if [ "$cmd" = pull ]; then cp -R "${liveDir}/." .; echo "Pulled files"; fi
if [ "$cmd" = push ]; then mkdir -p "${pushed}"; cp -R . "${pushed}/"; echo "Pushed"; fi
if [ "$cmd" = update-deployment ]; then echo '{"deploymentId":"x","versionNumber":42,"description":"x"}'; fi
`,
  );
  fs.chmodSync(clasp, 0o755);
  return { root, gas, manifest, log, clasp, pushed, summary: path.join(root, 'summary.md') };
}

function run(ctx, script, env, input) {
  const result = spawnSync('bash', [script], {
    env: {
      PATH: process.env.PATH,
      HOME: ctx.root,
      GAS_FILE: ctx.gas,
      MANIFEST: ctx.manifest,
      WORK_DIR: ctx.root,
      CLASP: ctx.clasp,
      COMMIT_SHA: 'abcdef0123456789',
      GITHUB_STEP_SUMMARY: ctx.summary,
      ...env,
    },
    input,
    encoding: 'utf8',
  });
  const summary = fs.existsSync(ctx.summary) ? fs.readFileSync(ctx.summary, 'utf8') : '';
  const calls = fs.existsSync(ctx.log) ? fs.readFileSync(ctx.log, 'utf8').trim().split('\n') : [];
  return { ...result, summary, calls, cmds: calls.map((c) => c.split('|')[0]), output: result.stdout + result.stderr + summary };
}

const manifestWith = (patch) => JSON.stringify({ ...REPO_MANIFEST, ...patch });

describe('deploy-apps-script.sh', () => {
  it('LESSON_DEPLOY가 없으면 배포를 건너뛰고 성공으로 끝낸다', () => {
    const ctx = setup();
    const result = run(ctx, DEPLOY, {});
    assert.equal(result.status, 0);
    assert.deepEqual(result.calls, []);
    assert.match(result.summary, /설정 필요/);
    assert.match(result.summary, /LESSON_DEPLOY/);
  });

  it('매니페스트가 같으면 pull로 점검한 뒤 Code.gs·appsscript.json 두 파일만 push -f 하고 그 배포만 새 버전으로 갱신한다', () => {
    const ctx = setup();
    const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy({ deploymentId: DEPLOYMENT_ID }) });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.cmds, ['pull', 'push', 'update-deployment']);
    const [pull, push, deploy] = result.calls;
    assert.match(pull, /\/apps-script-deploy\/auth\/\.clasprc\.json pull\|/);
    assert.match(push, /\|-A .*\/apps-script-deploy\/auth\/\.clasprc\.json push -f\|/);
    assert.ok(push.includes(`auth=${JSON.stringify(CLASPRC)}`));
    assert.ok(push.includes(`project={"scriptId":"${SCRIPT_ID}","rootDir":"."}`));
    assert.ok(push.includes('files=Code.gs appsscript.json '), push);
    assert.equal(fs.readFileSync(path.join(ctx.pushed, 'Code.gs'), 'utf8'), CODE);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ctx.pushed, 'appsscript.json'), 'utf8')), REPO_MANIFEST);
    assert.ok(deploy.includes(`update-deployment ${DEPLOYMENT_ID} -d commit abcdef0 --json`));
    assert.match(result.summary, /자동 배포 완료/);
    assert.match(result.summary, /버전: 42/);
    assert.match(result.summary, /커밋: abcdef0/);
    assert.match(result.summary, /- `Code\.js`\n- `appsscript\.json`/);
    assert.match(result.summary, /모두 같음/);
    assert.doesNotMatch(result.output, /secret-|AKfy-/);
  });

  it('키 순서·scope 순서·dependencies 생략 차이는 같은 것으로 본다', () => {
    const { dependencies: _d, ...rest } = REPO_MANIFEST;
    const reordered = { oauthScopes: [...REPO_MANIFEST.oauthScopes].reverse(), ...rest, webapp: { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_DEPLOYING' } };
    const ctx = setup({ 'Code.gs': '// old', 'appsscript.json': JSON.stringify(reordered) });
    const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy({ deploymentId: DEPLOYMENT_ID }) });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.cmds, ['pull', 'push', 'update-deployment']);
  });

  it('check_only면 점검만 하고 push·update-deployment를 하지 않는다', () => {
    const ctx = setup();
    const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy({ deploymentId: DEPLOYMENT_ID }), CHECK_ONLY: 'true' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.cmds, ['pull']);
    assert.match(result.summary, /점검 통과 \(점검만, 올리지 않음\)/);
    assert.match(result.summary, /check_only 실행이라 올리지 않았습니다/);
    assert.match(result.summary, /- `Code\.js`/);
    assert.match(result.summary, /코드: 바뀜/);
    assert.doesNotMatch(result.output, /secret-|AKfy-/);
  });

  it('check_only에서도 deploymentId가 없으면 배포를 찾아 본다', () => {
    const ctx = setup();
    const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy(), FAKE_DEPLOYMENTS: TWO, CHECK_ONLY: 'true' });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.cmds, ['list-deployments']);
    assert.match(result.stderr, /버전 배포가 2개/);
  });

  it('매니페스트의 webapp·oauthScopes가 다르면 올리지 않고 실패하며, 요약에 키 이름과 scope만 남긴다', () => {
    const live = manifestWith({
      webapp: { executeAs: 'USER_ACCESSING', access: 'ANYONE' },
      oauthScopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/script.send_mail'],
    });
    const ctx = setup({ 'Code.js': '// old', 'appsscript.json': live });
    const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy({ deploymentId: DEPLOYMENT_ID }) });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.cmds, ['pull']);
    assert.match(result.summary, /중단 \(올리지 않음\)/);
    assert.match(result.summary, /다른 항목: `webapp`, `oauthScopes`/);
    assert.match(result.summary, /현재 프로젝트에만: `https:\/\/www\.googleapis\.com\/auth\/script\.send_mail`/);
    assert.match(result.summary, /저장소에만: `https:\/\/www\.googleapis\.com\/auth\/drive`/);
    assert.match(result.summary, /저장소에만: `https:\/\/www\.googleapis\.com\/auth\/script\.scriptapp`/);
    assert.doesNotMatch(result.summary, /USER_ACCESSING/); // 값은 남기지 않는다
    assert.match(result.stderr, /올리지 않았습니다/);
    assert.ok(!fs.existsSync(ctx.pushed));
    assert.ok(!fs.existsSync(path.join(ctx.root, 'apps-script-deploy')));
  });

  it('현재 매니페스트에 oauthScopes가 없으면(자동 판단) 다르다고 보고 멈춘다', () => {
    const { oauthScopes: _s, ...noScopes } = REPO_MANIFEST;
    const ctx = setup({ 'Code.js': '// old', 'appsscript.json': JSON.stringify(noScopes) });
    const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy({ deploymentId: DEPLOYMENT_ID }), CHECK_ONLY: 'true' });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.cmds, ['pull']);
    assert.match(result.summary, /`oauthScopes`/);
    assert.match(result.summary, /oauthScopes 없음\(코드에서 자동 판단\)/);
  });

  for (const [name, patch, key] of [
    ['timeZone', { timeZone: 'America/New_York' }, 'timeZone'],
    ['runtimeVersion', { runtimeVersion: 'DEPRECATED_ES5' }, 'runtimeVersion'],
    ['dependencies', { dependencies: { libraries: [{ userSymbol: 'Lib', libraryId: 'x', version: '1' }] } }, 'dependencies'],
  ]) {
    it(`매니페스트의 ${name}가 다르면 멈춘다`, () => {
      const ctx = setup({ 'Code.js': '// old', 'appsscript.json': manifestWith(patch) });
      const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy({ deploymentId: DEPLOYMENT_ID }) });
      assert.notEqual(result.status, 0);
      assert.deepEqual(result.cmds, ['pull']);
      assert.match(result.summary, new RegExp(`다른 항목: \`${key}\``));
    });
  }

  it('점검 대상이 아닌 키(exceptionLogging)만 다르면 올린다', () => {
    const ctx = setup({ 'Code.js': CODE, 'appsscript.json': manifestWith({ exceptionLogging: 'NONE' }) });
    const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy({ deploymentId: DEPLOYMENT_ID }) });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.cmds, ['pull', 'push', 'update-deployment']);
    assert.match(result.summary, /코드: 이미 같음, 매니페스트 전체: 다름/);
  });

  it('Code.gs 말고 다른 파일이 있으면 경고하고 올리지 않는다(check_only에서도 실패)', () => {
    const ctx = setup({ 'Code.js': '// old', 'Migrate.js': '// x', 'page.html': '<p>', 'appsscript.json': JSON.stringify(REPO_MANIFEST) });
    for (const checkOnly of ['false', 'true']) {
      fs.rmSync(ctx.log, { force: true });
      fs.rmSync(ctx.summary, { force: true });
      const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy({ deploymentId: DEPLOYMENT_ID }), CHECK_ONLY: checkOnly });
      assert.notEqual(result.status, 0);
      assert.deepEqual(result.cmds, ['pull']);
      assert.match(result.summary, /- `Code\.js`\n- `Migrate\.js`\n- `appsscript\.json`\n- `page\.html`/);
      assert.match(result.summary, /⚠️ 프로젝트에 Code\.gs와 appsscript\.json 말고 다른 파일/);
      assert.match(result.summary, /다른 파일: `Migrate\.js`, `page\.html`/);
      assert.match(result.summary, /중단/);
    }
  });

  it('Code 파일이 없거나 이름이 다르면 멈춘다', () => {
    const ctx = setup({ 'Main.js': '// x', 'appsscript.json': JSON.stringify(REPO_MANIFEST) });
    const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy({ deploymentId: DEPLOYMENT_ID }) });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.cmds, ['pull']);
    assert.match(result.summary, /다른 파일: `Main\.js`/);
  });

  it('코드와 매니페스트가 이미 같으면 새 버전을 만들지 않는다', () => {
    const ctx = setup({ 'Code.js': CODE.trimEnd() + '\n\n', 'appsscript.json': JSON.stringify(REPO_MANIFEST) });
    const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy({ deploymentId: DEPLOYMENT_ID }) });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.cmds, ['pull']);
    assert.match(result.summary, /바뀐 것 없음/);
  });

  it('deploymentId가 없으면 @HEAD가 아닌 배포가 하나일 때 그 배포를 갱신한다', () => {
    const ctx = setup();
    const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy(), FAKE_DEPLOYMENTS: ONE });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.cmds, ['list-deployments', 'pull', 'push', 'update-deployment']);
    assert.ok(result.calls[3].includes(`update-deployment ${DEPLOYMENT_ID} -d commit abcdef0`));
    assert.doesNotMatch(result.output, /secret-|AKfy-/);
  });

  for (const [name, list, count] of [
    ['0개', '[{"deploymentId":"AKfy-head-deployment"}]', '0개'],
    ['2개', TWO, '2개'],
  ]) {
    it(`버전 배포가 ${name}면 올리지 않고 deploymentId 지정 필요로 실패하며 ID는 출력하지 않는다`, () => {
      const ctx = setup();
      const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy(), FAKE_DEPLOYMENTS: list });
      assert.notEqual(result.status, 0);
      assert.deepEqual(result.cmds, ['list-deployments']);
      assert.ok(result.stderr.includes(`버전 배포가 ${count}`));
      assert.match(result.stderr, /deploymentId를 지정/);
      assert.doesNotMatch(result.output, /AKfy-|secret-/);
    });
  }

  it('GitHub Actions에서는 LESSON_DEPLOY의 문자열 조각을 모두 가린다', () => {
    const ctx = setup();
    const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy({ deploymentId: DEPLOYMENT_ID }), GITHUB_ACTIONS: 'true' });
    assert.equal(result.status, 0, result.stderr);
    for (const s of ['secret-refresh-token', 'secret-client-secret', SCRIPT_ID, DEPLOYMENT_ID]) assert.ok(result.stdout.includes(`::add-mask::${s}`), s);
  });

  it('끝나면 로그인 정보와 프로젝트 파일을 지운다', () => {
    const ctx = setup();
    run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy({ deploymentId: DEPLOYMENT_ID }) });
    assert.ok(!fs.existsSync(path.join(ctx.root, 'apps-script-deploy')));
  });

  for (const cmd of ['list-deployments', 'pull', 'push', 'update-deployment']) {
    it(`${cmd}가 실패하면 실패로 끝내고 비밀값을 가린다`, () => {
      const ctx = setup();
      const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy(), FAKE_DEPLOYMENTS: ONE, FAKE_CLASP_FAIL: cmd });
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(`clasp ${cmd}이 실패했습니다.`) || result.stderr.includes(`clasp ${cmd}가 실패했습니다.`), result.stderr);
      assert.ok(result.stderr.includes('User has not enabled the Apps Script API. token=*** id=***'), result.stderr);
      assert.doesNotMatch(result.output, /secret-/);
      assert.doesNotMatch(result.summary, /배포 완료/);
      assert.ok(!fs.existsSync(path.join(ctx.root, 'apps-script-deploy')));
    });
  }

  for (const [name, value, message] of [
    ['JSON이 아님', 'not json secret-refresh-token', /올바른 JSON이 아닙니다/],
    ['base64지만 JSON이 아님', Buffer.from('secret-refresh-token').toString('base64'), /올바른 JSON이 아닙니다/],
    ['scriptId 없음', JSON.stringify({ clasprc: CLASPRC }), /scriptId/],
    ['clasprc 없음', JSON.stringify({ scriptId: SCRIPT_ID }), /clasprc/],
  ]) {
    it(`LESSON_DEPLOY가 ${name}이면 clasp를 부르지 않고 실패한다`, () => {
      const ctx = setup();
      const result = run(ctx, DEPLOY, { LESSON_DEPLOY: value });
      assert.notEqual(result.status, 0);
      assert.deepEqual(result.calls, []);
      assert.match(result.stderr, message);
      assert.doesNotMatch(result.output, /secret-/);
    });
  }

  const json = lessonDeploy({ deploymentId: DEPLOYMENT_ID });
  const b64 = Buffer.from(json).toString('base64');
  const wrap = (s, n) => s.match(new RegExp(`.{1,${n}}`, 'g')).join('\n');
  for (const [name, value] of [
    ['JSON 중간중간 줄바꿈', wrap(json, 17)],
    ['JSON CRLF 줄바꿈과 앞뒤 공백', `  ${wrap(json, 23).replace(/\n/g, '\r\n')}  \r\n`],
    ['base64 한 줄', b64],
    ['base64 줄바꿈·공백 섞임', ` ${wrap(b64, 30).replace(/\n/g, (_, i) => (i % 2 ? ' \n' : '\r\n'))} `],
    ['URL-safe base64', b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')],
    ['시작·끝 표시까지 복사한 base64', `----- LESSON_DEPLOY 시작 -----\n${wrap(b64, 40)}\n----- LESSON_DEPLOY 끝 -----`],
  ]) {
    it(`LESSON_DEPLOY가 ${name}여도 풀어서 배포한다`, () => {
      const ctx = setup();
      const result = run(ctx, DEPLOY, { LESSON_DEPLOY: value });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.cmds, ['pull', 'push', 'update-deployment']);
      assert.ok(result.calls[1].includes(`project={"scriptId":"${SCRIPT_ID}","rootDir":"."}`));
      assert.ok(result.calls[2].includes(`update-deployment ${DEPLOYMENT_ID} `));
      assert.doesNotMatch(result.output, /secret-/);
    });
  }

  it('잘린 값은 내용을 보이지 않고 진단만 출력한다', () => {
    const ctx = setup();
    const value = Buffer.from(lessonDeploy()).toString('base64');
    const result = run(ctx, DEPLOY, { LESSON_DEPLOY: `${value.slice(0, 60)}\n${value.slice(60, 90)}` });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
    assert.match(result.stderr, /길이 91자/);
    assert.match(result.stderr, /첫 글자가 '\{' 아님/);
    assert.match(result.stderr, /base64 글자만 있음/);
    assert.match(result.stderr, /줄바꿈 있음/);
    assert.ok(!result.output.includes(value.slice(0, 20)));
  });

  it('Actions에서는 여러 줄 값을 줄마다 가리고, 줄바꿈이 든 값은 add-mask에 넘기지 않는다', () => {
    const ctx = setup();
    const lines = b64.match(/.{1,50}/g);
    const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lines.join('\n'), GITHUB_ACTIONS: 'true' });
    assert.equal(result.status, 0, result.stderr);
    for (const line of lines.filter((l) => l.length >= 6)) assert.ok(result.stdout.includes(`::add-mask::${line}\n`));
    assert.ok(result.stdout.includes(`::add-mask::${b64}\n`));
    const plain = result.stdout.split('\n').filter((l) => !l.startsWith('::add-mask::')).join('\n');
    for (const line of lines.filter((l) => l.length >= 6)) assert.ok(!plain.includes(line));
  });

  it('올릴 파일이 없으면 실패한다', () => {
    const ctx = setup();
    const result = run(ctx, DEPLOY, { LESSON_DEPLOY: lessonDeploy(), GAS_FILE: path.join(ctx.root, 'missing.gs') });
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.calls, []);
  });

  it('기본 경로는 저장소의 apps-script/dist/LessonApi.gs와 apps-script/appsscript.json이다', () => {
    const ctx = setup();
    const result = spawnSync('bash', [DEPLOY], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: ctx.root, WORK_DIR: ctx.root, CLASP: ctx.clasp, GITHUB_STEP_SUMMARY: ctx.summary, LESSON_DEPLOY: lessonDeploy({ deploymentId: DEPLOYMENT_ID }) },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(ctx.pushed, 'Code.gs'), 'utf8'), fs.readFileSync(path.join(ROOT, 'apps-script', 'dist', 'LessonApi.gs'), 'utf8'));
  });
});

/** setup-deploy.sh가 출력한 LESSON_DEPLOY 한 줄 */
function secretLine(stdout) {
  const lines = stdout.split('\n');
  const value = lines[lines.indexOf('----- LESSON_DEPLOY 시작 -----') + 1];
  assert.match(value, /^[A-Za-z0-9+/]+={0,2}$/);
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
}

describe('setup-deploy.sh', () => {
  it('스크립트 ID 확인 → 로그인 → 배포가 하나면 그 ID를 넣은 LESSON_DEPLOY 한 줄을 출력하고, 로그인 정보를 남기지 않는다', () => {
    const ctx = setup();
    const result = run(ctx, SETUP, { FAKE_DEPLOYMENTS: ONE }, `짧음\n ${SCRIPT_ID} \n`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /스크립트 ID 형식이 아닙니다/);
    assert.deepEqual(result.cmds, ['login', 'list-deployments']);
    assert.ok(result.calls[0].includes('login --no-localhost'));
    assert.deepEqual(secretLine(result.stdout), { clasprc: CLASPRC, scriptId: SCRIPT_ID, deploymentId: DEPLOYMENT_ID });
    assert.match(result.stdout, /Name: LESSON_DEPLOY/);
    assert.ok(result.stdout.includes('https://github.com/Hoyasiro/Claude_lessen_recorder/settings/secrets/actions/new'));
    assert.match(result.stdout, /레슨 수첩 API/);
    assert.match(result.stdout, /줄바꿈이 섞여도 괜찮습니다/);
    const saved = path.join(ctx.root, 'lesson_deploy.txt');
    assert.equal(JSON.parse(Buffer.from(fs.readFileSync(saved, 'utf8').trim(), 'base64').toString('utf8')).scriptId, SCRIPT_ID);
    assert.equal(fs.statSync(saved).mode & 0o777, 0o600);
    assert.match(result.stdout, /rm ~\/lesson_deploy\.txt/);
    assert.ok(!fs.existsSync(path.join(ctx.root, '.clasprc.json')));
    assert.doesNotMatch(result.output, /차계부|niro|NIRO/i);
  });

  it('배포가 여러 개면 번호를 골라 그 ID를 넣는다', () => {
    const ctx = setup();
    const result = run(ctx, SETUP, { FAKE_DEPLOYMENTS: TWO }, `${SCRIPT_ID}\n9\n2\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1부터 2 사이 번호/);
    assert.equal(secretLine(result.stdout).deploymentId, DEPLOYMENT_ID);
  });

  it('배포가 없으면 안내하고 실패한다', () => {
    const ctx = setup();
    const result = run(ctx, SETUP, { FAKE_DEPLOYMENTS: '[]' }, `${SCRIPT_ID}\n`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /웹 앱 배포가 없습니다/);
    assert.doesNotMatch(result.stdout, /LESSON_DEPLOY 시작/);
  });

  it('Apps Script API가 꺼져 있으면 켜는 곳을 안내한다', () => {
    const ctx = setup();
    const result = run(ctx, SETUP, { FAKE_CLASP_FAIL: 'list-deployments' }, `${SCRIPT_ID}\n`);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('https://script.google.com/home/usersettings'));
  });

  it('예전 ~/.clasprc.json은 기본으로 지우고, n이면 남긴다', () => {
    const ctx = setup();
    fs.writeFileSync(path.join(ctx.root, '.clasprc.json'), '{}');
    assert.equal(run(ctx, SETUP, { FAKE_DEPLOYMENTS: ONE }, `${SCRIPT_ID}\n\n`).status, 0);
    assert.ok(!fs.existsSync(path.join(ctx.root, '.clasprc.json')));
    const ctx2 = setup();
    fs.writeFileSync(path.join(ctx2.root, '.clasprc.json'), '{}');
    assert.equal(run(ctx2, SETUP, { FAKE_DEPLOYMENTS: ONE }, `${SCRIPT_ID}\nn\n`).status, 0);
    assert.ok(fs.existsSync(path.join(ctx2.root, '.clasprc.json')));
  });
});

#!/usr/bin/env bash
# 레슨 수첩 Apps Script 자동 배포. GitHub Actions의 deploy-apps-script.yml이 부른다.
# 빌드된 apps-script/dist/LessonApi.gs(이름은 Code.gs로)와 apps-script/appsscript.json 두 파일만 clasp로 올리고,
# 기존 웹 앱 배포를 새 버전으로 갱신한다(새 배포를 만들지 않아 URL 유지).
#
# 올리기 전에 현재 프로젝트를 임시 폴더로 받아(clasp pull) 다음을 점검하고, 하나라도 걸리면 올리지 않고 실패한다.
#   - 프로젝트 파일이 Code(.gs/.js)와 appsscript.json뿐인지 (clasp push는 프로젝트 파일 전체를 바꾸므로)
#   - 현재 매니페스트와 저장소 매니페스트의 webapp·oauthScopes·timeZone·runtimeVersion·dependencies가 같은지
#     (다르면 권한이 바뀌어 다시 승인할 때까지 웹 앱과 15분 알림 트리거 pushTick이 멈출 수 있다)
# setup()·resetToken()·트리거 만들기는 실행하지 않는다.
#
# 환경 변수
#   LESSON_DEPLOY GitHub Secret. base64(또는 한 줄 JSON) {"clasprc": <~/.clasprc.json 객체>, "scriptId": "...", "deploymentId": "..."(선택)}.
#                 scripts/setup-deploy.sh가 만들어 준다. 없으면 배포를 건너뛰고 성공으로 끝낸다.
#                 deploymentId가 없으면 @HEAD가 아닌 배포가 정확히 하나일 때 그 배포를 갱신한다.
#   CHECK_ONLY    true면 점검만 하고 올리지 않는다(기본 false)
#   COMMIT_SHA    배포할 커밋(버전 설명에 앞 7자리)
#   GAS_FILE      올릴 코드(기본 apps-script/dist/LessonApi.gs). 프로젝트에는 Code.gs로 올린다.
#   MANIFEST      올릴 매니페스트(기본 apps-script/appsscript.json)
#   WORK_DIR      로그인 정보·프로젝트 파일을 둘 임시 폴더(기본 $RUNNER_TEMP). 끝나면 지운다.
#   CLASP         clasp 실행 명령(기본 clasp, 테스트에서 가짜 명령으로 바꾼다)
#   GITHUB_STEP_SUMMARY  요약을 덧붙일 파일(없으면 표준 출력)
#
# 비밀값을 출력하지 않는다: set -x를 쓰지 않고, clasp 출력도 그대로 보여 주지 않는다. 요약에는 파일 이름·키 이름·scope만 남긴다.
set -euo pipefail

# 요약은 GITHUB_STEP_SUMMARY 파일에 덧붙이고, 없으면(로컬 실행) 표준 출력으로 보낸다.
append_summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat >>"$GITHUB_STEP_SUMMARY"; else cat; fi; }
gas_file="${GAS_FILE:-apps-script/dist/LessonApi.gs}"
manifest="${MANIFEST:-apps-script/appsscript.json}"
clasp="${CLASP:-clasp}"
check_only="${CHECK_ONLY:-false}"
sha="${COMMIT_SHA:-unknown}"
short_sha="${sha:0:7}"

if [ -z "${LESSON_DEPLOY:-}" ]; then
  {
    echo "### Apps Script 자동 배포: 설정 필요"
    echo ""
    echo "GitHub Secret LESSON_DEPLOY가 없어 배포를 건너뛰었습니다."
    echo "README의 \"Apps Script 자동 배포 (1회 설정)\"을 따라 주세요."
  } | append_summary
  exit 0
fi

for file in "$gas_file" "$manifest"; do
  [ -f "$file" ] || { echo "올릴 파일 $file이 없습니다." >&2; exit 1; }
done
gas_file=$(cd "$(dirname "$gas_file")" && pwd)/$(basename "$gas_file")
manifest=$(cd "$(dirname "$manifest")" && pwd)/$(basename "$manifest")

work="${WORK_DIR:-${RUNNER_TEMP:-$(mktemp -d)}}/apps-script-deploy"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
rm -rf "$work"
umask 077
mkdir -p "$work/auth" "$work/project" "$work/current"

# LESSON_DEPLOY를 풀어 로그인 정보·프로젝트 설정을 임시 폴더에만 쓴다. 문자열 조각은 모두 로그에서 가린다.
# 휴대폰에서 긴 값을 복사하면 줄바꿈·공백이 섞이기 쉬워 다음 순서로 풀어 본다:
#   (a) 그대로 JSON → (b) 앞뒤 공백·줄바꿈(CR/LF)과 "LESSON_DEPLOY 시작/끝" 표시 줄을 지운 JSON
#   → (c) 모든 공백을 지운 base64(일반·URL-safe)를 풀어 JSON. 모두 실패하면 값은 보이지 않고 진단만 출력한다.
if ! node - "$work" <<'NODE'
const fs = require('fs')
const path = require('path')
const work = process.argv[2]
const raw = process.env.LESSON_DEPLOY ?? ''
// 줄바꿈이 든 값을 그대로 넘기면 둘째 줄부터 로그에 그대로 찍히므로, 한 줄짜리만 넘긴다(여러 줄은 줄마다 가린다).
const mask = (s) => {
  if (process.env.GITHUB_ACTIONS && typeof s === 'string' && s.length >= 6 && !/[\r\n]/.test(s)) console.log(`::add-mask::${s}`)
}
mask(raw.trim())
for (const line of raw.split(/\r?\n/)) mask(line.trim())
const withoutMarkers = raw
  .split(/\r?\n/)
  .filter((line) => !/^\s*-{3,}.*LESSON_DEPLOY.*-{3,}\s*$/.test(line))
  .join('')
  .replace(/[\r\n]/g, '')
  .trim()
const compact = withoutMarkers.replace(/\s+/g, '')
mask(withoutMarkers)
mask(compact)
const tryJson = (text) => {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}
const tryBase64 = (text) => {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) return null
  const decoded = Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  return tryJson(decoded)
}
const config = tryJson(raw) ?? tryJson(withoutMarkers) ?? tryBase64(compact)
if (!config) {
  const facts = [
    `길이 ${raw.length}자`,
    `첫 글자가 '{' ${compact.startsWith('{') ? '맞음' : '아님'}`,
    `base64 글자만 ${/^[A-Za-z0-9+/_=-]+$/.test(compact) ? '있음' : '아님'}`,
    `줄바꿈 ${/[\r\n]/.test(raw) ? '있음' : '없음'}`,
    `끝 글자가 '}' ${compact.endsWith('}') ? '맞음' : '아님(잘렸을 수 있음)'}`,
  ]
  console.error(`LESSON_DEPLOY를 풀지 못했습니다(올바른 JSON이 아닙니다). 진단: ${facts.join(', ')}.`)
  console.error('setup-deploy.sh를 다시 실행해 "LESSON_DEPLOY 시작"과 "끝" 사이의 값을 처음부터 끝까지 복사해 Secret을 바꿔 주세요(줄바꿈이 섞여도 괜찮습니다).')
  process.exit(1)
}
const secrets = []
const walk = (v) => (typeof v === 'string' ? secrets.push(v) : v && typeof v === 'object' && Object.values(v).forEach(walk))
walk(config)
for (const s of secrets) mask(s)
const id = /^[A-Za-z0-9_-]{10,}$/
if (typeof config.clasprc !== 'object' || config.clasprc === null || !id.test(config.scriptId ?? '')) {
  console.error('LESSON_DEPLOY에 clasprc(객체)와 scriptId가 있어야 합니다. setup-deploy.sh를 다시 실행해 주세요.')
  process.exit(1)
}
if (config.deploymentId !== undefined && !id.test(config.deploymentId)) {
  console.error('LESSON_DEPLOY의 deploymentId 형식이 올바르지 않습니다.')
  process.exit(1)
}
const claspJson = JSON.stringify({ scriptId: config.scriptId, rootDir: '.' })
fs.writeFileSync(path.join(work, 'auth', '.clasprc.json'), JSON.stringify(config.clasprc))
fs.writeFileSync(path.join(work, 'project', '.clasp.json'), claspJson)
fs.writeFileSync(path.join(work, 'current', '.clasp.json'), claspJson)
fs.writeFileSync(path.join(work, 'deployment-id'), config.deploymentId ?? '')
fs.writeFileSync(path.join(work, 'secrets.json'), JSON.stringify(secrets))
NODE
then
  exit 1
fi

auth=(-A "$work/auth/.clasprc.json")

# clasp 오류 줄 중 원인을 알 만한 줄만 보여 주되, LESSON_DEPLOY 안의 문자열 값(토큰·ID)은 ***로 가린다.
show_errors() {
  grep -iE "error|denied|enabled|invalid|unauthor|401|403|404" "$1" | head -5 |
    node -e '
      const fs = require("fs")
      const secrets = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
      let text = fs.readFileSync(0, "utf8")
      for (const s of secrets.filter((s) => s.length >= 6).sort((a, b) => b.length - a.length)) text = text.split(s).join("***")
      process.stderr.write(text)
    ' "$work/secrets.json" || true
}

deployment_id=$(cat "$work/deployment-id")
if [ -z "$deployment_id" ]; then
  echo "갱신할 웹 앱 배포를 찾습니다."
  if ! (cd "$work/project" && "$clasp" "${auth[@]}" list-deployments --json) >"$work/deployments.json" 2>"$work/list.log"; then
    echo "clasp list-deployments가 실패했습니다." >&2
    show_errors "$work/list.log"
    exit 1
  fi
  # @HEAD(버전 번호 없음)가 아닌 배포가 정확히 하나일 때만 그 배포를 쓴다. ID는 출력하지 않는다.
  # shellcheck disable=SC2016 # 작은따옴표 안의 ${}는 셸이 아닌 JavaScript 템플릿 문자열이다.
  if ! deployment_id=$(node -e '
    const list = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
    const versioned = (Array.isArray(list) ? list : []).filter((d) => d && d.deploymentId && Number.isInteger(d.versionNumber))
    if (versioned.length !== 1) {
      console.error(`버전 배포가 ${versioned.length}개라 어느 것을 갱신할지 정할 수 없습니다. LESSON_DEPLOY에 deploymentId를 지정해야 합니다(setup-deploy.sh를 다시 실행).`)
      process.exit(1)
    }
    process.stdout.write(versioned[0].deploymentId)
  ' "$work/deployments.json"); then
    exit 1
  fi
fi

echo "현재 Apps Script 프로젝트를 임시 폴더로 받아 점검합니다."
if ! (cd "$work/current" && "$clasp" "${auth[@]}" pull) >"$work/pull.log" 2>&1; then
  echo "clasp pull이 실패했습니다." >&2
  show_errors "$work/pull.log"
  exit 1
fi

# 점검 결과: ok(바뀐 것 있음) / same(코드·매니페스트가 이미 같음) / stop(올리면 안 됨). 요약은 이 node가 쓴다.
# shellcheck disable=SC2016 # 작은따옴표 안의 ${}는 셸이 아닌 JavaScript 템플릿 문자열이다.
verdict=$(node -e '
  const fs = require("fs")
  const path = require("path")
  const [current, gasFile, manifestFile, summary] = process.argv.slice(1)
  const out = []
  const files = []
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name
      if (entry.isDirectory()) walk(path.join(dir, entry.name), name + "/")
      else if (![".clasp.json", ".claspignore"].includes(name)) files.push(name)
    }
  }
  walk(current, "")
  files.sort()
  const codeFiles = files.filter((f) => /^Code\.(gs|js)$/.test(f))
  const others = files.filter((f) => f !== "appsscript.json" && !codeFiles.includes(f))
  let stop = false

  out.push("#### 현재 프로젝트 파일")
  out.push("")
  for (const f of files) out.push("- `" + f + "`")
  if (!files.length) out.push("- (없음)")
  out.push("")
  if (others.length || codeFiles.length !== 1) {
    stop = true
    out.push("> ⚠️ 프로젝트에 Code.gs와 appsscript.json 말고 다른 파일이 있거나 Code.gs가 없습니다. 자동 배포는 프로젝트 파일 전체를 두 파일로 바꾸므로 올리지 않았습니다.")
    if (others.length) out.push("> 다른 파일: " + others.map((f) => "`" + f + "`").join(", ") + ". 필요 없으면 편집기에서 지우고, 필요하면 저장소에 옮긴 뒤 다시 실행해 주세요.")
    out.push("")
  }

  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")) } catch { return null } }
  const repo = read(manifestFile)
  const live = files.includes("appsscript.json") ? read(path.join(current, "appsscript.json")) : null
  const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x))
  out.push("#### 매니페스트 비교 (현재 프로젝트 ↔ 저장소 apps-script/appsscript.json)")
  out.push("")
  if (!repo) {
    stop = true
    out.push("> ⚠️ 저장소 매니페스트를 읽지 못했습니다.")
  } else if (!live) {
    stop = true
    out.push("> ⚠️ 현재 프로젝트의 appsscript.json을 읽지 못했습니다. 올리지 않았습니다.")
  } else {
    const diffs = []
    for (const key of ["webapp", "oauthScopes", "timeZone", "runtimeVersion", "dependencies"]) {
      let a = live[key]
      let b = repo[key]
      if (key === "dependencies") { a = a ?? {}; b = b ?? {} }
      if (key === "oauthScopes" && Array.isArray(a) && Array.isArray(b)) { a = [...a].sort(); b = [...b].sort() }
      if (canon(a) !== canon(b)) diffs.push(key)
    }
    if (!diffs.length) {
      out.push("- webapp·oauthScopes·timeZone·runtimeVersion·dependencies 모두 같음")
    } else {
      stop = true
      out.push("> ⚠️ 다른 항목: " + diffs.map((k) => "`" + k + "`").join(", ") + ". 이대로 올리면 권한·웹 앱 설정이 바뀌어 다시 승인할 때까지 웹 앱과 15분 알림(pushTick)이 멈출 수 있어 올리지 않았습니다.")
      if (diffs.includes("oauthScopes")) {
        const liveScopes = Array.isArray(live.oauthScopes) ? live.oauthScopes : null
        const repoScopes = Array.isArray(repo.oauthScopes) ? repo.oauthScopes : []
        out.push("")
        if (!liveScopes) out.push("- 현재 프로젝트: oauthScopes 없음(코드에서 자동 판단)")
        else for (const s of liveScopes.filter((s) => !repoScopes.includes(s))) out.push("- 현재 프로젝트에만: `" + s + "`")
        for (const s of repoScopes.filter((s) => !(liveScopes ?? []).includes(s))) out.push("- 저장소에만: `" + s + "`")
      }
      out.push("")
      out.push("> 편집기 프로젝트 설정에서 \"appsscript.json 매니페스트 파일 표시\"를 켜고 저장소 apps-script/appsscript.json 내용으로 맞춘 뒤(권한 다시 허용) 다시 실행하거나, 저장소 매니페스트를 현재 값에 맞춰 주세요.")
    }
  }
  out.push("")

  let same = false
  if (!stop && codeFiles.length === 1) {
    const norm = (s) => s.replace(/\r\n/g, "\n").replace(/\s+$/, "")
    const codeSame = norm(fs.readFileSync(path.join(current, codeFiles[0]), "utf8")) === norm(fs.readFileSync(gasFile, "utf8"))
    same = codeSame && canon(live) === canon(repo)
    out.push("- 코드: " + (codeSame ? "이미 같음" : "바뀜") + ", 매니페스트 전체: " + (canon(live) === canon(repo) ? "같음" : "다름(점검 항목 밖의 키만)"))
    out.push("")
  }
  fs.appendFileSync(summary, out.join("\n") + "\n")
  process.stdout.write(stop ? "stop" : same ? "same" : "ok")
' "$work/current" "$gas_file" "$manifest" "$work/summary-part.md")

title="Apps Script 자동 배포"
case "$verdict" in
  stop) title="$title: 중단 (올리지 않음)" ;;
  same) title="$title: 바뀐 것 없음" ;;
  *) if [ "$check_only" = true ]; then title="$title: 점검 통과 (점검만, 올리지 않음)"; fi ;;
esac
if [ "$verdict" = stop ] || [ "$verdict" = same ] || [ "$check_only" = true ]; then
  {
    echo "### $title"
    echo ""
    echo "- 커밋: $short_sha"
    if [ "$verdict" = same ]; then
      echo "- 현재 프로젝트의 코드와 매니페스트가 이미 이 커밋과 같아 새 버전을 만들지 않았습니다."
    elif [ "$verdict" = ok ]; then
      echo "- check_only 실행이라 올리지 않았습니다. 점검에 문제가 없으니 check_only를 끄고 다시 실행하거나 다음 병합을 기다리면 됩니다."
    fi
    echo ""
    cat "$work/summary-part.md"
  } | append_summary
  if [ "$verdict" = stop ]; then
    echo "점검에서 문제가 있어 올리지 않았습니다. 실행 요약을 확인해 주세요." >&2
    exit 1
  fi
  exit 0
fi

cp "$gas_file" "$work/project/Code.gs"
cp "$manifest" "$work/project/appsscript.json"

echo "Apps Script에 파일을 올립니다(Code.gs, appsscript.json)."
if ! (cd "$work/project" && "$clasp" "${auth[@]}" push -f) >"$work/push.log" 2>&1; then
  echo "clasp push가 실패했습니다." >&2
  show_errors "$work/push.log"
  exit 1
fi

echo "기존 웹 앱 배포를 새 버전으로 갱신합니다."
if ! (cd "$work/project" && "$clasp" "${auth[@]}" update-deployment "$deployment_id" -d "commit $short_sha" --json) >"$work/deploy.json" 2>"$work/deploy.log"; then
  echo "clasp update-deployment가 실패했습니다." >&2
  show_errors "$work/deploy.log"
  exit 1
fi
version=$(node -e 'const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(String(j.versionNumber ?? ""))' "$work/deploy.json" 2>/dev/null || true)
if [ -z "$version" ]; then
  echo "새 버전 번호를 확인하지 못했습니다." >&2
  exit 1
fi

{
  echo "### Apps Script 자동 배포 완료"
  echo ""
  echo "- 버전: $version"
  echo "- 커밋: $short_sha"
  echo "- 기존 웹 앱 배포를 갱신했습니다(URL 그대로). setup·resetToken·트리거 만들기는 실행하지 않았습니다."
  echo ""
  cat "$work/summary-part.md"
} | append_summary

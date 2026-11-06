#!/usr/bin/env bash
# Apps Script 자동 배포 1회 설정 도우미. Google Cloud Shell(또는 Node.js가 있는 PC)에서 실행한다.
#   bash <(curl -fsSL https://raw.githubusercontent.com/Hoyasiro/Claude_lessen_recorder/HEAD/scripts/setup-deploy.sh)
#
# 하는 일: 스크립트 ID 입력 → 고정 버전 clasp로 Google 로그인(--no-localhost) → 웹 앱 배포 확인
#   → GitHub Secret LESSON_DEPLOY에 넣을 한 줄을 출력한다.
# 로그인 정보는 임시 폴더에만 두고 끝나면 지운다. 명령 기록(history)에는 남지 않는다(이 스크립트 안의 입력은 기록되지 않음).
#
# 테스트용 환경 변수: CLASP(설치 대신 쓸 clasp 명령)
set -euo pipefail

CLASP_VERSION=3.4.1

say() { printf '%s\n' "$*"; }
fail() { printf '오류: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "Node.js가 없습니다. Google Cloud Shell(https://shell.cloud.google.com)에서 실행해 주세요."

tmp=$(mktemp -d)
chmod 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT
umask 077

say "레슨 수첩 — Apps Script 자동 배포 설정"
say ""

if [ -n "${CLASP:-}" ]; then
  clasp="$CLASP"
else
  say "clasp $CLASP_VERSION을 준비합니다(잠시 걸립니다)…"
  npm install --prefix "$tmp/clasp" --silent --no-audit --no-fund "@google/clasp@$CLASP_VERSION" >/dev/null 2>&1 ||
    fail "clasp를 설치하지 못했습니다. 인터넷 연결을 확인하고 다시 실행해 주세요."
  clasp="$tmp/clasp/node_modules/.bin/clasp"
fi
auth="$tmp/.clasprc.json"

say ""
say "1) "레슨 수첩 API" Apps Script 편집기 → ⚙️ 프로젝트 설정 → \"스크립트 ID\"를 복사해 붙여 넣으세요."
script_id=""
while :; do
  read -r -p "스크립트 ID: " script_id || fail "입력이 끝났습니다."
  script_id="${script_id//[[:space:]]/}"
  [[ "$script_id" =~ ^[A-Za-z0-9_-]{20,}$ ]] && break
  say "스크립트 ID 형식이 아닙니다(영문·숫자·-·_ 20자 이상). 다시 붙여 넣어 주세요."
done

say ""
say "2) Google 로그인. 아래에 나오는 주소를 열어 레슨기록_DB 소유 계정으로 허용하세요."
say "   허용 후 \"사이트에 연결할 수 없음\"(localhost) 화면이 나오면 정상입니다. 그 화면의 주소창 전체 주소를 복사해 여기에 붙여 넣으세요."
say ""
"$clasp" -A "$auth" login --no-localhost || fail "로그인하지 못했습니다. 다시 실행해 주세요."
[ -s "$auth" ] || fail "로그인 정보가 만들어지지 않았습니다. 다시 실행해 주세요."

say ""
say "3) 웹 앱 배포를 확인합니다."
mkdir -p "$tmp/project"
SCRIPT_ID="$script_id" node -e 'process.stdout.write(JSON.stringify({ scriptId: process.env.SCRIPT_ID, rootDir: "." }))' >"$tmp/project/.clasp.json"
if ! (cd "$tmp/project" && "$clasp" -A "$auth" list-deployments --json) >"$tmp/deployments.json" 2>"$tmp/list.log"; then
  if grep -qi "not enabled\|has not been used\|disabled" "$tmp/list.log"; then
    fail "Apps Script API가 꺼져 있습니다. https://script.google.com/home/usersettings 에서 켠 뒤 몇 분 지나 다시 실행해 주세요."
  fi
  fail "배포 목록을 읽지 못했습니다. 스크립트 ID와 로그인한 계정(레슨기록_DB 소유 계정)을 확인하고 다시 실행해 주세요."
fi

# shellcheck disable=SC2016 # 작은따옴표 안의 ${}는 셸이 아닌 JavaScript 템플릿 문자열이다.
deployment_id=$(node -e '
  const list = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
  const versioned = (Array.isArray(list) ? list : []).filter((d) => d && d.deploymentId && Number.isInteger(d.versionNumber))
  if (versioned.length === 1) process.stdout.write(versioned[0].deploymentId)
  else versioned.forEach((d, i) => console.error(`  ${i + 1}) 버전 ${d.versionNumber}${d.description ? " — " + d.description : ""} (${d.deploymentId})`))
  process.exitCode = versioned.length === 0 ? 2 : versioned.length === 1 ? 0 : 3
' "$tmp/deployments.json" 2>"$tmp/choices.txt") && status=0 || status=$?

case "$status" in
  0) say "   웹 앱 배포 1개를 찾았습니다. 앞으로 이 배포를 새 버전으로 갱신합니다(URL 그대로)." ;;
  2) fail "웹 앱 배포가 없습니다. 편집기에서 배포 → 새 배포 → 웹 앱으로 한 번 배포한 뒤 다시 실행해 주세요." ;;
  3)
    say "   웹 앱 배포가 여러 개입니다. 지금 레슨 수첩 앱이 쓰는(연결 링크의 주소와 같은) 배포 번호를 고르세요."
    cat "$tmp/choices.txt"
    count=$(grep -c ')' "$tmp/choices.txt")
    while :; do
      read -r -p "번호: " choice || fail "입력이 끝났습니다."
      if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "$count" ]; then break; fi
      say "1부터 $count 사이 번호를 입력해 주세요."
    done
    deployment_id=$(sed -n "${choice}p" "$tmp/choices.txt" | sed -E 's/.*\(([^)]+)\)$/\1/')
    ;;
  *) fail "배포 목록을 해석하지 못했습니다." ;;
esac

# 값은 base64 한 덩어리로 출력한다(공백·따옴표·중괄호가 없어 휴대폰에서 복사해도 잘 깨지지 않음).
secret=$(SCRIPT_ID="$script_id" DEPLOYMENT_ID="$deployment_id" node -e '
  const clasprc = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
  const json = JSON.stringify({ clasprc, scriptId: process.env.SCRIPT_ID, deploymentId: process.env.DEPLOYMENT_ID })
  process.stdout.write(Buffer.from(json, "utf8").toString("base64"))
' "$auth")
# 출력할 값을 다시 풀어 검증한다.
printf '%s' "$secret" | SCRIPT_ID="$script_id" node -e '
  const text = require("fs").readFileSync(0, "utf8")
  const value = JSON.parse(Buffer.from(text, "base64").toString("utf8"))
  if (value.scriptId !== process.env.SCRIPT_ID || typeof value.clasprc !== "object") process.exit(1)
' || fail "만든 값을 검증하지 못했습니다. 다시 실행해 주세요."

saved="$HOME/lesson_deploy.txt"
printf '%s\n' "$secret" >"$saved"
chmod 600 "$saved"

say ""
say "4) 아래 값 전체를 복사해 GitHub Secret에 붙여 넣으세요."
say "   https://github.com/Hoyasiro/Claude_lessen_recorder/settings/secrets/actions/new"
say "   Name: LESSON_DEPLOY   Secret: 아래 값"
say "   휴대폰에서 여러 줄로 보이거나 복사하면서 줄바꿈이 섞여도 괜찮습니다. 시작·끝 표시 사이를 빠짐없이 복사하세요."
say "   (이 값은 계정 접근 토큰입니다. 채팅·메모·저장소에는 붙여 넣지 마세요.)"
say ""
say "----- LESSON_DEPLOY 시작 -----"
printf '%s\n' "$secret"
say "----- LESSON_DEPLOY 끝 -----"
say ""
say "   복사가 어려우면 같은 값을 ~/lesson_deploy.txt에 저장해 두었습니다(본인만 읽을 수 있음)."
say "   Cloud Shell 위쪽 메뉴 ⋮(더보기) → 다운로드에서 lesson_deploy.txt를 받아 내용을 붙여 넣으세요."
say "   Secret에 넣은 뒤에는 꼭 지우세요: rm ~/lesson_deploy.txt"
say ""

# 예전에 직접 clasp login을 해서 남은 로그인 정보가 있으면 지운다(기본: 지움).
if [ -f "$HOME/.clasprc.json" ]; then
  read -r -p "예전 로그인 정보 ~/.clasprc.json이 있습니다. 지울까요? [Y/n] " answer || answer=""
  case "$answer" in
    n | N | no | NO) say "그대로 둡니다." ;;
    *) rm -f "$HOME/.clasprc.json" && say "지웠습니다." ;;
  esac
fi

say "이 창의 로그인 정보는 끝나면 자동으로 지워집니다. 복사가 끝나면 화면을 지우려면 clear를 입력하세요."

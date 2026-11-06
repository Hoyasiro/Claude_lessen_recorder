# Claude Lesson Recorder

준희 키_v2 › `레슨기록` 탭(프로그램별 가로형 날짜 목록)을 정형화한 레슨 DB를 관리한다.

- DB: 구글 드라이브 `레슨기록_DB` (원본과 같은 폴더)
- 원본 시트는 읽기만 하고 수정하지 않는다.

## DB 구조

| 탭 | 내용 |
|---|---|
| `lessons` | 레슨 1건 = 1행. 요일·대상·상태(C·F·J열)는 헤더의 배열 수식으로 자동 계산. L열 `진행`은 완료/예정/취소, M열 `시간`은 그 레슨만 레슨 주기와 시간이 다를 때 |
| `programs` | 프로그램 목록. **대상·상태는 직접 입력**(노란 칸). 상태를 바꾸면 lessons의 해당 레슨 전체에 반영. 첫/마지막 레슨·레슨 수·결제 횟수는 수식 |
| `migration_issues` | 이관 시 보정/제외 내역 |
| `app_config` | A1: 앱 설정 JSON (결제 주기·레슨 주기·색·짧은 이름) |
| `push_subs` | 알림을 받는 기기 목록 |

원본의 `+` 표시는 `결제` 체크박스로 옮겼다.

## 레슨 수첩 앱

같은 화면 코드(`web/lesson-app.html`)를 두 가지로 쓴다.

| 버전 | 주소 | 데이터 연결 | 휴대폰 알림 |
|---|---|---|---|
| 설치형 앱(PWA) | https://hoyasiro.github.io/Claude_lessen_recorder/ | Apps Script 웹 앱 API | O (레슨 수첩 푸시) |
| Claude 페이지 | https://claude.ai/artifact/K7AqxrWKAsnAmxTbpcYz8z | Google Sheets 커넥터 | X |

- 두 버전이 같은 시트와 `app_config` 설정을 함께 쓴다. 레슨 시간은 저장하지 않고 레슨 주기에서 계산한다.
- 시트에 직접 입력할 때는 lessons 탭 마지막 행 아래에 A·B·D·E·G~I·K~M 열을 쓴다 (C·F·J 열은 수식이라 비워 둔다).
- 알림: 1주 전·하루 전 레슨은 오전 9시, 당일 레슨은 시작 3시간 전(레슨 주기의 시간 기준, 시간이 없으면 당일 오전 9시). Apps Script가 15분마다 확인하므로 최대 15분 늦을 수 있다. 알릴 레슨이 없으면 보내지 않는다.

### 설치형 앱 처음 설정 (한 번만)

1. **GitHub Pages 켜기**: 저장소 Settings → Pages → Source "Deploy from a branch" → 브랜치 `ccr-86cf1ca5-ng9k2d`, 폴더 `/docs` → Save.
2. **Apps Script 만들기** (레슨기록_DB 소유 계정으로 로그인):
   - https://script.google.com → 새 프로젝트 → 이름 "레슨 수첩 API"
   - `Code.gs` 내용을 지우고 `apps-script/dist/LessonApi.gs` 전체를 붙여 넣기 (API·알림 전용 경량판. 이관 함수까지 필요하면 `LessonApp.gs`)
   - (선택) 프로젝트 설정(톱니) → "appsscript.json 매니페스트 파일 표시" → `apps-script/appsscript.json` 내용으로 바꾸기. 안 해도 배포 화면에서 정한 값으로 동작한다. 단 아래 자동 배포는 이 매니페스트가 저장소와 같아야 올린다
   - 배포 → 새 배포 → 유형 "웹 앱", 실행: 나, 액세스: 모든 사용자 → 배포 → 권한 허용
3. 편집기에서 함수 `setup` 선택 → 실행 → 실행 로그의 **연결 링크**를 복사
4. 휴대폰 브라우저에서 연결 링크 열기 → 설치
   - 삼성 인터넷: 주소창의 설치 아이콘(↓) → 설치, 또는 메뉴(≡) → "현재 페이지 추가" → "홈 화면" (비밀 모드 X)
   - 크롬: 메뉴(⋮) → "홈 화면에 추가" → 설치
5. 설치한 레슨 수첩 → 설정(톱니) → 휴대폰 알림 → **알림 켜기** → **테스트 알림**으로 확인
6. (선택) 코드 변경을 자동으로 올리려면 아래 "Apps Script 자동 배포 (1회 설정)"을 한다

연결 링크에는 비밀 토큰이 들어 있으니 공유하지 않는다. 유출이 의심되면 편집기에서 `resetToken` 실행 후 새 링크로 다시 연결.
코드를 고친 뒤에는 `node tools/build_gas.js` / `node tools/build_pwa.js` 로 다시 만들어 결과까지 커밋한다(CI가 빌드 결과와 커밋이 같은지 확인한다). Apps Script는 아래 자동 배포를 설정했으면 기본 브랜치에 병합될 때 자동으로 올라간다. 설정하지 않았으면 붙여 넣은 뒤 배포 → 배포 관리 → 연필 → 버전: 새 버전 → 배포.

### Apps Script 자동 배포 (1회 설정)

한 번 설정하면 기본 브랜치(`ccr-86cf1ca5-ng9k2d`)에 병합된 커밋의 CI가 성공할 때 GitHub Actions의 **Deploy Apps Script** 워크플로가
`apps-script/dist/LessonApi.gs`(프로젝트에는 `Code.gs`로)와 `apps-script/appsscript.json` 두 파일을 "레슨 수첩 API" 프로젝트에 올리고 **기존 웹 앱 배포를 새 버전으로 갱신**한다.
새 배포를 만들지 않으므로 웹 앱 주소와 설치형 앱의 연결 링크는 그대로다. 버전 설명에는 커밋 앞 7자리가 들어간다. 코드와 매니페스트가 이미 같으면 새 버전을 만들지 않는다.

- 배포는 `setup`·`resetToken`·트리거 만들기를 **실행하지 않는다**. 토큰(스크립트 속성)·15분 알림 트리거·`push_subs`는 그대로다. 처음 설정이나 토큰 재발급은 지금처럼 편집기에서 직접 실행한다.
- 올리기 전에 현재 프로젝트를 임시로 받아 점검하고, 다음 경우에는 **올리지 않고 실패**한다(실행 요약에 파일 이름·키 이름·scope 목록만 남긴다).
  - 프로젝트에 `Code.gs`·`appsscript.json` 말고 다른 파일이 있을 때 (자동 배포는 프로젝트 파일 전체를 두 파일로 바꾼다)
  - 현재 매니페스트의 `webapp`·`oauthScopes`·`timeZone`·`runtimeVersion`·`dependencies`가 저장소의 `apps-script/appsscript.json`과 다를 때 (그대로 올리면 권한이 바뀌어 다시 승인할 때까지 웹 앱과 알림이 멈출 수 있다). 편집기 프로젝트 설정에서 "appsscript.json 매니페스트 파일 표시"를 켜고 저장소 내용으로 맞추거나(권한 다시 허용), 저장소 매니페스트를 고친다.
- Secret을 넣기 전에는 워크플로가 "설정 필요"만 남기고 아무것도 올리지 않는다(손 배포는 그대로 쓸 수 있다).

사용자가 할 일 (레슨기록_DB 소유 계정, 휴대폰으로도 된다. Apps Script API는 이미 켜져 있다):

1. **스크립트 ID 복사**: "레슨 수첩 API" 편집기 → ⚙️ 프로젝트 설정 → **스크립트 ID** 복사.
2. **Cloud Shell에서 한 줄 실행**: [Google Cloud Shell](https://shell.cloud.google.com)을 소유 계정으로 열고 다음 한 줄을 붙여 넣는다.

   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/Hoyasiro/Claude_lessen_recorder/HEAD/scripts/setup-deploy.sh)
   ```

   - "스크립트 ID:"에 1에서 복사한 값을 붙여 넣는다.
   - 나오는 주소를 열어 소유 계정으로 **허용**한다. 허용 후 `http://localhost…`의 "사이트에 연결할 수 없음"이 뜨면 정상이다. 그 **주소창 전체 주소**를 복사해 Cloud Shell에 붙여 넣는다.
   - 웹 앱 배포가 여러 개면 지금 레슨 수첩 앱이 쓰는 배포 번호를 고른다(하나면 자동).
   - "LESSON_DEPLOY 시작"과 "끝" 사이의 **값 전체**를 복사한다. 줄바꿈이 섞이거나 시작·끝 표시 줄까지 복사해도 괜찮다. 복사가 어려우면 같은 값이 `~/lesson_deploy.txt`에 저장되니 Cloud Shell 메뉴 ⋮ → 다운로드로 받고, 끝나면 `rm ~/lesson_deploy.txt`로 지운다.
3. **GitHub Secret 추가**: [새 저장소 Secret](https://github.com/Hoyasiro/Claude_lessen_recorder/settings/secrets/actions/new)에서 Name `LESSON_DEPLOY`, Secret에 2의 값을 넣고 **Add secret**. 바꿀 때는 Secret 목록에서 `LESSON_DEPLOY` 옆 연필(Update).
4. **첫 점검은 Claude가 한다**: Actions → Deploy Apps Script → Run workflow(기본 브랜치, `check_only` 체크된 기본값)로 **점검만** 돌려 파일 목록과 매니페스트 비교 결과를 확인한다. 문제가 없으면 그다음 병합부터 자동으로 올라간다(바로 올리려면 `check_only`를 끄고 실행).

설정 도우미(`scripts/setup-deploy.sh`)는 고정 버전 clasp(`@google/clasp@3.4.1`)를 임시 폴더에 받아 `login --no-localhost`로 로그인하고, 배포 목록을 확인한 뒤 `{"clasprc": …, "scriptId": "…", "deploymentId": "…"}`를 base64 한 덩어리로 출력한다(`~/lesson_deploy.txt`, 권한 600에도 저장). 로그인 정보는 임시 폴더에만 두고 끝나면 지운다.

보안: `LESSON_DEPLOY`에는 소유 계정으로 Apps Script·Drive·시트에 넓게 접근할 수 있는 **갱신 토큰**이 들어 있다. 채팅·메모·저장소·이슈에 붙여 넣지 말고 GitHub Secret에만 넣는다. 워크플로는 값을 러너 임시 폴더에만 풀고 끝나면 지우며, 값의 조각을 로그에서 가린다. 자동 배포를 끊으려면 [Google 계정의 서드파티 앱 접근](https://myaccount.google.com/permissions)에서 clasp 접근을 삭제하고 Secret `LESSON_DEPLOY`를 지운다.

문제 해결 (Actions 실행 로그와 요약):

- **"설정 필요"**: Secret 이름이 `LESSON_DEPLOY`인지 확인한다.
- **"LESSON_DEPLOY를 풀지 못했습니다"**: 값이 잘렸다. 2·3단계를 다시 한다(값 자체는 로그에 나오지 않고 길이 등 진단만 나온다).
- **`invalid_grant`, 401, unauthorized**: 로그인이 만료되었거나 접근이 철회되었다. 2·3단계를 다시 한다.
- **"버전 배포가 N개라 …"**: 2단계를 다시 하면 배포를 고르게 해 ID를 넣어 준다.
- **"중단 (올리지 않음)"**: 요약의 "현재 프로젝트 파일"과 "매니페스트 비교"를 보고 위 점검 항목을 맞춘 뒤 다시 실행한다.

## 개발

| 명령 | 내용 |
|---|---|
| `node tools/build_gas.js` | `apps-script/*.js` → `dist/LessonApi.gs`(API 경량판), `dist/LessonApp.gs`(이관 함수 포함 전체) |
| `node tools/build_pwa.js` | `web/lesson-app.html` → `docs/index.html`. 화면을 바꾸면 `docs/sw.js`의 `SHELL` 버전도 올린다 |
| `node tools/build_demo.js <snapshot.json> <out.html>` | 시트 없이 도는 로컬 데모 (실제 데이터가 들어가니 커밋 금지) |
| `node --test scripts/*.test.js` | 자동 배포 스크립트 테스트(가짜 clasp). CI는 이것과 빌드 결과 일치, `shellcheck scripts/*.sh`를 확인한다 |
| `node tools/gas_mock.js <snapshot.json> [port]` | Apps Script 코드를 메모리 시트로 돌리는 모의 API. `BLOCK_POST=1` / `BLOCK_GET=1`로 브라우저가 요청을 막는 상황, `BLOCK_POST_WRITES=1`로 저장 응답만 막히는 상황(중복 저장 재현)을 흉내 낸다 |

`apps-script/Normalize.js`의 이관 변환 로직은 Apps Script와 Node에서 같이 쓴다. 이관(`migrateLegacyLessons`)은 2026-10-08에 한 번 실행했다.

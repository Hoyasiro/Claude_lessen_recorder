# Claude Lesson Recorder

준희 키_v2 › `레슨기록` 탭(프로그램별 가로형 날짜 목록)을 정형화한 레슨 DB를 관리한다.

- DB: 구글 드라이브 `레슨기록_DB` (원본과 같은 폴더)
- 원본 시트는 읽기만 하고 수정하지 않는다.

## DB 구조

| 탭 | 내용 |
|---|---|
| `lessons` | 레슨 1건 = 1행. 요일·대상·상태(C·F·J열)는 헤더의 배열 수식으로 자동 계산. L열 `진행`은 완료/예정/취소 |
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
- 시트에 직접 입력할 때는 lessons 탭 마지막 행 아래에 A·B·D·E·G~I·K·L 열을 쓴다 (C·F·J 열은 수식이라 비워 둔다).
- 알림: 매일 오전 9시쯤(±15분) 오늘·내일·7일 뒤의 예정 레슨을 한 번에 알린다. 알릴 레슨이 없으면 보내지 않는다.

### 설치형 앱 처음 설정 (한 번만)

1. **GitHub Pages 켜기**: 저장소 Settings → Pages → Source "Deploy from a branch" → 브랜치 `ccr-86cf1ca5-ng9k2d`, 폴더 `/docs` → Save.
2. **Apps Script 만들기** (레슨기록_DB 소유 계정으로 로그인):
   - https://script.google.com → 새 프로젝트 → 이름 "레슨 수첩 API"
   - `Code.gs` 내용을 지우고 `apps-script/dist/LessonApi.gs` 전체를 붙여 넣기 (API·알림 전용 경량판. 이관 함수까지 필요하면 `LessonApp.gs`)
   - (선택) 프로젝트 설정(톱니) → "appsscript.json 매니페스트 파일 표시" → `apps-script/appsscript.json` 내용으로 바꾸기. 안 해도 배포 화면에서 정한 값으로 동작한다
   - 배포 → 새 배포 → 유형 "웹 앱", 실행: 나, 액세스: 모든 사용자 → 배포 → 권한 허용
3. 편집기에서 함수 `setup` 선택 → 실행 → 실행 로그의 **연결 링크**를 복사
4. 휴대폰 브라우저에서 연결 링크 열기 → 설치
   - 삼성 인터넷: 주소창의 설치 아이콘(↓) → 설치, 또는 메뉴(≡) → "현재 페이지 추가" → "홈 화면" (비밀 모드 X)
   - 크롬: 메뉴(⋮) → "홈 화면에 추가" → 설치
5. 설치한 레슨 수첩 → 설정(톱니) → 휴대폰 알림 → **알림 켜기** → **테스트 알림**으로 확인

연결 링크에는 비밀 토큰이 들어 있으니 공유하지 않는다. 유출이 의심되면 편집기에서 `resetToken` 실행 후 새 링크로 다시 연결.
코드를 고친 뒤에는 `node tools/build_gas.js` / `node tools/build_pwa.js` 로 다시 만든다. Apps Script는 붙여 넣은 뒤 배포 → 배포 관리 → 새 버전.

## 개발

| 명령 | 내용 |
|---|---|
| `node tools/build_gas.js` | `apps-script/*.js` → `dist/LessonApi.gs`(API 경량판), `dist/LessonApp.gs`(이관 함수 포함 전체) |
| `node tools/build_pwa.js` | `web/lesson-app.html` → `docs/index.html`. 화면을 바꾸면 `docs/sw.js`의 `SHELL` 버전도 올린다 |
| `node tools/build_demo.js <snapshot.json> <out.html>` | 시트 없이 도는 로컬 데모 (실제 데이터가 들어가니 커밋 금지) |
| `node tools/gas_mock.js <snapshot.json> [port]` | Apps Script 코드를 메모리 시트로 돌리는 모의 API. `BLOCK_POST=1` / `BLOCK_GET=1`로 브라우저가 요청을 막는 상황을 흉내 낸다 |

`apps-script/Normalize.js`의 이관 변환 로직은 Apps Script와 Node에서 같이 쓴다. 이관(`migrateLegacyLessons`)은 2026-10-08에 한 번 실행했다.

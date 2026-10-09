# Claude Lesson Recorder

준희 키_v2 › `레슨기록` 탭(프로그램별 가로형 날짜 목록)을 정형화한 레슨 DB를 관리한다.

- DB: 구글 드라이브 `레슨기록_DB` (원본과 같은 폴더)
- 원본 시트는 읽기만 하고 수정하지 않는다.

## DB 구조

| 탭 | 내용 |
|---|---|
| `lessons` | 레슨 1건 = 1행. 요일·대상·상태는 헤더의 배열 수식으로 자동 계산 |
| `programs` | 프로그램 목록. **대상·상태는 직접 입력**(노란 칸). 상태를 바꾸면 lessons의 해당 레슨 전체에 반영. 첫/마지막 레슨·레슨 수·결제 횟수는 수식 |
| `migration_issues` | 이관 시 보정/제외 내역 |

원본의 `+` 표시는 `결제` 체크박스로 옮겼다.

## 레슨 수첩 앱

- 주소: https://claude.ai/artifact/K7AqxrWKAsnAmxTbpcYz8z (비공개, Claude 앱/claude.ai에서 열기)
- 소스: `web/lesson-app.html` — Google Sheets 커넥터로 `레슨기록_DB`를 직접 읽고 쓴다.
- 앱 설정(결제 주기·레슨 주기·색·짧은 이름)은 페이지 DB의 `config/app` 문서(JSON)에 저장한다.
- lessons 탭 L열 `진행`(완료/예정/취소). 레슨 시간은 저장하지 않고 레슨 주기에서 계산한다.
- 로컬 데모: `node tools/build_demo.js <snapshot.json> <out.html>` (시트에 쓰지 않음, 결과물은 커밋 금지)

## 레슨 추가

1. **Claude에게 요청**: "10/14 준희 엘리트 레슨 추가, 결제함" 처럼 말하면 lessons 탭에 행을 추가한다.
2. **Apps Script**: `apps-script/` 파일을 script.google.com 프로젝트에 붙여 넣고 실행.
   - `addLesson('2026-10-14', 'P08', {payment: true, note: ''})`
   - `addProgram('야구(새 과정)', '준희', '코치명')`
3. **직접 입력**: lessons 탭 마지막 행 아래에 A·B·D·E·G~I·K 열을 입력 (C·F·J 열은 수식이라 비워 둔다).

## 개발

```
# 원본 스냅샷(2차원 배열 JSON)으로 미리보기 HTML 생성. 드라이브에는 쓰지 않음
node tools/preview.js <snapshot.json> <out.html> [YYYY-MM-DD]
```

`apps-script/Normalize.js`의 변환 로직은 Apps Script와 Node에서 같이 쓴다.

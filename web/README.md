# 백홈 엔진(web)

골프 QR 네임태그의 연락 엔진입니다. 습득자는 웹 화면(`/Q/<토큰>`)에서 메시지를 남기고, 주인은 알림톡 링크로 답장합니다.

## 처음 실행
```bash
npm install
cp .env.example .env.local   # APP_SECRET에 32자 이상 무작위 값을 넣는다
npm run dev                   # http://localhost:3000
```
개발 모드에서는 알림톡·문자를 실제로 보내지 않고 서버 로그에 남깁니다. `.env.local`에 `EXPOSE_DEV_OTP=1`을 두면 인증번호가 화면에 "개발 모드 인증번호"로 표시됩니다(개발 모드 + localhost 접속일 때만). DB는 `web/.data/pglite`(내장 Postgres)에 저장됩니다.

## 태그 발급 → 인쇄
```bash
# 개발 서버를 끈 뒤 실행(내장 DB는 한 프로세스만 열 수 있음)
npx tsx scripts/issue-batch.ts --sku golf-tag --per-set 1 --names names.csv --out ../design/golf-tag/batches/batch.csv
../.venv/bin/python ../design/golf-tag/build_tag.py --csv ../design/golf-tag/batches/batch.csv --out ../design/golf-tag/batches/out
```
`names.csv`는 `name,club` 헤더를 씁니다. 출력 CSV에는 등록 코드 평문이 들어 있으니 인쇄 뒤 안전하게 보관합니다.

## 월별 발송 집계
```bash
# 개발 서버를 끈 뒤 실행. 단가는 원/건(VAT 별도), 기본값은 알림톡 13원·문자 18원
npx tsx scripts/usage-report.ts --month 2026-09 --alimtalk 6.5 --sms 8.4
```
습득자 메시지 수, 알림을 보낸 메시지와 한도에 걸린 메시지, 채널별 발송·실패 건수, 인증번호 수, 태그당 최대 알림 수, 예상 비용을 JSON으로 출력합니다.

## 주요 경로
| 경로 | 용도 |
|---|---|
| `/` | 첫 화면(태그 코드 입력, 등록 안내) |
| `/Q/<토큰>` | 습득자 화면(4개 언어). `/q/[token]` 페이지로 rewrite |
| `/start` | 주인 등록(휴대폰 인증 → 등록 코드 → 이름) |
| `/my` | 내 태그·연락처·방해금지·최근 연락 |
| `/r/<대화ID>?e&s` | 알림톡 답장 링크(15분). 지나면 로그인 세션으로 이어서 답장 |
| `/m/<코드>` | 대체 문자에 넣는 짧은 주소. 답장 링크로 넘긴다(단문 90바이트 유지) |
| `/api/v1/*` | JSON API. 오류는 `{ error: { code, message } }` |
| `/api/v1/cron/dispatch` | 미룬 알림 발송·보관기간 정리. `Authorization: Bearer $CRON_SECRET` |

## 검증
```bash
npx next typegen && npx tsc --noEmit
npm run lint
npx vitest run --coverage
npm run build
```
동시 요청 경쟁(메시지 한도·인증번호 시도·첫 로그인)은 실제 Postgres에서만 재현됩니다. 내장 DB(PGlite)는 연결이 하나라 트랜잭션이 줄을 섭니다. 빈 테스트용 DB를 가리키고 따로 돌립니다(데이터를 지우지 않음):
```bash
TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/baghome_test npx vitest run tests/postgres.test.ts
```

## 보안 설정
- **CSP**: `src/proxy.ts`가 페이지 요청마다 nonce를 만들고, 루트 레이아웃의 `connection()`으로 모든 페이지를 요청 시점에 렌더링합니다. 운영 CSP는 nonce 전용이라 인라인 `style={…}` 속성을 쓰면 막힙니다(테스트가 소스에서 막음). 개발에서만 Next.js 개발 도구 때문에 인라인 스타일을 허용합니다.
- **호출자 IP**: 속도 제한은 `X-Forwarded-For`의 오른쪽에서 `TRUSTED_PROXY_HOPS`(기본 1)번째 값을 씁니다. 앞단 프록시 수와 맞춰야 합니다. Vercel에서는 플랫폼 헤더(`x-vercel-forwarded-for`)를 씁니다.
- **요청 본문**: API 본문은 16KB까지 받습니다(넘으면 413).
- **알림 비용 가드레일**: 넘는 습득자 메시지는 알림 없이 저장하고, 습득자 화면에는 "메시지를 남겼어요", 주인 `/my`에는 30일 사용량과 저장만 된 메시지 수를 보여 줍니다. 한도는 주인 응답률이 아닌 고정 숫자라 특허 금지 항목(docs/01 §8)과 무관합니다.
  - 태그당 최근 24시간 5개 대화(`NOTIFY_PER_TAG_DAILY`), 대화 하나당 3건(`NOTIFY_PER_THREAD`), 주인당 최근 30일 30건(`NOTIFY_PER_OWNER_MONTHLY`, 주인이 차단한 대화는 빼고 셈)
  - 같은 IP에서 한 태그로 여는 새 대화는 하루 2개(쿠키를 지워 가며 태그 한도를 소진하는 도배 방지)
  - 대체 문자는 짧은 주소(`/m/<코드>`)로 단문 90바이트 요금에 맞춤
  - 인증번호: IP당 1시간 30건·하루 100건(동호회 공용 와이파이 단체 등록 고려), 번호당 1시간 5건, 연락처 추가는 주인당 하루 5건. 처음 보는 번호로는 서비스 전체 하루 `OTP_DAILY_CAP`건까지(가입한 번호는 막지 않음)
- **배포 전제**: IP 기준 한도는 Vercel이거나, `X-Forwarded-For`를 덧붙이는 프록시 뒤에서 `TRUSTED_PROXY_HOPS`를 맞췄을 때만 믿을 수 있습니다. 프록시 없이 앱을 바로 열면 헤더 위조로 IP 한도를 피할 수 있습니다(번호·태그·주인 단위 한도는 그대로 동작).
- **운영 시작 조건**: `NODE_ENV=production`에서 `NOTIFIER=console`이면 서버가 시작하지 않습니다. 메모리 속도 제한기는 인스턴스마다 따로 세므로, 인스턴스가 하나일 때만 `ALLOW_MEMORY_RATE_LIMIT=1`로 명시합니다.

## 운영 전 남은 일
- 알림톡 딜러사 어댑터 구현(`src/server/notifier.ts`의 `@AX:TODO`). 이게 없으면 운영 모드가 시작을 거부합니다
- 다중 인스턴스용 Redis 속도 제한(`RateLimiter` 구현 교체)
- 크론 등록: `/api/v1/cron/dispatch`를 1~5분마다 호출(미룬 알림·재시도·멈춘 발송 정리)
- 개인정보처리방침·약관 확정, 변리사 FTO

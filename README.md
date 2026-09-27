# bagh — 골프 QR 네임태그 연락 엔진

골프백 네임태그의 QR을 스캔한 사람이 웹에서 메시지를 남기면, 주인에게 카카오 알림톡으로 알리고 주인은 링크로 답장합니다. 앱 설치가 필요 없고, 서로의 전화번호는 공개되지 않습니다.

## 구성
- `web/`: 연락 엔진(Next.js 16 App Router, Drizzle ORM, PGlite/Postgres). 실행·검증 방법은 [web/README.md](web/README.md)
- `design/golf-tag/`: 54×86mm 인서트 카드 가변 인쇄 생성기(앞면 QR, 뒷면 등록 코드). `pip install segno`와 Google Chrome이 필요합니다

## 빠른 시작
```bash
cd web
npm install
cp .env.example .env.local   # APP_SECRET에 32자 이상 무작위 값을 넣는다
npm run dev                   # http://localhost:3000
```

## 상태
MVP입니다. 알림톡 발송 어댑터가 아직 없어(개발용 콘솔 발송기만 있음) 운영 모드는 시작하지 않습니다.
설계·사업 문서는 이 저장소에 넣지 않았습니다. 코드 주석의 `docs/` 경로는 비공개 문서를 가리킵니다.

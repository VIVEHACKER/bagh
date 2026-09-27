#!/usr/bin/env python3
"""백홈(가칭) 골프 네임택 인서트 카드 시안·가변 인쇄 파일 생성기.

입력  : samples.csv (name, club, token, claim_code). 파일이 없으면 샘플 9행을 만들어 저장한다.
출력  : out/proof.html·pdf        앞뒷면 실제 크기 교정본(인쇄소 견적용)
        out/sheet-front.html·pdf  가변 데이터 9장 배치(앞면)
        out/sheet-back.html·pdf   같은 9장의 뒷면(긴 변 양면 인쇄용 좌우 반전 배치)
        out/*.png                 미리보기
실패  : 잘못된 토큰·코드 형식이나 QR 버전 초과는 ValueError로 즉시 중단한다.
의존성: pip install segno, Google Chrome(헤드리스 PDF 출력)
"""
from __future__ import annotations

import csv
import html
import io
import re
import secrets
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import segno

# 0·1·I·O는 뺀다. 습득자가 코드를 손으로 입력할 때 헷갈리지 않게 하려는 것.
ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
TOKEN_LEN = 10
CLAIM_LEN = 8
# 대문자·짧은 도메인이라 QR 영숫자 모드로 들어가고, 오류정정 Q에서도 버전 2(25x25)에 맞는다.
QR_BASE = "HTTPS://BGHM.KR/Q/"
QR_EXPECTED_VERSION = 2
BRAND_EN, BRAND_KO = "BAGHOME", "백홈"
SITE = "baghome.kr"
SHORT_SITE = "bghm.kr"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
SAMPLES = HERE / "samples.csv"

SAMPLE_OWNERS = [
    ("김민준", "한강 골프회"), ("이서연", "수요 라운드"), ("박지훈", "OO전자 골프동호회"),
    ("최유진", "주말 필드"), ("정우성", "한강 골프회"), ("강하늘", ""),
    ("윤채원", "여우회"), ("임도현", "새벽 티업"), ("한지우", "OO대학교 동문회"),
]


@dataclass(frozen=True)
class Tag:
    name: str
    club: str
    token: str
    claim_code: str

    @property
    def url(self) -> str:
        return f"{QR_BASE}{self.token}"


def random_code(length: int) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def group(code: str) -> str:
    """사람이 읽기 쉽게 4자씩 끊는다: 7K3M9X2P4Q -> 7K3M-9X2P-4Q."""
    return "-".join(code[i:i + 4] for i in range(0, len(code), 4))


def validate(tag: Tag) -> Tag:
    pattern = f"^[{ALPHABET}]+$"
    if len(tag.token) != TOKEN_LEN or not re.match(pattern, tag.token):
        raise ValueError(f"token 형식 오류: {tag.token!r} (길이 {TOKEN_LEN}, 허용 문자 {ALPHABET})")
    if len(tag.claim_code) != CLAIM_LEN or not re.match(pattern, tag.claim_code):
        raise ValueError(f"claim_code 형식 오류: {tag.claim_code!r}")
    return tag


def load_or_create_samples() -> list[Tag]:
    if not SAMPLES.exists():
        with SAMPLES.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["name", "club", "token", "claim_code"])
            for name, club in SAMPLE_OWNERS:
                w.writerow([name, club, random_code(TOKEN_LEN), random_code(CLAIM_LEN)])
    with SAMPLES.open(encoding="utf-8") as f:
        return [validate(Tag(r["name"], r["club"], r["token"], r["claim_code"])) for r in csv.DictReader(f)]


def qr_svg(url: str) -> str:
    qr = segno.make_qr(url, error="q", boost_error=False)
    if qr.version != QR_EXPECTED_VERSION:
        raise ValueError(f"QR 버전 {qr.version} (기대 {QR_EXPECTED_VERSION}): URL이 길다 → {url}")
    buf = io.BytesIO()
    # 여백(quiet zone)은 흰 패널이 대신하므로 border=0, 크기는 CSS(mm)로 정한다.
    qr.save(buf, kind="svg", border=0, xmldecl=False, omitsize=True, nl=False, dark="#000000")
    return buf.getvalue().decode("utf-8")


FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700'
    '&family=Noto+Sans+KR:wght@400;500;700&family=IBM+Plex+Mono:wght@500&display=block" rel="stylesheet">'
)

CARD_CSS = """
:root{--surface:#0b1326;--on:#dde2fd;--muted:#9aa4c7;--primary:#2665fd;--ink:#0b1326;--ink-soft:#4a5578;--line:#c9cfe6}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter','Noto Sans KR',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff}
.card{width:54mm;height:86mm;border-radius:3mm;padding:4.5mm;position:relative;overflow:hidden}
.front{background:var(--surface);color:var(--on)}
.brand{display:flex;align-items:baseline;gap:1.4mm}
.brand .en{font-weight:700;font-size:6.2pt;letter-spacing:.24em}
.brand .ko{font-weight:500;font-size:6pt;color:var(--muted)}
.brand .kind{margin-left:auto;font-weight:600;font-size:5pt;letter-spacing:.28em;color:var(--muted)}
.owner{margin-top:5mm;min-height:13mm}
.owner .name{font-weight:700;font-size:15pt;letter-spacing:.02em;line-height:1.15}
.owner .write{height:9mm;border-bottom:.3mm solid var(--muted);width:38mm;position:relative}
.owner .write span{position:absolute;left:0;bottom:1mm;font-size:5pt;letter-spacing:.24em;color:var(--muted)}
.owner .club{margin-top:1.2mm;font-size:6.8pt;color:var(--muted);line-height:1.3}
.panel{position:absolute;left:4.5mm;right:4.5mm;bottom:4.5mm;background:#fff;color:var(--ink);border-radius:2mm;padding:3.6mm 3mm 3mm;text-align:center}
.panel .qr{width:24mm;height:24mm;margin:0 auto}
.panel .qr svg{width:100%;height:100%;display:block}
.panel .ask{margin-top:2.6mm;font-weight:700;font-size:8.2pt;color:var(--primary);letter-spacing:.01em}
.panel .how{margin-top:1mm;font-size:6.1pt;line-height:1.45;color:var(--ink)}
.panel .en{margin-top:1.1mm;font-size:5.2pt;color:var(--ink-soft);line-height:1.3}
.panel .code{margin-top:1.6mm;padding-top:1.4mm;border-top:.2mm solid var(--line);font-family:'IBM Plex Mono',monospace;font-size:5.8pt;color:var(--ink);letter-spacing:.04em}
.back{background:#fff;color:var(--ink);border:.25mm solid var(--line)}
.back .brand .en{color:var(--ink)}
.back .brand .ko,.back .brand .kind{color:var(--ink-soft)}
.back h2{margin-top:6mm;font-size:9.5pt;font-weight:700;line-height:1.3}
.back ol{margin-top:2.6mm;padding-left:4mm;font-size:6.6pt;line-height:1.7}
.back ol b{font-weight:700}
.claim{margin-top:4mm;border:.3mm solid var(--ink);border-radius:2mm;padding:2.4mm 2.6mm}
.claim .label{display:block;font-size:5.4pt;font-weight:600;letter-spacing:.2em;color:var(--ink-soft)}
.claim .val{display:block;margin-top:1mm;font-family:'IBM Plex Mono',monospace;font-size:12pt;letter-spacing:.08em}
.back .note{margin-top:3mm;font-size:5.9pt;line-height:1.55;color:var(--ink)}
.back .fine{position:absolute;left:4.5mm;right:4.5mm;bottom:4.5mm;font-size:5.2pt;line-height:1.5;color:var(--ink-soft)}
.back .fine .id{font-family:'IBM Plex Mono',monospace}
"""


def front_html(t: Tag) -> str:
    club = f'<div class="club">{html.escape(t.club)}</div>' if t.club else ""
    name = (
        f'<div class="name">{html.escape(t.name)}</div>'
        if t.name.strip()
        else '<div class="write"><span>NAME</span></div>'
    )
    return (
        '<div class="card front">'
        f'<div class="brand"><span class="en">{BRAND_EN}</span><span class="ko">{BRAND_KO}</span><span class="kind">GOLF</span></div>'
        f'<div class="owner">{name}{club}</div>'
        '<div class="panel">'
        f'<div class="qr">{qr_svg(t.url)}</div>'
        '<p class="ask">주우셨나요?</p>'
        '<p class="how">스캔하면 주인에게 알림이 가요<br>번호는 공개되지 않아요</p>'
        '<p class="en">Found this bag? Scan to notify the owner.</p>'
        f'<p class="code">{SHORT_SITE} · {group(t.token)}</p>'
        '</div></div>'
    )


def back_html(t: Tag) -> str:
    return (
        '<div class="card back">'
        f'<div class="brand"><span class="en">{BRAND_EN}</span><span class="ko">{BRAND_KO}</span><span class="kind">GOLF</span></div>'
        '<h2>처음 한 번만<br>등록해 주세요</h2>'
        f'<ol><li><b>{SITE}/start</b> 접속</li><li>휴대폰 번호 인증</li><li>아래 등록 코드 입력</li></ol>'
        f'<div class="claim"><span class="label">등록 코드</span><span class="val">{group(t.claim_code)}</span></div>'
        '<p class="note">등록 전에는 알림이 가지 않아요.<br>등록을 마친 뒤 이 카드를 태그에 넣어 주세요.</p>'
        f'<p class="fine">QR 알림 서비스 최소 3년 무료<br>문의 {SITE}/help · <span class="id">TAG {group(t.token)}</span></p>'
        '</div>'
    )


def page(title: str, body: str, extra_css: str = "") -> str:
    return (
        f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>{html.escape(title)}</title>{FONTS}'
        f'<style>@page{{size:A4;margin:0}}{CARD_CSS}{extra_css}</style></head><body>{body}</body></html>'
    )


PROOF_CSS = """
.sheet{width:210mm;min-height:297mm;padding:14mm 16mm;color:#0b1326}
.sheet h1{font-size:13pt;font-weight:700}
.sheet .sub{margin-top:1.5mm;font-size:8pt;color:#4a5578}
.pair{display:flex;gap:18mm;margin-top:12mm;padding-left:8mm}
.slot{position:relative}
.frame{position:relative;width:54mm;height:86mm}
.slot .cap{margin-top:3mm;font-size:7.5pt;color:#4a5578}
.dim-w{position:absolute;top:-5mm;left:0;width:54mm;text-align:center;font-size:7pt;color:#4a5578;border-top:.2mm solid #9aa4c7;padding-top:.5mm}
.dim-h{position:absolute;top:0;left:-7mm;height:86mm;writing-mode:vertical-rl;transform:rotate(180deg);text-align:center;font-size:7pt;color:#4a5578;border-right:.2mm solid #9aa4c7}
.bleed{position:absolute;inset:-2mm;border:.2mm dashed #ffb4ab;border-radius:4mm;pointer-events:none}
.safe{position:absolute;inset:3mm;border:.2mm dashed #2665fd;border-radius:1.5mm;pointer-events:none;opacity:.55}
table.spec{margin-top:12mm;border-collapse:collapse;width:100%;font-size:7.6pt}
table.spec th,table.spec td{border:.2mm solid #c9cfe6;padding:1.6mm 2.2mm;text-align:left;vertical-align:top}
table.spec th{width:34mm;background:#f3f5fc;font-weight:600}
.legend{margin-top:4mm;font-size:7pt;color:#4a5578;line-height:1.6}
"""

SHEET_CSS = """
.grid{width:210mm;height:297mm;padding:10mm 16mm;display:grid;grid-template-columns:repeat(3,54mm);grid-auto-rows:86mm;column-gap:8mm;row-gap:5mm;align-content:start}
.grid .card{outline:.15mm solid #c9cfe6;outline-offset:1mm}
"""


def build_proof(t: Tag) -> str:
    spec_rows = [
        ("제품", "골프백 네임택 인서트 카드(PU 가죽 태그의 투명 창에 끼움). 프리미엄 버전은 같은 도안을 아크릴 일체형(3mm)에 UV 인쇄"),
        ("완성 크기", "54 × 86 mm(신용카드 규격 세로형), 모서리 R3. 재단 여유 2mm(빨간 점선), 안전 영역 3mm(파란 점선)"),
        ("재질", "PVC 0.76mm 또는 PP 합성지(방수). 표면 무광 라미네이팅 권장(스크래치·물)"),
        ("인쇄", "양면 4도. 앞면: 짙은 남색 바탕 + 흰 QR 패널. 뒷면: 흰 바탕"),
        ("가변 데이터", "카드마다 이름·클럽명·QR·태그번호(앞면)와 등록 코드(뒷면)가 모두 다름. CSV와 인쇄용 PDF 제공. 앞뒤 짝이 맞아야 함"),
        ("QR 규격", "버전 2(25×25), 오류정정 Q, 24mm(모듈 약 0.96mm), 흰 여백 4모듈 이상. 샘플 QR은 미등록 도메인(bghm.kr)이라 지금은 열리지 않음"),
        ("색상", "남색 #0b1326, 강조 파랑 #2665fd, QR 검정 #000000. 인쇄소 권장 CMYK로 변환 후 교정 요청"),
    ]
    rows = "".join(f"<tr><th>{html.escape(k)}</th><td>{html.escape(v)}</td></tr>" for k, v in spec_rows)
    body = (
        '<div class="sheet">'
        f'<h1>{BRAND_KO}(가칭) 골프 네임택 인서트 카드 시안 v0.1</h1>'
        '<p class="sub">2026-09-24 · 실제 크기(100%) 교정본 · 앞면과 뒷면</p>'
        '<div class="pair">'
        f'<div class="slot"><div class="frame"><div class="dim-w">54 mm</div><div class="dim-h">86 mm</div>{front_html(t)}<div class="bleed"></div><div class="safe"></div></div><p class="cap">앞면(태그 창으로 보이는 면)</p></div>'
        f'<div class="slot"><div class="frame">{back_html(t)}<div class="bleed"></div><div class="safe"></div></div><p class="cap">뒷면(태그 안쪽, 등록 코드)</p></div>'
        '</div>'
        f'<table class="spec">{rows}</table>'
        '<p class="legend">빨간 점선: 재단 여유(2mm) · 파란 점선: 글자·QR 안전 영역(3mm) · 점선은 인쇄하지 않음</p>'
        '</div>'
    )
    return page("시안 교정본", body, PROOF_CSS)


def build_sheet(tags: list[Tag], side: str) -> str:
    cards = [front_html(t) if side == "front" else back_html(t) for t in tags]
    if side == "back":
        # 긴 변 넘김 양면 인쇄에서 앞뒤 짝이 맞도록 줄마다 좌우를 뒤집는다.
        cards = [c for i in range(0, len(cards), 3) for c in reversed(cards[i:i + 3])]
    return page(f"가변 인쇄 {side}", f'<div class="grid">{"".join(cards)}</div>', SHEET_CSS)


def render(html_path: Path) -> None:
    pdf = html_path.with_suffix(".pdf")
    png = html_path.with_suffix(".png")
    common = [CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=8000"]
    subprocess.run(common + [f"--print-to-pdf={pdf}", html_path.as_uri()], check=True, capture_output=True, timeout=120)
    subprocess.run(common + ["--hide-scrollbars", "--force-device-scale-factor=3", "--window-size=794,1123",
                             f"--screenshot={png}", html_path.as_uri()], check=True, capture_output=True, timeout=120)


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="골프 네임택 인서트 카드 시안·가변 인쇄 파일 생성")
    parser.add_argument("--csv", type=Path, help="name,club,token,claim_code CSV (기본: samples.csv)")
    parser.add_argument("--out", type=Path, help="출력 폴더 (기본: out/)")
    args = parser.parse_args()
    global SAMPLES, OUT
    if args.csv:
        SAMPLES = args.csv.resolve()
    if args.out:
        OUT = args.out.resolve()
    tags = load_or_create_samples()
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "proof.html": build_proof(tags[0]),
        "sheet-front.html": build_sheet(tags[:9], "front"),
        "sheet-back.html": build_sheet(tags[:9], "back"),
    }
    for name, content in files.items():
        path = OUT / name
        path.write_text(content, encoding="utf-8")
        render(path)
        print(f"ok {path} (+pdf, png)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

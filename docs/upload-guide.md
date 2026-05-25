# 믹스 담당자 업로드 가이드

## 매주 업로드 순서

### 1. Logic Pro X에서 Stem Export

`File → Export → All Tracks as Audio Files...`

| 설정 항목 | 값 |
|---|---|
| Save Format | AIFF |
| Bit Depth | 16 Bit |
| Where | Desktop (찾기 쉽도록) |
| Bypass Effect Plug-ins | ❌ 체크 해제 (실제 사운드 그대로) |
| Include Audio Tail | ✅ 체크 |
| Include Volume/Pan Automation | ✅ 체크 |
| Normalize | Overload Protection Only |

> **핵심:** 모든 트랙이 동일한 시작점 · 동일한 길이로 export되어야 웹에서 싱크가 맞습니다.

---

### 2. MP3 변환 (XLD 사용)

1. XLD 설치: https://tmkk.undo.jp/xld/
2. 환경설정:
   - Output format: **MP3 (LAME)**
   - Encoding mode: **VBR**
   - Quality: **V2** (약 190kbps)
3. AIFF 폴더를 XLD에 드래그 → 같은 폴더에 MP3 자동 생성 (1~2분)

---

### 3. 파일 정리 및 songs.json 수정

```
audio/
└── song02/            ← 새 곡 번호 폴더 생성
    ├── vocal_lead.mp3
    ├── vocal_harm1.mp3
    ├── drums.mp3
    ├── bass.mp3
    ├── eg.mp3
    ├── ag.mp3
    ├── keys.mp3
    └── synth.mp3
```

`data/songs.json`에 항목 추가:

```json
{
  "id": "song02",
  "title": "곡 제목",
  "date": "2026-05-26",
  "duration": "4:50",
  "tracks": [
    { "name": "리드보컬", "file": "audio/song02/vocal_lead.mp3", "group": "vocal" },
    { "name": "화음 1",   "file": "audio/song02/vocal_harm1.mp3","group": "vocal" },
    ...
  ]
}
```

**group 값 목록:**
| 값 | 설명 |
|---|---|
| `vocal` | 보컬 (보컬 카테고리) |
| `drums` | 드럼 (리듬 카테고리) |
| `bass` | 베이스 (리듬 카테고리) |
| `rhythm` | 기타 리듬 악기 |
| `guitar` | 기타 (기타/건반 카테고리) |
| `keys` | 건반/피아노 |
| `synth` | 신디사이저 |

---

### 4. Git Push → 자동 배포

```bash
git add .
git commit -m "Add song: 곡제목 (2026-05-26)"
git push
```

Cloudflare Pages가 1~2분 내 자동 배포합니다.  
단원들은 새로고침만 하면 새 곡을 들을 수 있습니다.

---

## 로컬 테스트

```bash
# 프로젝트 폴더에서
python3 -m http.server 8000

# 또는
npx serve
```

브라우저에서 `http://localhost:8000` 접속.

> ⚠️ `file://` 프로토콜로 직접 열면 CORS 오류가 발생합니다. 반드시 로컬 서버를 사용하세요.

---

## 리버브 IR 파일

`audio/ir/church_hall.wav` 위치에 교회 홀 임펄스 응답 파일을 넣으면 리버브 기능이 활성화됩니다.

무료 IR 다운로드: https://openairlib.net

파일이 없어도 다른 기능은 정상 작동합니다.

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| iOS에서 재생이 안 됨 | AudioContext 정책 | 재생 버튼을 직접 탭하면 자동 해결 |
| 트랙끼리 싱크가 안 맞음 | Export 시작점 불일치 | Logic에서 모든 트랙을 같은 위치에서 export |
| 로딩이 너무 오래 걸림 | MP3 용량 과다 | XLD VBR V2 설정 확인 (약 190kbps) |
| 리버브가 동작 안 함 | IR 파일 없음 | audio/ir/church_hall.wav 파일 확인 |

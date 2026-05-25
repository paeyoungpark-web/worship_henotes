# 🎵 worship_Henotes — 찬양팀 실황 모니터

주일 예배 찬양 실황 멀티트랙을 단원이 웹에서 모니터링하는 도구입니다.

## 기능

- 📋 **곡 목록** — 날짜별 그룹핑, 트랙 수 표시
- 🎛 **멀티트랙 믹서** — 트랙별 볼륨 / 뮤트 / 리버브 슬라이더
- 🎤 **내 파트 강조** — 드롭다운으로 본인 세션 선택 → 강조 표시
- 🎚 **프리셋** — 전체 / 내 파트만 / 내 파트+풀밴드 / 내 파트+리듬 / 내 파트+키 / MR
- 🔁 **A-B 구간 루프** — 특정 구간만 반복 연습
- 📋 **믹스값 복사** — 현재 슬라이더 설정을 텍스트로 복사
- 💬 **피드백** — Google Forms 연동 또는 클립보드 복사
- 📱 **모바일 최적화** — 한 손 엄지 조작 가능

## 기술 스택

- Vanilla JavaScript + **Web Audio API** (프레임워크 없음)
- 정적 파일 기반 (`songs.json`)
- GitHub + **Cloudflare Pages** (자동 배포)
- 음원 저장: Git 리포 또는 Cloudflare R2

---

## 단원 사용법

1. 사이트 접속 → 들을 곡 선택
2. **"🎤 내 파트"** 드롭다운에서 본인 세션 선택
3. 프리셋 버튼 또는 개별 슬라이더로 믹스 조절하며 청취
4. **"💬 피드백 남기기"**로 의견 전달

---

## 믹스 담당자 업로드 가이드

➡️ 자세한 내용: [`docs/upload-guide.md`](docs/upload-guide.md)

### 빠른 요약

```bash
# 1. Logic에서 AIFF export → XLD로 MP3 변환
# 2. audio/songNN/ 폴더에 MP3 넣기
# 3. data/songs.json에 곡 정보 추가
# 4. git push → Cloudflare Pages 자동 배포
git add .
git commit -m "Add song: 곡제목 (날짜)"
git push
```

---

## 로컬 실행

```bash
# Python
python3 -m http.server 8000

# Node
npx serve
```

브라우저에서 `http://localhost:8000` 접속  
(⚠️ `file://` 직접 열기는 CORS 오류 발생)

---

## 폴더 구조

```
worship_Henotes/
├── index.html
├── css/style.css
├── js/
│   ├── app.js       ← 메인 컨트롤러
│   ├── mixer.js     ← Web Audio API 믹서 엔진
│   └── ui.js        ← UI 렌더링 헬퍼
├── data/songs.json  ← 곡 데이터 (여기에 추가)
├── audio/
│   ├── ir/church_hall.wav  ← 리버브 IR (선택사항)
│   ├── song01/
│   │   ├── vocal_lead.mp3
│   │   └── ...
│   └── song02/
└── docs/upload-guide.md
```

---

## Cloudflare Pages 배포

1. GitHub에 리포지토리 생성 후 push
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
3. 빌드 설정:
   - Framework preset: **None**
   - Build command: *(비워둠)*
   - Build output directory: `/`
4. Save and Deploy → `https://worship-henotes.pages.dev` 자동 발급

### 비공개 보호 (Cloudflare Access)

Cloudflare Zero Trust → Access → Applications → Add application  
이메일 OTP 또는 특정 이메일 도메인 정책으로 단원만 접근 허용 (50명 무료)

---

## 주의사항

- **iOS 사파리**: 첫 재생 버튼 탭 후 AudioContext 활성화 (자동 처리됨)
- **모바일 데이터**: 트랙 100~150MB — 와이파이 환경 권장
- **저작권**: 교회 내부 공유라도 CCLI 라이선스 범위 확인
- **Logic 프로젝트 파일**: `.logicx`는 Git에 올리지 말 것 (용량 큼)

# worship_Henotes — 아키텍처 문서

> 우리교회 찬양팀 실황 멀티트랙 모니터 시스템  
> 최종 업데이트: 2026-05-26

---

## 목차

1. [시스템 개요](#시스템-개요)
2. [기술 스택](#기술-스택)
3. [폴더 구조](#폴더-구조)
4. [오디오 그래프](#오디오-그래프)
5. [채널 매핑](#채널-매핑)
6. [데이터 구조](#데이터-구조)
7. [컴포넌트 설명](#컴포넌트-설명)
8. [시각화 시스템](#시각화-시스템)
9. [인프라](#인프라)
10. [업로드 가이드](#업로드-가이드)

---

## 시스템 개요

```
Logic Pro X (녹음)
    ↓ All Tracks as Audio Files (AIFF, 16bit)
XLD (MP3 변환, VBR V2)
    ↓
Cloudflare R2 (음원 저장, 무료 10GB)
    ↓
worship-henotes.pages.dev (Cloudflare Pages)
    ↓
브라우저 Web Audio API (멀티트랙 동기 재생)
    ↓
단원 모니터링 + 피드백
```

### 워크플로우

| 단계 | 시점 | 담당 |
|---|---|---|
| Logic 녹음 | 주일 예배 중 | 녹음 담당 |
| Stem export + MP3 변환 | 주일 오후/저녁 | 믹스 담당 |
| R2 업로드 + songs.json 수정 | 주일 저녁 | 믹스 담당 |
| git push → 자동 배포 | 즉시 (~2분) | 자동 |
| 단원 모니터링 + 피드백 | 월~화 | 전체 단원 |
| 2차 믹스 반영 | 수요일 | 믹스 담당 |
| 최종본 업로드 | 토요일 | 믹스 담당 |

---

## 기술 스택

| 항목 | 기술 | 이유 |
|---|---|---|
| 프론트엔드 | Vanilla JS + HTML/CSS | 프레임워크 없이 경량 |
| 오디오 엔진 | Web Audio API | Sample-accurate 싱크 |
| 3D 시각화 | Three.js (r128, CDN) | WebGL 3D 파형 |
| 음원 저장 | Cloudflare R2 | 10GB 무료, CDN 내장 |
| 배포 | Cloudflare Pages | git push → 자동 배포 |
| 버전관리 | GitHub | 코드 + 설정 파일만 |
| 데이터 | `data/songs.json` | 정적 파일, DB 불필요 |

---

## 폴더 구조

```
worship_Henotes/
├── index.html              # 싱글페이지 앱 (뷰 2개)
├── css/
│   └── style.css           # M32 스타일 다크 테마
├── js/
│   ├── mixer.js            # Web Audio API 믹서 엔진
│   ├── ui.js               # UI 렌더링 헬퍼
│   ├── visualizer.js       # 시각화 엔진 (스펙트럼/VU/Glow/3D/클로즈업)
│   └── app.js              # 메인 컨트롤러
├── data/
│   └── songs.json          # 곡 데이터 (R2 URL + 구간 정보)
├── audio/
│   ├── ir/
│   │   └── church_hall.wav # 리버브 임펄스 응답 (선택사항)
│   └── song01/             # 로컬 테스트용 (배포 시 R2 사용)
└── docs/
    ├── ARCHITECTURE.md     # 이 파일
    ├── CHANGELOG.md        # 변경 이력
    └── upload-guide.md     # 믹스 담당자 가이드
```

---

## 오디오 그래프

```
AudioContext
│
├── [각 트랙] BufferSource
│       ↓
│   GainNode (볼륨/뮤트)
│       ↓
│   StereoPannerNode (PAN)
│       ↓
│   AnalyserNode (미터/시각화)
│       ├──→ DryGainNode ─────────┐
│       └──→ WetGainNode          │
│                 ↓               │
│           ConvolverNode (리버브) │
│                 ↓               │
│           [reverb out] ─────────┤
│                                 ↓
└──────────────────────────── MasterGainNode
                                  ↓
                             MasterAnalyser (마스터 미터/파형)
                                  ↓
                            AudioDestination (스피커)
```

### Sample-accurate 싱크 원리

```javascript
// 모든 트랙에 동일한 미래 시각 지정
const targetStart = ctx.currentTime + 0.05; // 50ms 선스케줄
tracks.forEach(t => {
  src.start(targetStart, bufferOffset); // 동일한 target → 완벽한 싱크
});
```

---

## 채널 매핑

| CH | 이름 | 파일명 | 그룹 | 색상 |
|---|---|---|---|---|
| 01 | 목사님 L | 목사_bip.mp3 | pastor | 🟡 황금 |
| 02 | 목사님 R | 목사2_bip.mp3 | pastor | 🟡 황금 |
| 03 | 박재우 (리더) | 박재우목사님_bip.mp3 | leader | 🟠 오렌지 |
| 04 | 좌싱어 1 | 죄싱어1_bip.mp3 | vocal_left | 🔴 코랄 |
| 05 | 장지은 (좌2) | 죄싱어2_bip.mp3 | vocal_left | 🔴 코랄 |
| 06 | 김동은 (좌3) | 좌싱어3_bip.mp3 | vocal_left | 🔴 코랄 |
| 07 | 임진의 (우1) | 임진의_bip.mp3 | vocal_right | 🟣 퍼플 |
| 08 | 박배영 (우2) | 박배영_bip.mp3 | vocal_right | 🟣 퍼플 |
| 09 | 박희은 (우3) | 박희은_bip.mp3 | vocal_right | 🟣 퍼플 |
| 17 | 신디 1 | 신디1_bip.mp3 | keys | 💜 |
| 18 | 신디 2 | 신디2_bip.mp3 | keys | 💜 |
| 19 | 베이스 | 베이스기타_bip.mp3 | bass | 🔵 |
| 20 | 어쿠스틱 | 어쿼스틱_bip.mp3 | guitar | 🟢 |
| 22 | 드럼 L | 드럼1_bip.mp3 | drums | 🔵 |
| 23 | 드럼 R | 드럼2_bip.mp3 | drums | 🔵 |

> CH 10~16, 21 = 해당 주에 미사용 채널 (Logic에서 mute 상태)

---

## 데이터 구조

### songs.json 스키마

```json
[
  {
    "id": "song01_2",
    "title": "왕이신 하나님",
    "date": "2026-05-25",
    "type": "song",          // "song" | "speech"
    "start": 1070,           // 전체 녹음 기준 시작(초)
    "end": 1243,             // 종료(초), null이면 끝까지
    "tracks": [
      {
        "ch": 3,             // 채널 번호 (M32 CH 번호)
        "name": "박재우 (리더)",
        "file": "https://pub-xxx.r2.dev/song01/파일명.mp3",
        "group": "leader",   // 그룹 분류
        "pan": 0             // 선택: 초기 PAN값 (-1~1)
      }
    ]
  }
]
```

### 그룹 분류표

| group 값 | 설명 | 프리셋 동작 |
|---|---|---|
| `pastor` | 목사님 마이크 | 기본 포함 |
| `leader` | 리더싱어 | `singers` 프리셋에 포함 |
| `vocal_left` | 좌측 보컬 | `singers`, `singers_only` 포함 |
| `vocal_right` | 우측 보컬 | `singers`, `singers_only` 포함 |
| `keys` | 건반/신디 | `instruments` 포함 |
| `bass` | 베이스기타 | `instruments` 포함 |
| `guitar` | 기타류 | `instruments` 포함 |
| `drums` | 드럼 L/R | `instruments` 포함 |

---

## 컴포넌트 설명

### mixer.js — WorshipMixer

| 메서드 | 설명 |
|---|---|
| `init()` | AudioContext 초기화 |
| `setSongSegment(start, end)` | 재생 구간 지정 |
| `loadTrack(info)` | 트랙 로딩 + 노드 그래프 구성 |
| `play(offset)` | Sample-accurate 동기 재생 |
| `pause() / stop() / seek(t)` | 재생 제어 |
| `setTrackVolumeDb(idx, db)` | dB 기반 볼륨 (-60~+6) |
| `setTrackPan(idx, pan)` | 스테레오 PAN (-1~1) |
| `setTrackReverb(idx, amt)` | 리버브 0~1 |
| `muteTrack / soloTrack` | 뮤트/솔로 |
| `applyPreset(myIdx, preset)` | 프리셋 적용 |
| `getTrackLevel(idx)` | 레벨 미터 (0~1) |
| `getMasterLevel()` | 마스터 레벨 |
| `checkLoop()` | A-B 루프 + 구간 종료 체크 |

### visualizer.js — WorshipVisualizer

| 메서드 | 설명 |
|---|---|
| `init(mixer)` | 믹서 참조 등록 |
| `setMyChannel(idx)` | MY CH 변경 → 패널 토글 |
| `drawSpectrum(canvas, analyser)` | 주파수 스펙트럼 |
| `drawVUMeter(canvas, analyser)` | VU + 피크홀드 |
| `drawLargeVU(canvas, analyser)` | 대형 클로즈업 VU |
| `updateGlowPulse(strips, mixer)` | 채널 발광 업데이트 |
| `initThreeJS(container)` | Three.js 3D 씬 초기화 |
| `updateThreeWaveform(analyser)` | 3D 파형 업데이트 |
| `update()` | 프레임마다 호출 |

### 프리셋 목록

| 프리셋 ID | 설명 |
|---|---|
| `all` | 전체 채널 |
| `me_solo` | 내 채널만 |
| `me_full` | 내 채널(+3dB) + 전체(-6dB) |
| `singers` | 리더 + 좌우 싱어 |
| `singers_only` | 좌우 싱어만 |
| `instruments` | 악기 채널만 |
| `me_rhythm` | 내 채널 + 리듬(드럼/베이스) |
| `me_keys` | 내 채널 + 건반 |
| `me_minus` | 내 채널 제외 전체 (MR 연습) |

---

## 시각화 시스템

MY CH 선택 시 5가지 시각화가 활성화됩니다.

```
┌─────────────────────────────────────────────────────┐
│ MY CHANNEL: 박재우 (리더)  CH 03  [leader]          │
├─────────────┬────────────┬──────────────────────────┤
│ 🎵 SPECTRUM │ 📊 VU PEAK │ 🌊 3D WAVEFORM (Three.js)│
│  FFT 막대   │ 피크홀드   │  WebGL 3D 리본 파형      │
├─────────────┴────────────┘                          │
│ 🎤 CLOSE-UP VU (대형 미터 + dB 눈금)                │
└─────────────────────────────────────────────────────┘
  + 🎨 채널 스트립 발광 (레벨에 따라 테두리 glow)
```

### FFT 설정

| 시각화 | AnalyserNode.fftSize | 용도 |
|---|---|---|
| 스펙트럼 | 1024 | 주파수 막대 (512 bins) |
| VU/피크 | 256 | 레벨 감지 |
| 3D 파형 | 1024 | 시간영역 파형 |
| 마스터 파형 | 1024 | 상단 파형 |

---

## 인프라

### Cloudflare R2

- **버킷명:** `worship-audio`
- **Public URL:** `https://pub-02511af5429b430fbe859693c59e7c25.r2.dev`
- **CORS:** `AllowedOrigins: ["*"]`, `AllowedMethods: ["GET", "HEAD"]`
- **업로드:** wrangler CLI (`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` 필요)

```bash
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID="364c5434e22c0de0c9695f421cf52734"
cd audio/song01/
for f in *.mp3; do
  wrangler r2 object put "worship-audio/song01/$f" --file="$f" --content-type="audio/mpeg" --remote
done
```

### Cloudflare Pages

- **URL:** `https://worship-henotes.pages.dev`
- **GitHub 연결:** `paeyoungpark-web/worship_henotes`
- **빌드:** None (정적 파일)
- **파일 크기 제한:** 25MB (음원은 R2 분리 필수)
- **자동 배포:** `git push` → 1~2분 내 완료

### GitHub

- **리포:** `https://github.com/paeyoungpark-web/worship_henotes`
- **브랜치:** `main`
- **주의:** `audio/**/*.mp3` → `.gitignore` 처리 (R2 전용)

---

## 업로드 가이드

→ 상세: `docs/upload-guide.md`

### 빠른 요약

```bash
# 1. Logic에서 AIFF export → XLD로 MP3(VBR V2) 변환

# 2. R2에 업로드
export CLOUDFLARE_API_TOKEN="cfut_..."
export CLOUDFLARE_ACCOUNT_ID="364c5434e22c0de0c9695f421cf52734"
cd /path/to/mp3/files
for f in *.mp3; do
  wrangler r2 object put "worship-audio/songXX/$f" --file="$f" \
    --content-type="audio/mpeg" --remote
done

# 3. songs.json 수정 (트랙 URL + 구간 정보)

# 4. git push → 자동 배포
git add data/songs.json
git commit -m "Add 2026-XX-XX 예배 곡"
git push
```

---

## 주의사항

- **MP3 싱크**: Logic export 시 모든 트랙이 동일 시작점에서 떨어져야 함
- **MP3 패딩**: LAME 인코더 silence padding으로 미세 오프셋 발생 가능 → WAV/FLAC 권장
- **iOS Safari**: 사용자 탭 이벤트 후 AudioContext.resume() 필수 (자동 처리됨)
- **CORS**: R2 CORS 설정 필수 (브라우저 fetch 차단 방지)
- **저작권**: CCLI 라이선스 범위 내 교회 내부 공유만 허용

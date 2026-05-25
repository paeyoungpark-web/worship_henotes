# CHANGELOG

## [2026-05-26] — M32 시각화 풀 패키지

### 추가
- `js/visualizer.js` — 5종 시각화 엔진
  - 🎵 스펙트럼 분석기 (FFT 막대 그래프)
  - 📊 VU 피크홀드 미터
  - 🎨 채널 발광 (Glow Pulse)
  - 🌊 Three.js 3D 파형
  - 🎤 MY CH 클로즈업 대형 VU 미터
- `docs/ARCHITECTURE.md` — 시스템 전체 아키텍처 문서
- `docs/CHANGELOG.md` — 변경 이력

### 변경
- MY CH 선택 시 시각화 패널 자동 표시
- 채널 스트립 레벨에 따라 테두리 glow 애니메이션

---

## [2026-05-26] — 채널 매핑 + 프리셋 확장

### 추가
- 새 프리셋: `리더+싱어`, `좌우싱어만`, `악기만`
- 실시간 파형 캔버스 (시크바 위)
- 채널 그룹별 색상 코딩 (pastor/leader/vocal_left/vocal_right)

### 변경
- songs.json: CH 번호 순서대로 트랙 정렬
- songs.json: 초기 PAN 값 적용 (드럼 L/R, 목사님 L/R)
- 곡 목록: 날짜 오름차순(시간순) 정렬

---

## [2026-05-26] — M32 스타일 전면 개편

### 추가
- M32/X32 콘솔 스타일 UI (검은 배경 + 오렌지 테마)
- 세로 페이더 (dB 단위, -60 ~ +6)
- MUTE / SOLO 버튼
- PAN 슬라이더
- 레벨 미터 (채널별 + 마스터)
- 트랜스포트 상태 LED (READY/PLAYING/PAUSED)
- ⓘ HELP 모달 (컨트롤 설명)
- 프리셋 Scene 바

### 수정
- **싱크 문제 완전 수정**: `ctx.currentTime + 0.05` 선스케줄로 sample-accurate 동기화
- dB 기반 페이더 (`dbToGain()` 변환)
- 버튼 활성화/비활성화 상태 머신

---

## [2026-05-25] — 곡 구간 분리

### 추가
- songs.json `start`/`end` 필드로 전체 녹음에서 곡별 구간 재생
- 곡 목록 8개 항목 (멘트 포함)
- Cloudflare R2 음원 분리 (Pages 25MB 제한 해결)

### 채널 매핑 확정
| CH | 이름 |
|---|---|
| 01~02 | 목사님 L/R |
| 03 | 박재우 (리더) |
| 04~06 | 좌싱어 1~3 |
| 07~09 | 우싱어 1~3 |
| 17~18 | 신디 1/2 |
| 19 | 베이스기타 |
| 20 | 어쿠스틱 |
| 22~23 | 드럼 L/R |

---

## [2026-05-25] — MVP 출시

### 추가
- 프로젝트 초기 생성 (`worship_Henotes`)
- 곡 목록 뷰 + 플레이어 뷰
- Web Audio API 멀티트랙 재생
- 볼륨 슬라이더 + 뮤트
- A-B 구간 루프
- 프리셋 (ALL/SOLO ME/ME+BAND/ME+RHYTHM/ME+KEYS/MINUS ME)
- Cloudflare Pages 자동 배포 연결
- Git LFS 설정 (→ 이후 R2로 전환)

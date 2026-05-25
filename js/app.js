/**
 * app.js — 메인 컨트롤러
 * worship_Henotes 프로젝트
 */

// ── 상태 변수 ──────────────────────────────────────────
let songs         = [];
let mixer         = null;
let currentSong   = null;
let myPartIdx     = -1;
let seekInterval  = null;

// Google Forms URL (피드백 연동 시 입력)
// 예: 'https://docs.google.com/forms/d/e/XXXX/viewform'
const FEEDBACK_FORM_URL = '';

// ── DOMContentLoaded ────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  mixer = new WorshipMixer();

  // 로딩 오버레이에 진행 바 추가
  const loadingEl = document.getElementById('loading');
  loadingEl.innerHTML = `
    <p>🎵 로딩 중... <span id="loading-progress">0</span>%</p>
    <div class="loading-bar-wrap">
      <div class="loading-bar" style="width:0%"></div>
    </div>
  `;

  // songs.json 로딩
  try {
    const res = await fetch('data/songs.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    songs = await res.json();
    UI.renderSongList(songs, loadSong);
  } catch (e) {
    document.getElementById('song-list').innerHTML = `
      <div class="empty-state">
        <div style="font-size:2rem">⚠️</div>
        <p>곡 데이터를 불러올 수 없습니다.<br><code>data/songs.json</code> 파일을 확인하세요.</p>
        <p style="margin-top:8px;font-size:0.8rem;color:#bbb">${e.message}</p>
      </div>`;
  }

  bindGlobalEvents();
});

// ── 곡 로딩 ────────────────────────────────────────────
async function loadSong(idx) {
  currentSong = songs[idx];
  UI.showView('player');

  document.getElementById('song-title').textContent = currentSong.title;
  document.getElementById('song-date').textContent  = currentSong.date || '';

  // 기존 트랙 해제 및 재생 중단
  clearInterval(seekInterval);
  mixer.unloadAll();

  // AudioContext 초기화 (사용자 제스처 내에서 호출 필요)
  await mixer.init();

  UI.showLoading(true, 0);

  // 리버브 IR 로딩 (최초 한 번)
  if (!mixer.reverbLoaded) {
    await mixer.loadReverbIR('audio/ir/church_hall.wav');
  }

  // 트랙 병렬 로딩 (진행률 표시)
  const total  = currentSong.tracks.length;
  let   loaded = 0;

  try {
    await mixer.loadAllTracks(currentSong.tracks, () => {
      loaded++;
      UI.showLoading(true, Math.round((loaded / total) * 100));
    });
  } catch (e) {
    UI.showLoading(false);
    alert(`트랙 로딩 실패: ${e.message}\n\naudio/ 폴더 내 MP3 파일을 확인해주세요.`);
    UI.showView('list');
    return;
  }

  // UI 렌더링
  UI.renderMyPartSelector(currentSong.tracks);
  UI.renderTracks(currentSong.tracks, mixer);
  UI.showLoading(false);

  // 시크바 초기화
  const seekBar = document.getElementById('seek-bar');
  seekBar.value = 0;
  seekBar.max   = Math.floor(mixer.duration * 1000);

  // 루프 버튼 초기화
  document.getElementById('loop-a-btn').textContent = '🔁 A 지점';
  document.getElementById('loop-b-btn').textContent = '🔁 B 지점';
  document.getElementById('loop-toggle-btn').textContent = '구간반복 OFF';
  document.getElementById('loop-toggle-btn').classList.remove('active');

  // 프리셋 active 초기화
  document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-preset="all"]').classList.add('active');

  // 내 파트 선택 초기화
  document.getElementById('my-part-select').value = '-1';
  myPartIdx = -1;

  updateTimeDisplay();
}

// ── 전역 이벤트 바인딩 ──────────────────────────────────
function bindGlobalEvents() {

  // ── 뒤로가기 ──
  document.getElementById('back-btn').addEventListener('click', () => {
    clearInterval(seekInterval);
    mixer.stop();
    UI.showView('list');
  });

  // ── 재생 ──
  document.getElementById('play-btn').addEventListener('click', async () => {
    // iOS 사파리: 사용자 제스처 내에서 resume 필요
    if (mixer.ctx && mixer.ctx.state === 'suspended') {
      await mixer.ctx.resume();
    }
    mixer.play(mixer.pauseTime);
    startSeekUpdate();
  });

  // ── 일시정지 ──
  document.getElementById('pause-btn').addEventListener('click', () => {
    mixer.pause();
    clearInterval(seekInterval);
    updateTimeDisplay();
  });

  // ── 정지 ──
  document.getElementById('stop-btn').addEventListener('click', () => {
    mixer.stop();
    clearInterval(seekInterval);
    document.getElementById('seek-bar').value = 0;
    updateTimeDisplay();
  });

  // ── 시크바 ──
  document.getElementById('seek-bar').addEventListener('input', e => {
    const pct  = +e.target.value / (+e.target.max);
    const time = pct * mixer.duration;
    mixer.seek(time);
    updateTimeDisplay();
    if (mixer.isPlaying) startSeekUpdate();
  });

  // ── 내 파트 선택 ──
  document.getElementById('my-part-select').addEventListener('change', e => {
    myPartIdx = +e.target.value;
    UI.highlightMyPart(myPartIdx);
  });

  // ── 프리셋 버튼 ──
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      if (myPartIdx < 0 && preset !== 'all') {
        alert('먼저 "🎤 내 파트" 드롭다운에서 본인 세션을 선택해주세요.');
        return;
      }
      mixer.applyPreset(myPartIdx, preset);
      UI.syncSlidersFromMixer(mixer);
      document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ── 루프 A 지점 ──
  document.getElementById('loop-a-btn').addEventListener('click', () => {
    mixer.loop.a = mixer.getCurrentTime();
    document.getElementById('loop-a-btn').textContent =
      `🔁 A: ${UI.formatTime(mixer.loop.a)}`;
  });

  // ── 루프 B 지점 ──
  document.getElementById('loop-b-btn').addEventListener('click', () => {
    mixer.loop.b = mixer.getCurrentTime();
    document.getElementById('loop-b-btn').textContent =
      `🔁 B: ${UI.formatTime(mixer.loop.b)}`;
  });

  // ── 루프 ON/OFF ──
  document.getElementById('loop-toggle-btn').addEventListener('click', () => {
    mixer.loop.enabled = !mixer.loop.enabled;
    const btn = document.getElementById('loop-toggle-btn');
    btn.textContent = '구간반복 ' + (mixer.loop.enabled ? 'ON' : 'OFF');
    btn.classList.toggle('active', mixer.loop.enabled);
  });

  // ── 믹스값 복사 ──
  document.getElementById('copy-mix-btn').addEventListener('click', () => {
    if (!currentSong) return;
    const text = mixer.getMixSummary(currentSong.title);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('📋 믹스값이 클립보드에 복사되었습니다!');
      }).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  });

  // ── 피드백 ──
  document.getElementById('feedback-btn').addEventListener('click', () => {
    if (!currentSong) return;
    const t         = UI.formatTime(mixer.getCurrentTime());
    const trackName = myPartIdx >= 0 ? mixer.tracks[myPartIdx].info.name : '';

    if (FEEDBACK_FORM_URL) {
      // Google Forms로 이동 (파라미터 자동 채움)
      const url = new URL(FEEDBACK_FORM_URL);
      url.searchParams.set('usp', 'pp_url');
      // Google Forms entry ID는 실제 폼에서 확인 후 교체
      url.searchParams.set('entry.SONG',  currentSong.title);
      url.searchParams.set('entry.TRACK', trackName);
      url.searchParams.set('entry.TIME',  t);
      window.open(url.toString(), '_blank');
    } else {
      // 피드백 폼 미설정 → 클립보드 복사
      const msg = `[${currentSong.title}] ${t} / ${trackName || '전체'} / `;
      const hint = `피드백 양식:\n${msg}\n위 텍스트를 복사해 단톡방에 붙여넣고 의견을 작성해주세요.`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(msg).then(() => {
          showToast('💬 피드백 양식이 클립보드에 복사되었습니다!');
        });
      } else {
        alert(hint);
      }
    }
  });
}

// ── 시크바 업데이트 루프 ────────────────────────────────
function startSeekUpdate() {
  clearInterval(seekInterval);
  seekInterval = setInterval(() => {
    if (!mixer || !mixer.isPlaying) return;

    // 루프 체크
    mixer.checkLoop();

    const cur = mixer.getCurrentTime();
    const max = +document.getElementById('seek-bar').max;
    document.getElementById('seek-bar').value =
      mixer.duration > 0 ? (cur / mixer.duration) * max : 0;
    updateTimeDisplay();

    // 곡 끝
    if (cur >= mixer.duration - 0.1) {
      mixer.stop();
      clearInterval(seekInterval);
      document.getElementById('seek-bar').value = 0;
      updateTimeDisplay();
    }
  }, 200);
}

function updateTimeDisplay() {
  if (!mixer) return;
  const cur = mixer.getCurrentTime();
  const dur = mixer.duration;
  document.getElementById('time-display').textContent =
    `${UI.formatTime(cur)} / ${UI.formatTime(dur)}`;
}

// ── 유틸 ────────────────────────────────────────────────
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity  = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  showToast('📋 클립보드에 복사되었습니다!');
}

let toastTimer = null;
function showToast(msg) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.style.cssText = `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: #1d1d1f; color: #fff; padding: 12px 20px; border-radius: 20px;
      font-size: 0.9rem; z-index: 9999; opacity: 0; transition: opacity 0.2s;
      white-space: nowrap;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

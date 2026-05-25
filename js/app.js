/**
 * app.js — 메인 컨트롤러 (M32 Style)
 */

let songs       = [];
let mixer       = null;
let currentSong = null;
let myPartIdx   = -1;
let updateTimer = null;

const FEEDBACK_FORM_URL = ''; // 선택: Google Forms URL

/* ── DOMContentLoaded ── */
document.addEventListener('DOMContentLoaded', async () => {
  mixer = new WorshipMixer();

  try {
    const res = await fetch('data/songs.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    songs = await res.json();

    // name/group 자동 보완
    songs.forEach(song => {
      song.tracks.forEach(t => {
        if (!t.name) {
          t.name = t.file.split('/').pop().replace(/\.[^.]+$/, '').replace(/_bip$/, '');
        }
        if (!t.group) t.group = UI.inferGroup(t.name);
      });
    });

    UI.renderSongList(songs, loadSong);
  } catch (e) {
    document.getElementById('song-list').innerHTML =
      `<div style="padding:20px;color:var(--red)">⚠ 곡 데이터 로딩 실패: ${e.message}</div>`;
  }

  bindGlobalEvents();
  UI.setTransportState('ready');
});

/* ── 곡 로딩 ── */
async function loadSong(idx) {
  currentSong = songs[idx];
  UI.showView('player');
  UI.showLoading(true, 0);

  document.getElementById('song-title').textContent = currentSong.title;
  document.getElementById('song-date').textContent  = currentSong.date || '';

  stopUpdateLoop();
  mixer.unloadAll();
  await mixer.init();

  // 곡 구간 설정 (start/end 있으면 적용)
  mixer.setSongSegment(currentSong.start || 0, currentSong.end || null);

  if (!mixer.reverbLoaded) {
    await mixer.loadReverbIR('audio/ir/church_hall.wav');
  }

  // 순차 로딩 (진행도 표시)
  const total = currentSong.tracks.length;
  let loaded  = 0;
  await mixer.loadAllTracks(currentSong.tracks, () => {
    loaded++;
    UI.showLoading(true, Math.round((loaded / total) * 100));
  });

  // UI 구성
  UI.renderMyPartSelector(currentSong.tracks);
  UI.renderChannelStrips(currentSong.tracks, mixer);
  UI.showLoading(false);
  UI.setTransportState('ready');

  // 시크바 초기화 (songDuration 기준)
  const seekBar   = document.getElementById('seek-bar');
  seekBar.value   = 0;
  seekBar.max     = Math.floor(mixer.songDuration * 1000);

  // 루프 버튼 초기화
  document.getElementById('loop-a-btn').textContent = 'SET A';
  document.getElementById('loop-b-btn').textContent = 'SET B';
  document.getElementById('loop-toggle-btn').textContent = 'LOOP OFF';
  document.getElementById('loop-toggle-btn').classList.remove('active');

  // 프리셋 초기화
  document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-preset="all"]').classList.add('active');

  // 내 파트 초기화
  myPartIdx = -1;
  document.getElementById('my-part-select').value = '-1';

  updateTimeDisplay();
  startUpdateLoop();
}

/* ── 전역 이벤트 ── */
function bindGlobalEvents() {

  // 뒤로가기
  document.getElementById('back-btn').addEventListener('click', () => {
    mixer.stop();
    stopUpdateLoop();
    UI.setTransportState('ready');
    UI.showView('list');
  });

  // 재생
  document.getElementById('play-btn').addEventListener('click', async () => {
    if (!mixer.tracks.length) return;
    if (mixer.ctx?.state === 'suspended') await mixer.ctx.resume();
    mixer.play(mixer.pauseTime);
    UI.setTransportState('playing');
  });

  // 일시정지
  document.getElementById('pause-btn').addEventListener('click', () => {
    mixer.pause();
    UI.setTransportState('paused');
    updateTimeDisplay();
  });

  // 정지
  document.getElementById('stop-btn').addEventListener('click', () => {
    mixer.stop();
    UI.setTransportState('ready');
    document.getElementById('seek-bar').value = 0;
    updateTimeDisplay();
  });

  // 시크바
  document.getElementById('seek-bar').addEventListener('input', e => {
    if (!mixer.songDuration) return;
    const t = (+e.target.value / +e.target.max) * mixer.songDuration;
    mixer.seek(t);
    updateTimeDisplay();
  });

  // 내 파트
  document.getElementById('my-part-select').addEventListener('change', e => {
    myPartIdx = +e.target.value;
    UI.highlightMyPart(myPartIdx);
  });

  // 프리셋
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (myPartIdx < 0 && btn.dataset.preset !== 'all') {
        UI.toast('⚠ 먼저 MY CH 에서 채널을 선택하세요');
        return;
      }
      mixer.applyPreset(myPartIdx, btn.dataset.preset);
      UI.syncFromMixer(mixer);
      document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // 루프 A
  document.getElementById('loop-a-btn').addEventListener('click', () => {
    mixer.loop.a = mixer.getCurrentTime();
    document.getElementById('loop-a-btn').textContent = `A:${UI.formatTime(mixer.loop.a)}`;
  });

  // 루프 B
  document.getElementById('loop-b-btn').addEventListener('click', () => {
    mixer.loop.b = mixer.getCurrentTime();
    document.getElementById('loop-b-btn').textContent = `B:${UI.formatTime(mixer.loop.b)}`;
  });

  // 루프 토글
  document.getElementById('loop-toggle-btn').addEventListener('click', () => {
    mixer.loop.enabled = !mixer.loop.enabled;
    const btn = document.getElementById('loop-toggle-btn');
    btn.textContent = 'LOOP ' + (mixer.loop.enabled ? 'ON' : 'OFF');
    btn.classList.toggle('active', mixer.loop.enabled);
  });

  // 마스터 페이더
  document.getElementById('master-fader').addEventListener('input', e => {
    const db = +e.target.value;
    mixer.setMasterVolumeDb(db);
    document.getElementById('master-db').textContent = UI.dbToLabel(db) + ' dB';
  });

  // Export Mix
  document.getElementById('copy-mix-btn').addEventListener('click', () => {
    if (!currentSong) return;
    const text = mixer.getMixText(currentSong.title);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => UI.toast('📋 믹스 설정이 클립보드에 복사되었습니다'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      UI.toast('📋 클립보드에 복사되었습니다');
    }
  });

  // 피드백
  document.getElementById('feedback-btn').addEventListener('click', () => {
    if (!currentSong) return;
    const t    = UI.formatTime(mixer.getCurrentTime());
    const name = myPartIdx >= 0 ? (mixer.tracks[myPartIdx]?.info?.name || '') : '전체';
    if (FEEDBACK_FORM_URL) {
      const url = new URL(FEEDBACK_FORM_URL);
      url.searchParams.set('entry.SONG',  currentSong.title);
      url.searchParams.set('entry.TRACK', name);
      url.searchParams.set('entry.TIME',  t);
      window.open(url.toString(), '_blank');
    } else {
      const msg = `[${currentSong.title}] ${t} / ${name} / `;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(msg).then(() => UI.toast('💬 피드백 양식 복사 완료 — 단톡방에 붙여넣으세요'));
      }
    }
  });

  // 도움말
  document.getElementById('info-btn').addEventListener('click', () => {
    document.getElementById('help-modal').classList.remove('hidden');
  });
  document.getElementById('help-close').addEventListener('click', () => {
    document.getElementById('help-modal').classList.add('hidden');
  });
  document.getElementById('help-modal').addEventListener('click', e => {
    if (e.target.id === 'help-modal') document.getElementById('help-modal').classList.add('hidden');
  });
}

/* ── 업데이트 루프 (20fps) ── */
function startUpdateLoop() {
  stopUpdateLoop();
  updateTimer = setInterval(() => {
    // 미터
    UI.updateMeters(mixer);

    if (!mixer.isPlaying) return;

    // 루프 체크 (종료 신호면 UI 업데이트)
    const ended = mixer.checkLoop();
    if (ended) {
      UI.setTransportState('ready');
      document.getElementById('seek-bar').value = 0;
      updateTimeDisplay();
      return;
    }

    // 시크바 + 시간 업데이트
    const cur = mixer.getCurrentTime();
    const max = +document.getElementById('seek-bar').max;
    document.getElementById('seek-bar').value = mixer.songDuration > 0 ? (cur / mixer.songDuration) * max : 0;
    updateTimeDisplay();

  }, 50);
}

function stopUpdateLoop() {
  if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
}

function updateTimeDisplay() {
  document.getElementById('time-current').textContent = UI.formatTime(mixer.getCurrentTime());
  document.getElementById('time-total').textContent   = UI.formatTime(mixer.songDuration);
}

/**
 * app.js — 메인 컨트롤러 (M32 Style)
 */

let songs          = [];
let mixer          = null;
let visualizer     = null;
let currentSong    = null;
let myPartIdx      = -1;   // 주 채널
let myPartIdx2     = -1;   // 서브 채널 (듀얼)
let updateTimer    = null;

const FEEDBACK_FORM_URL = '';
const PIN_CODE          = '8883';

/* ── PIN 인증 ── */
(function initPin() {
  if (sessionStorage.getItem('worship_auth') === 'ok') {
    document.getElementById('pin-screen').classList.add('unlocked');
    return;
  }
  let entered = '';
  const dots  = document.querySelectorAll('.dot');
  const errEl = document.getElementById('pin-error');

  function updateDots() {
    dots.forEach((d, i) => d.classList.toggle('filled', i < entered.length));
  }
  function shake() {
    errEl.classList.remove('hidden');
    errEl.style.animation = 'none';
    requestAnimationFrame(() => errEl.style.animation = '');
    setTimeout(() => errEl.classList.add('hidden'), 1800);
  }
  function tryUnlock() {
    if (entered === PIN_CODE) {
      sessionStorage.setItem('worship_auth', 'ok');
      document.getElementById('pin-screen').classList.add('unlocked');
    } else {
      shake();
      entered = '';
      updateDots();
    }
  }

  // 마우스/터치
  document.querySelectorAll('.pin-key').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = btn.dataset.n;
      if (n === 'del') { entered = entered.slice(0, -1); }
      else if (n === 'ok') { tryUnlock(); }
      else if (entered.length < 4) { entered += n; }
      updateDots();
      if (entered.length === 4) setTimeout(tryUnlock, 150);
    });
  });

  // 키보드
  document.addEventListener('keydown', e => {
    if (document.getElementById('pin-screen').classList.contains('unlocked')) return;
    if (e.key >= '0' && e.key <= '9' && entered.length < 4) { entered += e.key; updateDots(); }
    else if (e.key === 'Backspace') { entered = entered.slice(0,-1); updateDots(); }
    else if (e.key === 'Enter') tryUnlock();
    if (entered.length === 4) setTimeout(tryUnlock, 150);
  });
})();

/* ── DOMContentLoaded ── */
document.addEventListener('DOMContentLoaded', async () => {
  mixer      = new WorshipMixer();
  visualizer = new WorshipVisualizer();

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
  bindKeyboard();
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
  visualizer.init(mixer);
  UI.initWaveform();
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

  // MY CH 1
  document.getElementById('my-part-select').addEventListener('change', e => {
    myPartIdx = +e.target.value;
    UI.highlightMyParts(myPartIdx, myPartIdx2);
    visualizer.setMyChannel(myPartIdx >= 0 ? myPartIdx : myPartIdx2);
  });
  // MY CH 2 (듀얼)
  document.getElementById('my-part-select2').addEventListener('change', e => {
    myPartIdx2 = +e.target.value;
    UI.highlightMyParts(myPartIdx, myPartIdx2);
    if (myPartIdx < 0) visualizer.setMyChannel(myPartIdx2);
  });

  // 시각화 ON/OFF 토글
  document.getElementById('vis-toggle-btn').addEventListener('click', () => {
    const body = document.querySelector('.my-vis-body');
    const btn  = document.getElementById('vis-toggle-btn');
    const on   = body.classList.toggle('hidden-body');
    btn.textContent = on ? '👁 OFF' : '👁 ON';
    btn.classList.toggle('active', !on);
  });

  // 프리셋
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset    = btn.dataset.preset;
      const groupOK   = ['all','singers','singers_only','instruments'].includes(preset);
      const hasMyPart = myPartIdx >= 0 || myPartIdx2 >= 0;
      if (!hasMyPart && !groupOK) {
        UI.toast('⚠ MY CH를 먼저 선택하세요');
        return;
      }
      mixer.applyPresetDual(myPartIdx, myPartIdx2, preset);
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
    // 미터 + 파형 + 시각화
    UI.updateMeters(mixer);
    WorshipVisualizer.drawMasterWaveform(mixer);
    visualizer.update();

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

/* ── 키보드 네비게이션 ── */
function bindKeyboard() {
  document.addEventListener('keydown', e => {
    // 입력 필드에 포커스 시 무시
    if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;

    switch (e.key) {
      case 'ArrowRight': {
        // 다음 곡
        if (!currentSong || !songs.length) break;
        const idx  = songs.indexOf(currentSong);
        const next = songs[idx + 1];
        if (next) {
          loadSong(songs.indexOf(next));
          UI.toast(`▶ ${next.title}`);
        } else {
          UI.toast('⚠ 마지막 곡입니다');
        }
        e.preventDefault();
        break;
      }
      case 'ArrowLeft': {
        // 이전 곡
        if (!currentSong || !songs.length) break;
        const idx  = songs.indexOf(currentSong);
        const prev = songs[idx - 1];
        if (prev) {
          loadSong(songs.indexOf(prev));
          UI.toast(`◀ ${prev.title}`);
        } else {
          UI.toast('⚠ 첫 번째 곡입니다');
        }
        e.preventDefault();
        break;
      }
      case 'ArrowUp': {
        // MY CH 1+2 복합 +1dB
        const idxs = [myPartIdx, myPartIdx2].filter(i => i >= 0);
        if (!idxs.length) { UI.toast('⚠ MY CH를 먼저 선택하세요'); break; }
        idxs.forEach(i => {
          const t = mixer.tracks[i]; if (!t) return;
          const db = Math.min(t.volumeDb + 1, 6);
          mixer.setTrackVolumeDb(i, db); _syncFaderUI(i, db);
        });
        const t1 = mixer.tracks[idxs[0]];
        UI.toast(`🔊 MY CH +1dB → ${UI.dbToLabel(t1.volumeDb)} dB`);
        e.preventDefault(); break;
      }
      case 'ArrowDown': {
        // MY CH 1+2 복합 -1dB
        const idxs = [myPartIdx, myPartIdx2].filter(i => i >= 0);
        if (!idxs.length) { UI.toast('⚠ MY CH를 먼저 선택하세요'); break; }
        idxs.forEach(i => {
          const t = mixer.tracks[i]; if (!t) return;
          const db = Math.max(t.volumeDb - 1, -60);
          mixer.setTrackVolumeDb(i, db); _syncFaderUI(i, db);
        });
        const t1 = mixer.tracks[idxs[0]];
        UI.toast(`🔉 MY CH -1dB → ${UI.dbToLabel(t1.volumeDb)} dB`);
        e.preventDefault(); break;
      }
      case ' ': {
        // 스페이스바 = 재생/일시정지
        if (!mixer.tracks.length) break;
        if (mixer.isPlaying) {
          mixer.pause();
          UI.setTransportState('paused');
        } else {
          mixer.play(mixer.pauseTime);
          UI.setTransportState('playing');
        }
        e.preventDefault();
        break;
      }
    }
  });
}

function _syncFaderUI(idx, db) {
  const strip = document.querySelector(`.channel-strip[data-idx="${idx}"]`);
  if (!strip) return;
  const fader = strip.querySelector('.fader');
  const dbOut = strip.querySelector('.ch-db-readout');
  if (fader) fader.value = db;
  if (dbOut) dbOut.textContent = UI.dbToLabel(db) + ' dB';
}

function updateTimeDisplay() {
  document.getElementById('time-current').textContent = UI.formatTime(mixer.getCurrentTime());
  document.getElementById('time-total').textContent   = UI.formatTime(mixer.songDuration);
}

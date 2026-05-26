/**
 * app.js — 은천교회 Worship Monitor (홈 + 회차 + M32 플레이어)
 */

let allServices = [];
let currentService = null;
let currentSongData = null;
let mixer     = null;
let visualizer = null;
let myPartIdx  = -1;
let myPartIdx2 = -1;
let updateTimer = null;

/* 연속 재생 전역 상태 */
const playlistState = {
  active: false,
  queue: [],
  currentIndex: 0,
  scope: null
};

/* 로딩 오버레이 제어 */
const Loading = {
  show(songTitle) {
    const el = document.getElementById('loading');
    const titleEl = document.getElementById('loading-title');
    if (titleEl) titleEl.textContent = songTitle ? `"${songTitle}" 준비 중...` : 'LOADING SCENE...';
    document.getElementById('loading-progress').textContent = '0';
    document.getElementById('loading-fill').style.width = '0%';
    el.classList.remove('hidden');
  },
  update(loaded, total) {
    const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
    document.getElementById('loading-progress').textContent = pct;
    document.getElementById('loading-fill').style.width = pct + '%';
  },
  hide() { document.getElementById('loading').classList.add('hidden'); }
};

const FEEDBACK_FORM_URL = '';
const PIN_CODE = '8883';

/* ── PIN 인증 ── */
(function initPin() {
  if (sessionStorage.getItem('worship_auth') === 'ok') {
    document.getElementById('pin-screen').classList.add('unlocked');
    return;
  }
  let entered = '';
  const dots  = document.querySelectorAll('.dot');
  const errEl = document.getElementById('pin-error');
  function updateDots() { dots.forEach((d,i) => d.classList.toggle('filled', i < entered.length)); }
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
    } else { shake(); entered = ''; updateDots(); }
  }
  document.querySelectorAll('.pin-key').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = btn.dataset.n;
      if (n === 'del') entered = entered.slice(0,-1);
      else if (n === 'ok') { tryUnlock(); return; }
      else if (entered.length < 4) entered += n;
      updateDots();
      if (entered.length === 4) setTimeout(tryUnlock, 150);
    });
  });
  document.addEventListener('keydown', e => {
    if (!document.getElementById('pin-screen').classList.contains('unlocked')) {
      if (e.key >= '0' && e.key <= '9' && entered.length < 4) { entered += e.key; updateDots(); }
      else if (e.key === 'Backspace') { entered = entered.slice(0,-1); updateDots(); }
      else if (e.key === 'Enter') tryUnlock();
      if (entered.length === 4) setTimeout(tryUnlock, 150);
    }
  });
})();

/* ── DOMContentLoaded ── */
document.addEventListener('DOMContentLoaded', async () => {
  mixer      = new WorshipMixer();
  visualizer = new WorshipVisualizer();

  try {
    const res = await fetch('data/services.json');
    const data = await res.json();
    allServices = (data.services || []).sort((a,b) => b.date.localeCompare(a.date));
    renderHome();
  } catch (e) {
    console.error(e);
    document.getElementById('archive-list').innerHTML =
      `<div class="archive-empty">⚠ 데이터 로딩 실패: ${e.message}</div>`;
  }

  bindGlobalEvents();
  bindKeyboard();
  UI.setTransportState('ready');
});

/* ══════════════ 홈 렌더링 ══════════════ */
function renderHome() {
  if (allServices.length > 0) renderLatestService(allServices[0]);
  populateFilters();
  renderArchive(allServices);
}

function renderLatestService(s) {
  const total = s.teams.reduce((n,t) => n + (t.songs?.length||0), 0);
  document.getElementById('latest-service').innerHTML = `
    <div class="latest-card-inner">
      <div class="latest-badge">LATEST · ${s.week||''}</div>
      <div class="latest-date">📅 ${formatDateKr(s.date)}</div>
      <h3 class="latest-title">${s.title}</h3>
      <p class="latest-meta">${s.leader?`👤 ${s.leader}`:''}${s.theme?` · 📖 ${s.theme}`:''}</p>
      <div class="latest-teams">
        ${s.teams.map(t=>`<div class="team-chip">${t.name}<span class="team-chip-count">${t.songs?.length||0}곡</span></div>`).join('')}
      </div>
      <button class="latest-cta" onclick="openService('${s.id}')">🎵 ${total}곡 모니터링하기 →</button>
    </div>`;
}

function populateFilters() {
  const years = new Set();
  allServices.forEach(s => { if (s.date) years.add(s.date.slice(0,4)); });
  const ySel = document.getElementById('filter-year');
  ySel.innerHTML = '<option value="">전체 연도</option>' +
    [...years].sort().reverse().map(y => `<option value="${y}">${y}년</option>`).join('');
  const mSel = document.getElementById('filter-month');
  mSel.innerHTML = '<option value="">전체 월</option>' +
    Array.from({length:12},(_,i)=>`<option value="${(i+1).toString().padStart(2,'0')}">${i+1}월</option>`).join('');
}

function renderArchive(services) {
  const el = document.getElementById('archive-list');
  if (!services.length) { el.innerHTML = '<div class="archive-empty">해당 조건의 예배가 없습니다.</div>'; return; }
  el.innerHTML = services.map(s => {
    const total = s.teams.reduce((n,t)=>n+(t.songs?.length||0),0);
    return `<div class="service-card" onclick="openService('${s.id}')">
      <div class="service-card-week">${s.week||''}</div>
      <div class="service-card-date">${formatDateKr(s.date)}</div>
      <div class="service-card-title">${s.title}</div>
      <div class="service-card-teams">
        ${s.teams.map(t=>`<span class="service-card-team">${t.name} · ${t.songs?.length||0}곡</span>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function applyFilters() {
  const year   = document.getElementById('filter-year').value;
  const month  = document.getElementById('filter-month').value;
  const search = document.getElementById('filter-search').value.toLowerCase().trim();
  let list = allServices;
  if (year)   list = list.filter(s => s.date.startsWith(year));
  if (month)  list = list.filter(s => s.date.slice(5,7) === month);
  if (search) list = list.filter(s =>
    s.leader?.toLowerCase().includes(search) ||
    s.theme?.toLowerCase().includes(search)  ||
    s.teams.some(t => t.leader?.toLowerCase().includes(search) ||
      t.songs?.some(sg => sg.title.toLowerCase().includes(search)))
  );
  renderArchive(list);
}

/* 연속 재생 함수들 */
function startPlaylist(service, scope, teamIdx = null) {
  const queue = [];
  if (scope === 'service') {
    service.teams.forEach((team, tIdx) => {
      (team.songs || []).forEach((song, sIdx) => {
        queue.push({ serviceId: service.id, teamIdx: tIdx, songIdx: sIdx, title: song.title, teamName: team.name });
      });
    });
  } else if (scope === 'team' && teamIdx !== null) {
    const team = service.teams[teamIdx];
    (team.songs || []).forEach((song, sIdx) => {
      queue.push({ serviceId: service.id, teamIdx: teamIdx, songIdx: sIdx, title: song.title, teamName: team.name });
    });
  }
  if (!queue.length) return;
  playlistState.active = true;
  playlistState.queue  = queue;
  playlistState.currentIndex = 0;
  playlistState.scope  = scope;
  playCurrentInPlaylist();
}

function playCurrentInPlaylist() {
  const item = playlistState.queue[playlistState.currentIndex];
  if (!item) { stopPlaylist(); return; }
  openSong(item.serviceId, item.teamIdx, item.songIdx, true);
}

function playNextInPlaylist() {
  if (!playlistState.active) return;
  if (playlistState.currentIndex < playlistState.queue.length - 1) {
    playlistState.currentIndex++;
    playCurrentInPlaylist();
  } else {
    UI.toast('🎉 모든 곡 재생 완료!');
    stopPlaylist();
  }
}

function playPrevInPlaylist() {
  if (!playlistState.active || playlistState.currentIndex <= 0) return;
  playlistState.currentIndex--;
  playCurrentInPlaylist();
}

function stopPlaylist() {
  playlistState.active = false;
  playlistState.queue  = [];
  playlistState.currentIndex = 0;
  document.getElementById('playlist-bar').classList.add('hidden');
}

function updatePlaylistBar() {
  const bar = document.getElementById('playlist-bar');
  if (!playlistState.active) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const cur   = playlistState.currentIndex + 1;
  const total = playlistState.queue.length;
  document.getElementById('playlist-current').textContent = `${cur} / ${total}`;
  const next = playlistState.queue[playlistState.currentIndex + 1];
  document.getElementById('playlist-next-title').textContent =
    next ? `${next.teamName} - ${next.title}` : '(마지막 곡입니다)';
  document.getElementById('playlist-prev-btn').disabled = playlistState.currentIndex === 0;
  document.getElementById('playlist-next-btn').disabled = playlistState.currentIndex >= total - 1;
}

/* ══════════════ 회차 상세 ══════════════ */
function openService(serviceId) {
  const s = allServices.find(x => x.id === serviceId);
  if (!s) return;
  currentService = s;
  document.getElementById('service-week').textContent         = s.week || '';
  document.getElementById('service-title-display').textContent = s.title || '';
  document.getElementById('service-date-display').textContent  = formatDateKr(s.date);
  document.getElementById('service-leader').textContent = s.leader || '—';
  document.getElementById('service-theme').textContent  = s.theme  || '—';

  // 전체곡 연속 재생 카드 업데이트
  const totalSongs = s.teams.reduce((n, t) => n + (t.songs?.length || 0), 0);
  const summaryEl = document.getElementById('play-all-summary');
  if (summaryEl) summaryEl.textContent = `${s.teams.length}개 팀 · 총 ${totalSongs}곡 연속 재생`;
  const playAllBtn = document.getElementById('play-all-service-btn');
  if (playAllBtn) playAllBtn.onclick = () => startPlaylist(s, 'service');

  document.getElementById('teams-container').innerHTML = s.teams.map((team, ti) => `
    <div class="team-section">
      <div class="team-header">
        <div class="team-icon">${ti+1}</div>
        <div class="team-info">
          <div class="team-name">${team.name}</div>
          <div class="team-leader">${team.leader?`👤 ${team.leader}`:''}</div>
        </div>
        ${(team.songs?.length||0) > 1 ? `<button class="btn-play-team" onclick="startPlaylist(currentService,'team',${ti});event.stopPropagation()">▶ 팀 전체(${team.songs.length}곡)</button>` : ''}
      </div>
      <div class="song-list">
        ${(team.songs||[]).map((song, si) => `
          <div class="song-item${song.type==='speech'?' speech':''}"
               onclick="openSong('${s.id}',${ti},${si})">
            <div class="song-number">${si+1}</div>
            <div class="song-details">
              <div class="song-name">${song.title}</div>
              <div class="song-meta">${song.duration||''} · ${song.tracks?.length||0}채널${song.type==='speech'?' · 멘트':''}</div>
            </div>
            <div class="song-play-icon">▶</div>
          </div>`).join('') || '<div style="padding:20px;color:#999;text-align:center;">곡이 아직 업로드되지 않았습니다.</div>'}
      </div>
    </div>`).join('');

  showView('service');
  window.scrollTo(0, 0);
}

/* ══════════════ 플레이어 ══════════════ */

// 트랙 시그니처(같은 곡 묶음인지 판별용)
function getTrackSignature(tracks) {
  return tracks.map(t => t.file).sort().join('|');
}

async function openSong(serviceId, teamIdx, songIdx, fromPlaylist = false) {
  const s    = allServices.find(x => x.id === serviceId);
  const song = s?.teams?.[teamIdx]?.songs?.[songIdx];
  if (!song || !song.tracks?.length) return;

  // ⭐ 핵심: 같은 트랙 시그니처면 재로딩 스킵 → segment만 점프
  const newSig  = getTrackSignature(song.tracks);
  const sameMix = (mixer._loadedSig === newSig && mixer.tracks.length > 0);

  currentSongData = { ...song, _service: s, _team: s.teams[teamIdx] };
  showView('player');
  if (fromPlaylist) updatePlaylistBar();
  else stopPlaylist();

  document.getElementById('song-title').textContent = song.title;
  document.getElementById('song-date').textContent  = `${formatDateKr(s.date)} · ${s.teams[teamIdx].name}`;

  if (sameMix) {
    // ⭐ 즉시 점프 경로 — 로딩 없음
    console.log(`✨ 캐시 히트: segment만 점프 (${song.title})`);
    mixer.stop();
    mixer.setSongSegment(song.start || 0, song.end || null);
    stopUpdateLoop();

    UI.setTransportState('ready');
    const seekBar = document.getElementById('seek-bar');
    seekBar.value = 0;
    seekBar.max   = Math.floor(mixer.songDuration * 1000);

    mixer.onEnded = () => {
      if (playlistState.active) setTimeout(() => playNextInPlaylist(), 600);
    };

    renderSongPager(s, teamIdx, songIdx);
    updateTimeDisplay();
    startUpdateLoop();

    if (fromPlaylist) {
      setTimeout(() => {
        if (mixer.ctx?.state === 'suspended') mixer.ctx.resume();
        mixer.play(0);
        UI.setTransportState('playing');
      }, 200);
    }
    return;
  }

  // ⭐ 풀 로딩 경로 — 새로운 곡 묵음일 때만
  Loading.show(song.title);

  // name/group 자동 보완
  song.tracks.forEach(t => {
    if (!t.name)  t.name  = decodeURIComponent(t.file.split('/').pop().replace(/\.[^.]+$/, '').replace(/_bip$/, ''));
    if (!t.group) t.group = UI.inferGroup(t.name);
  });

  stopUpdateLoop();
  mixer.unloadAll();
  await mixer.init();
  mixer.setSongSegment(song.start || 0, song.end || null);

  if (!mixer.reverbLoaded) await mixer.loadReverbIR('audio/ir/church_hall.wav');

  let loaded = 0;
  const total = song.tracks.length;
  await mixer.loadAllTracks(song.tracks, () => {
    loaded++;
    Loading.update(loaded, total);
  });

  // ⭐ 로딩 완료된 시그니처 기록
  mixer._loadedSig = newSig;

  UI.renderMyPartSelector(song.tracks);
  UI.renderChannelStrips(song.tracks, mixer);
  visualizer.init(mixer);

  mixer.onEnded = () => {
    if (playlistState.active) setTimeout(() => playNextInPlaylist(), 600);
  };

  Loading.hide();
  UI.setTransportState('ready');

  const seekBar = document.getElementById('seek-bar');
  seekBar.value = 0;
  seekBar.max   = Math.floor(mixer.songDuration * 1000);

  // 초기화
  myPartIdx = myPartIdx2 = -1;
  document.getElementById('my-part-select').value  = '-1';
  document.getElementById('my-part-select2').value = '-1';
  document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-preset="all"]').classList.add('active');
  document.getElementById('loop-a-btn').textContent = 'SET A';
  document.getElementById('loop-b-btn').textContent = 'SET B';
  document.getElementById('loop-toggle-btn').textContent = 'LOOP OFF';
  document.getElementById('loop-toggle-btn').classList.remove('active');

  renderSongPager(s, teamIdx, songIdx);
  updateTimeDisplay();
  startUpdateLoop();

  if (fromPlaylist) {
    setTimeout(() => {
      if (mixer.ctx?.state === 'suspended') mixer.ctx.resume();
      mixer.play(0);
      UI.setTransportState('playing');
    }, 300);
  }
}

/* ══════════════ 글로벌 이벤트 ══════════════ */
function bindGlobalEvents() {
  // 필터
  ['filter-year','filter-month'].forEach(id =>
    document.getElementById(id).addEventListener('change', applyFilters));
  document.getElementById('filter-search').addEventListener('input', applyFilters);

  // 홈 ← 회차
  document.getElementById('back-to-home').addEventListener('click', () => { showView('home'); window.scrollTo(0,0); });

  // 연속 재생 컨트롤 버튼
  document.getElementById('playlist-next-btn').addEventListener('click', playNextInPlaylist);
  document.getElementById('playlist-prev-btn').addEventListener('click', playPrevInPlaylist);
  document.getElementById('playlist-stop-btn').addEventListener('click', () => {
    stopPlaylist(); UI.toast('■ 연속 재생 종료');
  });

  // 회차 ← 플레이어
  document.getElementById('back-btn').addEventListener('click', () => {
    mixer.stop(); stopUpdateLoop(); UI.setTransportState('ready');
    if (currentService) openService(currentService.id);
    else showView('home');
  });

  // 재생 컨트롤
  document.getElementById('play-btn').addEventListener('click', async () => {
    if (!mixer.tracks.length) return;
    if (mixer.ctx?.state === 'suspended') await mixer.ctx.resume();
    mixer.play(mixer.pauseTime);
    UI.setTransportState('playing');
  });
  document.getElementById('pause-btn').addEventListener('click', () => {
    mixer.pause(); UI.setTransportState('paused'); updateTimeDisplay();
  });
  document.getElementById('stop-btn').addEventListener('click', () => {
    mixer.stop(); UI.setTransportState('ready');
    document.getElementById('seek-bar').value = 0; updateTimeDisplay();
  });
  document.getElementById('seek-bar').addEventListener('input', e => {
    if (!mixer.songDuration) return;
    mixer.seek((+e.target.value / +e.target.max) * mixer.songDuration);
    updateTimeDisplay();
  });

  // MY CH 1
  document.getElementById('my-part-select').addEventListener('change', e => {
    myPartIdx = +e.target.value;
    UI.highlightMyParts(myPartIdx, myPartIdx2);
    visualizer.setMyChannel(myPartIdx >= 0 ? myPartIdx : myPartIdx2);
  });
  // MY CH 2
  document.getElementById('my-part-select2').addEventListener('change', e => {
    myPartIdx2 = +e.target.value;
    UI.highlightMyParts(myPartIdx, myPartIdx2);
    if (myPartIdx < 0) visualizer.setMyChannel(myPartIdx2);
  });

  // 시각화 ON/OFF
  document.getElementById('vis-toggle-btn').addEventListener('click', () => {
    const body = document.querySelector('.my-vis-body');
    const btn  = document.getElementById('vis-toggle-btn');
    const off  = body.classList.toggle('hidden-body');
    btn.textContent = off ? '👁 OFF' : '👁 ON';
    btn.classList.toggle('active', !off);
  });

  // 프리셋 — applyPresetDual 사용
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset  = btn.dataset.preset;
      const grpOnly = ['all','singers','singers_only','instruments'].includes(preset);
      const hasMy   = myPartIdx >= 0 || myPartIdx2 >= 0;
      if (!hasMy && !grpOnly) { UI.toast('⚠ MY CH를 먼저 선택하세요'); return; }
      mixer.applyPresetDual(myPartIdx, myPartIdx2, preset);
      UI.syncFromMixer(mixer);
      document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // 루프
  document.getElementById('loop-a-btn').addEventListener('click', () => {
    mixer.loop.a = mixer.getCurrentTime();
    document.getElementById('loop-a-btn').textContent = `A:${UI.formatTime(mixer.loop.a)}`;
  });
  document.getElementById('loop-b-btn').addEventListener('click', () => {
    mixer.loop.b = mixer.getCurrentTime();
    document.getElementById('loop-b-btn').textContent = `B:${UI.formatTime(mixer.loop.b)}`;
  });
  document.getElementById('loop-toggle-btn').addEventListener('click', () => {
    mixer.loop.enabled = !mixer.loop.enabled;
    const btn = document.getElementById('loop-toggle-btn');
    btn.textContent = 'LOOP ' + (mixer.loop.enabled ? 'ON' : 'OFF');
    btn.classList.toggle('active', mixer.loop.enabled);
  });

  // ⭐ 곡 네비게이션 (이전/다음)
  document.getElementById('prev-song-btn').addEventListener('click', goToPrevSong);
  document.getElementById('next-song-btn').addEventListener('click', goToNextSong);

  // 마스터 페이더
  document.getElementById('master-fader').addEventListener('input', e => {
    const db = +e.target.value;
    mixer.setMasterVolumeDb(db);
    document.getElementById('master-db').textContent = UI.dbToLabel(db) + ' dB';
  });

  // Export Mix
  document.getElementById('copy-mix-btn').addEventListener('click', () => {
    if (!currentSongData) return;
    const text = mixer.getMixText(currentSongData.title);
    navigator.clipboard?.writeText(text).then(() => UI.toast('📋 믹스값 복사됨'));
  });

  // 피드백
  document.getElementById('feedback-btn').addEventListener('click', () => {
    if (!currentSongData) return;
    const t    = UI.formatTime(mixer.getCurrentTime());
    const name = (myPartIdx >= 0 ? mixer.tracks[myPartIdx]?.info?.name : '') || '전체';
    const msg  = `[${currentSongData.title}] ${t} / ${name} / `;
    navigator.clipboard?.writeText(msg).then(() => UI.toast('💬 피드백 양식 복사됨 — 단톡방에 붙여넣으세요'));
  });

  // 도움말
  document.getElementById('info-btn').addEventListener('click', () => document.getElementById('help-modal').classList.remove('hidden'));
  document.getElementById('help-close').addEventListener('click', () => document.getElementById('help-modal').classList.add('hidden'));
  document.getElementById('help-modal').addEventListener('click', e => { if (e.target.id==='help-modal') e.target.classList.add('hidden'); });
}

/* ══════════════ 키보드 ══════════════ */
function bindKeyboard() {
  document.addEventListener('keydown', e => {
    if (document.getElementById('pin-screen') && !document.getElementById('pin-screen').classList.contains('unlocked')) return;
    if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (document.getElementById('view-player').classList.contains('hidden')) return;

    switch (e.key) {
      case 'ArrowRight': // 다음 곡
        goToNextSong(); e.preventDefault(); break;
      case 'ArrowLeft':  // 이전 곡
        goToPrevSong(); e.preventDefault(); break;
      case 'ArrowUp': { // MY CH +1dB
        const idxs = [myPartIdx,myPartIdx2].filter(i=>i>=0);
        if (!idxs.length) { UI.toast('⚠ MY CH를 먼저 선택'); break; }
        idxs.forEach(i => {
          const t = mixer.tracks[i]; if (!t) return;
          const db = Math.min(t.volumeDb+1, 6);
          mixer.setTrackVolumeDb(i, db); _syncFaderUI(i, db);
        });
        UI.toast(`🔊 MY CH +1dB → ${UI.dbToLabel(mixer.tracks[idxs[0]].volumeDb)} dB`);
        e.preventDefault(); break;
      }
      case 'ArrowDown': { // MY CH -1dB
        const idxs = [myPartIdx,myPartIdx2].filter(i=>i>=0);
        if (!idxs.length) { UI.toast('⚠ MY CH를 먼저 선택'); break; }
        idxs.forEach(i => {
          const t = mixer.tracks[i]; if (!t) return;
          const db = Math.max(t.volumeDb-1, -60);
          mixer.setTrackVolumeDb(i, db); _syncFaderUI(i, db);
        });
        UI.toast(`🔉 MY CH -1dB → ${UI.dbToLabel(mixer.tracks[idxs[0]].volumeDb)} dB`);
        e.preventDefault(); break;
      }
      case ' ': {
        if (!mixer.tracks.length) break;
        if (mixer.isPlaying) { mixer.pause(); UI.setTransportState('paused'); }
        else { mixer.play(mixer.pauseTime); UI.setTransportState('playing'); }
        e.preventDefault(); break;
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

/* ══════════════ 업데이트 루프 (20fps) ══════════════ */
function startUpdateLoop() {
  stopUpdateLoop();
  updateTimer = setInterval(() => {
    UI.updateMeters(mixer);
    WorshipVisualizer.drawMasterWaveform(mixer);
    visualizer.update();

    if (!mixer.isPlaying) return;
    const ended = mixer.checkLoop();
    if (ended) {
      UI.setTransportState('ready');
      document.getElementById('seek-bar').value = 0;
      updateTimeDisplay(); return;
    }
    const cur = mixer.getCurrentTime();
    const max = +document.getElementById('seek-bar').max;
    document.getElementById('seek-bar').value = mixer.songDuration > 0 ? (cur/mixer.songDuration)*max : 0;
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

/* ══════════════ 유틸 ══════════════ */
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${name}`).classList.remove('hidden');
  window.scrollTo(0, 0);
}

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior:'smooth' });
}

/* ══════════════ 곡 네비게이션 바 ══════════════ */
function renderSongPager(service, teamIdx, currentSongIdx) {
  const team  = service.teams[teamIdx];
  const songs = team.songs || [];
  const pager = document.getElementById('song-pager');
  if (!pager) return;

  pager.innerHTML = '';
  songs.forEach((song, idx) => {
    const dot = document.createElement('button');
    dot.className = 'pager-dot' +
      (idx === currentSongIdx ? ' active' : '') +
      (song.type === 'speech'  ? ' speech' : '');
    dot.dataset.songIdx = idx;
    dot.innerHTML = `
      <span class="dot-num">${(idx + 1).toString().padStart(2, '0')}</span>
      <span class="dot-title">${song.title}</span>
    `;
    dot.addEventListener('click', () => {
      openSong(service.id, teamIdx, idx, playlistState.active);
    });
    pager.appendChild(dot);
  });

  document.getElementById('prev-song-btn').disabled = currentSongIdx <= 0;
  document.getElementById('next-song-btn').disabled = currentSongIdx >= songs.length - 1;

  const activeDot = pager.querySelector('.pager-dot.active');
  if (activeDot) {
    setTimeout(() => activeDot.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }), 100);
  }
}

function goToPrevSong() {
  if (!currentSongData || !currentService) return;
  const team = currentSongData._team;
  const si   = team.songs.findIndex(s => s.id === currentSongData.id);
  if (si > 0) {
    const ti = currentService.teams.indexOf(team);
    openSong(currentService.id, ti, si - 1, playlistState.active);
    UI.toast(`◄ ${team.songs[si-1].title}`);
  } else {
    UI.toast('⚠ 첫 번째 곡입니다');
  }
}

function goToNextSong() {
  if (!currentSongData || !currentService) return;
  const team = currentSongData._team;
  const si   = team.songs.findIndex(s => s.id === currentSongData.id);
  if (si < team.songs.length - 1) {
    const ti = currentService.teams.indexOf(team);
    openSong(currentService.id, ti, si + 1, playlistState.active);
    UI.toast(`► ${team.songs[si+1].title}`);
  } else {
    UI.toast('⚠ 마지막 곡입니다');
  }
}

function formatDateKr(dateStr) {
  if (!dateStr) return '';
  const [y,m,d] = dateStr.split('-');
  const date = new Date(+y, +m-1, +d);
  const days = ['일','월','화','수','목','금','토'];
  return `${y}년 ${parseInt(m)}월 ${parseInt(d)}일 (${days[date.getDay()]})`;
}

// 전역 노출
window.openService   = openService;
window.openSong      = openSong;
window.scrollToId    = scrollToId;
window.startPlaylist = startPlaylist;
window.stopPlaylist  = stopPlaylist;

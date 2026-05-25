/**
 * UI — M32 스타일 렌더링 헬퍼
 */
const UI = {

  groupColorClass(group) {
    return {
      pastor:'ch-group-pastor', leader:'ch-group-leader',
      vocal_left:'ch-group-vocal_left', vocal_right:'ch-group-vocal_right',
      vocal:'ch-group-vocal', drums:'ch-group-drums', bass:'ch-group-bass',
      guitar:'ch-group-guitar', keys:'ch-group-keys', synth:'ch-group-keys',
    }[group] || 'ch-group-other';
  },

  dbToLabel(db) {
    if (db <= -59.5) return '-∞';
    return (db >= 0 ? '+' : '') + db.toFixed(1);
  },

  /* 곡 목록 */
  renderSongList(songs, onClick) {
    const list = document.getElementById('song-list');
    const byDate = {};
    songs.forEach((s, i) => {
      const d = s.date || '날짜 미정';
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push({ ...s, _idx: i });
    });

    list.innerHTML = '';
    // 날짜 오름차순 (시간순) — 같은 날짜면 songs.json 순서 유지
    Object.keys(byDate).sort().forEach(date => {
      const hdr = document.createElement('div');
      hdr.className = 'date-section-title';
      hdr.textContent = `▸ ${date}`;
      list.appendChild(hdr);

      byDate[date].forEach(song => {
        const dur = (song.start != null && song.end != null)
          ? UI.formatTime(song.end - song.start)
          : (song.duration || '—');
        const card = document.createElement('div');
        card.className = `song-card${song.type === 'speech' ? ' speech' : ''}`;
        card.innerHTML = `
          <div class="title">${song.title}</div>
          <div class="meta">${dur} · ${song.tracks.length} CH</div>`;
        card.addEventListener('click', () => onClick(song._idx));
        list.appendChild(card);
      });
    });
  },

  /* 내 파트 드롭다운 */
  renderMyPartSelector(tracks) {
    const sel = document.getElementById('my-part-select');
    sel.innerHTML = '<option value="-1">— SELECT —</option>' +
      tracks.map((t, i) =>
        `<option value="${i}">CH${(i+1).toString().padStart(2,'0')} · ${t.name || t.file.split('/').pop()}</option>`
      ).join('');
  },

  /* M32 채널 스트립 렌더링 */
  renderChannelStrips(tracks, mixer) {
    const container = document.getElementById('channel-strips');
    container.innerHTML = '';

    tracks.forEach((t, idx) => {
      const strip  = document.createElement('div');
      strip.className = 'channel-strip';
      strip.dataset.idx = idx;
      strip.dataset.group = t.group || 'other';
      const chNum  = t.ch ? t.ch.toString().padStart(2, '0') : (idx + 1).toString().padStart(2, '0');
      const tName  = t.name || t.file.split('/').pop().replace(/\.[^.]+$/, '');

      strip.innerHTML = `
        <div class="ch-group-bar ${UI.groupColorClass(t.group)}"></div>
        <div class="ch-header ch-number">CH ${chNum}</div>
        <div class="ch-name" title="${tName}">${tName}</div>

        <div class="ch-pan" title="좌우 위치 조절 (PAN)">
          <div class="ch-pan-label">PAN</div>
          <input type="range" class="ch-pan-slider" min="-1" max="1" step="0.02" value="0">
          <div class="ch-pan-readout">C</div>
        </div>

        <div class="ch-rev" title="잔향 추가 (REVERB) — 보컬 15~25% 권장">
          <div class="ch-rev-label">REV</div>
          <input type="range" class="ch-rev-slider" min="0" max="1" step="0.01" value="0">
          <div class="ch-rev-readout">0%</div>
        </div>

        <div class="ch-buttons">
          <button class="ch-btn mute" title="음소거 (MUTE)">M</button>
          <button class="ch-btn solo" title="솔로 — 이 채널만 듣기">S</button>
        </div>

        <div class="ch-meter-frame" title="레벨 미터">
          <div class="ch-meter"></div>
        </div>

        <div class="ch-fader-frame" title="볼륨 조절 (dB) — 0dB가 원본">
          <input type="range" class="fader" min="-60" max="6" step="0.5" value="0" orient="vertical">
          <div class="fader-scale">
            <span>+6</span><span>0</span><span>-10</span><span>-20</span><span>-40</span><span>∞</span>
          </div>
        </div>

        <div class="ch-db-readout">0.0 dB</div>
      `;

      container.appendChild(strip);

      // 이벤트 바인딩
      const panSlider  = strip.querySelector('.ch-pan-slider');
      const panOut     = strip.querySelector('.ch-pan-readout');
      const revSlider  = strip.querySelector('.ch-rev-slider');
      const revOut     = strip.querySelector('.ch-rev-readout');
      const muteBtn    = strip.querySelector('.ch-btn.mute');
      const soloBtn    = strip.querySelector('.ch-btn.solo');
      const fader      = strip.querySelector('.fader');
      const dbOut      = strip.querySelector('.ch-db-readout');

      panSlider.addEventListener('input', e => {
        const v = +e.target.value;
        mixer.setTrackPan(idx, v);
        panOut.textContent = v < -0.05 ? `L${Math.round(Math.abs(v)*100)}` : v > 0.05 ? `R${Math.round(v*100)}` : 'C';
      });
      revSlider.addEventListener('input', e => {
        const v = +e.target.value;
        mixer.setTrackReverb(idx, v);
        revOut.textContent = Math.round(v * 100) + '%';
      });
      muteBtn.addEventListener('click', () => {
        const s = !mixer.tracks[idx].muted;
        mixer.muteTrack(idx, s);
        muteBtn.classList.toggle('active', s);
      });
      soloBtn.addEventListener('click', () => {
        const s = !mixer.tracks[idx].solo;
        mixer.soloTrack(idx, s);
        soloBtn.classList.toggle('active', s);
      });
      fader.addEventListener('input', e => {
        const db = +e.target.value;
        mixer.setTrackVolumeDb(idx, db);
        dbOut.textContent = UI.dbToLabel(db) + ' dB';
      });
    });
  },

  /* 내 파트 강조 */
  highlightMyPart(idx) {
    document.querySelectorAll('.channel-strip').forEach(s => {
      s.classList.toggle('mine', +s.dataset.idx === idx);
    });
  },

  /* 믹서 상태 → UI 동기화 (프리셋 후 호출) */
  syncFromMixer(mixer) {
    document.querySelectorAll('.channel-strip').forEach(strip => {
      const idx = +strip.dataset.idx;
      const t   = mixer.tracks[idx];
      if (!t) return;
      strip.querySelector('.fader').value          = t.volumeDb;
      strip.querySelector('.ch-db-readout').textContent = UI.dbToLabel(t.volumeDb) + ' dB';
      strip.querySelector('.ch-pan-slider').value  = t.pan;
      const panOut = strip.querySelector('.ch-pan-readout');
      panOut.textContent = t.pan < -0.05 ? `L${Math.round(Math.abs(t.pan)*100)}` : t.pan > 0.05 ? `R${Math.round(t.pan*100)}` : 'C';
      strip.querySelector('.ch-rev-slider').value  = t.reverbAmt;
      strip.querySelector('.ch-rev-readout').textContent = Math.round(t.reverbAmt * 100) + '%';
      strip.querySelector('.ch-btn.mute').classList.toggle('active', t.muted);
      strip.querySelector('.ch-btn.solo').classList.toggle('active', t.solo);
    });
  },

  /* 미터 업데이트 */
  updateMeters(mixer) {
    document.querySelectorAll('.channel-strip').forEach(strip => {
      const idx = +strip.dataset.idx;
      strip.querySelector('.ch-meter').style.height = (mixer.getTrackLevel(idx) * 100) + '%';
    });
    const mm = document.getElementById('master-meter');
    if (mm) mm.style.height = (mixer.getMasterLevel() * 100) + '%';
  },

  /* 트랜스포트 상태 */
  setTransportState(state) {
    const play    = document.getElementById('play-btn');
    const pause   = document.getElementById('pause-btn');
    const stop    = document.getElementById('stop-btn');
    const led     = document.getElementById('status-led');
    const txt     = document.getElementById('status-text');
    switch (state) {
      case 'playing':
        play.disabled = true;  pause.disabled = false; stop.disabled = false;
        play.classList.add('active');
        led.className = 'status-led playing'; txt.textContent = 'PLAYING'; break;
      case 'paused':
        play.disabled = false; pause.disabled = true;  stop.disabled = false;
        play.classList.remove('active');
        led.className = 'status-led on'; txt.textContent = 'PAUSED'; break;
      default: // ready / stopped
        play.disabled = false; pause.disabled = true;  stop.disabled = true;
        play.classList.remove('active');
        led.className = 'status-led on'; txt.textContent = 'READY'; break;
    }
  },

  /* 뷰 전환 */
  showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const el = document.getElementById(`view-${name}`);
    if (el) { el.classList.remove('hidden'); window.scrollTo(0, 0); }
  },

  /* 로딩 */
  showLoading(show, pct = 0) {
    const el = document.getElementById('loading');
    el.classList.toggle('hidden', !show);
    if (show) {
      document.getElementById('loading-progress').textContent = pct;
      document.getElementById('loading-fill').style.width = pct + '%';
    }
  },

  /* 시간 포맷 */
  formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  },

  /* 토스트 */
  toast(msg, ms = 2500) {
    let el = document.getElementById('m32-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'm32-toast';
      el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
        background:#15161a;border:1px solid #ff8c1a;color:#ff8c1a;
        padding:10px 20px;font-size:0.8rem;letter-spacing:1px;z-index:9999;
        opacity:0;transition:opacity 0.2s;white-space:nowrap;font-family:monospace;`;
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, ms);
  },
};

/* ── 파형 시각화 ── */
UI.waveformCtx = null;
UI.initWaveform = function() {
  const canvas = document.getElementById('waveform-canvas');
  if (!canvas) return;
  canvas.width = canvas.offsetWidth * window.devicePixelRatio;
  canvas.height = canvas.offsetHeight * window.devicePixelRatio;
  UI.waveformCtx = canvas.getContext('2d');
};

UI.drawWaveform = function(mixer) {
  const canvas = document.getElementById('waveform-canvas');
  const ctx2d  = UI.waveformCtx;
  if (!canvas || !ctx2d) return;

  const W = canvas.width;
  const H = canvas.height;
  ctx2d.clearRect(0, 0, W, H);

  // 배경
  ctx2d.fillStyle = '#0a0a0c';
  ctx2d.fillRect(0, 0, W, H);

  if (!mixer.isPlaying || !mixer.masterAnalyser) {
    // 정지 상태: 중앙선만
    ctx2d.strokeStyle = '#2e3038';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(0, H / 2);
    ctx2d.lineTo(W, H / 2);
    ctx2d.stroke();
    return;
  }

  // 시간영역 파형 (time domain)
  const bufLen = mixer.masterAnalyser.fftSize;
  mixer.masterAnalyser.fftSize = 1024;
  const data = new Uint8Array(mixer.masterAnalyser.fftSize);
  mixer.masterAnalyser.getByteTimeDomainData(data);

  // 그라디언트 선
  const grad = ctx2d.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0,   '#ff8c1a44');
  grad.addColorStop(0.5, '#ff8c1aff');
  grad.addColorStop(1,   '#ff8c1a44');

  ctx2d.strokeStyle = grad;
  ctx2d.lineWidth   = 1.5 * window.devicePixelRatio;
  ctx2d.beginPath();

  const step = W / data.length;
  for (let i = 0; i < data.length; i++) {
    const x = i * step;
    const y = ((data[i] / 128.0) - 1) * (H * 0.45) + H / 2;
    i === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y);
  }
  ctx2d.stroke();

  // 중앙 0선
  ctx2d.strokeStyle = '#2e3038';
  ctx2d.lineWidth   = 0.5;
  ctx2d.beginPath();
  ctx2d.moveTo(0, H / 2);
  ctx2d.lineTo(W, H / 2);
  ctx2d.stroke();

  // 현재 재생 위치 인디케이터
  const seekBar = document.getElementById('seek-bar');
  if (seekBar && mixer.songDuration > 0) {
    const pct = mixer.getCurrentTime() / mixer.songDuration;
    const x   = pct * W;
    ctx2d.strokeStyle = '#ff8c1a';
    ctx2d.lineWidth   = 2 * window.devicePixelRatio;
    ctx2d.beginPath();
    ctx2d.moveTo(x, 0);
    ctx2d.lineTo(x, H);
    ctx2d.stroke();
  }
};

window.addEventListener('resize', () => {
  if (UI.waveformCtx) UI.initWaveform();
});

/* 그룹 자동 추론 (파일명 기반) */
UI.inferGroup = function(name) {
  const n = (name || '').toLowerCase();
  if (/vocal|voc|sing|lead|harm|화음|보컬|싱어|목사|주임|찬양/.test(n)) return 'vocal';
  if (/drum|kick|snare|hat|tom|드럼|킥/.test(n)) return 'drums';
  if (/bass|베이스/.test(n)) return 'bass';
  if (/guitar|gtr|ag|eg|기타|일렉|어쿠/.test(n)) return 'guitar';
  if (/key|piano|synth|pad|건반|키보드|신디/.test(n)) return 'keys';
  return 'other';
};

window.UI = UI;

/**
 * recorder.js — 워십 연습 녹음 모듈 (옵션 B: IndexedDB)
 *
 * 기능:
 *  - 🔴 REC 버튼으로 마이크 녹음 시작/종료
 *  - 음원 재생 중 REC → 동시 녹음
 *  - 음원 정지 상태에서 REC → 자동 재생 + 녹음
 *  - 자기 채널 자동 MUTE (헤드폰 피드백 방지)
 *  - 4박자 카운트인 옵션 (클릭 사운드 + 시각 오버레이)
 *  - IndexedDB 저장 (곡당 ~2-5MB)
 *  - 녹음 + 원본 동시 재생 / 녹음만 재생
 *  - 다운로드 / 삭제
 *
 * 의존성: mixer(전역), currentSongData(전역), myPartIdx(전역),
 *         myPartIdx2(전역), allServices(전역), UI(전역), openSong(전역함수)
 */

/* ═══════════════════════════════════════════
   IndexedDB 저장소
═══════════════════════════════════════════ */
const RecDB = {
  DB_NAME: 'worship_recordings',
  DB_VER:  1,
  STORE:   'recordings',

  _open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          const store = db.createObjectStore(this.STORE, { keyPath: 'id' });
          store.createIndex('by_song',      'songId',    { unique: false });
          store.createIndex('by_date',      'timestamp', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },

  async save(record) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(this.STORE, 'readwrite');
      const req = tx.objectStore(this.STORE).put(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },

  async getAll() {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).getAll();
      req.onsuccess = () =>
        resolve(req.result.sort((a, b) => b.timestamp - a.timestamp));
      req.onerror = () => reject(req.error);
    });
  },

  async delete(id) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(this.STORE, 'readwrite');
      const req = tx.objectStore(this.STORE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  },

  async count() {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },
};

/* ═══════════════════════════════════════════
   내부 상태
═══════════════════════════════════════════ */
const _recState = {
  isRecording:     false,
  recorder:        null,
  chunks:          [],
  stream:          null,
  startOffset:     0,    // 곡 내 시작 위치(초)
  startWallTime:   0,    // 실제 시작 시각(ms)
  countinEnabled:  false,
  mutedChannels:   [],   // 자동 mute한 채널 목록 (복원용)
};

/* ═══════════════════════════════════════════
   Recorder 메인 모듈
═══════════════════════════════════════════ */
const Recorder = {

  /* ── REC 버튼 클릭 ── */
  async handleRecBtn() {
    if (_recState.isRecording) {
      this._stopRecording();
    } else {
      await this._startRecording();
    }
  },

  /* ── 카운트인 ON/OFF 토글 ── */
  toggleCountin() {
    _recState.countinEnabled = !_recState.countinEnabled;
    const btn = document.getElementById('countin-toggle');
    if (btn) {
      btn.textContent = _recState.countinEnabled ? '4카운트 ON' : '4카운트 OFF';
      btn.classList.toggle('active', _recState.countinEnabled);
    }
    UI.toast(_recState.countinEnabled ? '🎵 4박자 카운트인 ON' : '4박자 카운트인 OFF');
  },

  /* ─────────────────────────────────────────
     녹음 시작 (내부)
  ───────────────────────────────────────── */
  async _startRecording() {
    if (!window.currentSongData) {
      UI.toast('⚠ 곡을 먼저 열어주세요');
      return;
    }

    /* 1. 마이크 권한 요청 */
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation:  true,
          noiseSuppression:  true,
          autoGainControl:   false,
          sampleRate:        48000,
        },
      });
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        UI.toast('❌ 마이크 권한 거부됨 — 브라우저 설정에서 허용해주세요', 4000);
      } else if (err.name === 'NotFoundError') {
        UI.toast('❌ 마이크를 찾을 수 없습니다', 4000);
      } else {
        UI.toast('❌ 마이크 오류: ' + err.message, 4000);
      }
      return;
    }

    /* 2. 헤드폰 경고 */
    UI.toast('🎧 헤드폰 필수! 스피커 사용 시 피드백 발생', 5000);

    /* 3. 카운트인 */
    if (_recState.countinEnabled) {
      const ok = await this._doCountin();
      if (!ok) { stream.getTracks().forEach(t => t.stop()); return; }
    }

    /* 4. 자기 채널 자동 MUTE */
    _recState.mutedChannels = [];
    const myIdxs = [window.myPartIdx, window.myPartIdx2].filter(i => i >= 0);
    myIdxs.forEach(idx => {
      const t = window.mixer?.tracks?.[idx];
      if (t && !t.muted) {
        window.mixer.muteTrack(idx, true);
        const strip = document.querySelector(`.channel-strip[data-idx="${idx}"]`);
        strip?.querySelector('.ch-btn.mute')?.classList.add('active');
        _recState.mutedChannels.push(idx);
      }
    });
    if (_recState.mutedChannels.length > 0) {
      UI.toast('🔇 내 채널 자동 MUTE (헤드폰으로 모니터링)', 3000);
    }

    /* 5. 음원 재생 (정지 상태이면 자동 시작) */
    if (!window.mixer?.isPlaying) {
      if (window.mixer?.ctx?.state === 'suspended') {
        await window.mixer.ctx.resume();
      }
      window.mixer?.play(window.mixer.pauseTime ?? 0);
      UI.setTransportState('playing');
    }

    /* 6. 상태 저장 */
    _recState.startOffset   = window.mixer?.getCurrentTime() ?? 0;
    _recState.startWallTime = Date.now();
    _recState.stream        = stream;
    _recState.chunks        = [];

    /* 7. MediaRecorder 설정 */
    const mimeType =
      MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
      MediaRecorder.isTypeSupported('audio/webm')             ? 'audio/webm' :
      MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')  ? 'audio/ogg;codecs=opus' :
      '';

    try {
      _recState.recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType, audioBitsPerSecond: 128000 } : {}
      );
    } catch (e) {
      _recState.recorder = new MediaRecorder(stream);
    }

    _recState.recorder.ondataavailable = e => {
      if (e.data.size > 0) _recState.chunks.push(e.data);
    };

    _recState.recorder.onstop = async () => {
      const blob     = new Blob(_recState.chunks, {
        type: _recState.recorder.mimeType || 'audio/webm',
      });
      const duration = Math.round((Date.now() - _recState.startWallTime) / 1000);
      await this._saveToDB(blob, _recState.startOffset, duration);
      stream.getTracks().forEach(t => t.stop());
      this._restoreMutedChannels();
      await this._updateBadge();
    };

    _recState.recorder.start(200); // 200ms 단위로 청크
    _recState.isRecording = true;
    this._updateRecBtn(true);
    UI.toast('🔴 녹음 시작!');
  },

  /* ── 녹음 종료 (내부) ── */
  _stopRecording() {
    if (!_recState.isRecording) return;
    try { _recState.recorder?.stop(); } catch (e) { console.warn(e); }
    _recState.isRecording = false;
    this._updateRecBtn(false);
    UI.toast('⏹ 녹음 종료 — 저장 중...');
  },

  /* ── 자동 MUTE 복원 ── */
  _restoreMutedChannels() {
    _recState.mutedChannels.forEach(idx => {
      window.mixer?.muteTrack(idx, false);
      const strip = document.querySelector(`.channel-strip[data-idx="${idx}"]`);
      strip?.querySelector('.ch-btn.mute')?.classList.remove('active');
    });
    _recState.mutedChannels = [];
  },

  /* ─────────────────────────────────────────
     4박자 카운트인
  ───────────────────────────────────────── */
  _doCountin() {
    return new Promise(resolve => {
      const BPM      = 80;
      const interval = (60 / BPM) * 1000; // ms
      const beats    = 4;
      let   beat     = 0;

      /* 오버레이 생성 */
      let overlay = document.getElementById('countin-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id        = 'countin-overlay';
        overlay.className = 'countin-overlay';
        document.body.appendChild(overlay);
      }
      overlay.innerHTML = `
        <div class="countin-box">
          <div class="countin-sub">녹음 준비</div>
          <div class="countin-number" id="countin-num">4</div>
          <div class="countin-label" id="countin-lbl">박자를 세세요</div>
          <button class="countin-cancel" onclick="document.getElementById('countin-overlay').dataset.cancelled='1'">취소</button>
        </div>`;
      overlay.style.display = 'flex';

      const numEl = document.getElementById('countin-num');
      const lblEl = document.getElementById('countin-lbl');

      /* 클릭 사운드 */
      const makeClick = isFirst => {
        const ctx = window.mixer?.ctx;
        if (!ctx) return;
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = isFirst ? 1100 : 880;
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
      };

      const tick = () => {
        /* 취소 확인 */
        if (overlay.dataset.cancelled === '1') {
          overlay.style.display = 'none';
          delete overlay.dataset.cancelled;
          resolve(false);
          return;
        }

        const remaining = beats - beat;
        makeClick(beat === 0);

        if (numEl) {
          numEl.textContent = remaining;
          numEl.classList.remove('countin-pulse');
          void numEl.offsetWidth; // reflow
          numEl.classList.add('countin-pulse');
        }

        if (remaining === 1 && lblEl) {
          lblEl.textContent = '시작!';
          if (numEl) numEl.style.color = '#ff4444';
        } else if (lblEl) {
          lblEl.textContent = '박자를 세세요';
          if (numEl) numEl.style.color = '#ff8c1a';
        }

        beat++;
        if (beat >= beats) {
          setTimeout(() => {
            overlay.style.display = 'none';
            if (numEl) numEl.style.color = '#ff8c1a';
            resolve(true);
          }, interval);
        } else {
          setTimeout(tick, interval);
        }
      };

      tick();
    });
  },

  /* ─────────────────────────────────────────
     IndexedDB 저장
  ───────────────────────────────────────── */
  async _saveToDB(blob, startOffset, duration) {
    const song = window.currentSongData;
    if (!song) return;

    const myIdx  = window.myPartIdx  >= 0 ? window.myPartIdx  :
                   window.myPartIdx2 >= 0 ? window.myPartIdx2 : -1;
    const myCh   = myIdx >= 0 ? window.mixer?.tracks?.[myIdx] : null;

    const record = {
      id:          `rec_${Date.now()}`,
      serviceId:   song._service?.id   || '',
      serviceDate: song._service?.date || '',
      songId:      song.id   || song.title,
      songTitle:   song.title,
      teamName:    song._team?.name || '',
      channelIdx:  myIdx,
      channelName: myCh?.info?.name || '전체',
      startOffset,
      timestamp:   Date.now(),
      duration,
      blob,
    };

    await RecDB.save(record);
    UI.toast(`💾 저장됨 — ${song.title} (${this._fmtDur(duration)})`, 3500);
  },

  /* ═══════════════════════════════════════════
     재생 기능
  ═══════════════════════════════════════════ */

  /* 녹음 + 원본 동시 재생 */
  async playWithOriginal(recordId) {
    const recs = await RecDB.getAll();
    const rec  = recs.find(r => r.id === recordId);
    if (!rec) return;

    /* 서비스/곡 찾기 */
    const service = (window.allServices || []).find(s => s.id === rec.serviceId);
    if (!service) { UI.toast('⚠ 원본 음원 서비스를 찾을 수 없습니다'); return; }

    let teamIdx = -1, songIdx = -1;
    service.teams.forEach((team, ti) => {
      (team.songs || []).forEach((song, si) => {
        if ((song.id || song.title) === rec.songId) { teamIdx = ti; songIdx = si; }
      });
    });

    if (teamIdx < 0) { UI.toast('⚠ 원본 곡 데이터를 찾을 수 없습니다'); return; }

    /* 모달 닫기 */
    document.getElementById('recordings-modal')?.classList.add('hidden');

    UI.toast('⏳ 원본 로딩 중...', 2000);

    /* 곡 열기 */
    await window.openSong(rec.serviceId, teamIdx, songIdx);

    /* 시작 위치로 이동 */
    if (rec.startOffset > 0) {
      window.mixer?.seek(rec.startOffset);
    }

    /* 원본 재생 */
    if (window.mixer?.ctx?.state === 'suspended') {
      await window.mixer.ctx.resume();
    }
    window.mixer?.play(rec.startOffset);
    UI.setTransportState('playing');

    /* 녹음본 재생 (동기) */
    const recUrl   = URL.createObjectURL(rec.blob);
    const recAudio = new Audio(recUrl);
    recAudio.volume = 1.0;

    setTimeout(() => {
      recAudio.play().catch(e => console.warn('녹음 재생 오류:', e));
    }, 120);

    recAudio.onended = () => URL.revokeObjectURL(recUrl);

    UI.toast(`🎧 ${rec.channelName} 녹음 + 원본 동시 재생`, 4000);
  },

  /* 녹음만 재생 */
  async playOnly(recordId) {
    const recs = await RecDB.getAll();
    const rec  = recs.find(r => r.id === recordId);
    if (!rec) return;

    const recUrl   = URL.createObjectURL(rec.blob);
    const recAudio = new Audio(recUrl);
    recAudio.volume = 1.0;

    recAudio.play().catch(e => UI.toast('❌ 재생 오류: ' + e.message, 4000));
    recAudio.onended = () => URL.revokeObjectURL(recUrl);

    UI.toast(`▶ ${rec.songTitle} — ${rec.channelName} 녹음 재생`, 3000);
  },

  /* ═══════════════════════════════════════════
     다운로드 / 삭제
  ═══════════════════════════════════════════ */

  async download(recordId) {
    const recs = await RecDB.getAll();
    const rec  = recs.find(r => r.id === recordId);
    if (!rec) return;

    const url  = URL.createObjectURL(rec.blob);
    const a    = document.createElement('a');
    const ext  = (rec.blob.type || '').includes('ogg') ? 'ogg' : 'webm';
    const safe = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
    a.href     = url;
    a.download = `${rec.serviceDate}_${safe(rec.songTitle)}_${safe(rec.channelName)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    UI.toast('↓ 다운로드 시작');
  },

  async delete(recordId) {
    if (!confirm('이 녹음을 삭제할까요?')) return;
    await RecDB.delete(recordId);
    await this.renderModal();
    await this._updateBadge();
    UI.toast('🗑 녹음 삭제됨');
  },

  /* ═══════════════════════════════════════════
     내 녹음 모달
  ═══════════════════════════════════════════ */

  async openModal() {
    const modal = document.getElementById('recordings-modal');
    if (modal) modal.classList.remove('hidden');
    await this.renderModal();
  },

  closeModal() {
    document.getElementById('recordings-modal')?.classList.add('hidden');
  },

  async renderModal() {
    const listEl  = document.getElementById('recordings-list');
    const titleEl = document.getElementById('recordings-title');
    if (!listEl) return;

    listEl.innerHTML = '<div class="rec-loading">로딩 중...</div>';

    let recs;
    try {
      recs = await RecDB.getAll();
    } catch (e) {
      listEl.innerHTML = `<div class="rec-empty">❌ 오류: ${e.message}</div>`;
      return;
    }

    if (titleEl) titleEl.textContent = `🎤 내 녹음 (${recs.length}개)`;

    if (!recs.length) {
      listEl.innerHTML = `
        <div class="rec-empty">
          아직 녹음이 없습니다.<br>
          <span class="rec-empty-hint">🔴 REC 버튼으로 연습을 시작하세요!</span>
        </div>`;
      return;
    }

    /* 날짜별 그룹 */
    const byDate = {};
    recs.forEach(r => {
      const d = r.serviceDate || new Date(r.timestamp).toISOString().slice(0, 10);
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(r);
    });

    listEl.innerHTML = Object.keys(byDate).sort().reverse().map(date => `
      <div class="rec-date-group">
        <div class="rec-date-header">📅 ${this._formatDateKr(date)}</div>
        ${byDate[date].map(r => `
          <div class="rec-item">
            <div class="rec-item-info">
              <div class="rec-item-title">${r.songTitle}</div>
              <div class="rec-item-meta">
                <span class="rec-ch-tag">${r.channelName}</span>
                ${this._fmtDur(r.duration)}
                · ${new Date(r.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                ${r.teamName ? `· ${r.teamName}` : ''}
              </div>
            </div>
            <div class="rec-item-actions">
              <button class="rec-btn rec-btn-both"
                      onclick="Recorder.playWithOriginal('${r.id}')"
                      title="녹음 + 원본 동시 재생">▶+원본</button>
              <button class="rec-btn rec-btn-solo"
                      onclick="Recorder.playOnly('${r.id}')"
                      title="내 목소리만 재생">▶ 목소리</button>
              <button class="rec-btn rec-btn-dl"
                      onclick="Recorder.download('${r.id}')"
                      title="다운로드">↓</button>
              <button class="rec-btn rec-btn-del"
                      onclick="Recorder.delete('${r.id}')"
                      title="삭제">✕</button>
            </div>
          </div>`).join('')}
      </div>`).join('');
  },

  /* ═══════════════════════════════════════════
     UI 헬퍼
  ═══════════════════════════════════════════ */

  _updateRecBtn(isRecording) {
    const btn = document.getElementById('rec-btn');
    if (!btn) return;
    btn.classList.toggle('recording', isRecording);
    const icon = btn.querySelector('.tr-icon');
    const lbl  = btn.querySelector('.tr-label');
    if (icon) icon.textContent = isRecording ? '⏹' : '⏺';
    if (lbl)  lbl.textContent  = isRecording ? 'STOP REC' : 'REC';
  },

  async _updateBadge() {
    const badge = document.getElementById('rec-badge');
    if (!badge) return;
    try {
      const cnt = await RecDB.count();
      badge.textContent  = cnt > 0 ? cnt : '';
      badge.style.display = cnt > 0 ? 'inline-flex' : 'none';
    } catch (e) { /* silent */ }
  },

  _fmtDur(sec) {
    if (!sec || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = String(Math.floor(sec % 60)).padStart(2, '0');
    return `${m}:${s}`;
  },

  _formatDateKr(dateStr) {
    if (!dateStr) return '';
    try {
      const [y, m, d] = dateStr.split('-');
      return `${parseInt(y)}년 ${parseInt(m)}월 ${parseInt(d)}일`;
    } catch { return dateStr; }
  },
};

/* ═══════════════════════════════════════════
   초기화
═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  Recorder._updateBadge().catch(() => {});
});

/* 전역 노출 */
window.Recorder = Recorder;
window.RecDB    = RecDB;

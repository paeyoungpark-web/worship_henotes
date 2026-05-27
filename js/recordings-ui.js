/**
 * recordings-ui.js — 녹음 목록 모달 + 원곡 싱크 재생
 *
 * 브랜치: feature/레코딩연습
 * - trackSig 비교로 원곡 싱크 판정
 * - 선예약 동시 시작 (_playSynced)
 * - ±500ms 싱크 보정 슬라이더
 */
const RecordingsUI = {
  _modal:        null,
  _audioEl:      null,
  _currentRec:   null,
  _currentRecId: null,
  _syncMode:     true,   // 원곡과 동시 재생 여부
  _syncOffsetMs: 0,      // 싱크 보정 (ms)
  _forceSync:   false,   // 강제 싱크 (시그니처 무시)

  /* ── 모달 열기 ── */
  async open() {
    await this._ensureModal();
    await this._render();
    this._modal.classList.remove('hidden');
  },

  /* ── 모달 닫기 ── */
  close() {
    this._stopPlayback();
    this._modal?.classList.add('hidden');
  },

  /* ── 모달 DOM 생성 (최초 1회) ── */
  async _ensureModal() {
    if (this._modal) return;

    document.body.insertAdjacentHTML('beforeend', `
      <div id="rec-modal" class="rec-modal hidden">
        <div class="rec-modal-box">
          <div class="rec-modal-header">
            <h3>🎙 내 녹음 목록</h3>
            <div class="rec-modal-actions">
              <label class="rec-sync-toggle">
                <input type="checkbox" id="rec-sync-cb" checked>
                <span>원곡과 함께 재생</span>
              </label>
              <label class="rec-sync-offset" title="원곡 대비 녹음 시간 보정 (ms)">
                <span>싱크 보정</span>
                <input type="range" id="rec-sync-offset" min="-500" max="500" step="10" value="0">
                <span id="rec-sync-offset-val">0ms</span>
              </label>
              <label class="rec-sync-toggle" title="시그니처 검사 무시 — 현재 로드된 곡과 강제 싱크">
                <input type="checkbox" id="rec-force-sync">
                <span>강제 싱크</span>
              </label>
              <button class="rec-close-btn" id="rec-close-btn">✕</button>
            </div>
          </div>
          <div class="rec-storage-info" id="rec-storage-info"></div>
          <div class="rec-list" id="rec-list">
            <div class="rec-empty">불러오는 중...</div>
          </div>
        </div>
      </div>`);

    this._modal = document.getElementById('rec-modal');

    // 닫기
    document.getElementById('rec-close-btn')
      .addEventListener('click', () => this.close());
    this._modal.addEventListener('click', e => {
      if (e.target === this._modal) this.close();
    });

    // 원곡 동시 재생 토글
    document.getElementById('rec-sync-cb')
      .addEventListener('change', e => { this._syncMode = e.target.checked; });

    document.getElementById('rec-force-sync')
      ?.addEventListener('change', e => { this._forceSync = e.target.checked; });

    // 싱크 보정 슬라이더
    const slider  = document.getElementById('rec-sync-offset');
    const valSpan = document.getElementById('rec-sync-offset-val');
    slider.addEventListener('input', e => {
      const ms = parseInt(e.target.value);
      this._syncOffsetMs = ms;
      valSpan.textContent = (ms >= 0 ? '+' : '') + ms + 'ms';
    });
  },

  /* ── 목록 렌더링 ── */
  async _render() {
    const list = document.getElementById('rec-list');
    const info = document.getElementById('rec-storage-info');
    if (!list) return;

    list.innerHTML = '<div class="rec-empty">불러오는 중...</div>';

    let recs;
    try { recs = await RecorderDB.getAll(); }
    catch (e) {
      list.innerHTML = `<div class="rec-empty">❌ 오류: ${e.message}</div>`;
      return;
    }

    // 저장공간 정보
    if (info) {
      const s = await RecorderDB.getStorageInfo();
      const usedMB  = s ? (s.usage / 1024 / 1024).toFixed(1) + ' MB 사용' : '';
      info.textContent = `총 ${recs.length}개 녹음${usedMB ? ' · ' + usedMB : ''}`;
    }

    if (!recs.length) {
      list.innerHTML = `
        <div class="rec-empty">
          아직 녹음이 없습니다.<br>
          🔴 <strong>REC</strong> 버튼을 눌러 녹음을 시작하세요.<br>
          <span style="font-size:.78rem;color:#444;margin-top:8px;display:block">
            곡 재생 중 또는 정지 상태 모두 녹음 가능합니다.
          </span>
        </div>`;
      return;
    }

    // 현재 트랙 시그니처 (싱크 가능 여부 표시용)
    const curSig = this._getCurrentTrackSig();

    list.innerHTML = recs.map(r => {
      const canSync = r.hasSong && r.trackSig && r.trackSig === curSig;
      const syncBadge = canSync
        ? '<span class="rec-sync-badge">🔗 싱크 가능</span>'
        : (r.hasSong ? '<span class="rec-nosync-badge">곡 미로드</span>' : '');

      return `
        <div class="rec-item" data-id="${r.id}">
          <div class="rec-item-info">
            <div class="rec-item-title">${this._esc(r.songTitle)} ${syncBadge}</div>
            <div class="rec-item-meta">
              <span>🎤 ${this._esc(r.channelName)}</span>
              <span>⏱ ${this._fmtDur(r.duration)}</span>
              <span>📅 ${this._fmtDate(r.timestamp)}</span>
              <span>💾 ${(r.size / 1024 / 1024).toFixed(2)}MB</span>
              ${r.startOffset > 0
                ? `<span>▶ ${this._fmtDur(r.startOffset)}부터</span>`
                : ''}
            </div>
          </div>
          <div class="rec-item-actions">
            <button data-action="play"     data-id="${r.id}" class="rec-btn-play">▶ 재생</button>
            <button data-action="download" data-id="${r.id}" class="rec-btn-dl">⬇ 다운로드</button>
            <button data-action="delete"   data-id="${r.id}" class="rec-btn-del">🗑</button>
          </div>
          <audio class="rec-item-audio hidden" data-id="${r.id}" controls preload="none"></audio>
        </div>`;
    }).join('');

    // 이벤트 위임
    list.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { action, id } = btn.dataset;
        if (action === 'play')     this._play(id);
        if (action === 'download') this._download(id);
        if (action === 'delete')   this._delete(id);
      });
    });
  },

  /* ── 재생 ── */
  async _play(id) {
    const rec = await RecorderDB.get(id);
    if (!rec) return;
    this._stopPlayback();

    const url     = URL.createObjectURL(rec.blob);
    const audioEl = this._modal.querySelector(`audio[data-id="${id}"]`);
    if (!audioEl) return;

    audioEl.src = url;
    audioEl.classList.remove('hidden');
    this._audioEl      = audioEl;
    this._currentRec   = rec;
    this._currentRecId = id;
    this._setPlayingUI(id, true);

    const hasMixerLoaded = !!(typeof mixer !== 'undefined' && mixer?.tracks?.length);

    // ① songKey 비교 (우선) — 가장 신뢰성 높음
    const curSongKey   = this._getCurrentSongKey();
    const sameSongByKey = hasMixerLoaded && rec.songKey && rec.songKey === curSongKey;

    // ② trackSig 비교 (보조) — 같은 파일이 로드됐는지
    const curSig        = this._getCurrentTrackSig();
    const sameSongBySig = hasMixerLoaded && rec.trackSig && rec.trackSig === curSig;

    const sameSong = sameSongByKey || sameSongBySig;
    const willSync = this._syncMode && (sameSong || (this._forceSync && hasMixerLoaded));

    console.log('[RecordingsUI] 재생 진단:', {
      syncMode:      this._syncMode,
      forceSync:     this._forceSync,
      hasMixerLoaded,
      recSongKey:    rec.songKey,
      curSongKey,
      sameSongByKey,
      sameSongBySig,
      willSync,
      startOffset:   rec.startOffset,
      hasMixSnap:    !!rec.mixSnapshot,
    });

    if (willSync) {
      // 임시: mixSnapshot 복원 비활성화 (디버깅용)
      // if (rec.mixSnapshot) {
      // this._restoreMixSnapshot(rec.mixSnapshot);
      // UI?.toast?.('🎚 녹음 시점의 믹스 상태 복원됨');
      // }
      await this._playSynced(rec, audioEl, rec.startOffset);
    } else {
      if (this._syncMode && !this._forceSync) {
        if (!hasMixerLoaded) {
          UI?.toast?.(`ℹ️ "${rec.songTitle}"을 먼저 로드하면 함께 재생됩니다`);
        } else {
          UI?.toast?.(`ℹ️ 같은 곡(${rec.songTitle})을 로드하면 함께 재생됩니다`);
        }
      }
      audioEl.currentTime = 0;
      await audioEl.play().catch(e => console.warn('[RecordingsUI] 재생 실패:', e));
    }

    audioEl.onended = () => {
      URL.revokeObjectURL(url);
      if (willSync && typeof mixer !== 'undefined') {
        try {
          if (typeof mixer.pause === 'function') mixer.pause();
          else if (typeof mixer.stop === 'function') mixer.stop();
          if (window.UI?.setTransportState) UI.setTransportState('paused');
        } catch {}
      }
      this._setPlayingUI(id, false);
    };
  },
  /* ── 재생 중 버튼 UI ── */
  _setPlayingUI(id, isPlaying) {
    const btn = this._modal?.querySelector(`[data-action="play"][data-id="${id}"]`);
    if (!btn) return;
    btn.textContent = isPlaying ? '⏹ 정지' : '▶ 재생';
    btn.classList.toggle('rec-btn-playing', isPlaying);
  },

  /* ── 원곡 동기 재생 (다중 API 패턴 시도) ── */
  async _playSynced(rec, audioEl) {
    try {
      // 1) 믹서 정지
      if (typeof mixer.stop === 'function')       mixer.stop();
      else if (typeof mixer.pause === 'function') mixer.pause();

      audioEl.currentTime = 0;
      audioEl.preload = 'auto';
      await this._waitCanPlay(audioEl);

      // 2) 싱크 보정
      const offsetSec  = (this._syncOffsetMs || 0) / 1000;
      if (offsetSec > 0) audioEl.currentTime = offsetSec;
      const audioDelay = offsetSec < 0 ? Math.abs(offsetSec) * 1000 : 0;

      // 3) 믹서 시작 — 여러 API 패턴 시도
      const syncOffset = rec.startOffset || 0;
      const startMixer = () => {
        // 패턴 A: seek(offset) + play() — 메인 mixer.js 방식
        if (typeof mixer.seek === 'function' && typeof mixer.play === 'function') {
          mixer.seek(syncOffset);
          mixer.play(syncOffset);
          if (window.UI?.setTransportState) UI.setTransportState('playing');
          console.log('[RecordingsUI] 믹서 시작: seek+play(offset)');
          return;
        }
        // 패턴 B: play(offset)만
        if (typeof mixer.play === 'function') {
          try { mixer.play(syncOffset); if (window.UI?.setTransportState) UI.setTransportState('playing'); console.log('[RecordingsUI] 믹서 시작: play(offset)'); return; } catch {}
        }
        // 패턴 C: 기타
        const setters = ['setCurrentTime','setPosition','seek'];
        for (const fn of setters) {
          if (typeof mixer[fn] === 'function') {
            mixer[fn](syncOffset);
            mixer.play?.();
            if (window.UI?.setTransportState) UI.setTransportState('playing');
            console.log('[RecordingsUI] 믹서 시작:', fn + '+play');
            return;
          }
        }
        console.warn('[RecordingsUI] 믹서 재생 API 없음. 사용 가능 메서드:', Object.getOwnPropertyNames(Object.getPrototypeOf(mixer)).filter(k => typeof mixer[k]==='function'));
        UI?.toast?.('⚠️ 원곡 재생 실패 — 콘솔 확인');
      };

      // 4) requestAnimationFrame으로 동시 시작
      const startAudio = () => audioEl.play().catch(e => console.warn('[RecordingsUI] 녹음 재생 실패:', e));
      requestAnimationFrame(() => {
        if (audioDelay > 0) {
          startMixer();
          setTimeout(startAudio, audioDelay);
        } else {
          startAudio();
          startMixer();
        }
      });

      UI?.toast?.(`🎧 싱크 재생 — ${rec.songTitle} (보정 ${this._syncOffsetMs >= 0 ? '+' : ''}${this._syncOffsetMs}ms)`, 3000);

    } catch (e) {
      console.error('[RecordingsUI] 싱크 재생 오류:', e);
      audioEl.play().catch(() => {});
    }
  },
  /* ── 녹음 오디오 재생 준비 대기 ── */
  _waitCanPlay(audioEl) {
    return new Promise(resolve => {
      if (audioEl.readyState >= 3) return resolve();
      const onReady = () => {
        audioEl.removeEventListener('canplay', onReady);
        resolve();
      };
      audioEl.addEventListener('canplay', onReady);
      setTimeout(resolve, 1500); // 타임아웃 안전장치
    });
  },

  /* ── 현재 로드된 트랙 시그니처 ── */
  _getCurrentTrackSig() {
    try {
      const tracks = (typeof mixer !== 'undefined' ? mixer?.tracks : null) || [];
      return tracks.map(t => t.info?.file || t.info?.name || '').join('|');
    } catch { return null; }
  },

  /* ── 현재 곡 식별 키 ── */
  _getCurrentSongKey() {
    try {
      const sid = window.currentService?.id || 'unknown';
      const t   = window.currentTeamIdx ?? 0;
      const s   = window.currentSongIdx ?? 0;
      return `${sid}_t${t}_s${s}`;
    } catch { return null; }
  },


  /* ── 녹음 시점 믹스 상태 복원 ── */
  _restoreMixSnapshot(snapshot) {
    if (!snapshot || typeof mixer === 'undefined' || !mixer?.tracks) return;
    snapshot.forEach(saved => {
      const t = mixer.tracks[saved.idx];
      if (!t) return;
      try {
        // mute
        if (typeof mixer.muteTrack === 'function') mixer.muteTrack(saved.idx, saved.muted);
        else t.muted = saved.muted;
        // solo
        if (typeof mixer.soloTrack === 'function') mixer.soloTrack(saved.idx, saved.solo);
        else t.solo = saved.solo;
        // volume
        if (typeof mixer.setTrackVolumeDb === 'function') mixer.setTrackVolumeDb(saved.idx, saved.volumeDb ?? 0);
        else if (t.gain?.gain) t.gain.gain.value = saved.gain ?? 1.0;
        // pan
        if (typeof mixer.setTrackPan === 'function') mixer.setTrackPan(saved.idx, saved.pan ?? 0);
      } catch (e) { console.warn('[RecordingsUI] 채널', saved.idx, '복원 실패:', e); }
    });
    console.log('[RecordingsUI] 믹스 스냅샷 복원 완료');
  },

  /* ── 모든 재생 중지 ── */
  _stopPlayback() {
    if (this._audioEl) {
      this._audioEl.pause();
      this._audioEl.classList.add('hidden');
      this._audioEl.removeAttribute('src');
      this._audioEl = null;
    }
    this._modal?.querySelectorAll('.rec-item-audio').forEach(a => {
      a.pause();
      a.classList.add('hidden');
      a.removeAttribute('src');
    });
  },

  /* ── 다운로드 ── */
  async _download(id) {
    const rec = await RecorderDB.get(id);
    if (!rec) return;

    const ext  = rec.mimeType?.includes('webm') ? 'webm'
               : rec.mimeType?.includes('mp4')  ? 'm4a'
               : rec.mimeType?.includes('ogg')  ? 'ogg'
               : 'audio';
    const safe = rec.songTitle.replace(/[/\\?%*:|"<>]/g, '_');
    const date = this._fmtDate(rec.timestamp).replace(/[:\s/]/g, '-');
    const name = `${safe}_${rec.channelName}_${date}.${ext}`;

    const url = URL.createObjectURL(rec.blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  },

  /* ── 삭제 ── */
  async _delete(id) {
    if (!confirm('이 녹음을 삭제하시겠습니까?')) return;
    await RecorderDB.delete(id);
    await this._render();
  },

  /* ── 유틸 ── */
  _fmtDur(sec) {
    if (!sec || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  },

  _fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ` +
           `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
  },

  _esc(s) {
    return String(s ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  },
};

window.RecordingsUI = RecordingsUI;

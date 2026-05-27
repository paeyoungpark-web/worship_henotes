/**
 * recordings-ui.js — 녹음 목록 모달 + 재생 (원곡 동기 재생 옵션)
 *
 * 브랜치: feature/레코딩연습 (가능성 테스트)
 * 의존성: RecorderDB(recorder.js), mixer(전역), UI(전역)
 */
const RecordingsUI = {
  _modal:    null,
  _audioEl:  null,
  _syncMode: true,   // 원곡과 동시 재생 여부

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

    document.getElementById('rec-close-btn')
      .addEventListener('click', () => this.close());

    this._modal.addEventListener('click', e => {
      if (e.target === this._modal) this.close();
    });

    document.getElementById('rec-sync-cb')
      .addEventListener('change', e => { this._syncMode = e.target.checked; });
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
      if (s) {
        const usedMB  = (s.usage  / 1024 / 1024).toFixed(1);
        const totalGB = (s.quota  / 1024 / 1024 / 1024).toFixed(1);
        info.textContent =
          `💾 ${usedMB} MB 사용 / ${totalGB} GB · 총 ${recs.length}개 녹음`;
      } else {
        info.textContent = `총 ${recs.length}개 녹음`;
      }
    }

    if (!recs.length) {
      list.innerHTML = `
        <div class="rec-empty">
          아직 녹음이 없습니다.<br>
          곡 재생 중 🔴 <strong>REC</strong> 버튼을 눌러 녹음을 시작하세요.
        </div>`;
      return;
    }

    list.innerHTML = recs.map(r => `
      <div class="rec-item" data-id="${r.id}">
        <div class="rec-item-info">
          <div class="rec-item-title">${this._esc(r.songTitle)}</div>
          <div class="rec-item-meta">
            <span>🎤 ${this._esc(r.channelName)}</span>
            <span>⏱ ${this._fmtDur(r.duration)}</span>
            <span>📅 ${this._fmtDate(r.timestamp)}</span>
            <span>💾 ${(r.size / 1024 / 1024).toFixed(2)} MB</span>
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
      </div>`).join('');

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

    // 원곡 동기 재생 모드
    if (this._syncMode && window.mixer && window.currentService) {
      const sameSong =
        rec.serviceId === window.currentService?.id &&
        rec.songIdx   === window.currentSongIdx;

      if (sameSong) {
        try {
          window.mixer.stop();
          window.mixer.seek(rec.startOffset);
          window.mixer.play(rec.startOffset);
          if (window.UI?.setTransportState) UI.setTransportState('playing');
        } catch (e) {
          console.warn('[RecordingsUI] 원곡 동기 실패:', e);
        }
      } else {
        UI?.toast?.('ℹ️ 다른 곡 녹음 — 녹음만 재생합니다');
      }
    }

    // 녹음 재생
    const audioEl = this._modal.querySelector(`audio[data-id="${id}"]`);
    if (!audioEl) return;

    const url = URL.createObjectURL(rec.blob);
    audioEl.src = url;
    audioEl.classList.remove('hidden');
    audioEl.play().catch(e => console.warn('[RecordingsUI] 재생 실패:', e));
    this._audioEl = audioEl;

    audioEl.onended = () => {
      URL.revokeObjectURL(url);
      if (this._syncMode && window.mixer) {
        try { window.mixer.pause(); if (window.UI?.setTransportState) UI.setTransportState('paused'); }
        catch {}
      }
    };
  },

  /* ── 모든 재생 중지 ── */
  _stopPlayback() {
    if (this._audioEl) {
      this._audioEl.pause();
      this._audioEl.classList.add('hidden');
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
    const date = this._fmtDate(rec.timestamp).replace(/[:\s]/g, '-');
    const name = `${safe}_${this._esc(rec.channelName)}_${date}.${ext}`;

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

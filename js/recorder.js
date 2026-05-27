/**
 * recorder.js — 마이크 더빙 녹음 + IndexedDB 저장
 *
 * 브랜치: feature/레코딩연습
 * - 곡 선택 여부와 무관하게 언제든 녹음 가능
 * - 곡이 로드된 경우 타임라인(startOffset) + trackSig 저장
 * - 재생 시 trackSig 일치 여부로 원곡 싱크 재생 판정
 * mixer.js / visualizer.js 수정 없음
 */

/* ═══════════════════════════════════════
   IndexedDB 저장소
═══════════════════════════════════════ */
const RecorderDB = {
  _db: null,
  DB_NAME: 'worship_recordings',
  STORE:   'recordings',
  VERSION: 1,

  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          const store = db.createObjectStore(this.STORE, { keyPath: 'id' });
          store.createIndex('byDate', 'timestamp', { unique: false });
          store.createIndex('bySong', 'songId',    { unique: false });
        }
      };
    });
  },

  async save(record) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).put(record);
      tx.oncomplete = () => resolve(record.id);
      tx.onerror    = () => reject(tx.error);
    });
  },

  async getAll() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).getAll();
      req.onsuccess = () =>
        resolve((req.result || []).sort((a, b) => b.timestamp - a.timestamp));
      req.onerror = () => reject(req.error);
    });
  },

  async get(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },

  async delete(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  },

  async getStorageInfo() {
    if (!navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota, percent: (usage / quota * 100).toFixed(1) };
  },
};

/* ═══════════════════════════════════════
   Recorder
═══════════════════════════════════════ */
const Recorder = {
  _state: {
    isRecording:   false,
    mediaRecorder: null,
    stream:        null,
    chunks:        [],
    startOffset:   0,
    startWallTime: 0,
    songSnapshot:  null,
    ledTimer:      null,
    stateWatcher:  null,
  },

  /* ── REC 버튼 활성화 상태 동기화 ── */
  syncButtonState() {
    const btn = document.getElementById('rec-btn');
    if (!btn) return;
    if (this._state.isRecording) {
      btn.disabled = false;
      btn.classList.remove('disabled');
      btn.title = '녹음 정지 (R)';
      return;
    }
    const canRecord = !!(window.mixer?.isPlaying);
    btn.disabled = !canRecord;
    btn.classList.toggle('disabled', !canRecord);
    btn.title = canRecord ? '녹음 시작 (R)' : '⚠️ 곡을 먼저 재생하세요';
  },

  startStateWatcher() {
    // 폴링 방식 제거 — 버튼 항상 활성화, start() 클릭 시점에 가드
    // (window.mixer가 지역변수라 window.mixer.isPlaying 참조 불가)
  },

  stopStateWatcher() {
    clearInterval(this._state.stateWatcher);
    this._state.stateWatcher = null;
  },

  /* ── REC 버튼 토글 ── */
  async toggle() {
    if (this._state.isRecording) await this.stop();
    else                          await this.start();
  },

  /* ── 녹음 시작 — 곡 선택 여부와 무관하게 즉시 동작 ── */
  async start() {
    if (this._state.isRecording) return;

    // 🎧 헤드셋 착용 경고 (항상 표시)
    this._showHeadphoneWarning();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl:  false,
          sampleRate:       44100,
        },
      });

      const mimeType = this._pickMimeType();
      let mr;
      try {
        mr = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 });
      } catch {
        mr = new MediaRecorder(stream);
      }

      this._state.chunks = [];
      mr.ondataavailable = e => {
        if (e.data?.size > 0) this._state.chunks.push(e.data);
      };
      mr.onstop = () => this._onStop(mr.mimeType || mimeType);

      // 현재 재생 위치 — 안전하게 캡처 (없으면 0)
      let offset = 0;
      try {
        if (typeof mixer !== 'undefined' && mixer?.getCurrentTime) {
          offset = mixer.getCurrentTime() || 0;
        }
      } catch { offset = 0; }

      // 곡 정보 — 안전하게 캡처 (없으면 기본값)
      this._state.songSnapshot = {
        serviceId:   window.currentService?.id   ?? null,
        teamIdx:     window.currentTeamIdx       ?? 0,
        songIdx:     window.currentSongIdx       ?? 0,
        songTitle:   window.currentSongData?.title ?? window.currentSongTitle ?? '제목 없음',
        channelIdx:  window.myPartIdx            ?? -1,
        channelName: this._getChannelName(),
        trackSig:    this._getTrackSig(),
        songKey:     this._getSongKey(),           // 곡 식별 고유 키
        mixSnapshot: this._captureMixSnapshot(),  // 녹음 시점 믹스 상태
      };

      this._state.startOffset   = offset;
      this._state.startWallTime = Date.now();
      this._state.stream        = stream;
      this._state.mediaRecorder = mr;
      this._state.isRecording   = true;

      mr.start(1000);
      this._setRecUI(true);
      this._setupLevelMeter(stream);  // 입력 레벨 미터 시작

      this._toast(`🔴 녹음 시작 (${this._fmtTime(offset)}부터)`);

    } catch (err) {
      console.error('[Recorder] 시작 실패:', err);
      if (err.name === 'NotAllowedError') {
        this._toast('❌ 마이크 권한이 필요합니다');
      } else if (err.name === 'NotFoundError') {
        this._toast('❌ 마이크를 찾을 수 없습니다');
      } else {
        this._toast('❌ 녹음 시작 실패: ' + err.message);
      }
    }
    },

  /* ── 헤드셋 경고 모달 ── */
  _showHeadphoneWarning() {
    // 기존 경고가 있으면 제거
    document.getElementById('headphone-warning')?.remove();

    const el = document.createElement('div');
    el.id        = 'headphone-warning';
    el.className = 'headphone-warning';
    el.innerHTML = `
      <div class="headphone-warning-box">
        <div class="headphone-icon">🎧</div>
        <div class="headphone-title">헤드셋 착용 확인</div>
        <div class="headphone-msg">
          스피커로 재생 시 마이크가 소리를 다시 녹음해<br>
          <strong>피드백 루프(하울링)</strong>가 발생합니다.<br>
          반드시 <strong>헤드셋/이어폰</strong>을 착용해주세요.
        </div>
        <div class="headphone-actions">
          <button id="headphone-ok" class="headphone-btn-ok">✅ 착용했습니다 — 녹음 시작</button>
          <button id="headphone-cancel" class="headphone-btn-cancel">취소</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    // 확인 → 녹음 시작 (이미 진입 전 호출이므로 단순 닫기)
    document.getElementById('headphone-ok').addEventListener('click', () => el.remove());
    document.getElementById('headphone-cancel').addEventListener('click', () => {
      el.remove();
      // 취소 플래그 — _start 내부에서 처리하지 않고 별도 토글 방식이므로
      // 이미 시작된 경우 stop() 호출
      if (this._state.isRecording) this.stop();
    });

    // 배경 클릭으로 닫기
    el.addEventListener('click', e => { if (e.target === el) el.remove(); });
  },

  /* ── 녹음 종료 ── */
  async stop() {
    if (!this._state.isRecording) return;
    const mr = this._state.mediaRecorder;
    if (mr && mr.state !== 'inactive') mr.stop();
  },

  /* ── 녹음 종료 후 처리 ── */
  _onStop(mimeType) {
    const blob     = new Blob(this._state.chunks, { type: mimeType });
    const duration = (Date.now() - this._state.startWallTime) / 1000;

    this._state.stream?.getTracks().forEach(t => t.stop());
    this._stopLevelMeter();  // 레벨미터 정지

    const snap   = this._state.songSnapshot;
    const record = {
      id:          'rec_' + Date.now(),
      timestamp:   Date.now(),
      serviceId:   snap.serviceId,
      teamIdx:     snap.teamIdx,
      songIdx:     snap.songIdx,
      songTitle:   snap.songTitle,
      channelName: snap.channelName,
      channelIdx:  snap.channelIdx,
      trackSig:    snap.trackSig,
      songKey:     snap.songKey ?? null,
      mixSnapshot: snap.mixSnapshot ?? null,  // 녹음 시점 믹스 상태
      startOffset: this._state.startOffset,
      duration,
      mimeType,
      blob,
      size:        blob.size,
    };

    RecorderDB.save(record)
      .then(() => {
        const mb = (blob.size / 1024 / 1024).toFixed(1);
        this._toast(`💾 저장됨 — ${snap.songTitle} (${this._fmtTime(duration)}, ${mb}MB)`);
      })
      .catch(err => {
        console.error('[RecorderDB] 저장 실패:', err);
        this._toast('❌ 저장 실패: ' + err.message);
      });

    this._state.isRecording   = false;
    this._state.mediaRecorder = null;
    this._state.stream        = null;
    this._state.chunks        = [];
    this._setRecUI(false);
  },

  /* ── 코덱 자동 선택 ── */
  _pickMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const t of candidates) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  },

  /* ── 채널명 조회 ── */
  _getChannelName() {
    try {
      const idx = window.myPartIdx;
      if (idx == null || idx < 0) return '전체';
      if (typeof mixer !== 'undefined') {
        return mixer.tracks?.[idx]?.info?.name || `CH ${idx + 1}`;
      }
      return '전체';
    } catch { return '알 수 없음'; }
  },

  /* ── 트랙 시그니처 (원곡 싱크 판정용) ── */
  _getTrackSig() {
    try {
      const tracks = (typeof mixer !== 'undefined' ? mixer?.tracks : null) || [];
      if (!tracks.length) return null;
      return tracks.map(t => t.info?.file || t.info?.name || '').join('|');
    } catch { return null; }
  },

  /* ── 곡 식별 고유 키 (serviceId + teamIdx + songIdx) ── */
  _getSongKey() {
    try {
      const sid = window.currentService?.id || 'unknown';
      const t   = window.currentTeamIdx ?? 0;
      const s   = window.currentSongIdx ?? 0;
      return `${sid}_t${t}_s${s}`;
    } catch { return null; }
  },

  /* ── 녹음 시점 믹스 상태 캡처 ── */
  _captureMixSnapshot() {
    try {
      const tracks = (typeof mixer !== 'undefined' ? mixer?.tracks : null) || [];
      if (!tracks.length) return null;
      return tracks.map((t, idx) => ({
        idx,
        muted:  t.muted  ?? false,
        solo:   t.solo   ?? false,
        gain:   (t.gain?.gain?.value != null) ? t.gain.gain.value : 1.0,
        volumeDb: t.volumeDb ?? 0,
        pan:    t.panner?.pan?.value ?? 0,
      }));
    } catch (e) {
      console.warn('[Recorder] 믹스 스냅샷 캡처 실패:', e);
      return null;
    }
  },

  /* ── 입력 레벨미터 시작 ── */
  _setupLevelMeter(stream) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this._meterCtx = new Ctx({ latencyHint: 'interactive' });
      const src = this._meterCtx.createMediaStreamSource(stream);
      this._meterAnalyser = this._meterCtx.createAnalyser();
      this._meterAnalyser.fftSize = 512;
      src.connect(this._meterAnalyser);
      this._meterData = new Uint8Array(this._meterAnalyser.fftSize);

      const meter = document.getElementById('rec-input-meter');
      if (meter) meter.classList.remove('hidden');

      this._meterLoop();
    } catch (e) {
      console.warn('[Recorder] 레벨미터 초기화 실패:', e);
    }
  },

  _meterLoop() {
    if (!this._state.isRecording || !this._meterAnalyser) return;
    this._meterAnalyser.getByteTimeDomainData(this._meterData);

    let sum = 0;
    for (let i = 0; i < this._meterData.length; i++) {
      const v = (this._meterData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this._meterData.length);
    const db  = 20 * Math.log10(rms || 0.00001);
    const pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));

    const bar  = document.getElementById('rec-meter-bar');
    const dbEl = document.getElementById('rec-meter-db');
    if (bar) {
      bar.style.width = pct + '%';
      bar.style.background =
        db > -3  ? '#ff3030' :
        db > -12 ? '#f0a830' : '#4ade80';
    }
    if (dbEl) dbEl.textContent = db < -59 ? '-∞' : Math.round(db) + 'dB';

    this._meterRAF = requestAnimationFrame(() => this._meterLoop());
  },

  _stopLevelMeter() {
    if (this._meterRAF) cancelAnimationFrame(this._meterRAF);
    this._meterRAF = null;
    this._meterAnalyser = null;
    try { this._meterCtx?.close(); } catch {}
    this._meterCtx = null;
    const meter = document.getElementById('rec-input-meter');
    if (meter) meter.classList.add('hidden');
  },

  /* ── REC 버튼 + LED UI 업데이트 ── */
  _setRecUI(isRec) {
    const btn = document.getElementById('rec-btn');
    const led = document.getElementById('rec-led');

    if (btn) {
      btn.classList.toggle('recording', isRec);
      const lbl = btn.querySelector('.tr-label');
      if (lbl) lbl.textContent = isRec ? 'STOP' : 'REC';
    }
    if (led) led.classList.toggle('hidden', !isRec);

    clearInterval(this._state.ledTimer);
    if (isRec && led) {
      this._state.ledTimer = setInterval(() => {
        led.style.opacity = (led.style.opacity === '0.2') ? '1' : '0.2';
      }, 500);
    } else if (led) {
      led.style.opacity = '1';
    }
  },

  /* ── 토스트 ── */
  _toast(msg, dur) {
    if (window.UI?.toast) UI.toast(msg, dur);
    else console.log('[Recorder]', msg);
  },

  /* ── 시간 포맷 ── */
  _fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  },
};

window.Recorder   = Recorder;
window.RecorderDB = RecorderDB;

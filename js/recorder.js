/**
 * recorder.js — 마이크 더빙 녹음 + IndexedDB 저장
 *
 * 브랜치: feature/레코딩연습 (가능성 테스트)
 * 의존성: mixer(전역), UI(전역), currentService(전역)
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
  },

  /* ── REC 버튼 토글 ── */
  async toggle() {
    if (this._state.isRecording) await this.stop();
    else                          await this.start();
  },

  /* ── 녹음 시작 ── */
  async start() {
    if (this._state.isRecording) return;

    if (!window.mixer || !window.currentService) {
      this._toast('⚠️ 곡을 먼저 선택해주세요');
      return;
    }

    // 헤드폰 안내 (최초 1회)
    if (!sessionStorage.getItem('rec_headphone_ok')) {
      this._toast('🎧 헤드폰 필수! 스피커 사용 시 피드백 발생', 4000);
      sessionStorage.setItem('rec_headphone_ok', '1');
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,  // 원음 유지
          noiseSuppression: false,
          autoGainControl:  false,
          sampleRate:       44100,
        },
      });
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        this._toast('❌ 마이크 권한이 필요합니다');
      } else if (err.name === 'NotFoundError') {
        this._toast('❌ 마이크를 찾을 수 없습니다');
      } else {
        this._toast('❌ 녹음 시작 실패: ' + err.message);
      }
      return;
    }

    // 코덱 자동 선택
    const mimeType = this._pickMimeType();
    let mr;
    try {
      mr = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });
    } catch {
      mr = new MediaRecorder(stream);
    }

    this._state.chunks = [];
    mr.ondataavailable = e => {
      if (e.data?.size > 0) this._state.chunks.push(e.data);
    };
    mr.onstop = () => this._onStop(mr.mimeType || mimeType);

    // 재생 위치 캡처
    const offset = window.mixer.isPlaying
      ? window.mixer.getCurrentTime()
      : (window.mixer.pauseTime ?? 0);

    // 곡 스냅샷
    this._state.songSnapshot = {
      serviceId:     window.currentService?.id  ?? '',
      teamIdx:       window.currentTeamIdx      ?? 0,
      songIdx:       window.currentSongIdx      ?? 0,
      songTitle:     window.currentSongData?.title ?? window.currentSongTitle ?? '제목 없음',
      channelIdx:    window.myPartIdx           ?? -1,
      channelName:   this._getChannelName(),
    };

    this._state.startOffset   = offset;
    this._state.startWallTime = Date.now();
    this._state.stream        = stream;
    this._state.mediaRecorder = mr;
    this._state.isRecording   = true;

    mr.start(1000);  // 1초 단위 청크

    this._setRecUI(true);
    this._toast(`🔴 녹음 시작 (${this._fmtTime(offset)}부터)`);
  },

  /* ── 녹음 종료 ── */
  async stop() {
    if (!this._state.isRecording) return;
    const mr = this._state.mediaRecorder;
    if (mr && mr.state !== 'inactive') mr.stop();
    // _onStop 콜백에서 후처리
  },

  /* ── 녹음 종료 후 처리 ── */
  _onStop(mimeType) {
    const blob     = new Blob(this._state.chunks, { type: mimeType });
    const duration = (Date.now() - this._state.startWallTime) / 1000;

    // 마이크 스트림 해제
    this._state.stream?.getTracks().forEach(t => t.stop());

    const record = {
      id:          'rec_' + Date.now(),
      timestamp:   Date.now(),
      serviceId:   this._state.songSnapshot.serviceId,
      teamIdx:     this._state.songSnapshot.teamIdx,
      songIdx:     this._state.songSnapshot.songIdx,
      songTitle:   this._state.songSnapshot.songTitle,
      channelName: this._state.songSnapshot.channelName,
      channelIdx:  this._state.songSnapshot.channelIdx,
      startOffset: this._state.startOffset,
      duration,
      mimeType,
      blob,
      size:        blob.size,
    };

    RecorderDB.save(record)
      .then(() => {
        const mb = (blob.size / 1024 / 1024).toFixed(1);
        this._toast(`💾 저장됨 — ${record.songTitle} (${this._fmtTime(duration)}, ${mb}MB)`);
      })
      .catch(err => {
        console.error('[RecorderDB] 저장 실패:', err);
        this._toast('❌ 저장 실패: ' + err.message);
      });

    // 상태 초기화
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
      return window.mixer?.tracks?.[idx]?.info?.name || `CH ${idx + 1}`;
    } catch { return '알 수 없음'; }
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

    // LED 점멸
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

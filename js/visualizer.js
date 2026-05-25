/**
 * WorshipVisualizer — 5종 시각화 엔진
 *
 * 1. 🎵 스펙트럼 분석기 (FFT 막대 그래프)
 * 2. 📊 VU 피크홀드 미터
 * 3. 🎨 채널 발광 (Glow Pulse)
 * 4. 🌊 Three.js 3D 파형
 * 5. 🎤 MY CH 클로즈업 대형 VU 미터
 */
class WorshipVisualizer {
  constructor() {
    this.mixer        = null;
    this.myIdx        = -1;
    this.peaks        = [];       // 채널별 피크홀드 값
    this.peakTimers   = [];       // 피크 감쇠 타이머
    this.masterPeak   = 0;
    this.masterPeakTimer = null;

    // Three.js
    this.three = {
      scene: null, camera: null, renderer: null,
      line: null, points: null, animId: null,
      ready: false,
    };

    // 캔버스 컨텍스트
    this.specCtx    = null;
    this.vuCtx      = null;
    this.largeVuCtx = null;
  }

  /* ── 초기화 ── */
  init(mixer) {
    this.mixer = mixer;
  }

  /* ── MY CH 변경 ── */
  setMyChannel(idx) {
    this.myIdx = idx;
    const panel = document.getElementById('my-vis-panel');
    if (!panel) return;

    if (idx < 0) {
      panel.classList.add('hidden');
      this._destroyThree();
      return;
    }

    const t = this.mixer.tracks[idx];
    if (!t) return;

    // 패널 제목 업데이트
    const chNum = t.info.ch ? t.info.ch.toString().padStart(2,'0') : (idx+1).toString().padStart(2,'0');
    document.getElementById('my-vis-ch').textContent   = `CH ${chNum}`;
    document.getElementById('my-vis-name').textContent = t.info.name || '';

    panel.classList.remove('hidden');

    // 캔버스 초기화
    // rAF 한 텍 들려서 레이아웃 안정화 후 캐버스 설정
    requestAnimationFrame(() => {
      this._initCanvas('spec-canvas',    c => this.specCtx    = c);
      this._initCanvas('vu-canvas',      c => this.vuCtx      = c);
      this._initCanvas('large-vu-canvas',c => this.largeVuCtx = c);
    });

    // Three.js 초기화
    this._initThree();
  }

  _initCanvas(id, setter) {
    const el = document.getElementById(id);
    if (!el) return;
    el.width  = el.offsetWidth  * (window.devicePixelRatio || 1);
    el.height = el.offsetHeight * (window.devicePixelRatio || 1);
    setter(el.getContext('2d'));
  }

  /* ══════════════════════════════════════════
     🎵 스펙트럼 분석기
  ══════════════════════════════════════════ */
  _drawSpectrum() {
    const ctx = this.specCtx;
    if (!ctx || this.myIdx < 0) return;
    const t = this.mixer.tracks[this.myIdx];
    if (!t) return;

    const W = ctx.canvas.width;
    const H = ctx.canvas.height;

    t.analyser.fftSize = 1024;
    const bins = t.analyser.frequencyBinCount;
    const data = new Uint8Array(bins);
    t.analyser.getByteFrequencyData(data);

    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    // 주파수 구간별 색상 (저음=파랑, 중음=오렌지, 고음=빨강)
    const barW    = W / 80;
    const step    = Math.floor(bins / 80);
    const DPR     = window.devicePixelRatio || 1;

    for (let i = 0; i < 80; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += data[i * step + j];
      const avg = sum / step;
      const h   = (avg / 255) * H;
      const x   = i * (barW + 1 * DPR);

      // 색상: 저→중→고
      const hue = 200 - (i / 80) * 160;
      ctx.fillStyle = `hsl(${hue}, 90%, 55%)`;
      ctx.fillRect(x, H - h, barW, h);

      // 상단 하이라이트
      if (h > 2) {
        ctx.fillStyle = `hsl(${hue}, 100%, 80%)`;
        ctx.fillRect(x, H - h, barW, 2 * DPR);
      }
    }

    // 눈금선
    ctx.strokeStyle = '#2e3038';
    ctx.lineWidth   = 0.5;
    [0.25, 0.5, 0.75].forEach(p => {
      ctx.beginPath();
      ctx.moveTo(0, H * p);
      ctx.lineTo(W, H * p);
      ctx.stroke();
    });

    // 레이블
    ctx.fillStyle = '#8a8d96';
    ctx.font = `${10 * DPR}px monospace`;
    ctx.fillText('20', 2, H - 2);
    ctx.fillText('1kHz', W * 0.4, H - 2);
    ctx.fillText('20k', W - 24 * DPR, H - 2);
  }

  /* ══════════════════════════════════════════
     📊 VU 피크홀드 미터
  ══════════════════════════════════════════ */
  _drawVU() {
    const ctx = this.vuCtx;
    if (!ctx || this.myIdx < 0) return;
    const t = this.mixer.tracks[this.myIdx];
    if (!t) return;

    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const DPR = window.devicePixelRatio || 1;

    // 레벨 계산
    const data = new Uint8Array(t.analyser.frequencyBinCount);
    t.analyser.getByteFrequencyData(data);
    const level = data.reduce((a, v) => a + v, 0) / (data.length * 255);

    // 피크 홀드
    if (!this.myPeak) this.myPeak = 0;
    if (level > this.myPeak) {
      this.myPeak = level;
      clearTimeout(this._myPeakTimer);
      this._myPeakTimer = setTimeout(() => { this.myPeak = 0; }, 1500);
    }

    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    // 미터 바 (그라디언트)
    const grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0,    '#2ecc71');
    grad.addColorStop(0.65, '#2ecc71');
    grad.addColorStop(0.8,  '#f1c40f');
    grad.addColorStop(0.95, '#e74c3c');
    grad.addColorStop(1,    '#ff0000');

    const barH = level * H;
    ctx.fillStyle = grad;
    ctx.fillRect(W * 0.15, H - barH, W * 0.7, barH);

    // 피크 표시선
    if (this.myPeak > 0.01) {
      const peakY = H - this.myPeak * H;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(W * 0.1, peakY - 1.5 * DPR, W * 0.8, 3 * DPR);
    }

    // dB 눈금
    const dbMarks = [0, -3, -6, -12, -20, -40];
    ctx.fillStyle  = '#8a8d96';
    ctx.font       = `${9 * DPR}px monospace`;
    ctx.textAlign  = 'right';
    dbMarks.forEach(db => {
      const lin = db <= -60 ? 0 : Math.pow(10, db / 20);
      const y   = H - lin * H;
      ctx.fillStyle   = db >= -3 ? '#e74c3c' : '#8a8d96';
      ctx.fillText(db === 0 ? '0' : db.toString(), W - 2, y + 4 * DPR);
      ctx.strokeStyle = '#2e3038';
      ctx.lineWidth   = 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W * 0.85, y); ctx.stroke();
    });
    ctx.textAlign = 'left';
  }

  /* ══════════════════════════════════════════
     🎤 대형 클로즈업 VU 미터 (가로형)
  ══════════════════════════════════════════ */
  _drawLargeVU() {
    const ctx = this.largeVuCtx;
    if (!ctx || this.myIdx < 0) return;
    const t = this.mixer.tracks[this.myIdx];
    if (!t) return;

    const W   = ctx.canvas.width;
    const H   = ctx.canvas.height;
    const DPR = window.devicePixelRatio || 1;

    const data = new Uint8Array(t.analyser.frequencyBinCount);
    t.analyser.getByteFrequencyData(data);
    const level = data.reduce((a, v) => a + v, 0) / (data.length * 255);

    // 피크
    if (!this.largePeak) this.largePeak = 0;
    if (level > this.largePeak) {
      this.largePeak = level;
      clearTimeout(this._largePeakTimer);
      this._largePeakTimer = setTimeout(() => { this.largePeak = 0; }, 2000);
    }

    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    // dB 눈금 그리기
    const MARKS = [
      { db: -40, label: '-40' }, { db: -20, label: '-20' },
      { db: -12, label: '-12' }, { db: -6,  label: '-6'  },
      { db: -3,  label: '-3'  }, { db: 0,   label: '0'   },
      { db: 3,   label: '+3'  }, { db: 6,   label: '+6'  },
    ];
    const dbToX = db => {
      const lin = db <= -60 ? 0 : Math.pow(10, db / 20);
      return lin * (W * 0.85);
    };

    const BAR_Y = H * 0.25;
    const BAR_H = H * 0.45;

    // 미터 바
    const grad = ctx.createLinearGradient(0, 0, W * 0.85, 0);
    grad.addColorStop(0,    '#2ecc71');
    grad.addColorStop(0.7,  '#2ecc71');
    grad.addColorStop(0.85, '#f1c40f');
    grad.addColorStop(0.95, '#e74c3c');
    grad.addColorStop(1,    '#ff0000');

    ctx.fillStyle = '#111';
    ctx.fillRect(0, BAR_Y, W * 0.85, BAR_H);
    ctx.fillStyle = grad;
    ctx.fillRect(0, BAR_Y, level * W * 0.85, BAR_H);

    // 피크 표시
    if (this.largePeak > 0.01) {
      const px = this.largePeak * W * 0.85;
      ctx.fillStyle = '#fff';
      ctx.fillRect(px - 2 * DPR, BAR_Y, 4 * DPR, BAR_H);
    }

    // 눈금 + 레이블
    MARKS.forEach(({ db, label }) => {
      const x = dbToX(db === 0 ? 1 : Math.pow(10, db / 20));
      const xActual = db <= -60 ? 0 : (db === 0 ? W * 0.85 * 1 : dbToX(db));
      const realX = db <= -60 ? 0 : (Math.pow(10, db / 20)) * (W * 0.85);

      ctx.strokeStyle = db >= 0 ? '#e74c3c' : '#3a3d47';
      ctx.lineWidth   = db === 0 ? 2 * DPR : 1;
      ctx.beginPath(); ctx.moveTo(realX, BAR_Y - 4 * DPR); ctx.lineTo(realX, BAR_Y + BAR_H + 4 * DPR); ctx.stroke();

      ctx.fillStyle  = db >= 0 ? '#e74c3c' : '#8a8d96';
      ctx.font       = `${10 * DPR}px monospace`;
      ctx.textAlign  = 'center';
      ctx.fillText(label, realX, BAR_Y + BAR_H + 16 * DPR);
    });

    // 현재 dB 값 표시
    const currentDb = level > 0.001 ? (20 * Math.log10(level)).toFixed(1) : '-∞';
    ctx.fillStyle = level > 0.85 ? '#e74c3c' : level > 0.65 ? '#f1c40f' : '#2ecc71';
    ctx.font      = `bold ${18 * DPR}px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(`${currentDb} dB`, W - 4, H * 0.18);

    ctx.textAlign = 'left';
  }

  /* ══════════════════════════════════════════
     🎨 채널 발광 (Glow Pulse)
  ══════════════════════════════════════════ */
  _updateGlow() {
    const strips = document.querySelectorAll('.channel-strip');
    strips.forEach(strip => {
      const idx   = +strip.dataset.idx;
      const t     = this.mixer.tracks[idx];
      if (!t || t.muted) {
        strip.style.boxShadow = '';
        return;
      }
      const level = this.mixer.getTrackLevel(idx);
      if (level < 0.02) {
        strip.style.boxShadow = idx === this.myIdx
          ? '0 0 0 1px #ff8c1a, 0 0 14px rgba(255,140,26,0.25)' : '';
        return;
      }

      // 그룹별 발광 색상
      const group = t.info.group || 'other';
      const glowColor = {
        pastor:      `255,200,0`,
        leader:      `255,140,26`,
        vocal_left:  `248,113,113`,
        vocal_right: `192,132,252`,
        keys:        `167,100,255`,
        bass:        `59,130,246`,
        guitar:      `94,201,139`,
        drums:       `94,139,255`,
      }[group] || `255,255,255`;

      const intensity = Math.min(level * 3, 1);
      const spread    = Math.round(intensity * 16);
      const alpha     = (intensity * 0.7).toFixed(2);

      strip.style.boxShadow = idx === this.myIdx
        ? `0 0 0 1px rgb(${glowColor}), 0 0 ${spread}px rgba(${glowColor},${alpha})`
        : `0 0 ${spread}px rgba(${glowColor},${alpha})`;
    });
  }

  /* ══════════════════════════════════════════
     🌊 Three.js 3D 파형
  ══════════════════════════════════════════ */
  _initThree() {
    if (!window.THREE) {
      console.warn('Three.js 없음, 3D 파형 건너뜀');
      return;
    }
    const container = document.getElementById('three-container');
    if (!container) return;

    // 이전 씬 정리
    this._destroyThree();

    const W = container.offsetWidth;
    const H = container.offsetHeight;

    // Scene
    const scene    = new THREE.Scene();
    const camera   = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 1.5, 3.5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a0c, 1);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 배경 그리드
    const grid = new THREE.GridHelper(10, 20, 0x2e3038, 0x1a1c22);
    grid.position.y = -0.8;
    scene.add(grid);

    // 파형 라인 (1024 포인트)
    const N = 512;
    const positions = new Float32Array(N * 3);
    const geometry  = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // 오렌지 라인
    const material = new THREE.LineBasicMaterial({
      color: 0xff8c1a,
      linewidth: 2,
    });
    const line = new THREE.Line(geometry, material);
    scene.add(line);

    // 이력 리본 (이전 프레임들을 뒤로 이동)
    const HISTORY = 30;
    const ribbonGeo  = new THREE.BufferGeometry();
    const ribbonPos  = new Float32Array(N * HISTORY * 3);
    ribbonGeo.setAttribute('position', new THREE.BufferAttribute(ribbonPos, 3));
    const ribbonMat  = new THREE.LineBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.15 });
    this.three.historyLines = [];
    this.three.historyData  = [];

    // 파티클 (음악 반응)
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) {
      particlePos[i*3]   = (Math.random() - 0.5) * 8;
      particlePos[i*3+1] = (Math.random() - 0.5) * 4;
      particlePos[i*3+2] = (Math.random() - 0.5) * 4 - 1;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    const particleMat = new THREE.PointsMaterial({ color: 0xff8c1a, size: 0.04, transparent: true, opacity: 0.4 });
    const particles   = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    this.three = { scene, camera, renderer, line, geometry, particles, particleGeo, ready: true, animId: null, frame: 0 };

    this._animateThree();
  }

  _animateThree() {
    if (!this.three.ready) return;
    const t   = this.mixer.tracks[this.myIdx];
    const N   = 512;
    this.three.frame = (this.three.frame || 0) + 1;

    if (t && this.mixer.isPlaying) {
      t.analyser.fftSize = 1024;
      const data = new Uint8Array(t.analyser.fftSize);
      t.analyser.getByteTimeDomainData(data);

      const pos = this.three.geometry.attributes.position;
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 4 - 2;
        const y = ((data[i * 2] / 128.0) - 1) * 1.2;
        pos.setXYZ(i, x, y, 0);
      }
      pos.needsUpdate = true;

      // 파티클 반응 (레벨에 따라 흔들림)
      const level = this.mixer.getTrackLevel(this.myIdx);
      const pPos  = this.three.particleGeo.attributes.position;
      for (let i = 0; i < 200; i++) {
        const px = pPos.getX(i) + (Math.random() - 0.5) * level * 0.05;
        const py = pPos.getY(i) + (Math.random() - 0.5) * level * 0.05;
        pPos.setXY(i, px * 0.998, py * 0.998);
      }
      pPos.needsUpdate = true;
      this.three.particles.material.opacity = 0.2 + level * 0.6;
    }

    // 카메라 천천히 회전
    const angle = this.three.frame * 0.003;
    this.three.camera.position.x = Math.sin(angle) * 3.5;
    this.three.camera.position.z = Math.cos(angle) * 3.5;
    this.three.camera.lookAt(0, 0, 0);

    this.three.renderer.render(this.three.scene, this.three.camera);
    this.three.animId = requestAnimationFrame(() => this._animateThree());
  }

  _destroyThree() {
    if (this.three.animId) { cancelAnimationFrame(this.three.animId); }
    if (this.three.renderer) {
      this.three.renderer.dispose();
      const c = this.three.renderer.domElement;
      if (c.parentNode) c.parentNode.removeChild(c);
    }
    this.three = { scene:null, camera:null, renderer:null, line:null, geometry:null, particles:null, particleGeo:null, ready:false, animId:null, frame:0 };
  }

  /* ══════════════════════════════════════════
     메인 업데이트 (app.js 루프에서 호출)
  ══════════════════════════════════════════ */
  update() {
    if (!this.mixer) return;

    // 채널 발광은 항상 업데이트
    this._updateGlow();

    // MY CH 패널이 열려있을 때만
    if (this.myIdx < 0 || !this.mixer.tracks[this.myIdx]) return;
    if (document.getElementById('my-vis-panel')?.classList.contains('hidden')) return;

    this._drawSpectrum();
    this._drawVU();
    this._drawLargeVU();
    // Three.js는 자체 rAF 루프로 동작 (별도 호출 불필요)
  }

  /* 마스터 파형 (상단 캔버스) */
  static drawMasterWaveform(mixer) {
    const canvas = document.getElementById('waveform-canvas');
    if (!canvas) return;

    const ctx = canvas.__ctx || (canvas.__ctx = (() => {
      canvas.width  = canvas.offsetWidth  * (window.devicePixelRatio || 1);
      canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
      return canvas.getContext('2d');
    })());

    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    if (!mixer.isPlaying || !mixer.masterAnalyser) {
      ctx.strokeStyle = '#2e3038';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
      return;
    }

    mixer.masterAnalyser.fftSize = 1024;
    const data = new Uint8Array(mixer.masterAnalyser.fftSize);
    mixer.masterAnalyser.getByteTimeDomainData(data);

    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0,   'rgba(255,140,26,0.3)');
    grad.addColorStop(0.5, 'rgba(255,140,26,1)');
    grad.addColorStop(1,   'rgba(255,140,26,0.3)');

    ctx.strokeStyle = grad;
    ctx.lineWidth   = 1.5 * (window.devicePixelRatio || 1);
    ctx.beginPath();

    const step = W / data.length;
    for (let i = 0; i < data.length; i++) {
      const x = i * step;
      const y = ((data[i] / 128.0) - 1) * H * 0.42 + H / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 재생 위치 인디케이터
    if (mixer.songDuration > 0) {
      const x = (mixer.getCurrentTime() / mixer.songDuration) * W;
      ctx.strokeStyle = '#ff8c1a';
      ctx.lineWidth   = 2 * (window.devicePixelRatio || 1);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
  }
}

window.WorshipVisualizer = WorshipVisualizer;

/**
 * WorshipVisualizer — 전문가급 시각화 엔진
 *
 * 1. 🎵 SPECTRUM  — FFT 막대 그래프 (저음→고음 색상 그라데이션 + 그리드)
 * 2. 🎯 VU METER  — 아날로그 바늘 + 베이지 패널 + 빨간 존 + 피크홀드 + CLIP LED
 * 3. ⚡ PEAK      — 20세그먼트 LED + 피크홀드 라인 + 현재 dB 큰 글씨
 * 4. 🎨 GLOW PULSE — 채널 스트립 발광
 * 5. 🌊 MASTER WAVEFORM — 상단 오렌지 파형
 */
class WorshipVisualizer {
  constructor() {
    this.mixer   = null;
    this.myIdx   = -1;

    // 캔버스 컨텍스트
    this.specCtx     = null;  // SPECTRUM
    this.vuCtx       = null;  // 아날로그 VU 바늘
    this.largeVuCtx  = null;  // LED 피크

    // ── 아날로그 VU 바늘 상태 ──
    this.needleAngle  = -60;  // 현재 각도 (deg)
    this.needleTarget = -60;  // 목표 각도
    this.peakHold     = -60;  // 피크홀드 각도
    this.peakHoldTimer = null;
    this.clipping     = false;
    this.clipTimer    = null;

    // ── LED 피크 미터 상태 ──
    this.ledLevel     = 0;
    this.ledPeak      = 0;
    this.ledPeakTimer = null;
  }

  init(mixer) { this.mixer = mixer; }

  setMyChannel(idx) {
    this.myIdx = idx;
    const panel = document.getElementById('my-vis-panel');
    if (!panel) return;

    if (idx < 0) { panel.classList.add('hidden'); return; }
    const t = this.mixer.tracks[idx];
    if (!t) return;

    const chNum = t.info.ch
      ? t.info.ch.toString().padStart(2, '0')
      : (idx + 1).toString().padStart(2, '0');
    document.getElementById('my-vis-ch').textContent   = `CH ${chNum}`;
    document.getElementById('my-vis-name').textContent = t.info.name || '';
    panel.classList.remove('hidden');

    // 캔버스 크기 초기화 (레이아웃 확정 후)
    requestAnimationFrame(() => {
      this._initCanvas('spec-canvas',     c => { this.specCtx    = c; });
      this._initCanvas('vu-canvas',       c => { this.vuCtx      = c; });
      this._initCanvas('large-vu-canvas', c => { this.largeVuCtx = c; });
    });

    // 상태 리셋
    this.needleAngle  = -60;
    this.needleTarget = -60;
    this.peakHold     = -60;
    this.ledLevel     = 0;
    this.ledPeak      = 0;
  }

  _initCanvas(id, setter) {
    const el = document.getElementById(id);
    if (!el) return;
    const dpr  = window.devicePixelRatio || 1;
    el.width   = el.offsetWidth  * dpr;
    el.height  = el.offsetHeight * dpr;
    setter(el.getContext('2d'));
  }

  /* ── 채널 RMS dB 계산 (VU 미터 표준) ── */
  _calcDb(track) {
    if (!track || !track.analyser) return -60;
    const buf = new Uint8Array(track.analyser.fftSize);
    track.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const a = (buf[i] - 128) / 128;
      sum += a * a;
    }
    const rms = Math.sqrt(sum / buf.length);
    const db  = rms > 0 ? 20 * Math.log10(rms) : -60;
    return Math.max(db, -60);
  }

  /* ══════════════════════════════════════════════
     🎵 SPECTRUM — FFT 막대 (64개, 색상 그라데이션)
  ══════════════════════════════════════════════ */
  _drawSpectrum() {
    const ctx = this.specCtx;
    if (!ctx || this.myIdx < 0) return;
    const t = this.mixer.tracks[this.myIdx];
    if (!t) return;

    const W   = ctx.canvas.width;
    const H   = ctx.canvas.height;
    const DPR = window.devicePixelRatio || 1;

    t.analyser.fftSize = 1024;
    const bins = t.analyser.frequencyBinCount;
    const data = new Uint8Array(bins);
    t.analyser.getByteFrequencyData(data);

    // 배경
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    // 그리드 라인
    ctx.strokeStyle = 'rgba(255,140,26,0.08)';
    ctx.lineWidth   = 0.5;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0,     H * (i / 4));
      ctx.lineTo(W,     H * (i / 4));
      ctx.stroke();
    }

    const NUM_BARS = 64;
    const barW     = (W / NUM_BARS) * 0.82;
    const gap      = (W / NUM_BARS) * 0.18;
    const step     = Math.floor(bins / NUM_BARS);

    for (let i = 0; i < NUM_BARS; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += data[i * step + j];
      const avg = sum / step;
      const h   = (avg / 255) * H * 0.95;
      const x   = i * (barW + gap);

      // 저음=파랑, 고음=빨강 색상 그라데이션
      const hue = 200 - (i / NUM_BARS) * 200;
      const lit = 50 + (avg / 255) * 15;
      ctx.fillStyle = `hsl(${hue}, 90%, ${lit}%)`;
      ctx.fillRect(x, H - h, barW, h);

      // 상단 글로우 픽셀
      if (h > 3) {
        ctx.fillStyle = `hsla(${hue}, 100%, 80%, 0.9)`;
        ctx.fillRect(x, H - h, barW, 2 * DPR);
      }
    }
  }

  /* ══════════════════════════════════════════════
     🎯 ANALOG VU METER
     - 베이지 패널 + 곡선 눈금 + 빨간 존
     - lerp 감쇠 바늘 + 피크홀드 노란 마커
     - CLIP LED (좌상단)
  ══════════════════════════════════════════════ */
  _drawAnalogVU() {
    const ctx = this.vuCtx;
    if (!ctx || this.myIdx < 0) return;
    const t = this.mixer.tracks[this.myIdx];
    if (!t) return;

    const W   = ctx.canvas.width;
    const H   = ctx.canvas.height;
    const DPR = window.devicePixelRatio || 1;

    // ── dB 계산 ──
    const db = this._calcDb(t);

    // ── 각도 매핑: -60dB→-60°, 0dB→+40°, +6dB→+60° ──
    const dbToAngle = d => {
      if (d <= -60) return -60;
      if (d >=   6) return  60;
      if (d <=   0) return -60 + ((d + 60) / 60) * 100; // -60~0 → -60~+40
      return 40 + (d / 6) * 20;                           // 0~+6 → +40~+60
    };

    this.needleTarget = dbToAngle(db);

    // ── lerp 감쇠 (아날로그 바늘 느낌) ──
    const damping = 0.25;
    this.needleAngle += (this.needleTarget - this.needleAngle) * damping;

    // ── 피크홀드 ──
    if (this.needleTarget > this.peakHold) {
      this.peakHold = this.needleTarget;
      clearTimeout(this.peakHoldTimer);
      this.peakHoldTimer = setTimeout(() => { this.peakHold = -60; }, 1500);
    }

    // ── 클리핑 감지 ──
    if (db >= 0) {
      this.clipping = true;
      clearTimeout(this.clipTimer);
      this.clipTimer = setTimeout(() => { this.clipping = false; }, 600);
    }

    // ═══ 그리기 ═══
    // 배경
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    // 베이지 패널 반원
    const cx = W / 2;
    const cy = H * 1.05;
    const r  = H * 0.92;

    const panelGrad = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.2, cx, cy, r);
    panelGrad.addColorStop(0,   '#fdf6dc');
    panelGrad.addColorStop(0.7, '#f4edd3');
    panelGrad.addColorStop(1,   '#d4ca9a');

    ctx.fillStyle = panelGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 1.15, Math.PI * 1.85);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();

    // 패널 베젤
    ctx.strokeStyle = '#3a3020';
    ctx.lineWidth   = 1.5 * DPR;
    ctx.stroke();

    // 빨간 존 (0dB 이상)
    const redStart = Math.PI * 1.5 + (40 / 180) * Math.PI;
    const redEnd   = Math.PI * 1.5 + (60 / 180) * Math.PI;
    const redGrad  = ctx.createLinearGradient(cx, cy - r, cx + r * 0.3, cy);
    redGrad.addColorStop(0, '#d9534f');
    redGrad.addColorStop(1, '#a02020');

    ctx.fillStyle = redGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.92, redStart, redEnd);
    ctx.arc(cx, cy, r * 0.78, redEnd, redStart, true);
    ctx.closePath();
    ctx.fill();

    // ── 눈금 + 숫자 ──
    const marks = [
      { db: -60, label: '-60', major: false, red: false },
      { db: -40, label: '-40', major: true,  red: false },
      { db: -20, label: '-20', major: true,  red: false },
      { db: -10, label: '-10', major: true,  red: false },
      { db:  -7, label:  '-7', major: false, red: false },
      { db:  -5, label:  '-5', major: true,  red: false },
      { db:  -3, label:  '-3', major: true,  red: false },
      { db:  -1, label:  '-1', major: false, red: false },
      { db:   0, label:   '0', major: true,  red: false },
      { db:   1, label:  '+1', major: false, red: true  },
      { db:   3, label:  '+3', major: true,  red: true  },
      { db:   6, label:  '+6', major: true,  red: true  },
    ];

    ctx.font          = `bold ${10 * DPR}px "SF Mono", monospace`;
    ctx.textAlign     = 'center';
    ctx.textBaseline  = 'middle';

    marks.forEach(m => {
      const ang   = dbToAngle(m.db);
      const rad   = (ang - 90) * Math.PI / 180;
      const inner = m.major ? r * 0.78 : r * 0.84;
      const outer = r * 0.92;
      const lblR  = r * 0.68;

      const x1 = cx + Math.cos(rad) * inner;
      const y1 = cy + Math.sin(rad) * inner;
      const x2 = cx + Math.cos(rad) * outer;
      const y2 = cy + Math.sin(rad) * outer;

      ctx.strokeStyle = m.red ? '#8a1010' : '#2a2010';
      ctx.lineWidth   = m.major ? 1.5 * DPR : 0.8 * DPR;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      if (m.major) {
        const lx = cx + Math.cos(rad) * lblR;
        const ly = cy + Math.sin(rad) * lblR;
        ctx.fillStyle = m.red ? '#8a1010' : '#2a2010';
        ctx.fillText(m.label, lx, ly);
      }
    });

    // "VOLUME UNIT" + "dB" 텍스트
    ctx.fillStyle = '#2a2010';
    ctx.font      = `bold ${8 * DPR}px "SF Mono", monospace`;
    ctx.fillText('VOLUME UNIT', cx, cy - r * 0.45);
    ctx.font      = `${7 * DPR}px monospace`;
    ctx.fillText('dB', cx, cy - r * 0.30);

    // ── 피크홀드 마커 (노란 점) ──
    if (this.peakHold > -55) {
      const pRad = (this.peakHold - 90) * Math.PI / 180;
      const px   = cx + Math.cos(pRad) * (r * 0.95);
      const py   = cy + Math.sin(pRad) * (r * 0.95);
      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.arc(px, py, 3 * DPR, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── 바늘 ──
    const needleRad = (this.needleAngle - 90) * Math.PI / 180;
    const nx = cx + Math.cos(needleRad) * (r * 0.88);
    const ny = cy + Math.sin(needleRad) * (r * 0.88);

    // 그림자
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth   = 4 * DPR;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 1, cy + 1);
    ctx.lineTo(nx + 1, ny + 1);
    ctx.stroke();

    // 바늘 본체
    ctx.strokeStyle = this.needleAngle > 40 ? '#a01020' : '#1a1a1a';
    ctx.lineWidth   = 2 * DPR;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.stroke();

    // 중심 피벗 (금속 느낌)
    const pivGrad = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 10 * DPR);
    pivGrad.addColorStop(0,   '#888');
    pivGrad.addColorStop(0.6, '#333');
    pivGrad.addColorStop(1,   '#000');
    ctx.fillStyle = pivGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 9 * DPR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // ── CLIP LED (좌상단) ──
    const ledX = W * 0.08;
    const ledY = H * 0.15;
    const ledR = 6 * DPR;

    if (this.clipping) {
      const glowGrad = ctx.createRadialGradient(ledX, ledY, 0, ledX, ledY, ledR * 3);
      glowGrad.addColorStop(0,   'rgba(255,0,0,0.9)');
      glowGrad.addColorStop(0.5, 'rgba(255,0,0,0.3)');
      glowGrad.addColorStop(1,   'rgba(255,0,0,0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(ledX, ledY, ledR * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff2020';
    } else {
      ctx.fillStyle = '#3a1010';
    }
    ctx.beginPath();
    ctx.arc(ledX, ledY, ledR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle   = this.clipping ? '#ff8080' : '#4a3030';
    ctx.font        = `bold ${7 * DPR}px monospace`;
    ctx.textAlign   = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('CLIP', ledX + ledR + 4, ledY + 2);
  }

  /* ══════════════════════════════════════════════
     ⚡ LED PEAK INDICATOR — 20세그먼트 + 피크홀드
  ══════════════════════════════════════════════ */
  _drawLedPeak() {
    const ctx = this.largeVuCtx;
    if (!ctx || this.myIdx < 0) return;
    const t = this.mixer.tracks[this.myIdx];
    if (!t) return;

    const W   = ctx.canvas.width;
    const H   = ctx.canvas.height;
    const DPR = window.devicePixelRatio || 1;

    const db   = this._calcDb(t);
    const norm = Math.max(0, Math.min(1, (db + 60) / 66));  // -60~+6 → 0~1

    // 부드러운 감쇠
    this.ledLevel += (norm - this.ledLevel) * 0.4;

    // 피크홀드
    if (norm > this.ledPeak) {
      this.ledPeak = norm;
      clearTimeout(this.ledPeakTimer);
      this.ledPeakTimer = setTimeout(() => { this.ledPeak = 0; }, 2000);
    }

    // 배경
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    // ── LED 세그먼트 (20개, 위=큰값) ──
    const NUM_LEDS = 20;
    const padding  = 6 * DPR;
    const ledH     = (H - padding * 2) / NUM_LEDS;
    const ledW     = W * 0.7;
    const ledX     = (W - ledW) / 2;

    for (let i = NUM_LEDS - 1; i >= 0; i--) {
      const lvl     = i / NUM_LEDS;
      const y       = padding + (NUM_LEDS - 1 - i) * ledH;
      const lit     = this.ledLevel >= lvl;
      const peakLit = this.ledPeak >= lvl && this.ledPeak < lvl + (1 / NUM_LEDS);

      // 녹(60%) → 황(25%) → 적(15%)
      let color;
      if      (lvl > 0.85) color = lit ? '#ff2020' : '#3a0808';
      else if (lvl > 0.65) color = lit ? '#f1c40f' : '#3a2a08';
      else                 color = lit ? '#2ecc71' : '#0a3a1a';

      ctx.fillStyle = color;
      ctx.fillRect(ledX, y, ledW, ledH - 2 * DPR);

      // 점등 글로우
      if (lit) {
        ctx.shadowColor = color;
        ctx.shadowBlur  = 6 * DPR;
        ctx.fillRect(ledX, y, ledW, ledH - 2 * DPR);
        ctx.shadowBlur  = 0;
      }

      // 피크홀드 라인 (흰색)
      if (peakLit && this.ledPeak > 0.02) {
        ctx.fillStyle   = '#ffffff';
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur  = 4 * DPR;
        ctx.fillRect(ledX, y, ledW, 2 * DPR);
        ctx.shadowBlur  = 0;
      }
    }

    // ── dB 라벨 (좌측) ──
    const dbLabels = [
      { lvl: 1.00, txt: '+6'  },
      { lvl: 0.91, txt: '0'   },
      { lvl: 0.82, txt: '-6'  },
      { lvl: 0.70, txt: '-15' },
      { lvl: 0.55, txt: '-25' },
      { lvl: 0.30, txt: '-40' },
      { lvl: 0.00, txt: '-60' },
    ];

    ctx.font          = `${8 * DPR}px monospace`;
    ctx.textAlign     = 'right';
    ctx.textBaseline  = 'middle';

    dbLabels.forEach(({ lvl, txt }) => {
      const y = padding + (1 - lvl) * (NUM_LEDS - 1) * ledH + ledH / 2;
      ctx.fillStyle = (txt.startsWith('+') || txt === '0') ? '#ff6060' : '#8a8d96';
      ctx.fillText(txt, ledX - 4, y);
    });

    // ── 현재 dB 큰 숫자 (우상단) ──
    ctx.fillStyle    = db > 0 ? '#ff2020' : db > -3 ? '#f1c40f' : '#2ecc71';
    ctx.font         = `bold ${14 * DPR}px "SF Mono", monospace`;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(db.toFixed(1), W - 4, 4);

    ctx.fillStyle    = '#8a8d96';
    ctx.font         = `${8 * DPR}px monospace`;
    ctx.fillText('dB', W - 4, 4 + 18 * DPR);
  }

  /* ══════════════════════════════════════════════
     🎨 GLOW PULSE — 채널 스트립 발광
  ══════════════════════════════════════════════ */
  _updateGlow() {
    const strips = document.querySelectorAll('.channel-strip');
    strips.forEach(strip => {
      const idx = +strip.dataset.idx;
      const t   = this.mixer.tracks[idx];
      if (!t || t.muted) { strip.style.boxShadow = ''; return; }

      const level = this.mixer.getTrackLevel ? this.mixer.getTrackLevel(idx) : 0;
      if (level < 0.02) {
        strip.style.boxShadow = idx === this.myIdx
          ? '0 0 0 1px #ff8c1a, 0 0 14px rgba(255,140,26,0.25)' : '';
        return;
      }

      const group = t.info.group || 'other';
      const glow  = {
        pastor:      '255,200,0',
        leader:      '255,140,26',
        vocal_left:  '248,113,113',
        vocal_right: '192,132,252',
        keys:        '167,100,255',
        bass:        '59,130,246',
        guitar:      '94,201,139',
        drums:       '94,139,255',
      }[group] || '255,255,255';

      const intensity = Math.min(level * 3, 1);
      const spread    = Math.round(intensity * 16);
      const alpha     = (intensity * 0.7).toFixed(2);
      strip.style.boxShadow = idx === this.myIdx
        ? `0 0 0 1px rgb(${glow}), 0 0 ${spread}px rgba(${glow},${alpha})`
        : `0 0 ${spread}px rgba(${glow},${alpha})`;
    });
  }

  /* ── 메인 업데이트 루프 (app.js의 setInterval에서 호출) ── */
  update() {
    if (!this.mixer) return;
    this._updateGlow();
    if (this.myIdx < 0 || !this.mixer.tracks[this.myIdx]) return;
    if (document.getElementById('my-vis-panel')?.classList.contains('hidden'))      return;
    if (document.querySelector('.my-vis-body')?.classList.contains('hidden-body'))  return;

    this._drawSpectrum();
    this._drawAnalogVU();
    this._drawLedPeak();
  }

  /* ══════════════════════════════════════════════
     🌊 MASTER WAVEFORM (정적 메서드, 상단 파형 바)
  ══════════════════════════════════════════════ */
  static drawMasterWaveform(mixer) {
    const canvas = document.getElementById('waveform-canvas');
    if (!canvas) return;

    // 캔버스 크기 초기화 (변경된 경우에만)
    if (!canvas.__ctx || canvas.__lastW !== canvas.offsetWidth) {
      const dpr     = window.devicePixelRatio || 1;
      canvas.width  = canvas.offsetWidth  * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      canvas.__ctx  = canvas.getContext('2d');
      canvas.__lastW = canvas.offsetWidth;
    }
    const ctx = canvas.__ctx;
    const W   = canvas.width;
    const H   = canvas.height;

    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    if (!mixer.isPlaying || !mixer.masterAnalyser) {
      ctx.strokeStyle = '#2e3038';
      ctx.lineWidth   = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();
      return;
    }

    mixer.masterAnalyser.fftSize = 1024;
    const data = new Uint8Array(mixer.masterAnalyser.fftSize);
    mixer.masterAnalyser.getByteTimeDomainData(data);

    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0,   'rgba(255,140,26,0.3)');
    grad.addColorStop(0.5, 'rgba(255,140,26,1.0)');
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

    // 재생 위치 커서
    if (mixer.songDuration > 0) {
      const x = (mixer.getCurrentTime() / mixer.songDuration) * W;
      ctx.strokeStyle = '#ff8c1a';
      ctx.lineWidth   = 2 * (window.devicePixelRatio || 1);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
  }
}

window.WorshipVisualizer = WorshipVisualizer;

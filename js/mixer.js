/**
 * WorshipMixer — Sample-accurate 멀티트랙 믹서
 * - 모든 트랙을 동일한 미래 시각에 시작 → 완벽한 싱크
 * - dB 기반 페이더, PAN, REVERB, MUTE, SOLO
 * - 곡 구간(start/end) 지원
 */
class WorshipMixer {
  constructor() {
    this.ctx          = null;
    this.tracks       = [];
    this.masterGain   = null;
    this.masterAnalyser = null;
    this.startTime    = 0;   // ctx 기준 재생 시작 시각
    this.pauseTime    = 0;   // 상대적 일시정지 위치
    this.duration     = 0;   // 전체 버퍼 길이
    this.isPlaying    = false;
    this.reverbBuffer = null;
    this.reverbLoaded = false;
    this.soloChannels = new Set();
    this.loop         = { enabled: false, a: null, b: null };
    // 곡 구간
    this.songStart    = 0;
    this.songEnd      = null;
  }

  /* ── 초기화 ── */
  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    this.masterGain = this.ctx.createGain();
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 256;
    this.masterGain.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.ctx.destination);
  }

  /* ── 곡 구간 설정 ── */
  setSongSegment(start, end) {
    this.songStart = start || 0;
    this.songEnd   = end   || null;
  }

  get songDuration() {
    if (this.songEnd !== null && this.songEnd > this.songStart)
      return this.songEnd - this.songStart;
    return Math.max(0, this.duration - this.songStart);
  }

  /* ── 리버브 IR ── */
  async loadReverbIR(url) {
    if (this.reverbLoaded) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('IR not found');
      const arr = await res.arrayBuffer();
      this.reverbBuffer = await this.ctx.decodeAudioData(arr);
      this.reverbLoaded = true;
    } catch (e) {
      console.warn('리버브 IR 없음, 합성 IR 사용:', e.message);
      this.reverbBuffer = this._makeSyntheticIR(2.0);
      this.reverbLoaded = true;
    }
  }

  _makeSyntheticIR(duration = 2.0) {
    const sr  = this.ctx.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++)
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    }
    return buf;
  }

  /* ══ 악기별 FX 체인 팩토리 ══ */
  _buildFxChain(group) {
    switch (group) {
      case 'keys':
      case 'synth': return this._makeChorus();
      case 'bass':  return this._makeBassEQ();
      case 'guitar':return this._makeGuitarAirEQ();
      case 'drums': return this._makeDrumRoom();
      default:      return this._makeRoomReverb();
    }
  }

  _makeChorus() {  // 키/신디: 코러스
    const delay = this.ctx.createDelay(0.05);
    delay.delayTime.value = 0.022;
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 0.4;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.007;
    lfo.connect(lfoG); lfoG.connect(delay.delayTime); lfo.start();
    return { input: delay, output: delay, nodes: [lfo, lfoG, delay], type: 'CHORUS' };
  }

  _makeBassEQ() {  // 베이스: HPF + LPF + 100Hz 부스트
    const hpf = this.ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 40; hpf.Q.value = 0.5;
    const lpf = this.ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 700; lpf.Q.value = 0.7;
    const boost = this.ctx.createBiquadFilter();
    boost.type = 'peaking'; boost.frequency.value = 100; boost.gain.value = 3; boost.Q.value = 1;
    hpf.connect(lpf); lpf.connect(boost);
    return { input: hpf, output: boost, nodes: [hpf, lpf, boost], type: 'BASS EQ' };
  }

  _makeGuitarAirEQ() {  // 어쿠스틱: HPF + 프레젠스 + Air
    const hpf = this.ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 90; hpf.Q.value = 0.7;
    const presence = this.ctx.createBiquadFilter();
    presence.type = 'peaking'; presence.frequency.value = 3500; presence.gain.value = 2; presence.Q.value = 1.2;
    const air = this.ctx.createBiquadFilter();
    air.type = 'highshelf'; air.frequency.value = 10000; air.gain.value = 2.5;
    hpf.connect(presence); presence.connect(air);
    return { input: hpf, output: air, nodes: [hpf, presence, air], type: 'AIR EQ' };
  }

  _makeDrumRoom() {  // 드럼: 타이트 룸 (0.35초)
    const rev = this.ctx.createConvolver();
    rev.buffer = this._makeSyntheticIR(0.35, 0.95);
    return { input: rev, output: rev, nodes: [rev], type: 'ROOM' };
  }

  _makeRoomReverb() {  // 기본 리버브
    const rev = this.ctx.createConvolver();
    if (this.reverbBuffer) rev.buffer = this.reverbBuffer;
    return { input: rev, output: rev, nodes: [rev], type: 'REV' };
  }

  /* ── 트랙 로딩 ── */
  async loadTrack(info, onProgress) {
    const res = await fetch(info.file);
    if (!res.ok) throw new Error(`로딩 실패: ${info.file} (${res.status})`);
    const arr    = await res.arrayBuffer();
    const buffer = await this.ctx.decodeAudioData(arr);
    if (buffer.duration > this.duration) this.duration = buffer.duration;

    // 노드 그래프
    const gain     = this.ctx.createGain();
    const panner   = this.ctx.createStereoPanner();
    const dryGain  = this.ctx.createGain();
    const wetGain  = this.ctx.createGain();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;

    gain.connect(panner);
    panner.connect(analyser);
    analyser.connect(dryGain);
    dryGain.connect(this.masterGain);

    // 악기별 이펜트 FX 체인 (wetGain 다음에 연결)
    const group = info.group || 'other';
    const fx    = this._buildFxChain(group);
    panner.connect(wetGain);
    wetGain.connect(fx.input);
    fx.output.connect(this.masterGain);

    dryGain.gain.value = 1.0;
    wetGain.gain.value = 0.0;

    // songs.json pan 초기값
    const initPan = (typeof info.pan === 'number') ? info.pan : 0;
    panner.pan.value = initPan;

    this.tracks.push({
      buffer, gain, panner, dryGain, wetGain,
      fxInput: fx.input, fxOutput: fx.output,
      fxNodes: fx.nodes, fxType: fx.type,
      analyser, info, source: null,
      volumeDb: 0, reverbAmt: 0, pan: initPan, muted: false, solo: false,
    });

    if (onProgress) onProgress();
  }

  async loadAllTracks(infos, onEach) {
    for (const info of infos) {
      try { await this.loadTrack(info, onEach); }
      catch (e) { console.error(e); if (onEach) onEach(); }
    }
  }

  unloadAll() {
    this.stop();
    this.tracks = [];
    this.duration = 0;
    this.pauseTime = 0;
    this.songStart = 0;
    this.songEnd   = null;
    this.soloChannels.clear();
    this.loop = { enabled: false, a: null, b: null };
  }

  /* ── 핵심: Sample-accurate 동기 재생 ── */
  play(relOffset = 0) {
    if (this.isPlaying || this.tracks.length === 0) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const SCHEDULE_AHEAD = 0.1; // 100ms 여유 — 핵심
    const targetStart = this.ctx.currentTime + SCHEDULE_AHEAD;
    const bufOffset   = this.songStart + Math.max(0, Math.min(relOffset, this.songDuration));

    this.startTime = targetStart - relOffset;

    this.tracks.forEach(t => {
      const src = this.ctx.createBufferSource();
      src.buffer = t.buffer;
      src.connect(t.gain);
      src.start(targetStart, bufOffset); // 모든 트랙이 동일한 targetStart를 받음
      t.source = src;
    });
    this.isPlaying = true;
  }

  pause() {
    if (!this.isPlaying) return;
    this.pauseTime = this.getCurrentTime();
    this._stopSources();
    this.isPlaying = false;
  }

  stop() {
    this._stopSources();
    this.pauseTime = 0;
    this.isPlaying = false;
  }

  _stopSources() {
    this.tracks.forEach(t => {
      if (t.source) {
        try { t.source.stop(); t.source.disconnect(); } catch(e){}
        t.source = null;
      }
    });
  }

  seek(relTime) {
    const was = this.isPlaying;
    if (was) this._stopSources();
    this.isPlaying = false;
    this.pauseTime = Math.max(0, Math.min(relTime, this.songDuration));
    if (was) this.play(this.pauseTime);
  }

  getCurrentTime() {
    if (this.isPlaying) {
      const elapsed = this.ctx.currentTime - this.startTime;
      return Math.max(0, Math.min(elapsed, this.songDuration));
    }
    return this.pauseTime;
  }

  /* ── 트랙 컨트롤 ── */
  dbToGain(db) {
    return db <= -60 ? 0 : Math.pow(10, db / 20);
  }

  setTrackVolumeDb(idx, db) {
    this.tracks[idx].volumeDb = db;
    this._applyGain(idx);
  }

  setTrackPan(idx, pan) {
    this.tracks[idx].pan = pan;
    this.tracks[idx].panner.pan.setValueAtTime(pan, this.ctx?.currentTime || 0);
  }

  setTrackReverb(idx, amt) {
    this.tracks[idx].reverbAmt = amt;
    this.tracks[idx].wetGain.gain.value = amt;
  }

  muteTrack(idx, muted) {
    this.tracks[idx].muted = muted;
    this._applyGain(idx);
  }

  soloTrack(idx, solo) {
    this.tracks[idx].solo = solo;
    if (solo) this.soloChannels.add(idx);
    else this.soloChannels.delete(idx);
    this.tracks.forEach((_, i) => this._applyGain(i));
  }

  _applyGain(idx) {
    const t       = this.tracks[idx];
    const hasSolo = this.soloChannels.size > 0;
    const audible = !t.muted && (!hasSolo || t.solo);
    t.gain.gain.value = audible ? this.dbToGain(t.volumeDb) : 0;
  }

  setMasterVolumeDb(db) {
    if (this.masterGain) this.masterGain.gain.value = this.dbToGain(db);
  }

  /* ── 프리셋 (듀얼 채널 지원) ── */
  applyPresetDual(myIdx, myIdx2, preset) {
    const mySet = new Set([myIdx, myIdx2].filter(i => i >= 0));
    this.soloChannels.clear();
    this.tracks.forEach(t => t.solo = false);
    this.tracks.forEach((t, i) => {
      const isMine = mySet.has(i);
      const group  = t.info.group || '';
      let db = 0, muted = false;
      switch (preset) {
        case 'me_solo':      muted = !isMine; break;
        case 'me_full':      db = isMine ? 3 : -6; break;
        case 'singers':      muted = !['leader','vocal_left','vocal_right'].includes(group); break;
        case 'singers_only': muted = !['vocal_left','vocal_right'].includes(group); break;
        case 'instruments':  muted = !['keys','bass','guitar','drums'].includes(group); break;
        case 'me_rhythm':    muted = !(isMine||['drums','bass'].includes(group)); db=isMine?2:-3; break;
        case 'me_keys':      muted = !(isMine||['keys','synth'].includes(group)); db=isMine?2:-3; break;
        case 'me_minus':     muted = isMine; break;
        default:             break;
      }
      t.volumeDb = db; t.muted = muted; this._applyGain(i);
    });
  }

  /* ── 프리셋 ── */
  applyPreset(myIdx, preset) {
    this.soloChannels.clear();
    this.tracks.forEach(t => t.solo = false);
    this.tracks.forEach((t, i) => {
      const isMine = i === myIdx;
      const group  = t.info.group || '';
      let db = 0, muted = false;
      switch (preset) {
        case 'me_solo':   muted = !isMine; db = 0; break;
        case 'me_full':   muted = false; db = isMine ? 3 : -6; break;
        case 'me_rhythm': muted = !(isMine || ['drums','bass'].includes(group)); db = isMine ? 2 : -3; break;
        case 'me_keys':   muted = !(isMine || ['keys','synth'].includes(group)); db = isMine ? 2 : -3; break;
        case 'me_minus':    muted = isMine; db = 0; break;
        case 'singers':     muted = !['leader','vocal_left','vocal_right'].includes(group); db = 0; break;
        case 'singers_only':muted = !['vocal_left','vocal_right'].includes(group); db = 0; break;
        case 'instruments': muted = !['keys','bass','guitar','drums'].includes(group); db = 0; break;
        default:            muted = false; db = 0;
      }
      t.volumeDb = db; t.muted = muted;
      this._applyGain(i);
    });
  }

  /* ── 미터 ── */
  getTrackLevel(idx) {
    const t = this.tracks[idx];
    if (!t || !this.isPlaying) return 0;
    const d = new Uint8Array(t.analyser.frequencyBinCount);
    t.analyser.getByteFrequencyData(d);
    return d.reduce((a, v) => a + v, 0) / (d.length * 255);
  }

  getMasterLevel() {
    if (!this.isPlaying || !this.masterAnalyser) return 0;
    const d = new Uint8Array(this.masterAnalyser.frequencyBinCount);
    this.masterAnalyser.getByteFrequencyData(d);
    return d.reduce((a, v) => a + v, 0) / (d.length * 255);
  }

  /* ── 루프 체크 ── */
  checkLoop() {
    const cur = this.getCurrentTime();
    // 구간 끝 자동 정지
    if (this.songEnd !== null && cur >= this.songDuration - 0.08) {
      this.stop();
      this.pauseTime = 0;
      return true; // 종료 신호
    }
    // A-B 루프
    if (this.loop.enabled && this.loop.a != null && this.loop.b != null) {
      if (this.loop.b > this.loop.a && cur >= this.loop.b) {
        this.seek(this.loop.a);
      }
    }
    return false;
  }

  /* ── 믹스 텍스트 ── */
  getMixText(songTitle) {
    const lines = this.tracks.map((t, i) => {
      const ch  = (i+1).toString().padStart(2,'0');
      const db  = t.volumeDb >= 0 ? `+${t.volumeDb.toFixed(1)}` : t.volumeDb.toFixed(1);
      const pan = t.pan < -0.05 ? `L${Math.round(Math.abs(t.pan)*100)}` : t.pan > 0.05 ? `R${Math.round(t.pan*100)}` : 'C';
      const rev = Math.round(t.reverbAmt * 100);
      const fl  = [t.muted && 'MUTE', t.solo && 'SOLO'].filter(Boolean).join('/');
      return `CH${ch} ${(t.info.name||'').padEnd(14)} ${db}dB PAN:${pan} REV:${rev}%${fl ? ' ['+fl+']' : ''}`;
    });
    return `[${songTitle}]\n${'='.repeat(44)}\n${lines.join('\n')}`;
  }
}

window.WorshipMixer = WorshipMixer;

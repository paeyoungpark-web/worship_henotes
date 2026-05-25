/**
 * WorshipMixer — Web Audio API 기반 멀티트랙 믹서 엔진
 * worship_Henotes 프로젝트
 */
class WorshipMixer {
  constructor() {
    this.ctx = null;
    this.tracks = [];
    this.masterGain = null;
    this.startTime = 0;
    this.pauseTime = 0;
    this.duration = 0;
    this.isPlaying = false;
    this.reverbBuffer = null;
    this.reverbLoaded = false;
    this.loop = { enabled: false, a: null, b: null };
    this.songStart = 0;
    this.songEnd   = null;
  }

  // 곡 구간 (전체 파일 중 일부만 재생)
  setSongSegment(start, end) {
    this.songStart = start || 0;
    this.songEnd   = end   || null;  // null = 끝까지
  }

  get songDuration() {
    if (this.songEnd !== null) return this.songEnd - this.songStart;
    return Math.max(0, this.duration - this.songStart);
  }

  async init() {
    if (this.ctx) {
      // 이미 초기화된 경우 일시정지 상태면 resume
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
  }

  async loadReverbIR(url) {
    if (this.reverbLoaded) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.arrayBuffer();
      this.reverbBuffer = await this.ctx.decodeAudioData(arr);
      this.reverbLoaded = true;
      console.log('✅ 리버브 IR 로딩 완료');
    } catch (e) {
      console.warn('⚠️ 리버브 IR 로딩 실패, 리버브 없이 진행:', e.message);
    }
  }

  async loadTrack(info, onProgress) {
    const res = await fetch(info.file);
    if (!res.ok) throw new Error(`트랙 로딩 실패: ${info.file} (HTTP ${res.status})`);
    const arr = await res.arrayBuffer();
    const buffer = await this.ctx.decodeAudioData(arr);

    if (buffer.duration > this.duration) this.duration = buffer.duration;

    // 노드 그래프: gain → dryGain → master
    //                   ↘ wetGain → reverb → master
    const gain     = this.ctx.createGain();
    const dryGain  = this.ctx.createGain();
    const wetGain  = this.ctx.createGain();
    const reverb   = this.ctx.createConvolver();

    if (this.reverbBuffer) reverb.buffer = this.reverbBuffer;

    gain.connect(dryGain);
    dryGain.connect(this.masterGain);
    gain.connect(wetGain);
    wetGain.connect(reverb);
    reverb.connect(this.masterGain);

    dryGain.gain.value = 1.0;
    wetGain.gain.value = 0.0;

    this.tracks.push({
      buffer,
      gain, dryGain, wetGain, reverb,
      info,
      source: null,
      volume: 1.0,
      reverbAmt: 0.0,
      muted: false,
    });

    if (onProgress) onProgress();
  }

  /**
   * 병렬 로딩 (진행률은 콜백으로)
   */
  async loadAllTracks(trackInfos, onEachLoaded) {
    const promises = trackInfos.map(info =>
      this.loadTrack(info, onEachLoaded)
    );
    await Promise.all(promises);
  }

  unloadAll() {
    this.stop();
    this.tracks = [];
    this.duration = 0;
    this.pauseTime = 0;
    this.songStart = 0;
    this.songEnd   = null;
    this.loop = { enabled: false, a: null, b: null };
  }

  play(offset = 0) {
    if (this.isPlaying) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    // offset은 곡 내 상대시간, 실제 버퍼 위치는 songStart + offset
    const clampedOffset = Math.max(0, Math.min(offset, this.songDuration));
    const bufferOffset  = this.songStart + clampedOffset;

    this.startTime = this.ctx.currentTime - clampedOffset;

    this.tracks.forEach(t => {
      const src = this.ctx.createBufferSource();
      src.buffer = t.buffer;
      src.connect(t.gain);
      src.start(0, bufferOffset);
      t.source = src;
    });

    this.isPlaying = true;
  }

  pause() {
    if (!this.isPlaying) return;
    this.pauseTime = this.getCurrentTime();
    this._stopAllSources();
    this.isPlaying = false;
  }

  stop() {
    this._stopAllSources();
    this.pauseTime = 0;
    this.isPlaying = false;
  }

  _stopAllSources() {
    this.tracks.forEach(t => {
      if (t.source) {
        try { t.source.stop(); } catch (e) {}
        t.source = null;
      }
    });
  }

  seek(time) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this._stopAllSources();
    this.isPlaying = false;
    this.pauseTime = Math.max(0, Math.min(time, this.songDuration));
    if (wasPlaying) this.play(this.pauseTime);
  }

  getCurrentTime() {
    if (!this.ctx) return 0;
    if (this.isPlaying) {
      return Math.min(this.ctx.currentTime - this.startTime, this.songDuration);
    }
    return this.pauseTime;
  }

  setTrackVolume(idx, vol) {
    const t = this.tracks[idx];
    if (!t) return;
    t.volume = vol;
    if (!t.muted) t.gain.gain.value = vol;
  }

  setTrackReverb(idx, amt) {
    const t = this.tracks[idx];
    if (!t) return;
    t.reverbAmt = amt;
    t.wetGain.gain.value = amt;
    t.dryGain.gain.value = Math.max(0, 1.0 - amt * 0.5);
  }

  muteTrack(idx, muted) {
    const t = this.tracks[idx];
    if (!t) return;
    t.muted = muted;
    t.gain.gain.value = muted ? 0 : t.volume;
  }

  applyPreset(myIdx, preset) {
    this.tracks.forEach((t, i) => {
      const isMine = i === myIdx;
      const group = t.info.group || '';
      let vol = 1.0, muted = false;

      switch (preset) {
        case 'me_solo':
          muted = !isMine;
          vol = 1.0;
          break;
        case 'me_full':
          muted = false;
          vol = isMine ? 1.3 : 0.7;
          break;
        case 'me_rhythm':
          muted = !(isMine || ['drums', 'bass', 'rhythm'].includes(group));
          vol = isMine ? 1.2 : 0.9;
          break;
        case 'me_keys':
          muted = !(isMine || ['keys', 'synth'].includes(group));
          vol = isMine ? 1.2 : 0.9;
          break;
        case 'me_minus':
          muted = isMine;
          vol = 1.0;
          break;
        case 'all':
        default:
          muted = false;
          vol = 1.0;
          break;
      }

      t.volume = vol;
      t.muted = muted;
      t.gain.gain.value = muted ? 0 : vol;
    });
  }

  /**
   * 구간 루프 체크 — 메인 루프(setInterval)에서 주기적으로 호출
   */
  checkLoop() {
    const cur = this.getCurrentTime();
    // 구간 끝 자동 정지
    if (this.songEnd !== null && cur >= this.songDuration - 0.1) {
      this.stop();
      this.pauseTime = 0;
      return;
    }
    // A-B 루프
    if (!this.loop.enabled) return;
    if (this.loop.a == null || this.loop.b == null) return;
    if (this.loop.b <= this.loop.a) return;
    if (cur >= this.loop.b) {
      this.seek(this.loop.a);
    }
  }

  /**
   * 현재 믹스 상태를 텍스트로 반환
   */
  getMixSummary(songTitle) {
    const lines = this.tracks.map(t => {
      const v = Math.round(t.volume * 100);
      const r = Math.round(t.reverbAmt * 100);
      const m = t.muted ? ' [MUTED]' : '';
      return `${t.info.name}: 볼륨 ${v}% / 리버브 ${r}%${m}`;
    });
    return `[${songTitle}] 믹스 설정\n` + lines.join('\n');
  }
}

window.WorshipMixer = WorshipMixer;

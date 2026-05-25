/**
 * UI — 렌더링 헬퍼 모듈
 * worship_Henotes 프로젝트
 */
const UI = {
  // 카테고리 분류
  groupCategory(group) {
    if (group === 'vocal') return { key: 'vocal', label: '🎤 보컬' };
    if (['drums', 'bass', 'rhythm'].includes(group)) return { key: 'rhythm', label: '🥁 리듬' };
    return { key: 'melody', label: '🎸 기타 / 건반' };
  },

  /**
   * 곡 목록 렌더링 (날짜별 그룹핑)
   */
  renderSongList(songs, onClick) {
    const list = document.getElementById('song-list');

    if (!songs || songs.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div style="font-size:2rem">🎵</div>
          <p>등록된 곡이 없습니다.<br>data/songs.json에 곡을 추가해주세요.</p>
        </div>`;
      return;
    }

    // 날짜별 그룹핑
    const byDate = {};
    songs.forEach((s, i) => {
      const d = s.date || '날짜 미정';
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push({ ...s, _idx: i });
    });

    list.innerHTML = '';
    Object.keys(byDate)
      .sort((a, b) => b.localeCompare(a))  // 최신 날짜 우선
      .forEach(date => {
        const dateHeader = document.createElement('div');
        dateHeader.className = 'date-header';
        dateHeader.textContent = `📅 ${date}`;
        list.appendChild(dateHeader);

        byDate[date].forEach(song => {
          const card = document.createElement('div');
          card.className = 'song-card';
          card.innerHTML = `
            <div class="title">${song.title}</div>
            <div class="meta">${(song.start != null && song.end != null) ? UI.formatTime(song.end - song.start) : (song.duration || '—')} · 트랙 ${song.tracks.length}개</div>
          `;
          card.addEventListener('click', () => onClick(song._idx));
          list.appendChild(card);
        });
      });
  },

  /**
   * 내 파트 드롭다운 렌더링
   */
  renderMyPartSelector(tracks) {
    const sel = document.getElementById('my-part-select');
    sel.innerHTML =
      '<option value="-1">— 선택 안 함 —</option>' +
      tracks.map((t, i) => `<option value="${i}">${t.name}</option>`).join('');
  },

  /**
   * 트랙 컨트롤 렌더링 (카테고리별 그룹핑, 접기/펼치기)
   */
  renderTracks(tracks, mixer) {
    const container = document.getElementById('track-groups');
    container.innerHTML = '';

    // 카테고리별 그룹핑
    const groups = { vocal: [], rhythm: [], melody: [] };
    tracks.forEach((t, i) => {
      const cat = UI.groupCategory(t.group);
      groups[cat.key].push({ ...t, _idx: i });
    });

    const groupMeta = {
      vocal:  { label: '🎤 보컬' },
      rhythm: { label: '🥁 리듬' },
      melody: { label: '🎸 기타 / 건반' },
    };

    Object.entries(groups).forEach(([key, items]) => {
      if (items.length === 0) return;

      const groupDiv = document.createElement('div');
      groupDiv.className = `track-group ${key}`;

      // 헤더 (접기/펼치기)
      const header = document.createElement('div');
      header.className = 'track-group-header';
      header.innerHTML = `
        <h3>${groupMeta[key].label} <span style="color:#bbb;font-size:0.8rem">(${items.length})</span></h3>
        <span class="toggle-icon">▾</span>
      `;
      groupDiv.appendChild(header);

      // 바디
      const body = document.createElement('div');
      body.className = 'track-group-body';

      items.forEach(t => {
        const row = document.createElement('div');
        row.className = 'track-row';
        row.dataset.idx = t._idx;
        row.innerHTML = `
          <input type="checkbox" checked class="mute-chk" title="체크 해제 시 뮤트">
          <div class="track-info">
            <div class="track-name">${t.name}</div>
            <div class="sliders">
              <div class="slider-wrap">
                <span>🔊</span>
                <input type="range" class="vol-slider" min="0" max="2" step="0.01" value="1">
                <span class="value vol-val">100%</span>
              </div>
              <div class="slider-wrap">
                <span>🌫</span>
                <input type="range" class="rev-slider" min="0" max="1" step="0.01" value="0">
                <span class="value rev-val">0%</span>
              </div>
            </div>
          </div>
        `;
        body.appendChild(row);
      });

      groupDiv.appendChild(body);
      container.appendChild(groupDiv);

      // 접기/펼치기 이벤트
      header.addEventListener('click', () => {
        const collapsed = body.classList.toggle('collapsed');
        header.classList.toggle('collapsed', collapsed);
      });
    });

    // 슬라이더·뮤트 이벤트 바인딩
    container.querySelectorAll('.track-row').forEach(row => {
      const idx = +row.dataset.idx;
      const chk    = row.querySelector('.mute-chk');
      const vol    = row.querySelector('.vol-slider');
      const rev    = row.querySelector('.rev-slider');
      const volVal = row.querySelector('.vol-val');
      const revVal = row.querySelector('.rev-val');

      chk.addEventListener('change', e => {
        mixer.muteTrack(idx, !e.target.checked);
      });
      vol.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        mixer.setTrackVolume(idx, v);
        volVal.textContent = Math.round(v * 100) + '%';
      });
      rev.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        mixer.setTrackReverb(idx, v);
        revVal.textContent = Math.round(v * 100) + '%';
      });
    });
  },

  /**
   * 내 파트 행 강조
   */
  highlightMyPart(idx) {
    document.querySelectorAll('.track-row').forEach(row => {
      row.classList.toggle('mine', +row.dataset.idx === idx);
    });
  },

  /**
   * 믹서 상태 → UI 슬라이더 동기화 (프리셋 적용 후 호출)
   */
  syncSlidersFromMixer(mixer) {
    document.querySelectorAll('.track-row').forEach(row => {
      const idx = +row.dataset.idx;
      const t = mixer.tracks[idx];
      if (!t) return;

      const chk    = row.querySelector('.mute-chk');
      const vol    = row.querySelector('.vol-slider');
      const rev    = row.querySelector('.rev-slider');
      const volVal = row.querySelector('.vol-val');
      const revVal = row.querySelector('.rev-val');

      chk.checked = !t.muted;
      vol.value = t.volume;
      volVal.textContent = Math.round(t.volume * 100) + '%';
      rev.value = t.reverbAmt;
      revVal.textContent = Math.round(t.reverbAmt * 100) + '%';
    });
  },

  /**
   * 초 → m:ss 포맷
   */
  formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  },

  /**
   * 뷰 전환
   */
  showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const el = document.getElementById(`view-${name}`);
    if (el) {
      el.classList.remove('hidden');
      window.scrollTo(0, 0);
    }
  },

  /**
   * 로딩 오버레이
   */
  showLoading(show, pct = 0) {
    const el = document.getElementById('loading');
    el.classList.toggle('hidden', !show);
    if (show) {
      document.getElementById('loading-progress').textContent = pct;
      // 바 너비도 업데이트 (bar가 있으면)
      const bar = el.querySelector('.loading-bar');
      if (bar) bar.style.width = pct + '%';
    }
  },
};

window.UI = UI;

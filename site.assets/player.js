// Persistent music player — works across all pages via sessionStorage
// Injects the now-playing bar, restores state on page load, saves on unload
(function() {
  var BASE = (function() {
    var path = location.pathname;
    if (path.indexOf('/posts/') !== -1 || path.indexOf('/demo/') !== -1) return '../';
    return '';
  })();

  // Build now-playing bar via DOM methods if not already present
  if (!document.getElementById('nowPlaying')) {
    var bar = document.createElement('div');
    bar.className = 'now-playing';
    bar.id = 'nowPlaying';

    var progressWrap = document.createElement('div');
    progressWrap.className = 'np-progress-wrap';
    progressWrap.id = 'npProgressWrap';
    var progressFill = document.createElement('div');
    progressFill.className = 'np-progress-fill';
    progressFill.id = 'npProgressFill';
    progressWrap.appendChild(progressFill);
    bar.appendChild(progressWrap);

    var content = document.createElement('div');
    content.className = 'np-content';

    var cover = document.createElement('img');
    cover.className = 'np-cover';
    cover.id = 'npCover';
    cover.src = '';
    cover.alt = '';
    content.appendChild(cover);

    var info = document.createElement('div');
    info.className = 'np-info';
    var title = document.createElement('div');
    title.className = 'np-title';
    title.id = 'npTitle';
    title.textContent = '--';
    var style = document.createElement('div');
    style.className = 'np-style';
    style.id = 'npStyle';
    style.textContent = '--';
    info.appendChild(title);
    info.appendChild(style);
    content.appendChild(info);

    var controls = document.createElement('div');
    controls.className = 'np-controls';

    function makeBtn(id, cls, pathD) {
      var btn = document.createElement('button');
      btn.className = 'np-btn' + (cls ? ' ' + cls : '');
      btn.id = id;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      if (id === 'npPlayPause') svg.id = 'npPlayIcon';
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', pathD);
      svg.appendChild(p);
      btn.appendChild(svg);
      return btn;
    }

    controls.appendChild(makeBtn('npPrev', '', 'M6 6h2v12H6zm3.5 6 8.5 6V6z'));
    controls.appendChild(makeBtn('npPlayPause', 'play-pause', 'M8 5v14l11-7z'));
    controls.appendChild(makeBtn('npNext', '', 'M16 18h2V6h-2zM6 18l8.5-6L6 6z'));
    content.appendChild(controls);

    var time = document.createElement('div');
    time.className = 'np-time';
    time.id = 'npTime';
    time.textContent = '0:00 / 0:00';
    content.appendChild(time);

    var vol = document.createElement('div');
    vol.className = 'np-volume';
    var volSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    volSvg.setAttribute('viewBox', '0 0 24 24');
    var volPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    volPath.setAttribute('d', 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z');
    volSvg.appendChild(volPath);
    vol.appendChild(volSvg);
    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'volume-slider';
    slider.id = 'volumeSlider';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.01';
    slider.value = '0.8';
    vol.appendChild(slider);
    content.appendChild(vol);

    bar.appendChild(content);
    document.body.appendChild(bar);
  }

  // Inject player CSS if not already present (for non-music pages)
  if (!document.querySelector('style[data-player]')) {
    var css = document.createElement('style');
    css.setAttribute('data-player', '1');
    css.textContent =
      '.now-playing { position: fixed; bottom: 0; left: 0; right: 0; z-index: 200; background: rgba(13,13,18,0.85); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-top: 1px solid rgba(168,85,247,0.15); padding: 0; display: none; flex-direction: column; }' +
      '.now-playing.active { display: flex; }' +
      '.np-progress-wrap { width: 100%; height: 3px; background: rgba(255,255,255,0.06); cursor: pointer; position: relative; }' +
      '.np-progress-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #3b0764, #a855f7); transition: width 0.1s linear; position: relative; }' +
      '.np-progress-fill::after { content: ""; position: absolute; right: -4px; top: -4px; width: 10px; height: 10px; border-radius: 50%; background: #a855f7; opacity: 0; transition: opacity 0.2s; }' +
      '.np-progress-wrap:hover .np-progress-fill::after { opacity: 1; }' +
      '.np-content { display: flex; align-items: center; gap: 1rem; padding: 0.6rem 1.5rem; min-height: 60px; }' +
      '.np-cover { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }' +
      '.np-info { flex: 1; min-width: 0; }' +
      '.np-title { font-family: "Inter", sans-serif; font-weight: 700; font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #e8e4dc; }' +
      '.np-style { font-family: "Source Code Pro", monospace; font-size: 0.65rem; color: #5a5650; text-transform: uppercase; letter-spacing: 0.05em; }' +
      '.np-controls { display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0; }' +
      '.np-btn { background: none; border: none; color: #8a8578; cursor: pointer; padding: 0.3rem; display: flex; align-items: center; justify-content: center; transition: color 0.3s; }' +
      '.np-btn:hover { color: #c084fc; }' +
      '.np-btn svg { width: 18px; height: 18px; fill: currentColor; }' +
      '.np-btn.play-pause svg { width: 24px; height: 24px; }' +
      '.np-time { font-family: "Source Code Pro", monospace; font-size: 0.65rem; color: #5a5650; flex-shrink: 0; min-width: 80px; text-align: center; }' +
      '.np-volume { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }' +
      '.np-volume svg { width: 16px; height: 16px; fill: #8a8578; }' +
      '.volume-slider { -webkit-appearance: none; appearance: none; width: 80px; height: 3px; background: rgba(255,255,255,0.1); border-radius: 2px; outline: none; }' +
      '.volume-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 10px; height: 10px; border-radius: 50%; background: #a855f7; cursor: pointer; }' +
      '.volume-slider::-moz-range-thumb { width: 10px; height: 10px; border-radius: 50%; background: #a855f7; cursor: pointer; border: none; }' +
      '@media (max-width: 768px) { .np-volume { display: none; } .np-time { min-width: 60px; font-size: 0.6rem; } }' +
      '@media (max-width: 480px) { .np-content { padding: 0.5rem 1rem; gap: 0.75rem; } }';
    document.head.appendChild(css);
  }

  var audio = new Audio();
  var catalog = [];
  var currentIndex = -1;
  var isPlaying = false;

  var nowPlaying = document.getElementById('nowPlaying');
  var npCover = document.getElementById('npCover');
  var npTitle = document.getElementById('npTitle');
  var npStyle = document.getElementById('npStyle');
  var npPlayPause = document.getElementById('npPlayPause');
  var npPlayIcon = document.getElementById('npPlayIcon');
  var npPrev = document.getElementById('npPrev');
  var npNext = document.getElementById('npNext');
  var npTime = document.getElementById('npTime');
  var npProgressWrap = document.getElementById('npProgressWrap');
  var npProgressFill = document.getElementById('npProgressFill');
  var volumeSlider = document.getElementById('volumeSlider');

  function fmt(s) {
    if (isNaN(s)) return '0:00';
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function updatePlayIcon() {
    while (npPlayIcon.firstChild) npPlayIcon.removeChild(npPlayIcon.firstChild);
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', isPlaying ? 'M6 19h4V5H6zm8-14v14h4V5z' : 'M8 5v14l11-7z');
    npPlayIcon.appendChild(path);
  }

  function saveState() {
    if (currentIndex < 0 || !catalog.length) return;
    var song = catalog[currentIndex];
    sessionStorage.setItem('icePlayer', JSON.stringify({
      songId: song.songId,
      title: song.title,
      style: song.style || '',
      index: currentIndex,
      time: audio.currentTime || 0,
      playing: isPlaying,
      volume: audio.volume
    }));
  }

  function loadCatalog(cb) {
    var cached = sessionStorage.getItem('iceCatalog');
    if (cached) {
      try { catalog = JSON.parse(cached); cb(); return; } catch(e) {}
    }
    fetch(BASE + 'music/catalog.json')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        catalog = data;
        sessionStorage.setItem('iceCatalog', JSON.stringify(data));
        cb();
      })
      .catch(function() {});
  }

  function restoreState() {
    var raw = sessionStorage.getItem('icePlayer');
    if (!raw) return;
    try { var state = JSON.parse(raw); } catch(e) { return; }
    if (!state.songId || !catalog.length) return;

    var idx = -1;
    for (var i = 0; i < catalog.length; i++) {
      if (catalog[i].songId === state.songId) { idx = i; break; }
    }
    if (idx < 0) return;

    currentIndex = idx;
    var song = catalog[idx];

    nowPlaying.classList.add('active');
    npCover.src = BASE + 'music/covers/' + encodeURIComponent(song.songId) + '.jpeg';
    npTitle.textContent = song.title;
    npStyle.textContent = song.style || 'untagged';

    audio.src = BASE + 'music/mp3/' + encodeURIComponent(song.songId) + '.mp3';
    audio.volume = state.volume || 0.8;
    volumeSlider.value = audio.volume;

    if (state.time > 0) {
      var restored = false;
      audio.addEventListener('loadedmetadata', function onMeta() {
        if (restored) return;
        restored = true;
        audio.removeEventListener('loadedmetadata', onMeta);
        audio.currentTime = state.time;
        if (state.playing) {
          audio.play().catch(function() {});
          isPlaying = true;
        }
        updatePlayIcon();
      });
      if (audio.readyState >= 1 && !restored) {
        restored = true;
        audio.currentTime = state.time;
        if (state.playing) {
          audio.play().catch(function() {});
          isPlaying = true;
        }
        updatePlayIcon();
      }
    } else if (state.playing) {
      audio.play().catch(function() {});
      isPlaying = true;
      updatePlayIcon();
    } else {
      updatePlayIcon();
    }
  }

  // Expose playSong globally so music.html grid can call it
  window.icePlayer = {
    playSong: function(index) {
      if (index < 0 || index >= catalog.length) return;
      var song = catalog[index];
      if (isPlaying && audio.volume > 0) {
        var fadeVol = audio.volume;
        var targetVol = parseFloat(volumeSlider.value);
        var fadeOut = setInterval(function() {
          fadeVol -= 0.05;
          if (fadeVol <= 0.05) {
            clearInterval(fadeOut);
            audio.volume = 0;
            doLoad(song, index, targetVol);
          } else {
            audio.volume = fadeVol;
          }
        }, 30);
      } else {
        doLoad(song, index, parseFloat(volumeSlider.value));
      }
    },
    getCatalog: function() { return catalog; },
    getCurrentIndex: function() { return currentIndex; },
    isPlaying: function() { return isPlaying; }
  };

  function doLoad(song, index, vol) {
    currentIndex = index;
    audio.src = BASE + 'music/mp3/' + encodeURIComponent(song.songId) + '.mp3';
    audio.volume = vol;
    audio.play().catch(function() {});
    isPlaying = true;
    nowPlaying.classList.add('active');
    npCover.src = BASE + 'music/covers/' + encodeURIComponent(song.songId) + '.jpeg';
    npTitle.textContent = song.title;
    npStyle.textContent = song.style || 'untagged';
    updatePlayIcon();
    saveState();
  }

  npPlayPause.addEventListener('click', function() {
    if (currentIndex < 0) return;
    if (isPlaying) { audio.pause(); isPlaying = false; }
    else { audio.play().catch(function() {}); isPlaying = true; }
    updatePlayIcon();
    saveState();
  });

  npPrev.addEventListener('click', function() {
    if (!catalog.length) return;
    window.icePlayer.playSong(currentIndex <= 0 ? catalog.length - 1 : currentIndex - 1);
  });

  npNext.addEventListener('click', function() {
    if (!catalog.length) return;
    window.icePlayer.playSong(currentIndex >= catalog.length - 1 ? 0 : currentIndex + 1);
  });

  audio.addEventListener('timeupdate', function() {
    var pct = (audio.currentTime / audio.duration) * 100 || 0;
    npProgressFill.style.width = pct + '%';
    npTime.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration);
  });

  audio.addEventListener('ended', function() {
    window.icePlayer.playSong(currentIndex >= catalog.length - 1 ? 0 : currentIndex + 1);
  });

  npProgressWrap.addEventListener('click', function(e) {
    if (!audio.duration) return;
    var rect = npProgressWrap.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  });

  volumeSlider.addEventListener('input', function() {
    audio.volume = parseFloat(volumeSlider.value);
    saveState();
  });

  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (currentIndex < 0) return;
    if (e.code === 'Space') { e.preventDefault(); npPlayPause.click(); }
    if (e.code === 'ArrowLeft') npPrev.click();
    if (e.code === 'ArrowRight') npNext.click();
  });

  window.addEventListener('beforeunload', saveState);
  setInterval(saveState, 3000);

  loadCatalog(function() {
    restoreState();
    if (window.iceMusicPageReady) window.iceMusicPageReady();
  });
})();

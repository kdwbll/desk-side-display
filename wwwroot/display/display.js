'use strict';

const screens = [...document.querySelectorAll('.screen')];
const time = document.getElementById('time');
const date = document.getElementById('date');
const title = document.getElementById('track');
const artist = document.getElementById('artist');
const lyricStack = document.querySelector('.lyric-stack');
const lyricView = document.getElementById('lyrics');
const updateAlbumFlow = createAlbumFlow(lyricView);
const contextLines = 5;
const lyricOffsets = Array.from({ length: 2 * contextLines + 1 }, (_, i) => i - contextLines);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const lyricNotes = {
  searching: '正在查找歌词…',
  'no-timeline': '等待 Apple Music 播放进度',
  'metadata-incomplete': '等待歌曲信息',
  unavailable: '暂时无法取得歌词',
  missing: '暂未匹配到同步歌词',
  instrumental: '纯音乐'
};
const clockFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
let state;
let sampleTime = 0;
const stateTimeoutMs = 5000;
let playbackClock;
let wakeLock;
let lineKey;
let activeIndex;
let current;
let lyricRows = new Map();
let displayedSong;
let displayedTiming;
let displayedPosition = 0;
let shownMode;
let clockMinute;
let fills = [];
let waveUnits = [];
let lyricWaves = [];
const lyricWaveRadius = 2;
const lyricWaveTailMs = 180;
let transitions = [];
let departingLine;
let appearanceKey;

for (const image of document.images) {
  image.addEventListener('load', () => { image.hidden = false; });
  image.addEventListener('error', () => {
    image.hidden = true;
    delete image.dataset.url;
  });
}

function setImage(id, url) {
  const image = document.getElementById(id);
  if (!url) {
    image.hidden = true;
    image.removeAttribute('src');
    delete image.dataset.url;
    return;
  }
  if (image.dataset.url === url) return;
  image.hidden = true;
  image.dataset.url = url;
  image.src = url;
}

function playbackAt(now) {
  if (!playbackClock) return 0;
  const elapsed = Math.max(0, now - playbackClock.at);
  const correction = playbackClock.drift * Math.min(1, elapsed / playbackClock.adjustMs);
  return Math.max(0, Math.min(state.durationMs ?? Infinity,
    playbackClock.position + elapsed * playbackClock.rate + correction));
}

function syncPlaybackClock(next, sent, received) {
  if (!Number.isFinite(next.positionMs)) {
    playbackClock = undefined;
    return;
  }
  const rate = next.playing ? next.rate : 0;
  const sameTransport = playbackClock && next.song?.id === state?.song?.id &&
    next.playing === state.playing && rate === playbackClock.rate;
  const roundTrip = received - sent;
  // A late same-track sample cannot pinpoint the current position accurately.
  if (sameTransport && rate > 0 && roundTrip > 500 && received - playbackClock.at < stateTimeoutMs) return;
  const observed = next.positionMs + roundTrip * rate / 2;
  const predicted = playbackAt(received);
  const error = observed - predicted;
  const smooth = sameTransport && rate > 0 && Math.abs(error) < 900;
  const drift = smooth && Math.abs(error) >= 25 ? error : 0;
  playbackClock = {
    at: received,
    position: smooth ? predicted : observed,
    rate,
    drift,
    adjustMs: Math.max(600, Math.abs(drift) / .18 / (rate || 1))
  };
}

function refreshScreen(now) {
  const elapsed = now - sampleTime;
  const defaultMode = !state || (state.mode === 'lyrics' && elapsed > stateTimeoutMs) ? 'clock' : state.mode;
  const mode = phonePages.show(defaultMode, state);
  if (shownMode !== mode) {
    stopLyricMotion();
    for (const screen of screens) screen.hidden = screen.id !== mode;
    shownMode = mode;
    displayedSong = undefined;
    lineKey = undefined;
    clockMinute = undefined;
  }
  if (mode === 'clock') {
    const systemTime = new Date();
    const minute = Math.floor(systemTime.getTime() / 60000);
    if (clockMinute !== minute) {
      time.textContent = clockFormat.format(systemTime);
      time.dateTime = systemTime.toISOString();
      date.textContent = dateFormat.format(systemTime);
      clockMinute = minute;
    }
  }
  if (mode !== 'lyrics') return;
  const song = state?.song;
  const songId = song?.id ?? '';
  if (displayedSong !== songId) {
    title.textContent = song?.title ?? 'Apple Music';
    artist.textContent = song?.artist ?? '';
    displayedSong = songId;
    activeIndex = undefined;
  }

  if (!state || elapsed > stateTimeoutMs) {
    if (lineKey !== 'offline') {
      renderLyrics([], -1, '等待 Windows 连接');
      lineKey = 'offline';
      activeIndex = undefined;
    }
    return;
  }
  const playback = playbackAt(now);
  const position = Math.max(0, playback + (state.lyricOffsetMs ?? 0) +
    sectionCorrection(playback, state.durationMs, state.lyricTimingPoints ?? []));
  // Start the line transition early while word fills follow the original clock.
  const linePosition = position + lyricLineLeadMs;
  let low = 0;
  let high = state.lines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (state.lines[middle].atMs <= linePosition) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  const line = state.lines[index];
  const surroundings = lyricOffsets.map(offset => state.lines[index + offset]?.text ?? '');
  const note = state.lines.length ? '' : lyricNotes[state.lyricsStatus] ?? '';
  const key = JSON.stringify([song?.id, state.lyricTimingId, index, line, surroundings, note]);
  if (lineKey !== key) {
    const smooth = lineKey && displayedTiming === state.lyricTimingId &&
      index >= 0 && index === activeIndex + 1 && !reducedMotion.matches &&
      position >= displayedPosition && position - displayedPosition < 480;
    const nextAt = state.lines[index + 1]?.atMs ?? Infinity;
    const untilNextLine = (nextAt - linePosition) / (state.rate || 1);
    const duration = smooth ? Math.max(210, Math.min(460, untilNextLine * .86)) : 0;
    renderLyrics(state.lines, index, note, duration);
    lineKey = key;
    activeIndex = index;
    displayedTiming = state.lyricTimingId;
  }
  displayedPosition = position;
  updateFills(position);
  updateLyricWave(position);
}

function renderLyrics(lines, index, note, duration = 0) {
  const previous = duration ? new Map([...lyricRows].map(([id, row]) => [id, lyricPosition(row)])) : null;
  const exiting = previous && lyricRows.get(index - contextLines - 1);
  const exitCopy = exiting?.textContent ? exiting.cloneNode(true) : null;
  stopLyricMotion();
  fills = [];
  waveUnits = [];
  const next = new Map();
  for (const offset of lyricOffsets) {
    const id = index + offset;
    const row = lyricRows.get(id) ?? document.createElement('p');
    const line = lines[id];
    if (offset === 0) {
      current = row;
      row.id = 'current';
      row.className = note ? 'current lyric-note' : 'current';
      delete row.dataset.offset;
    } else {
      row.removeAttribute('id');
      row.className = 'adjacent' + (offset < 0 ? ' past' : '') + (Math.abs(offset) >= 2 ? ' distant' : '');
      row.dataset.offset = offset;
    }
    if (Math.abs(offset) <= 2 && line?.words?.length && !reducedMotion.matches) {
      const timed = renderTimedLine(row, line);
      waveUnits.push(...timed.units);
      if (offset === 0) fills = timed.fills;
    } else {
      row.textContent = line?.text ?? (offset === 0 ? note || (state?.song ? '' : '等待播放') : '');
    }
    next.set(id, row);
  }
  lyricRows = next;
  lyricStack.replaceChildren(...next.values());
  fitLyrics();
  if (previous) animateLyrics(previous, index, exitCopy, duration);
}

function renderTimedLine(row, line) {
  const fills = [];
  const units = [];
  row.replaceChildren();
  const timings = [];
  let position = 0;
  for (const word of line.words) {
    const found = line.text.indexOf(word.text, position);
    if (found < 0 || !word.text) continue;
    position = found + word.text.length;
    if (word.endMs > word.atMs) {
      timings.push({ from: found, to: position, start: word.atMs, end: word.endMs });
    }
  }

  let timingIndex = 0;
  function appendRange(parent, from, to) {
    while (from < to) {
      while (timings[timingIndex]?.to <= from) timingIndex++;
      const timing = timings[timingIndex];
      if (!timing || timing.from > from) {
        const stop = Math.min(to, timing?.from ?? to);
        parent.append(line.text.slice(from, stop));
        from = stop;
        continue;
      }
      const stop = Math.min(to, timing.to);
      const msPerCharacter = (timing.end - timing.start) / (timing.to - timing.from);
      const span = document.createElement('span');
      span.className = 'timed-word';
      span.textContent = line.text.slice(from, stop);
      parent.append(span);
      fills.push({ span, start: timing.start + (from - timing.from) * msPerCharacter,
        end: timing.start + (stop - timing.from) * msPerCharacter, percent: -1 });
      from = stop;
    }
  }

  // Keep Latin words together across provider syllable boundaries.
  const unitPattern = /\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’\u2010-][\p{Script=Latin}\p{M}]+)*|\p{Script=Han}[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]*/gu;
  position = 0;
  for (const match of line.text.matchAll(unitPattern)) {
    appendRange(row, position, match.index);
    position = match.index + match[0].length;
    const unit = document.createElement('span');
    const first = fills.length;
    appendRange(unit, match.index, position);
    if (fills.length === first) {
      row.append(...unit.childNodes);
      continue;
    }
    unit.className = 'lyric-unit';
    row.append(unit);
    const start = fills[first].start;
    const end = fills.at(-1).end;
    units.push({ unit, start, end, amount: 0 });
  }
  appendRange(row, position, line.text.length);
  return { fills, units };
}

function fitLyrics() {
  if (!current || !lyricStack.clientHeight) return;
  // Preserve the original five-line typography even when additional rows extend past the viewport.
  const first = lyricStack.querySelector('[data-offset="-2"]');
  const last = lyricStack.querySelector('[data-offset="2"]');
  lyricStack.style.setProperty('--lyric-scale', '1');
  for (const scale of [.91, .82, .73, .64, .55, .48, .42]) {
    if (last.offsetTop + last.offsetHeight - first.offsetTop <= lyricStack.clientHeight * .94 + 1) break;
    lyricStack.style.setProperty('--lyric-scale', scale);
  }
  lyricStack.scrollTop = Math.max(0, current.offsetTop - Math.max(0, (lyricStack.clientHeight - current.offsetHeight) / 2));
  lyricWaves = buildLyricWaves(waveUnits);
}

function sectionCorrection(position, duration, points) {
  if (!points.length || !(duration > 0)) return 0;
  let left = { atMs: 0, offsetMs: 0 };
  for (const right of [...points, { atMs: duration, offsetMs: 0 }]) {
    if (position <= right.atMs) {
      const mix = (position - left.atMs) / (right.atMs - left.atMs);
      return left.offsetMs + mix * (right.offsetMs - left.offsetMs);
    }
    left = right;
  }
  return 0;
}

function updateFills(position) {
  for (const fill of fills) {
    const percent = Math.round(100 * Math.min(1, Math.max(0, (position - fill.start) / (fill.end - fill.start))));
    if (percent === fill.percent) continue;
    fill.span.style.setProperty('--fill', percent / 100);
    fill.percent = percent;
  }
}

function buildLyricWaves(units) {
  const waves = [];
  let run = [];
  let row, fontSize, distance = 0;
  for (const item of units) {
    const previous = run.at(-1);
    // Restart the crest after long gaps so words settle during the silence.
    if (previous && item.start - previous.end > 2 * lyricWaveTailMs) {
      waves.push(run);
      run = [];
      distance = 0;
    }
    if (row !== item.unit.parentElement) {
      row = item.unit.parentElement;
      fontSize = parseFloat(getComputedStyle(row).fontSize);
    }
    const width = Math.max(.35, item.unit.offsetWidth / fontSize);
    item.center = distance + width / 2;
    item.peakAt = Math.max((item.start + item.end) / 2, (run.at(-1)?.peakAt ?? -Infinity) + 1);
    run.push(item);
    distance += width;
  }
  if (run.length) waves.push(run);
  return waves;
}

function lyricWaveCenter(run, position) {
  const first = run[0];
  const last = run.at(-1);
  const start = first.start - lyricWaveTailMs;
  const end = Math.max(last.end, last.peakAt) + lyricWaveTailMs;
  if (position < start || position >= end) return Infinity;
  let leftTime = start, leftX = first.center - lyricWaveRadius;
  const between = (time, x) => leftX + (x - leftX) * (position - leftTime) / (time - leftTime);
  for (const item of run) {
    if (position <= item.peakAt) return between(item.peakAt, item.center);
    leftTime = item.peakAt;
    leftX = item.center;
  }
  return between(end, last.center + lyricWaveRadius);
}

function updateLyricWave(position) {
  for (const run of lyricWaves) {
    const crest = lyricWaveCenter(run, position);
    for (const item of run) {
      const distance = Math.abs(item.center - crest);
      const height = distance < lyricWaveRadius ? Math.cos(Math.PI / 2 * distance / lyricWaveRadius) : 0;
      const amount = Math.round(height * 1000) / 1000;
      if (amount === item.amount) continue;
      item.unit.style.setProperty('--lyric-lift', amount);
      item.amount = amount;
    }
  }
}

function lyricPosition(row) {
  const rect = row.getBoundingClientRect();
  const computed = getComputedStyle(row);
  const fontSize = parseFloat(computed.fontSize);
  return {
    rect, center: rect.top + rect.height / 2, fontSize,
    scale: row.offsetWidth ? rect.width / row.offsetWidth : 1,
    opacity: computed.opacity, filter: computed.filter === 'none' ? 'blur(0px)' : computed.filter
  };
}

function animateLyrics(previous, index, exitCopy, duration) {
  const options = { duration, easing: 'cubic-bezier(.22,.68,.3,1)' };
  const target = new Map([...lyricRows].map(([id, row]) => [id, lyricPosition(row)]));
  const rowSpacing = (a, b) => Math.max(18, target.get(b).center - target.get(a).center);
  for (const [id, row] of lyricRows) {
    if (!row.textContent) continue;
    const end = target.get(id);
    const start = previous.get(id);
    const shift = start ? start.center - end.center : rowSpacing(index + 1, index + 2);
    const scale = start ? start.scale * start.fontSize / end.fontSize : 1;
    transitions.push(row.animate([
      { transform: 'translateY(' + shift + 'px) scale(' + scale + ')',
        opacity: start?.opacity ?? 0, filter: start?.filter ?? end.filter },
      { transform: 'translateY(0) scale(1)', opacity: end.opacity, filter: end.filter }
    ], options));
  }
  if (exitCopy) {
    const { rect, opacity, filter, fontSize, scale } = previous.get(index - contextLines - 1);
    const stack = lyricStack.getBoundingClientRect();
    exitCopy.classList.add('lyric-departing');
    exitCopy.setAttribute('aria-hidden', 'true');
    exitCopy.style.top = rect.top - stack.top + lyricStack.scrollTop + 'px';
    exitCopy.style.width = rect.width / scale + 'px';
    exitCopy.style.fontSize = fontSize * scale + 'px';
    lyricStack.append(exitCopy);
    departingLine = exitCopy;
    const animation = exitCopy.animate([
      { transform: 'translateY(0)', opacity, filter },
      { transform: 'translateY(-' + rowSpacing(index - 2, index - 1) + 'px)', opacity: 0, filter }
    ], options);
    animation.onfinish = () => {
      exitCopy.remove();
      if (departingLine === exitCopy) departingLine = undefined;
    };
    transitions.push(animation);
  }
}

function stopLyricMotion() {
  for (const animation of transitions) animation.cancel();
  transitions = [];
  departingLine?.remove();
  departingLine = undefined;
}

async function refreshState() {
  let delay = 200;
  try {
    const start = performance.now();
    const response = await fetch('/api/state', { signal: AbortSignal.timeout(2500) });
    if (response.ok) {
      const next = await response.json();
      const received = performance.now();
      syncPlaybackClock(next, start, received);
      state = next;
      sampleTime = received;
      const nextAppearance = JSON.stringify(state.lyricAppearance);
      if (state.lyricAppearance && nextAppearance !== appearanceKey) {
        applyLyricAppearance(lyricView, state.lyricAppearance);
        appearanceKey = nextAppearance;
      }
      setImage('cover', state.cover);
      updateAlbumFlow(state.cover, document.getElementById('cover'));
      setImage('wallpaper', state.wallpaper);
    } else delay = 650;
  } catch {
    delay = 650;
  } finally {
    setTimeout(refreshState, delay);
  }
}

async function keepAwake() {
  if (!navigator.wakeLock || document.hidden || (wakeLock && !wakeLock.released)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); }
  catch { /* The browser or battery mode can decline. */ }
}

document.addEventListener('visibilitychange', keepAwake);
reducedMotion.addEventListener('change', () => { lineKey = undefined; });
new ResizeObserver(() => {
  if (shownMode !== 'lyrics') return;
  stopLyricMotion();
  fitLyrics();
}).observe(lyricStack);
document.addEventListener('click', async event => {
  if (event.target.closest('button, a')) return;
  if (!document.fullscreenElement) {
    try { await document.documentElement.requestFullscreen?.(); }
    catch { /* The browser may disallow full screen. */ }
  }
  keepAwake();
});
function renderFrame(now) {
  refreshScreen(now);
  requestAnimationFrame(renderFrame);
}
requestAnimationFrame(renderFrame);
refreshState();
keepAwake();

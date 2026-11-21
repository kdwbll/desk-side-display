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

function refreshScreen(now) {
  const elapsed = now - sampleTime;
  const defaultMode = !state || (state.mode === 'lyrics' && elapsed > 5000) ? 'clock' : state.mode;
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

  if (!state || elapsed > 5000) {
    if (lineKey !== 'offline') {
      renderLyrics([], -1, '等待 Windows 连接');
      lineKey = 'offline';
      activeIndex = undefined;
    }
    return;
  }
  const playback = Math.min(state.durationMs ?? Infinity,
    state.positionMs + (state.playing ? Math.min(elapsed, 1200) * state.rate : 0));
  const position = Math.max(0, playback + (state.lyricOffsetMs ?? 0) +
    sectionCorrection(playback, state.durationMs, state.lyricTimingPoints ?? []));
  let low = 0;
  let high = state.lines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (state.lines[middle].atMs <= position) low = middle + 1;
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
    const untilNextLine = (nextAt - position) / (state.rate || 1);
    const duration = smooth ? Math.max(210, Math.min(460, untilNextLine * .86)) : 0;
    renderLyrics(state.lines, index, note, duration);
    lineKey = key;
    activeIndex = index;
    displayedTiming = state.lyricTimingId;
  }
  displayedPosition = position;
  updateFills(position);
}

function renderLyrics(lines, index, note, duration = 0) {
  const previous = duration ? new Map([...lyricRows].map(([id, row]) => [id, lyricPosition(row)])) : null;
  const exiting = previous && lyricRows.get(index - contextLines - 1);
  const exitCopy = exiting?.textContent ? exiting.cloneNode(true) : null;
  stopLyricMotion();
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
      showCurrentLine(line, note);
    } else {
      row.removeAttribute('id');
      row.className = 'adjacent' + (offset < 0 ? ' past' : '') + (Math.abs(offset) >= 2 ? ' distant' : '');
      row.dataset.offset = offset;
      row.textContent = line?.text ?? '';
    }
    next.set(id, row);
  }
  lyricRows = next;
  lyricStack.replaceChildren(...next.values());
  fitLyrics();
  if (previous) animateLyrics(previous, index, exitCopy, duration);
}

function showCurrentLine(line, note) {
  fills = [];
  current.replaceChildren();
  if (!line?.words?.length || reducedMotion.matches) {
    current.textContent = line?.text ?? (note || (state?.song ? '' : '等待播放'));
    return;
  }
  let position = 0;
  for (const word of line.words) {
    const found = line.text.indexOf(word.text, position);
    if (found < 0) continue;
    current.append(document.createTextNode(line.text.slice(position, found)));
    const span = document.createElement('span');
    span.className = 'timed-word';
    span.textContent = word.text;
    current.append(span);
    fills.push({ span, start: word.atMs, end: word.endMs, percent: -1 });
    position = found + word.text.length;
  }
  current.append(document.createTextNode(line.text.slice(position)));
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
      const received = performance.now();
      state = await response.json();
      sampleTime = (start + received) / 2;
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

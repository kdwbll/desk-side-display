'use strict';

const screens = [...document.querySelectorAll('.screen')];
const time = document.getElementById('time');
const date = document.getElementById('date');
const title = document.getElementById('track');
const artist = document.getElementById('artist');
const current = document.getElementById('current');
const lyricStack = document.querySelector('.lyric-stack');
const lyricView = document.getElementById('lyrics');
const surroundingLines = [...lyricStack.querySelectorAll('[data-offset]')].map(element => ({
  element,
  offset: Number(element.dataset.offset)
}));
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
let activeIndex = -1;
let displayedSong;
let displayedPosition = 0;
let shownMode;
let clockMinute;
let fills = [];
let transitions = [];
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
    activeIndex = -1;
  }

  if (!state || elapsed > 5000) {
    if (lineKey !== 'offline') {
      surroundingLines.forEach(({ element }) => { element.textContent = ''; });
      current.replaceChildren();
      current.classList.add('lyric-note');
      current.textContent = '等待 Windows 连接';
      fills = [];
      lineKey = 'offline';
      activeIndex = -1;
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
  const surroundings = surroundingLines.map(({ offset }) => state.lines[index + offset]?.text ?? '');
  const note = state.lines.length ? '' : lyricNotes[state.lyricsStatus] ?? '';
  const key = JSON.stringify([song?.id, line, surroundings, note]);
  if (lineKey !== key) {
    const smooth = lineKey && index > 0 && index === activeIndex + 1 &&
      position >= displayedPosition && position - displayedPosition < 480;
    surroundingLines.forEach(({ element }, i) => { element.textContent = surroundings[i]; });
    showCurrentLine(line, note);
    transitions.forEach(animation => animation.cancel());
    fitLyrics();
    transitions = smooth && !reducedMotion.matches ? animateLines() : [];
    lineKey = key;
    activeIndex = index;
  }
  displayedPosition = position;
  updateFills(position);
}

function showCurrentLine(line, note) {
  fills = [];
  current.replaceChildren();
  current.classList.toggle('lyric-note', Boolean(note));
  if (!line?.words?.length || reducedMotion.matches) {
    current.textContent = line?.text ?? (state.song ? note : '等待播放');
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
  lyricStack.style.setProperty('--lyric-scale', '1');
  for (const scale of [.91, .82, .73, .64, .55, .48, .42]) {
    if (lyricStack.scrollHeight <= lyricStack.clientHeight + 1) break;
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
    fill.span.style.setProperty('--fill', percent + '%');
    fill.percent = percent;
  }
}

function animateLines() {
  const options = { duration: 260, easing: 'cubic-bezier(.2,.72,.28,1)' };
  const moves = surroundingLines.filter(({ element }) => element.textContent).map(({ element, offset }) =>
    element.animate([
      { transform: 'translateY(.8em)', ...(offset === 2 ? { opacity: .03 } : {}) },
      { transform: 'translateY(0)' }
    ], options));
  moves.push(current.animate([
    { transform: 'translateY(.34em)', opacity: .86 },
    { transform: 'translateY(0)', opacity: 1 }
  ], options));
  return moves;
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
window.addEventListener('resize', () => { if (shownMode === 'lyrics') fitLyrics(); });
document.addEventListener('click', async event => {
  if (event.target.closest('button')) return;
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

'use strict';

const usb = document.getElementById('usb');
const usbSetup = document.getElementById('usb-setup');
const adbSetup = document.getElementById('adb-setup');
const installAdb = document.getElementById('install-adb');
const exitDisplay = document.getElementById('exit-display');
const usbSetupMessage = document.getElementById('usb-setup-message');
const playbackCover = document.getElementById('control-cover');
playbackCover.addEventListener('load', () => { playbackCover.hidden = false; });
playbackCover.addEventListener('error', () => { playbackCover.hidden = true; });
const consoleLinks = document.querySelectorAll('.console-rail nav a');
function markConsoleLocation() {
  const current = location.hash || '#display';
  for (const link of consoleLinks) {
    if (link.hash === current) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}
window.addEventListener('hashchange', markConsoleLocation);
markConsoleLocation();
const song = document.getElementById('song');
const timeline = document.getElementById('timeline');
const musicSource = document.getElementById('music-source');
const musicSourceStatus = document.getElementById('music-source-status');
const playerNames = { apple: 'Apple Music', netease: '网易云音乐' };
const idle = document.getElementById('idle');
const photo = document.getElementById('photo-file');
const lyrics = document.getElementById('lyrics-file');
const message = document.getElementById('message');
const modes = [...document.querySelectorAll('[data-mode]')];
const playback = [...document.querySelectorAll('[data-playback]')];
const adjustments = [...document.querySelectorAll('[data-adjust]')];
const offsetLabel = document.getElementById('offset');
const pointButton = document.getElementById('timing-point');
const usbMessages = {
  checking: '正在检查 USB 连接',
  ready: 'USB 已连接',
  unauthorized: '请在手机上允许 USB 调试',
  disconnected: '等待手机通过 USB 连接',
  offline: '手机暂时离线，请解锁后重新插拔',
  multiple: '检测到多部设备，请只留一部',
  'tools-missing': '未找到 Android Platform-Tools',
  'port-in-use': '手机端口 8765 已被占用',
  error: 'USB 转发失败，请重新插拔'
};
const lyricsMessages = {
  'metadata-incomplete': '缺少歌曲时长或歌手，无法在线匹配',
  'static-lyrics': '静态歌词',
  searching: '正在查找同步歌词',
  missing: '未找到同步歌词，可导入 LRC',
  unavailable: '在线歌词服务暂不可用，可导入 LRC',
  instrumental: '纯音乐',
  local: '本地歌词',
  online: 'LRCLIB 逐句时间轴',
  'word-online': 'AMLL 逐字时间轴',
  'word-lrclib': 'LRCLIB 逐字时间轴',
  'word-netease': '网易云逐字时间轴',
  'line-netease': '网易云逐句时间轴',
  'word-apple': 'Apple Music 逐字时间轴',
  'word-kugou': '酷狗逐字时间轴',
  'word-liriqo': 'LiriQo 逐字时间轴',
  waiting: ''
};
let state;
let busy = false;
let point;

function durationText(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function render() {
  const status = state?.control;
  usbSetup.hidden = !status?.standalone;
  adbSetup.hidden = status?.usb !== 'tools-missing';
  if (!status) {
    usb.dataset.connected = 'false';
    modes.forEach(button => { button.disabled = true; });
    playback.forEach(button => { button.disabled = true; });
    adjustments.forEach(button => { button.disabled = true; });
    pointButton.disabled = true;
    offsetLabel.textContent = '歌词校准';
    idle.disabled = photo.disabled = lyrics.disabled = musicSource.disabled = true;
    musicSourceStatus.textContent = '';
    return;
  }
  usb.textContent = usbMessages[status.usb] ?? usbMessages.error;
  usb.dataset.connected = String(status.usb === 'ready');
  const coverUrl = state.cover ?? '';
  if (playbackCover.getAttribute('src') !== coverUrl) {
    playbackCover.hidden = true;
    if (coverUrl) playbackCover.src = coverUrl;
    else playbackCover.removeAttribute('src');
  }
  const sourceName = playerNames[state.musicSource];
  const choosing = status.status === 'choose-source';
  for (const option of musicSource.options) {
    const source = status.musicSources?.find(item => item.id === option.value);
    if (!source) continue;
    const suffix = source.playing ? ' · 播放中' : source.connected ? '' : ' · 未连接';
    const label = playerNames[source.id] + suffix;
    if (option.textContent !== label) option.textContent = label;
  }
  musicSource.value = status.preferences.musicSource ?? 'auto';
  musicSource.disabled = busy;
  const sourceHint = choosing ? '两个播放器都在播放，请选择播放源。'
    : sourceName && musicSource.value === 'auto' ? '当前跟随 ' + sourceName : '';
  if (musicSourceStatus.textContent !== sourceHint) musicSourceStatus.textContent = sourceHint;
  song.textContent = state.song ? [state.song.title, state.song.artist].filter(Boolean).join(' · ')
    : choosing ? '' : status.status === 'error' ? '无法读取 Windows 媒体会话'
    : sourceName ? '等待 ' + sourceName + ' 播放' : '等待 Windows 播放器';
  const progress = state.positionMs == null ? (state.song ? (sourceName ?? '当前播放源') + '未提供播放进度' : '')
    : state.durationMs == null ? durationText(state.positionMs)
    : durationText(state.positionMs) + ' / ' + durationText(state.durationMs);
  const timing = status.lyricsStatus === 'local' && state.lines.some(line => line.words?.length)
    ? '本地逐字时间轴' : lyricsMessages[status.lyricsStatus];
  const lineTimed = state.lines.length > 0 && !state.lines.some(line => line.words?.length) ? '逐句高亮' : '';
  timeline.textContent = [progress, state.positionEstimated ? '估算进度' : '', timing, lineTimed].filter(Boolean).join(' · ');
  const presets = status.availablePresets ?? ['clock', 'photo'];
  for (const option of idle.options) {
    option.hidden = option.value !== 'hardware' && !presets.includes(option.value);
    option.disabled = option.hidden;
  }
  idle.value = status.preferences.idle;
  photo.closest('.file-picker').hidden = !presets.includes('photo');
  for (const button of modes) {
    button.hidden = ['clock', 'photo'].includes(button.dataset.mode) && !presets.includes(button.dataset.mode);
    button.disabled = busy || button.hidden;
    button.setAttribute('aria-pressed', String(button.dataset.mode === status.preferences.mode));
  }
  idle.disabled = photo.disabled = busy;
  lyrics.disabled = busy || !state.song;
  if (point && (point.song !== state.song?.id || point.source !== state.musicSource ||
      point.timingId !== state.lyricTimingId)) point = undefined;
  const offset = selectedOffset();
  const resetOffset = defaultOffset();
  const direction = !point && offset === resetOffset && offset > 0 ? '默认提前'
    : offset === 0 ? '歌词校准' : offset > 0 ? '歌词提前' : '歌词延后';
  const scope = point ? durationText(point.atMs) + ' 分段 · ' : '全曲 · ';
  offsetLabel.textContent = scope + direction + ' ' + (Math.abs(offset) / 1000).toFixed(1) + ' 秒';
  pointButton.disabled = busy || state.positionEstimated || !state.song || !state.lines.length ||
    state.positionMs == null || !(state.durationMs > 500);
  pointButton.textContent = point ? '回到全曲校准' : '校准当前位置';
  pointButton.setAttribute('aria-pressed', String(Boolean(point)));
  for (const button of adjustments) {
    const delta = Number(button.dataset.adjust);
    button.disabled = busy || state.positionEstimated || !state.song || state.positionMs == null || !state.lines.length ||
      (button.dataset.adjust === 'reset' ? offset === resetOffset : Math.abs(offset + delta) > 10000);
  }
  const allowed = { previous: status.canPrevious, toggle: status.canToggle, next: status.canNext };
  for (const button of playback) {
    button.disabled = busy || !allowed[button.dataset.playback];
    if (button.dataset.playback === 'toggle') button.textContent = state.playing ? '暂停' : '播放';
  }
}

function selectedOffset() {
  if (!point) return state.lyricOffsetMs ?? defaultOffset();
  return state.lyricTimingPoints?.find(item => item.atMs === point.atMs)?.offsetMs ?? 0;
}

function defaultOffset() {
  return point ? 0 : state.control.defaultLyricOffsetMs ?? 0;
}

async function fetchState() {
  const response = await fetch('/api/state', { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw Error('无法读取副屏状态。');
  state = await response.json();
  document.dispatchEvent(new CustomEvent('playback-cover', { detail: state.cover }));
  render();
}

async function poll() {
  try { if (!busy) await fetchState(); }
  catch {
    usb.textContent = '连接 Windows 服务失败，请确认启动窗口仍在运行';
    state = undefined;
    render();
  } finally {
    setTimeout(poll, 900);
  }
}

async function send(path, body, timeoutMs = 8000) {
  const headers = { 'X-DeskSide-Control': '1' };
  if (typeof body === 'string') headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const type = response.headers.get('Content-Type') ?? '';
    const reason = type.startsWith('text/plain') ? await response.text() : '';
    throw Error(reason || '操作失败，请检查服务后重试。');
  }
  if (response.status !== 204) return response.json();
}

function showUsbSetupMessage(text) {
  usbSetupMessage.textContent = text;
  usbSetupMessage.hidden = !text;
}

installAdb.addEventListener('click', async () => {
  installAdb.disabled = true;
  showUsbSetupMessage('正在从 Android 官网下载 USB 工具…');
  try {
    await send('/api/usb/install', undefined, 95_000);
    showUsbSetupMessage('USB 工具已就绪，请连接并解锁手机。');
  } catch (error) {
    showUsbSetupMessage(error.message);
  } finally {
    installAdb.disabled = false;
  }
});

exitDisplay.addEventListener('click', async () => {
  exitDisplay.disabled = true;
  try {
    await send('/api/exit');
    location.replace('about:blank');
  } catch (error) {
    showUsbSetupMessage(error.message);
    exitDisplay.disabled = false;
  }
});

async function act(callback) {
  if (busy || !state?.control) return;
  busy = true;
  message.textContent = '';
  render();
  try {
    const confirmation = await callback();
    await fetchState();
    message.textContent = confirmation ?? '';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    busy = false;
    render();
  }
}

function setPreference(change) {
  const { mode, idle } = state.control.preferences;
  return send('/api/settings', JSON.stringify({ mode, idle, ...change }));
}

for (const button of modes) {
  button.addEventListener('click', () => act(() => setPreference({ mode: button.dataset.mode })));
}
idle.addEventListener('change', () => {
  const selection = idle.value;
  act(() => setPreference({ idle: selection }));
});
musicSource.addEventListener('change', () => {
  const source = musicSource.value;
  act(() => send('/api/music-source', JSON.stringify({ source })));
});
for (const button of playback) {
  button.addEventListener('click', () => act(() => {
    const query = state.musicSource ? '?source=' + encodeURIComponent(state.musicSource) : '';
    return send('/api/playback/' + button.dataset.playback + query);
  }));
}
for (const button of adjustments) {
  button.addEventListener('click', () => act(() => {
    const offset = selectedOffset();
    const offsetMs = button.dataset.adjust === 'reset' ? defaultOffset() : offset + Number(button.dataset.adjust);
    return send('/api/lyrics/offset', JSON.stringify({
      song: state.song.id, source: state.musicSource, timingId: state.lyricTimingId, offsetMs, atMs: point?.atMs
    }));
  }));
}
pointButton.addEventListener('click', () => {
  if (point) point = undefined;
  else {
    const position = Math.round(state.positionMs);
    const nearest = state.lyricTimingPoints?.reduce((best, item) =>
      !best || Math.abs(item.atMs - position) < Math.abs(best.atMs - position) ? item : best, undefined);
    const atMs = nearest && Math.abs(nearest.atMs - position) <= 2500 ? nearest.atMs :
      Math.max(250, Math.min(Math.floor(state.durationMs) - 250, Math.round(position / 250) * 250));
    point = { song: state.song.id, source: state.musicSource, timingId: state.lyricTimingId, atMs };
  }
  render();
});
photo.addEventListener('change', () => {
  const file = photo.files[0];
  if (!file) return;
  photo.value = '';
  act(async () => {
    const form = new FormData();
    form.append('file', file);
    await send('/api/wallpaper', form);
    await setPreference({ mode: 'photo' });
    return '相框图片已更新。';
  });
});
lyrics.addEventListener('change', () => {
  const file = lyrics.files[0];
  const songId = state?.song?.id;
  const source = state?.musicSource;
  if (!file || !songId) return;
  lyrics.value = '';
  act(async () => {
    const form = new FormData();
    form.append('file', file);
    form.append('song', songId);
    if (source) form.append('source', source);
    await send('/api/lyrics', form);
    return '已为当前歌曲保存歌词。';
  });
});
poll();

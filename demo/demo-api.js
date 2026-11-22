import { appearancePresets, defaultAppearance, initialLayout, metrics, samples, tracks } from './demo-data.js';

const durationMs = 31600;
const defaultOffset = 0;
const allowedImages = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  gif: ['image/gif']
};
const json = value => Response.json(value);
const ok = () => new Response(null, { status: 204 });
const error = (message, status = 400) =>
  new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

function clockTime(value) {
  if (/^\d+(?:\.\d+)?s$/.test(value)) return Math.round(parseFloat(value) * 1000);
  if (!/^\d+(?::\d{1,2}){1,2}(?:\.\d+)?$/.test(value)) return NaN;
  return Math.round(value.split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0) * 1000);
}

function parseLyrics(source) {
  if (source.trimStart().startsWith('<')) {
    const xml = new DOMParser().parseFromString(source, 'application/xml');
    return [...xml.getElementsByTagNameNS('*', 'p')].flatMap(line => {
      const atMs = clockTime(line.getAttribute('begin') ?? '');
      const text = line.textContent.trim();
      if (!Number.isFinite(atMs) || !text) return [];
      const words = [...line.getElementsByTagNameNS('*', 'span')].flatMap(word => {
        const start = clockTime(word.getAttribute('begin') ?? '');
        const end = clockTime(word.getAttribute('end') ?? '');
        return Number.isFinite(start) && end > start ? [{ text: word.textContent, atMs: start, endMs: end }] : [];
      });
      return [{ atMs, text, words }];
    }).sort((a, b) => a.atMs - b.atMs);
  }
  return source.split(/\r?\n/).flatMap(line => {
    const stamps = [...line.matchAll(/\[(\d+:\d{1,2}(?:\.\d+)?)\]/g)];
    const text = line.slice(stamps.at(-1)?.index + (stamps.at(-1)?.[0].length ?? 0)).trim();
    return text ? stamps.map(([, time]) => ({ atMs: clockTime(time), text, words: [] })) : [];
  }).sort((a, b) => a.atMs - b.atMs);
}

function manifestValid(manifest) {
  if (!manifest || ![1, 2].includes(manifest.version) || typeof manifest.name !== 'string' ||
      manifest.name.length > 24 || !['small', 'medium', 'large'].includes(manifest.size) ||
      !/^#[\da-f]{6}$/i.test(manifest.color)) return false;
  if (manifest.version === 1) return typeof manifest.template === 'string';
  return manifest.blocks === undefined || (Array.isArray(manifest.blocks) && manifest.blocks.length <= 16 &&
    manifest.blocks.every(block => block && typeof block.kind === 'string' &&
      (block.transparency == null || (block.kind === 'weather' && Number.isInteger(block.transparency) &&
        block.transparency >= 0 && block.transparency <= 100))));
}

function saveImage(form, types) {
  const file = form?.get?.('file');
  if (!file?.size || file.size > 8 * 1024 * 1024 || !types.includes(file.type)) return null;
  return URL.createObjectURL(file);
}

export async function createDemo(notify) {
  let layout = await initialLayout();
  const media = new Map(Object.entries(samples));
  let preferences = { mode: 'photo', idle: 'clock' };
  let musicSource = 'auto';
  let appearance = { ...defaultAppearance };
  let presets = appearancePresets();
  let sources = { actions: true, clipboard: true, notifications: false, window: false, interfaces: [], apps: {} };
  let sourcesRevision = 0;
  let displayRevision = 0;
  let wallpaper = samples.mountain;
  const now = performance.now();
  const players = {
    apple: { trackIndex: 0, playing: true, anchor: now, lastPlaying: now, position: 6790 },
    netease: { trackIndex: 1, playing: false, anchor: now, lastPlaying: -Infinity, position: 0 }
  };
  const imports = new Map();
  const offsets = new Map();
  const points = new Map();

  const selectedSource = () => {
    if (musicSource !== 'auto') return musicSource;
    if (players.apple.playing && players.netease.playing) return null;
    if (players.apple.playing) return 'apple';
    if (players.netease.playing) return 'netease';
    return players.netease.lastPlaying > players.apple.lastPlaying ? 'netease' : 'apple';
  };
  const currentTrack = () => tracks[players[selectedSource()]?.trackIndex];
  const widgetFor = id => layout.pages.flatMap(page => page.widgets).find(widget => widget.id === id);
  const appearanceState = () => ({ appearance, presets });
  const sourceState = () => ({ config: sources, notificationKey: null });

  function positionAt(player, now) {
    return Math.min(durationMs, player.position + (player.playing ? now - player.anchor : 0));
  }

  function transport(player, action, now = performance.now()) {
    if (action === 'toggle') {
      player.position = positionAt(player, now);
      player.playing = !player.playing;
      player.lastPlaying = now;
    } else {
      player.trackIndex = (player.trackIndex + (action === 'next' ? 1 : -1) + tracks.length) % tracks.length;
      player.position = 0;
    }
    player.anchor = now;
  }

  function controlPlayback(action, expected) {
    const source = selectedSource();
    if (!source) return error('两个播放器都在播放，请先在控制面板选择播放源。', 409);
    if (expected && expected !== source) return error('播放源已切换，请重试。', 409);
    transport(players[source], action);
    return ok();
  }

  function state(view) {
    const now = performance.now();
    for (const player of Object.values(players)) {
      if (!player.playing) continue;
      player.lastPlaying = now;
      if (positionAt(player, now) >= durationMs) transport(player, 'next', now);
    }
    const source = selectedSource();
    const player = players[source];
    const track = currentTrack();
    const imported = imports.get(track?.id);
    const calibrationKey = source + ':' + track?.id;
    const availablePresets = layout.pages.filter(page => page.kind === 'clock' || page.kind === 'photo').map(page => page.id);
    const idle = ['hardware', ...availablePresets].includes(preferences.idle)
      ? preferences.idle : availablePresets[0] ?? 'hardware';
    const selected = ['auto', 'lyrics', ...availablePresets].includes(preferences.mode) ? preferences.mode : 'auto';
    const mode = selected === 'auto' ? (player && (player.playing || now - player.lastPlaying < 15000) ? 'lyrics' : idle) : selected;
    const capabilities = { canPrevious: Boolean(player), canToggle: Boolean(player), canNext: Boolean(player) };
    return {
      mode, displayRevision, musicSource: source,
      song: track ? { id: track.id, title: track.title, artist: '桌面副屏演示' } : null,
      playing: player?.playing ?? false, rate: 1, positionMs: player ? positionAt(player, now) : null,
      positionEstimated: source === 'netease',
      durationMs: player ? durationMs : null, playback: capabilities,
      cover: track?.cover, wallpaper, lines: imported?.lines ?? track?.lyrics ?? [],
      lyricsStatus: source ? 'local' : 'choose-source', lyricTimingId: imported?.id ?? track?.id, lyricAppearance: appearance,
      lyricOffsetMs: offsets.get(calibrationKey) ?? defaultOffset,
      lyricTimingPoints: points.get(calibrationKey) ?? [],
      control: view === 'control' ? {
        preferences: { mode: selected, idle, musicSource }, availablePresets, usb: 'ready',
        musicSources: Object.entries(players).map(([id, item]) => ({ id, connected: true, playing: item.playing })),
        status: source ? 'ready' : 'choose-source', lyricsStatus: source ? 'local' : 'waiting',
        defaultLyricOffsetMs: defaultOffset, ...capabilities
      } : null
    };
  }

  function widgetData() {
    return {
      'weather.temperature': 16, 'weather.feels': 14, 'weather.code': 0, 'weather.wind': 3,
      'weather.humidity': 54, 'weather.day': true, 'weather.place': sources.weatherPlace || '示例地点',
      'weather.configured': true, 'network.connected': true, 'volume.level': 44,
      'clipboard.sequence': sources.clipboard ? 1 : null,
      'clipboard.text': sources.clipboard ? '欢迎体验桌面副屏' : null,
      'clipboard.history': sources.clipboard ? [
        { id: 'demo-text', kind: 'text', text: '欢迎体验桌面副屏', copiedAt: '2026-01-01T10:00:00Z' }
      ] : []
    };
  }

  function widgetAction(path, expected) {
    const [, id, operation, action] = path.split('/').slice(2);
    const widget = widgetFor(id);
    if (operation === 'press' && widget?.type === 'shortcut' && layout.shortcutsEnabled) {
      notify('模拟发送快捷键 · ' + widget.keys);
    } else if (operation === 'open-note' && widget?.type === 'text' && sources.actions) {
      notify('模拟操作 · 在 Windows 桌面新建便签.txt 并打开');
    } else if (operation === 'media' && widget?.type === 'music' && sources.actions &&
      ['previous', 'next', 'toggle'].includes(action)) {
      return controlPlayback(action, expected);
    } else if (operation === 'action' && widget?.type === 'custom' && sources.actions) {
      notify('模拟执行 · ' + (widget.name || '自定义组件'));
    } else {
      return error('请在控制面板启用相应的组件动作。', 403);
    }
    return ok();
  }

  function saveLayout(body) {
    if (body?.revision !== layout.revision) return error('界面已有更新，请重新读取。', 409);
    if (!Array.isArray(body.pages) || body.pages.length < 2 || body.pages.length > 10 ||
      !body.pages.every(page => Array.isArray(page?.widgets) && page.widgets.length <= 8 &&
        ['fixed', 'album'].includes(page.backgroundMode ?? 'fixed')) ||
      !['lyrics', 'hardware'].every(id => body.pages.some(page => page.id === id)))
      return error('需保留歌词和硬件监控，最多 10 页，每页最多 8 张卡片。');
    const library = new Map(layout.widgetLibrary.map(item => [item.widget || item.name, item]));
    for (const page of body.pages) {
      for (const widget of page.widgets) {
        if (widget.type !== 'custom') continue;
        if (!manifestValid(widget.manifest)) return error('自定义组件格式无效。');
        const item = { ...widget.manifest, name: widget.name, size: widget.size, color: widget.color };
        library.set(item.widget || item.name, item);
      }
    }
    layout = { ...body, revision: layout.revision + 1, widgetLibrary: [...library.values()] };
    return json(layout);
  }

  function changePreset(path, body) {
    if (path === '/api/appearance/presets') {
      const name = body?.name?.trim();
      if (!name || name.length > 24 || !body.appearance) return error('请输入有效的预设名称。');
      const existing = presets.find(item => item.id === body.id);
      if (existing) Object.assign(existing, { name, appearance: body.appearance });
      else if (presets.length < 10) presets.push({ id: crypto.randomUUID(), name, appearance: body.appearance });
      else return error('最多可保存 10 组预设。');
    } else {
      const [, id, action] = path.split('/').slice(3);
      const preset = presets.find(item => item.id === id);
      if (!preset) return error('这个预设已移除。', 404);
      if (action === 'apply') appearance = preset.appearance;
      if (action === 'delete') presets = presets.filter(item => item.id !== id);
    }
    return json(appearanceState());
  }

  async function request(input, options, view) {
    const url = new URL(input, location.href);
    const path = url.pathname;
    const expected = url.searchParams.get('source');
    if (options?.method !== 'POST') {
      switch (path) {
        case '/api/state': return json(state(view));
        case '/api/pages': return json({ layout, maxPages: 10, shortcutCapability: 'browser-demo', actionsEnabled: sources.actions, sourcesRevision });
        case '/api/appearance': return json(appearanceState());
        case '/api/widget-sources': return json(sourceState());
        case '/api/widget-data': return json(widgetData());
        case '/api/metrics': return json(metrics);
        default: return error('演示接口不存在。', 404);
      }
    }
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    if (path.startsWith('/api/widgets/')) return widgetAction(path, expected);
    if (path.startsWith('/api/appearance/presets')) return changePreset(path, body);
    if (path.startsWith('/api/playback/')) {
      const action = path.split('/').at(-1);
      if (!['previous', 'next', 'toggle'].includes(action)) return error('播放操作无效。');
      return controlPlayback(action, expected);
    }
    if (path.startsWith('/api/widget-images/')) {
      const types = allowedImages[path.split('/').at(-1)] ?? [];
      const url = saveImage(body, types);
      if (!url) return error('请选择格式正确、8 MB 以内的图片。');
      const id = crypto.randomUUID();
      media.set(id, url);
      return json({ id });
    }
    switch (path) {
      case '/api/music-source':
        if (!['auto', ...Object.keys(players)].includes(body?.source)) return error('无效的播放源。');
        musicSource = body.source;
        return ok();
      case '/api/settings':
        preferences = body;
        displayRevision++;
        return ok();
      case '/api/appearance':
        appearance = body;
        return json(appearanceState());
      case '/api/widget-sources':
        sources = body;
        sourcesRevision++;
        return json(sourceState());
      case '/api/pages': return saveLayout(body);
      case '/api/pages/validate-widget':
        return manifestValid(body) ? json(body) : error('请选择符合 v1 或 v2 规范的组件 JSON。');
      case '/api/wallpaper': {
        const url = saveImage(body, [...allowedImages.image, ...allowedImages.gif]);
        if (!url) return error('请选择 8 MB 以内的 JPG、PNG、WebP 或 GIF。');
        if (wallpaper.startsWith('blob:')) URL.revokeObjectURL(wallpaper);
        wallpaper = url;
        return ok();
      }
      case '/api/lyrics': {
        const file = body?.get?.('file');
        const track = currentTrack();
        if (!track || body.get('song') !== track.id || (body.has('source') && body.get('source') !== selectedSource()))
          return error('歌曲已切换。请确认正在播放的歌曲后重试。', 409);
        if (!file?.size || file.size > 256 * 1024) return error('请选择 256 KB 以内的 LRC 或 TTML。');
        const lyrics = parseLyrics(await file.text());
        if (!lyrics.length) return error('文件中没有带时间戳的歌词。');
        imports.set(track.id, { id: crypto.randomUUID(), lines: lyrics });
        return ok();
      }
      case '/api/lyrics/offset': {
        const id = currentTrack()?.id;
        if (!id || body?.song !== id || (body.source && body.source !== selectedSource()))
          return error('歌曲已切换，请重新校准。', 409);
        const source = selectedSource();
        if (source === 'netease') return error('校准需要播放器提供实际进度。', 409);
        const key = source + ':' + id;
        if (!Number.isFinite(body?.offsetMs) || Math.abs(body.offsetMs) > 10000) return error('校准超出范围。');
        if (Number.isFinite(body.atMs)) {
          const existing = (points.get(key) ?? []).filter(item => item.atMs !== body.atMs);
          if (body.offsetMs) existing.push({ atMs: body.atMs, offsetMs: body.offsetMs });
          points.set(key, existing.sort((a, b) => a.atMs - b.atMs));
        } else offsets.set(key, body.offsetMs);
        return ok();
      }
      default: return error('演示接口不存在。', 404);
    }
  }

  return { request, media: id => media.get(id) ?? '' };
}

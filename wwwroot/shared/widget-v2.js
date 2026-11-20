'use strict';

window.widgetV2 = (() => {
  const { node, metrics } = deskWidgets;
  const token = /\{\{([a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*)\}\}/g;
  const actionsByTile = new WeakMap();
  const icons = {
    clock: '◷', battery: '▰', network: '◉', volume: '♪', notification: '◈',
    file: '▤', image: '▧', sun: '☀', cloud: '☁', arrow: '↗', music: '♫'
  };
  const units = {
    ...Object.fromEntries(Object.entries(metrics).map(([id, [, unit]]) => [id, unit])),
    'power.percent': '%', 'volume.percent': '%', 'weather.temperature': '°C', 'weather.wind': ' km/h',
    'network.up': ' B/s', 'network.down': ' B/s', 'music.positionms': ' ms', 'music.durationms': ' ms'
  };
  const serverGroups = new Set(['clipboard', 'notification', 'window', 'volume', 'power', 'network', 'weather', 'api']);
  const frames = {
    fade: [{ opacity: .25 }, { opacity: 1 }],
    pulse: [{ opacity: 1 }, { opacity: .62 }, { opacity: 1 }],
    slide: [{ opacity: .4, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
    bounce: [{ transform: 'translateY(0)' }, { transform: 'translateY(-5px)' }, { transform: 'translateY(0)' }]
  };
  const formatters = new Map();

  function dateFormatter(locale, options) {
    const key = JSON.stringify([locale, options]);
    if (formatters.has(key)) return formatters.get(key);
    let formatter;
    try { formatter = new Intl.DateTimeFormat(locale, options); }
    catch { formatter = new Intl.DateTimeFormat('zh-CN', { ...options, timeZone: undefined }); }
    if (formatters.size >= 64) formatters.clear();
    formatters.set(key, formatter);
    return formatter;
  }

  function localClock(now, timeZone) {
    const options = { timeZone, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' };
    const parts = dateFormatter('en-US', options).formatToParts(now);
    const get = name => Number(parts.find(part => part.type === name)?.value) || 0;
    return { h: get('hour'), m: get('minute'), s: get('second') + now.getMilliseconds() / 1000 };
  }

  function duration(value) {
    if (!Number.isFinite(value)) return null;
    const seconds = Math.max(0, Math.floor(value / 1000));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }

  function raw(source, { now, state, hardware, data }, format) {
    if (!source) return null;
    if (source === 'time') return dateFormatter(format.locale ?? 'zh-CN', {
      timeZone: format.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: format.hourCycle ?? 'h23'
    }).format(now);
    if (source === 'date') return dateFormatter(format.locale ?? 'zh-CN', {
      timeZone: format.timeZone, dateStyle: format.dateStyle ?? 'full'
    }).format(now);
    if (source.startsWith('time.')) {
      const { h, m, s } = localClock(now, format.timeZone);
      return { second: s, minute: m + s / 60, hour: h + m / 60 + s / 3600,
        dayprogress: ((h * 60 + m) * 60 + s) / 864 }[source.split('.')[1]];
    }
    const music = {
      'music.title': state?.song?.title, 'music.artist': state?.song?.artist, 'music.playing': state?.playing,
      'music.progress': duration(state?.positionMs), 'music.duration': duration(state?.durationMs),
      'music.positionms': state?.positionMs, 'music.durationms': state?.durationMs,
      'media.cover': state?.cover, 'media.wallpaper': state?.wallpaper, 'gpu.name': hardware?.gpuName
    };
    if (Object.hasOwn(music, source)) return music[source];
    if (Object.hasOwn(metrics, source)) return hardware?.values?.[source];
    return data && Object.hasOwn(data, source) ? data[source] : null;
  }

  function typed(value, type) {
    if (value == null) return null;
    if (type === 'number') return Number.isFinite(value) ? value : null;
    if (type === 'boolean') return typeof value === 'boolean' ? value : null;
    if (type === 'text' || type === 'image') return typeof value === 'string' ? value : null;
    if (type === 'files') return Array.isArray(value) ? value : null;
    return value;
  }

  function display(value, source, format, fallback) {
    if (typeof value === 'string' && !value.startsWith('data:image/')) return value;
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (!Number.isFinite(value)) return fallback;
    const digits = format.digits ?? (source?.startsWith('ram.') ? 1 : 0);
    let number;
    try {
      number = new Intl.NumberFormat(format.locale ?? 'zh-CN', { maximumFractionDigits: digits }).format(value);
    } catch { number = Number(value.toFixed(digits)).toString(); }
    return number + (format.unit ?? units[source] ?? '');
  }

  function text(template, context, format, fallback) {
    return (template ?? '').replace(token, (_, key) => display(raw(key, context, format), key, format, fallback));
  }

  function short(value, limit = 160) {
    const chars = [...value];
    return chars.length <= limit ? value : chars.slice(0, Math.max(0, limit - 1)).join('') + '…';
  }

  function setText(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function safeMedia(value) {
    if (typeof value !== 'string') return null;
    if (/^\/media\/(cover|wallpaper)\?v=[0-9a-f]+$/i.test(value)) return value;
    return value.length < 250000 && /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(value) ? value : null;
  }

  function setMedia(image, value) {
    const url = safeMedia(value);
    if (url && image.getAttribute('src') !== url) image.src = url;
    if (!url) image.removeAttribute('src');
    image.hidden = !url;
    return !!url;
  }

  function range(block, value, context) {
    const id = block.source;
    const defaultMax = metrics[id]?.[2] ?? (id === 'time.second' || id === 'time.minute' ? 60 :
      id === 'time.hour' ? 24 : id === 'music.positionms' ? context.state?.durationMs : 100);
    const max = block.max ?? (typeof defaultMax === 'string' ? context.hardware?.values?.[defaultMax] : defaultMax);
    const min = block.min ?? 0;
    return Number.isFinite(value) && max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  }

  function makeBlock(block, index, parentFormat, execute) {
    const format = { ...parentFormat, ...Object.fromEntries(Object.entries(block.format ?? {}).filter(([, v]) => v != null)) };
    const fallback = block.fallback ?? '—';
    const box = node('div', 'widget-v2-block widget-v2-' + block.kind);
    if (block.span) box.style.gridColumn = 'span ' + block.span;
    if (block.rows) box.style.gridRow = 'span ' + block.rows;
    if (block.align) box.style.textAlign = block.align;
    if (block.fontScale) box.style.setProperty('--widget-scale', block.fontScale);
    const label = node('span', 'widget-v2-label');
    if (block.label && block.kind !== 'button') box.append(label);
    const line = node('span', 'widget-v2-value');
    const expected = { image: 'image', files: 'files', ring: 'number', progress: 'number' }[block.kind] ?? block.valueType;
    if (block.kind === 'button') {
      const control = node('button', 'widget-v2-button');
      control.type = 'button';
      control.disabled = !execute;
      if (execute) control.addEventListener('click', () => execute('button-' + index));
      box.append(control);
      return { box, update: context => setText(control, short(text(block.text ?? block.label, context, format, fallback), 80)) };
    }
    if (block.kind === 'clock') {
      const face = node('span', 'widget-v2-dial');
      face.setAttribute('role', 'img');
      const hands = ['hour', 'minute', 'second'].map(name => node('i', 'widget-v2-hand ' + name));
      face.append(...hands);
      box.append(face);
      return { box, update(context) {
        updateLabel(context);
        const { h, m, s } = localClock(context.now, format.timeZone);
        const angles = [30 * h + .5 * m, 6 * m + .1 * s, 6 * s];
        hands.forEach((hand, i) => { hand.style.rotate = angles[i] + 'deg'; });
        face.setAttribute('aria-label', raw('time', context, format));
      } };
    }
    if (block.kind === 'image') {
      const image = node('img', 'widget-v2-image');
      box.append(image, line);
      return { box, update(context) {
        updateLabel(context);
        image.alt = label.textContent || '组件图片';
        line.hidden = setMedia(image, typed(raw(block.source, context, format), expected));
        setText(line, fallback);
      } };
    }
    if (block.kind === 'files') {
      const list = node('ul', 'widget-v2-files');
      let previous;
      box.append(list, line);
      return { box, update(context) {
        updateLabel(context);
        const files = typed(raw(block.source, context, format), expected);
        line.hidden = !!files?.length;
        setText(line, fallback);
        if (files === previous) return;
        previous = files;
        list.replaceChildren(...(files ?? []).slice(0, 6).map(file => {
          const item = node('li');
          const image = node('img');
          image.alt = '';
          item.append(setMedia(image, file.thumbnail ?? file.icon) ? image : node('span', '', icons.file));
          item.append(node('span', '', short(file.name ?? '文件', block.maxLength ?? 40)));
          return item;
        }));
      } };
    }
    if (block.kind === 'icon') {
      const icon = node('span', 'widget-v2-value', icons[block.icon] ?? '•');
      icon.setAttribute('aria-hidden', 'true');
      box.append(icon);
      return { box, update: updateLabel };
    }
    const progress = block.kind === 'ring' || block.kind === 'progress';
    if (progress) {
      const meter = node('span', block.kind === 'ring' ? 'widget-gauge widget-v2-meter' : 'widget-v2-bar');
      if (block.kind === 'ring') meter.append(line);
      meter.setAttribute('role', 'progressbar');
      box.append(meter);
      if (block.kind === 'progress') box.append(line);
      return { box, update(context) {
        updateLabel(context);
        const value = typed(raw(block.source, context, format), expected);
        const ratio = range(block, value, context);
        const formatted = display(value, block.source, format, fallback);
        meter.style.setProperty('--widget-progress', ratio * 100 + '%');
        meter.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
        meter.setAttribute('aria-valuetext', formatted);
        meter.setAttribute('aria-label', label.textContent || block.source);
        setText(line, short(formatted, block.maxLength ?? 50));
      } };
    }
    box.append(line);
    return { box, update(context) {
      updateLabel(context);
      const value = block.source ? display(typed(raw(block.source, context, format), expected), block.source, format, fallback) :
        text(block.text, context, format, fallback);
      setText(line, short(value || fallback, block.maxLength ?? 160));
    } };

    function updateLabel(context) {
      if (block.label) setText(label, short(text(block.label, context, format, fallback), 100));
    }
  }

  function make(widget, run) {
    const manifest = widget.manifest;
    const tile = node('article', 'widget widget-' + widget.size + ' widget-v2');
    tile.style.setProperty('--widget-accent', widget.color);
    const execute = run ? trigger => run(widget, trigger) : null;
    if (execute && manifest.actions) actionsByTile.set(tile, { actions: manifest.actions, execute });
    const title = node('span', 'widget-label', widget.name);
    tile.append(title);
    const grid = node('div', 'widget-v2-layout');
    const layout = manifest.layout ?? {};
    grid.style.setProperty('--columns', layout.columns ?? 2);
    grid.style.setProperty('--gap', (layout.gap ?? 8) + 'px');
    tile.style.setProperty('--padding', (layout.padding ?? 10) + 'px');
    if (layout.align) grid.style.textAlign = layout.align;
    const blocks = manifest.blocks?.length ? manifest.blocks : [
      manifest.gauge ? { kind: 'ring', source: manifest.gauge, span: layout.columns ?? 2 } :
        { kind: 'text', text: manifest.template, span: layout.columns ?? 2 },
      ...(manifest.detail || (manifest.gauge && manifest.template) ? [{
        kind: 'text', text: [manifest.gauge && manifest.template, manifest.detail].filter(Boolean).join(' · '),
        span: layout.columns ?? 2
      }] : [])
    ];
    for (const name of ['light', 'dark']) {
      const palette = manifest.theme?.[name] ?? {};
      for (const style of ['foreground', 'background', 'accent'])
        if (palette[style]) tile.style.setProperty('--' + name + '-' + style, palette[style]);
    }
    if (manifest.theme?.highContrast) tile.classList.add('high-contrast');
    const parts = blocks.map((block, index) => makeBlock(block, index, manifest.format ?? {}, execute));
    grid.append(...parts.map(part => part.box));
    tile.append(grid);
    if (references(manifest).some(key => key.startsWith('weather.'))) {
      const credit = node('a', 'widget-v2-credit', '天气数据 · Open-Meteo');
      credit.href = 'https://open-meteo.com/';
      credit.target = '_blank';
      credit.rel = 'noopener noreferrer';
      tile.append(credit);
    }
    const gestures = manifest.actions ?? {};
    if (gestures.tap) {
      const button = node('button', 'widget-v2-button widget-v2-trigger', '执行 · ' + widget.name);
      button.type = 'button';
      button.disabled = !execute;
      if (execute) button.addEventListener('click', () => execute('tap'));
      tile.append(button);
    }
    for (const [trigger, label] of [['longPress', '执行长按动作'], ['swipeLeft', '执行左滑动作'],
      ['swipeRight', '执行右滑动作']]) {
      if (!execute || !gestures[trigger]) continue;
      const button = node('button', 'widget-v2-button widget-v2-assist', label);
      button.type = 'button';
      button.addEventListener('click', () => execute(trigger));
      tile.append(button);
    }
    const motion = manifest.motion;
    if (motion && frames[motion.type] && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      tile.animate(frames[motion.type], { duration: motion.durationMs ?? 600, easing: motion.easing ?? 'ease-out',
        iterations: motion.loop ? Infinity : 1 });
    }
    return { element: tile, update: context => parts.forEach(part => part.update({ ...context, now: context.now ?? new Date() })) };
  }

  function gesture(origin, trigger) {
    const actions = origin && actionsByTile.get(origin.closest('.widget-v2'));
    if (!actions?.actions[trigger]) return false;
    actions.execute(trigger);
    return true;
  }

  function hasGesture(origin, trigger) {
    return Boolean(origin && actionsByTile.get(origin.closest('.widget-v2'))?.actions[trigger]);
  }

  function references(manifest) {
    const keys = new Set(manifest.gauge ? [manifest.gauge] : []);
    const texts = [manifest.template, manifest.detail];
    for (const block of manifest.blocks ?? []) {
      if (block.source) keys.add(block.source);
      texts.push(block.text, block.label);
    }
    for (const value of texts) {
      if (value) for (const match of value.matchAll(token)) keys.add(match[1]);
    }
    return [...keys];
  }

  return { make, gesture, hasGesture, references, serverGroups };
})();

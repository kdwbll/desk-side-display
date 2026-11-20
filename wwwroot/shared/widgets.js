'use strict';

window.deskWidgets = (() => {
  const metrics = {
    'cpu.usage': ['CPU 占用', '%', 100],
    'cpu.temperature': ['CPU 温度', '°C', 100],
    'gpu.usage': ['GPU 占用', '%', 100],
    'gpu.temperature': ['GPU 温度', '°C', 100],
    'gpu.power': ['GPU 功耗', 'W', 150],
    'gpu.fan': ['GPU 风扇', '%', 100],
    'gpu.clock': ['GPU 核心频率', 'MHz', 3000],
    'ram.used': ['内存已用', 'GB', 'ram.total'],
    'ram.total': ['内存总量', 'GB', 'ram.total'],
    'ram.usage': ['内存占用', '%', 100]
  };
  const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function clock(ms) {
    if (!Number.isFinite(ms)) return '—';
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }

  function replaceText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  function metricValue(id, values) {
    const amount = values[id];
    if (!Number.isFinite(amount)) return '—';
    const [, unit] = metrics[id];
    const rounded = unit === 'GB' ? Math.round(amount * 10) / 10 : Math.round(amount);
    return rounded + (unit === '%' || unit === '°C' ? '' : ' ') + unit;
  }

  function metricDetail(id, values) {
    const available = (keys) => keys.filter(key => Number.isFinite(values[key])).map(key => metricValue(key, values));
    switch (id) {
      case 'cpu.usage':
        return available(['cpu.temperature']).join('') || '温度未提供';
      case 'gpu.usage':
        return available(['gpu.temperature', 'gpu.power']).join(' · ') || '传感器未提供';
      case 'ram.used':
        return Number.isFinite(values['ram.total']) ? '共 ' + metricValue('ram.total', values) : '物理内存';
      case 'gpu.temperature': {
        const [fan] = available(['gpu.fan']);
        return [fan && '风扇 ' + fan, ...available(['gpu.clock'])].filter(Boolean).join(' · ') || '核心温度';
      }
      default:
        return Number.isFinite(values[id]) ? metrics[id][0] : '读数未提供';
    }
  }

  function formatTemplate(template, context) {
    const state = context.state;
    const now = context.now ?? new Date();
    const values = context.hardware?.values ?? {};
    const tokens = {
      time: timeFormat.format(now), date: dateFormat.format(now),
      'music.title': state?.song?.title || '未播放',
      'music.artist': state?.song?.artist || '—',
      'music.progress': clock(state?.positionMs),
      'music.duration': clock(state?.durationMs),
      'gpu.name': context.hardware?.gpuName ?? '—'
    };
    return template.replace(/\{\{([a-z][a-z.]*)\}\}/g, (_, key) =>
      Object.hasOwn(metrics, key) ? metricValue(key, values) : tokens[key] ?? '—');
  }

  function make(widget, press, mediaControl) {
    if (widget.type === 'music') return makeMusic(widget, mediaControl);
    if (widget.type === 'shortcut') return makeShortcut(widget, press);
    if (widget.type === 'image' || widget.type === 'gif') return makeImage(widget);
    if (widget.type === 'emoji') return makeEmoji(widget);
    const metric = widget.type === 'metric' ? widget.metric :
      widget.type === 'custom' ? widget.manifest?.gauge : null;
    const tile = node('article', 'widget widget-' + widget.size);
    if (widget.type === 'clock') tile.classList.add('widget-clock');
    tile.style.setProperty('--widget-accent', widget.color);
    const value = node('span', 'widget-value');
    const detail = node('span', 'widget-detail');
    const face = node('span', metric ? 'widget-gauge' : 'widget-face');
    if (metric) tile.classList.add('widget-with-gauge');
    face.append(value);
    tile.append(face);
    if (widget.name.trim()) tile.append(node('span', 'widget-label', widget.name));
    tile.append(detail);

    function update(context) {
      const hw = context.hardware?.values ?? {};
      const now = context.now ?? new Date();
      let main = '';
      let sub = '';
      switch (widget.type) {
        case 'metric':
          main = metricValue(metric, hw);
          sub = metricDetail(metric, hw);
          break;
        case 'clock':
          main = timeFormat.format(now);
          sub = dateFormat.format(now);
          break;
        case 'date':
          main = dateFormat.format(now);
          sub = String(now.getFullYear());
          break;
        case 'text':
          main = widget.text;
          break;
        case 'custom':
          main = formatTemplate(widget.manifest.template, context);
          sub = widget.manifest.detail ? formatTemplate(widget.manifest.detail, context) : '';
          break;
      }
      replaceText(value, main);
      replaceText(detail, sub);
      if (metric) {
        const maximum = metrics[metric][2];
        const divisor = typeof maximum === 'number' ? maximum : hw[maximum];
        const ratio = Number.isFinite(hw[metric]) && divisor > 0 ? Math.min(1, Math.max(0, hw[metric] / divisor)) : 0;
        face.style.setProperty('--widget-progress', Math.round(ratio * 1000) / 10 + '%');
      }
    }
    return { element: tile, update };
  }

  function makeImage(widget) {
    const tile = node('article', 'widget widget-' + widget.size + ' widget-image-card');
    tile.style.setProperty('--widget-accent', widget.color);
    const image = node('img', 'widget-card-image');
    image.alt = widget.name.trim() || (widget.type === 'gif' ? 'GIF 动图' : '自选图片');
    image.style.objectFit = widget.fit ?? 'contain';
    image.hidden = true;
    const empty = node('span', 'widget-card-image-empty', '—');
    empty.setAttribute('aria-label', widget.type === 'gif' ? '暂无 GIF' : '暂无图片');
    image.addEventListener('load', () => { image.hidden = false; empty.hidden = true; });
    image.addEventListener('error', () => { image.hidden = true; empty.hidden = false; });
    if (widget.mediaId) image.src = '/media/widgets/' + encodeURIComponent(widget.mediaId);
    tile.append(empty, image);
    if (widget.name.trim()) tile.append(node('span', 'widget-label', widget.name));
    return { element: tile, update() {} };
  }

  function makeEmoji(widget) {
    const tile = node('article', 'widget widget-' + widget.size + ' widget-emoji');
    tile.style.setProperty('--widget-accent', widget.color);
    tile.append(node('span', 'widget-emoji-value', widget.text));
    if (widget.name.trim()) tile.append(node('span', 'widget-label', widget.name));
    return { element: tile, update() {} };
  }

  function makeShortcut(widget, press) {
    const tile = node('button', 'widget widget-' + widget.size + ' widget-shortcut');
    tile.style.setProperty('--widget-accent', widget.color);
    tile.type = 'button';
    tile.disabled = !press;
    const name = widget.name.trim();
    const caption = name === '键盘快捷键' ? '' : name;
    tile.setAttribute('aria-label', [caption, widget.keys].filter(Boolean).join(' · ') || '快捷键');
    if (press) tile.addEventListener('click', () => press(widget, tile));
    const chord = node('span', 'widget-keycaps');
    chord.setAttribute('aria-hidden', 'true');
    const keys = (widget.keys ?? '').split('+').map(key => key.trim()).filter(Boolean);
    chord.append(...keys.flatMap((key, index) => {
      const cap = node('kbd', '', key);
      return index ? [node('span', 'widget-key-join', '+'), cap] : [cap];
    }));
    tile.append(chord);
    if (caption) tile.append(node('span', 'widget-label', caption));
    return { element: tile, update() {} };
  }

  function makeMusic(widget, control) {
    const tile = node('article', 'widget widget-' + widget.size + ' widget-music');
    tile.style.setProperty('--widget-accent', widget.color);
    const cover = node('div', 'widget-music-cover');
    const image = node('img');
    image.alt = '';
    image.hidden = true;
    image.addEventListener('load', () => { image.hidden = false; });
    image.addEventListener('error', () => { image.hidden = true; });
    cover.append(image);
    const title = node('span', 'widget-music-title');
    const bar = node('div', 'widget-music-progress');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', '播放进度');
    const fill = node('span');
    bar.append(fill);
    const transport = node('div', 'widget-music-controls');
    const labels = { previous: '上一首', toggle: '播放', next: '下一首' };
    const buttons = Object.entries(labels).map(([action, label]) => {
      const button = node('button', 'widget-music-button');
      button.type = 'button';
      button.dataset.action = action;
      button.setAttribute('aria-label', label);
      button.disabled = true;
      const icon = node('i', 'widget-music-icon');
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
      if (control) button.addEventListener('click', async () => {
        pending = true;
        for (const item of buttons) item.disabled = true;
        try { await control(widget, action); }
        finally { pending = false; }
      });
      return button;
    });
    transport.append(...buttons);
    tile.append(cover, title, bar, transport);
    let url;
    let pending = false;

    function update(context) {
      const state = context.state;
      if (state?.cover !== url) {
        url = state?.cover;
        image.hidden = true;
        if (url) image.src = url;
        else image.removeAttribute('src');
      }
      replaceText(title, state?.song?.title || '未播放');
      const ratio = state?.durationMs > 0 && Number.isFinite(state.positionMs)
        ? Math.max(0, Math.min(1, state.positionMs / state.durationMs)) : 0;
      fill.style.setProperty('--music-progress', ratio);
      bar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      const capabilities = state?.playback ?? {};
      for (const [index, flag] of ['canPrevious', 'canToggle', 'canNext'].entries()) {
        buttons[index].disabled = !control || pending || !capabilities[flag];
      }
      buttons[1].dataset.playing = String(Boolean(state?.playing));
      buttons[1].setAttribute('aria-label', state?.playing ? '暂停' : '播放');
    }
    return { element: tile, update };
  }

  return { make, metrics, node };
})();

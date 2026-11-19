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

  function make(widget, press) {
    const metric = widget.type === 'metric' ? widget.metric :
      widget.type === 'custom' ? widget.manifest?.gauge : null;
    const isButton = widget.type === 'shortcut';
    const tile = node(isButton ? 'button' : 'article', 'widget widget-' + widget.size);
    tile.style.setProperty('--widget-accent', widget.color);
    if (isButton) {
      tile.type = 'button';
      tile.disabled = !press;
      if (press) tile.addEventListener('click', () => press(widget, tile));
    }
    const label = node('span', 'widget-label', widget.name);
    const value = node('span', 'widget-value');
    const detail = node('span', 'widget-detail');
    const face = node('span', metric ? 'widget-gauge' : 'widget-face');
    if (metric) tile.classList.add('widget-with-gauge');
    face.append(value);
    tile.append(face, label, detail);

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
        case 'music':
          main = context.state?.song?.title || '未播放';
          sub = context.state?.song?.artist || '';
          break;
        case 'text':
          main = widget.text;
          break;
        case 'shortcut':
          main = widget.keys;
          sub = '发送到 Windows';
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

  return { make, metrics, node };
})();

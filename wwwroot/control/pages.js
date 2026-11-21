'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const { node, make, metrics } = deskWidgets;
  const editor = $('page-editor');
  const list = $('page-order');
  const detail = $('page-detail');
  const status = $('pages-status');
  const permission = $('page-shortcuts');
  const save = $('pages-save');
  const kinds = {
    clock: '时钟', image: '图片', emoji: 'Emoji', gif: 'GIF', date: '日期', music: '正在播放',
    text: '便签', metric: '硬件仪表', shortcut: '键盘快捷键', custom: '自定义'
  };
  const presets = { clock: ['全屏时钟', '时钟'], photo: ['全屏相框', '相框'] };
  const presetSelect = $('page-preset');
  const presetAdd = $('page-add-preset');
  const example = {
    version: 2, widget: 'world-clock', kind: 'clock', name: '世界时钟', size: 'medium', color: '#7de8c8',
    format: { locale: 'zh-CN', timeZone: 'Asia/Shanghai', hourCycle: 'h23' },
    layout: { columns: 2, gap: 10 },
    blocks: [{ kind: 'clock' }, { kind: 'text', text: '{{time}}\n{{date}}' }]
  };
  const previewData = {
    state: { song: { title: '窗外有风', artist: '桌面副屏演示' }, positionMs: 65000, durationMs: 188000 },
    hardware: {
      values: { 'cpu.usage': 33, 'cpu.temperature': 65, 'gpu.usage': 6, 'gpu.temperature': 52,
        'gpu.power': 41, 'gpu.clock': 2520, 'gpu.fan': 34, 'ram.used': 23, 'ram.total': 64, 'ram.usage': 36 },
      gpuName: 'GPU 演示'
    },
    data: { 'weather.temperature': 16, 'weather.feels': 14, 'weather.code': 0, 'weather.wind': 3,
      'weather.humidity': 54, 'weather.day': true, 'weather.place': '示例地点', 'weather.configured': true,
      'clipboard.history': [{ id: 'preview', kind: 'text', text: '剪贴板示例', copiedAt: '2026-01-01T10:00:00Z' }] }
  };
  const sizes = [['small', '小'], ['medium', '中'], ['large', '大']];
  const weatherShapes = [['card', '卡片'], ['round', '圆形'], ['capsule', '胶囊'], ['square', '方形']];
  const componentFiles = ['clipboard-widget', 'weather-widget'];
  const screenshotKeys = [
    ['Win+Shift+S', '区域截图 · Win+Shift+S'],
    ['PrintScreen', '截屏键 · PrintScreen'],
    ['Alt+PrintScreen', '截取当前窗口 · Alt+PrintScreen'],
    ['Win+PrintScreen', '保存全屏截图 · Win+PrintScreen']
  ];
  let draft;
  let original;
  let selected;
  let preview;
  let layoutTools;
  let pixelTools;
  let resetLayout;
  let previewClocks = [];
  let previewMusic = [];
  let replacing;
  let bundled = [];
  let pageLimit;

  const currentPage = () => draft.pages.find(page => page.id === selected);
  const backdrop = node('div', 'page-backdrop');
  const updateBackdrop = createPageBackdrop(backdrop);
  const previewTime = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const previewDate = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  document.addEventListener('playback-cover', updateScene);

  function updateScene() {
    if (!draft || !preview) return;
    for (const tile of previewMusic) tile.update({ state: state ?? previewData.state });
    const page = currentPage();
    const scene = preview.querySelector('.layout-preview-scene');
    const appearance = state?.lyricAppearance;
    if (page.kind === 'lyrics' && appearance) {
      preview.style.setProperty('--preview-background', appearance.backgroundColor);
      scene.style.color = appearance.textColor;
      updateBackdrop({ color: appearance.backgroundColor, backgroundMode: appearance.backgroundMode }, state);
    } else updateBackdrop(page, state);
    if (page.kind === 'lyrics') {
      const position = (state?.positionMs ?? 0) + (state?.lyricOffsetMs ?? 0);
      scene.querySelector('strong').textContent = state?.lines?.findLast(line => line.atMs <= position + lyricLineLeadMs)?.text
        || state?.song?.title || '等待播放';
    } else if (page.kind === 'clock') {
      const now = new Date();
      scene.querySelector('time').textContent = previewTime.format(now);
      scene.querySelector('span').textContent = previewDate.format(now);
    }
    const image = scene.querySelector('img');
    if (image) {
      const url = page.kind === 'photo' ? state?.wallpaper : state?.cover;
      if (url && image.getAttribute('src') !== url) image.src = url;
      else if (!url) image.removeAttribute('src');
      image.alt = '';
      image.hidden = !url;
    }
  }
  const dirty = () => JSON.stringify(draft) !== original;

  function button(text, handler, title = text) {
    const control = node('button', '', text);
    control.type = 'button';
    control.setAttribute('aria-label', title);
    control.addEventListener('click', handler);
    return control;
  }

  function select(entries, value) {
    const field = node('select');
    field.append(...entries.map(([key, label]) => new Option(label, key)));
    field.value = value;
    return field;
  }

  function field(parent, label, value, change, options = {}) {
    const wrapper = node('label', '', label);
    const input = options.entries ? select(options.entries, value) : node('input');
    input.setAttribute('aria-label', label);
    if (!options.entries) {
      input.type = options.type ?? 'text';
      input.value = value;
      if (options.max) input.maxLength = options.max;
      if (options.placeholder) input.placeholder = options.placeholder;
    }
    input.addEventListener(options.entries ? 'change' : 'input', () => {
      change(input.value);
      refreshPreview();
      save.disabled = !dirty();
    });
    wrapper.append(input);
    parent.append(wrapper);
    return input;
  }

  function renderOrder() {
    list.replaceChildren(...draft.pages.map((page, index) => {
      const row = node('li');
      const name = page.name.trim() || '第 ' + (index + 1) + ' 页';
      const open = button(name, () => { selected = page.id; render(); });
      open.className = 'select-page';
      open.setAttribute('aria-pressed', String(page.id === selected));
      const move = direction => {
        const next = index + direction;
        [draft.pages[index], draft.pages[next]] = [draft.pages[next], draft.pages[index]];
        renderOrder();
        save.disabled = !dirty();
      };
      const up = button('↑', () => move(-1), '上移 ' + name);
      const down = button('↓', () => move(1), '下移 ' + name);
      up.className = down.className = 'move-page';
      up.disabled = index === 0;
      down.disabled = index === draft.pages.length - 1;
      row.append(open, up, down);
      return row;
    }));
    $('page-count').textContent = draft.pages.length + ' / ' + pageLimit;
    const full = draft.pages.length >= pageLimit;
    $('page-add').disabled = full;
    const available = Object.entries(presets).filter(([id]) => !draft.pages.some(page => page.id === id));
    const previous = presetSelect.value;
    presetSelect.replaceChildren(new Option('页面预设', ''),
      ...available.map(([id, [label]]) => new Option(label, id)));
    presetSelect.value = available.some(([id]) => id === previous) ? previous : '';
    presetSelect.disabled = full || !available.length;
    presetAdd.disabled = presetSelect.disabled || !presetSelect.value;
  }

  function refreshPreview() {
    const page = currentPage();
    preview.style.setProperty('--preview-background', page.color);
    layoutTools.hidden = page.widgets.length === 0 || widgetPlacement.isClipboardPage(page);
    resetLayout.disabled = !widgetPlacement.isFree(page);
    previewClocks = [];
    previewMusic = [];
    widgetLayoutEditor.render(preview, page, widget => {
      const tile = widget.manifest?.version === 2 ? widgetV2.make(widget) : make(widget);
      tile.update(previewData);
      if (widget.type === 'clock') previewClocks.push(tile);
      if (widget.type === 'music') previewMusic.push(tile);
      return tile.element;
    }, () => {
      resetLayout.disabled = false;
      save.disabled = !dirty();
    }, pixelTools);
    preview.prepend(backdrop);
    updateScene();
    document.dispatchEvent(new CustomEvent('page-flow-change', {
      detail: draft.pages.some(item => item.kind !== 'lyrics' && item.backgroundMode === 'album')
    }));
  }

  function customChoices() {
    const choices = new Map();
    const put = manifest => {
      const key = manifest.widget?.trim() || JSON.stringify(exportManifest({ ...manifest, size: null, color: null }));
      choices.set(key, manifest);
    };
    [...bundled, ...(draft.widgetLibrary ?? [])].forEach(put);
    for (const widget of draft.pages.flatMap(page => page.widgets)) {
      if (widget.type === 'custom') put({ ...widget.manifest, name: widget.name, size: widget.size, color: widget.color });
    }
    return [...choices.values()];
  }

  async function loadBundled() {
    const results = await Promise.allSettled(componentFiles.map(async name => {
      const response = await fetch('/shared/examples/' + name + '.json', { signal: AbortSignal.timeout(3500) });
      if (!response.ok) throw Error('Unable to load ' + name);
      return response.json();
    }));
    bundled = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  }

  function render() {
    renderOrder();
    const page = currentPage();
    const props = node('div', 'page-properties');
    field(props, '界面名称', page.name, value => {
      page.name = value;
      renderOrder();
    }, { max: 24 });
    if (page.kind !== 'lyrics')
      field(props, '页面背景', page.backgroundMode ?? 'fixed', value => { page.backgroundMode = value; },
        { entries: [['fixed', '原有背景'], ['album', '专辑流光']] });
    if (['clock', 'hardware', 'custom'].includes(page.kind))
      field(props, '背景', page.color, value => { page.color = value; }, { type: 'color' });
    if (page.kind === 'custom' || Object.hasOwn(presets, page.kind)) props.append(button('删除界面', () => {
      if (!confirm('移除此界面及其中的组件？保存后生效。')) return;
      draft.pages = draft.pages.filter(item => item.id !== selected);
      selected = draft.pages[0].id;
      render();
    }));
    const toolbar = node('div', 'actions widget-toolbar');
    const type = select(Object.entries(kinds).filter(([key]) => key !== 'custom'), 'clock');
    const templates = customChoices();
    if (templates.length) {
      const group = node('optgroup');
      group.label = '可复用组件';
      group.append(...templates.map((manifest, index) =>
        new Option(manifest.name.trim() || '未命名组件 ' + (index + 1), 'template-' + index)));
      type.append(group);
    }
    type.setAttribute('aria-label', '组件类型');
    const add = button('添加组件', () => {
      const key = type.value;
      const manifest = key.startsWith('template-') ? structuredClone(templates[Number(key.slice(9))]) : null;
      const widget = manifest
        ? { id: crypto.randomUUID(), type: 'custom', name: manifest.name, size: manifest.size, color: manifest.color, manifest }
        : { id: crypto.randomUUID(), type: key, name: kinds[key], size: 'small', color: '#82d9ce' };
      if (['image', 'gif', 'emoji', 'clock', 'shortcut'].includes(key)) widget.name = '';
      if (key === 'emoji') widget.text = '✨';
      if (key === 'text') widget.text = '写点什么';
      if (key === 'metric') widget.metric = 'cpu.usage';
      if (key === 'shortcut') widget.keys = '';
      page.widgets.push(widget);
      render();
      detail.querySelector('.page-widget-editor:last-child').open = true;
      if (key === 'shortcut') status.textContent = '可以选择截图预设，或用文字填写组合，例如 Ctrl+Shift+K。';
    });
    add.disabled = type.disabled = page.widgets.length >= 8;
    toolbar.append(type, add, node('span', 'detail', page.widgets.length + ' / 8'));
    preview = node('div', 'widget-layout-preview');
    preview.setAttribute('aria-label', '组件预览（硬件数字为示例）');
    layoutTools = node('div', 'actions widget-layout-tools');
    pixelTools = node('div', 'layout-pixel-tools');
    resetLayout = button('恢复自动布局', () => {
      for (const widget of page.widgets) delete widget.placement;
      refreshPreview();
      save.disabled = !dirty();
    });
    const gestures = node('span', 'detail', '拖动移动 · 拉边框缩放 · 按 ');
    gestures.append(node('kbd', '', 'Alt'), ' 暂停吸附');
    layoutTools.append(gestures, resetLayout);
    detail.replaceChildren(node('h3', '', '横屏预览'), preview, layoutTools, pixelTools, props, toolbar,
      ...page.widgets.map(widget => editWidget(page, widget)));
    if (page.widgets.length === 1) detail.querySelector('.page-widget-editor').open = true;
    refreshPreview();
    permission.checked = draft.shortcutsEnabled;
    save.disabled = !dirty();
    $('widget-import-add').disabled = page.widgets.length >= 8 && !replacing;
  }

  function editWidget(page, widget) {
    const box = node('details', 'page-widget-editor');
    const description = () => {
      const type = kinds[widget.type];
      const name = widget.name.trim() || type;
      const detail = widget.type === 'shortcut' ? widget.keys : type;
      return detail && detail !== name ? [name, detail].join(' · ') : name;
    };
    const summary = node('summary', '', description());
    summary.addEventListener('click', () => widgetLayoutEditor.select(preview, widget.id));
    const fields = node('div', 'widget-fields');
    field(fields, '名称', widget.name, value => {
      widget.name = value;
      summary.textContent = description();
    }, { max: 24 });
    field(fields, '尺寸', widget.size, value => {
      widget.size = value;
      if (widget.placement) widget.placement = widgetPlacement.preset(page, widget, value);
    }, { entries: sizes });
    field(fields, '颜色', widget.color, value => { widget.color = value; }, { type: 'color' });
    if (widget.type === 'text') field(fields, '内容', widget.text, value => { widget.text = value; }, { max: 160 });
    if (widget.type === 'emoji') field(fields, 'Emoji 内容', widget.text, value => { widget.text = value; },
      { max: 32, placeholder: '按 Win + . 打开表情面板' });
    if (widget.type === 'image' || widget.type === 'gif') editImage(fields, widget);
    if (widget.type === 'metric') field(fields, '读数', widget.metric, value => { widget.metric = value; }, {
      entries: Object.entries(metrics).map(([id, info]) => [id, info[0]])
    });
    if (widget.type === 'shortcut') {
      const preset = field(fields, '截图快捷键预设', '', value => {
        if (value) {
          shortcut.value = value;
          widget.keys = value;
          summary.textContent = description();
        }
      }, { entries: [['', '请选择'], ...screenshotKeys] });
      const shortcut = field(fields, '快捷键', widget.keys, value => {
        widget.keys = value;
        updatePreset();
        summary.textContent = description();
      }, { max: 64, placeholder: '例如 Win+Shift+S' });
      function updatePreset() {
        preset.value = screenshotKeys.find(([keys]) => keys.toLowerCase() === widget.keys.trim().toLowerCase())?.[0] ?? '';
      }
      updatePreset();
    }
    if (widget.type === 'custom' && widget.manifest.version === 1) {
      field(fields, '主文字模板', widget.manifest.template, value => { widget.manifest.template = value; }, { max: 120 });
      field(fields, '补充文字', widget.manifest.detail ?? '', value => {
        widget.manifest.detail = value || null;
      }, { max: 160 });
      field(fields, '圆环指标', widget.manifest.gauge ?? '', value => { widget.manifest.gauge = value || null; }, {
        entries: [['', '无'], ...Object.entries(metrics).map(([id, info]) => [id, info[0]])]
      });
    }
    const weatherBlocks = widget.manifest?.blocks?.filter(block => block.kind === 'weather') ?? [];
    weatherBlocks.forEach((weather, index) => {
      const suffix = weatherBlocks.length > 1 ? ' ' + (index + 1) : '';
      field(fields, '天气形状' + suffix, weather.shape ?? 'card', value => {
        weather.shape = value;
      }, { entries: weatherShapes });
      const label = node('label', 'weather-transparency', '背景透光度' + suffix);
      const value = node('output');
      const slider = node('input');
      slider.type = 'range';
      slider.min = 0;
      slider.max = 100;
      slider.value = weather.transparency ?? deskWeather.defaultTransparency;
      slider.setAttribute('aria-label', '背景透光度' + suffix);
      const showValue = () => {
        value.textContent = slider.value + '%';
        slider.setAttribute('aria-valuetext', value.textContent);
      };
      showValue();
      slider.addEventListener('input', () => {
        weather.transparency = slider.valueAsNumber;
        showValue();
        const frame = preview.querySelector('[data-widget-id="' + CSS.escape(widget.id) + '"]');
        const card = frame?.querySelectorAll('.widget-weather')[index];
        if (card) deskWeather.setTransparency(card, weather.transparency);
        save.disabled = !dirty();
      });
      label.append(value, slider);
      fields.append(label);
    });
    if (widget.type === 'custom') fields.append(button('编辑组件 JSON', () => {
      replacing = { id: widget.id, page: page.id };
      const manifest = { ...widget.manifest, name: widget.name, color: widget.color, size: widget.size };
      $('widget-manifest').value = JSON.stringify(exportManifest(manifest), null, 2);
      $('widget-import').open = true;
      $('widget-import-add').textContent = '校验并替换组件';
      $('widget-import-add').disabled = false;
      $('widget-import-cancel').hidden = false;
      $('widget-manifest').focus();
    }));
    box.append(summary, fields, button('移除组件', () => {
      page.widgets = page.widgets.filter(item => item.id !== widget.id);
      render();
    }));
    return box;
  }

  function editImage(fields, widget) {
    const gif = widget.type === 'gif';
    const picker = node('label', 'file-picker');
    const caption = node('span');
    const input = node('input');
    input.type = 'file';
    input.accept = gif ? 'image/gif' : 'image/jpeg,image/png,image/webp';
    input.setAttribute('aria-label', gif ? '选择 GIF' : '选择图片');
    const clear = button('清除图片', () => {
      delete widget.mediaId;
      update();
    });
    const update = () => {
      caption.textContent = (widget.mediaId ? '更换' : '选择') + (gif ? ' GIF' : '图片');
      clear.hidden = !widget.mediaId;
      refreshPreview();
      save.disabled = !dirty();
    };
    caption.textContent = (widget.mediaId ? '更换' : '选择') + (gif ? ' GIF' : '图片');
    clear.hidden = !widget.mediaId;
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      editor.disabled = true;
      status.textContent = '';
      try {
        const form = new FormData();
        form.append('file', file);
        const result = await send('/api/widget-images/' + widget.type, form);
        widget.mediaId = result.id;
        update();
      } catch (error) { status.textContent = error.message; }
      finally { editor.disabled = false; }
    });
    picker.append(caption, input);
    fields.append(picker, clear);
    field(fields, '图片填充', widget.fit ?? 'contain', value => { widget.fit = value; },
      { entries: [['contain', '完整显示'], ['cover', '铺满卡片']] });
  }

  async function load() {
    editor.disabled = true;
    try {
      const [response] = await Promise.all([
        fetch('/api/pages', { signal: AbortSignal.timeout(3500) }), loadBundled()
      ]);
      if (!response.ok) throw Error('无法读取界面。');
      const next = await response.json();
      draft = next.layout;
      pageLimit = next.maxPages;
      original = JSON.stringify(draft);
      if (!draft.pages.some(page => page.id === selected)) selected = draft.pages[0].id;
      render();
      status.textContent = '';
    } catch (error) { status.textContent = error.message; }
    finally { editor.disabled = false; }
  }

  $('pages-reload').addEventListener('click', () => {
    if (!draft || !dirty() || confirm('重新读取已保存的界面？未保存的修改会丢失。')) load();
  });
  $('page-add').addEventListener('click', () => {
    if (!draft || draft.pages.length >= pageLimit) return;
    selected = crypto.randomUUID().replaceAll('-', '');
    draft.pages.push({ id: selected, kind: 'custom', name: '我的界面', color: '#151621', widgets: [] });
    render();
    detail.querySelector('input')?.focus();
  });
  presetSelect.addEventListener('change', () => { presetAdd.disabled = !presetSelect.value; });
  presetAdd.addEventListener('click', () => {
    const id = presetSelect.value;
    if (!Object.hasOwn(presets, id) || draft.pages.length >= pageLimit || draft.pages.some(page => page.id === id)) return;
    selected = id;
    draft.pages.push({ id, kind: id, name: presets[id][1], color: '#171923', widgets: [] });
    render();
  });
  permission.addEventListener('change', () => {
    if (!draft) return;
    draft.shortcutsEnabled = permission.checked;
    save.disabled = !dirty();
  });
  save.addEventListener('click', async () => {
    if (!draft || !dirty()) return;
    editor.disabled = true;
    try {
      draft = await send('/api/pages', JSON.stringify(draft));
      original = JSON.stringify(draft);
      render();
      status.textContent = '已保存，手机会自动同步。';
    } catch (error) { status.textContent = error.message; }
    finally { editor.disabled = false; }
  });
  $('widget-import-add').addEventListener('click', async () => {
    if (!draft || (!replacing && currentPage().widgets.length >= 8)) return;
    const input = $('widget-manifest');
    editor.disabled = true;
    try {
      const parsed = JSON.parse(input.value);
      const manifest = await send('/api/pages/validate-widget', JSON.stringify(parsed));
      const { name, size, color } = manifest;
      if (replacing) {
        const existing = draft.pages.find(page => page.id === replacing.page)?.widgets.find(widget => widget.id === replacing.id);
        if (!existing) throw Error('要替换的组件已移除。');
        Object.assign(existing, { name, size, color, manifest });
        selected = replacing.page;
      } else {
        currentPage().widgets.push({ id: crypto.randomUUID(), type: 'custom', name, size, color, manifest });
      }
      resetImport();
      input.value = '';
      render();
      status.textContent = '组件已校验并添加。保存界面后在手机显示。';
    } catch (error) { status.textContent = error instanceof SyntaxError ? '请粘贴完整的 JSON 对象。' : error.message; }
    finally { editor.disabled = false; }
  });
  function resetImport() {
    replacing = undefined;
    $('widget-import-add').textContent = '校验并添加到本页';
    $('widget-import-cancel').hidden = true;
    $('widget-import-add').disabled = (currentPage()?.widgets.length ?? 8) >= 8;
  }
  function exportManifest(value) {
    if (Array.isArray(value)) return value.map(exportManifest);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key, part]) => part != null || key.startsWith('x-'))
      .map(([key, part]) => [key, key.startsWith('x-') ? part : exportManifest(part)]));
  }
  $('widget-import-cancel').addEventListener('click', () => {
    resetImport();
    $('widget-manifest').value = '';
  });
  $('copy-widget-prompt').addEventListener('click', async () => {
    try {
      const response = await fetch('/shared/widget-v2.schema.json', { signal: AbortSignal.timeout(3500) });
      if (!response.ok) throw Error();
      const schema = await response.text();
      const prompt = [
        '请为「桌面副屏」生成一个兼容组件。用途：[填写你想显示的内容]。只输出一个 JSON 对象，遵守下列 Schema。',
        '使用 blocks 声明布局块，source 绑定数据，文字内允许 {{数据标记}}。时钟圆环可绑定 time.second。',
        '私有数据须声明对应权限。外部 API 使用 Windows 注册的 api.<别名>.<JSON 路径>，组件只引用别名。',
        '绝不放入私人数据或令牌。只用声明式数据、动作和动效。x- 字段用作命名空间元数据。',
        '例子：' + JSON.stringify(example), 'JSON Schema：', schema
      ].join('\n');
      await navigator.clipboard.writeText(prompt);
      status.textContent = '已复制提示词和规范，替换其中的用途后发给 AI。';
    } catch { status.textContent = '复制失败，可以下载 JSON 规范后交给 AI。'; }
  });
  setInterval(() => {
    const now = new Date();
    for (const tile of previewClocks) tile.update({ now });
  }, 1000);
  load();
})();

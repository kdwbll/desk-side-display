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
    clock: '时钟', date: '日期', music: '正在播放', text: '便签', metric: '硬件仪表', shortcut: '键盘快捷键', custom: '自定义'
  };
  const example = {
    version: 1, name: '我的电脑', size: 'medium', color: '#7de8c8', template: '内存 {{ram.used}}',
    detail: 'CPU {{cpu.usage}} · GPU {{gpu.temperature}}', gauge: 'ram.usage'
  };
  const previewData = {
    state: { song: { title: '窗外有风', artist: '桌面副屏演示' }, positionMs: 65000, durationMs: 188000 },
    hardware: {
      values: { 'cpu.usage': 33, 'cpu.temperature': 65, 'gpu.usage': 6, 'gpu.temperature': 52,
        'gpu.power': 41, 'gpu.clock': 2520, 'gpu.fan': 34, 'ram.used': 23, 'ram.total': 64, 'ram.usage': 36 },
      gpuName: 'GPU 演示'
    }
  };
  const sizes = [['small', '小'], ['medium', '中'], ['large', '大']];
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

  const currentPage = () => draft.pages.find(page => page.id === selected);
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
      const open = button(page.name, () => { selected = page.id; render(); });
      open.className = 'select-page';
      open.setAttribute('aria-pressed', String(page.id === selected));
      const move = direction => {
        const next = index + direction;
        [draft.pages[index], draft.pages[next]] = [draft.pages[next], draft.pages[index]];
        renderOrder();
        save.disabled = !dirty();
      };
      const up = button('↑', () => move(-1), '上移 ' + page.name);
      const down = button('↓', () => move(1), '下移 ' + page.name);
      up.className = down.className = 'move-page';
      up.disabled = index === 0;
      down.disabled = index === draft.pages.length - 1;
      row.append(open, up, down);
      return row;
    }));
    $('page-count').textContent = draft.pages.length + ' / 6';
    $('page-add').disabled = draft.pages.length >= 6;
  }

  function refreshPreview() {
    const page = currentPage();
    preview.style.setProperty('--preview-background', page.color);
    preview.hidden = page.widgets.length === 0;
    preview.replaceChildren(...page.widgets.map(widget => {
      const tile = make(widget);
      tile.update(previewData);
      return tile.element;
    }));
  }

  function render() {
    renderOrder();
    const page = currentPage();
    const props = node('div', 'page-properties');
    field(props, '界面名称', page.name, value => {
      page.name = value;
      renderOrder();
    }, { max: 24 });
    if (['clock', 'hardware', 'custom'].includes(page.kind))
      field(props, '背景', page.color, value => { page.color = value; }, { type: 'color' });
    if (page.kind === 'custom') props.append(button('删除界面', () => {
      if (!confirm('删除此自定义界面及其中的组件？保存后生效。')) return;
      draft.pages = draft.pages.filter(item => item.id !== selected);
      selected = draft.pages[0].id;
      render();
    }));
    const toolbar = node('div', 'actions widget-toolbar');
    const type = select(Object.entries(kinds).filter(([key]) => key !== 'custom'), 'clock');
    type.setAttribute('aria-label', '组件类型');
    const add = button('添加组件', () => {
      const key = type.value;
      const widget = { id: crypto.randomUUID(), type: key, name: kinds[key], size: 'small', color: '#82d9ce' };
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
    preview = node('div', 'widget-grid');
    preview.setAttribute('aria-label', '组件预览（硬件数字为示例）');
    detail.replaceChildren(props, toolbar, preview, ...page.widgets.map(widget => editWidget(page, widget)));
    if (page.widgets.length === 1) detail.querySelector('.page-widget-editor').open = true;
    refreshPreview();
    permission.checked = draft.shortcutsEnabled;
    save.disabled = !dirty();
    $('widget-import-add').disabled = page.widgets.length >= 8;
  }

  function editWidget(page, widget) {
    const box = node('details', 'page-widget-editor');
    const summary = node('summary', '', widget.name + ' · ' + kinds[widget.type]);
    const fields = node('div', 'widget-fields');
    field(fields, '名称', widget.name, value => {
      widget.name = value;
      summary.textContent = value + ' · ' + kinds[widget.type];
    }, { max: 24 });
    field(fields, '尺寸', widget.size, value => { widget.size = value; }, { entries: sizes });
    field(fields, '颜色', widget.color, value => { widget.color = value; }, { type: 'color' });
    if (widget.type === 'text') field(fields, '内容', widget.text, value => { widget.text = value; }, { max: 160 });
    if (widget.type === 'metric') field(fields, '读数', widget.metric, value => { widget.metric = value; }, {
      entries: Object.entries(metrics).map(([id, info]) => [id, info[0]])
    });
    if (widget.type === 'shortcut') {
      const preset = field(fields, '截图快捷键预设', '', value => {
        if (value) {
          shortcut.value = value;
          widget.keys = value;
        }
      }, { entries: [['', '请选择'], ...screenshotKeys] });
      const shortcut = field(fields, '快捷键', widget.keys, value => {
        widget.keys = value;
        updatePreset();
      }, { max: 64, placeholder: '例如 Win+Shift+S' });
      function updatePreset() {
        preset.value = screenshotKeys.find(([keys]) => keys.toLowerCase() === widget.keys.trim().toLowerCase())?.[0] ?? '';
      }
      updatePreset();
    }
    if (widget.type === 'custom') {
      field(fields, '主文字模板', widget.manifest.template, value => { widget.manifest.template = value; }, { max: 120 });
      field(fields, '补充文字', widget.manifest.detail ?? '', value => {
        widget.manifest.detail = value || null;
      }, { max: 160 });
      field(fields, '圆环指标', widget.manifest.gauge ?? '', value => { widget.manifest.gauge = value || null; }, {
        entries: [['', '无'], ...Object.entries(metrics).map(([id, info]) => [id, info[0]])]
      });
    }
    box.append(summary, fields, button('移除组件', () => {
      page.widgets = page.widgets.filter(item => item.id !== widget.id);
      render();
    }));
    return box;
  }

  async function load() {
    editor.disabled = true;
    try {
      const response = await fetch('/api/pages', { signal: AbortSignal.timeout(3500) });
      if (!response.ok) throw Error('无法读取界面。');
      draft = (await response.json()).layout;
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
    if (!draft || draft.pages.length >= 6) return;
    selected = crypto.randomUUID().replaceAll('-', '');
    draft.pages.push({ id: selected, kind: 'custom', name: '我的界面', color: '#151621', widgets: [] });
    render();
    detail.querySelector('input')?.focus();
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
    if (!draft || currentPage().widgets.length >= 8) return;
    const input = $('widget-manifest');
    editor.disabled = true;
    try {
      const parsed = JSON.parse(input.value);
      const manifest = await send('/api/pages/validate-widget', JSON.stringify(parsed));
      const { name, size, color } = manifest;
      currentPage().widgets.push({ id: crypto.randomUUID(), type: 'custom', name, size, color, manifest });
      input.value = '';
      render();
      status.textContent = '组件已校验并添加。保存界面后在手机显示。';
    } catch (error) { status.textContent = error instanceof SyntaxError ? '请粘贴完整的 JSON 对象。' : error.message; }
    finally { editor.disabled = false; }
  });
  $('copy-widget-prompt').addEventListener('click', async () => {
    try {
      const response = await fetch('/shared/widget-v1.schema.json', { signal: AbortSignal.timeout(3500) });
      if (!response.ok) throw Error();
      const schema = await response.text();
      const prompt = [
        '请为「桌面副屏」生成一个兼容组件。用途：[填写你想显示的内容]。只输出一个 JSON 对象，遵守下列 Schema。',
        '可在 template 和 detail 中使用 {{time}}、{{date}}、{{music.title}}、{{music.artist}}、',
        '{{music.progress}}、{{music.duration}}、{{gpu.name}}，也可以使用 Schema 中 gauge 的任一指标作为 {{指标}}。',
        '数据读数自动附带单位，缺值显示 —。禁止添加 HTML、脚本、命令或未声明的字段。',
        '例子：' + JSON.stringify(example), 'JSON Schema：', schema
      ].join('\n');
      await navigator.clipboard.writeText(prompt);
      status.textContent = '已复制提示词和规范，替换其中的用途后发给 AI。';
    } catch { status.textContent = '复制失败，可以下载 JSON 规范后交给 AI。'; }
  });
  load();
})();

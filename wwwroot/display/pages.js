'use strict';

const phonePages = (() => {
  const main = document.querySelector('main');
  const dashboard = document.getElementById('dashboard');
  const grid = document.getElementById('dashboard-widgets');
  const strip = document.getElementById('page-widgets');
  const stage = document.getElementById('widget-stage');
  const heading = document.getElementById('dashboard-name');
  const empty = document.getElementById('dashboard-empty');
  const footer = document.getElementById('page-footer');
  const indicator = document.getElementById('page-indicator');
  const follow = document.getElementById('follow-pc');
  const feedback = document.getElementById('shortcut-feedback');
  const builtIn = (id, name) => ({ id, kind: id, name, widgets: [], color: '#171923' });
  let pages = [builtIn('lyrics', '歌词'), builtIn('photo', '相框'), builtIn('clock', '时钟'),
    builtIn('hardware', '硬件监控')];
  let capability;
  let shortcutsEnabled = false;
  let actionsEnabled = false;
  let sourcesRevision;
  let revision;
  let pcRevision;
  let manual;
  let visible;
  let shownPageId;
  let synchronized = false;
  let footerTimer;
  let state;
  let mounted;
  let tiles = [];
  let hardware;
  let needsMetrics = false;
  let data;
  let dataInterval;
  let sampledPage;
  let dataDue = 0;
  let touch;
  let suppressClick = false;
  let feedbackTimer;
  let direction = 0;
  let motion;

  function show(mode, nextState) {
    state = nextState;
    const firstSync = !synchronized && !!state;
    if (firstSync) synchronized = true;
    const command = state?.displayRevision;
    if (pcRevision !== undefined && command !== undefined && command !== pcRevision) manual = undefined;
    if (command !== undefined) pcRevision = command;
    const page = pages.find(item => item.id === manual) ?? pages.find(item => item.id === mode) ?? pages[0];
    if (page.id !== shownPageId) {
      if (shownPageId !== undefined && (!firstSync || manual)) {
        footer.hidden = false;
        clearTimeout(footerTimer);
        footerTimer = setTimeout(() => { footer.hidden = true; }, 2000);
      }
      shownPageId = page.id;
    }
    if (page !== visible) {
      visible = page;
      mount(page);
    }
    if (follow.hidden === !!manual) follow.hidden = !manual;
    return page.kind === 'hardware' || page.kind === 'custom' ? 'dashboard' : page.kind;
  }

  function mount(page) {
    const expanded = page.kind === 'hardware' || page.kind === 'custom';
    const custom = page.widgets.filter(widget => widget.type === 'custom' && widget.manifest?.version === 2);
    const references = custom.map(widget => [widget, widgetV2.references(widget.manifest)]);
    tiles = page.widgets.map(widget => widget.type === 'custom' && widget.manifest?.version === 2
      ? widgetV2.make(widget, capability && actionsEnabled ? runAction : null)
      : deskWidgets.make(widget, capability && shortcutsEnabled ? press : null,
        capability && actionsEnabled ? controlMusic : null));
    const free = widgetPlacement.isFree(page);
    const rects = free ? widgetPlacement.resolve(page) : null;
    stage.replaceChildren(...(free ? tiles.map((tile, i) => widgetPlacement.frame(tile.element, rects[i])) : []));
    grid.replaceChildren(...(!free && expanded ? tiles.map(tile => tile.element) : []));
    strip.replaceChildren(...(!free && !expanded ? tiles.map(tile => tile.element) : []));
    stage.hidden = !free;
    grid.hidden = free;
    grid.scrollTop = strip.scrollTop = 0;
    strip.hidden = free || expanded || tiles.length === 0;
    empty.hidden = tiles.length !== 0;
    const pageName = page.name.trim();
    const pageNumber = '第 ' + (pages.indexOf(page) + 1) + ' 页';
    heading.textContent = pageName;
    heading.hidden = !pageName;
    if (expanded) {
      if (pageName) {
        dashboard.setAttribute('aria-labelledby', heading.id);
        dashboard.removeAttribute('aria-label');
      } else {
        dashboard.removeAttribute('aria-labelledby');
        dashboard.setAttribute('aria-label', pageNumber);
      }
    }
    dashboard.style.setProperty('--dashboard-background', page.color);
    document.getElementById('clock').style.backgroundColor = page.color;
    indicator.setAttribute('aria-label', [pageName, pageNumber, '共 ' + pages.length + ' 页'].filter(Boolean).join('，'));
    indicator.replaceChildren(...pages.map(item => {
      const dot = deskWidgets.node('span', 'page-dot' + (item === page ? ' active' : ''));
      dot.setAttribute('aria-hidden', 'true');
      return dot;
    }));
    needsMetrics = page.kind === 'hardware' || page.widgets.some(widget =>
      widget.type === 'metric' || (widget.type === 'custom' && (widget.manifest.gauge ||
        /\{\{(?:cpu|gpu|ram)\./.test(widget.manifest.template + ' ' + (widget.manifest.detail ?? ''))))) ||
      references.some(([, keys]) => keys.some(key => /^(cpu|gpu|ram)\./.test(key)));
    const intervals = references.filter(([, keys]) => keys.some(key => widgetV2.serverGroups.has(key.split('.')[0])))
      .map(([widget]) => widget.manifest.refreshMs ?? 2000);
    dataInterval = intervals.length ? Math.min(...intervals) : undefined;
    if (sampledPage !== page) {
      dataDue = 0;
      data = undefined;
    }
    mounted = page;
    updateTiles();
    motion?.cancel();
    if (direction && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      motion = (expanded ? dashboard : document.getElementById(page.kind)).animate([
        { opacity: .68, transform: 'translateX(' + direction * 16 + 'px)' },
        { opacity: 1, transform: 'translateX(0)' }
      ], { duration: 175, easing: 'ease-out' });
    }
    direction = 0;
  }

  function updateTiles() {
    const now = new Date();
    for (const tile of tiles) tile.update({ now, state, hardware, data });
  }

  function navigate(delta) {
    const index = pages.indexOf(visible);
    manual = pages[(Math.max(0, index) + delta + pages.length) % pages.length].id;
    direction = delta;
  }

  follow.addEventListener('click', () => { manual = undefined; });
  main.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    const button = event.pointerType === 'touch' ? event.target.closest('button') : null;
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY, button, origin: event.target,
      time: performance.now(), moved: false };
  });
  main.addEventListener('pointermove', event => {
    if (touch?.id === event.pointerId && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 12)
      touch.moved = true;
  });
  main.addEventListener('pointercancel', () => { touch = undefined; });
  main.addEventListener('contextmenu', event => {
    if (widgetV2.hasGesture(event.target, 'longPress')) event.preventDefault();
  });
  main.addEventListener('pointerup', event => {
    if (touch?.id !== event.pointerId) return;
    const dx = event.clientX - touch.x;
    const dy = event.clientY - touch.y;
    const { button, time, moved, origin } = touch;
    touch = undefined;
    if (Math.abs(dx) >= Math.max(36, Math.min(90, innerWidth * .075)) && Math.abs(dx) >= Math.abs(dy) * 1.35) {
      suppressClick = true;
      if (!widgetV2.gesture(origin, dx < 0 ? 'swipeLeft' : 'swipeRight')) navigate(dx < 0 ? 1 : -1);
      return;
    }
    const still = !moved && Math.hypot(dx, dy) <= 12;
    const elapsed = performance.now() - time;
    if (still && elapsed >= 650 && widgetV2.gesture(origin, 'longPress')) {
      suppressClick = true;
      return;
    }
    if (!origin.closest('button, a') && still && elapsed < 650 && widgetV2.gesture(origin, 'tap')) {
      suppressClick = true;
      return;
    }
    if (!button) return;
    // Handle a touch tap once, even if the browser delays its synthesized click after a swipe.
    suppressClick = true;
    if (still && elapsed < 650 &&
      button.contains(document.elementFromPoint(event.clientX, event.clientY))) button.click();
  });
  main.addEventListener('click', event => {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener('keydown', event => {
    if (!event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      navigate(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });

  async function press(widget, button) {
    if (!capability) return;
    button.disabled = true;
    try {
      const response = await fetch('/api/widgets/' + widget.id + '/press', {
        method: 'POST',
        headers: { 'X-DeskSide-Shortcut': capability },
        signal: AbortSignal.timeout(3500)
      });
      if (!response.ok) {
        const type = response.headers.get('Content-Type') ?? '';
        throw Error(type.startsWith('text/plain') ? await response.text() : '快捷键暂不可用。');
      }
      announce('已发送 ' + widget.keys);
    } catch (error) { announce(error.message || '发送失败'); }
    finally { button.disabled = !capability; }
  }

  async function runAction(widget, trigger, parameters) {
    if (!capability || !actionsEnabled) return;
    try {
      const query = parameters ? '?' + new URLSearchParams(parameters) : '';
      const response = await fetch('/api/widgets/' + widget.id + '/action/' + trigger + query, {
        method: 'POST', headers: { 'X-DeskSide-Shortcut': capability },
        signal: AbortSignal.timeout(3500)
      });
      if (!response.ok) {
        const type = response.headers.get('Content-Type') ?? '';
        throw Error(type.startsWith('text/plain') ? await response.text() : '组件动作暂不可用。');
      }
      dataDue = 0;
      announce(['已执行', widget.name.trim()].filter(Boolean).join(' · '));
    } catch (error) { announce(error.message || '操作失败'); }
  }

  async function controlMusic(widget, action) {
    if (!capability || !actionsEnabled) return;
    try {
      const response = await fetch('/api/widgets/' + widget.id + '/media/' + action, {
        method: 'POST', headers: { 'X-DeskSide-Shortcut': capability }, signal: AbortSignal.timeout(3500)
      });
      if (!response.ok) {
        const type = response.headers.get('Content-Type') ?? '';
        throw Error(type.startsWith('text/plain') ? await response.text() : '音乐控制暂不可用。');
      }
    } catch (error) { announce(error.message || '音乐控制失败'); }
  }

  function announce(message) {
    feedback.textContent = message;
    feedback.hidden = false;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { feedback.hidden = true; }, 2500);
  }

  async function refreshLayout() {
    try {
      const response = await fetch('/api/pages', { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw Error();
      const next = await response.json();
      if (next.layout.revision !== revision || registration(next.shortcutCapability) ||
        Boolean(next.actionsEnabled) !== actionsEnabled || Boolean(next.layout.shortcutsEnabled) !== shortcutsEnabled ||
        next.sourcesRevision !== sourcesRevision) {
        revision = next.layout.revision;
        sourcesRevision = next.sourcesRevision;
        pages = next.layout.pages;
        capability = next.shortcutCapability;
        actionsEnabled = Boolean(next.actionsEnabled);
        shortcutsEnabled = Boolean(next.layout.shortcutsEnabled);
        if (!pages.some(page => page.id === manual)) manual = undefined;
        visible = undefined;
      }
    } catch {
      data = undefined;
      dataDue = 0;
      if (capability) {
        capability = undefined;
        visible = undefined;
      }
    } finally { setTimeout(refreshLayout, 1400); }
  }

  function registration(value) { return (value ?? null) !== (capability ?? null); }

  async function refreshMetrics() {
    try {
      if (needsMetrics && !document.hidden) {
        const response = await fetch('/api/metrics', { signal: AbortSignal.timeout(4500) });
        hardware = response.ok ? await response.json() : undefined;
      }
    } catch { hardware = undefined; }
    finally { setTimeout(refreshMetrics, 1800); }
  }

  async function refreshData() {
    const page = mounted;
    try {
      if (dataInterval && page && !document.hidden && performance.now() >= dataDue) {
        dataDue = performance.now() + dataInterval;
        sampledPage = page;
        const response = await fetch('/api/widget-data?page=' + encodeURIComponent(page.id), {
          signal: AbortSignal.timeout(7000)
        });
        const next = response.ok ? await response.json() : undefined;
        if (mounted === page) data = next;
      }
    } catch { if (mounted === page) data = undefined; }
    finally { setTimeout(refreshData, 500); }
  }

  refreshLayout();
  refreshMetrics();
  refreshData();
  setInterval(updateTiles, 350);
  return { show };
})();

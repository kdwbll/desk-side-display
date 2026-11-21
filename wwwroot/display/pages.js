'use strict';

const phonePages = (() => {
  const main = document.querySelector('main');
  const dashboard = document.getElementById('dashboard');
  const updateBackdrop = createPageBackdrop(document.getElementById('page-backdrop'));
  const grid = document.getElementById('dashboard-widgets');
  const strip = document.getElementById('page-widgets');
  const stage = document.getElementById('widget-stage');
  const heading = document.getElementById('dashboard-name');
  const empty = document.getElementById('dashboard-empty');
  const feedback = document.getElementById('shortcut-feedback');
  const builtIn = (id, name) => ({ id, kind: id, name, widgets: [], color: '#171923' });
  let pages = [builtIn('lyrics', '歌词'), builtIn('hardware', '硬件监控')];
  let capability;
  let shortcutsEnabled = false;
  let actionsEnabled = false;
  let sourcesRevision;
  let revision;
  let pcRevision;
  let manual;
  let visible;
  let state;
  let mounted;
  const pageViews = new Map();
  let hardware;
  let touch;
  let suppressClick = false;
  let feedbackTimer;
  let direction = 0;
  let motion;

  function show(mode, nextState) {
    const stateChanged = state !== nextState;
    state = nextState;
    const command = state?.displayRevision;
    if (pcRevision !== undefined && command !== undefined && command !== pcRevision) manual = undefined;
    if (command !== undefined) pcRevision = command;
    const page = pages.find(item => item.id === manual) ?? pages.find(item => item.id === mode) ?? pages[0];
    if (stateChanged || page !== visible) updateBackdrop(page, state);
    if (page !== visible) {
      visible = page;
      mount(page);
    }
    return page.kind === 'hardware' || page.kind === 'custom' ? 'dashboard' : page.kind;
  }

  function createPageView(page) {
    const expanded = page.kind === 'hardware' || page.kind === 'custom';
    const custom = page.widgets.filter(widget => widget.type === 'custom' && widget.manifest?.version === 2);
    const references = custom.map(widget => [widget, widgetV2.references(widget.manifest)]);
    const tiles = page.widgets.map(widget => widget.type === 'custom' && widget.manifest?.version === 2
      ? widgetV2.make(widget, capability && actionsEnabled ? runAction : null)
      : deskWidgets.make(widget, capability && shortcutsEnabled ? press : null,
        capability && actionsEnabled ? controlMusic : null, openNote));
    const free = widgetPlacement.isFree(page);
    const rects = free ? widgetPlacement.resolve(page) : null;
    const roots = free ? tiles.map((tile, i) => widgetPlacement.frame(tile.element, rects[i]))
      : tiles.map(tile => tile.element);
    const needsMetrics = page.kind === 'hardware' || page.widgets.some(widget =>
      widget.type === 'metric' || (widget.type === 'custom' && (widget.manifest.gauge ||
        /\{\{(?:cpu|gpu|ram)\./.test(widget.manifest.template + ' ' + (widget.manifest.detail ?? ''))))) ||
      references.some(([, keys]) => keys.some(key => /^(cpu|gpu|ram)\./.test(key)));
    const intervals = references.filter(([, keys]) => keys.some(key => widgetV2.serverGroups.has(key.split('.')[0])))
      .map(([widget]) => widget.manifest.refreshMs ?? 2000);
    return { page, expanded, tiles, roots, free, needsMetrics, dataDue: 0,
      dataInterval: intervals.length ? Math.min(...intervals) : undefined };
  }

  function mount(page) {
    if (mounted && pageViews.has(mounted.page)) {
      const scrollable = [grid, strip, ...mounted.tiles.flatMap(({element}) =>
        [element, ...element.querySelectorAll('.widget-v2-history-list')])];
      mounted.scroll = scrollable.filter(element => element.scrollTop).map(element => [element, element.scrollTop]);
      mounted.weatherMotion = mounted.tiles.flatMap(({element}) =>
        [...element.querySelectorAll('.widget-weather')].flatMap(card =>
          card.getAnimations({ subtree: true }).filter(animation => animation.currentTime !== null)
            .map(animation => [animation.effect.target, animation.animationName, animation.currentTime])));
    }
    if (!pageViews.has(page)) pageViews.set(page, createPageView(page));
    const view = pageViews.get(page);
    const { expanded, tiles, roots, free } = view;
    stage.replaceChildren(...(free ? roots : []));
    grid.replaceChildren(...(!free && expanded ? roots : []));
    strip.replaceChildren(...(!free && !expanded ? roots : []));
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
    main.dataset.pageLabel = [pageName, pageNumber, '共 ' + pages.length + ' 页'].filter(Boolean).join(' · ');
    mounted = view;
    updateTiles();
    if (view.scroll?.length || view.weatherMotion?.length) requestAnimationFrame(() => {
      if (view !== mounted) return;
      for (const [element, top] of view.scroll) element.scrollTop = top;
      for (const [element, name, time] of view.weatherMotion) {
        const animation = element.getAnimations().find(item => item.animationName === name);
        if (animation) animation.currentTime = time;
      }
    });
    motion?.cancel();
    if (direction && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      motion = (expanded ? dashboard : document.getElementById(page.kind)).animate([
        { transform: 'translateX(' + direction * 16 + 'px)' },
        { transform: 'translateX(0)' }
      ], { duration: 175, easing: 'ease-out' });
    }
    direction = 0;
  }

  function updateTiles() {
    if (!mounted) return;
    const now = new Date();
    for (const tile of mounted.tiles) tile.update({ now, state, hardware, data: mounted.data });
  }

  function navigate(delta) {
    const index = pages.indexOf(visible);
    manual = pages[(Math.max(0, index) + delta + pages.length) % pages.length].id;
    direction = delta;
  }

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
      if (mounted) mounted.dataDue = 0;
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

  async function openNote(widget) {
    if (!actionsEnabled) return announce('请在 Windows 控制面板允许组件动作。');
    if (!capability) return announce('请确认手机已通过 USB 连接。');
    try {
      const response = await fetch('/api/widgets/' + widget.id + '/open-note', {
        method: 'POST', headers: { 'X-DeskSide-Shortcut': capability }, signal: AbortSignal.timeout(3500)
      });
      if (!response.ok) {
        const type = response.headers.get('Content-Type') ?? '';
        throw Error(type.startsWith('text/plain') ? await response.text() : '暂时无法新建便签。');
      }
      announce('已在 Windows 桌面新建并打开便签。');
    } catch (error) { announce(error.message || '新建便签失败。'); }
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
        pageViews.clear();
        visible = undefined;
      }
    } catch {
      if (capability) {
        capability = undefined;
        pageViews.clear();
        visible = undefined;
      }
    } finally { setTimeout(refreshLayout, 1400); }
  }

  function registration(value) { return (value ?? null) !== (capability ?? null); }

  async function refreshMetrics() {
    try {
      if (mounted?.needsMetrics && !document.hidden) {
        const response = await fetch('/api/metrics', { signal: AbortSignal.timeout(4500) });
        hardware = response.ok ? await response.json() : undefined;
      }
    } catch { hardware = undefined; }
    finally { setTimeout(refreshMetrics, 1800); }
  }

  async function refreshData() {
    const view = mounted;
    if (!view?.dataInterval || view.fetching || document.hidden || performance.now() < view.dataDue) return;
    view.fetching = true;
    view.dataDue = performance.now() + view.dataInterval;
    try {
      const response = await fetch('/api/widget-data?page=' + encodeURIComponent(view.page.id), {
        signal: AbortSignal.timeout(7000)
      });
      if (!pageViews.has(view.page)) return;
      if (response.ok) view.data = await response.json();
      else if (response.status === 401 || response.status === 403) {
        for (const cached of pageViews.values()) cached.data = undefined;
        updateTiles();
        return;
      } else if (response.status === 404) view.data = undefined;
      if (view === mounted && pageViews.has(view.page)) updateTiles();
    } catch {
      // Keep the last successful sample during temporary network failures.
    } finally {
      view.fetching = false;
    }
  }

  refreshLayout();
  refreshMetrics();
  setInterval(refreshData, 500);
  setInterval(updateTiles, 350);
  return { show };
})();

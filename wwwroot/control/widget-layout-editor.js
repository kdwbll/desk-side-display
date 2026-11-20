'use strict';

window.widgetLayoutEditor = (() => {
  const { node } = deskWidgets;
  const edges = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  let activeId;

  function background(page) {
    const layer = node('div', 'layout-preview-scene layout-preview-' + page.kind);
    layer.setAttribute('aria-hidden', 'true');
    if (page.kind === 'clock') layer.append(node('strong', '', '10:24'), node('span', '', '11月20日 星期五'));
    else if (page.kind === 'lyrics') layer.append(node('span', 'layout-preview-cover'),
      node('strong', '', '歌词会显示在这里'));
    else if (page.name.trim() && (page.kind === 'hardware' || page.kind === 'custom'))
      layer.append(node('strong', '', page.name));
    return layer;
  }

  function select(stage, id) {
    activeId = id;
    for (const frame of stage.querySelectorAll(':scope > .widget-placed'))
      frame.classList.toggle('selected', frame.dataset.widgetId === id);
  }

  function render(stage, page, tileFor, changed) {
    const rects = widgetPlacement.resolve(page);
    const frames = [];
    const store = (index, next) => {
      if (Object.keys(next).every(key => next[key] === rects[index][key])) return;
      rects[index] = next;
      page.widgets.forEach((widget, i) => { widget.placement = { ...rects[i] }; });
      changed();
    };
    for (const [index, widget] of page.widgets.entries()) {
      const frame = widgetPlacement.frame(tileFor(widget), rects[index]);
      frames.push(frame);
      frame.dataset.widgetId = widget.id;
      frame.tabIndex = 0;
      frame.setAttribute('role', 'group');
      frame.setAttribute('aria-label', (widget.name.trim() || '组件 ' + (index + 1)) + '，方向键移动，Shift 加方向键调整尺寸');
      for (const edge of edges) {
        const handle = node('span', 'layout-handle layout-handle-' + edge);
        handle.dataset.edge = edge;
        handle.setAttribute('aria-hidden', 'true');
        frame.append(handle);
      }
      frame.addEventListener('focus', () => select(stage, widget.id));
      frame.addEventListener('keydown', event => {
        const movement = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!movement) return;
        event.preventDefault();
        const [x, y] = movement;
        const step = event.altKey ? 2 : 12;
        const edge = event.shiftKey ? (x ? 'e' : 's') : '';
        const next = widgetPlacement.adjust(rects[index], x * step, y * step, edge);
        widgetPlacement.place(frame, next);
        store(index, next);
      });
      let drag;
      frame.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        frame.focus({ preventScroll: true });
        select(stage, widget.id);
        frame.setPointerCapture(event.pointerId);
        drag = {
          pointer: event.pointerId, x: event.clientX, y: event.clientY,
          width: stage.clientWidth, height: stage.clientHeight,
          rect: rects[index], edge: event.target.dataset.edge
        };
      });
      const position = event => widgetPlacement.adjust(drag.rect,
        (event.clientX - drag.x) * 1000 / drag.width, (event.clientY - drag.y) * 1000 / drag.height, drag.edge);
      frame.addEventListener('pointermove', event => {
        if (event.pointerId === drag?.pointer) widgetPlacement.place(frame, position(event));
      });
      frame.addEventListener('pointerup', event => {
        if (event.pointerId !== drag?.pointer) return;
        const next = position(event);
        drag = undefined;
        widgetPlacement.place(frame, next);
        store(index, next);
      });
      frame.addEventListener('lostpointercapture', () => {
        if (!drag) return;
        drag = undefined;
        widgetPlacement.place(frame, rects[index]);
      });
    }
    stage.replaceChildren(background(page), ...frames);
    select(stage, page.widgets.some(widget => widget.id === activeId) ? activeId : undefined);
  }

  return { render, select };
})();

'use strict';

window.widgetLayoutEditor = (() => {
  const { node } = deskWidgets;
  const edges = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const axes = [
    { position: 'x', size: 'width', start: 'w', end: 'e', style: 'left' },
    { position: 'y', size: 'height', start: 'n', end: 's', style: 'top' }
  ];
  const snapDistance = 6;
  let activeId;
  const sizeObserver = new ResizeObserver(([{ target }]) => {
    const dimensions = target.parentElement?.querySelector('.layout-dimensions');
    if (dimensions && target.classList.contains('selected')) measure(target, dimensions);
  });

  function measure(frame, dimensions) {
    const { width, height } = frame.getBoundingClientRect();
    dimensions.textContent = Math.round(width) + ' × ' + Math.round(height) + ' px';
  }

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
    let selected;
    for (const frame of stage.querySelectorAll(':scope > .widget-placed')) {
      const active = frame.dataset.widgetId === id;
      frame.classList.toggle('selected', active);
      if (active) selected = frame;
    }
    const dimensions = stage.querySelector('.layout-dimensions');
    dimensions.hidden = !selected;
    sizeObserver.disconnect();
    if (selected) {
      measure(selected, dimensions);
      sizeObserver.observe(selected, { box: 'border-box' });
    }
  }

  function snapAxis(rect, drag, axis, radius) {
    const { position, size, start, end } = axis;
    const leading = drag.edge.includes(start);
    const trailing = drag.edge.includes(end);
    if (drag.edge && !leading && !trailing) return { rect };
    const origin = rect[position];
    const length = rect[size];
    const movingEdge = origin + (trailing ? length : 0);
    const candidates = [];
    const add = (from, to, sizeMatch = false) => {
      const delta = to - from;
      if (Number.isInteger(delta) && Math.abs(delta) <= radius)
        candidates.push({ delta, line: to, sizeMatch });
    };
    for (const other of drag.obstacles) {
      const otherStart = other[position];
      const otherEnd = otherStart + other[size];
      if (drag.edge) {
        add(movingEdge, movingEdge + (other[size] - length) * (leading ? -1 : 1), true);
        add(movingEdge, otherStart);
        add(movingEdge, otherEnd);
      } else {
        for (const ownEdge of [origin, origin + length]) {
          add(ownEdge, otherStart);
          add(ownEdge, otherEnd);
        }
        add(origin + length / 2, otherStart + other[size] / 2);
      }
    }
    // Resizing a card should favor another card's exact dimensions over a nearby edge.
    candidates.sort((a, b) => Number(b.sizeMatch) - Number(a.sizeMatch) || Math.abs(a.delta) - Math.abs(b.delta));
    for (const { delta, line } of candidates) {
      const next = widgetPlacement.adjust(rect, position === 'x' ? delta : 0, position === 'y' ? delta : 0,
        drag.edge, drag.obstacles);
      if (next[position] + (trailing ? next[size] : 0) === movingEdge + delta) return { rect: next, line };
    }
    return { rect };
  }

  function edgePosition(rect, edge, axis) {
    return rect[axis.position] + (edge.includes(axis.end) ? rect[axis.size] : 0);
  }

  function render(stage, page, tileFor, changed) {
    const rects = widgetPlacement.resolve(page);
    const frames = [];
    const guides = axes.map(axis => {
      const guide = node('span', 'layout-guide layout-guide-' + axis.position);
      guide.setAttribute('aria-hidden', 'true');
      guide.hidden = true;
      return guide;
    });
    const dimensions = node('output', 'layout-dimensions');
    dimensions.title = '当前预览中的宽 × 高（像素）';
    dimensions.setAttribute('aria-live', 'off');
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
      const obstacles = () => rects.filter((_, i) => i !== index);
      frame.addEventListener('keydown', event => {
        const movement = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!movement) return;
        event.preventDefault();
        const [x, y] = movement;
        const step = event.altKey ? 2 : 12;
        const edge = event.shiftKey ? (x ? 'e' : 's') : '';
        const next = widgetPlacement.adjust(rects[index], x * step, y * step, edge, obstacles());
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
          pointer: event.pointerId, originX: event.clientX, originY: event.clientY, x: 0, y: 0,
          width: stage.clientWidth, height: stage.clientHeight,
          rect: rects[index], edge: event.target.dataset.edge ?? '', obstacles: obstacles(), blocked: [false, false]
        };
      });
      const position = event => {
        const x = Math.round((event.clientX - drag.originX) * 1000 / drag.width);
        const y = Math.round((event.clientY - drag.originY) * 1000 / drag.height);
        const before = drag.rect;
        const deltas = [x - drag.x, y - drag.y];
        drag.rect = widgetPlacement.adjust(before, ...deltas, drag.edge, drag.obstacles);
        drag.x = x;
        drag.y = y;
        let next = drag.rect;
        for (const [i, axis] of axes.entries()) {
          if (deltas[i])
            drag.blocked[i] = edgePosition(drag.rect, drag.edge, axis) - edgePosition(before, drag.edge, axis) !== deltas[i];
          const pixels = axis.position === 'x' ? drag.width : drag.height;
          const moved = axis.position === 'x' ? x : y;
          const result = moved && !event.altKey && !drag.blocked[i]
            ? snapAxis(next, drag, axis, snapDistance * 1000 / pixels) : { rect: next };
          next = result.rect;
          guides[i].hidden = result.line === undefined;
          if (!guides[i].hidden) guides[i].style[axis.style] = result.line / 10 + '%';
        }
        return next;
      };
      frame.addEventListener('pointermove', event => {
        if (event.pointerId === drag?.pointer) widgetPlacement.place(frame, position(event));
      });
      frame.addEventListener('pointerup', event => {
        if (event.pointerId !== drag?.pointer) return;
        const next = position(event);
        drag = undefined;
        for (const guide of guides) guide.hidden = true;
        widgetPlacement.place(frame, next);
        store(index, next);
      });
      frame.addEventListener('lostpointercapture', event => {
        if (event.pointerId !== drag?.pointer) return;
        drag = undefined;
        for (const guide of guides) guide.hidden = true;
        widgetPlacement.place(frame, rects[index]);
      });
    }
    stage.replaceChildren(background(page), ...frames, ...guides, dimensions);
    select(stage, page.widgets.some(widget => widget.id === activeId) ? activeId : undefined);
  }

  return { render, select };
})();

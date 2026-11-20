'use strict';

window.widgetPlacement = (() => {
  const edge = 1000;
  const minWidth = 55;
  const minHeight = 65;
  const spans = { small: 1, medium: 2, large: 4 };
  const clamp = (value, min, max) => Math.round(Math.max(min, Math.min(max, value)));
  const isFree = page => page.widgets.some(widget => widget.placement);

  function resolve(page) {
    const expanded = page.kind === 'hardware' || page.kind === 'custom';
    const gapX = 18;
    const gapY = 24;
    const margin = 35;
    const top = expanded ? (page.name.trim() ? 138 : margin) : 620;
    const column = (edge - margin * 2 + gapX) / 4;
    const slots = [];
    let row = 0;
    let used = 0;
    for (const widget of page.widgets) {
      const span = spans[widget.size];
      if (used + span > 4) { row++; used = 0; }
      slots.push({ row, column: used, span });
      used += span;
    }
    const height = Math.floor((edge - margin - top + gapY) / (row + 1)) - gapY;
    const occupied = page.widgets.flatMap(widget => widget.placement ? [widget.placement] : []);
    return page.widgets.map((widget, index) => {
      if (widget.placement) return { ...widget.placement };
      const slot = slots[index];
      let rect = {
        x: Math.round(margin + column * slot.column),
        y: top + slot.row * (height + gapY),
        width: Math.round(column * slot.span - gapX),
        height: Math.max(minHeight, height)
      };
      rect.y = Math.min(rect.y, edge - rect.height);
      if (occupied.some(other => overlaps(rect, other))) {
        rect = findSpace(rect, occupied);
      }
      occupied.push(rect);
      return rect;
    });
  }

  function overlaps(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
      a.y < b.y + b.height && a.y + a.height > b.y;
  }

  function findSpace(rect, occupied) {
    const xs = [rect.x, 0, ...occupied.map(other => other.x + other.width + 8)].sort((a, b) => a - b);
    const ys = [rect.y, 0, ...occupied.map(other => other.y + other.height + 8)].sort((a, b) => a - b);
    for (const y of ys) {
      if (y + rect.height > edge) continue;
      for (const x of xs) {
        if (x + rect.width > edge) continue;
        const candidate = { ...rect, x, y };
        if (!occupied.some(other => overlaps(candidate, other))) return candidate;
      }
    }
    return rect;
  }

  function adjust(rect, dx, dy, direction = '') {
    if (!direction) return {
      ...rect, x: clamp(rect.x + dx, 0, edge - rect.width), y: clamp(rect.y + dy, 0, edge - rect.height)
    };
    const { x, y, width, height } = rect;
    const right = x + width;
    const bottom = y + height;
    const leftResult = direction.includes('w') ? clamp(x + dx, 0, right - minWidth) : x;
    const topResult = direction.includes('n') ? clamp(y + dy, 0, bottom - minHeight) : y;
    const rightResult = direction.includes('e') ? clamp(right + dx, x + minWidth, edge) : right;
    const bottomResult = direction.includes('s') ? clamp(bottom + dy, y + minHeight, edge) : bottom;
    return { x: leftResult, y: topResult, width: rightResult - leftResult, height: bottomResult - topResult };
  }

  function place(frame, rect) {
    frame.style.left = rect.x / 10 + '%';
    frame.style.top = rect.y / 10 + '%';
    frame.style.width = rect.width / 10 + '%';
    frame.style.height = rect.height / 10 + '%';
  }

  function preset(rect, size) {
    const width = { small: 220, medium: 455, large: 930 }[size];
    return { ...rect, width, x: Math.min(rect.x, edge - width) };
  }

  function frame(tile, rect) {
    const element = document.createElement('div');
    element.className = 'widget-placed';
    element.append(tile);
    place(element, rect);
    return element;
  }

  return { isFree, resolve, adjust, place, frame, preset };
})();

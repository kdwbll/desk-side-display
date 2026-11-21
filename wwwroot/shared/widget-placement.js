'use strict';

window.widgetPlacement = (() => {
  const edge = 1000;
  const minWidth = 55;
  const minHeight = 65;
  const spans = { small: 1, medium: 2, large: 4 };
  const clamp = (value, min, max) => Math.round(Math.max(min, Math.min(max, value)));
  const isFree = page => page.widgets.some(widget => widget.placement);
  function isClipboardPage(page) {
    const [widget] = page.widgets;
    return page.kind === 'custom' && page.widgets.length === 1 && widget.type === 'custom' &&
      widget.manifest?.version === 2 &&
      (widget.manifest.blocks ?? []).some(block => block.kind === 'history' && block.source === 'clipboard.history');
  }

  function resolve(page) {
    const expanded = page.kind === 'hardware' || page.kind === 'custom';
    const gapX = 18;
    const gapY = 24;
    const margin = 35;
    const preferredTop = expanded ? (page.name.trim() ? 138 : margin) : 620;
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
    const top = Math.min(preferredTop, edge - margin - (row + 1) * minHeight - row * gapY);
    const height = Math.floor((edge - margin - top + gapY) / (row + 1)) - gapY;
    const defaults = slots.map(slot => ({
      x: Math.round(margin + column * slot.column),
      y: top + slot.row * (height + gapY),
      width: Math.round(column * slot.span - gapX),
      height
    }));
    const occupied = [];
    const result = page.widgets.map(({ placement }) => {
      if (!placement || occupied.some(other => overlaps(placement, other))) return null;
      occupied.push(placement);
      return { ...placement };
    });
    for (const [index, preferred] of defaults.entries()) {
      if (result[index]) continue;
      const rect = occupied.some(other => overlaps(preferred, other))
        ? findSpace(preferred, occupied) ?? findSpace({ ...preferred, width: minWidth, height: minHeight }, occupied)
        : preferred;
      // If a saved layout fills the canvas, re-pack all widgets to make room for new ones.
      if (!rect) return defaults;
      result[index] = rect;
      occupied.push(rect);
    }
    return result;
  }

  function overlaps(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
      a.y < b.y + b.height && a.y + a.height > b.y;
  }

  function findSpace(rect, occupied) {
    const xs = [rect.x, 0, ...occupied.map(other => other.x + other.width)];
    const ys = [rect.y, 0, ...occupied.map(other => other.y + other.height)];
    for (const y of ys) {
      if (y + rect.height > edge) continue;
      for (const x of xs) {
        if (x + rect.width > edge) continue;
        const candidate = { ...rect, x, y };
        if (!occupied.some(other => overlaps(candidate, other))) return candidate;
      }
    }
  }

  function bounded(rect, dx, dy, direction) {
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

  function adjust(rect, dx, dy, direction = '', obstacles = []) {
    const horizontally = adjustAxis(rect, dx, 0, direction, obstacles);
    return adjustAxis(horizontally, 0, dy, direction, obstacles);
  }

  function adjustAxis(rect, dx, dy, direction, obstacles) {
    if (!dx && !dy) return rect;
    const at = fraction => bounded(rect, dx * fraction, dy * fraction, direction);
    const clear = candidate => {
      const x = Math.min(rect.x, candidate.x);
      const y = Math.min(rect.y, candidate.y);
      const swept = {
        x, y,
        width: Math.max(rect.x + rect.width, candidate.x + candidate.width) - x,
        height: Math.max(rect.y + rect.height, candidate.y + candidate.height) - y
      };
      return !obstacles.some(other => overlaps(swept, other));
    };
    const target = at(1);
    if (clear(target)) return target;
    let start = 0;
    let end = 1;
    for (let i = 0; i < 12; i++) {
      const fraction = (start + end) / 2;
      if (clear(at(fraction))) start = fraction;
      else end = fraction;
    }
    return at(start);
  }

  function place(frame, rect) {
    frame.style.left = rect.x / 10 + '%';
    frame.style.top = rect.y / 10 + '%';
    frame.style.width = rect.width / 10 + '%';
    frame.style.height = rect.height / 10 + '%';
  }

  function preset(page, widget, size) {
    const width = { small: 220, medium: 455, large: 930 }[size];
    const rects = resolve(page);
    const index = page.widgets.indexOf(widget);
    return adjust(rects[index], width - rects[index].width, 0, 'e', rects.filter((_, i) => i !== index));
  }

  function frame(tile, rect) {
    const element = document.createElement('div');
    element.className = 'widget-placed';
    element.append(tile);
    place(element, rect);
    return element;
  }

  return { isFree, isClipboardPage, resolve, adjust, place, frame, preset };
})();

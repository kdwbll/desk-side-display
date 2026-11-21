'use strict';

// Cluster a small sample by both color distance and pixel coverage.
function albumPalette(image) {
  const sample = document.createElement('canvas');
  sample.width = sample.height = 48;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, 48, 48);
  const pixels = ctx.getImageData(0, 0, 48, 48).data;
  const bins = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    if (!alpha) continue;
    const key = (pixels[i] >> 4) * 256 + (pixels[i + 1] >> 4) * 16 + (pixels[i + 2] >> 4);
    const bin = bins.get(key) ?? { rgb: [0, 0, 0], weight: 0 };
    bin.weight += alpha;
    for (let c = 0; c < 3; c++) bin.rgb[c] += pixels[i + c] * alpha;
    bins.set(key, bin);
  }
  const colors = [...bins.values()].sort((a, b) => b.weight - a.weight);
  if (!colors.length) return [];
  for (const color of colors) color.rgb = color.rgb.map(sum => sum / color.weight);
  const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  let centers = [colors[0]];
  while (centers.length < 4) {
    let best, score = 0;
    for (const color of colors) {
      const gap = Math.min(...centers.map(center => distance(color.rgb, center.rgb)));
      if (gap > 24 ** 2 && gap * color.weight > score) {
        best = color;
        score = gap * color.weight;
      }
    }
    if (!best) break;
    centers.push(best);
  }
  for (let pass = 0; pass < 5; pass++) {
    const sums = centers.map(() => ({ rgb: [0, 0, 0], weight: 0 }));
    for (const color of colors) {
      let nearest = 0;
      for (let j = 1; j < centers.length; j++) {
        if (distance(color.rgb, centers[j].rgb) < distance(color.rgb, centers[nearest].rgb)) nearest = j;
      }
      sums[nearest].weight += color.weight;
      color.rgb.forEach((v, c) => { sums[nearest].rgb[c] += v * color.weight; });
    }
    centers = sums.filter(s => s.weight);
    for (const center of centers) center.rgb = center.rgb.map(sum => sum / center.weight);
  }
  return centers.sort((a, b) => b.weight - a.weight);
}

function paintAlbumField(canvas, palette) {
  // Rank a smooth field, then allocate exactly each cluster's share of its pixels.
  const width = canvas.width = 96, height = canvas.height = 64;
  const context = canvas.getContext('2d');
  const field = context.createImageData(width, height);
  const points = Array.from({ length: width * height }, (_, i) => {
    const x = (i % width) / width * 2 * Math.PI, y = Math.floor(i / width) / height * 2 * Math.PI;
    return { i, value: Math.sin(x + .8 * Math.cos(y)) + .75 * Math.cos(y - x) + .6 * Math.sin(2*x + y) };
  }).sort((a, b) => a.value - b.value);
  const total = palette.reduce((sum, c) => sum + c.weight, 0);
  let at = 0, weight = 0;
  for (const color of palette) {
    weight += color.weight;
    const end = Math.round(points.length * weight / total);
    const rgba = [...color.rgb, 255];
    while (at < end) field.data.set(rgba, points[at++].i * 4);
  }
  context.putImageData(field, 0, 0);
}

function createAlbumFlow(view) {
  const layer = document.createElement('div');
  layer.className = 'album-flow';
  layer.setAttribute('aria-hidden', 'true');
  layer.hidden = true;
  const canvases = [document.createElement('canvas'), document.createElement('canvas')];
  layer.append(...canvases);
  view.prepend(layer);
  let source, generation = 0, active = 0, retryAfter = 0;
  return async function update(url, cover) {
    const next = view.dataset.backgroundMode === 'album' ? url || null : null;
    if (next === source && (!retryAfter || performance.now() < retryAfter)) return;
    const request = ++generation;
    source = next;
    retryAfter = 0;
    if (!next) { layer.hidden = true; return; }
    try {
      const image = cover ?? new Image();
      if (!cover) image.src = next;
      await image.decode();
      if (request !== generation) return;
      const palette = albumPalette(image);
      if (!palette.length) { layer.hidden = true; return; }
      active = 1 - active;
      paintAlbumField(canvases[active], palette);
      canvases.forEach((canvas, i) => canvas.classList.toggle('visible', i === active));
      layer.hidden = false;
    } catch {
      if (request === generation) {
        layer.hidden = true;
        retryAfter = performance.now() + 5000;
      }
    }
  };
}

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

function albumBackgroundColor({ rgb, weight }) {
  const peak = Math.max(...rgb);
  const luma = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  const strength = Math.min(1, Math.max(0, (peak - 18) / 48));
  const lift = 1 + .09 * strength * (1 - peak / 255);
  const channels = rgb.map(channel => Math.max(0, Math.min(255,
    (channel + (channel - luma) * .12 * strength) * lift)));
  return { rgb: channels, weight, luma };
}

const fieldWidth = 96, fieldHeight = 64;
function albumColorRamp(palette, blend) {
  const data = new Uint8ClampedArray(fieldWidth * fieldHeight * 4);
  const colors = palette.map(albumBackgroundColor).sort((a, b) => a.luma - b.luma);
  const total = palette.reduce((sum, c) => sum + c.weight, 0);
  // Blend symmetrically around each weighted boundary, preserving small accents.
  let boundary = 0;
  const seams = colors.slice(0, -1).map((color, i) => {
    boundary += color.weight / total;
    const radius = .49 * (1 + blend / 100) * Math.min(color.weight, colors[i + 1].weight) / total;
    return { start: boundary - radius, end: boundary + radius };
  });
  const rgb = new Float64Array(3);
  for (let rank = 0; rank < fieldWidth * fieldHeight; rank++) {
    const position = (rank + .5) / (fieldWidth * fieldHeight);
    rgb.set(colors[0].rgb);
    for (let band = 0; band < seams.length; band++) {
      const { start, end } = seams[band];
      if (position < start) break;
      if (position >= end) {
        rgb.set(colors[band + 1].rgb);
        continue;
      }
      const t = (position - start) / (end - start);
      const mix = t * t * (3 - 2 * t);
      for (let c = 0; c < 3; c++) rgb[c] += (colors[band + 1].rgb[c] - colors[band].rgb[c]) * mix;
    }
    data.set(rgb, rank * 4);
    data[rank * 4 + 3] = 255;
  }
  return new Uint32Array(data.buffer);
}

// A smooth path through successive pseudo-random coordinates. The seed lets both
// displays start from the same composition without storing a list of waypoints.
function roamingCoordinate(seed, time) {
  const segment = Math.floor(time), t = time - segment;
  function waypoint(index) {
    let n = seed ^ Math.imul(index, 0x9e3779b1);
    n = Math.imul(n ^ n >>> 16, 0x21f0aaad);
    n = Math.imul(n ^ n >>> 15, 0x735a2d97);
    return ((n ^ n >>> 15) >>> 0) / 0x100000000;
  }
  const a = waypoint(segment - 1), b = waypoint(segment);
  const c = waypoint(segment + 1), d = waypoint(segment + 2);
  return b + .5 * t * (c - a + t * (2*a - 5*b + 4*c - d + t * (3*b - 3*c + d - a)));
}

function createAlbumField(canvas, palette) {
  canvas.width = fieldWidth;
  canvas.height = fieldHeight;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(fieldWidth, fieldHeight);
  const pixels = new Uint32Array(image.data.buffer);
  const levels = new Uint16Array(pixels.length), counts = new Uint16Array(2048);
  const periods = [5.5, 7.3, 6.4, 8.2];
  const horizontal = periods.map(() => new Float64Array(fieldWidth));
  const vertical = periods.map(() => new Float64Array(fieldHeight));
  const seed = palette.reduce((s, color) => color.rgb.reduce((v, c) =>
    Math.imul(v ^ Math.round(c), 16777619), s), 2166136261);
  let previousBlend, ramp;
  return function paint(time, blend) {
    if (previousBlend !== blend) {
      ramp = albumColorRamp(palette, blend);
      previousBlend = blend;
    }
    for (let j = 0; j < periods.length; j++) {
      const cx = roamingCoordinate(seed + 2*j, time / periods[j]);
      const cy = roamingCoordinate(seed + 2*j + 1, time / periods[j]);
      for (let x = 0; x < fieldWidth; x++) horizontal[j][x] = 12 * (x / fieldWidth - cx) ** 2;
      for (let y = 0; y < fieldHeight; y++) vertical[j][y] = 1 + 9 * (y / fieldHeight - cy) ** 2;
    }
    counts.fill(0);
    for (let y = 0; y < fieldHeight; y++) {
      for (let x = 0; x < fieldWidth; x++) {
        let value = 0;
        for (let j = 0; j < periods.length; j++) {
          const distance = horizontal[j][x] + vertical[j][y];
          value += (j % 2 ? -1 : 1) / distance;
        }
        const level = Math.min(2047, Math.max(0, Math.floor((value + 2) * 512)));
        levels[y * fieldWidth + x] = level;
        counts[level]++;
      }
    }
    // Assign the weighted palette by rank so moving contours keep their color shares.
    let rank = 0;
    for (let i = 0; i < counts.length; i++) {
      const count = counts[i];
      counts[i] = rank;
      rank += count;
    }
    for (let i = 0; i < pixels.length; i++) pixels[i] = ramp[counts[levels[i]]++];
    ctx.putImageData(image, 0, 0);
  };
}

// Widget and preset pages use light foregrounds and share the lyric flow tuning.
function createPageBackdrop(view) {
  const update = createAlbumFlow(view);
  let baseColor, fallback;
  return (page, state) => {
    const appearance = state?.lyricAppearance;
    view.dataset.backgroundMode = page?.kind === 'lyrics' ? 'fixed' : page?.backgroundMode ?? 'fixed';
    view.dataset.flowSpeed = appearance?.flowSpeed ?? 1;
    view.dataset.flowBlend = appearance?.flowBlend ?? 0;
    view.style.setProperty('--flow-blur-scale', 1 + Number(view.dataset.flowBlend) / 150);
    if (page && baseColor !== page.color) {
      baseColor = page.color;
      const rgb = baseColor.match(/[0-9a-f]{2}/gi).map(channel => parseInt(channel, 16));
      fallback = [
        { rgb: rgb.map(v => v * .5), weight: 3 },
        { rgb, weight: 4 },
        { rgb: rgb.map((v, i) => v * .65 + [70, 96, 128][i]), weight: 3 }
      ];
    }
    update(state?.cover, undefined, fallback);
  };
}

function createAlbumFlow(view) {
  const layer = document.createElement('div');
  layer.className = 'album-flow';
  layer.setAttribute('aria-hidden', 'true');
  layer.hidden = true;
  const canvases = [document.createElement('canvas'), document.createElement('canvas')];
  layer.append(...canvases);
  view.prepend(layer);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paint, moving = false, visible = false, blend = 0, speed = 1;
  let time = 0, previousFrame = 0, frame = 0;
  function advance(now) {
    frame = requestAnimationFrame(advance);
    const elapsed = now - previousFrame;
    if (elapsed < 1000 / 30) return;
    previousFrame = now;
    time += Math.min(elapsed, 100) * speed / 1000;
    paint(time, blend);
  }
  function syncMotion() {
    const run = moving && visible && !layer.hidden && !document.hidden && !reduced.matches && speed > 0;
    if (run && !frame) {
      previousFrame = performance.now();
      frame = requestAnimationFrame(advance);
    } else if (!run && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    syncMotion();
  }).observe(layer);
  document.addEventListener('visibilitychange', syncMotion);
  reduced.addEventListener('change', syncMotion);
  let source, generation = 0, active = 0, retryAfter = 0;
  let lastFallback;
  return async function update(url, cover, fallback) {
    const next = view.dataset.backgroundMode === 'album' ? url || fallback || null : null;
    const nextBlend = Number(view.dataset.flowBlend ?? 0);
    if (nextBlend !== blend) {
      blend = nextBlend;
      if (next && paint && !layer.hidden) paint(time, blend);
    }
    speed = Number(view.dataset.flowSpeed ?? 1);
    syncMotion();
    if (next === source && fallback === lastFallback && (!retryAfter || performance.now() < retryAfter)) return;
    const request = ++generation;
    source = next;
    lastFallback = fallback;
    retryAfter = 0;
    if (!next) { layer.hidden = true; syncMotion(); return; }
    let palette = fallback;
    if (url) {
      try {
        const image = cover ?? new Image();
        if (!cover) image.src = url;
        await image.decode();
        if (request !== generation) return;
        const extracted = albumPalette(image);
        if (extracted.length) palette = extracted;
      } catch {
        if (request !== generation) return;
        retryAfter = performance.now() + 5000;
      }
    }
    if (!palette) { layer.hidden = true; syncMotion(); return; }
    active = 1 - active;
    paint = createAlbumField(canvases[active], palette);
    moving = palette.length > 1;
    time = 0;
    paint(time, blend);
    canvases.forEach((canvas, i) => canvas.classList.toggle('visible', i === active));
    layer.hidden = false;
    syncMotion();
  };
}

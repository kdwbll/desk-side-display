'use strict';

const lyricLineLeadMs = 100;

function applyLyricAppearance(view, appearance) {
  view.dataset.backgroundMode = appearance.backgroundMode ?? 'fixed';
  const blend = appearance.flowBlend ?? 0;
  view.dataset.flowBlend = blend;
  view.style.setProperty('--flow-blur-scale', 1 + blend / 150);
  view.dataset.flowSpeed = appearance.flowSpeed ?? 1;
  const channels = appearance.textColor.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16) / 255);
  const light = channels.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  view.style.setProperty('--flow-veil', light[0]*.2126 + light[1]*.7152 + light[2]*.0722 > .179
    ? 'rgb(12 12 18 / 48%)' : 'rgb(255 251 244 / 66%)');
  view.style.setProperty('--foreground', appearance.textColor);
  view.style.setProperty('--context-opacity', appearance.contextOpacity / 100);
  view.style.setProperty('--context-blur', appearance.blur + 'px');
  view.style.setProperty('--lyric-background', appearance.backgroundColor);
}

'use strict';

function applyLyricAppearance(view, appearance) {
  view.style.setProperty('--foreground', appearance.textColor);
  view.style.setProperty('--context-opacity', appearance.contextOpacity / 100);
  view.style.setProperty('--context-blur', appearance.blur + 'px');
  view.style.setProperty('--lyric-background', appearance.backgroundColor);
}

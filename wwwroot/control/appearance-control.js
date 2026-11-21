'use strict';

const preview = document.getElementById('lyric-preview');
const appearanceFields = document.getElementById('appearance-fields');
const presetFields = document.getElementById('appearance-presets');
const textColor = document.getElementById('lyric-text-color');
const backgroundColor = document.getElementById('lyric-background-color');
const backgroundMode = document.getElementById('lyric-background-mode');
const flowSpeed = document.getElementById('lyric-flow-speed');
const flowSpeedValue = document.getElementById('lyric-flow-speed-value');
const flowBlend = document.getElementById('lyric-flow-blend');
const flowBlendValue = document.getElementById('lyric-flow-blend-value');
const updatePreviewFlow = createAlbumFlow(preview);
document.addEventListener('playback-cover', event => updatePreviewFlow(event.detail));
const opacity = document.getElementById('lyric-opacity');
const blur = document.getElementById('lyric-blur');
const opacityValue = document.getElementById('lyric-opacity-value');
const blurValue = document.getElementById('lyric-blur-value');
const presetName = document.getElementById('lyric-preset-name');
const presetList = document.getElementById('lyric-preset-list');
const presetCount = document.getElementById('lyric-preset-count');
const savePreset = document.getElementById('lyric-preset-save');
const applyPreset = document.getElementById('lyric-preset-apply');
const updatePreset = document.getElementById('lyric-preset-update');
const deletePreset = document.getElementById('lyric-preset-delete');
const appearanceStatus = document.getElementById('appearance-status');

let presets = [];
let presetBusy = false;
let saveTimer;
let edit = 0;
let staged;
let writeQueue = Promise.resolve();
let otherPageUsesFlow = false;
function updateFlowControls() {
  flowSpeed.hidden = flowSpeed.labels[0].hidden = backgroundMode.value !== 'album' && !otherPageUsesFlow;
  flowBlend.hidden = flowBlend.labels[0].hidden = flowSpeed.hidden;
}
document.addEventListener('page-flow-change', event => {
  otherPageUsesFlow = event.detail;
  updateFlowControls();
});

function readAppearance() {
  return { textColor: textColor.value, backgroundColor: backgroundColor.value, backgroundMode: backgroundMode.value,
    flowSpeed: flowSpeed.valueAsNumber, flowBlend: flowBlend.valueAsNumber,
    contextOpacity: opacity.valueAsNumber, blur: blur.valueAsNumber };
}

function updatePreview(appearance) {
  applyLyricAppearance(preview, appearance);
  updatePreviewFlow(state?.cover);
  updateFlowControls();
  flowBlendValue.textContent = (flowBlend.valueAsNumber > 0 ? '+' : '') + flowBlend.value;
  flowSpeedValue.textContent = flowSpeed.valueAsNumber === 0 ? '静止' : flowSpeed.value + '×';
  flowSpeed.setAttribute('aria-valuetext', flowSpeedValue.textContent);
  opacityValue.textContent = appearance.contextOpacity + '%';
  blurValue.textContent = appearance.blur.toFixed(1) + ' px';
}

function loadAppearance(appearance) {
  textColor.value = appearance.textColor;
  backgroundColor.value = appearance.backgroundColor;
  backgroundMode.value = appearance.backgroundMode ?? 'fixed';
  flowSpeed.value = appearance.flowSpeed ?? 1;
  flowBlend.value = appearance.flowBlend ?? 0;
  opacity.value = appearance.contextOpacity;
  blur.value = appearance.blur;
  updatePreview(appearance);
}

function updatePresetButtons() {
  savePreset.disabled = presets.length >= 10 || !presetName.value.trim();
  applyPreset.disabled = updatePreset.disabled = deletePreset.disabled = !presetList.value;
}

function renderPresets(items, selected = presetList.value) {
  presets = items;
  presetList.replaceChildren(new Option('选择预设', ''), ...presets.map(item => new Option(item.name, item.id)));
  presetList.value = presets.some(item => item.id === selected) ? selected : '';
  presetCount.textContent = presets.length + ' / 10';
  updatePresetButtons();
}

function flushAppearance() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!staged) return;
  const { appearance, revision } = staged;
  staged = undefined;
  writeQueue = writeQueue.then(async () => {
    try {
      await send('/api/appearance', JSON.stringify(appearance));
      if (!presetBusy && revision === edit) appearanceStatus.textContent = '外观已更新。';
    } catch (error) {
      if (revision === edit) appearanceStatus.textContent = '外观同步失败。' + error.message;
    }
  });
}

appearanceFields.addEventListener('input', () => {
  const appearance = readAppearance();
  updatePreview(appearance);
  staged = { appearance, revision: ++edit };
  saveTimer ??= setTimeout(flushAppearance, 150);
});
appearanceFields.addEventListener('change', flushAppearance);

function setPresetBusy(busy) {
  presetBusy = busy;
  appearanceFields.disabled = presetFields.disabled = busy;
}

async function presetAction(action) {
  if (presetBusy) return;
  setPresetBusy(true);
  flushAppearance();
  await writeQueue;
  try {
    await action();
  } catch (error) {
    appearanceStatus.textContent = error.message;
  } finally {
    setPresetBusy(false);
  }
}

function saveCurrentPreset(id, name) {
  return presetAction(async () => {
    const result = await send('/api/appearance/presets', JSON.stringify({ id, name, appearance: readAppearance() }));
    const selected = id ?? result.presets.find(item => item.name === name)?.id;
    renderPresets(result.presets, selected);
    if (!id) presetName.value = '';
    updatePresetButtons();
    appearanceStatus.textContent = id ? '预设已更新。' : '预设已保存。';
  });
}

presetName.addEventListener('input', updatePresetButtons);
presetList.addEventListener('change', updatePresetButtons);
savePreset.addEventListener('click', () => saveCurrentPreset(null, presetName.value.trim()));
updatePreset.addEventListener('click', () => {
  const selected = presets.find(item => item.id === presetList.value);
  if (selected) saveCurrentPreset(selected.id, selected.name);
});
applyPreset.addEventListener('click', () => presetAction(async () => {
  const result = await send('/api/appearance/presets/' + presetList.value + '/apply');
  loadAppearance(result.appearance);
  renderPresets(result.presets);
  appearanceStatus.textContent = '预设已应用。';
}));
deletePreset.addEventListener('click', () => presetAction(async () => {
  const result = await send('/api/appearance/presets/' + presetList.value + '/delete');
  renderPresets(result.presets, '');
  appearanceStatus.textContent = '预设已删除。';
}));

async function loadAppearanceSettings() {
  try {
    const response = await fetch('/api/appearance', { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw Error();
    const result = await response.json();
    loadAppearance(result.appearance);
    renderPresets(result.presets);
    setPresetBusy(false);
    appearanceStatus.textContent = '';
  } catch {
    appearanceStatus.textContent = '正在连接外观设置。';
    setTimeout(loadAppearanceSettings, 2000);
  }
}
loadAppearanceSettings();

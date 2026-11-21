const artwork = name => new URL('./assets/' + name, import.meta.url).href;

function timedLines(texts) {
  return texts.map((text, index) => {
    const atMs = index * 3740;
    let next = atMs;
    const words = Array.from(text, (character, i) => {
      const duration = 190 + (i * 69 + index * 83) % 222;
      const word = { text: character, atMs: next, endMs: next + duration };
      next += duration;
      return word;
    });
    return { text, atMs, endMs: next, words };
  });
}

export const tracks = [
  {
    id: 'window-breeze', title: '窗外有风', cover: artwork('cover.jpg'),
    lyrics: timedLines(['路灯收起昨夜的光', '远处的山留住余温', '让晚风带我穿过群山', '星河在身后慢慢展开',
      '把这一刻留在窗边', '树影掠过墙边', '风吹过安静的街', '等晨光落在窗台'])
  },
  {
    id: 'faraway-signal', title: '远方的讯号', cover: artwork('wave.gif'),
    lyrics: timedLines(['城市慢慢调低亮度', '我沿着河岸往回走', '灯塔送来一格讯号', '水面回答了几道波纹',
      '耳边的风渐渐停住', '夜班车驶过旧站台', '下一盏灯还在等我', '把路上的雨留给清晨'])
  }
];

export const samples = {
  mountain: artwork('mountain.jpg'),
  wave: artwork('wave.gif'),
  cover: artwork('cover.jpg')
};

export const metrics = {
  values: { 'cpu.usage': 33, 'cpu.temperature': 65, 'gpu.usage': 6, 'gpu.temperature': 52, 'gpu.power': 41,
    'gpu.fan': 34, 'gpu.clock': 2520, 'ram.used': 23, 'ram.total': 64, 'ram.usage': 36 },
  gpuName: '示例 GPU'
};

export const defaultAppearance = {
  textColor: '#ffffff', contextOpacity: 16, blur: 0, backgroundColor: '#0a0a0b',
  backgroundMode: 'album', flowSpeed: 1.5, flowBlend: 100
};

export function appearancePresets() {
  const fixed = { ...defaultAppearance, textColor: '#f8f1e8', backgroundMode: 'fixed', flowSpeed: 1, flowBlend: 0 };
  return [
    { ...fixed, contextOpacity: 30, blur: 1, backgroundColor: '#171923' },
    { ...fixed, contextOpacity: 55, blur: 1.4, backgroundColor: '#000000' },
    { ...fixed, contextOpacity: 59, blur: 2, backgroundColor: '#121226' },
    { ...defaultAppearance, backgroundColor: '#121226', flowSpeed: 1, flowBlend: 0 },
    { ...defaultAppearance, flowSpeed: 1 }
  ].map((appearance, index) => ({ id: crypto.randomUUID(), name: String(index + 1), appearance }));
}

export async function initialLayout() {
  const example = name => fetch(new URL('./shared/examples/' + name + '-widget.json', import.meta.url))
    .then(response => response.json());
  const [weather, clipboard] = await Promise.all([example('weather'), example('clipboard')]);
  clipboard.layout.firstPresent = true;
  const item = (type, name, x, y, width, height, extra = {}) => ({
    id: crypto.randomUUID(), type, name, size: 'small', color: '#82d9ce',
    placement: { x, y, width, height }, ...extra
  });
  const cards = [
    item('shortcut', '键盘快捷键', 35, 90, 191, 202, { keys: 'Win+Shift+S' }),
    item('shortcut', '键盘快捷键', 242, 90, 191, 202, { keys: 'Ctrl+C' }),
    item('music', '正在播放', 35, 359, 398, 568),
    item('custom', '天气', 471, 90, 476, 368, { color: weather.color, manifest: { ...weather, size: 'small' } }),
    item('text', '便签', 682, 526, 265, 401, { text: '写点什么' }),
    item('gif', '', 471, 526, 181, 401, { mediaId: 'wave', fit: 'cover' })
  ];
  const instruments = [
    ['CPU', 'cpu.usage', '#39dbc6'], ['GPU', 'gpu.usage', '#afe64f'],
    ['内存', 'ram.used', '#ae9cff'], ['GPU 温度', 'gpu.temperature', '#ff9a57']
  ].map(([name, metric, color]) => ({ id: crypto.randomUUID(), type: 'metric', name, metric, color, size: 'small' }));
  return {
    revision: 0, shortcutsEnabled: true, widgetLibrary: [],
    pages: [
      { id: 'lyrics', kind: 'lyrics', name: '歌词', color: '#171923', widgets: [] },
      { id: 'photo', kind: 'photo', name: '相框', color: '#171923', backgroundMode: 'album', widgets: [] },
      { id: 'clock', kind: 'clock', name: '时钟', color: '#030303', backgroundMode: 'album', widgets: [] },
      { id: 'hardware', kind: 'hardware', name: '', color: '#000000', backgroundMode: 'album', widgets: instruments },
      { id: crypto.randomUUID().replaceAll('-', ''), kind: 'custom', name: '', color: '#151621',
        backgroundMode: 'album', widgets: cards },
      { id: crypto.randomUUID().replaceAll('-', ''), kind: 'custom', name: '', color: '#151621',
        backgroundMode: 'album', widgets: [{ id: crypto.randomUUID(), type: 'custom', name: clipboard.name,
          size: clipboard.size, color: clipboard.color, manifest: clipboard }] }
    ]
  };
}

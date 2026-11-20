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

export async function initialLayout() {
  const weather = await fetch(new URL('./shared/examples/weather-widget.json', import.meta.url)).then(response => response.json());
  const item = (type, name, x, y, width, height, extra = {}) => ({
    id: crypto.randomUUID(), type, name, size: 'medium', color: '#9fddce',
    placement: { x, y, width, height }, ...extra
  });
  const cards = [
    item('custom', '天气', 40, 140, 300, 348, { manifest: weather }),
    item('image', '', 367, 140, 300, 348, { mediaId: 'mountain', fit: 'cover' }),
    item('emoji', '', 40, 520, 133, 147, { text: '🌿' }),
    item('clock', '', 193, 520, 147, 147),
    item('gif', '', 367, 520, 300, 147, { mediaId: 'wave', fit: 'cover' }),
    item('shortcut', '', 40, 698, 300, 209, { keys: 'Win+Shift+S' }),
    item('text', '便签', 367, 698, 300, 209, { text: '更新桌面相框' }),
    item('music', '', 693, 140, 258, 767)
  ];
  const instruments = [
    ['CPU', 'cpu.usage', '#39dbc6'], ['GPU', 'gpu.usage', '#afe64f'],
    ['内存', 'ram.used', '#ae9cff'], ['GPU 温度', 'gpu.temperature', '#ff9a57']
  ].map(([name, metric, color]) => ({ id: crypto.randomUUID(), type: 'metric', name, metric, color, size: 'small' }));
  return {
    revision: 0, shortcutsEnabled: true, widgetLibrary: [],
    pages: [
      { id: 'lyrics', kind: 'lyrics', name: '歌词', color: '#171923', widgets: [] },
      { id: crypto.randomUUID().replaceAll('-', ''), kind: 'custom', name: '桌面日常', color: '#181924', widgets: cards },
      { id: 'clock', kind: 'clock', name: '时钟', color: '#171923', widgets: [] },
      { id: 'photo', kind: 'photo', name: '相框', color: '#171923', widgets: [] },
      { id: 'hardware', kind: 'hardware', name: '硬件监控', color: '#151621', widgets: instruments }
    ]
  };
}

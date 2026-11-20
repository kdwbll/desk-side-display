'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const types = ['clipboard', 'window', 'notifications', 'actions'];
  const fields = $('widget-source-fields');
  const status = $('source-status');
  let feedKey;

  function fill(data) {
    const config = data.config;
    for (const type of types) $('source-' + type).checked = config[type];
    $('source-latitude').value = config.latitude ?? '';
    $('source-longitude').value = config.longitude ?? '';
    $('source-weather-place').value = config.weatherPlace ?? '';
    $('source-interfaces').value = JSON.stringify(config.interfaces ?? [], null, 2);
    $('source-apps').value = JSON.stringify(config.apps ?? {}, null, 2);
    feedKey = data.notificationKey;
    $('source-feed').hidden = !feedKey;
  }

  async function load() {
    try {
      const response = await fetch('/api/widget-sources', { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw Error('无法读取数据源设置。');
      fill(await response.json());
      fields.disabled = false;
    } catch (error) { status.textContent = error.message; }
  }

  $('source-save').addEventListener('click', async () => {
    fields.disabled = true;
    try {
      const coordinate = id => $(id).value === '' ? null : $(id).valueAsNumber;
      const config = Object.fromEntries(types.map(type => [type, $('source-' + type).checked]));
      config.latitude = coordinate('source-latitude');
      config.longitude = coordinate('source-longitude');
      config.weatherPlace = $('source-weather-place').value.trim() || null;
      config.interfaces = JSON.parse($('source-interfaces').value || '[]');
      config.apps = JSON.parse($('source-apps').value || '{}');
      fill(await send('/api/widget-sources', JSON.stringify(config)));
      status.textContent = '数据源已保存。';
    } catch (error) {
      status.textContent = error instanceof SyntaxError ? '接口或应用别名的 JSON 格式有误。' : error.message;
    } finally { fields.disabled = false; }
  });
  $('source-feed').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({
        url: location.origin + '/api/widget-notifications', method: 'POST',
        headers: { 'X-DeskSide-Feed': feedKey, 'Content-Type': 'application/json' },
        body: { title: '通知标题', body: '通知内容', app: '应用名称' }
      }, null, 2));
      status.textContent = '本机通知桥连接信息已复制。服务重启后请重新复制。';
    } catch { status.textContent = '无法复制通知桥连接信息。'; }
  });
  load();
})();

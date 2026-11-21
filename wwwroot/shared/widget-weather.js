'use strict';

window.deskWeather = (() => {
  const { node } = deskWidgets;
  const defaultTransparency = 30;

  function setTransparency(card, transparency) {
    card.style.setProperty('--weather-opacity', (100 - transparency) / 100);
  }

  function condition(code, day) {
    if (!Number.isFinite(code)) return ['idle', ''];
    if (code === 0) return ['clear', day ? '晴朗' : '晴夜'];
    if (code < 3) return ['partly', '晴间多云'];
    if (code === 3) return ['cloud', '阴天'];
    if (code === 45 || code === 48) return ['fog', '有雾'];
    if (code >= 95) return ['storm', '雷阵雨'];
    if ([71, 73, 75, 77, 85, 86].includes(code)) return ['snow', '下雪'];
    if (code >= 51 && code <= 82) return ['rain', code <= 57 ? '毛毛雨' : '降雨'];
    return ['cloud', '多云'];
  }

  function make(shape = 'card', transparency = defaultTransparency) {
    const card = node('div', 'widget-weather');
    card.dataset.shape = shape;
    setTransparency(card, transparency);
    const sky = node('div', 'weather-sky');
    sky.setAttribute('aria-hidden', 'true');
    const motif = node('div', 'weather-motif');
    const particles = node('div', 'weather-particles');
    for (let i = 0; i < 7; i++) {
      const particle = node('i');
      particle.style.setProperty('--i', i);
      particles.append(particle);
    }
    motif.append(node('span', 'weather-orb'), node('span', 'weather-cloud weather-cloud-back'),
      node('span', 'weather-cloud weather-cloud-front'), particles);
    sky.append(motif);
    const report = node('div', 'weather-report');
    const heading = node('div', 'weather-heading');
    const place = node('span', 'weather-place');
    const temp = node('span', 'weather-temperature');
    const status = node('span', 'weather-condition');
    const stats = node('div', 'weather-stats');
    const labels = ['体感', '湿度', '风速'];
    const values = labels.map(label => {
      const metric = node('span', 'weather-stat');
      const value = node('b');
      metric.append(node('span', '', label), value);
      stats.append(metric);
      return value;
    });
    const credit = node('a', 'weather-credit', 'Open-Meteo');
    credit.href = 'https://open-meteo.com/';
    credit.target = '_blank';
    credit.rel = 'noopener noreferrer';
    credit.setAttribute('aria-label', '天气数据来源 Open-Meteo');
    heading.append(place, status);
    report.append(heading, temp, stats);
    card.append(report, sky, credit);
    let signature;

    function update(data, format) {
      const samples = ['temperature', 'code', 'day', 'feels', 'humidity', 'wind', 'place', 'configured', 'stale']
        .map(key => data?.['weather.' + key]);
      const key = JSON.stringify(samples);
      if (signature === key) return;
      signature = key;
      const [temperature, code, day, feels, humidity, wind, location, configured, stale] = samples;
      const [pattern, name] = condition(code, day !== false);
      card.dataset.condition = pattern;
      card.dataset.night = String(day === false);
      let number;
      try { number = new Intl.NumberFormat(format.locale ?? 'zh-CN', { maximumFractionDigits: 0 }); }
      catch { number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }); }
      const printable = (value, unit) => Number.isFinite(value) ? number.format(value) + unit : '—';
      temp.textContent = printable(temperature, '°');
      place.textContent = location || '当地天气';
      if (name) status.textContent = stale ? name + ' · 上次数据' : name;
      else if (configured == null) status.textContent = '正在获取天气';
      else status.textContent = configured ? '暂时无法获取天气' : '在电脑上设置天气位置';
      stats.hidden = ![feels, humidity, wind].some(Number.isFinite);
      [feels, humidity, wind].forEach((number, i) => {
        values[i].textContent = printable(number, ['°', '%', ' km/h'][i]);
        values[i].parentElement.hidden = !Number.isFinite(number);
      });
    }

    return { element: card, update };
  }

  return { make, setTransparency, defaultTransparency };
})();

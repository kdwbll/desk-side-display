import { createDemo } from './demo-api.js';

const phone = document.getElementById('phone');
const panel = document.getElementById('panel');
const previous = document.getElementById('previous');
const next = document.getElementById('next');
const currentPage = document.getElementById('visible-page');
const action = document.getElementById('demo-action');
const tabs = [...document.querySelectorAll('[role=tab]')];
const tabPanel = document.getElementById('active-panel');
let selected = tabs[0];
let toastTimer;

function toast(message) {
  action.textContent = message;
  action.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { action.hidden = true; }, 2800);
}

function resizePanel() {
  const main = panel.contentDocument?.querySelector('main');
  if (main) panel.style.height = Math.ceil(main.getBoundingClientRect().height) + 2 + 'px';
}

function selectTab(tab) {
  selected = tab;
  for (const item of tabs) {
    item.setAttribute('aria-selected', String(item === selected));
    item.tabIndex = item === selected ? 0 : -1;
  }
  tabPanel.setAttribute('aria-labelledby', selected.id);
  const sections = panel.contentDocument?.querySelectorAll('main > section');
  for (const section of sections ?? []) section.hidden = section.getAttribute('aria-labelledby') !== selected.dataset.panel;
  resizePanel();
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const target = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length,
      Home: 0, End: tabs.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    selectTab(tabs[target]);
    tabs[target].focus();
  });
}

function slide(key) {
  const view = phone.contentWindow;
  if (!view) return;
  phone.contentDocument.dispatchEvent(new view.KeyboardEvent('keydown', { key }));
}

previous.addEventListener('click', () => slide('ArrowLeft'));
next.addEventListener('click', () => slide('ArrowRight'));

phone.addEventListener('load', () => {
  const screen = phone.contentDocument.querySelector('main');
  if (!screen) return;
  const status = () => {
    if (screen.dataset.pageLabel) currentPage.textContent = screen.dataset.pageLabel;
  };
  new MutationObserver(status).observe(screen, { attributeFilter: ['data-page-label'] });
  status();
  previous.disabled = next.disabled = false;
});

panel.addEventListener('load', () => {
  const main = panel.contentDocument.querySelector('main');
  if (!main) return;
  panel.contentDocument.getElementById('music-heading').textContent = '模拟播放';
  selectTab(selected);
  new ResizeObserver(resizePanel).observe(main);
});

try {
  window.deskSideDemo = await createDemo(toast);
  phone.src = 'display/index.html';
  panel.src = 'control/index.html';
} catch {
  toast('演示资源加载失败，请刷新页面重试。');
}

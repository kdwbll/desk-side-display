'use strict';

if (window.parent === window) {
  location.replace(new URL('../', location.href));
} else {
  const demoView = document.documentElement.dataset.demo;
  const demoFetch = window.fetch.bind(window);
  window.deskSideDemo = window.parent.deskSideDemo;
  window.fetch = (input, options) => {
    if (typeof input === 'string' && input.startsWith('/api/'))
      return window.deskSideDemo.request(input, options, demoView);
    if (typeof input === 'string' && input.startsWith('/shared/'))
      return demoFetch(new URL('..' + input, location.href), options);
    return demoFetch(input, options);
  };
}

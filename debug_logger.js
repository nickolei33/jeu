'use strict';
(() => {
  const d = document.getElementById('debug');
  if (!d) return;

  const params = new URLSearchParams(window.location.search);
  const enabled = params.get('debug') === '1' || window.localStorage.getItem('debugLog') === '1';
  if (!enabled) return;

  d.style.display = 'block';

  function log(msg) {
    d.innerText += "\n" + msg;
  }

  window.onerror = function (msg, url, line) {
    log("ERROR: " + msg + " (" + line + ")");
  };

  const oldLog = console.log;
  console.log = function () {
    oldLog.apply(console, arguments);
    log("LOG: " + Array.from(arguments).join(' '));
  };

  const oldErr = console.error;
  console.error = function () {
    oldErr.apply(console, arguments);
    log("ERR: " + Array.from(arguments).join(' '));
  };

  log("Logger initialized.");
})();

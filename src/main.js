// Entry point.
import { App } from './app/app.js';

const canvas = document.getElementById('view');
const ui = document.getElementById('ui');

function fail(msg) {
  ui.innerHTML = `<div class="overlay"><div class="box"><h2>Cannot start</h2><p>${msg}</p></div></div>`;
}

const gl = document.createElement('canvas').getContext('webgl2');
if (!gl) fail('WebGL2 is required. Please use a recent desktop Chrome, Edge or Firefox with hardware acceleration enabled.');
else {
  const boot = document.createElement('div');
  boot.className = 'overlay'; boot.id = 'boot';
  boot.innerHTML = '<div class="box"><h2>World Flight Simulator</h2><div class="note" id="boot-msg">Starting…</div><div class="progress"><div id="boot-bar"></div></div></div>';
  ui.append(boot);
  const app = new App(canvas, ui);
  app.init((msg, f) => { document.getElementById('boot-msg').textContent = msg; document.getElementById('boot-bar').style.width = `${f * 100}%`; })
    .then(() => boot.remove())
    .catch((e) => { console.error(e); fail(`Initialisation failed: ${e.message}`); });
}

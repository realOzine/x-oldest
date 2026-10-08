// Entry point of the UI bundle, injected at document_idle.
//
// The engine bundle has been running since document_start and has published its API on
// `window.__xoldest` (see engine/main.js). Without it there is nothing to show.
import { init } from './app.js';

const engine = window.__xoldest;
if (engine && !engine.uiStarted) {
  engine.uiStarted = true;
  init(engine);
}

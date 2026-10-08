// Entry point of the engine bundle, injected at document_start.
//
// The engine and the UI are two bundles because they must run at different times: the engine
// before X's scripts, the UI once the page is there. `window.__xoldest` is the one thing they
// share: the engine publishes its API on it, and the UI bundle picks it up (see ui/main.js).
import { openReader, resolveUser } from './api.js';
import { installObserver } from './transport.js';

if (!window.__xoldest) {
  installObserver();
  window.__xoldest = { resolveUser, openReader };
}

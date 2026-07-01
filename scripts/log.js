import { MODULE_ID } from "./presets.js";

const PREFIX = "ATDE |";

// Reads the client-scoped "debug" setting. Guarded so calls made before the
// setting is registered (or outside a game context) simply stay silent.
function debugEnabled() {
  try {
    return game.settings.get(MODULE_ID, "debug") === true;
  } catch (_) {
    return false;
  }
}

export function isDebug() {
  return debugEnabled();
}

// Verbose developer logging — silent unless the debug setting is on.
export function dlog(...args) {
  if (debugEnabled()) console.log(PREFIX, ...args);
}

export function dwarn(...args) {
  if (debugEnabled()) console.warn(PREFIX, ...args);
}

// Collapsed group with a stack trace, used for tracing third-party calls.
// No-ops entirely unless debug is on.
export function dtrace(label) {
  if (!debugEnabled()) return;
  console.groupCollapsed(`${PREFIX} ${label}`);
  console.trace("call stack");
  console.groupEnd();
}

// Genuine errors that should always surface, regardless of the debug setting.
export function elog(...args) {
  console.warn(PREFIX, ...args);
}

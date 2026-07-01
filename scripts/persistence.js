import { MODULE_ID } from "./presets.js";
import { createPoolDecalGraphic, createTrailDecalGraphic } from "./effects.js";
import { dlog } from "./log.js";

// Persistent blood decals.
//
// Live rendering during a session is already handled per-client by the runtime
// effects (each client's move/HP hooks draw their own pools and trails). This
// module's job is only to make those marks *survive a reload* and appear for
// clients that load the scene later.
//
// Records are stored on the active scene's flag. Each carries a seed so the
// exact blob shape is reproduced identically everywhere. We draw persisted
// decals ONLY on canvasReady (fresh load / late join) — never in reaction to
// new records mid-session, which would double up with the live runtime effect.

const FLAG = "decals";
const MAX_DECALS = 500; // safety cap to bound flag size

// decalId -> PIXI.Graphics currently drawn on the active scene
const DRAWN = new Map();

let _idCounter = 0;
function newId() {
  return `${Date.now().toString(36)}-${(_idCounter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function persistenceEnabled() {
  try { return game.settings.get(MODULE_ID, "persistDecals") === true; }
  catch (_) { return false; }
}

function currentScene() {
  return canvas?.scene ?? null;
}

function getRecords(scene = currentScene()) {
  if (!scene) return [];
  return scene.getFlag(MODULE_ID, FLAG) ?? [];
}

function isExpired(rec, now) {
  return rec.lifetimeMs != null && (now - rec.bornMs) > rec.lifetimeMs;
}

function undraw(id) {
  const g = DRAWN.get(id);
  if (g && !g.destroyed) {
    if (g.parent) g.parent.removeChild(g);
    g.destroy({ children: true });
  }
  DRAWN.delete(id);
}

// GM-only: append decal records to the active scene (batched into one write).
export async function addDecals(records, { bornMs, lifetimeMs, tokenId } = {}) {
  if (!records?.length) return;
  if (!game.user?.isGM) return;
  if (!persistenceEnabled()) return;

  const scene = currentScene();
  if (!scene) return;

  const now = bornMs ?? Date.now();
  const stamped = records.map(r => ({
    id: newId(),
    bornMs: now,
    lifetimeMs: lifetimeMs ?? null,
    ...(tokenId ? { tokenId } : {}),
    ...r
  }));

  let all = getRecords(scene).concat(stamped);
  if (all.length > MAX_DECALS) all = all.slice(all.length - MAX_DECALS);
  await scene.setFlag(MODULE_ID, FLAG, all);
}

// GM-only: drop the pool record for a token when it's revived.
export async function removePoolDecalForToken(tokenId) {
  if (!game.user?.isGM || !tokenId) return;
  const scene = currentScene();
  if (!scene) return;
  const all = getRecords(scene);
  const next = all.filter(r => !(r.kind === "pool" && r.tokenId === tokenId));
  if (next.length !== all.length) await scene.setFlag(MODULE_ID, FLAG, next);
}

// GM-only: remove all decals on the active scene.
export async function clearSceneDecals() {
  if (!game.user?.isGM) return;
  const scene = currentScene();
  if (!scene) return;
  await scene.unsetFlag(MODULE_ID, FLAG);
}

// Full (re)draw of all live records. Called on canvasReady — the tokens layer
// was just rebuilt so previously drawn graphics are already gone.
export function redrawAll() {
  DRAWN.clear();
  if (!canvas?.ready || !persistenceEnabled()) return;

  const now = Date.now();
  let drawn = 0;
  for (const rec of getRecords()) {
    if (isExpired(rec, now)) continue;
    const g = rec.kind === "pool" ? createPoolDecalGraphic(rec) : createTrailDecalGraphic(rec);
    if (g) { DRAWN.set(rec.id, g); drawn++; }
  }
  dlog(`persistence | redrawAll drew ${drawn} decal(s)`);
}

// React to flag changes from other clients: remove drawn decals whose records
// were deleted (e.g. clear-all or a revive). Never draws new records — live
// runtime effects already cover newly created decals for connected clients.
export function onRecordsChanged() {
  if (!canvas?.ready) return;
  const liveIds = new Set(getRecords().map(r => r.id));
  for (const id of [...DRAWN.keys()]) {
    if (!liveIds.has(id)) undraw(id);
  }
}

// Expire finite-lifetime decals without needing a reload; GM prunes the flag.
export function sweepExpired() {
  if (!canvas?.ready) return;
  const now = Date.now();
  const records = getRecords();
  const recById = new Map(records.map(r => [r.id, r]));

  for (const id of [...DRAWN.keys()]) {
    const rec = recById.get(id);
    if (!rec || isExpired(rec, now)) undraw(id);
  }

  if (game.user?.isGM) {
    const next = records.filter(r => !isExpired(r, now));
    if (next.length !== records.length) currentScene()?.setFlag(MODULE_ID, FLAG, next);
  }
}

let _sweepTimer = null;
export function startSweep() {
  if (_sweepTimer) return;
  _sweepTimer = setInterval(sweepExpired, 30_000);
}

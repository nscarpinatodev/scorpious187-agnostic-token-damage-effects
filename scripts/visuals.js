import { MODULE_ID, TMFX_FILTER_ID, tokenMagicAvailable } from "./presets.js";
import { dlog, dwarn, dtrace, elog, isDebug } from "./log.js";
import { makeColorMatrixFilter } from "./pixi-compat.js";

function hexToNumber(value) {
  if (typeof value !== "string") return 0x8b0000;
  return Number.parseInt(value.replace("#", ""), 16) || 0x8b0000;
}

export function computeState(hpValue, hpMax) {
  const ratioRaw = Math.clamp(hpValue / hpMax, 0, 1);
  const stepped = game.settings.get(MODULE_ID, "useSteppedSaturation");
  const ratio = stepped ? Math.floor(ratioRaw * 10) / 10 : ratioRaw;

  const bleedingThreshold = game.settings.get(MODULE_ID, "bleedingThreshold") / 100;
  const deadOpacity = game.settings.get(MODULE_ID, "deadOpacity");

  return {
    ratioRaw,
    ratio,
    saturation: ratio,
    alpha: hpValue <= 0 ? deadOpacity : 1,
    isDead: hpValue <= 0,
    isBleeding: hpValue > 0 && ratioRaw <= bleedingThreshold
  };
}

export async function applyAlpha(tokenDoc, alpha) {
  const current = Number(tokenDoc.alpha ?? 1);
  if (Math.abs(current - alpha) < 0.001) return;
  const canMod = tokenDoc.canUserModify(game.user, "update");
  dlog(`applyAlpha | token="${tokenDoc.name}" user="${game.user.name}" isGM=${game.user.isGM} canModify=${canMod} currentAlpha=${current} targetAlpha=${alpha}`);
  if (!canMod) return;
  await tokenDoc.update({ alpha }, { animate: false });
}

// Intercept all TMFX entry points once and stack-trace every call. Only wired
// up when debug logging is enabled — no interception overhead in normal play.
let _tmfxPatched = false;
export function patchTmfxLogging() {
  if (_tmfxPatched || !isDebug() || !globalThis.TokenMagic) return;
  _tmfxPatched = true;
  const TM = globalThis.TokenMagic;
  for (const method of ["addUpdateFilters", "addFilters", "deleteFilters", "updateFilters", "removeFilters"]) {
    const orig = TM[method];
    if (typeof orig !== "function") continue;
    TM[method] = async function(...args) {
      const target = args[0];
      const targetName = Array.isArray(target)
        ? target.map(t => t?.name ?? t?.document?.name ?? "(unknown)").join(", ")
        : (target?.name ?? target?.document?.name ?? "(unknown)");
      const user = game?.user?.name ?? "?";
      dtrace(`TMFX.${method}() | user="${user}" target="${targetName}"`);
      return orig.apply(this, args);
    };
  }
  dlog("TMFX methods patched for debug logging");
}

async function tryApply(target, params) {
  try {
    await globalThis.TokenMagic.addUpdateFilters(target, params);
    return true;
  } catch (err) {
    dwarn("tryApply caught error:", err);
    return false;
  }
}

async function tryDelete(target, filterId) {
  try {
    await globalThis.TokenMagic.deleteFilters(target, filterId);
    return true;
  } catch (err) {
    dwarn("tryDelete caught error:", err);
    return false;
  }
}

// Computes the { saturation, red, green, blue } colour factors for the current
// HP state, shared by the TMFX and native-fallback paths.
function computeColorFactors(state, tintColor, applyTint) {
  const satEnabled  = game.settings.get(MODULE_ID, "enableSaturation");
  const tintEnabled = game.settings.get(MODULE_ID, "enableDamageTint");

  let red = 1, green = 1, blue = 1;

  const grayscaleOnDeath = game.settings.get(MODULE_ID, "grayscaleOnDeath");
  const suppressTint = grayscaleOnDeath && state.isDead;

  if (applyTint && tintEnabled && !suppressTint) {
    const damage = 1 - state.ratioRaw;
    const color  = tintColor ?? hexToNumber(game.settings.get(MODULE_ID, "bloodColor"));

    const rRaw = ((color >> 16) & 0xff) / 255;
    const gRaw = ((color >> 8)  & 0xff) / 255;
    const bRaw = ( color        & 0xff) / 255;
    const maxC = Math.max(rRaw, gRaw, bRaw);

    if (maxC > 0) {
      const rN = rRaw / maxC;
      const gN = gRaw / maxC;
      const bN = bRaw / maxC;

      red   = 1 + (rN * 0.8 - (1 - rN) * 0.7) * damage;
      green = 1 + (gN * 0.8 - (1 - gN) * 0.7) * damage;
      blue  = 1 + (bN * 0.8 - (1 - bN) * 0.7) * damage;
    }
  }

  return { saturation: satEnabled ? state.saturation : 1, red, green, blue };
}

export async function applySaturation(token, state, tintColor = null, applyTint = true) {
  const satEnabled  = game.settings.get(MODULE_ID, "enableSaturation");
  const tintEnabled = game.settings.get(MODULE_ID, "enableDamageTint");

  if (!satEnabled && !tintEnabled) {
    await clearVisualFilter(token);
    return;
  }
  if (!token) return;

  const { saturation, red, green, blue } = computeColorFactors(state, tintColor, applyTint);

  // Prefer Token Magic FX when present — its filters replicate to every client.
  // Otherwise fall back to a per-client native ColorMatrixFilter (no perms, no
  // dependency). The two never coexist on a token.
  if (tokenMagicAvailable()) {
    clearNativeColor(token);

    // fxPlayerPermission ON  → TMFX broadcasts non-GM calls to the GM via socket
    // fxPlayerPermission OFF → TMFX setFlag is rejected for non-GM; GM's filter
    //   still replicates to this client, so skipping here is correct.
    const fxPlayerPerm = game.settings.get('tokenmagic', 'fxPlayerPermission') ?? false;
    const canCallTMFX  = game.user.isGM || fxPlayerPerm;
    dlog(`applySaturation | TMFX path token="${token?.document?.name}" canCallTMFX=${canCallTMFX}`);
    if (!canCallTMFX) return;

    const params = [{
      filterType: "adjustment",
      filterId: TMFX_FILTER_ID,
      saturation,
      red, green, blue
    }];

    const targets = [token, token.document, [token], [token.document]].filter(Boolean);
    let success = false;
    for (const target of targets) {
      success = (await tryApply(target, params)) || success;
      if (success) break;
    }
    if (!success) elog("Could not apply Token Magic desaturation filter", token);
  } else {
    dlog(`applySaturation | native fallback token="${token?.document?.name}"`);
    applyNativeColor(token, saturation, red, green, blue);
  }
}

export async function clearVisualFilter(token) {
  if (!token) return;
  clearNativeColor(token);

  if (!tokenMagicAvailable()) return;
  const fxPlayerPerm = game.settings.get('tokenmagic', 'fxPlayerPermission') ?? false;
  const canCallTMFX  = game.user.isGM || fxPlayerPerm;
  if (!canCallTMFX) return;
  const targets = [token, token.document, [token], [token.document]].filter(Boolean);
  for (const target of targets) {
    const ok = await tryDelete(target, TMFX_FILTER_ID);
    if (ok) break;
  }
}

// ---------------------------------------------------------------------------
// Native colour fallback (no Token Magic FX)
// ---------------------------------------------------------------------------
// Applies desaturation + blood tint directly to the token mesh via a
// ColorMatrixFilter. Purely client-side (no document writes), so it needs no
// special permissions and renders for every user independently.

function ensureColorFilter(token) {
  const mesh = token.mesh;
  if (!mesh) return null;
  if (!token._atdeColorFilter) token._atdeColorFilter = makeColorMatrixFilter();
  const f = token._atdeColorFilter;
  if (!mesh.filters) mesh.filters = [f];
  else if (!mesh.filters.includes(f)) mesh.filters.push(f);
  return f;
}

function applyNativeColor(token, saturation, red, green, blue) {
  const f = ensureColorFilter(token);
  if (!f) return;

  // Standard luminance-preserving saturation matrix, with each output row then
  // scaled by the per-channel tint factor (channelScale · saturationMatrix).
  const lr = 0.213, lg = 0.715, lb = 0.072;
  const s = saturation;
  const sr = (1 - s) * lr, sg = (1 - s) * lg, sb = (1 - s) * lb;

  f.matrix = [
    red   * (sr + s), red   * sg,       red   * sb,       0, 0,
    green * sr,       green * (sg + s), green * sb,       0, 0,
    blue  * sr,       blue  * sg,       blue  * (sb + s), 0, 0,
    0,                0,                0,                1, 0
  ];
}

export function clearNativeColor(token) {
  const f = token?._atdeColorFilter;
  if (!f) return;
  const mesh = token.mesh;
  if (mesh?.filters) {
    const i = mesh.filters.indexOf(f);
    if (i >= 0) mesh.filters.splice(i, 1);
    if (mesh.filters.length === 0) mesh.filters = null;
  }
  token._atdeColorFilter = null;
}

import { MODULE_ID, tokenMagicAvailable, getSelectedPreset } from "./presets.js";
import { registerSettings } from "./settings.js";
import { hpRelevantChange, getActorHp } from "./hp-resolver.js";
import { computeState, applyAlpha, applySaturation, clearVisualFilter, patchTmfxLogging } from "./visuals.js";
import { getBloodColorForActor } from "./creature-types.js";
import { TypeColorsConfig } from "./type-colors-config.js";
import {
  ensureBleedingOverlay,
  removeBleedingOverlay,
  ensureBloodPool,
  removeBloodPool,
  clearRuntimeEffects,
  maybeDropBloodTrail,
  dropPathTrail
} from "./effects.js";

const PRE_MOVE = new Map();

// True when a movement jumped the token to its destination (teleport / displace)
// instead of travelling there. Blood trails represent blood dripping along a
// path, so they must not be left for teleports. In Foundry V13 a teleport is
// flagged either on the update operation (options.teleport) or by the movement
// action's config (CONFIG.Token.movement.actions[<action>].teleport).
function isTeleportMovement(movement) {
  if (!movement) return false;
  const actions = CONFIG?.Token?.movement?.actions ?? {};
  const isTeleportWaypoint = wp => {
    if (!wp) return false;
    if (wp.teleport === true) return true;
    return actions[wp.action]?.teleport === true;
  };
  if (isTeleportWaypoint(movement.destination)) return true;
  return (movement.passed?.waypoints ?? []).some(isTeleportWaypoint);
}

Hooks.once("init", () => {
  console.log("Scorpious187's Agnostic Token Damage Effects loading");
  registerSettings(refreshAllVisibleTokens);
});

Hooks.once("ready", () => {
  if (!tokenMagicAvailable()) {
    ui.notifications?.warn("Scorpious187's Agnostic Token Damage Effects: Token Magic FX is not active — desaturation and tint effects will be disabled.");
    console.warn("Scorpious187's Agnostic Token Damage Effects | Token Magic FX is not active. Desaturation and tint effects disabled.");
  }
  patchTmfxLogging();
});

function injectSettingsUI(root) {
  // Foundry V13 names inputs "module-id.key"; V12 used data-setting-id attributes.
  // Try both, walking up to the nearest .form-group wrapper.
  const getEl = key => {
    return root.querySelector(`[name="${MODULE_ID}.${key}"]`)?.closest(".form-group")
        ?? root.querySelector(`[data-setting-id="${MODULE_ID}.${key}"]`)
        ?? null;
  };

  if (!getEl("hpPreset")) return; // Our settings aren't in this root

  const mkHeader = label => {
    const h = document.createElement("h3");
    h.className = "atde-settings-header";
    h.textContent = label;
    return h;
  };

  getEl("hpPreset")?.insertAdjacentElement("beforebegin", mkHeader("HP Detection"));
  getEl("enableSaturation")?.insertAdjacentElement("beforebegin", mkHeader("Token Coloration"));

  const bleedingEl = getEl("enableBleedingOverlay");
  if (bleedingEl) {
    bleedingEl.insertAdjacentElement("beforebegin", mkHeader("Blood Effects"));

    const btnRow = document.createElement("div");
    btnRow.className = "form-group atde-config-button-row";
    btnRow.innerHTML = `
      <label>Blood Colors by Creature Type</label>
      <div class="form-fields"><button type="button"><i class="fas fa-tint"></i> Configure</button></div>
      <p class="hint">Customize the global default blood color and per-type colors (undead, construct, elementals, and custom types).</p>`;
    btnRow.querySelector("button").addEventListener("click", () => new TypeColorsConfig().render(true));
    bleedingEl.previousElementSibling.insertAdjacentElement("beforebegin", btnRow);
    btnRow.insertAdjacentElement("beforebegin", mkHeader("Blood Colors"));
  }

  getEl("enableBloodPool")?.insertAdjacentElement("beforebegin", mkHeader("Death Blood Pool"));

  for (const key of ["bloodPoolLifetime", "bloodTrailLifetime"]) {
    const el = getEl(key);
    if (!el) continue;
    const range = el.querySelector("input[type=range]");
    if (!range) continue;
    // Foundry renders the range value in a sibling span/output; try several selectors
    const label = el.querySelector(".range-value")
               ?? el.querySelector("output")
               ?? [...el.querySelectorAll("span")].find(s => /^\d+$/.test(s.textContent.trim()));
    const update = () => {
      const isInfinite = Number(range.value) >= 1830;
      if (label) label.textContent = isInfinite ? "∞" : range.value;
      range.title = isInfinite ? "Infinite" : `${range.value}s`;
    };
    range.addEventListener("input", update);
    update();
  }
}

Hooks.on("renderSettingsConfig", (_app, html) => {
  // html may be an HTMLElement (V13) or a jQuery object (V12)
  const fromHtml = html instanceof HTMLElement ? html : html?.[0];

  // Try the passed element first; if our settings aren't in it, search the live document
  // (V13 may pass only a partial element depending on how tabs are rendered)
  const root = (fromHtml && fromHtml.querySelector(`[name="${MODULE_ID}.hpPreset"]`))
    ? fromHtml
    : document.querySelector("#client-settings, .settings-config") ?? document.body;

  injectSettingsUI(root);
});

Hooks.on("canvasReady", () => {
  refreshAllVisibleTokens();
});

Hooks.on("createToken", tokenDoc => {
  if (!canvas?.ready) return;
  queueTokenRefresh(tokenDoc);
});

Hooks.on("deleteToken", tokenDoc => {
  clearRuntimeEffects(tokenDoc.id);
  PRE_MOVE.delete(tokenDoc.id);
});

Hooks.on("preUpdateToken", (tokenDoc, change) => {
  const moved = Object.hasOwn(change, "x") || Object.hasOwn(change, "y");
  if (!moved) return;

  const token = tokenDoc.object;
  if (!token) return;

  PRE_MOVE.set(tokenDoc.id, { x: tokenDoc.x, y: tokenDoc.y });
});

Hooks.on("updateToken", async (tokenDoc, change, options) => {
  const moved = Object.hasOwn(change, "x") || Object.hasOwn(change, "y");
  if (!moved) return;

  // Teleports jump the token without travelling — leave no trail.
  if (options?.teleport) { PRE_MOVE.delete(tokenDoc.id); return; }

  const actor = tokenDoc.actor;
  if (!actor) { PRE_MOVE.delete(tokenDoc.id); return; }

  const hp = getActorHp(actor);
  if (!hp) { PRE_MOVE.delete(tokenDoc.id); return; }

  const state = computeState(hp.value, hp.max);
  if (!state.isBleeding || state.isDead) { PRE_MOVE.delete(tokenDoc.id); return; }

  const { color: colorOverride, suppressBlood } = getBloodColorForActor(actor, getSelectedPreset());
  if (suppressBlood) { PRE_MOVE.delete(tokenDoc.id); return; }

  const prev = PRE_MOVE.get(tokenDoc.id);
  PRE_MOVE.delete(tokenDoc.id);

  if (!prev) return;

  // Sparse marks at movement origin (existing system)
  maybeDropBloodTrail(tokenDoc, prev.x, prev.y, colorOverride);
});

// moveToken fires once per move after the update completes, with the full
// movement operation including origin, destination, and the waypoints traversed
// in that move (movement.passed).
Hooks.on("moveToken", async (tokenDoc, movement, operation) => {
  if (!game.settings.get(MODULE_ID, "enableBloodPathTrails")) return;
  if (!canvas?.ready) return;

  // Teleports jump the token without travelling — leave no trail.
  if (operation?.teleport || isTeleportMovement(movement)) return;

  const actor = tokenDoc.actor;
  if (!actor) return;

  const hp = getActorHp(actor);
  if (!hp) return;

  const state = computeState(hp.value, hp.max);
  if (!state.isBleeding || state.isDead) return;

  const { color: colorOverride, suppressBlood } = getBloodColorForActor(actor, getSelectedPreset());
  if (suppressBlood) return;

  // Build the waypoint list for THIS move only. movement.passed.waypoints is
  // the path traversed by the current move; movement.history.* is the token's
  // cumulative recorded path for the turn — re-drawing it on every move
  // re-marks already-marked segments and multiplies the trails.
  const origin      = movement?.origin;
  const destination = movement?.destination;
  if (!origin || !destination) return;

  const passedWaypoints = movement?.passed?.waypoints ?? [];
  const waypoints = passedWaypoints.length >= 2
    ? passedWaypoints.map(w => ({ x: w.x, y: w.y }))
    : [
        { x: origin.x, y: origin.y },
        { x: destination.x, y: destination.y }
      ];

  // Wait for the canvas movement animation to finish so marks appear after
  // the token reaches each waypoint/endpoint.
  const token = tokenDoc.object;
  if (token?.movementAnimationPromise) {
    await token.movementAnimationPromise;
  }

  dropPathTrail(tokenDoc, waypoints, colorOverride);
});

Hooks.on("updateActor", async (actor, change) => {
  if (!hpRelevantChange(change)) return;
  await refreshActorTokens(actor);
});

async function refreshActorTokens(actor) {
  if (!actor) return;
  const activeTokens = actor.getActiveTokens(true);
  for (const token of activeTokens) {
    await applyStateToToken(token.document);
  }
}

function refreshAllVisibleTokens() {
  if (!canvas?.ready) return;
  for (const token of canvas.tokens.placeables) {
    queueTokenRefresh(token.document);
  }
}

const tokenRefreshTimers = new Map();

function queueTokenRefresh(tokenDoc) {
  const tokenId = tokenDoc?.id;
  if (!tokenId) return;

  if (tokenRefreshTimers.has(tokenId)) {
    clearTimeout(tokenRefreshTimers.get(tokenId));
  }

  const timer = setTimeout(async () => {
    tokenRefreshTimers.delete(tokenId);
    await applyStateToToken(tokenDoc);
  }, 25);

  tokenRefreshTimers.set(tokenId, timer);
}

async function applyStateToToken(tokenDoc) {
  const token = tokenDoc?.object;
  const actor = tokenDoc?.actor;
  if (!token || !actor || token.destroyed) return;

  const hp = getActorHp(actor);
  if (!hp) {
    await clearVisualFilter(token);
    clearRuntimeEffects(tokenDoc.id);
    PRE_MOVE.delete(tokenDoc.id);
    if ((tokenDoc.alpha ?? 1) !== 1 && tokenDoc.canUserModify(game.user, "update")) {
      await tokenDoc.update({ alpha: 1 }, { animate: false });
    }
    return;
  }

  const state = computeState(hp.value, hp.max);
  const { color: colorOverride, suppressBlood } = getBloodColorForActor(actor, getSelectedPreset());

  await applyAlpha(tokenDoc, state.alpha);
  // suppressBlood = true for elementals: desaturate normally, skip the blood tint
  await applySaturation(token, state, colorOverride, !suppressBlood);

  if (suppressBlood) {
    removeBleedingOverlay(tokenDoc.id);
    removeBloodPool(token.id);
    return;
  }

  if (game.settings.get(MODULE_ID, "enableBleedingOverlay")) {
    if (state.isBleeding) ensureBleedingOverlay(token, colorOverride);
    else removeBleedingOverlay(tokenDoc.id);
  } else {
    removeBleedingOverlay(tokenDoc.id);
  }

  if (game.settings.get(MODULE_ID, "enableBloodPool")) {
    const wasDead = actor.getFlag(MODULE_ID, "wasDead") === true;

    if (state.isDead && !wasDead) {
      removeBleedingOverlay(tokenDoc.id);
      if (game.user.isGM) await actor.setFlag(MODULE_ID, "wasDead", true);
      ensureBloodPool(token, colorOverride);
    } else if (!state.isDead && wasDead) {
      if (game.user.isGM) await actor.setFlag(MODULE_ID, "wasDead", false);
      removeBloodPool(token.id);
    }
  } else {
    removeBloodPool(token.id);
    if (actor.getFlag(MODULE_ID, "wasDead") && game.user.isGM) {
      await actor.setFlag(MODULE_ID, "wasDead", false);
    }
  }
}

import { MODULE_ID, tokenMagicAvailable } from "./presets.js";
import { registerSettings } from "./settings.js";
import { hpRelevantChange, getActorHp } from "./hp-resolver.js";
import { computeState, applyAlpha, applySaturation, clearVisualFilter, patchTmfxLogging } from "./visuals.js";
import { resolveEffectConfig } from "./creature-types.js";
import { TypeColorsConfig } from "./type-colors-config.js";
import {
  ensureBleedingOverlay,
  removeBleedingOverlay,
  ensureBloodPool,
  removeBloodPool,
  clearRuntimeEffects,
  maybeDropBloodTrail,
  dropPathTrail,
  dropDamageSplatter,
  playHitFlash
} from "./effects.js";
import { dlog } from "./log.js";
import {
  addDecals,
  removePoolDecalForToken,
  clearSceneDecals,
  redrawAll,
  onRecordsChanged,
  startSweep
} from "./persistence.js";

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
  dlog("Scorpious187's Agnostic Token Damage Effects loading");
  registerSettings(refreshAllVisibleTokens);
});

Hooks.once("ready", () => {
  if (!tokenMagicAvailable()) {
    ui.notifications?.info(game.i18n.localize("ATDE.notify.noTmfx"));
    dlog("Token Magic FX not active — using native ColorMatrixFilter fallback.");
  }
  patchTmfxLogging();

  // Public API — e.g. game.modules.get(id).api.clearBlood() from a macro.
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { clearBlood: clearSceneDecals };
  startSweep();
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

  const L = key => game.i18n.localize(key);
  const mkHeader = key => {
    const h = document.createElement("h3");
    h.className = "atde-settings-header";
    h.textContent = L(key);
    return h;
  };

  getEl("hpPreset")?.insertAdjacentElement("beforebegin", mkHeader("ATDE.headers.hpDetection"));
  getEl("enableSaturation")?.insertAdjacentElement("beforebegin", mkHeader("ATDE.headers.tokenColoration"));
  getEl("flashOnDamage")?.insertAdjacentElement("beforebegin", mkHeader("ATDE.headers.hitFlash"));
  getEl("enableDamageSplatter")?.insertAdjacentElement("beforebegin", mkHeader("ATDE.headers.damageSplatter"));

  const bleedingEl = getEl("enableBleedingOverlay");
  if (bleedingEl) {
    bleedingEl.insertAdjacentElement("beforebegin", mkHeader("ATDE.headers.bloodEffects"));

    const btnRow = document.createElement("div");
    btnRow.className = "form-group atde-config-button-row";
    btnRow.innerHTML = `
      <label>${L("ATDE.bloodColors.buttonLabel")}</label>
      <div class="form-fields"><button type="button"><i class="fas fa-tint"></i> ${L("ATDE.bloodColors.configure")}</button></div>
      <p class="hint">${L("ATDE.bloodColors.buttonHint")}</p>`;
    btnRow.querySelector("button").addEventListener("click", () => new TypeColorsConfig().render(true));
    bleedingEl.previousElementSibling.insertAdjacentElement("beforebegin", btnRow);
    btnRow.insertAdjacentElement("beforebegin", mkHeader("ATDE.headers.bloodColors"));
  }

  getEl("enableBloodPool")?.insertAdjacentElement("beforebegin", mkHeader("ATDE.headers.deathBloodPool"));
  getEl("persistDecals")?.insertAdjacentElement("beforebegin", mkHeader("ATDE.headers.persistence"));

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

// GM-only Token HUD button to toggle all damage effects for a single token.
Hooks.on("renderTokenHUD", (hud, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const tokenDoc = hud?.object?.document;
  if (!root || !tokenDoc) return;

  const isOff = tokenDoc.getFlag(MODULE_ID, "effectsDisabled") === true;
  const tip = off => game.i18n.localize(off ? "ATDE.hud.effectsOff" : "ATDE.hud.effectsOn");

  const btn = document.createElement("div");
  btn.className = "control-icon atde-hud-toggle" + (isOff ? " active" : "");
  btn.dataset.tooltip = tip(isOff);
  btn.innerHTML = `<i class="fas fa-tint${isOff ? "-slash" : ""}"></i>`;
  btn.addEventListener("click", async () => {
    const nowOff = tokenDoc.getFlag(MODULE_ID, "effectsDisabled") === true;
    await tokenDoc.setFlag(MODULE_ID, "effectsDisabled", !nowOff);
    const off = !nowOff;
    btn.classList.toggle("active", off);
    btn.dataset.tooltip = tip(off);
    btn.querySelector("i").className = `fas fa-tint${off ? "-slash" : ""}`;
    queueTokenRefresh(tokenDoc);
  });

  const col = root.querySelector(".col.left") ?? root.querySelector(".col.right");
  col?.appendChild(btn);
});

// Inject per-token override controls into the Token Configuration sheet. The
// inputs are named `flags.<module>.<key>` so the sheet's native submit writes
// them straight to the token flags — no custom save handler needed.
Hooks.on("renderTokenConfig", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const doc = app.document ?? app.object ?? app.token;
  if (!root || !doc) return;
  if (root.querySelector(".atde-token-config")) return; // already injected

  const disabled = doc.getFlag(MODULE_ID, "effectsDisabled") === true;
  const colorOverride = doc.getFlag(MODULE_ID, "bloodColorOverride") ?? "";

  const L = key => game.i18n.localize(key);
  const fs = document.createElement("fieldset");
  fs.className = "atde-token-config";
  fs.innerHTML = `
    <legend>${L("ATDE.tokenConfig.legend")}</legend>
    <div class="form-group">
      <label>${L("ATDE.tokenConfig.disableLabel")}</label>
      <div class="form-fields">
        <input type="checkbox" name="flags.${MODULE_ID}.effectsDisabled" ${disabled ? "checked" : ""}>
      </div>
      <p class="hint">${L("ATDE.tokenConfig.disableHint")}</p>
    </div>
    <div class="form-group">
      <label>${L("ATDE.tokenConfig.colorLabel")}</label>
      <div class="form-fields">
        <input type="text" name="flags.${MODULE_ID}.bloodColorOverride" value="${colorOverride}" placeholder="${L("ATDE.tokenConfig.colorPlaceholder")}">
      </div>
      <p class="hint">${L("ATDE.tokenConfig.colorHint")}</p>
    </div>`;

  const form = root.tagName === "FORM" ? root : root.querySelector("form");
  const footer = form?.querySelector("footer, .sheet-footer");
  if (footer) footer.insertAdjacentElement("beforebegin", fs);
  else form?.appendChild(fs);

  app.setPosition?.({ height: "auto" });
});

// GM button in the Token scene-controls toolbar to wipe persisted blood on the
// current scene. Handles both the V13 object-keyed control layout and the
// legacy V12 array layout.
let _clearBloodPrompting = false;
async function promptClearBlood() {
  if (_clearBloodPrompting) return; // guard against double-invoke
  _clearBloodPrompting = true;
  try {
    const DV2 = foundry.applications?.api?.DialogV2;
    const ok = DV2?.confirm
      ? await DV2.confirm({
          window: { title: game.i18n.localize("ATDE.dialog.clearBlood") },
          content: `<p>${game.i18n.localize("ATDE.dialog.clearBloodTitle")}?</p>`
        })
      : true;
    if (ok) await clearSceneDecals();
  } finally {
    _clearBloodPrompting = false;
  }
}

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;

  const base = {
    name: "atde-clear-blood",
    title: game.i18n.localize("ATDE.dialog.clearBlood"),
    icon: "fas fa-tint-slash",
    button: true,
    visible: true
  };

  if (Array.isArray(controls)) {
    // V12: array of controls, each with a tools array; uses onClick.
    const tokenCtl = controls.find(c => c.name === "token" || c.name === "tokens");
    if (Array.isArray(tokenCtl?.tools)) tokenCtl.tools.push({ ...base, onClick: promptClearBlood });
  } else if (controls && typeof controls === "object") {
    // V13+: controls keyed by name, tools keyed by name; uses onChange.
    const tokenCtl = controls.tokens ?? controls.token;
    if (tokenCtl?.tools) {
      base.order = Object.keys(tokenCtl.tools).length;
      tokenCtl.tools[base.name] = { ...base, onChange: promptClearBlood };
    }
  }
});

Hooks.on("canvasReady", () => {
  refreshAllVisibleTokens();
  redrawAll();      // restore persisted blood decals for this scene
  startSweep();
});

// React to persisted-decal changes from any client (clear-all, revive, prune).
Hooks.on("updateScene", (scene, change) => {
  if (scene.id !== canvas?.scene?.id) return;
  if (foundry.utils.hasProperty(change, `flags.${MODULE_ID}`)) onRecordsChanged();
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
  // React to our own per-token flag changes (enable/disable, colour override)
  // so the token's visuals refresh on every client.
  if (foundry.utils.hasProperty(change, `flags.${MODULE_ID}`)) {
    queueTokenRefresh(tokenDoc);
  }

  const moved = Object.hasOwn(change, "x") || Object.hasOwn(change, "y");
  if (!moved) return;

  // Teleports jump the token without travelling — leave no trail.
  if (options?.teleport) { PRE_MOVE.delete(tokenDoc.id); return; }

  const actor = tokenDoc.actor;
  if (!actor) { PRE_MOVE.delete(tokenDoc.id); return; }

  const { disabled, color: colorOverride, suppressBlood } = resolveEffectConfig(tokenDoc);
  if (disabled) { PRE_MOVE.delete(tokenDoc.id); return; }

  const hp = getActorHp(actor);
  if (!hp) { PRE_MOVE.delete(tokenDoc.id); return; }

  const state = computeState(hp.value, hp.max);
  if (!state.isBleeding || state.isDead) { PRE_MOVE.delete(tokenDoc.id); return; }

  if (suppressBlood) { PRE_MOVE.delete(tokenDoc.id); return; }

  const prev = PRE_MOVE.get(tokenDoc.id);
  PRE_MOVE.delete(tokenDoc.id);

  if (!prev) return;

  // Sparse marks at movement origin (existing system)
  const rec = maybeDropBloodTrail(tokenDoc, prev.x, prev.y, colorOverride);
  if (rec) await addDecals([rec], { lifetimeMs: trailLifetimeMs(), tokenId: tokenDoc.id });
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

  const { disabled, color: colorOverride, suppressBlood } = resolveEffectConfig(tokenDoc);
  if (disabled) return;

  const hp = getActorHp(actor);
  if (!hp) return;

  const state = computeState(hp.value, hp.max);
  if (!state.isBleeding || state.isDead) return;

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

  const recs = dropPathTrail(tokenDoc, waypoints, colorOverride);
  if (recs?.length) await addDecals(recs, { lifetimeMs: trailLifetimeMs(), tokenId: tokenDoc.id });
});

// Cache of pre-update HP by actor id, so updateActor can tell damage from heal.
const PRE_HP = new Map();

Hooks.on("preUpdateActor", (actor, change) => {
  if (!hpRelevantChange(change)) return;
  const hp = getActorHp(actor); // actor still holds pre-update values here
  if (hp) PRE_HP.set(actor.id, hp.value);
});

Hooks.on("updateActor", async (actor, change) => {
  if (!hpRelevantChange(change)) return;
  const oldHp = PRE_HP.get(actor.id);
  PRE_HP.delete(actor.id);
  await refreshActorTokens(actor);
  maybeFlashActor(actor, oldHp);
  await maybeSplatterActor(actor, oldHp);
});

// Marking a token dead/defeated toggles a status ActiveEffect rather than
// updating HP, so updateActor never fires. Re-evaluate the actor's tokens when
// a status-bearing effect is added, removed, or toggled so the death pool can
// react to the "statusDefeated" trigger.
function refreshActorFromEffect(effect) {
  if (!effect?.statuses || effect.statuses.size === 0) return;
  const parent = effect.parent;
  const actor = parent instanceof Actor ? parent
              : (parent?.parent instanceof Actor ? parent.parent : null);
  if (actor) refreshActorTokens(actor);
}

Hooks.on("createActiveEffect", refreshActorFromEffect);
Hooks.on("deleteActiveEffect", refreshActorFromEffect);
Hooks.on("updateActiveEffect", refreshActorFromEffect);

// Pulse a red (damage) or green (heal) flash over the actor's tokens.
function maybeFlashActor(actor, oldHp) {
  if (oldHp == null) return;
  const hp = getActorHp(actor);
  if (!hp) return;
  const delta = hp.value - oldHp;
  if (delta === 0) return;

  if (delta < 0 && !game.settings.get(MODULE_ID, "flashOnDamage")) return;
  if (delta > 0 && !game.settings.get(MODULE_ID, "flashOnHeal")) return;

  const color = delta < 0 ? 0xff2222 : 0x22cc44;
  for (const token of actor.getActiveTokens(true)) {
    if (resolveEffectConfig(token.document).disabled) continue;
    playHitFlash(token, color);
  }
}

// Spray a radial burst of ground splatter, scaled to the damage taken.
async function maybeSplatterActor(actor, oldHp) {
  if (oldHp == null) return;
  if (!game.settings.get(MODULE_ID, "enableDamageSplatter")) return;

  const hp = getActorHp(actor);
  if (!hp) return;
  const damage = oldHp - hp.value;
  if (damage <= 0) return; // splatter on damage only

  const frac = hp.max > 0 ? damage / hp.max : 0;

  for (const token of actor.getActiveTokens(true)) {
    const cfg = resolveEffectConfig(token.document);
    if (cfg.disabled || cfg.suppressBlood) continue;
    const recs = dropDamageSplatter(token.document, frac, cfg.color);
    if (recs?.length) await addDecals(recs, { lifetimeMs: trailLifetimeMs(), tokenId: token.document.id });
  }
}

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

// Persisted-decal lifetimes (ms); null = infinite, matching the runtime timers.
function poolLifetimeMs() {
  const s = Number(game.settings.get(MODULE_ID, "bloodPoolLifetime") ?? 180);
  return s >= 1830 ? null : s * 1000;
}
function trailLifetimeMs() {
  const s = Number(game.settings.get(MODULE_ID, "bloodTrailLifetime") ?? 180);
  return s >= 1830 ? null : s * 1000;
}

// True when the actor carries a Dead/Defeated status marker.
function hasDeathStatus(actor) {
  const statuses = actor?.statuses;
  if (!statuses) return false;
  const defeatedId = CONFIG?.specialStatusEffects?.DEFEATED;
  return (defeatedId && statuses.has(defeatedId)) || statuses.has("dead") || statuses.has("defeated");
}

// Decides whether the death blood pool should appear, per the deathTrigger
// setting. In "statusDefeated" mode the Dead/Defeated status alone triggers it,
// regardless of HP; the other modes require the token to be at/below 0 HP.
function isDefeated(actor, state) {
  const mode = game.settings.get(MODULE_ID, "deathTrigger");
  if (mode === "statusDefeated") return hasDeathStatus(actor);
  if (!state.isDead) return false;
  if (mode === "npcOnly") return !actor.hasPlayerOwner;
  return true; // "zeroHp" (default) — original behaviour
}

async function applyStateToToken(tokenDoc) {
  const token = tokenDoc?.object;
  const actor = tokenDoc?.actor;
  if (!token || !actor || token.destroyed) return;

  const { disabled, color: colorOverride, suppressBlood, deathStyle } = resolveEffectConfig(tokenDoc);

  // Effects disabled for this token/actor — strip everything back to default.
  if (disabled) {
    await clearVisualFilter(token);
    clearRuntimeEffects(tokenDoc.id);
    PRE_MOVE.delete(tokenDoc.id);
    if ((tokenDoc.alpha ?? 1) !== 1 && tokenDoc.canUserModify(game.user, "update")) {
      await tokenDoc.update({ alpha: 1 }, { animate: false });
    }
    return;
  }

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
  const defeated = isDefeated(actor, state);

  // A token marked dead by status gets the complete "dead" look — full
  // desaturation, dead opacity, no bleeding — even above 0 HP, matching a token
  // that actually hit 0 HP. (The blood pool itself still follows deathTrigger.)
  if (!state.isDead && hasDeathStatus(actor)) {
    Object.assign(state, {
      ratio: 0,
      ratioRaw: 0,
      saturation: 0,
      isDead: true,
      isBleeding: false,
      alpha: game.settings.get(MODULE_ID, "deadOpacity")
    });
  }

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

    if (defeated && !wasDead) {
      removeBleedingOverlay(tokenDoc.id);
      if (game.user.isGM) await actor.setFlag(MODULE_ID, "wasDead", true);
      const desc = ensureBloodPool(token, colorOverride, deathStyle);
      if (desc) await addDecals([{ kind: "pool", ...desc }], { lifetimeMs: poolLifetimeMs(), tokenId: token.id });
    } else if (!defeated && wasDead) {
      if (game.user.isGM) await actor.setFlag(MODULE_ID, "wasDead", false);
      removeBloodPool(token.id);
      await removePoolDecalForToken(token.id);
    }
  } else {
    removeBloodPool(token.id);
    if (actor.getFlag(MODULE_ID, "wasDead") && game.user.isGM) {
      await actor.setFlag(MODULE_ID, "wasDead", false);
    }
  }
}

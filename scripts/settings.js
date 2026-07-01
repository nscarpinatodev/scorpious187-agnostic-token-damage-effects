import { MODULE_ID, HP_PRESETS } from "./presets.js";

export function registerSettings(refreshAllVisibleTokens) {
  // ── Debug ─────────────────────────────────────────────────────────────────
  game.settings.register(MODULE_ID, "debug", {
    name: "ATDE.settings.debug.name",
    hint: "ATDE.settings.debug.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  // ── HP Detection ─────────────────────────────────────────────────────────
  game.settings.register(MODULE_ID, "hpPreset", {
    name: "ATDE.settings.hpPreset.name",
    hint: "ATDE.settings.hpPreset.hint",
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(Object.entries(HP_PRESETS).map(([k, v]) => [k, v.label])),
    default: "dnd5e",
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "customHpCurrentPath", {
    name: "ATDE.settings.customHpCurrentPath.name",
    hint: "ATDE.settings.customHpCurrentPath.hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "customHpMaxPath", {
    name: "ATDE.settings.customHpMaxPath.name",
    hint: "ATDE.settings.customHpMaxPath.hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "customCreatureTypePath", {
    name: "ATDE.settings.customCreatureTypePath.name",
    hint: "ATDE.settings.customCreatureTypePath.hint",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  // ── Token Coloration ──────────────────────────────────────────────────────
  game.settings.register(MODULE_ID, "enableSaturation", {
    name: "ATDE.settings.enableSaturation.name",
    hint: "ATDE.settings.enableSaturation.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "enableDamageTint", {
    name: "ATDE.settings.enableDamageTint.name",
    hint: "ATDE.settings.enableDamageTint.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "grayscaleOnDeath", {
    name: "ATDE.settings.grayscaleOnDeath.name",
    hint: "ATDE.settings.grayscaleOnDeath.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "useSteppedSaturation", {
    name: "ATDE.settings.useSteppedSaturation.name",
    hint: "ATDE.settings.useSteppedSaturation.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "deadOpacity", {
    name: "ATDE.settings.deadOpacity.name",
    hint: "ATDE.settings.deadOpacity.hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0,
    onChange: () => refreshAllVisibleTokens()
  });

  // ── Hit Flash ─────────────────────────────────────────────────────────────
  game.settings.register(MODULE_ID, "flashOnDamage", {
    name: "ATDE.settings.flashOnDamage.name",
    hint: "ATDE.settings.flashOnDamage.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "flashOnHeal", {
    name: "ATDE.settings.flashOnHeal.name",
    hint: "ATDE.settings.flashOnHeal.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // ── Blood Effects ─────────────────────────────────────────────────────────
  // (Blood Colors configure button is injected here by the renderSettingsConfig hook)

  game.settings.register(MODULE_ID, "enableBleedingOverlay", {
    name: "ATDE.settings.enableBleedingOverlay.name",
    hint: "ATDE.settings.enableBleedingOverlay.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "bleedingThreshold", {
    name: "ATDE.settings.bleedingThreshold.name",
    hint: "ATDE.settings.bleedingThreshold.hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 1, max: 100, step: 1 },
    default: 50,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "bleedingDropCount", {
    name: "ATDE.settings.bleedingDropCount.name",
    hint: "ATDE.settings.bleedingDropCount.hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 2, max: 24, step: 1 },
    default: 12,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "enableBloodTrails", {
    name: "ATDE.settings.enableBloodTrails.name",
    hint: "ATDE.settings.enableBloodTrails.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "enableBloodPathTrails", {
    name: "ATDE.settings.enableBloodPathTrails.name",
    hint: "ATDE.settings.enableBloodPathTrails.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "bloodTrailSpacing", {
    name: "ATDE.settings.bloodTrailSpacing.name",
    hint: "ATDE.settings.bloodTrailSpacing.hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 5, max: 200, step: 5 },
    default: 35
  });

  game.settings.register(MODULE_ID, "bloodTrailLifetime", {
    name: "ATDE.settings.bloodTrailLifetime.name",
    hint: "ATDE.settings.bloodTrailLifetime.hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 30, max: 1830, step: 30 },
    default: 180
  });

  // ── Death Blood Pool ──────────────────────────────────────────────────────
  game.settings.register(MODULE_ID, "enableBloodPool", {
    name: "ATDE.settings.enableBloodPool.name",
    hint: "ATDE.settings.enableBloodPool.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "deathTrigger", {
    name: "ATDE.settings.deathTrigger.name",
    hint: "ATDE.settings.deathTrigger.hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      zeroHp: "ATDE.settings.deathTrigger.choices.zeroHp",
      npcOnly: "ATDE.settings.deathTrigger.choices.npcOnly",
      statusDefeated: "ATDE.settings.deathTrigger.choices.statusDefeated"
    },
    default: "zeroHp",
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "bloodPoolLifetime", {
    name: "ATDE.settings.bloodPoolLifetime.name",
    hint: "ATDE.settings.bloodPoolLifetime.hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 30, max: 1830, step: 30 },
    default: 180
  });

  // ── Persistence ───────────────────────────────────────────────────────────
  game.settings.register(MODULE_ID, "persistDecals", {
    name: "ATDE.settings.persistDecals.name",
    hint: "ATDE.settings.persistDecals.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  // ── Hidden / internal ─────────────────────────────────────────────────────
  game.settings.register(MODULE_ID, "bloodColor", {
    scope: "world",
    config: false,
    type: String,
    default: "#8b0000",
    onChange: () => refreshAllVisibleTokens()
  });

  game.settings.register(MODULE_ID, "creatureTypeColors", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, "creatureTypeDeathStyles", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, "customCreatureTypes", {
    scope: "world",
    config: false,
    type: Object,
    default: []
  });
}

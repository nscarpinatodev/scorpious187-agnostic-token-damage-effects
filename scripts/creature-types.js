import { MODULE_ID, getSelectedPreset } from "./presets.js";

// ---------------------------------------------------------------------------
// Creature type taxonomy
// ---------------------------------------------------------------------------
// deathStyle selects the death-decal look in effects.js (blood/dust/oil/sap/ooze).

export const CREATURE_TYPES = {
  humanoid:   { label: "Humanoid",       defaultColor: null,      suppress: false, deathStyle: "blood" },
  undead:     { label: "Undead",          defaultColor: "#808080", suppress: false, deathStyle: "dust"  },
  beast:      { label: "Beast / Animal",  defaultColor: null,      suppress: false, deathStyle: "blood" },
  construct:  { label: "Construct",       defaultColor: "#5a3010", suppress: false, deathStyle: "oil"   },
  aberration: { label: "Aberration",      defaultColor: "#4b0082", suppress: false, deathStyle: "blood" },
  plant:      { label: "Plant",           defaultColor: "#1a5c1a", suppress: false, deathStyle: "sap"   },
  ooze:       { label: "Ooze",            defaultColor: "#4aaa00", suppress: false, deathStyle: "ooze"  },
  celestial:  { label: "Celestial / Fey", defaultColor: "#c8a000", suppress: false, deathStyle: "blood" },
  fiend:      { label: "Fiend",           defaultColor: "#6b1a00", suppress: false, deathStyle: "blood" },
  dragon:     { label: "Dragon",          defaultColor: "#7a0000", suppress: false, deathStyle: "blood" },
  elemental:  { label: "Elemental",       defaultColor: null,      suppress: true,  deathStyle: "blood" },
};

// Selectable death-decal styles (key → display label), for the config dialog.
export const DEATH_STYLES = {
  blood: "Blood",
  dust:  "Dust",
  oil:   "Oil",
  sap:   "Sap",
  ooze:  "Ooze"
};

// Raw system type strings → taxonomy keys
const RAW_TO_KEY = {
  humanoid: "humanoid", giant: "humanoid",
  undead: "undead",
  beast: "beast", monstrosity: "beast", animal: "beast",
  "magical beast": "beast", vermin: "beast",
  construct: "construct", robot: "construct", clockwork: "construct", vehicle: "construct",
  aberration: "aberration",
  plant: "plant",
  ooze: "ooze", slime: "ooze",
  celestial: "celestial", fey: "celestial", "spirit": "celestial",
  fiend: "fiend", demon: "fiend", devil: "fiend", outsider: "fiend",
  dragon: "dragon",
  elemental: "elemental",
};

// Priority order for trait arrays — elemental first so suppression wins
const TRAIT_PRIORITY = [
  "elemental", "undead", "construct", "vehicle", "plant", "ooze",
  "aberration", "fiend", "celestial", "dragon",
  "beast", "fey", "monstrosity", "animal", "vermin", "magical beast",
  "giant", "humanoid",
];

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

export function normalizeType(raw) {
  if (!raw || typeof raw !== "string") return null;
  const lower = raw.toLowerCase().trim();
  // Exact match first
  if (lower in RAW_TO_KEY) return RAW_TO_KEY[lower];
  // Partial match — handles "Fiend (Demon)", "Humanoid (Elf)", "Dragon (Chromatic)", etc.
  for (const [key, typeKey] of Object.entries(RAW_TO_KEY)) {
    if (lower.includes(key)) return typeKey;
  }
  return null;
}

function normalizeTraitArray(traits) {
  if (!Array.isArray(traits)) return null;
  const lower = traits.map(t => (typeof t === "string" ? t.toLowerCase() : ""));
  for (const raw of TRAIT_PRIORITY) {
    // Exact element match first, then substring match for parenthetical variants
    if (lower.includes(raw) || lower.some(t => t.includes(raw))) return RAW_TO_KEY[raw] ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves an actor + preset to a { key, suppress } result.
 * preset.typeResolver(actor) returns a raw string or array of trait strings.
 */
export function resolveCreatureType(actor, preset) {
  if (!actor || !preset?.typeResolver) return { key: null, suppress: false };
  const raw = preset.typeResolver(actor);
  const key = Array.isArray(raw) ? normalizeTraitArray(raw) : normalizeType(raw);
  if (!key) return { key: null, suppress: false };
  return { key, suppress: CREATURE_TYPES[key]?.suppress ?? false };
}

function hexToNumber(value) {
  if (typeof value !== "string") return 0x8b0000;
  return Number.parseInt(value.replace("#", ""), 16) || 0x8b0000;
}

/**
 * Matches an actor against the user-defined custom creature types. Each custom
 * type has a data path and a comma-separated list of match values; a substring
 * match against the value(s) at that path (string or array) wins. Custom types
 * are checked before the built-in taxonomy. Returns { color } or null.
 */
function resolveCustomType(actor) {
  const customTypes = game.settings.get(MODULE_ID, "customCreatureTypes") ?? [];
  if (!customTypes.length) return null;

  for (const ct of customTypes) {
    if (!ct?.matchPath || !ct?.matchValues) continue;

    const raw = foundry.utils.getProperty(actor, ct.matchPath);
    if (raw == null) continue;

    const tokens = String(ct.matchValues)
      .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!tokens.length) continue;

    const values = Array.isArray(raw) ? raw : [raw];
    const hay = values
      .filter(v => typeof v === "string" || typeof v === "number")
      .map(v => String(v).toLowerCase());

    if (hay.some(h => tokens.some(t => h.includes(t)))) {
      return { color: hexToNumber(ct.color ?? "#8b0000") };
    }
  }
  return null;
}

/**
 * Single source of truth for how a token should be treated, combining per-token
 * and per-actor override flags with creature-type resolution.
 *
 * Returns { disabled, color, suppressBlood, deathStyle }:
 *  - disabled: token OR actor flag `effectsDisabled` — skip all effects.
 *  - color: number|null — resolved blood colour (null = use global setting).
 *  - suppressBlood: true → desaturate but draw no blood (e.g. elementals).
 *  - deathStyle: death-decal style key for the death pool.
 *
 * Colour precedence: token flag → actor flag → creature-type → global.
 * An explicit colour override also cancels blood suppression.
 */
export function resolveEffectConfig(tokenDoc) {
  const actor = tokenDoc?.actor ?? null;
  const preset = getSelectedPreset();

  const tokenDisabled = tokenDoc?.getFlag?.(MODULE_ID, "effectsDisabled") === true;
  const actorDisabled = actor?.getFlag?.(MODULE_ID, "effectsDisabled") === true;
  const disabled = tokenDisabled || actorDisabled;

  const tokenColor = tokenDoc?.getFlag?.(MODULE_ID, "bloodColorOverride");
  const actorColor = actor?.getFlag?.(MODULE_ID, "bloodColorOverride");
  const overrideHex = (typeof tokenColor === "string" && tokenColor) ? tokenColor
                    : (typeof actorColor === "string" && actorColor) ? actorColor
                    : null;

  // Custom types are matched before the built-in taxonomy.
  const custom = actor ? resolveCustomType(actor) : null;

  const { key, suppress } = actor ? resolveCreatureType(actor, preset) : { key: null, suppress: false };
  const styleOverrides = game.settings.get(MODULE_ID, "creatureTypeDeathStyles") ?? {};
  const deathStyle = (key && (styleOverrides[key] || CREATURE_TYPES[key]?.deathStyle)) || "blood";

  let color = null;
  let suppressBlood = suppress;

  if (overrideHex) {
    color = hexToNumber(overrideHex);
    suppressBlood = false; // explicit override wins over suppression
  } else if (custom) {
    color = custom.color;   // custom rule wins over built-in type (incl. suppression)
    suppressBlood = false;
  } else if (!suppress && key) {
    const saved = game.settings.get(MODULE_ID, "creatureTypeColors") ?? {};
    const storedHex = saved[key];
    if (storedHex) color = hexToNumber(storedHex);
    else {
      const defaultHex = CREATURE_TYPES[key]?.defaultColor;
      if (defaultHex) color = hexToNumber(defaultHex);
    }
  }

  return { disabled, color, suppressBlood, deathStyle };
}

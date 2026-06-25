export const MODULE_ID = "scorpious187-agnostic-token-damage-effects";
export const TMFX_FILTER_ID = "scorpious187-agnostic-token-damage-effects-desat";

function resolveByPaths(actor, currentPath, maxPath) {
  if (!actor || !currentPath || !maxPath) return null;

  const value = Number(foundry.utils.getProperty(actor, currentPath));
  const max = Number(foundry.utils.getProperty(actor, maxPath));

  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return null;
  return { value, max };
}

export const HP_PRESETS = {
  dnd4e: {
    label: "D&D 4e",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max"],
    resolver: actor => resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max"),
    typeResolver: actor =>
      foundry.utils.getProperty(actor, "system.details.type.value") ??
      foundry.utils.getProperty(actor, "system.details.type") ?? null
  },
  dnd5e: {
    label: "D&D 5e",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max"],
    resolver: actor => resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max"),
    typeResolver: actor => foundry.utils.getProperty(actor, "system.details.type.value") ?? null
  },
  pf1e: {
    label: "Pathfinder 1e",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max"],
    resolver: actor => resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max"),
    typeResolver: actor => foundry.utils.getProperty(actor, "system.attributes.creatureType") ?? null
  },
  pf2e: {
    label: "Pathfinder 2e",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max"],
    resolver: actor => resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max"),
    // Returns an array of trait strings; creature-types.js handles priority resolution
    typeResolver: actor => foundry.utils.getProperty(actor, "system.traits.value") ?? null
  },
  sf2e: {
    label: "Starfinder 2e",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max"],
    resolver: actor => resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max"),
    typeResolver: actor => foundry.utils.getProperty(actor, "system.traits.value") ?? null
  },
  deltagreen: {
    label: "Delta Green",
    changedPaths: [
      "system.health.hp.value",
      "system.health.hp.max",
      "system.statistics.health.value",
      "system.statistics.health.max"
    ],
    resolver: actor =>
      resolveByPaths(actor, "system.health.hp.value", "system.health.hp.max") ??
      resolveByPaths(actor, "system.statistics.health.value", "system.statistics.health.max"),
    typeResolver: _actor => null  // Delta Green is human-focused; no creature type field
  },
  dcc: {
    label: "Dungeon Crawl Classics",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max", "system.attributes.hp"],
    resolver: actor => {
      const nested = resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max");
      if (nested) return nested;
      const hp = foundry.utils.getProperty(actor, "system.attributes.hp");
      if (hp && Number.isFinite(Number(hp.value)) && Number.isFinite(Number(hp.max))) {
        return { value: Number(hp.value), max: Number(hp.max) };
      }
      return null;
    },
    typeResolver: _actor => null  // DCC type field location unverified; falls back to global
  },
  shadowdark: {
    label: "Shadowdark",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max", "system.hp.value", "system.hp.max"],
    resolver: actor =>
      resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max") ??
      resolveByPaths(actor, "system.hp.value", "system.hp.max"),
    typeResolver: _actor => null  // Shadowdark type field location unverified; falls back to global
  },
  blackflag: {
    label: "Tales of the Valiant / Black Flag",
    changedPaths: ["system.attributes.hp.value", "system.attributes.hp.max"],
    resolver: actor => resolveByPaths(actor, "system.attributes.hp.value", "system.attributes.hp.max"),
    typeResolver: actor => foundry.utils.getProperty(actor, "system.details.type.value") ?? null
  },
  fallout: {
    label: "Fallout TTRPG",
    changedPaths: ["system.health.value", "system.health.max"],
    resolver: actor => resolveByPaths(actor, "system.health.value", "system.health.max"),
    typeResolver: actor => {
      // Actor type "robot" is always a construct
      if (actor.type === "robot") return "construct";

      const origin = foundry.utils.getProperty(actor, "system.origin");
      if (origin && typeof origin === "string") {
        const o = origin.toLowerCase();
        if (o.includes("robot") || o.includes("synth") || o.includes("android")) return "construct";
        if (o.includes("alien"))                                                   return "aberration";
        if (o.includes("ghoul"))                                                   return "undead";
        if (o.includes("mammal") || o.includes("animal") || o.includes("insect")) return "beast";
        if (o.includes("plant"))                                                   return "plant";
        // "Mutated Human", "Human", "Vault Dweller", "Super Mutant" etc. → humanoid
      }
      return "humanoid";
    }
  },
  custom: {
    label: "Custom",
    changedPaths: [],
    resolver: actor => {
      const current = game.settings.get(MODULE_ID, "customHpCurrentPath")?.trim();
      const max = game.settings.get(MODULE_ID, "customHpMaxPath")?.trim();
      if (!current || !max) return null;
      return resolveByPaths(actor, current, max);
    },
    typeResolver: actor => {
      const path = game.settings.get(MODULE_ID, "customCreatureTypePath")?.trim();
      if (!path) return null;
      return foundry.utils.getProperty(actor, path) ?? null;
    }
  }
};

export function getSelectedPreset() {
  const presetKey = game.settings.get(MODULE_ID, "hpPreset");
  return HP_PRESETS[presetKey] ?? HP_PRESETS.custom;
}

export function tokenMagicAvailable() {
  return game.modules.get("tokenmagic")?.active && typeof globalThis.TokenMagic !== "undefined";
}

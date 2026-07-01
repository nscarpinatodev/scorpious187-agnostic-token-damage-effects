import { MODULE_ID } from "./presets.js";
import { CREATURE_TYPES, DEATH_STYLES } from "./creature-types.js";
import { clearSceneDecals } from "./persistence.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TypeColorsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "atde-type-colors",
    tag: "form",
    form: {
      handler: TypeColorsConfig.#onSubmit,
      closeOnSubmit: true,
    },
    window: {
      title: "ATDE.dialog.title",
      icon: "fas fa-tint",
    },
    position: {
      width: 520,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/type-colors-config.html`,
    },
  };

  async _prepareContext(_options) {
    const saved        = game.settings.get(MODULE_ID, "creatureTypeColors") ?? {};
    const savedStyles  = game.settings.get(MODULE_ID, "creatureTypeDeathStyles") ?? {};
    const customTypes  = game.settings.get(MODULE_ID, "customCreatureTypes") ?? [];
    return {
      defaultBloodColor: game.settings.get(MODULE_ID, "bloodColor") ?? "#8b0000",
      types: Object.entries(CREATURE_TYPES).map(([key, cfg]) => {
        const current = savedStyles[key] || cfg.deathStyle || "blood";
        return {
          key,
          label:        cfg.label,
          suppress:     cfg.suppress,
          color:        saved[key] ?? cfg.defaultColor ?? "#8b0000",
          defaultColor: cfg.defaultColor ?? "#8b0000",
          styleOptions: Object.entries(DEATH_STYLES).map(([value, sLabel]) => ({
            value, label: sLabel, selected: value === current
          })),
        };
      }),
      customTypes: customTypes.map(ct => ({
        label:       ct.label       ?? "",
        color:       ct.color       ?? "#8b0000",
        matchPath:   ct.matchPath   ?? "",
        matchValues: ct.matchValues ?? "",
      })),
    };
  }

  _onRender(_context, _options) {
    // Reset individual built-in type colors
    for (const btn of this.element.querySelectorAll(".reset-type-color")) {
      btn.addEventListener("click", ev => {
        const input = this.element.querySelector(`input[name="color_${ev.currentTarget.dataset.key}"]`);
        if (input) input.value = ev.currentTarget.dataset.default || "#8b0000";
      });
    }

    // Reset default blood color
    this.element.querySelector(".reset-default-color")?.addEventListener("click", ev => {
      const input = this.element.querySelector(`input[name="defaultBloodColor"]`);
      if (input) input.value = ev.currentTarget.dataset.default ?? "#8b0000";
    });

    // Clear all persisted blood on the current scene (GM only)
    this.element.querySelector(".atde-clear-blood")?.addEventListener("click", async () => {
      await clearSceneDecals();
      ui.notifications?.info(game.i18n.localize("ATDE.notify.clearedBlood"));
    });

    // Reset all built-in colors (does not touch default or custom types)
    this.element.querySelector(".reset-all-colors")?.addEventListener("click", () => {
      for (const [key, cfg] of Object.entries(CREATURE_TYPES)) {
        if (cfg.suppress) continue;
        const input = this.element.querySelector(`input[name="color_${key}"]`);
        if (input) input.value = cfg.defaultColor ?? "#8b0000";
      }
    });

    // Custom type rows
    let nextIdx = this.element.querySelectorAll(".atde-custom-row").length;

    const bindDeleteButtons = () => {
      for (const btn of this.element.querySelectorAll(".delete-custom-type")) {
        btn.onclick = () => btn.closest(".atde-custom-row").remove();
      }
    };
    bindDeleteButtons();

    this.element.querySelector(".add-custom-type")?.addEventListener("click", () => {
      const idx = nextIdx++;
      const row = document.createElement("div");
      row.className = "atde-custom-row";
      row.innerHTML = `
        <div class="atde-custom-row-top">
          <input type="text" name="custom_label_${idx}" placeholder="Name">
          <input type="color" name="custom_color_${idx}" value="#8b0000">
          <button type="button" class="delete-custom-type" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </div>
        <div class="atde-custom-row-paths">
          <input type="text" name="custom_matchPath_${idx}" placeholder="Data path (e.g. system.traits.value)">
          <input type="text" name="custom_matchValues_${idx}" placeholder="Match values, comma-separated">
        </div>`;
      this.element.querySelector(".atde-custom-types").appendChild(row);
      bindDeleteButtons();
    });
  }

  static async #onSubmit(_event, _form, formData) {
    const data = formData.object;

    // Global default blood color
    if (data.defaultBloodColor) {
      await game.settings.set(MODULE_ID, "bloodColor", data.defaultBloodColor);
    }

    // Per-type colors + death styles
    const colors = {};
    const styles = {};
    for (const [key, cfg] of Object.entries(CREATURE_TYPES)) {
      if (cfg.suppress) continue;
      const val = data[`color_${key}`];
      if (val) colors[key] = val;
      const style = data[`deathstyle_${key}`];
      if (style && style !== cfg.deathStyle) styles[key] = style;
    }
    await game.settings.set(MODULE_ID, "creatureTypeColors", colors);
    await game.settings.set(MODULE_ID, "creatureTypeDeathStyles", styles);

    // Custom types — collect all indexed rows regardless of gaps from deletions
    const customTypes = [];
    for (const [key, val] of Object.entries(data)) {
      const m = key.match(/^custom_label_(\d+)$/);
      if (!m) continue;
      const idx   = m[1];
      const label = String(val ?? "").trim();
      const path  = String(data[`custom_matchPath_${idx}`] ?? "").trim();
      if (!label || !path) continue;
      customTypes.push({
        label,
        color:       data[`custom_color_${idx}`]       ?? "#8b0000",
        matchPath:   path,
        matchValues: String(data[`custom_matchValues_${idx}`] ?? "").trim(),
      });
    }
    await game.settings.set(MODULE_ID, "customCreatureTypes", customTypes);
  }
}

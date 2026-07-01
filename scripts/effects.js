import { MODULE_ID } from "./presets.js";
import { fillShape, textureFromCanvas, makeDisplacementFilter, makeBlurFilter } from "./pixi-compat.js";
import { randWith, mulberry32, makeSeed } from "./rng.js";

export const RUNTIME = {
  bleeding: new Map(),
  bloodPools: new Map(),
  bloodTrails: new Map(),
  lastTrailDrop: new Map()
};

function rand(min, max) {
  return min + (Math.random() * (max - min));
}

function hexToNumber(value) {
  if (typeof value !== "string") return 0x8b0000;
  return Number.parseInt(value.replace("#", ""), 16) || 0x8b0000;
}

function getBloodColor() {
  return hexToNumber(game.settings.get(MODULE_ID, "bloodColor"));
}

function getBloodColors(overrideColor = null) {
  const primary = overrideColor ?? getBloodColor();
  return { primary, secondary: tint(primary, 0.72) };
}

function tint(color, factor = 1) {
  const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((color & 0xff) * factor)));
  return ((r << 16) | (g << 8) | b) >>> 0;
}

// ---------------------------------------------------------------------------
// Bleeding overlay — teardrop drops falling vertically top-to-bottom
// ---------------------------------------------------------------------------

function spawnDrop(token, colors, halfW, halfH, texSize) {
  const w = texSize * (0.006 + Math.random() * 0.008);
  const h = texSize * (0.022 + Math.random() * 0.028);
  const color = Math.random() < 0.65 ? colors.primary : colors.secondary;

  const g = new PIXI.Graphics();
  fillShape(g, color, 0.8 + Math.random() * 0.2, (gg) => {
    gg.moveTo(0, -h * 0.3);
    gg.bezierCurveTo( w, -h * 0.05,  w,  h * 0.35,  0,  h * 0.6);
    gg.bezierCurveTo(-w,  h * 0.35, -w, -h * 0.05,  0, -h * 0.3);
  });

  const speed   = 0.25 + Math.random() * 0.45;
  const startAlpha = 0.9 + Math.random() * 0.1;
  const travelFrames = (halfH * 2) / speed;

  g._speed     = speed;
  g._halfH     = halfH;
  g._fadeRate  = startAlpha / travelFrames;
  g.x          = rand(-halfW * 0.85, halfW * 0.85);
  g.y          = -halfH;
  g.rotation   = 0;
  g.alpha      = startAlpha;

  return g;
}

function buildNoiseSprite(halfW, halfH) {
  const size = 128;
  const noiseCanvas = document.createElement("canvas");
  noiseCanvas.width = size;
  noiseCanvas.height = size;
  const ctx = noiseCanvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 255);
    img.data[i]     = v;
    img.data[i + 1] = v;
    img.data[i + 2] = 128;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const sprite = new PIXI.Sprite(textureFromCanvas(noiseCanvas));
  sprite.width  = halfW * 2;
  sprite.height = halfH * 2;
  sprite.x      = -halfW;
  sprite.y      = -halfH;
  return sprite;
}

export function ensureBleedingOverlay(token, colorOverride = null) {
  // If overlay exists, just update its stored color so next drop spawn picks it up
  const existing = RUNTIME.bleeding.get(token.id);
  if (existing) {
    existing._hvColorOverride = colorOverride;
    return;
  }

  const halfW  = token.w / 2;
  const halfH  = token.h / 2;
  const texSize = Math.max(token.w, token.h);
  const colors  = getBloodColors(colorOverride);
  const count   = Number(game.settings.get(MODULE_ID, "bleedingDropCount") ?? 12);

  const container = new PIXI.Container();
  container._hvBleeding = true;
  container.x = halfW;
  container.y = halfH;

  // Elliptical mask — matches the token's actual footprint
  const mask = new PIXI.Graphics();
  fillShape(mask, 0xFFFFFF, 1, (g) => g.drawEllipse(0, 0, halfW * 1.05, halfH * 1.05));
  container.addChild(mask);
  container.mask = mask;

  // Noise sprite for displacement filter
  const noiseSprite = buildNoiseSprite(halfW, halfH);
  container.addChild(noiseSprite);
  container._noiseSprite = noiseSprite;

  // Apply liquid filters (displacement + soft blur)
  const filters = [];
  try {
    filters.push(makeDisplacementFilter(noiseSprite, 3));
  } catch (_) {}
  try {
    filters.push(makeBlurFilter(1, 2));
  } catch (_) {}
  if (filters.length) container.filters = filters;

  // Spawn drops and stagger their initial vertical positions
  const drops = [];
  for (let i = 0; i < count; i++) {
    const drop = spawnDrop(token, colors, halfW, halfH, texSize);
    const stagger = Math.random() * halfH * 2;
    const framesElapsed = stagger / drop._speed;
    drop.y     = -halfH + stagger;
    drop.alpha = Math.max(0.05, drop.alpha - drop._fadeRate * framesElapsed);
    container.addChild(drop);
    drops.push(drop);
  }

  container._hvDrops        = drops;
  container._hvHalfW        = halfW;
  container._hvHalfH        = halfH;
  container._hvTexSize      = texSize;
  container._hvColorOverride = colorOverride;

  token.addChild(container);
  RUNTIME.bleeding.set(token.id, container);
  animateBleedingOverlay(token.id, token);
}

export function removeBleedingOverlay(tokenId) {
  const overlay = RUNTIME.bleeding.get(tokenId);
  if (!overlay) return;

  if (overlay._hvTicker) PIXI.Ticker.shared.remove(overlay._hvTicker);
  if (overlay.parent) overlay.parent.removeChild(overlay);
  overlay.destroy({ children: true });
  RUNTIME.bleeding.delete(tokenId);
}

function animateBleedingOverlay(tokenId, token) {
  const overlay = RUNTIME.bleeding.get(tokenId);
  if (!overlay) return;

  const halfW   = overlay._hvHalfW;
  const halfH   = overlay._hvHalfH;
  const texSize = overlay._hvTexSize;

  const tickerFn = () => {
    const current = RUNTIME.bleeding.get(tokenId);
    if (!current || token.destroyed) {
      PIXI.Ticker.shared.remove(tickerFn);
      return;
    }

    // Scroll noise texture to animate the displacement wobble
    if (current._noiseSprite) {
      current._noiseSprite.x += 0.04;
      current._noiseSprite.y += 0.07;
    }

    const colors = getBloodColors(current._hvColorOverride);
    const drops  = current._hvDrops;

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];

      // Fall straight down, elongate, fade
      d.y       += d._speed;
      d.scale.y += 0.02;
      d.alpha   -= d._fadeRate;

      if (d.alpha <= 0 || d.y >= halfH) {
        current.removeChild(d);
        d.destroy();
        const fresh = spawnDrop(token, colors, halfW, halfH, texSize);
        current.addChild(fresh);
        drops[i] = fresh;
      }
    }
  };

  overlay._hvTicker = tickerFn;
  PIXI.Ticker.shared.add(tickerFn);
}

// ---------------------------------------------------------------------------
// Hit flash — brief colour pulse over the token on damage / heal
// ---------------------------------------------------------------------------

export function playHitFlash(token, color) {
  if (!token || token.destroyed) return;

  const halfW = token.w / 2;
  const halfH = token.h / 2;

  const g = new PIXI.Graphics();
  g._hvHitFlash = true;
  fillShape(g, color, 1, (gg) => gg.drawEllipse(0, 0, halfW * 0.98, halfH * 0.98));
  g.x = halfW;
  g.y = halfH;
  g.alpha = 0;
  token.addChild(g);

  const duration = 420; // ms
  const peak = 0.5;
  const start = performance.now();

  const tickerFn = () => {
    if (!g || g.destroyed || token.destroyed) {
      PIXI.Ticker.shared.remove(tickerFn);
      return;
    }
    const t = (performance.now() - start) / duration;
    if (t >= 1) {
      PIXI.Ticker.shared.remove(tickerFn);
      if (g.parent) g.parent.removeChild(g);
      g.destroy();
      return;
    }
    // Ease up then back down over the lifetime.
    g.alpha = Math.sin(t * Math.PI) * peak;
  };

  PIXI.Ticker.shared.add(tickerFn);
}

// ---------------------------------------------------------------------------
// Shared cleanup
// ---------------------------------------------------------------------------

export function clearRuntimeEffects(tokenId) {
  removeBleedingOverlay(tokenId);
  removeBloodPool(tokenId);
  clearBloodTrails(tokenId);
}

// ---------------------------------------------------------------------------
// Blood trails — sparse marks (existing system)
// ---------------------------------------------------------------------------

export function maybeDropBloodTrail(tokenDoc, oldX, oldY, colorOverride = null) {
  if (!canvas?.ready) return;
  if (!game.settings.get(MODULE_ID, "enableBloodTrails")) return;

  const token = tokenDoc?.object;
  if (!token || token.destroyed) return;

  const centerX = token.center.x;
  const centerY = token.center.y;

  const spacing = Number(game.settings.get(MODULE_ID, "bloodTrailSpacing") ?? 35);
  const last = RUNTIME.lastTrailDrop.get(token.id);

  if (last) {
    const dx = centerX - last.x;
    const dy = centerY - last.y;
    if (Math.hypot(dx, dy) < spacing) return;
  }

  const record = createBloodTrailMark(token, oldX, oldY, colorOverride);
  RUNTIME.lastTrailDrop.set(token.id, { x: centerX, y: centerY });
  return record;
}

export function clearBloodTrails(tokenId) {
  const set = RUNTIME.bloodTrails.get(tokenId);
  if (set) {
    for (const entry of [...set]) {
      if (entry.timeout) clearTimeout(entry.timeout);
      if (entry.fadeTicker) PIXI.Ticker.shared.remove(entry.fadeTicker);
      if (entry.graphic?.parent) entry.graphic.parent.removeChild(entry.graphic);
      entry.graphic?.destroy({ children: true });
      set.delete(entry);
    }
    RUNTIME.bloodTrails.delete(tokenId);
  }
  RUNTIME.lastTrailDrop.delete(tokenId);
}

function createBloodTrailMark(token, oldX, oldY, colorOverride = null) {
  const layer = canvas.tokens;
  if (!layer) return null;

  // Shape is seeded (for persistent redraw); positional jitter is not, since
  // the final x/y is stored in the record.
  const seed = makeSeed();
  const resolvedColor = colorOverride ?? getBloodColor();

  const g = new PIXI.Graphics();
  g._hvBloodTrail = true;
  g.x = oldX + (token.w / 2) + rand(-5, 5);
  g.y = oldY + (token.h / 2) + rand(-5, 5);
  g.alpha = 0.62;

  g._hvColorOverride = resolvedColor;
  drawBloodTrailMark(g, mulberry32(seed));
  layer.addChildAt(g, 0);

  const lifetimeSec = Number(game.settings.get(MODULE_ID, "bloodTrailLifetime") ?? 180);
  const infinite = lifetimeSec >= 1830;
  const fadeTimeout = infinite ? null : setTimeout(() => fadeOutBloodTrailMark(token.id, g, 1200), lifetimeSec * 1000);

  let set = RUNTIME.bloodTrails.get(token.id);
  if (!set) {
    set = new Set();
    RUNTIME.bloodTrails.set(token.id, set);
  }
  set.add({ graphic: g, timeout: fadeTimeout, fadeTicker: null });

  return { kind: "mark", x: g.x, y: g.y, color: resolvedColor, seed };
}

function drawBloodTrailMark(g, rng = Math.random) {
  const r = (min, max) => randWith(rng, min, max);
  const bloodColor = g._hvColorOverride ?? getBloodColor();
  const darkBlood  = tint(bloodColor, 0.65);
  const baseRadius = r(4, 9);

  g.clear();

  // Small organic blob using the same radial bezier approach as the death pool
  const armCount = 10 + Math.floor(r(0, 6));
  const pts = [];
  for (let i = 0; i < armCount; i++) {
    const angle  = (i / armCount) * Math.PI * 2 + r(-0.15, 0.15);
    const isSpike = rng() < 0.30;
    const radius = isSpike ? baseRadius * r(1.5, 2.4) : baseRadius * r(0.4, 1.0);
    pts.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }

  const n = pts.length;

  fillShape(g, darkBlood, 0.5, (gg) => {
    gg.moveTo((pts[n - 1].x * 1.1 + pts[0].x * 1.1) / 2, (pts[n - 1].y * 1.1 + pts[0].y * 1.1) / 2);
    for (let i = 0; i < n; i++) {
      const p0x = pts[i].x * 1.1,           p0y = pts[i].y * 1.1;
      const p1x = pts[(i + 1) % n].x * 1.1, p1y = pts[(i + 1) % n].y * 1.1;
      gg.quadraticCurveTo(p0x, p0y, (p0x + p1x) / 2, (p0y + p1y) / 2);
    }
    gg.closePath();
  });

  fillShape(g, bloodColor, 0.75, (gg) => {
    gg.moveTo((pts[n - 1].x + pts[0].x) / 2, (pts[n - 1].y + pts[0].y) / 2);
    for (let i = 0; i < n; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % n];
      gg.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
    }
    gg.closePath();
  });
}

function fadeOutBloodTrailMark(tokenId, graphic, duration = 1200) {
  const start      = performance.now();
  const startAlpha = graphic.alpha;

  const tickerFn = () => {
    if (!graphic || graphic.destroyed) {
      PIXI.Ticker.shared.remove(tickerFn);
      return;
    }
    const t = Math.min((performance.now() - start) / duration, 1);
    graphic.alpha = startAlpha * (1 - t);
    if (t >= 1) {
      PIXI.Ticker.shared.remove(tickerFn);
      destroyBloodTrailGraphic(tokenId, graphic);
    }
  };

  const set = RUNTIME.bloodTrails.get(tokenId);
  if (set) {
    for (const entry of set) {
      if (entry.graphic === graphic) { entry.fadeTicker = tickerFn; break; }
    }
  }
  PIXI.Ticker.shared.add(tickerFn);
}

function destroyBloodTrailGraphic(tokenId, graphic) {
  const set = RUNTIME.bloodTrails.get(tokenId);
  if (!set) return;
  for (const entry of set) {
    if (entry.graphic === graphic) {
      if (entry.timeout) clearTimeout(entry.timeout);
      if (entry.fadeTicker) PIXI.Ticker.shared.remove(entry.fadeTicker);
      if (entry.graphic?.parent) entry.graphic.parent.removeChild(entry.graphic);
      entry.graphic?.destroy({ children: true });
      set.delete(entry);
      break;
    }
  }
  if (set.size === 0) RUNTIME.bloodTrails.delete(tokenId);
}

// ---------------------------------------------------------------------------
// Blood path trails — smears + drips along full movement path
// ---------------------------------------------------------------------------

// waypoints is an array of TokenMeasuredMovementWaypoint ({x, y} top-left).
// Returns an array of persistence records for the marks it placed.
export function dropPathTrail(tokenDoc, waypoints, colorOverride) {
  if (!canvas?.ready) return [];

  const token = tokenDoc?.object;
  if (!token || token.destroyed) return [];

  const layer = canvas.tokens;
  if (!layer) return [];

  const records = [];

  const halfW    = token.w / 2;
  const halfH    = token.h / 2;
  const gridSize = canvas.grid?.size ?? 100;
  const spacing  = Number(game.settings.get(MODULE_ID, "bloodTrailSpacing") ?? 35);
  const lifetimeSecPT = Number(game.settings.get(MODULE_ID, "bloodTrailLifetime") ?? 180);
  const lifetime = lifetimeSecPT >= 1830 ? null : lifetimeSecPT * 1000;

  // Walk each consecutive pair of waypoints as a segment.
  for (let i = 0; i < waypoints.length - 1; i++) {
    const fromX = waypoints[i].x + halfW;
    const fromY = waypoints[i].y + halfH;
    const toX   = waypoints[i + 1].x + halfW;
    const toY   = waypoints[i + 1].y + halfH;
    const dx    = toX - fromX;
    const dy    = toY - fromY;
    const dist  = Math.hypot(dx, dy);

    if (dist < 1) continue;

    const angle    = Math.atan2(dy, dx);
    // 1 mark per grid square traversed, minimum 1
    const numMarks = Math.max(1, Math.round(dist / gridSize));


    for (let m = 0; m < numMarks; m++) {
      const t  = Math.random();
      const px = fromX + dx * t + rand(-spacing * 0.2, spacing * 0.2);
      const py = fromY + dy * t + rand(-spacing * 0.2, spacing * 0.2);
      const rec = _placePathMark(layer, px, py, angle, colorOverride, tokenDoc, lifetime);
      if (rec) records.push(rec);
    }
  }

  return records;
}

function _placePathMark(layer, x, y, angle, colorOverride, tokenDoc, lifetime) {
  const seed = makeSeed();
  const resolvedColor = colorOverride ?? getBloodColor();
  const isSmear = Math.random() < 0.5;

  const g = new PIXI.Graphics();
  g._hvBloodTrail    = true;
  g._hvColorOverride = resolvedColor;
  g.x = x;
  g.y = y;

  if (isSmear) {
    g.alpha = 0.58;
    _drawBloodSmear(g, angle, mulberry32(seed));
  } else {
    g.alpha = 0.62;
    drawBloodTrailMark(g, mulberry32(seed));
  }

  layer.addChildAt(g, 0);

  const fadeTimeout = lifetime != null ? setTimeout(() => fadeOutBloodTrailMark(tokenDoc.id, g, 1200), lifetime) : null;

  let set = RUNTIME.bloodTrails.get(tokenDoc.id);
  if (!set) { set = new Set(); RUNTIME.bloodTrails.set(tokenDoc.id, set); }
  set.add({ graphic: g, timeout: fadeTimeout, fadeTicker: null });

  const record = { kind: isSmear ? "smear" : "mark", x, y, color: resolvedColor, seed };
  if (isSmear) record.angle = angle;
  return record;
}

function _drawBloodSmear(g, angle, rng = Math.random) {
  const r = (min, max) => randWith(rng, min, max);
  const bloodColor = g._hvColorOverride ?? getBloodColor();
  const darkBlood  = tint(bloodColor, 0.65);

  // Asymmetric teardrop: wide at trailing end (-halfLen), tapers to leading end (+halfLen)
  const halfLen = r(10, 17);
  const wTrail  = r(3, 6);          // half-width at trailing (back) end
  const wLead   = r(0.5, 1.8);      // half-width at leading (front) end
  const midX    = halfLen * r(0.1, 0.35); // control point offset from leading end

  // Dark shadow
  fillShape(g, darkBlood, 0.45, (gg) => {
    gg.moveTo(-halfLen - 1, 0);
    gg.bezierCurveTo(-halfLen, wTrail + 1,  midX, wLead + 1,  halfLen + 1, 0);
    gg.bezierCurveTo(           midX, -wLead - 1, -halfLen, -wTrail - 1, -halfLen - 1, 0);
  });

  // Main smear
  fillShape(g, bloodColor, 0.82, (gg) => {
    gg.moveTo(-halfLen, 0);
    gg.bezierCurveTo(-halfLen, wTrail,  midX, wLead,  halfLen, 0);
    gg.bezierCurveTo(           midX, -wLead, -halfLen, -wTrail, -halfLen, 0);
  });

  // Rotate the graphic to align with travel direction
  g.rotation = angle;
}

// ---------------------------------------------------------------------------
// Death blood pool
// ---------------------------------------------------------------------------

// Per-creature-type death decal styles. Each tweaks the pool's opacity, wet
// highlight, darken depth, spread speed, and colour so undead leave dust,
// constructs leave oil, plants leave sap, etc. "blood" reproduces the original
// look exactly.
const DEATH_POOL_STYLES = {
  blood: { alpha: 0.78, highlight: 0.18, darken: 0.70, grow: 0.0010, desaturate: 0,    tintFactor: 1,    scatter: false, sheen: false },
  dust:  { alpha: 0.50, highlight: 0.00, darken: 0.55, grow: 0.0016, desaturate: 0.85, tintFactor: 1,    scatter: true,  sheen: false },
  oil:   { alpha: 0.90, highlight: 0.32, darken: 0.20, grow: 0.0007, desaturate: 0,    tintFactor: 0.35, scatter: false, sheen: true  },
  sap:   { alpha: 0.82, highlight: 0.28, darken: 0.40, grow: 0.0010, desaturate: 0,    tintFactor: 1,    scatter: false, sheen: true  },
  ooze:  { alpha: 0.80, highlight: 0.26, darken: 0.45, grow: 0.0012, desaturate: 0,    tintFactor: 1,    scatter: false, sheen: false }
};

function deathStyleCfg(style) {
  return DEATH_POOL_STYLES[style] ?? DEATH_POOL_STYLES.blood;
}

function desaturateColor(color, amount) {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  const nr = Math.round(r + (gray - r) * amount);
  const ng = Math.round(g + (gray - g) * amount);
  const nb = Math.round(b + (gray - b) * amount);
  return ((nr << 16) | (ng << 8) | nb) >>> 0;
}

function styleColor(color, cfg) {
  let c = color;
  if (cfg.tintFactor !== 1) c = tint(c, cfg.tintFactor);
  if (cfg.desaturate > 0)   c = desaturateColor(c, cfg.desaturate);
  return c;
}

function clampArmsToWalls(arms, cx, cy) {
  if (!canvas?.walls) return;

  // Walls whose movement restriction is active and that aren't open doors
  const blocking = canvas.walls.placeables.filter(w => {
    if ((w.document.move ?? 0) === 0) return false;
    if (w.document.door && w.isOpen) return false;
    return true;
  });
  if (!blocking.length) return;

  const origin = { x: cx, y: cy };
  for (const arm of arms) {
    if (arm.maxRadius < 2) continue;
    const dest = { x: cx + Math.cos(arm.angle) * arm.maxRadius, y: cy + Math.sin(arm.angle) * arm.maxRadius };
    let minDist = arm.maxRadius;
    for (const wall of blocking) {
      const [x0, y0, x1, y1] = wall.coords;
      const hit = foundry.utils.lineSegmentIntersection(origin, dest, { x: x0, y: y0 }, { x: x1, y: y1 });
      if (hit && hit.t0 > 0.001 && hit.t0 <= 1 && hit.t1 >= 0 && hit.t1 <= 1) {
        const dist = hit.t0 * arm.maxRadius;
        if (dist < minDist) minDist = dist;
      }
    }
    arm.maxRadius = Math.max(0, minDist - 2);
  }
}

// Build the seeded arm + highlight geometry for a pool onto graphic `g`.
// Consumes the rng in a fixed order so the same seed always reproduces the
// identical blob (needed for persistent redraws across clients/reloads).
function initPoolShape(g, cx, cy, baseRadius, colorOverride, style, rng) {
  const r = (min, max) => randWith(rng, min, max);

  const armCount = 26 + Math.floor(r(0, 10));
  const arms = [];
  for (let i = 0; i < armCount; i++) {
    const angle = (i / armCount) * Math.PI * 2 + r(-0.08, 0.08);
    const isSpike = rng() < 0.28;
    arms.push({
      angle,
      maxRadius:     isSpike ? baseRadius * r(1.4, 2.2) : baseRadius * r(0.38, 1.05),
      startProgress: r(0, 0.32)
    });
  }

  clampArmsToWalls(arms, cx, cy);

  g._hvArms          = arms;
  g._hvBaseRadius    = baseRadius;
  g._hvHighlightX    = r(-0.22, 0.08);
  g._hvHighlightY    = r(-0.18, 0.04);
  g._hvColorOverride = colorOverride;
  g._hvStyle         = style;
  const cfg = deathStyleCfg(style);
  g._hvStyleCfg      = cfg;

  // Precompute scattered specks for the "dust" style, seeded so they stay put
  // across growth frames and reloads. Positions are relative to baseRadius.
  if (cfg.scatter) {
    const count = 6 + Math.floor(r(0, 7));
    const specks = [];
    for (let i = 0; i < count; i++) {
      specks.push({
        ang:  r(0, Math.PI * 2),
        dist: r(0.95, 1.9),   // × baseRadius from centre
        rad:  r(1.5, 4.5),    // px
        a:    r(0.18, 0.5)
      });
    }
    g._hvScatter = specks;
  }
}

// Creates the live (animated) death pool. Returns a persistence descriptor
// { x, y, baseRadius, seed } so the caller can store it, or null if not drawn.
export function ensureBloodPool(token, colorOverride = null, style = "blood", seed = null) {
  if (!canvas?.ready) return null;
  if (RUNTIME.bloodPools.has(token.id)) return null;

  const layer = canvas.tokens;
  if (!layer) return null;

  // Seed the shape so the persisted redraw matches this live pool exactly.
  if (seed == null) seed = makeSeed();
  const rng = mulberry32(seed);

  const g = new PIXI.Graphics();
  g._hvBloodPool = true;
  g.x = token.center.x;
  g.y = token.center.y;
  g.alpha = 0.72;
  g._hvProgress = 0.03;
  g._hvSeed = seed;

  // Resolve to a concrete colour now, so a persisted pool keeps its colour even
  // if the global blood colour is changed later.
  const resolvedColor = colorOverride ?? getBloodColor();
  const baseRadius = Math.max(token.w, token.h) * 0.45;
  initPoolShape(g, token.center.x, token.center.y, baseRadius, resolvedColor, style, rng);

  drawBloodPool(g, token, g._hvProgress);
  layer.addChildAt(g, 0);

  const growTicker = () => {
    const entry = RUNTIME.bloodPools.get(token.id);
    if (!entry?.graphic || entry.graphic.destroyed) {
      PIXI.Ticker.shared.remove(growTicker);
      return;
    }
    const growRate = entry.graphic._hvStyleCfg?.grow ?? 0.0010;
    entry.graphic._hvProgress = Math.min(1.0, entry.graphic._hvProgress + growRate);
    drawBloodPool(entry.graphic, token, entry.graphic._hvProgress);
    if (entry.graphic._hvProgress >= 1.0) {
      PIXI.Ticker.shared.remove(growTicker);
      entry.growTicker = null;
      // Start darkening + optional fade-out once the pool has fully spread
      const lifetimeSec = Number(game.settings.get(MODULE_ID, "bloodPoolLifetime") ?? 180);
      const infinite = lifetimeSec >= 1830;
      const lifetimeMs = lifetimeSec * 1000;
      startBloodPoolDarkening(token.id, infinite ? 120_000 : lifetimeMs);
      if (!infinite) entry.timeout = setTimeout(() => fadeOutBloodPool(token.id, 2000), lifetimeMs);
    }
  };

  PIXI.Ticker.shared.add(growTicker);

  RUNTIME.bloodPools.set(token.id, {
    graphic: g,
    timeout: null,
    fadeTicker: null,
    darkTicker: null,
    growTicker
  });

  return { x: token.center.x, y: token.center.y, baseRadius, seed, color: resolvedColor, style };
}

// Draws a static (fully-spread, fully-darkened) death pool from a persisted
// record onto the tokens layer. Used on reload / for remote clients.
export function createPoolDecalGraphic(record) {
  if (!canvas?.ready) return null;
  const layer = canvas.tokens;
  if (!layer) return null;

  const rng = mulberry32((record.seed >>> 0));
  const g = new PIXI.Graphics();
  g._hvPersistentDecal = true;
  g.x = record.x;
  g.y = record.y;
  g.alpha = 0.72;

  const baseRadius = record.baseRadius ?? 40;
  initPoolShape(g, record.x, record.y, baseRadius, record.color ?? null, record.style ?? "blood", rng);

  drawBloodPool(g, null, 1);

  // Apply the style's fully-darkened tint, matching an aged live pool.
  const darkenDepth = g._hvStyleCfg?.darken ?? 0.70;
  const v = Math.round((1.0 - darkenDepth) * 255);
  g.tint = (v << 16) | (v << 8) | v;

  layer.addChildAt(g, 0);
  return g;
}

// Draws a static trail mark or smear from a persisted record.
export function createTrailDecalGraphic(record) {
  if (!canvas?.ready) return null;
  const layer = canvas.tokens;
  if (!layer) return null;

  const rng = mulberry32((record.seed >>> 0));
  const g = new PIXI.Graphics();
  g._hvPersistentDecal = true;
  g._hvColorOverride = record.color ?? null;
  g.x = record.x;
  g.y = record.y;

  if (record.kind === "smear") {
    g.alpha = 0.58;
    _drawBloodSmear(g, record.angle ?? 0, rng);
  } else {
    g.alpha = 0.62;
    drawBloodTrailMark(g, rng);
  }

  layer.addChildAt(g, 0);
  return g;
}

export function removeBloodPool(tokenId) {
  const entry = RUNTIME.bloodPools.get(tokenId);
  if (!entry) return;

  if (entry.timeout)    clearTimeout(entry.timeout);
  if (entry.fadeTicker) PIXI.Ticker.shared.remove(entry.fadeTicker);
  if (entry.growTicker) PIXI.Ticker.shared.remove(entry.growTicker);
  if (entry.darkTicker) PIXI.Ticker.shared.remove(entry.darkTicker);
  if (entry.graphic?.parent) entry.graphic.parent.removeChild(entry.graphic);
  entry.graphic?.destroy({ children: true });

  RUNTIME.bloodPools.delete(tokenId);
}

function startBloodPoolDarkening(tokenId, duration) {
  const entry = RUNTIME.bloodPools.get(tokenId);
  if (!entry?.graphic) return;

  const graphic = entry.graphic;
  const start   = performance.now();

  const darkTicker = () => {
    const current = RUNTIME.bloodPools.get(tokenId);
    if (!current || !graphic || graphic.destroyed) {
      PIXI.Ticker.shared.remove(darkTicker);
      return;
    }
    const t = Math.min((performance.now() - start) / duration, 1);
    // Tween tint from 0xffffff (full color) down toward the style's darken depth
    const darkenDepth = graphic._hvStyleCfg?.darken ?? 0.70;
    const factor = 1.0 - t * darkenDepth;
    const v = Math.round(factor * 255);
    graphic.tint = (v << 16) | (v << 8) | v;
    if (t >= 1) {
      PIXI.Ticker.shared.remove(darkTicker);
      current.darkTicker = null;
    }
  };

  entry.darkTicker = darkTicker;
  PIXI.Ticker.shared.add(darkTicker);
}

function drawBloodPool(g, token, progress = 1) {
  const cfg = deathStyleCfg(g._hvStyle);
  const bloodColor = styleColor(g._hvColorOverride ?? getBloodColor(), cfg);
  const darkBlood  = tint(bloodColor, 0.65);
  const baseRadius = g._hvBaseRadius ?? Math.max(token.w, token.h) * 0.45;
  const poolAlpha        = cfg.alpha;
  const highlightStrength = cfg.highlight;

  g.clear();

  const arms = g._hvArms ?? [];
  if (arms.length === 0) return;

  // Compute each arm's current reach with eased growth and staggered start
  const pts = arms.map(arm => {
    const t = Math.max(0, Math.min(1, (progress - arm.startProgress) / (1.0 - arm.startProgress)));
    const eased = 1 - Math.pow(1 - t, 2.2);
    const r = arm.maxRadius * eased;
    return { x: Math.cos(arm.angle) * r, y: Math.sin(arm.angle) * r };
  });

  const n = pts.length;

  // Draw dark shadow blob (scaled out slightly)
  fillShape(g, darkBlood, 0.5, (gg) => {
    gg.moveTo((pts[n - 1].x * 1.09 + pts[0].x * 1.09) / 2, (pts[n - 1].y * 1.09 + pts[0].y * 1.09) / 2);
    for (let i = 0; i < n; i++) {
      const p0x = pts[i].x * 1.09,             p0y = pts[i].y * 1.09;
      const p1x = pts[(i + 1) % n].x * 1.09,   p1y = pts[(i + 1) % n].y * 1.09;
      gg.quadraticCurveTo(p0x, p0y, (p0x + p1x) / 2, (p0y + p1y) / 2);
    }
    gg.closePath();
  });

  // Draw main blood blob
  fillShape(g, bloodColor, poolAlpha, (gg) => {
    gg.moveTo((pts[n - 1].x + pts[0].x) / 2, (pts[n - 1].y + pts[0].y) / 2);
    for (let i = 0; i < n; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % n];
      gg.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
    }
    gg.closePath();
  });

  // Wet highlight
  if (highlightStrength > 0) {
    const hx = (g._hvHighlightX ?? -0.15) * baseRadius * 0.45 * progress;
    const hy = (g._hvHighlightY ?? -0.08) * baseRadius * 0.35 * progress;
    fillShape(g, tint(bloodColor, 1.12), highlightStrength, (gg) =>
      gg.drawEllipse(hx, hy, baseRadius * 0.18 * progress, baseRadius * 0.13 * progress));
  }

  // Oil / sap "sheen": a second, cooler-tinted highlight offset from the first,
  // giving a glossy iridescent streak.
  if (cfg.sheen) {
    const shx = -(g._hvHighlightX ?? -0.15) * baseRadius * 0.5 * progress;
    const shy = -(g._hvHighlightY ?? -0.08) * baseRadius * 0.4 * progress;
    // Shift the tint toward blue for an iridescent sheen.
    const sheenColor = ((bloodColor & 0x0000ff) < 0xcc ? bloodColor + 0x000033 : bloodColor);
    fillShape(g, tint(sheenColor, 1.4), 0.16, (gg) =>
      gg.drawEllipse(shx, shy, baseRadius * 0.12 * progress, baseRadius * 0.08 * progress));
  }

  // Dust "scatter": faded specks flung out around the pool.
  const specks = g._hvScatter;
  if (specks) {
    for (const sp of specks) {
      const d = sp.dist * baseRadius * progress;
      const x = Math.cos(sp.ang) * d;
      const y = Math.sin(sp.ang) * d;
      fillShape(g, darkBlood, sp.a * progress, (gg) =>
        gg.drawCircle(x, y, sp.rad * (0.5 + 0.5 * progress)));
    }
  }
}

function fadeOutBloodPool(tokenId, duration = 1500) {
  const entry = RUNTIME.bloodPools.get(tokenId);
  if (!entry?.graphic) return;

  const graphic    = entry.graphic;
  const start      = performance.now();
  const startAlpha = graphic.alpha;

  const tickerFn = () => {
    const current = RUNTIME.bloodPools.get(tokenId);
    if (!current || !graphic || graphic.destroyed) {
      PIXI.Ticker.shared.remove(tickerFn);
      return;
    }
    const t = Math.min((performance.now() - start) / duration, 1);
    graphic.alpha = startAlpha * (1 - t);
    if (t >= 1) {
      PIXI.Ticker.shared.remove(tickerFn);
      removeBloodPool(tokenId);
    }
  };

  entry.fadeTicker = tickerFn;
  PIXI.Ticker.shared.add(tickerFn);
}

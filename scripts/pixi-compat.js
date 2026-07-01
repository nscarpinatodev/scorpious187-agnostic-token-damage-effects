// PIXI forward-compat abstraction.
//
// Foundry v13/v14 ship PIXI v7, whose Graphics fill model (beginFill/endFill)
// and filter namespace (PIXI.filters.*) were removed/reorganised in PIXI v8.
// This module isolates every v7-specific idiom the effects code uses so that a
// future Foundry that moves to v8 can be supported by editing only this file.
//
// Today only the v7 branches execute. The v8 branches are written against the
// documented v8 API but are guarded behind a version check so they never run
// on v7.

function pixiMajor() {
  const v = globalThis.PIXI?.VERSION ?? "7";
  return Number.parseInt(String(v).split(".")[0], 10) || 7;
}

const IS_V8 = pixiMajor() >= 8;

// Fill a shape. `drawPath(g)` issues the path commands (moveTo / bezierCurveTo /
// quadraticCurveTo / drawEllipse), which are compatible across v7 and v8.
//
// v7: beginFill(color, alpha) → path → endFill()
// v8: path → fill({ color, alpha })
export function fillShape(g, color, alpha, drawPath) {
  if (IS_V8) {
    drawPath(g);
    g.fill({ color, alpha });
  } else {
    g.beginFill(color, alpha);
    drawPath(g);
    g.endFill();
  }
}

// Build a texture from a raw <canvas> element.
// v7 & v8 both support PIXI.Texture.from; kept here so the one call site is
// centralised and easy to adjust if the signature drifts.
export function textureFromCanvas(canvas) {
  return PIXI.Texture.from(canvas);
}

// Displacement filter over a sprite, with an isotropic scale.
export function makeDisplacementFilter(sprite, scale) {
  const Ctor = IS_V8 ? PIXI.DisplacementFilter : PIXI.filters.DisplacementFilter;
  const filter = new Ctor(sprite);
  if (filter.scale?.set) filter.scale.set(scale);
  return filter;
}

// Soft blur filter.
export function makeBlurFilter(strength = 1, quality = 2) {
  const Ctor = IS_V8 ? PIXI.BlurFilter : PIXI.filters.BlurFilter;
  return new Ctor(strength, quality);
}

// Colour-matrix filter (used for the Token-Magic-FX-free colour fallback).
export function makeColorMatrixFilter() {
  const Ctor = IS_V8 ? PIXI.ColorMatrixFilter : PIXI.filters.ColorMatrixFilter;
  return new Ctor();
}

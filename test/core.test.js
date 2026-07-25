"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const oracle = require("../src/contrast-oracle.js");

function close(actual, expected, tolerance = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

test("parses CSS colors and composites stacked translucency", () => {
  assert.equal(oracle.toHex(oracle.parseColor("rgb(255 0 128 / 50%)")), "#FF0080");
  const first = oracle.composite(
    oracle.parseColor("rgba(255, 255, 255, .5)"),
    oracle.parseColor("#000000")
  );
  const stacked = oracle.composite(
    oracle.parseColor("rgba(0, 0, 0, .25)"),
    first
  );
  close(stacked.r, 0.375);
  close(stacked.g, 0.375);
  close(stacked.b, 0.375);
  assert.equal(stacked.a, 1);
});

test("computes WCAG 2.2 ratios and signed APCA Lc", () => {
  const black = oracle.parseColor("#000");
  const white = oracle.parseColor("#fff");
  close(oracle.contrastRatio(black, white), 21, 0.001);
  assert.ok(oracle.apcaContrast(black, white) > 100);
  assert.ok(oracle.apcaContrast(white, black) < -100);
});

test("samples linear and translucent gradients at their rendered positions", () => {
  const rect = { left: 0, top: 0, width: 100, height: 20 };
  const left = oracle.sampleGradient(
    "linear-gradient(90deg, #000 0%, rgba(255,255,255,.5) 100%)",
    rect,
    { x: 0, y: 10 }
  );
  const right = oracle.sampleGradient(
    "linear-gradient(90deg, #000 0%, rgba(255,255,255,.5) 100%)",
    rect,
    { x: 100, y: 10 }
  );
  assert.equal(oracle.toHex(left), "#000000");
  assert.equal(oracle.toHex(right), "#FFFFFF");
  close(right.a, 0.5);
});

test("interpolates translucent gradient stops with premultiplied alpha", () => {
  const midpoint = oracle.sampleGradient(
    "linear-gradient(90deg, rgba(255,0,0,0), rgb(0,0,255))",
    { left: 0, top: 0, width: 100, height: 20 },
    { x: 50, y: 10 }
  );
  assert.equal(oracle.toHex(midpoint), "#0000FF");
  close(midpoint.a, 0.5);
});

test("samples radial gradients", () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const center = oracle.sampleGradient(
    "radial-gradient(circle at center center, #fff 0%, #000 100%)",
    rect,
    { x: 50, y: 50 }
  );
  const edge = oracle.sampleGradient(
    "radial-gradient(circle at center center, #fff 0%, #000 100%)",
    rect,
    { x: 100, y: 100 }
  );
  assert.equal(oracle.toHex(center), "#FFFFFF");
  assert.equal(oracle.toHex(edge), "#000000");
});

test("honors a radial gradient center on a non-square box", () => {
  const rect = { left: 0, top: 0, width: 200, height: 100 };
  const center = oracle.sampleGradient(
    "radial-gradient(circle at 25% 50%, #fff 0%, #000 100%)",
    rect,
    { x: 50, y: 50 }
  );
  assert.equal(oracle.toHex(center), "#FFFFFF");
});

test("honors an explicit radial gradient radius", () => {
  const gradient = "radial-gradient(circle 10px at 25px 30px, #fff 0%, #000 100%)";
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  assert.equal(
    oracle.toHex(oracle.sampleGradient(gradient, rect, { x: 25, y: 30 })),
    "#FFFFFF"
  );
  assert.equal(
    oracle.toHex(oracle.sampleGradient(gradient, rect, { x: 35, y: 30 })),
    "#000000"
  );
});

test("resolves radial pixel stops against an ellipse horizontal radius", () => {
  const gradient = [
    "radial-gradient(ellipse 20px 100px at 100px 100px,",
    "#fff 0px, #000 20px)"
  ].join(" ");
  const sampled = oracle.sampleGradient(
    gradient,
    { left: 0, top: 0, width: 200, height: 200 },
    { x: 104, y: 100 }
  );
  assert.equal(oracle.toHex(sampled), "#CCCCCC");
});

test("finds the nearest passing OKLCH lightness while retaining hue", () => {
  const foreground = oracle.parseColor("#707070");
  const backgrounds = [oracle.parseColor("#ffffff"), oracle.parseColor("#dddddd")];
  const original = oracle.rgbToOklch(foreground);
  const suggestion = oracle.suggestPassingColor(
    foreground,
    backgrounds,
    { wcag: 4.5, apca: 60 }
  );
  const suggested = oracle.rgbToOklch(suggestion.color);
  assert.equal(suggestion.passes, true);
  assert.ok(backgrounds.every((background) => (
    oracle.contrastRatio(suggestion.color, background) >= 4.5
    && Math.abs(oracle.apcaContrast(suggestion.color, background)) >= 60
  )));
  close(suggested.h, original.h, 0.1);
  assert.ok(suggestion.lightnessDelta < 0.2);
});

test("rechecks the rounded suggested hex against WCAG", () => {
  const background = oracle.parseColor("#fff");
  const suggestion = oracle.suggestPassingColor(
    oracle.parseColor("#888"),
    [background],
    { wcag: 4.5, apca: 60 }
  );
  const displayed = oracle.parseColor(suggestion.hex);
  assert.equal(suggestion.passes, true);
  assert.ok(oracle.contrastRatio(displayed, background) >= 4.5);
  assert.ok(Math.abs(oracle.apcaContrast(displayed, background)) >= 60);
});

test("reports when no single color can pass every sampled background", () => {
  const suggestion = oracle.suggestPassingColor(
    oracle.parseColor("#777"),
    [oracle.parseColor("#000"), oracle.parseColor("#fff")],
    { wcag: 7, apca: 75 }
  );
  assert.equal(suggestion.passes, false);
  assert.match(suggestion.hex, /^#[0-9A-F]{6}$/);
});

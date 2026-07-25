"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const oracle = require("../src/contrast-oracle.js");
const {
  FakeDocument,
  FakeElement,
  makeGradientFixture
} = require("./fake-dom.js");

test("catches a gradient edge failure missed by a background-color-only check", () => {
  const fixture = makeGradientFixture();
  const foreground = oracle.parseColor(fixture.target.computedStyle.color);
  const flatBackground = oracle.parseColor(fixture.target.computedStyle.backgroundColor);
  const flatRatio = oracle.contrastRatio(foreground, flatBackground);
  const report = oracle.auditDocument(fixture.document);
  const failure = report.failures.find((entry) => entry.text.startsWith("Gradient edge"));

  assert.ok(flatRatio >= 4.5, "background-color-only check should pass the fixture");
  assert.ok(failure, "gradient sampling should catch the lower contrast edge");
  assert.ok(failure.ratio < 4.5);
  assert.equal(failure.suggestionPasses, true);
});

test("catches a narrow low-contrast band between coarse sample positions", () => {
  const fixture = makeGradientFixture();
  fixture.target.computedStyle.backgroundImage = [
    "linear-gradient(90deg,",
    "#fff 0%, #fff 20%,",
    "#777 20%, #777 30%,",
    "#fff 30%, #fff 100%)"
  ].join(" ");
  fixture.text.rect = { left: 20, top: 50, width: 900, height: 24 };
  const report = oracle.auditDocument(fixture.document);
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0].worstBackgroundHex, "#777777");
});

test("samples a subpixel hard-stop band through its gradient interval", () => {
  const fixture = makeGradientFixture();
  fixture.target.computedStyle.backgroundImage = [
    "linear-gradient(90deg,",
    "#fff 0%, #fff 20%,",
    "#777 20%, #777 20.1%,",
    "#fff 20.1%, #fff 100%)"
  ].join(" ");
  fixture.text.rect = { left: 20, top: 50, width: 900, height: 24 };
  const report = oracle.auditDocument(fixture.document);
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0].worstBackgroundHex, "#777777");
});

test("samples a small off-axis radial failure ring", () => {
  const fixture = makeGradientFixture();
  fixture.target.computedStyle.backgroundImage = [
    "radial-gradient(circle 6px at 93px 37px,",
    "#fff 0%, #fff 40%,",
    "#777 40%, #777 50%,",
    "#fff 50%, #fff 100%)"
  ].join(" ");
  fixture.text.rect = { left: 20, top: 50, width: 900, height: 24 };
  const report = oracle.auditDocument(fixture.document);
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0].worstBackgroundHex, "#777777");
});

test("groups ancestor opacity when resolving background and foreground pixels", () => {
  const documentObject = new FakeDocument();
  documentObject.documentElement.computedStyle.backgroundColor = "#000";
  const parent = new FakeElement(documentObject, "section", {
    computedStyle: { opacity: ".5" }
  });
  const child = new FakeElement(documentObject, "div", {
    computedStyle: {
      backgroundColor: "#fff",
      color: "#000"
    }
  });
  documentObject.body.appendChild(parent);
  parent.appendChild(child);
  const sampled = oracle.effectiveBackground(
    child,
    { x: 50, y: 50 },
    documentObject.defaultView,
    oracle.parseColor("#000")
  );
  assert.equal(oracle.toHex(sampled.color), "#808080");
  assert.equal(oracle.toHex(sampled.foreground), "#000000");
});

test("renders in-place boxes carrying the suggested hex", () => {
  const fixture = makeGradientFixture();
  const report = oracle.auditDocument(fixture.document);
  const overlay = oracle.renderOverlay(fixture.document, report);
  const boxes = overlay.shadowRoot.querySelectorAll(".box");
  const tags = overlay.shadowRoot.querySelectorAll(".tag");

  assert.equal(boxes.length, 1);
  assert.equal(tags.length, 1);
  assert.match(tags[0].textContent, /#[0-9A-F]{6}/);
  assert.equal(boxes[0].style.left, "650px");
  assert.equal(boxes[0].style.top, "50px");
});

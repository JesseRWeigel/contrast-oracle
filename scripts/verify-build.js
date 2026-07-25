"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { makeGradientFixture } = require("../test/fake-dom.js");

const root = path.resolve(__dirname, "..");
const bookmarkletPath = path.join(root, "dist", "bookmarklet.txt");
const installerPath = path.join(root, "index.html");
const bookmarklet = fs.readFileSync(bookmarkletPath, "utf8");
const installer = fs.readFileSync(installerPath, "utf8");

assert.match(bookmarklet, /^javascript:/);
assert.match(bookmarklet, /ContrastOracle\.run\(\)/);
assert.match(installer, /id="bookmarklet"/);
assert.ok(bookmarklet.length > 1000, "bookmarklet should contain the full audit engine");

const fixture = makeGradientFixture();
const context = vm.createContext({ document: fixture.document });
vm.runInContext(bookmarklet, context, {
  filename: "dist/bookmarklet.txt",
  timeout: 5000
});
const report = context.ContrastOracle.auditDocument(fixture.document);
const serial = context.ContrastOracle.serializableReport(report);
const failure = serial.failures.find((entry) => entry.text.startsWith("Gradient edge"));
const overlay = fixture.document.getElementById("contrast-oracle-overlay");
const overlayCount = overlay ? overlay.shadowRoot.querySelectorAll(".box").length : 0;

assert.ok(failure, "built bookmarklet did not catch the gradient failure");
assert.equal(failure.suggestionPasses, true);
assert.equal(overlayCount, 1, "built bookmarklet did not render one in-place overlay");

console.log(
  `Bookmarklet PASS: gradient failure caught, suggested ${failure.suggestedHex}, `
  + `${overlayCount} in-place overlay`
);

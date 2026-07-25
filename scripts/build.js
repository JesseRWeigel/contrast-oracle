"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "src", "contrast-oracle.js");
const distDirectory = path.join(root, "dist");
const source = fs.readFileSync(sourcePath, "utf8");
const bookmarklet = `javascript:(()=>{${source}\n;globalThis.ContrastOracle.run();})()`;

fs.mkdirSync(distDirectory, { recursive: true });
fs.writeFileSync(path.join(distDirectory, "bookmarklet.txt"), bookmarklet, "utf8");
fs.writeFileSync(path.join(distDirectory, "contrast-oracle.js"), source, "utf8");

console.log(`Built dist/bookmarklet.txt (${Buffer.byteLength(bookmarklet)} bytes)`);

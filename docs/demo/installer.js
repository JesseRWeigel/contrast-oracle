"use strict";

const link = document.getElementById("bookmarklet");
const status = document.getElementById("install-status");

fetch("dist/bookmarklet.txt")
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  })
  .then((bookmarklet) => {
    link.href = bookmarklet;
    link.removeAttribute("aria-disabled");
    status.textContent = "Ready. Drag the button to your bookmarks bar.";
  })
  .catch((error) => {
    status.textContent = `Could not load the bookmarklet: ${error.message}. Serve this folder over HTTP.`;
  });

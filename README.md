# contrast-oracle

Walk every text node, compute the effective background through stacked translucent parents and gradients, evaluate WCAG 2.2 contrast plus APCA Lc, and for each failure suggest the nearest color in OKLCH that passes while preserving hue and chroma as far as possible. Overlay the failures in place with the suggested hex. Done when it catches a failure that axe-core misses because of a gradient background.

Catalog task: `EXT-004`. Part of [722 things to build](https://github.com/JesseRWeigel/722-things-to-build).

**[Install the bookmarklet](https://jesserweigel.github.io/contrast-oracle/)**

## What this is

Contrast Oracle is a self-contained, zero-dependency browser bookmarklet. It
walks visible text nodes, samples their rendered rectangles, and composites
solid colors, translucent ancestor groups, linear gradients, and radial
gradients from the page canvas to the text element.

Each sample receives a WCAG 2.2 contrast ratio and an APCA Lc value. Normal text
uses a WCAG AA threshold of 4.5 and an APCA target of 60. Large text uses 3.0
and 45. A failing text rectangle gets an in-place overlay showing the worst
ratio, APCA Lc, and a suggested six-digit hex color.

Suggestions search OKLCH lightness in order of distance from the source color.
Hue and chroma stay fixed when the result is in sRGB. Out-of-gamut candidates
reduce chroma while retaining hue. The rounded hex is checked again against
every sampled background before the tool labels it as passing.

Gradient auditing combines an adaptive spatial scan with critical samples at
linear color-stop intervals and radial stop rings. The regression fixture
contains dark-gray text that passes against `background-color: white` and fails
over the lower-contrast edge of a linear gradient.

## Running it

```bash
node scripts/build.js
python3 -m http.server 8000
```

Open `http://localhost:8000`, drag the **Contrast Oracle** link to the bookmarks
bar, then activate it on the page you want to audit.

Run `ContrastOracle.removeOverlay(document)` in the page console, or click the
overlay's Close button, to remove a result.

## Assumptions

- The unpainted page canvas is white.
- APCA targets use a practical two-level policy of Lc 60 for ordinary text and
  Lc 45 for large or heavy display text.
- Gradient geometry uses each ancestor's border rectangle. Default CSS
  positioning and sizing are assumed.
- A suggested hex is opaque because six-digit hex has no alpha channel.

## Verify

```bash
node --test test/*.test.js && node scripts/build.js && node scripts/verify-build.js
```

## Status

Verified locally with exit code 0:

```text
✔ test/core.test.js (72.016511ms)
✔ test/dom.test.js (149.077732ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 166.565674
Built dist/bookmarklet.txt (43072 bytes)
Bookmarklet PASS: gradient failure caught, suggested #626262, 1 in-place overlay
```

## Unfinished

- CSS `conic-gradient()`, raster background images, blend modes, masks, filters,
  pseudo-elements, text shadows, and text strokes are outside the current
  background model.
- Custom `background-size`, `background-position`, `background-repeat`, and
  non-default background clipping can shift gradient samples.
- Closed shadow roots and cross-origin frames cannot be inspected by a page
  bookmarklet.
- The regression compares against a background-color-only check. It does not
  bundle or execute axe-core.
- `test/browser-fixture.html` is available for a manual browser smoke test. The
  automated build check uses a deterministic DOM harness because Chrome cannot
  start inside the fleet's socket-restricted execution sandbox.

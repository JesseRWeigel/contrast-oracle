(function attachContrastOracle(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ContrastOracle = api;
})(typeof globalThis === "object" ? globalThis : this, function createContrastOracle() {
  "use strict";

  const VERSION = "1.0.0";
  const OVERLAY_ID = "contrast-oracle-overlay";
  const EPSILON = 1e-7;

  function clamp(value, min = 0, max = 1) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value, places = 3) {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  }

  function color(r, g, b, a = 1) {
    return { r: clamp(r), g: clamp(g), b: clamp(b), a: clamp(a) };
  }

  function parseChannel(token) {
    const value = parseFloat(token);
    return token.trim().endsWith("%") ? clamp(value / 100) : clamp(value / 255);
  }

  function parseAlpha(token) {
    const value = parseFloat(token);
    return token.trim().endsWith("%") ? clamp(value / 100) : clamp(value);
  }

  function parseHue(token) {
    const value = parseFloat(token);
    if (token.endsWith("turn")) return value * 360;
    if (token.endsWith("rad")) return value * 180 / Math.PI;
    if (token.endsWith("grad")) return value * 0.9;
    return value;
  }

  function hslToRgb(h, s, l, a = 1) {
    const hue = ((h % 360) + 360) % 360 / 360;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const section = hue * 6;
    const x = chroma * (1 - Math.abs(section % 2 - 1));
    let channels = [0, 0, 0];
    if (section < 1) channels = [chroma, x, 0];
    else if (section < 2) channels = [x, chroma, 0];
    else if (section < 3) channels = [0, chroma, x];
    else if (section < 4) channels = [0, x, chroma];
    else if (section < 5) channels = [x, 0, chroma];
    else channels = [chroma, 0, x];
    const match = l - chroma / 2;
    return color(channels[0] + match, channels[1] + match, channels[2] + match, a);
  }

  function parseColor(input) {
    if (!input || typeof input !== "string") return null;
    const value = input.trim().toLowerCase();
    const named = {
      transparent: color(0, 0, 0, 0),
      black: color(0, 0, 0),
      white: color(1, 1, 1),
      red: color(1, 0, 0),
      green: color(0, 128 / 255, 0),
      blue: color(0, 0, 1),
      gray: color(128 / 255, 128 / 255, 128 / 255),
      grey: color(128 / 255, 128 / 255, 128 / 255),
      yellow: color(1, 1, 0)
    };
    if (named[value]) return named[value];

    const hex = value.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      let digits = hex[1];
      if (digits.length === 3 || digits.length === 4) {
        digits = digits.split("").map((digit) => digit + digit).join("");
      }
      if (digits.length !== 6 && digits.length !== 8) return null;
      return color(
        parseInt(digits.slice(0, 2), 16) / 255,
        parseInt(digits.slice(2, 4), 16) / 255,
        parseInt(digits.slice(4, 6), 16) / 255,
        digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1
      );
    }

    const rgb = value.match(/^rgba?\((.*)\)$/);
    if (rgb) {
      const slashParts = splitTopLevel(rgb[1], "/");
      const channels = splitTopLevel(slashParts[0], ",").length > 1
        ? splitTopLevel(slashParts[0], ",")
        : slashParts[0].trim().split(/\s+/);
      let alphaToken = slashParts[1];
      if (channels.length === 4 && alphaToken === undefined) alphaToken = channels.pop();
      if (channels.length !== 3) return null;
      return color(
        parseChannel(channels[0]),
        parseChannel(channels[1]),
        parseChannel(channels[2]),
        alphaToken === undefined ? 1 : parseAlpha(alphaToken)
      );
    }

    const hsl = value.match(/^hsla?\((.*)\)$/);
    if (hsl) {
      const slashParts = splitTopLevel(hsl[1], "/");
      const channels = splitTopLevel(slashParts[0], ",").length > 1
        ? splitTopLevel(slashParts[0], ",")
        : slashParts[0].trim().split(/\s+/);
      let alphaToken = slashParts[1];
      if (channels.length === 4 && alphaToken === undefined) alphaToken = channels.pop();
      if (channels.length !== 3) return null;
      return hslToRgb(
        parseHue(channels[0]),
        clamp(parseFloat(channels[1]) / 100),
        clamp(parseFloat(channels[2]) / 100),
        alphaToken === undefined ? 1 : parseAlpha(alphaToken)
      );
    }

    const srgb = value.match(/^color\(srgb\s+([^)]*)\)$/);
    if (srgb) {
      const parts = splitTopLevel(srgb[1], "/");
      const channels = parts[0].trim().split(/\s+/).map(Number);
      if (channels.length !== 3 || channels.some(Number.isNaN)) return null;
      return color(channels[0], channels[1], channels[2], parts[1] ? parseAlpha(parts[1]) : 1);
    }

    const oklch = value.match(/^oklch\((.*)\)$/);
    if (oklch) {
      const parts = splitTopLevel(oklch[1], "/");
      const channels = parts[0].trim().split(/\s+/);
      if (channels.length < 3) return null;
      const lightness = channels[0].endsWith("%")
        ? parseFloat(channels[0]) / 100
        : parseFloat(channels[0]);
      const converted = oklchToGamutRgb({
        l: lightness,
        c: parseFloat(channels[1]),
        h: parseHue(channels[2])
      });
      converted.a = parts[1] ? parseAlpha(parts[1]) : 1;
      return converted;
    }
    return null;
  }

  function splitTopLevel(input, delimiter = ",") {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < input.length; index += 1) {
      const character = input[index];
      if (character === "(") depth += 1;
      else if (character === ")") depth -= 1;
      else if (depth === 0 && input.startsWith(delimiter, index)) {
        parts.push(input.slice(start, index).trim());
        start = index + delimiter.length;
        index += delimiter.length - 1;
      }
    }
    parts.push(input.slice(start).trim());
    return parts;
  }

  function composite(foreground, background) {
    const alpha = foreground.a + background.a * (1 - foreground.a);
    if (alpha < EPSILON) return color(0, 0, 0, 0);
    return color(
      (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
      (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
      (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
      alpha
    );
  }

  function srgbToLinear(channel) {
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }

  function linearToSrgb(channel) {
    return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  }

  function relativeLuminance(value) {
    return 0.2126 * srgbToLinear(value.r)
      + 0.7152 * srgbToLinear(value.g)
      + 0.0722 * srgbToLinear(value.b);
  }

  function contrastRatio(first, second) {
    const firstLuminance = relativeLuminance(first);
    const secondLuminance = relativeLuminance(second);
    const lighter = Math.max(firstLuminance, secondLuminance);
    const darker = Math.min(firstLuminance, secondLuminance);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function apcaLuminance(value) {
    const red = value.r ** 2.4;
    const green = value.g ** 2.4;
    const blue = value.b ** 2.4;
    let luminance = red * 0.2126729 + green * 0.7151522 + blue * 0.072175;
    if (luminance < 0.022) luminance += (0.022 - luminance) ** 1.414;
    return luminance;
  }

  function apcaContrast(text, background) {
    const textY = apcaLuminance(text);
    const backgroundY = apcaLuminance(background);
    if (Math.abs(backgroundY - textY) < 0.0005) return 0;
    let contrast;
    if (backgroundY > textY) {
      contrast = (backgroundY ** 0.56 - textY ** 0.57) * 1.14;
      return contrast < 0.1 ? 0 : (contrast - 0.027) * 100;
    }
    contrast = (backgroundY ** 0.65 - textY ** 0.62) * 1.14;
    return contrast > -0.1 ? 0 : (contrast + 0.027) * 100;
  }

  function rgbToOklch(value) {
    const red = srgbToLinear(value.r);
    const green = srgbToLinear(value.g);
    const blue = srgbToLinear(value.b);
    const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
    const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
    const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
    const lRoot = Math.cbrt(l);
    const mRoot = Math.cbrt(m);
    const sRoot = Math.cbrt(s);
    const lightness = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
    const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
    const b = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;
    const chroma = Math.sqrt(a * a + b * b);
    const hue = chroma < EPSILON ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
    return { l: lightness, c: chroma, h: hue };
  }

  function oklchToRawRgb(value) {
    const angle = value.h * Math.PI / 180;
    const a = value.c * Math.cos(angle);
    const b = value.c * Math.sin(angle);
    const lRoot = value.l + 0.3963377774 * a + 0.2158037573 * b;
    const mRoot = value.l - 0.1055613458 * a - 0.0638541728 * b;
    const sRoot = value.l - 0.0894841775 * a - 1.291485548 * b;
    const l = lRoot ** 3;
    const m = mRoot ** 3;
    const s = sRoot ** 3;
    return {
      r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
      a: 1
    };
  }

  function inSrgbGamut(value) {
    return value.r >= -EPSILON && value.r <= 1 + EPSILON
      && value.g >= -EPSILON && value.g <= 1 + EPSILON
      && value.b >= -EPSILON && value.b <= 1 + EPSILON;
  }

  function oklchToGamutRgb(value) {
    let candidate = oklchToRawRgb(value);
    if (inSrgbGamut(candidate)) return color(candidate.r, candidate.g, candidate.b);
    let low = 0;
    let high = Math.max(0, value.c);
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const chroma = (low + high) / 2;
      candidate = oklchToRawRgb({ l: value.l, c: chroma, h: value.h });
      if (inSrgbGamut(candidate)) low = chroma;
      else high = chroma;
    }
    candidate = oklchToRawRgb({ l: value.l, c: low, h: value.h });
    return color(candidate.r, candidate.g, candidate.b);
  }

  function toHex(value) {
    const byte = (channel) => Math.round(clamp(channel) * 255).toString(16).padStart(2, "0");
    return `#${byte(value.r)}${byte(value.g)}${byte(value.b)}`.toUpperCase();
  }

  function interpolateColor(first, second, amount) {
    const alpha = first.a + (second.a - first.a) * amount;
    if (alpha < EPSILON) return color(0, 0, 0, 0);
    const channel = (name) => (
      first[name] * first.a * (1 - amount) + second[name] * second.a * amount
    ) / alpha;
    return color(
      channel("r"),
      channel("g"),
      channel("b"),
      alpha
    );
  }

  function readColorToken(input) {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (trimmed[0] === "#") {
      const match = trimmed.match(/^#[0-9a-f]{3,8}/i);
      return match ? { token: match[0], rest: trimmed.slice(match[0].length).trim() } : null;
    }
    const functionMatch = trimmed.match(/^([a-z][a-z0-9-]*)\(/i);
    if (functionMatch) {
      let depth = 0;
      for (let index = 0; index < trimmed.length; index += 1) {
        if (trimmed[index] === "(") depth += 1;
        else if (trimmed[index] === ")") {
          depth -= 1;
          if (depth === 0) {
            return {
              token: trimmed.slice(0, index + 1),
              rest: trimmed.slice(index + 1).trim()
            };
          }
        }
      }
      return null;
    }
    const match = trimmed.match(/^[a-z]+/i);
    return match ? { token: match[0], rest: trimmed.slice(match[0].length).trim() } : null;
  }

  function parseStopPosition(token, size) {
    if (!token) return null;
    const value = parseFloat(token);
    if (!Number.isFinite(value)) return null;
    if (token.endsWith("%")) return value / 100;
    if (token.endsWith("px")) return size > EPSILON ? value / size : 0;
    return value;
  }

  function parseColorStop(input, size) {
    const read = readColorToken(input);
    if (!read) return null;
    const parsed = parseColor(read.token);
    if (!parsed) return null;
    const positions = read.rest ? read.rest.split(/\s+/) : [];
    return {
      color: parsed,
      position: parseStopPosition(positions[0], size)
    };
  }

  function normalizeStops(stops) {
    if (stops.length === 0) return stops;
    const normalized = stops.map((stop) => ({ ...stop }));
    if (normalized[0].position === null) normalized[0].position = 0;
    if (normalized[normalized.length - 1].position === null) {
      normalized[normalized.length - 1].position = 1;
    }
    for (let start = 0; start < normalized.length;) {
      if (normalized[start].position !== null) {
        start += 1;
        continue;
      }
      const previous = start - 1;
      let next = start;
      while (next < normalized.length && normalized[next].position === null) next += 1;
      const from = normalized[previous].position;
      const to = normalized[next].position;
      const count = next - previous;
      for (let offset = 1; offset < count; offset += 1) {
        normalized[previous + offset].position = from + (to - from) * offset / count;
      }
      start = next + 1;
    }
    for (let index = 1; index < normalized.length; index += 1) {
      normalized[index].position = Math.max(
        normalized[index - 1].position,
        normalized[index].position
      );
    }
    return normalized;
  }

  function colorAtStops(stops, position, repeating = false) {
    if (stops.length === 0) return null;
    const first = stops[0].position;
    const last = stops[stops.length - 1].position;
    let sample = position;
    if (repeating && last - first > EPSILON) {
      sample = ((position - first) % (last - first) + (last - first)) % (last - first) + first;
    }
    if (sample <= first) return stops[0].color;
    if (sample >= last) return stops[stops.length - 1].color;
    for (let index = 1; index < stops.length; index += 1) {
      if (sample <= stops[index].position) {
        const from = stops[index - 1];
        const to = stops[index];
        const span = to.position - from.position;
        const amount = span < EPSILON ? 1 : (sample - from.position) / span;
        return interpolateColor(from.color, to.color, amount);
      }
    }
    return stops[stops.length - 1].color;
  }

  function parseLinearDirection(token) {
    const value = token.trim().toLowerCase();
    if (value.startsWith("to ")) {
      const words = value.slice(3).split(/\s+/);
      let dx = 0;
      let dy = 0;
      if (words.includes("right")) dx += 1;
      if (words.includes("left")) dx -= 1;
      if (words.includes("bottom")) dy += 1;
      if (words.includes("top")) dy -= 1;
      const length = Math.hypot(dx, dy) || 1;
      return { dx: dx / length, dy: dy / length };
    }
    if (/^-?[\d.]+(?:deg|rad|grad|turn)$/.test(value)) {
      const radians = parseHue(value) * Math.PI / 180;
      return { dx: Math.sin(radians), dy: -Math.cos(radians) };
    }
    return null;
  }

  function linearGradientGeometry(input, rect) {
    const parts = splitTopLevel(input);
    let direction = { dx: 0, dy: 1 };
    const directionToken = (parts[0] || "").replace(/\s+in\s+[a-z0-9-]+\s*$/i, "");
    const parsedDirection = parseLinearDirection(directionToken);
    if (parsedDirection) {
      direction = parsedDirection;
      parts.shift();
    } else if (parts[0] && /^in\s+/i.test(parts[0])) {
      parts.shift();
    }
    const extent = Math.abs(direction.dx) * rect.width + Math.abs(direction.dy) * rect.height;
    const stops = normalizeStops(parts.map((part) => parseColorStop(part, extent)).filter(Boolean));
    return {
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      direction,
      extent,
      stops
    };
  }

  function sampleLinearGradient(input, rect, point, repeating) {
    const geometry = linearGradientGeometry(input, rect);
    const { centerX, centerY, direction, extent, stops } = geometry;
    if (stops.length < 2) return null;
    const projection = (point.x - centerX) * direction.dx + (point.y - centerY) * direction.dy;
    const position = extent < EPSILON ? 0.5 : 0.5 + projection / extent;
    return colorAtStops(stops, position, repeating);
  }

  function resolveAxisPosition(part, start, size, axis) {
    if (!part || part === "center") return start + size / 2;
    if ((axis === "x" && part === "left") || (axis === "y" && part === "top")) return start;
    if ((axis === "x" && part === "right") || (axis === "y" && part === "bottom")) {
      return start + size;
    }
    if (part.endsWith("%")) return start + parseFloat(part) / 100 * size;
    if (part.endsWith("px")) return start + parseFloat(part);
    return start + size / 2;
  }

  function resolveRadialCenter(positionText, rect) {
    const tokens = positionText.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    let horizontal = tokens[0];
    let vertical = tokens[1] || "center";
    if (/^(top|bottom)$/.test(horizontal)) {
      [horizontal, vertical] = [vertical, horizontal];
    }
    return {
      x: resolveAxisPosition(horizontal, rect.left, rect.width, "x"),
      y: resolveAxisPosition(vertical, rect.top, rect.height, "y")
    };
  }

  function resolveRadiusLength(token, percentBase) {
    if (!token) return null;
    const value = parseFloat(token);
    if (!Number.isFinite(value)) return null;
    if (token.endsWith("px") || /^-?[\d.]+$/.test(token)) return Math.max(EPSILON, value);
    if (token.endsWith("%")) return Math.max(EPSILON, value / 100 * percentBase);
    return null;
  }

  function cornerDistances(center, rect) {
    return [
      { x: rect.left, y: rect.top },
      { x: rect.left + rect.width, y: rect.top },
      { x: rect.left, y: rect.top + rect.height },
      { x: rect.left + rect.width, y: rect.top + rect.height }
    ].map((point) => ({
      x: Math.abs(point.x - center.x),
      y: Math.abs(point.y - center.y)
    }));
  }

  function keywordRadii(shape, keyword, center, rect) {
    const horizontal = [
      Math.abs(center.x - rect.left),
      Math.abs(rect.left + rect.width - center.x)
    ];
    const vertical = [
      Math.abs(center.y - rect.top),
      Math.abs(rect.top + rect.height - center.y)
    ];
    const corners = cornerDistances(center, rect);
    const closest = keyword.startsWith("closest");
    const corner = keyword.endsWith("corner");
    if (shape === "circle") {
      if (corner) {
        const distances = corners.map((value) => Math.hypot(value.x, value.y));
        const radius = closest ? Math.min(...distances) : Math.max(...distances);
        return { x: Math.max(radius, EPSILON), y: Math.max(radius, EPSILON) };
      }
      const distances = [...horizontal, ...vertical];
      const radius = closest ? Math.min(...distances) : Math.max(...distances);
      return { x: Math.max(radius, EPSILON), y: Math.max(radius, EPSILON) };
    }
    let radiusX = closest ? Math.min(...horizontal) : Math.max(...horizontal);
    let radiusY = closest ? Math.min(...vertical) : Math.max(...vertical);
    radiusX = Math.max(radiusX, EPSILON);
    radiusY = Math.max(radiusY, EPSILON);
    if (corner) {
      const scales = corners.map((value) => Math.hypot(value.x / radiusX, value.y / radiusY));
      const scale = closest ? Math.min(...scales) : Math.max(...scales);
      radiusX *= scale;
      radiusY *= scale;
    }
    return { x: radiusX, y: radiusY };
  }

  function parseRadialPrelude(token, rect) {
    const atMatch = token.match(/(?:^|\s)at\s+(.+)$/i);
    const center = resolveRadialCenter(atMatch ? atMatch[1] : "", rect);
    const sizeText = (atMatch ? token.slice(0, atMatch.index) : token).trim().toLowerCase();
    const tokens = sizeText.split(/\s+/).filter(Boolean);
    const shape = tokens.includes("circle") ? "circle" : "ellipse";
    const sizeTokens = tokens.filter((part) => part !== "circle" && part !== "ellipse");
    const keyword = sizeTokens.find((part) => /^(closest|farthest)-(side|corner)$/.test(part))
      || "farthest-corner";
    let radii;
    if (sizeTokens.length > 0 && resolveRadiusLength(sizeTokens[0], rect.width) !== null) {
      if (shape === "circle") {
        const radius = resolveRadiusLength(sizeTokens[0], Math.min(rect.width, rect.height));
        radii = { x: radius, y: radius };
      } else {
        radii = {
          x: resolveRadiusLength(sizeTokens[0], rect.width),
          y: resolveRadiusLength(sizeTokens[1] || sizeTokens[0], rect.height)
        };
      }
    } else {
      radii = keywordRadii(shape, keyword, center, rect);
    }
    return {
      centerX: center.x,
      centerY: center.y,
      radiusX: Math.max(radii.x, EPSILON),
      radiusY: Math.max(radii.y, EPSILON)
    };
  }

  function radialGradientGeometry(input, rect) {
    const parts = splitTopLevel(input);
    let geometry = parseRadialPrelude("", rect);
    const firstToken = parts[0] ? readColorToken(parts[0]) : null;
    const firstIsColor = firstToken && parseColor(firstToken.token);
    if (parts[0] && !firstIsColor) {
      geometry = parseRadialPrelude(parts.shift(), rect);
    }
    const scale = geometry.radiusX;
    const stops = normalizeStops(parts.map((part) => parseColorStop(part, scale)).filter(Boolean));
    return { ...geometry, stops };
  }

  function sampleRadialGradient(input, rect, point, repeating) {
    const geometry = radialGradientGeometry(input, rect);
    const { centerX, centerY, radiusX, radiusY, stops } = geometry;
    if (stops.length < 2) return null;
    const x = (point.x - centerX) / radiusX;
    const y = (point.y - centerY) / radiusY;
    return colorAtStops(stops, Math.sqrt(x * x + y * y), repeating);
  }

  function sampleGradient(value, rect, point) {
    const match = value.trim().match(
      /^(repeating-)?(linear|radial)-gradient\((.*)\)$/i
    );
    if (!match) return null;
    if (match[2].toLowerCase() === "linear") {
      return sampleLinearGradient(match[3], rect, point, Boolean(match[1]));
    }
    return sampleRadialGradient(match[3], rect, point, Boolean(match[1]));
  }

  function sampleBackgroundImages(value, rect, point) {
    if (!value || value === "none") return { color: null, unsupported: [] };
    const layers = splitTopLevel(value);
    let combined = color(0, 0, 0, 0);
    const unsupported = [];
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const sampled = sampleGradient(layers[index], rect, point);
      if (sampled) combined = composite(sampled, combined);
      else unsupported.push(layers[index].slice(0, 48));
    }
    return { color: combined.a > EPSILON ? combined : null, unsupported };
  }

  function elementRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
  }

  function closeOpacityGroups(value, frames) {
    let result = value;
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      const frame = frames[index];
      result = composite({ ...result, a: result.a * frame.opacity }, frame.outside);
    }
    return result;
  }

  function effectiveBackground(element, point, view, foreground = null) {
    const ancestors = [];
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      ancestors.push(current);
    }
    ancestors.reverse();
    let result = color(1, 1, 1);
    const opacityFrames = [];
    const unsupported = [];
    for (const ancestor of ancestors) {
      const style = view.getComputedStyle(ancestor);
      const opacity = clamp(parseFloat(style.opacity || "1"));
      if (opacity < 1) {
        opacityFrames.push({ outside: result, opacity });
        result = color(0, 0, 0, 0);
      }
      const backgroundColor = parseColor(style.backgroundColor) || color(0, 0, 0, 0);
      result = composite(backgroundColor, result);
      const images = sampleBackgroundImages(
        style.backgroundImage,
        elementRect(ancestor),
        point
      );
      if (images.color) result = composite(images.color, result);
      unsupported.push(...images.unsupported);
    }
    const groupBackground = result;
    const renderedBackground = closeOpacityGroups(groupBackground, opacityFrames);
    const renderForeground = (source) => closeOpacityGroups(
      composite(source, groupBackground),
      opacityFrames
    );
    return {
      color: renderedBackground,
      foreground: foreground ? renderForeground(foreground) : null,
      renderForeground,
      unsupported
    };
  }

  function rectangleCorners(rect) {
    return [
      { x: rect.left, y: rect.top },
      { x: rect.left + rect.width, y: rect.top },
      { x: rect.left, y: rect.top + rect.height },
      { x: rect.left + rect.width, y: rect.top + rect.height }
    ];
  }

  function criticalStopPositions(stops, minimum, maximum, repeating) {
    if (stops.length < 2 || maximum < minimum) return [];
    const first = stops[0].position;
    const last = stops[stops.length - 1].position;
    const period = last - first;
    let positions = [];
    if (repeating && period > EPSILON) {
      const firstCycle = Math.floor((minimum - last) / period);
      const lastCycle = Math.ceil((maximum - first) / period);
      for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
        positions.push(...stops.map((stop) => stop.position + cycle * period));
      }
    } else {
      positions = stops.map((stop) => stop.position);
    }
    positions.push(minimum, maximum);
    positions = Array.from(new Set(
      positions
        .filter((position) => position >= minimum - EPSILON && position <= maximum + EPSILON)
        .map((position) => round(clamp(position, minimum, maximum), 7))
    )).sort((firstPosition, secondPosition) => firstPosition - secondPosition);
    const samples = [...positions];
    for (let index = 1; index < positions.length; index += 1) {
      if (positions[index] - positions[index - 1] > EPSILON) {
        samples.push((positions[index] + positions[index - 1]) / 2);
      }
    }
    return samples;
  }

  function linearCriticalPoints(input, backgroundRect, textRect, repeating) {
    const geometry = linearGradientGeometry(input, backgroundRect);
    if (geometry.stops.length < 2 || geometry.extent < EPSILON) return [];
    const projected = rectangleCorners(textRect).map((point) => ({
      point,
      value: (point.x - geometry.centerX) * geometry.direction.dx
        + (point.y - geometry.centerY) * geometry.direction.dy
    })).sort((first, second) => first.value - second.value);
    const minimumPosition = 0.5 + projected[0].value / geometry.extent;
    const maximumPosition = 0.5 + projected[projected.length - 1].value / geometry.extent;
    const positions = criticalStopPositions(
      geometry.stops,
      minimumPosition,
      maximumPosition,
      repeating
    );
    const span = projected[projected.length - 1].value - projected[0].value;
    return positions.map((position) => {
      if (span < EPSILON) return projected[0].point;
      const desired = (position - 0.5) * geometry.extent;
      const amount = clamp((desired - projected[0].value) / span);
      return {
        x: projected[0].point.x
          + (projected[projected.length - 1].point.x - projected[0].point.x) * amount,
        y: projected[0].point.y
          + (projected[projected.length - 1].point.y - projected[0].point.y) * amount
      };
    });
  }

  function radialPosition(point, geometry) {
    return Math.hypot(
      (point.x - geometry.centerX) / geometry.radiusX,
      (point.y - geometry.centerY) / geometry.radiusY
    );
  }

  function radialCriticalPoints(input, backgroundRect, textRect, repeating) {
    const geometry = radialGradientGeometry(input, backgroundRect);
    if (geometry.stops.length < 2) return [];
    const closest = {
      x: clamp(geometry.centerX, textRect.left, textRect.left + textRect.width),
      y: clamp(geometry.centerY, textRect.top, textRect.top + textRect.height)
    };
    const corners = rectangleCorners(textRect)
      .map((point) => ({ point, value: radialPosition(point, geometry) }))
      .sort((first, second) => second.value - first.value);
    const minimumPosition = radialPosition(closest, geometry);
    const maximumPosition = corners[0].value;
    const positions = criticalStopPositions(
      geometry.stops,
      minimumPosition,
      maximumPosition,
      repeating
    );
    return positions.map((position) => {
      if (position <= minimumPosition + EPSILON) return closest;
      if (position >= maximumPosition - EPSILON) return corners[0].point;
      let low = 0;
      let high = 1;
      for (let iteration = 0; iteration < 32; iteration += 1) {
        const amount = (low + high) / 2;
        const candidate = {
          x: closest.x + (corners[0].point.x - closest.x) * amount,
          y: closest.y + (corners[0].point.y - closest.y) * amount
        };
        if (radialPosition(candidate, geometry) < position) low = amount;
        else high = amount;
      }
      return {
        x: closest.x + (corners[0].point.x - closest.x) * ((low + high) / 2),
        y: closest.y + (corners[0].point.y - closest.y) * ((low + high) / 2)
      };
    });
  }

  function gradientCriticalPoints(element, textRect, view) {
    const points = [];
    for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
      const style = view.getComputedStyle(current);
      const layers = splitTopLevel(style.backgroundImage || "none");
      const backgroundRect = elementRect(current);
      for (const layer of layers) {
        const match = layer.trim().match(
          /^(repeating-)?(linear|radial)-gradient\((.*)\)$/i
        );
        if (!match) continue;
        const critical = match[2].toLowerCase() === "linear"
          ? linearCriticalPoints(match[3], backgroundRect, textRect, Boolean(match[1]))
          : radialCriticalPoints(match[3], backgroundRect, textRect, Boolean(match[1]));
        points.push(...critical);
      }
    }
    return points;
  }

  function samplePoints(rect, element, view) {
    const longestSide = Math.max(rect.width, rect.height);
    const steps = Math.max(1, Math.min(128, Math.ceil(longestSide / 4)));
    const points = [];
    const seen = new Set();
    const add = (x, y) => {
      const key = `${round(x, 3)},${round(y, 3)}`;
      if (seen.has(key)) return;
      seen.add(key);
      points.push({ x, y });
    };
    for (let index = 0; index <= steps; index += 1) {
      const amount = index / steps;
      add(rect.left + rect.width * amount, rect.top + rect.height / 2);
      add(rect.left + rect.width / 2, rect.top + rect.height * amount);
      add(rect.left + rect.width * amount, rect.top + rect.height * amount);
      add(rect.left + rect.width * amount, rect.top + rect.height * (1 - amount));
    }
    gradientCriticalPoints(element, rect, view).forEach((point) => add(point.x, point.y));
    return points;
  }

  function wcagThreshold(style) {
    const fontSize = parseFloat(style.fontSize) || 16;
    const weightText = String(style.fontWeight || "400").toLowerCase();
    const weight = weightText === "bold" ? 700 : parseInt(weightText, 10) || 400;
    const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    return large ? 3 : 4.5;
  }

  function apcaThreshold(style) {
    const fontSize = parseFloat(style.fontSize) || 16;
    const weightText = String(style.fontWeight || "400").toLowerCase();
    const weight = weightText === "bold" ? 700 : parseInt(weightText, 10) || 400;
    if (fontSize >= 30 || (fontSize >= 24 && weight >= 600)) return 45;
    return 60;
  }

  function candidatePasses(candidate, backgrounds, wcagRequired, apcaRequired, renderers) {
    return backgrounds.every((background, index) => {
      const rendered = renderers ? renderers[index](candidate) : candidate;
      return contrastRatio(rendered, background) + EPSILON >= wcagRequired
        && Math.abs(apcaContrast(rendered, background)) + EPSILON >= apcaRequired;
    });
  }

  function suggestPassingColor(foreground, backgrounds, requirements = {}) {
    const wcagRequired = requirements.wcag || 4.5;
    const apcaRequired = requirements.apca || 60;
    const renderers = requirements.renderers || null;
    const origin = rgbToOklch(foreground);
    let best = null;
    for (let step = 0; step <= 1000; step += 1) {
      const distance = step / 1000;
      const lightnesses = step === 0
        ? [origin.l]
        : [origin.l - distance, origin.l + distance];
      for (const lightness of lightnesses) {
        if (lightness < 0 || lightness > 1) continue;
        const converted = oklchToGamutRgb({ l: lightness, c: origin.c, h: origin.h });
        const candidate = parseColor(toHex(converted));
        if (candidatePasses(candidate, backgrounds, wcagRequired, apcaRequired, renderers)) {
          const realized = rgbToOklch(candidate);
          const result = {
            color: candidate,
            hex: toHex(candidate),
            passes: true,
            lightnessDelta: Math.abs(realized.l - origin.l),
            chromaRetained: origin.c < EPSILON ? 1 : clamp(realized.c / origin.c),
            hue: origin.h
          };
          if (!best || result.chromaRetained > best.chromaRetained) best = result;
        }
      }
      if (best) return best;
    }
    const fallbacks = [color(0, 0, 0), color(1, 1, 1)];
    const scored = fallbacks.map((candidate) => {
      const rendered = backgrounds.map((background, index) => (
        renderers ? renderers[index](candidate) : candidate
      ));
      const ratios = backgrounds.map(
        (background, index) => contrastRatio(rendered[index], background) / wcagRequired
      );
      const apcas = backgrounds.map(
        (background, index) => Math.abs(apcaContrast(rendered[index], background)) / apcaRequired
      );
      return {
        color: candidate,
        score: Math.min(...ratios, ...apcas)
      };
    }).sort((first, second) => second.score - first.score);
    return {
      color: scored[0].color,
      hex: toHex(scored[0].color),
      passes: false,
      lightnessDelta: Math.abs(rgbToOklch(scored[0].color).l - origin.l),
      chromaRetained: 0,
      hue: origin.h
    };
  }

  function isAuditableTextNode(node, view) {
    if (!node || node.nodeType !== 3 || !node.nodeValue || !node.nodeValue.trim()) return false;
    const element = node.parentElement;
    if (!element || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|OPTION)$/i.test(element.tagName)) return false;
    const style = view.getComputedStyle(element);
    return style.display !== "none"
      && style.visibility !== "hidden"
      && parseFloat(style.opacity || "1") > 0;
  }

  function auditTextNode(node, documentObject) {
    const view = documentObject.defaultView;
    const element = node.parentElement;
    const style = view.getComputedStyle(element);
    const range = documentObject.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      }));
    if (typeof range.detach === "function") range.detach();
    if (rects.length === 0) return null;

    const foregroundSource = parseColor(style.color);
    if (!foregroundSource) return null;

    const backgrounds = [];
    const visibleForegrounds = [];
    const renderers = [];
    const unsupported = new Set();
    for (const rect of rects) {
      for (const point of samplePoints(rect, element, view)) {
        const sampled = effectiveBackground(element, point, view, foregroundSource);
        backgrounds.push(sampled.color);
        visibleForegrounds.push(sampled.foreground);
        renderers.push(sampled.renderForeground);
        sampled.unsupported.forEach((entry) => unsupported.add(entry));
      }
    }
    const ratios = visibleForegrounds.map(
      (foreground, index) => contrastRatio(foreground, backgrounds[index])
    );
    const apcas = visibleForegrounds.map(
      (foreground, index) => apcaContrast(foreground, backgrounds[index])
    );
    const minimumRatio = Math.min(...ratios);
    const minimumApca = Math.min(...apcas.map(Math.abs));
    const wcagRequired = wcagThreshold(style);
    const apcaRequired = apcaThreshold(style);
    if (minimumRatio + EPSILON >= wcagRequired && minimumApca + EPSILON >= apcaRequired) {
      return null;
    }
    const worstIndex = ratios.indexOf(minimumRatio);
    const apcaWorstIndex = apcas.map(Math.abs).indexOf(minimumApca);
    const suggestion = suggestPassingColor(
      foregroundSource,
      backgrounds,
      { wcag: wcagRequired, apca: apcaRequired, renderers }
    );
    return {
      node,
      element,
      text: node.nodeValue.trim().replace(/\s+/g, " ").slice(0, 100),
      rects,
      foreground: foregroundSource,
      foregroundHex: toHex(foregroundSource),
      worstBackground: backgrounds[worstIndex],
      worstBackgroundHex: toHex(backgrounds[worstIndex]),
      ratio: minimumRatio,
      apca: apcas[apcaWorstIndex],
      minimumApca,
      wcagRequired,
      apcaRequired,
      suggestedHex: suggestion.hex,
      suggestionPasses: suggestion.passes,
      suggestion,
      unsupported: Array.from(unsupported)
    };
  }

  function auditDocument(documentObject) {
    const view = documentObject.defaultView;
    const walker = documentObject.createTreeWalker(
      documentObject.body || documentObject.documentElement,
      view.NodeFilter.SHOW_TEXT
    );
    const failures = [];
    let visited = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!isAuditableTextNode(node, view)) continue;
      visited += 1;
      const failure = auditTextNode(node, documentObject);
      if (failure) failures.push(failure);
    }
    return { version: VERSION, visited, failures };
  }

  function removeOverlay(documentObject) {
    const previous = documentObject.getElementById(OVERLAY_ID);
    if (previous) previous.remove();
  }

  function renderOverlay(documentObject, report) {
    removeOverlay(documentObject);
    const host = documentObject.createElement("div");
    host.id = OVERLAY_ID;
    host.setAttribute("data-contrast-oracle", VERSION);
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    const shadow = host.attachShadow({ mode: "open" });
    const style = documentObject.createElement("style");
    style.textContent = [
      "*{box-sizing:border-box}",
      ".box{position:fixed;border:2px solid #ff2d55;background:rgba(255,45,85,.12)}",
      ".tag{position:absolute;left:-2px;bottom:100%;padding:3px 5px;background:#171717;color:#fff;",
      "font:700 11px/1.2 ui-monospace,monospace;white-space:nowrap;border-radius:3px 3px 0 0}",
      ".panel{position:fixed;right:12px;bottom:12px;max-width:360px;padding:12px 14px;",
      "border:1px solid #555;border-radius:8px;background:#111;color:#fff;",
      "box-shadow:0 8px 30px rgba(0,0,0,.35);font:13px/1.45 system-ui,sans-serif}",
      ".title{font-weight:750;font-size:14px}.muted{color:#bbb}.close{pointer-events:auto;float:right;",
      "border:0;border-radius:4px;background:#333;color:#fff;padding:2px 7px;cursor:pointer}"
    ].join("");
    shadow.appendChild(style);

    report.failures.forEach((failure, failureIndex) => {
      failure.rects.forEach((rect) => {
        const box = documentObject.createElement("div");
        box.className = "box";
        box.style.left = `${rect.left}px`;
        box.style.top = `${rect.top}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
        box.setAttribute("data-failure-index", String(failureIndex));
        const tag = documentObject.createElement("span");
        tag.className = "tag";
        const qualifier = failure.suggestionPasses ? "" : " best";
        tag.textContent = `${round(failure.ratio, 2)}:1 · Lc ${round(failure.apca, 1)} · ${failure.suggestedHex}${qualifier}`;
        box.appendChild(tag);
        shadow.appendChild(box);
      });
    });

    const panel = documentObject.createElement("section");
    panel.className = "panel";
    const close = documentObject.createElement("button");
    close.className = "close";
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => host.remove());
    const title = documentObject.createElement("div");
    title.className = "title";
    title.textContent = `Contrast Oracle: ${report.failures.length} failure${report.failures.length === 1 ? "" : "s"}`;
    const details = documentObject.createElement("div");
    details.className = "muted";
    details.textContent = `${report.visited} visible text nodes checked. Labels show WCAG ratio, APCA Lc, and the nearest passing OKLCH-derived hex.`;
    panel.append(close, title, details);
    shadow.appendChild(panel);
    (documentObject.body || documentObject.documentElement).appendChild(host);
    return host;
  }

  function serializableReport(report) {
    return {
      version: report.version,
      visited: report.visited,
      failures: report.failures.map((failure) => ({
        text: failure.text,
        foregroundHex: failure.foregroundHex,
        worstBackgroundHex: failure.worstBackgroundHex,
        ratio: round(failure.ratio),
        apca: round(failure.apca),
        minimumApca: round(failure.minimumApca),
        wcagRequired: failure.wcagRequired,
        apcaRequired: failure.apcaRequired,
        suggestedHex: failure.suggestedHex,
        suggestionPasses: failure.suggestionPasses,
        unsupported: failure.unsupported
      }))
    };
  }

  function run(options = {}) {
    const documentObject = options.document || (
      typeof document === "object" ? document : null
    );
    if (!documentObject) throw new Error("Contrast Oracle needs a browser document.");
    const report = auditDocument(documentObject);
    if (options.render !== false) renderOverlay(documentObject, report);
    return report;
  }

  return {
    VERSION,
    apcaContrast,
    auditDocument,
    auditTextNode,
    color,
    composite,
    contrastRatio,
    effectiveBackground,
    parseColor,
    removeOverlay,
    renderOverlay,
    rgbToOklch,
    run,
    sampleBackgroundImages,
    sampleGradient,
    serializableReport,
    suggestPassingColor,
    toHex,
    wcagThreshold
  };
});

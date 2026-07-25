"use strict";

function computedStyle(overrides = {}) {
  return {
    backgroundColor: "rgba(0, 0, 0, 0)",
    backgroundImage: "none",
    color: "rgb(0, 0, 0)",
    display: "block",
    visibility: "visible",
    opacity: "1",
    fontSize: "16px",
    fontWeight: "400",
    ...overrides
  };
}

class FakeElement {
  constructor(documentObject, tagName, options = {}) {
    this.ownerDocument = documentObject;
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.className = "";
    this.id = options.id || "";
    this.attributes = {};
    this.style = {};
    this.computedStyle = computedStyle(options.computedStyle);
    this.rect = options.rect || { left: 0, top: 0, width: 1000, height: 800 };
    this.shadowRoot = null;
    this.textContent = "";
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  attachShadow() {
    this.shadowRoot = new FakeElement(this.ownerDocument, "shadow-root");
    return this.shadowRoot;
  }

  addEventListener() {}

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "id") this.id = String(value);
  }

  getBoundingClientRect() {
    return { ...this.rect };
  }

  querySelectorAll(selector) {
    const matches = [];
    const className = selector.startsWith(".") ? selector.slice(1) : null;
    const visit = (element) => {
      if (className && String(element.className).split(/\s+/).includes(className)) {
        matches.push(element);
      }
      element.children.forEach(visit);
      if (element.shadowRoot) visit(element.shadowRoot);
    };
    this.children.forEach(visit);
    return matches;
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }
}

class FakeText {
  constructor(value, parentElement, rect) {
    this.nodeType = 3;
    this.nodeValue = value;
    this.parentElement = parentElement;
    this.rect = rect;
  }
}

class FakeDocument {
  constructor() {
    this.defaultView = {
      NodeFilter: { SHOW_TEXT: 4 },
      getComputedStyle: (element) => element.computedStyle
    };
    this.documentElement = new FakeElement(this, "html", {
      computedStyle: {
        backgroundColor: "rgb(255, 255, 255)"
      }
    });
    this.body = new FakeElement(this, "body");
    this.documentElement.appendChild(this.body);
    this.textNodes = [];
  }

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }

  createRange() {
    let selected = null;
    return {
      selectNodeContents(node) {
        selected = node;
      },
      getClientRects() {
        return selected ? [{ ...selected.rect }] : [];
      },
      detach() {}
    };
  }

  createTreeWalker() {
    let index = -1;
    return {
      nextNode: () => {
        index += 1;
        return this.textNodes[index] || null;
      }
    };
  }

  getElementById(id) {
    let found = null;
    const visit = (element) => {
      if (element.id === id) {
        found = element;
        return;
      }
      for (const child of element.children) {
        if (!found) visit(child);
      }
    };
    visit(this.documentElement);
    return found;
  }
}

function makeGradientFixture() {
  const documentObject = new FakeDocument();
  const target = new FakeElement(documentObject, "div", {
    id: "gradient",
    rect: { left: 20, top: 20, width: 900, height: 84 },
    computedStyle: {
      backgroundColor: "rgb(255, 255, 255)",
      backgroundImage: "linear-gradient(90deg, rgb(255, 255, 255) 0%, rgb(255, 255, 255) 50%, rgb(221, 221, 221) 100%)",
      color: "rgb(112, 112, 112)",
      fontSize: "16px",
      fontWeight: "400"
    }
  });
  documentObject.body.appendChild(target);
  const text = new FakeText(
    "Gradient edge contrast regression fixture",
    target,
    { left: 650, top: 50, width: 250, height: 24 }
  );
  documentObject.textNodes.push(text);
  return { document: documentObject, target, text };
}

module.exports = {
  FakeDocument,
  FakeElement,
  FakeText,
  computedStyle,
  makeGradientFixture
};

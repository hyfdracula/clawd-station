const BLOCK_GLYPH_RE = /[\u2580-\u259f]/;
const BLOCK_ART_TEXT_RE = /^[\u2580-\u259f\s]+$/;
const OVERLAY_CLASS = "clawd-block-overlay";
const CELL_CLASS = "clawd-block-cell";
const FRAGMENT_CLASS = "clawd-block-fragment";

type BlockFragment = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function isTerminalBlockArtText(text: string) {
  return BLOCK_GLYPH_RE.test(text) && BLOCK_ART_TEXT_RE.test(text);
}

export function getBlockGlyphFragments(glyph: string): BlockFragment[] {
  switch (glyph) {
    case "█":
      return [{ left: 0, top: 0, width: 1, height: 1 }];
    case "▌":
      return [{ left: 0, top: 0, width: 0.5, height: 1 }];
    case "▐":
      return [{ left: 0.5, top: 0, width: 0.5, height: 1 }];
    case "▀":
      return [{ left: 0, top: 0, width: 1, height: 0.5 }];
    case "▄":
      return [{ left: 0, top: 0.5, width: 1, height: 0.5 }];
    case "▘":
      return [{ left: 0, top: 0, width: 0.62, height: 0.58 }];
    case "▝":
      return [{ left: 0.38, top: 0, width: 0.62, height: 0.58 }];
    case "▖":
      return [{ left: 0, top: 0.42, width: 0.62, height: 0.58 }];
    case "▗":
      return [{ left: 0.38, top: 0.42, width: 0.62, height: 0.58 }];
    case "▛":
      return [
        { left: 0, top: 0, width: 1, height: 0.5 },
        { left: 0, top: 0.5, width: 0.5, height: 0.5 }
      ];
    case "▜":
      return [
        { left: 0, top: 0, width: 1, height: 0.5 },
        { left: 0.5, top: 0.5, width: 0.5, height: 0.5 }
      ];
    case "▙":
      return [
        { left: 0, top: 0, width: 0.5, height: 0.5 },
        { left: 0, top: 0.5, width: 1, height: 0.5 }
      ];
    case "▟":
      return [
        { left: 0.5, top: 0, width: 0.5, height: 0.5 },
        { left: 0, top: 0.5, width: 1, height: 0.5 }
      ];
    default:
      return [];
  }
}

function getRenderedText(element: HTMLElement) {
  const overlay = element.querySelector(`:scope > .${OVERLAY_CLASS}`);
  if (overlay && element.dataset.clawdBlockText) {
    return element.dataset.clawdBlockText;
  }
  return element.textContent ?? "";
}

function createBlockOverlay(document: Document, text: string) {
  const overlay = document.createElement("span");
  overlay.className = OVERLAY_CLASS;
  overlay.setAttribute("aria-hidden", "true");

  for (const glyph of text) {
    const cell = document.createElement("span");
    cell.className = CELL_CLASS;

    for (const fragment of getBlockGlyphFragments(glyph)) {
      const part = document.createElement("span");
      part.className = FRAGMENT_CLASS;
      part.style.left = `${fragment.left * 100}%`;
      part.style.top = `${fragment.top * 100}%`;
      part.style.width = `${fragment.width * 100}%`;
      part.style.height = `${fragment.height * 100}%`;
      cell.appendChild(part);
    }

    overlay.appendChild(cell);
  }

  return overlay;
}

function applyBlockArtOverlay(element: HTMLElement, text: string) {
  if (element.dataset.clawdBlockText === text && element.querySelector(`:scope > .${OVERLAY_CLASS}`)) {
    return;
  }

  const color = getComputedStyle(element).color;
  element.querySelector(`:scope > .${OVERLAY_CLASS}`)?.remove();
  element.dataset.clawdBlockText = text;
  element.style.setProperty("--clawd-block-color", color);
  element.classList.add("clawd-block-art");
  element.appendChild(createBlockOverlay(element.ownerDocument, text));
}

function clearBlockArtOverlay(element: HTMLElement) {
  element.querySelector(`:scope > .${OVERLAY_CLASS}`)?.remove();
  element.classList.remove("clawd-block-art");
  element.style.removeProperty("--clawd-block-color");
  delete element.dataset.clawdBlockText;
}

export function markTerminalBlockArt(root: ParentNode) {
  root.querySelectorAll(".xterm-rows span").forEach((node) => {
    const element = node as HTMLElement;
    const text = getRenderedText(element);
    if (isTerminalBlockArtText(text)) {
      applyBlockArtOverlay(element, text);
    } else {
      clearBlockArtOverlay(element);
    }
  });
}

export function installTerminalBlockArtSmoothing(root: ParentNode) {
  const rows = root.querySelector(".xterm-rows");
  if (!rows) return () => {};

  markTerminalBlockArt(root);
  const observer = new MutationObserver(() => markTerminalBlockArt(root));
  observer.observe(rows, {
    childList: true,
    characterData: true,
    subtree: true
  });

  return () => observer.disconnect();
}
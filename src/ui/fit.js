// R15 (review15 P10): shrink-to-fit before ellipsis. A label that overflows its box is stepped down in font size (to
// `min` of its computed size) until it fits; only then does the CSS ellipsis get the last word. Pure DOM, no deps, so
// the campaign shell (no three.js) and the battle HUD share it. fitText(el | NodeList | selector-in-root).
export function fitText(els, { min = 0.72, step = 0.06 } = {}) {
  const list = typeof els === 'string' ? document.querySelectorAll(els) : els?.forEach ? els : els ? [els] : [];
  list.forEach((el) => {
    el.style.fontSize = ''; if (!el.isConnected || el.clientWidth === 0 || el.scrollWidth <= el.clientWidth + 1) return;
    const base = parseFloat(getComputedStyle(el).fontSize) || 16;
    for (let k = 1 - step; k >= min - 1e-6; k -= step) { el.style.fontSize = `${(base * k).toFixed(1)}px`; if (el.scrollWidth <= el.clientWidth + 1) return; }
  });
}

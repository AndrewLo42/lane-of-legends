/**
 * Instant tooltips for everything with a `title` (augment and item chips, spells, portraits, ...).
 * The browser's own tooltip waits about a second; this one shows the moment the pointer arrives and
 * follows it. The `title` is moved to `data-title` on first hover so the native one never appears too.
 * "Name: description" text gets the name in bold, like the ability tooltips.
 */
export function installHoverTips() {
  const tip = document.createElement('div');
  tip.id = 'hovertip';
  document.body.appendChild(tip);
  let current: HTMLElement | null = null;

  const place = (x: number, y: number) => {
    const pad = 12;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    // Below-right of the pointer, flipped to stay on screen.
    const left = x + 16 + w + pad > innerWidth ? x - 12 - w : x + 16;
    const top = y + 18 + h + pad > innerHeight ? y - 10 - h : y + 18;
    tip.style.transform = `translate(${Math.max(pad, left)}px, ${Math.max(pad, top)}px)`;
  };

  const show = (el: HTMLElement, x: number, y: number) => {
    const text = el.dataset.title ?? '';
    if (!text) return hide();
    current = el;
    tip.replaceChildren();
    const colon = text.indexOf(': ');
    if (colon > 0 && colon < 40) {
      const b = document.createElement('b');
      b.textContent = text.slice(0, colon);
      tip.append(b, document.createElement('br'), text.slice(colon + 2));
    } else {
      tip.textContent = text;
    }
    tip.style.display = 'block';
    place(x, y);
  };

  const hide = () => {
    current = null;
    tip.style.display = 'none';
  };

  addEventListener('mouseover', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[title], [data-title]');
    if (!el) return hide();
    if (el.hasAttribute('title')) {
      // Take the text over: an empty title would still let some browsers show an empty native tip.
      el.dataset.title = el.getAttribute('title') ?? '';
      el.removeAttribute('title');
    }
    if (el !== current) show(el, e.clientX, e.clientY);
  });
  addEventListener('mousemove', (e) => {
    if (!current) return;
    // Re-rendered UI (the HUD rebuilds its chips) can remove the hovered element from under the pointer.
    if (!current.isConnected) return hide();
    place(e.clientX, e.clientY);
  });
  addEventListener('mousedown', hide);
  addEventListener('blur', hide);
}

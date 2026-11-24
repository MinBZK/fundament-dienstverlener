// Sjabloon voor de fieldlab-beschikking (zelfde werkwijze als testbijlage.ts).
// - Laadt het designsysteem en zet het rijkslogo (uit het pakket zelf) bovenaan.
// - Meet elke plek met data-plek, waar de mock later een gegeven invult, en zet
//   ze als JSON in de documenttitel. Bij afdrukken wordt dat de titel van de PDF;
//   beschikking.ts leest hem daar uit en zet daarna een gewone titel.
import '@nldd/design-system';
import '@nldd/design-system/styles';
import logo from '../node_modules/@nldd/design-system/dist/components/navigation/top-navigation-bar/logo.js';

const logoPlek = document.querySelector<HTMLElement>('#logo');
if (logoPlek) logoPlek.innerHTML = logo;

await customElements.whenDefined('nldd-rich-text');
await document.fonts.ready;
await new Promise((klaar) => requestAnimationFrame(() => requestAnimationFrame(klaar)));

// Kleur omrekenen naar RGB (0-1), want de PDF kent geen oklch.
function naarRgb(kleur: string): [number, number, number] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [0, 0, 0];
  ctx.fillStyle = kleur;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

const pxNaarPt = 0.75; // 1 CSS-pixel = 0,75 punt
const plekken: Record<string, unknown> = {};
for (const span of document.querySelectorAll<HTMLElement>('[data-plek]')) {
  const rect = span.getBoundingClientRect();
  const stijl = getComputedStyle(span.parentElement ?? span);
  plekken[span.dataset.plek ?? ''] = {
    x: Math.round(rect.left * pxNaarPt * 100) / 100,
    basislijnVanafBoven: Math.round((rect.top + window.scrollY) * pxNaarPt * 100) / 100,
    grootte: parseFloat(stijl.fontSize) * pxNaarPt,
    kleur: naarRgb(stijl.color).map((w) => Math.round(w * 1000) / 1000),
  };
}
document.title = JSON.stringify({ sjabloon: 'beschikking', plekken });

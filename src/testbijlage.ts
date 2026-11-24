// Sjabloon voor de testbijlage.
// - Laadt het designsysteem en zet het rijkslogo (uit het pakket zelf) bovenaan.
// - Meet de plek waar de mock later de tijd van aanmaken invult, en zet die
//   in de documenttitel. Bij afdrukken wordt dat de titel van de PDF; de mock
//   leest hem daar uit en zet daarna weer een gewone titel.
import '@nldd/design-system';
import '@nldd/design-system/styles';
import logo from '../node_modules/@nldd/design-system/dist/components/navigation/top-navigation-bar/logo.js';

const plek = document.querySelector<HTMLElement>('#logo');
if (plek) plek.innerHTML = logo;

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

const tijd = document.querySelector<HTMLElement>('#tijd');
if (tijd) {
  const rect = tijd.getBoundingClientRect();
  const stijl = getComputedStyle(tijd.parentElement ?? tijd);
  const pxNaarPt = 0.75; // 1 CSS-pixel = 0,75 punt
  document.title = JSON.stringify({
    sjabloon: 'testbijlage',
    x: rect.left * pxNaarPt,
    basislijnVanafBoven: (rect.top + window.scrollY) * pxNaarPt,
    grootte: parseFloat(stijl.fontSize) * pxNaarPt,
    kleur: naarRgb(stijl.color),
  });
}

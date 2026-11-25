// Gedeelde hulpjes voor de nagebootste procesapplicatie (ondernemer en medewerker).
// Gemaakt met ondersteuning van AI (concept).

export const $ = (id) => document.getElementById(id);
export const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
export const tijd = (d) => d.toLocaleTimeString('nl-NL');
export const euro = (n) => Number(n).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });
export const datumTijd = (iso) => new Date(iso).toLocaleString('nl-NL', { dateStyle: 'long', timeStyle: 'short' });

// Ingebouwd in de presentatie: alleen de kern tonen
if (new URLSearchParams(location.search).has('ingebed')) document.documentElement.classList.add('ingebed');

// "1.250,00", "1250,5" en "1250" worden 1250.00, 1250.50 en 1250.
export function leesBedrag(tekst) {
  const schoon = String(tekst).replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  return /^\d+(\.\d{1,2})?$/.test(schoon) ? Number(schoon) : NaN;
}

export async function post(pad, body) {
  const a = await fetch(pad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: a.status, body: await a.json().catch(() => undefined) };
}

export function melding(el, soort, titel, tekst) {
  el.className = 'melding' + (soort === 'goed' ? ' melding--goed' : soort === 'fout' ? ' melding--fout' : '');
  el.querySelector('.melding__ic').textContent = soort === 'goed' ? '✓' : soort === 'fout' ? '!' : 'i';
  el.querySelector('strong').textContent = titel;
  el.querySelector('p').textContent = tekst;
  el.hidden = false;
}

// Uitkomst van een aanroep via de server van de mock, als melding (zoals scenario.html)
export function toonUitkomst(el, gelukt, mislukt, dienst, uitkomst) {
  const nu = tijd(new Date());
  const body = uitkomst.body ?? {};
  if (uitkomst.status >= 400 || (!body.antwoord && !body.fout)) return melding(el, 'fout', `${mislukt} · ${nu}`, body.fout ?? `De mock gaf ${uitkomst.status}.`);
  if (body.fout) return melding(el, 'fout', `${mislukt} · ${nu}`, `${dienst} is niet bereikbaar: ${body.fout}`);
  const { status, body: antwoord } = body.antwoord;
  const via = body.verzoek?.via === 'direct' ? 'zonder FSC' : 'met FSC';
  if (status >= 400) {
    const uitleg = antwoord?.detail ?? antwoord?.title ?? (status === 404 ? 'De ingang van het cluster laat plaatsen (/api/v1/aanleveringen) nog niet door.' : '');
    return melding(el, 'fout', `${mislukt} · ${nu}`, `${dienst} antwoordde ${status} (${via}). ${uitleg}`.trim());
  }
  const nummer = antwoord?.berichtId ?? antwoord?.notificatieId ?? antwoord?.id;
  melding(el, 'goed', `${gelukt} · ${nu}`, `${dienst} antwoordde ${status}.${nummer ? ` Kenmerk: ${nummer}.` : ''}`);
}

export async function bezig(knop, actie) {
  if (knop.getAttribute('aria-busy') === 'true') return;
  knop.setAttribute('aria-busy', 'true');
  try { await actie(); } finally { knop.removeAttribute('aria-busy'); }
}

// De aangifte gaat van het ondernemersscherm naar de werklijst (zelfde browser)
const SLEUTEL = 'fieldlab-aangifte';
export function bewaarAangifte(a) { try { localStorage.setItem(SLEUTEL, JSON.stringify(a)); } catch { /* geen opslag: dan de testwaarden */ } }
export function leesAangifte() { try { return JSON.parse(localStorage.getItem(SLEUTEL) || 'null'); } catch { return null; } }

export function ontbreekt(i, d) {
  if (d.modus === 'fsc') { if (!i.outwayAdres) return 'het adres van de eigen Outway'; if (!d.grantHash) return 'de grant-hash'; return undefined; }
  return d.directAdres ? undefined : 'het adres';
}

// Scenario btw-aangifte: aangifte doen → automatische verwerking → fieldlab-beschikking →
// plaatsen in het magazijn van de Belastingdienst. De notificatie is een losse stap.
// De verwerking is nagebootst: de mock keurt elke aangifte goed.

import { bijVersturen, element, haalInstellingen, ontbreekt, waarde } from './gedeeld.ts';

type Uitkomst = {
  verzoek?: { via?: string };
  antwoord?: { status: number; body: unknown };
  fout?: string;
};

type Aangifte = { kvk: string; tijdvak: string; bedrag: number; ontvangenOp: string; beslotenOp: string };

let aangifte: Aangifte | undefined;

const wacht = (ms: number) => new Promise((klaar) => setTimeout(klaar, ms));
const tijd = (moment: Date) => moment.toLocaleTimeString('nl-NL');

async function post(pad: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const antwoord = await fetch(pad, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: antwoord.status, body: await antwoord.json().catch(() => undefined) };
}

function zetMelding(melding: HTMLElement, variant: string, tekst: string, uitleg: string): void {
  melding.setAttribute('variant', variant);
  melding.setAttribute('text', tekst);
  melding.setAttribute('supporting-text', uitleg);
  melding.hidden = false;
}

// Zet de uitkomst van een aanroep (via de server van de mock) om in een melding.
function toonUitkomst(melding: HTMLElement, gelukt: string, mislukt: string, dienst: string, uitkomst: { status: number; body: unknown }): void {
  const nu = tijd(new Date());
  const body = (uitkomst.body ?? {}) as Uitkomst & { fout?: string };
  if (uitkomst.status >= 400 || (!body.antwoord && !body.fout)) {
    zetMelding(melding, 'critical', `${mislukt} · ${nu}`, body.fout ?? `De mock gaf ${uitkomst.status}.`);
    return;
  }
  if (body.fout) {
    zetMelding(melding, 'critical', `${mislukt} · ${nu}`, `${dienst} is niet bereikbaar: ${body.fout}`);
    return;
  }
  const { status, body: antwoord } = body.antwoord!;
  const via = body.verzoek?.via === 'direct' ? 'zonder FSC' : 'met FSC';
  if (status >= 400) {
    const reden = antwoord as { detail?: string; title?: string } | undefined;
    // Een kale 404 komt van de ingang van het cluster, niet van het magazijn zelf.
    const uitleg =
      reden?.detail ??
      reden?.title ??
      (status === 404 ? 'De ingang van het cluster laat plaatsen (/api/v1/aanleveringen) nog niet door.' : '');
    zetMelding(melding, 'critical', `${mislukt} · ${nu}`, `${dienst} antwoordde ${status} (${via}). ${uitleg}`.trim());
    return;
  }
  const kenmerk = antwoord as { id?: string; berichtId?: string; notificatieId?: string } | undefined;
  const nummer = kenmerk?.berichtId ?? kenmerk?.notificatieId ?? kenmerk?.id;
  zetMelding(melding, 'success', `${gelukt} · ${nu}`, `${dienst} antwoordde ${status} (${via}).${nummer ? ` Kenmerk: ${nummer}.` : ''}`);
}

// Laadteken in de knop zolang de actie loopt.
async function metLaadteken(knop: HTMLElement | null, actie: () => Promise<void>): Promise<void> {
  if (knop?.hasAttribute('loading')) return;
  knop?.setAttribute('loading', '');
  try {
    await actie();
  } finally {
    knop?.removeAttribute('loading');
  }
}

// --- Stap 1: aangifte ----------------------------------------------------

const formAangifte = element<HTMLElement>('#form-aangifte');
const foutAangifte = element<HTMLElement>('#fout-aangifte');

// "1.250,00", "1250,5" en "1250" worden 1250.00, 1250.50 en 1250.
function leesBedrag(tekst: string): number {
  const schoon = tekst.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  return /^\d+(\.\d{1,2})?$/.test(schoon) ? Number(schoon) : NaN;
}

// --- Stap 2: verwerking --------------------------------------------------

const verwerking = element<HTMLElement>('#verwerking');

function verwerkingsstap(titel: string): { klaar: (moment: Date) => void } {
  const item = document.createElement('nldd-list-item');
  const cel = document.createElement('nldd-title-cell');
  cel.setAttribute('text', titel);
  cel.setAttribute('supporting-text', 'Bezig…');
  const badgeCel = document.createElement('nldd-cell');
  badgeCel.setAttribute('horizontal-alignment', 'end');
  const badge = document.createElement('nldd-badge');
  badge.setAttribute('text', 'Bezig');
  badge.setAttribute('color', 'accent');
  badgeCel.append(badge);
  item.append(cel, badgeCel);
  verwerking.append(item);
  return {
    klaar(moment) {
      cel.setAttribute('supporting-text', tijd(moment));
      badge.setAttribute('text', 'Klaar');
      badge.setAttribute('color', 'success');
    },
  };
}

async function verwerk(ontvangenOp: Date): Promise<Date> {
  verwerking.replaceChildren();
  element<HTMLElement>('#stap-verwerking').hidden = false;
  verwerkingsstap('Aangifte ontvangen').klaar(ontvangenOp);
  const controle = verwerkingsstap('Aangifte gecontroleerd');
  await wacht(900);
  controle.klaar(new Date());
  const besluit = verwerkingsstap('Besluit genomen: goedgekeurd');
  await wacht(900);
  const beslotenOp = new Date();
  besluit.klaar(beslotenOp);
  return beslotenOp;
}

// --- Stap 3 en 4: beschikking en plaatsen --------------------------------

function toonBeschikking(gegevens: Aangifte): void {
  const vraag = new URLSearchParams({ ...gegevens, bedrag: String(gegevens.bedrag) });
  element<HTMLElement>('#link-beschikking').setAttribute('href', `/api/scenario/beschikking?${vraag}`);
  element<HTMLElement>('#plaatsen-kvk').textContent = gegevens.kvk;
  element<HTMLElement>('#uitkomst-plaatsen').hidden = true;
  element<HTMLElement>('#stap-beschikking').hidden = false;
  element<HTMLElement>('#stap-plaatsen').hidden = false;
}

bijVersturen(formAangifte, async () => {
  const kvk = waarde(formAangifte, 'kvk').trim();
  const tijdvak = waarde(formAangifte, 'tijdvak').trim();
  const bedrag = leesBedrag(waarde(formAangifte, 'bedrag'));
  foutAangifte.hidden = true;
  if (!/^\d{8}$/.test(kvk) || !tijdvak || Number.isNaN(bedrag)) {
    foutAangifte.setAttribute(
      'supporting-text',
      !/^\d{8}$/.test(kvk) ? 'Een KVK-nummer heeft 8 cijfers.' : !tijdvak ? 'Vul een tijdvak in.' : 'Vul een bedrag in, bijvoorbeeld 1250,00.',
    );
    foutAangifte.hidden = false;
    return;
  }
  await metLaadteken(formAangifte.querySelector('nldd-button[type="submit"]'), async () => {
    element<HTMLElement>('#stap-beschikking').hidden = true;
    element<HTMLElement>('#stap-plaatsen').hidden = true;
    const ontvangenOp = new Date();
    const beslotenOp = await verwerk(ontvangenOp);
    aangifte = { kvk, tijdvak, bedrag, ontvangenOp: ontvangenOp.toISOString(), beslotenOp: beslotenOp.toISOString() };
    toonBeschikking(aangifte);
  });
});

const knopPlaatsen = element<HTMLElement>('#knop-plaatsen');
knopPlaatsen.addEventListener('click', () =>
  void metLaadteken(knopPlaatsen, async () => {
    if (!aangifte) return;
    const melding = element<HTMLElement>('#uitkomst-plaatsen');
    melding.hidden = true;
    try {
      const uitkomst = await post('/api/scenario/plaatsen', aangifte);
      toonUitkomst(melding, 'Beschikking geplaatst', 'Beschikking niet geplaatst', 'Het magazijn van de Belastingdienst', uitkomst);
    } catch (e) {
      zetMelding(melding, 'critical', 'De mock zelf reageert niet', e instanceof Error ? e.message : String(e));
    }
  }),
);

// Naar de Portaal-mock, ingelogd als de ondernemer, kijkend in het magazijn van de Belastingdienst.
element<HTMLElement>('#knop-portaal').addEventListener('click', () => {
  if (aangifte) localStorage.setItem('portaal-ontvanger', `KVK:${aangifte.kvk}`);
  window.open('/portaal.html?magazijn=bld', '_blank');
});

// --- Stap 5: notificatie (los) -------------------------------------------

const formNotificatie = element<HTMLElement>('#form-notificatie');
bijVersturen(formNotificatie, async () => {
  const voornaam = waarde(formNotificatie, 'voornaam').trim();
  const emailAdres = waarde(formNotificatie, 'emailAdres').trim();
  if (!voornaam || !emailAdres) return;
  const melding = element<HTMLElement>('#uitkomst-notificatie');
  melding.hidden = true;
  await metLaadteken(formNotificatie.querySelector('nldd-button[type="submit"]'), async () => {
    try {
      // Het Demo template van NotifyNL vraagt om een voornaam (berichtgegevens.voornaam).
      const uitkomst = await post('/api/notificatie', { emailAdres, berichtType: 'Demo template', berichtgegevens: `voornaam: ${voornaam}` });
      toonUitkomst(melding, 'Notificatie verstuurd', 'Notificatie niet verstuurd', 'De NMC', uitkomst);
    } catch (e) {
      zetMelding(melding, 'critical', 'De mock zelf reageert niet', e instanceof Error ? e.message : String(e));
    }
  });
});

for (const melding of document.querySelectorAll<HTMLElement>('[id^="uitkomst-"]')) {
  melding.addEventListener('dismiss', () => (melding.hidden = true));
}

// --- Start: laat zien waar het scenario naartoe stuurt ---------------------

const [scenario, instellingen] = await Promise.all([
  fetch('/api/scenario').then((a) => a.json() as Promise<{ modus: string; adres: string; ontbreekt?: string }>),
  haalInstellingen(),
]);
element<HTMLElement>('#bld-modus').textContent = scenario.ontbreekt
  ? 'Nog niet ingesteld'
  : scenario.modus === 'fsc'
    ? 'Met FSC, via de eigen Outway'
    : 'Zonder FSC';
element<HTMLElement>('#bld-adres').textContent = scenario.ontbreekt ? `${scenario.ontbreekt} ontbreekt` : scenario.adres;

const nmcMist = ontbreekt(instellingen, instellingen.nmc);
element<HTMLElement>('#nmc-modus').textContent = nmcMist
  ? 'Nog niet ingesteld'
  : instellingen.nmc.modus === 'fsc'
    ? 'Met FSC, via de eigen Outway'
    : 'Zonder FSC';
element<HTMLElement>('#nmc-adres').textContent = nmcMist
  ? `${nmcMist} ontbreekt`
  : instellingen.nmc.modus === 'fsc'
    ? instellingen.outwayAdres
    : instellingen.nmc.directAdres;

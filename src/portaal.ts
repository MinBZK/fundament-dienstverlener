// Portaal-mock: laat zien wat een ondernemer of burger in het berichtenmagazijn heeft staan.
// De pagina vraagt alles aan de eigen server (/api/portaal/...), die het bij het magazijn ophaalt.

import { bijVersturen, element, haalInstellingen, ontbreekt, waarde, zetWaarde } from './gedeeld.ts';

type BerichtSamenvatting = {
  berichtId: string;
  afzender: string;
  onderwerp: string;
  tijdstipOntvangst: string;
  publicatietijdstip: string;
  aantalBijlagen: number;
  status?: { gelezen: boolean; map?: string };
};

type BerichtenLijst = {
  berichten: BerichtSamenvatting[];
  page: number;
  totalElements: number;
  totalPages: number;
};

type Bericht = {
  berichtId: string;
  afzender: string;
  onderwerp: string;
  inhoud: string;
  tijdstipOntvangst: string;
  publicatietijdstip: string;
  bijlagen: { bijlageId: string; naam: string; mimeType: string }[];
};

const paginaGrootte = 20;
const bewaarSleutel = 'portaal-ontvanger';

const formulier = element<HTMLElement>('#form-inloggen');
const lijst = element<HTMLElement>('#berichten');
const paginering = element<HTMLElement & { current: number; total: number }>('#paginering');
const fout = element<HTMLElement>('#fout');
const kopBerichten = element<HTMLElement>('#kop-berichten');
const berichtSectie = element<HTMLElement>('#bericht');

let ontvanger = '';

// ?magazijn=bld: kijk in het magazijn van de Belastingdienst (vanuit het scenario btw-aangifte).
const bld = new URLSearchParams(location.search).get('magazijn') === 'bld';

function datum(tijdstip: string): string {
  return new Date(tijdstip).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' });
}

function adres(pad: string, extra: Record<string, string> = {}): string {
  return `/api/portaal${pad}?${new URLSearchParams({ ontvanger, ...(bld ? { magazijn: 'bld' } : {}), ...extra })}`;
}

function toonFout(tekst: string | undefined): void {
  fout.hidden = !tekst;
  element<HTMLElement>('#fout-tekst').textContent = tekst ?? '';
}

// Haalt JSON op, of geeft een leesbare foutmelding.
async function haal<T>(pad: string, extra?: Record<string, string>): Promise<T | undefined> {
  try {
    const antwoord = await fetch(adres(pad, extra));
    const tekst = await antwoord.text();
    let body: unknown;
    try {
      body = tekst ? JSON.parse(tekst) : undefined;
    } catch {
      body = tekst;
    }
    if (!antwoord.ok) {
      const b = body as { fout?: string; title?: string; detail?: string } | undefined;
      const uitleg = b?.fout ?? b?.detail ?? b?.title ?? (antwoord.status === 404 ? 'niet gevonden' : 'geen uitleg');
      toonFout(`Het magazijn gaf ${antwoord.status}: ${uitleg}`);
      return undefined;
    }
    toonFout(undefined);
    return body as T;
  } catch (e) {
    toonFout(`Geen verbinding met de mock: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

function regel(bericht: BerichtSamenvatting): HTMLElement {
  const item = document.createElement('nldd-list-item');
  item.setAttribute('button', '');

  const titel = document.createElement('nldd-title-cell');
  titel.setAttribute('text', bericht.onderwerp);
  titel.setAttribute('supporting-text', `Van ${bericht.afzender} · ${datum(bericht.publicatietijdstip)}`);
  item.append(titel);

  const extra: string[] = [];
  if (bericht.aantalBijlagen) extra.push(bericht.aantalBijlagen === 1 ? '1 bijlage' : `${bericht.aantalBijlagen} bijlagen`);
  if (bericht.status) extra.push(bericht.status.gelezen ? 'Gelezen' : 'Ongelezen');
  if (extra.length) {
    const cel = document.createElement('nldd-text-cell');
    cel.setAttribute('text', extra.join(' · '));
    cel.setAttribute('color', 'secondary');
    cel.setAttribute('horizontal-alignment', 'end');
    item.append(cel);
  }

  item.addEventListener('click', () => void toonBericht(bericht.berichtId));
  return item;
}

async function laadLijst(pagina = 0): Promise<void> {
  const resultaat = await haal<BerichtenLijst>('/berichten', { page: String(pagina), pageSize: String(paginaGrootte) });
  lijst.querySelectorAll('nldd-list-item').forEach((item) => item.remove());
  berichtSectie.hidden = true;
  if (!resultaat) return;

  kopBerichten.textContent = `Berichten voor ${ontvanger.replace(':', ' ')} (${resultaat.totalElements})`;
  lijst.append(...resultaat.berichten.map(regel));
  const leeg = lijst.querySelector<HTMLElement>('[slot="empty"]');
  leeg?.setAttribute('text', `Geen berichten voor ${ontvanger.replace(':', ' ')}.`);

  paginering.hidden = resultaat.totalPages <= 1;
  paginering.total = Math.max(resultaat.totalPages, 1);
  paginering.current = resultaat.page + 1;
}

function alinea(tekst: string): HTMLParagraphElement {
  const p = document.createElement('p');
  tekst.split('\n').forEach((stuk, i) => {
    if (i) p.append(document.createElement('br'));
    p.append(stuk);
  });
  return p;
}

async function toonBericht(berichtId: string): Promise<void> {
  const bericht = await haal<Bericht>(`/berichten/${berichtId}`);
  if (!bericht) return;

  element<HTMLElement>('#bericht-onderwerp').textContent = bericht.onderwerp;
  element<HTMLElement>('#bericht-gegevens').textContent =
    `Van ${bericht.afzender} · gepubliceerd ${datum(bericht.publicatietijdstip)} · ontvangen door het magazijn ${datum(bericht.tijdstipOntvangst)}`;

  const inhoud = element<HTMLElement>('#bericht-inhoud');
  inhoud.replaceChildren(...bericht.inhoud.split(/\n\s*\n/).map(alinea));

  const bijlagen = element<HTMLElement>('#bericht-bijlagen');
  bijlagen.replaceChildren();
  if (bericht.bijlagen.length) {
    const titel = document.createElement('nldd-title');
    titel.setAttribute('text', 'Bijlagen');
    titel.setAttribute('heading-level', '3');
    titel.setAttribute('size', 'display-5');
    bijlagen.append(titel);
    for (const bijlage of bericht.bijlagen) {
      const link = document.createElement('nldd-link');
      link.setAttribute('text', `${bijlage.naam} (${bijlage.mimeType})`);
      link.setAttribute('href', adres(`/berichten/${berichtId}/bijlagen/${bijlage.bijlageId}`));
      link.setAttribute('download', bijlage.naam);
      bijlagen.append(link);
    }
  }

  berichtSectie.hidden = false;
  berichtSectie.scrollIntoView({ behavior: 'smooth' });
}

paginering.addEventListener('page-change', (event) => {
  const pagina = (event as CustomEvent<{ page: number }>).detail.page;
  void laadLijst(pagina - 1);
});

bijVersturen(formulier, async () => {
  const nummer = waarde(formulier, 'ontvangerWaarde').trim();
  if (!nummer) return;
  ontvanger = `${waarde(formulier, 'ontvangerType') || 'KVK'}:${nummer}`;
  localStorage.setItem(bewaarSleutel, ontvanger);
  await laadLijst(0);
});

// Laat zien hoe het magazijn is aangesloten.
const instellingen = await haalInstellingen();
const dienst = instellingen.magazijn;
const mist = ontbreekt(instellingen, dienst);
if (bld) {
  const scenario = (await (await fetch('/api/scenario')).json()) as { modus: string; adres: string };
  element<HTMLElement>('#verbinding-magazijn').textContent = `Magazijn van de Belastingdienst: ${scenario.modus === 'fsc' ? 'met FSC' : 'zonder FSC'}, ${scenario.adres}.`;
} else element<HTMLElement>('#verbinding-magazijn').textContent = mist
  ? `Berichtenmagazijn: nog niet ingesteld (ontbreekt: ${mist}).`
  : dienst.modus === 'fsc'
    ? `Berichtenmagazijn: met FSC, via de Outway ${instellingen.outwayAdres}.`
    : `Berichtenmagazijn: zonder FSC, ${dienst.directAdres}.`;

// Vorige keer ingelogd als: meteen de berichten tonen.
const bewaard = localStorage.getItem(bewaarSleutel);
if (bewaard?.includes(':')) {
  const [type, nummer] = bewaard.split(':');
  zetWaarde(formulier, 'ontvangerType', type);
  zetWaarde(formulier, 'ontvangerWaarde', nummer);
  ontvanger = bewaard;
  await laadLijst(0);
}

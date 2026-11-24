import { bijVersturen, element, haalInstellingen, ontbreekt, waarde, type Dienst, type Instellingen } from './gedeeld.ts';

type Logregel = {
  id: string;
  tijd: string;
  soort: 'bericht' | 'notificatie' | 'statusmelding';
  verzoek?: { methode: string; url: string; via?: string; body: unknown };
  antwoord?: { status: number; body: unknown };
  fout?: string;
};

const soortTekst: Record<Logregel['soort'], string> = {
  bericht: 'Bericht plaatsen',
  notificatie: 'Notificatie sturen',
  statusmelding: 'Statusmelding van de NMC',
};

async function post(pad: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const antwoord = await fetch(pad, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: antwoord.status, body: await antwoord.json().catch(() => undefined) };
}

// --- Logboek -------------------------------------------------------------

const logboek = element<HTMLElement>('#logboek');
let laatsteStand = '';

function statusBadge(regel: Logregel): HTMLElement {
  const badge = document.createElement('nldd-badge');
  if (regel.fout) {
    badge.setAttribute('color', 'critical');
    badge.setAttribute('text', 'Geen verbinding');
  } else if (regel.antwoord) {
    const ok = regel.antwoord.status < 400;
    badge.setAttribute('color', ok ? 'success' : 'critical');
    badge.setAttribute('text', String(regel.antwoord.status));
  } else {
    badge.setAttribute('color', 'accent');
    badge.setAttribute('text', 'Ontvangen');
  }
  return badge;
}

function codeblok(inhoud: unknown): HTMLElement {
  const viewer = document.createElement('nldd-code-viewer');
  viewer.setAttribute('language', 'json');
  viewer.setAttribute('appearance', 'box-base');
  viewer.setAttribute('wrap', '');
  viewer.textContent = typeof inhoud === 'string' ? inhoud : JSON.stringify(inhoud, null, 2);
  return viewer;
}

function tekst(inhoud: string): HTMLElement {
  const rich = document.createElement('nldd-rich-text');
  const p = document.createElement('p');
  p.textContent = inhoud;
  rich.append(p);
  return rich;
}

function toonLogregel(regel: Logregel): HTMLElement {
  const blok = document.createElement('nldd-container');
  blok.setAttribute('gap', '8');

  const kop = document.createElement('nldd-container');
  kop.setAttribute('layout', 'row');
  kop.setAttribute('gap', '8');
  const titel = document.createElement('nldd-title');
  titel.setAttribute('text', soortTekst[regel.soort]);
  titel.setAttribute('heading-level', '3');
  titel.setAttribute('size', 'display-5');
  kop.append(titel, statusBadge(regel));
  blok.append(kop);

  const tijd = new Date(regel.tijd).toLocaleTimeString('nl-NL');
  const via = regel.verzoek?.via ? ` (${regel.verzoek.via === 'direct' ? 'zonder FSC' : 'met FSC'})` : '';
  const waarheen = regel.verzoek ? `${regel.verzoek.methode} ${regel.verzoek.url}${via}` : '';
  blok.append(tekst(`${tijd} · ${waarheen}`));

  if (regel.verzoek?.body !== undefined) {
    blok.append(tekst(regel.soort === 'statusmelding' ? 'Ontvangen:' : 'Verstuurd:'));
    blok.append(codeblok(regel.verzoek.body));
  }
  if (regel.antwoord) {
    blok.append(tekst('Antwoord:'));
    blok.append(codeblok(regel.antwoord.body ?? '(leeg)'));
  }
  if (regel.fout) {
    blok.append(tekst(`Fout: ${regel.fout}`));
  }
  return blok;
}

async function verversLogboek(): Promise<void> {
  const regels = (await (await fetch('/api/logboek')).json()) as Logregel[];
  const stand = regels.map((r) => r.id).join(',');
  if (stand === laatsteStand) return;
  laatsteStand = stand;

  if (regels.length === 0) {
    const leeg = document.createElement('nldd-inline-dialog');
    leeg.setAttribute('icon', 'clock');
    leeg.setAttribute('text', 'Nog niets verstuurd');
    leeg.setAttribute('supporting-text', 'Plaats een bericht of stuur een notificatie.');
    logboek.replaceChildren(leeg);
    return;
  }
  logboek.replaceChildren(...regels.map(toonLogregel));
}

element<HTMLElement>('#logboek-leegmaken').addEventListener('click', async () => {
  await fetch('/api/logboek', { method: 'DELETE' });
  await verversLogboek();
});

// --- Uitkomst van een actie ----------------------------------------------

// Laat zien dát er iets gebeurt (laadteken in de knop) en wat eruit kwam (melding onder het formulier).
async function voerUit(form: HTMLElement, soort: 'bericht' | 'notificatie', actie: () => Promise<{ status: number; body: unknown }>): Promise<void> {
  const knop = form.querySelector<HTMLElement>('nldd-button[type="submit"]');
  const melding = element<HTMLElement>(`#uitkomst-${soort}`);
  if (knop?.hasAttribute('loading')) return;
  knop?.setAttribute('loading', '');
  melding.hidden = true;
  try {
    const uitkomst = await actie();
    toonUitkomst(melding, soort, uitkomst);
  } catch (e) {
    zetMelding(melding, 'critical', 'De mock zelf reageert niet', e instanceof Error ? e.message : String(e));
  } finally {
    knop?.removeAttribute('loading');
    await verversLogboek();
  }
}

function zetMelding(melding: HTMLElement, variant: string, tekst: string, uitleg: string): void {
  melding.setAttribute('variant', variant);
  melding.setAttribute('text', tekst);
  melding.setAttribute('supporting-text', uitleg);
  melding.hidden = false;
}

const gelukt = { bericht: 'Bericht geplaatst', notificatie: 'Notificatie verstuurd' };
const mislukt = { bericht: 'Bericht niet geplaatst', notificatie: 'Notificatie niet verstuurd' };
const dienstNaam = { bericht: 'Het berichtenmagazijn', notificatie: 'De NMC' };

function toonUitkomst(melding: HTMLElement, soort: 'bericht' | 'notificatie', uitkomst: { status: number; body: unknown }): void {
  const tijd = new Date().toLocaleTimeString('nl-NL');
  const body = (uitkomst.body ?? {}) as Partial<Logregel> & { fout?: string };
  // De mock kon niet versturen (bijvoorbeeld: instellingen ontbreken).
  if (uitkomst.status >= 400 || (!body.antwoord && !body.fout)) {
    zetMelding(melding, 'critical', `${mislukt[soort]} · ${tijd}`, body.fout ?? `De mock gaf ${uitkomst.status}.`);
    return;
  }
  // De dienst was niet bereikbaar.
  if (body.fout) {
    zetMelding(melding, 'critical', `${mislukt[soort]} · ${tijd}`, `${dienstNaam[soort]} is niet bereikbaar: ${body.fout}`);
    return;
  }
  const { status, body: antwoord } = body.antwoord!;
  const via = body.verzoek?.via === 'direct' ? 'zonder FSC' : 'met FSC';
  if (status >= 400) {
    const reden = (antwoord as { detail?: string; title?: string } | undefined);
    const uitleg = reden?.detail ?? reden?.title ?? '';
    zetMelding(melding, 'critical', `${mislukt[soort]} · ${tijd}`, `${dienstNaam[soort]} antwoordde ${status} (${via}).${uitleg ? ` ${uitleg}` : ''}`);
    return;
  }
  const kenmerk = antwoord as { id?: string; notificatieId?: string } | undefined;
  const nummer = kenmerk?.notificatieId ?? kenmerk?.id;
  zetMelding(
    melding,
    'success',
    `${gelukt[soort]} · ${tijd}`,
    `${dienstNaam[soort]} antwoordde ${status} (${via}).${nummer ? ` Kenmerk: ${nummer}.` : ''}`,
  );
}

for (const melding of document.querySelectorAll<HTMLElement>('[id^="uitkomst-"]')) {
  melding.addEventListener('dismiss', () => (melding.hidden = true));
}
for (const knop of document.querySelectorAll<HTMLElement>('[data-naar-logboek]')) {
  knop.addEventListener('click', () => element<HTMLElement>('#logboek-kop').scrollIntoView({ behavior: 'smooth' }));
}

// --- Formulieren ---------------------------------------------------------

const formBericht = element<HTMLElement>('#form-bericht');
bijVersturen(formBericht, () =>
  voerUit(formBericht, 'bericht', () =>
    post('/api/bericht', {
      ontvangerType: waarde(formBericht, 'ontvangerType') || 'KVK',
      ontvangerWaarde: waarde(formBericht, 'ontvangerWaarde').trim(),
      onderwerp: waarde(formBericht, 'onderwerp'),
      inhoud: waarde(formBericht, 'inhoud'),
      metBijlage: Boolean(formBericht.querySelector<HTMLElement & { checked?: boolean }>('[name="metBijlage"]')?.checked),
    }),
  ),
);

const formNotificatie = element<HTMLElement>('#form-notificatie');
// Het sjabloon van het Demo template in NotifyNL vraagt om een voornaam; zonder geeft de NMC
// een 500 "Verzendfout". De voornaam gaat daarom altijd mee als berichtgegevens.voornaam.
bijVersturen(formNotificatie, async () => {
  const voornaam = waarde(formNotificatie, 'voornaam').trim();
  if (!voornaam) return;
  await voerUit(formNotificatie, 'notificatie', () =>
    post('/api/notificatie', {
      emailAdres: waarde(formNotificatie, 'emailAdres').trim(),
      berichtType: waarde(formNotificatie, 'berichtType') || 'Demo template',
      // De server zet "naam: waarde"-regels om naar het object berichtgegevens.
      berichtgegevens: `voornaam: ${voornaam}`,
    }),
  );
});

// --- Verbindingen -----------------------------------------------------

// Twee regels per dienst: hoe hij is aangesloten, en op welk adres.
function beschrijf(i: Instellingen, dienst: Dienst): { verbinding: string; adres: string } {
  const mist = ontbreekt(i, dienst);
  if (mist) return { verbinding: 'Nog niet ingesteld', adres: `${mist} ontbreekt` };
  return dienst.modus === 'fsc'
    ? { verbinding: 'Met FSC, via de eigen Outway', adres: i.outwayAdres }
    : { verbinding: 'Zonder FSC', adres: dienst.directAdres };
}

function toonVerbinding(id: string, i: Instellingen, dienst: Dienst): void {
  const { verbinding, adres } = beschrijf(i, dienst);
  element<HTMLElement>(`#${id}-modus`).textContent = verbinding;
  element<HTMLElement>(`#${id}-adres`).textContent = adres;
}

function toonVerbindingen(i: Instellingen): void {
  toonVerbinding('verbinding-magazijn', i, i.magazijn);
  toonVerbinding('verbinding-nmc', i, i.nmc);
  element<HTMLElement>('#melding-instellingen').hidden = !ontbreekt(i, i.magazijn) && !ontbreekt(i, i.nmc);
}

// --- Start ---------------------------------------------------------------

toonVerbindingen(await haalInstellingen());
await verversLogboek();
// Statusmeldingen van de NMC komen los binnen; kijk elke 3 seconden of er iets nieuws is.
setInterval(() => void verversLogboek(), 3000);

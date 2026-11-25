// Server van de mock-dienstverlener.
// - Stuurt aanroepen vanuit het scherm door naar het berichtenmagazijn en de NMC
//   (direct, of via een FSC-Outway: dat is alleen een ander adres plus headers).
// - Ontvangt statusmeldingen (CloudEvents) van de NMC op POST /events.
// - Houdt een logboek bij in het geheugen.
// Draait met Node 22.18 of hoger, dat TypeScript zelf kan lezen.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { maakTestbijlage } from './bijlage.ts';
import { maakBeschikking, type Aangifte } from './beschikking.ts';

// Per dienst twee opties: zonder FSC (direct naar de dienst) of met FSC
// (via de eigen Outway, met de grant-hash van het contract als header).
type Dienst = {
  modus: 'direct' | 'fsc';
  directAdres: string;
  grantHash: string;
  fscPad: string; // pad dat via de Outway voor de aanroep komt, bijvoorbeeld /api/v1
};

type Instellingen = {
  outwayAdres: string;
  magazijn: Dienst;
  nmc: Dienst;
  afzender: string;
  terugmeldadres: string;
  // E-mailadres voor de echte e-mails in de presentatie (dia's met de pop-up). Staat op de gastenlijst van NotifyNL.
  demoEmail: string;
  // Schakelaar op de startdia: staan de echte e-mails aan? Standaard uit.
  demoEmailAan: boolean;
};

type Logregel = {
  id: string;
  tijd: string;
  soort: 'bericht' | 'notificatie' | 'statusmelding';
  verzoek?: { methode: string; url: string; via?: string; body: unknown };
  antwoord?: { status: number; body: unknown };
  fout?: string;
};

const isDev = process.argv.includes('--dev');
const poort = Number(process.env.POORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const maxLogregels = 100;

const instellingenBestand = join(import.meta.dirname, 'instellingen.json');

// Startwaarden uit omgevingsvariabelen; een bewaard instellingenbestand gaat voor.
const instellingen: Instellingen = {
  outwayAdres: process.env.OUTWAY_URL ?? '',
  magazijn: {
    modus: process.env.MAGAZIJN_MODUS === 'fsc' ? 'fsc' : 'direct',
    directAdres: process.env.MAGAZIJN_URL ?? '',
    grantHash: process.env.MAGAZIJN_GRANT_HASH ?? '',
    fscPad: process.env.MAGAZIJN_FSC_PAD ?? '/api/v1',
  },
  nmc: {
    modus: process.env.NMC_MODUS === 'fsc' ? 'fsc' : 'direct',
    directAdres: process.env.NMC_URL ?? '',
    grantHash: process.env.NMC_GRANT_HASH ?? '',
    fscPad: process.env.NMC_FSC_PAD ?? '',
  },
  afzender: process.env.AFZENDER_OIN ?? '00000000000000100000',
  terugmeldadres: process.env.TERUGMELDADRES ?? '',
  demoEmail: process.env.DEMO_EMAIL ?? '',
  demoEmailAan: process.env.DEMO_EMAIL_AAN === 'ja',
};

function neemOver(doel: Instellingen, bron: Partial<Instellingen> | undefined): void {
  if (!bron || typeof bron !== 'object') return;
  for (const sleutel of ['magazijn', 'nmc'] as const) {
    const d = bron[sleutel];
    if (!d) continue;
    if (d.modus === 'direct' || d.modus === 'fsc') doel[sleutel].modus = d.modus;
    if (typeof d.directAdres === 'string') doel[sleutel].directAdres = d.directAdres.trim();
    if (typeof d.grantHash === 'string') doel[sleutel].grantHash = d.grantHash.trim();
    if (typeof d.fscPad === 'string') doel[sleutel].fscPad = d.fscPad.trim();
  }
  if (typeof bron.outwayAdres === 'string') doel.outwayAdres = bron.outwayAdres.trim();
  if (typeof bron.afzender === 'string') doel.afzender = bron.afzender.trim();
  if (typeof bron.terugmeldadres === 'string') doel.terugmeldadres = bron.terugmeldadres.trim();
  // Leeg laten = niet wijzigen (de pagina Instellingen toont het adres niet).
  if (typeof bron.demoEmail === 'string' && bron.demoEmail.trim()) doel.demoEmail = bron.demoEmail.trim();
  if (typeof bron.demoEmailAan === 'boolean') doel.demoEmailAan = bron.demoEmailAan;
}

// Instellingen zoals de browser ze ziet: zonder het e-mailadres zelf, alleen of het is ingesteld.
function openbaar(i: Instellingen): Omit<Instellingen, 'demoEmail'> & { demoEmailIngesteld: boolean } {
  const { demoEmail, ...rest } = i;
  return { ...rest, demoEmailIngesteld: demoEmail !== '' };
}

// E-mailadres in het logboek afschermen: c•••@domein.nl
function afgeschermd(adres: string): string {
  const [naam, domein] = adres.split('@');
  return domein ? `${naam.slice(0, 1)}•••@${domein}` : '•••';
}

try {
  neemOver(instellingen, JSON.parse(await readFile(instellingenBestand, 'utf8')));
  console.log('Instellingen gelezen uit instellingen.json');
} catch {
  // nog geen bestand: startwaarden blijven staan
}

// Het adres waar de mock naartoe stuurt, en de headers die daarbij horen.
function bestemming(dienst: Dienst): { adres: string; headers: Record<string, string> } {
  if (dienst.modus === 'fsc') {
    const pad = dienst.fscPad && !dienst.fscPad.startsWith('/') ? `/${dienst.fscPad}` : dienst.fscPad;
    return { adres: `${zonderSlash(instellingen.outwayAdres)}${pad}`, headers: { 'Fsc-Grant-Hash': dienst.grantHash } };
  }
  return { adres: dienst.directAdres, headers: {} };
}

function ontbreekt(dienst: Dienst): string | undefined {
  if (dienst.modus === 'fsc') {
    if (!instellingen.outwayAdres) return 'het adres van de eigen Outway';
    if (!dienst.grantHash) return 'de grant-hash';
    return undefined;
  }
  return dienst.directAdres ? undefined : 'het adres';
}

const logboek: Logregel[] = [];

function voegToe(regel: Omit<Logregel, 'id' | 'tijd'>): Logregel {
  const volledig: Logregel = { id: randomUUID(), tijd: new Date().toISOString(), ...regel };
  logboek.unshift(volledig);
  logboek.length = Math.min(logboek.length, maxLogregels);
  return volledig;
}

function leesHeaders(tekst: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const regel of tekst.split(/\r?\n/)) {
    const i = regel.indexOf(':');
    if (i > 0) headers[regel.slice(0, i).trim()] = regel.slice(i + 1).trim();
  }
  return headers;
}

function zonderSlash(adres: string): string {
  return adres.trim().replace(/\/+$/, '');
}

async function leesBody(req: IncomingMessage): Promise<unknown> {
  const delen: Buffer[] = [];
  for await (const deel of req) delen.push(deel as Buffer);
  const tekst = Buffer.concat(delen).toString('utf8');
  if (!tekst) return undefined;
  try {
    return JSON.parse(tekst);
  } catch {
    return tekst;
  }
}

function stuurJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

// Een W3C traceparent, zodat de aanroep in de logging van de dienst terug te vinden is.
function traceparent(): string {
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
}

// Lange base64-inhoud van bijlagen inkorten, zodat het logboek leesbaar blijft.
function voorLogboek(body: unknown): unknown {
  return JSON.parse(JSON.stringify(body), function (this: Record<string, unknown>, sleutel, waarde) {
    const isBijlage = typeof this.mimeType === 'string';
    if (sleutel === 'emailAdres' && typeof waarde === 'string') return afgeschermd(waarde);
    return isBijlage && sleutel === 'inhoud' && typeof waarde === 'string'
      ? `${waarde.slice(0, 40)}… (${Math.round((waarde.length * 3) / 4 / 1024)} kB, base64)`
      : waarde;
  });
}

async function doorsturen(
  soort: 'bericht' | 'notificatie',
  dienst: Dienst,
  pad: string,
  body: unknown,
): Promise<Logregel> {
  const doel = bestemming(dienst);
  const url = `${zonderSlash(doel.adres)}${pad}`;
  const verzoek = { methode: 'POST', url, via: dienst.modus === 'fsc' ? 'FSC-Outway' : 'direct', body: voorLogboek(body) };
  try {
    const antwoord = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, application/problem+json',
        traceparent: traceparent(),
        ...doel.headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const tekst = await antwoord.text();
    let antwoordBody: unknown = tekst;
    try {
      antwoordBody = tekst ? JSON.parse(tekst) : undefined;
    } catch {
      // geen JSON: laat de tekst staan
    }
    return voegToe({ soort, verzoek, antwoord: { status: antwoord.status, body: antwoordBody } });
  } catch (e) {
    const oorzaak = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
    return voegToe({ soort, verzoek, fout: oorzaak });
  }
}

// Portaal-mock: haalt berichten op uit het magazijn, zoals een portaal dat doet (lijst, één
// bericht, een bijlage), en geeft het antwoord ongewijzigd door. De ontvanger komt binnen als
// ?ontvanger=KVK:90000013 en gaat als header X-Ontvanger mee.
const portaalPaden = /^\/berichten(\/[0-9a-f-]{36}(\/bijlagen\/[0-9a-f-]{36})?)?$/i;
const ontvangerVorm = /^(BSN:[0-9]{9}|RSIN:[0-9]{9}|KVK:[0-9]{8}|OIN:[0-9]{20})$/;

// --- Scenario btw-aangifte ---------------------------------------------------
// Een ondernemer doet aangifte in een nagebootst portaal van de Belastingdienst; de mock
// "verwerkt" die, maakt een fieldlab-beschikking en plaatst die in het magazijn van de
// Belastingdienst (magazijn B op het fieldlab). Het magazijn loopt op het fieldlab niet via FSC:
// het scenario plaatst daarom altijd direct, wat er bij Instellingen ook staat. Alleen met
// BLD_MAGAZIJN_MODUS=fsc gaat het via de eigen Outway (grant-hash van Instellingen, magazijn).
const bldMagazijnAdres =
  process.env.BLD_MAGAZIJN_URL ?? 'https://berichtenmagazijn-b.fbs.cluster-c.fieldlab2026.nl/api/v1';

// NMC op het fieldlab (Fundament, cluster-c), voor de directe melding na het magazijn.
const nmcFieldlabAdres = 'https://nmc.cluster-c.fieldlab2026.nl';

// OIN van de Belastingdienst (stelseldocument van het fieldlab), als afzender van het besluit.
const bldAfzender = process.env.BLD_AFZENDER_OIN ?? '00000001823288444000';
function bldMagazijn(): Dienst {
  if (process.env.BLD_MAGAZIJN_MODUS === 'fsc') return { ...instellingen.magazijn, modus: 'fsc' };
  return { modus: 'direct', directAdres: bldMagazijnAdres, grantHash: '', fscPad: '' };
}

// Magazijn A (RVO) van het fieldlab: alleen lezen, voor de berichtenbox die beide magazijnen toont.
const rvoMagazijnAdres =
  process.env.RVO_MAGAZIJN_URL ?? 'https://berichtenmagazijn-a.fbs.cluster-c.fieldlab2026.nl/api/v1';
function rvoMagazijn(): Dienst {
  return { modus: 'direct', directAdres: rvoMagazijnAdres, grantHash: '', fscPad: '' };
}

// Leest en controleert de gegevens van de aangifte (uit een body of uit de zoekparameters).
function leesAangifte(bron: Record<string, unknown>): Aangifte | string {
  const kvk = String(bron.kvk ?? '').trim();
  const tijdvak = String(bron.tijdvak ?? '').trim();
  const bedrag = Number(bron.bedrag);
  const ontvangenOp = new Date(String(bron.ontvangenOp ?? ''));
  const beslotenOp = new Date(String(bron.beslotenOp ?? ''));
  if (!/^[0-9]{8}$/.test(kvk)) return 'Een KVK-nummer heeft 8 cijfers.';
  if (!tijdvak || tijdvak.length > 100) return 'Het tijdvak ontbreekt of is te lang.';
  if (!Number.isFinite(bedrag) || bedrag < 0 || bedrag > 1e12) return 'Het bedrag is geen geldig bedrag.';
  if (Number.isNaN(ontvangenOp.getTime()) || Number.isNaN(beslotenOp.getTime())) return 'Een tijdstip ontbreekt.';
  return { kvk, tijdvak, bedrag, ontvangenOp, beslotenOp };
}

async function ophalenUitMagazijn(req: IncomingMessage, res: ServerResponse, magazijnPad: string): Promise<void> {
  const vraag = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const ontvanger = vraag.get('ontvanger') ?? '';
  if (!portaalPaden.test(magazijnPad)) return stuurJson(res, 404, { fout: 'Onbekend pad.' });
  if (!ontvangerVorm.test(ontvanger)) {
    return stuurJson(res, 400, { fout: 'De ontvanger hoort eruit te zien als KVK:90000013 of BSN:999993653.' });
  }
  // ?magazijn=bld: magazijn B (Belastingdienst, scenario); ?magazijn=a: magazijn A (RVO); anders het ingestelde.
  const keuze = vraag.get('magazijn');
  const dienst = keuze === 'bld' ? bldMagazijn() : keuze === 'a' ? rvoMagazijn() : instellingen.magazijn;
  const mist = ontbreekt(dienst);
  if (mist) return stuurJson(res, 409, { fout: `Voor het berichtenmagazijn ontbreekt nog ${mist}.` });

  const doel = bestemming(dienst);
  const door = new URLSearchParams();
  for (const sleutel of ['page', 'pageSize']) {
    const w = vraag.get(sleutel);
    if (w && /^\d+$/.test(w)) door.set(sleutel, w);
  }
  const url = `${zonderSlash(doel.adres)}${magazijnPad}${door.size ? `?${door}` : ''}`;
  try {
    const antwoord = await fetch(url, {
      headers: { accept: '*/*', 'X-Ontvanger': ontvanger, traceparent: traceparent(), ...doel.headers },
      signal: AbortSignal.timeout(15_000),
    });
    const koppen: Record<string, string> = {};
    for (const kop of ['content-type', 'content-disposition']) {
      const w = antwoord.headers.get(kop);
      if (w) koppen[kop] = w;
    }
    res.writeHead(antwoord.status, koppen);
    res.end(Buffer.from(await antwoord.arrayBuffer()));
  } catch (e) {
    const oorzaak = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
    stuurJson(res, 502, { fout: `Het magazijn is niet bereikbaar (${url}): ${oorzaak}` });
  }
}

// --- Berichtenuitvraag (BUS) van het Federatief Berichtenstelsel -----------------------------
// Zoals moza-poc en moza-portaal: eerst een sessie (POST /sessies), dan een ophaalronde
// (GET /berichten/_ophalen, Server-Sent Events), dan de lijst, de inhoud en de bijlagen.
// De server houdt de sessie per ontvanger bij; de browser ziet het sessie-id niet.
const busAdres = (process.env.BUS_URL ?? 'https://demo.fbs.cluster-c.fieldlab2026.nl/api/v1').replace(/\/$/, '');
const busSessies = new Map<string, string>();
const busPaden = /^\/(ophalen|berichten(\/[\w-]+(\/bijlagen\/[\w-]+)?)?)$/;

async function busSessie(ontvanger: string, nieuw = false): Promise<string> {
  if (!nieuw && busSessies.has(ontvanger)) return busSessies.get(ontvanger)!;
  const antwoord = await fetch(`${busAdres}/sessies`, { method: 'POST', headers: { 'X-Ontvanger': ontvanger, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!antwoord.ok) throw new Error(`sessie starten gaf ${antwoord.status}`);
  const { sessieId } = (await antwoord.json()) as { sessieId?: string };
  if (!sessieId) throw new Error('sessie starten: geen sessieId');
  busSessies.set(ontvanger, sessieId);
  return sessieId;
}

async function busFetch(ontvanger: string, pad: string, init: RequestInit = {}, ms = 15_000): Promise<Response> {
  const doe = async (sessie: string) =>
    fetch(`${busAdres}${pad}`, { ...init, headers: { 'X-Ontvanger': ontvanger, 'X-Sessie': sessie, ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(ms) });
  let antwoord = await doe(await busSessie(ontvanger));
  if (antwoord.status === 401) antwoord = await doe(await busSessie(ontvanger, true));
  return antwoord;
}

// Leest de ophaalronde tot "ophalen-gereed" en geeft een samenvatting terug.
async function busOphalen(ontvanger: string): Promise<{ magazijnen: { naam: string; status: string; aantal: number }[]; totaal: number; gereed: boolean }> {
  const antwoord = await busFetch(ontvanger, '/berichten/_ophalen', { headers: { accept: 'text/event-stream' } }, 45_000);
  if (antwoord.status === 409) return { magazijnen: [], totaal: 0, gereed: true }; // er loopt al een ronde
  if (!antwoord.ok || !antwoord.body) throw new Error(`ophalen gaf ${antwoord.status}`);
  const lezer = antwoord.body.getReader();
  const decoder = new TextDecoder();
  const magazijnen: { naam: string; status: string; aantal: number }[] = [];
  let buffer = '', totaal = 0, gereed = false;
  try {
    while (!gereed) {
      const { value, done } = await lezer.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let i;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        const data = frame.split('\n').filter((r) => r.startsWith('data:')).map((r) => r.slice(5).trim()).join('\n');
        if (!data) continue;
        const g = JSON.parse(data) as Record<string, unknown>;
        if (g.event === 'magazijn-bevraging-voltooid') magazijnen.push({ naam: String(g.naam ?? g.magazijnId), status: String(g.status ?? ''), aantal: Number(g.aantalBerichten) || 0 });
        if (g.event === 'ophalen-gereed') { totaal = Number(g.totaalBerichten) || 0; gereed = true; }
        if (g.event === 'ophalen-fout') throw new Error('fout tijdens ophalen');
      }
    }
  } finally {
    lezer.cancel().catch(() => {});
  }
  return { magazijnen, totaal, gereed };
}

async function viaBus(req: IncomingMessage, res: ServerResponse, busPad: string): Promise<void> {
  const vraag = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const ontvanger = vraag.get('ontvanger') ?? '';
  if (!busPaden.test(busPad)) return stuurJson(res, 404, { fout: 'Onbekend pad.' });
  if (!ontvangerVorm.test(ontvanger)) return stuurJson(res, 400, { fout: 'De ontvanger hoort eruit te zien als KVK:90000013.' });
  try {
    if (busPad === '/ophalen') return stuurJson(res, 200, await busOphalen(ontvanger));
    const door = new URLSearchParams();
    for (const sleutel of ['pagina', 'paginaGrootte', 'magazijnId']) {
      const w = vraag.get(sleutel);
      if (w && /^[\w-]{1,64}$/.test(w)) door.set(sleutel, w);
    }
    const antwoord = await busFetch(ontvanger, `${busPad}${door.size ? `?${door}` : ''}`, { headers: { accept: '*/*' } });
    const koppen: Record<string, string> = {};
    for (const kop of ['content-type', 'content-disposition']) {
      const w = antwoord.headers.get(kop);
      if (w) koppen[kop] = w;
    }
    res.writeHead(antwoord.status, koppen);
    res.end(Buffer.from(await antwoord.arrayBuffer()));
  } catch (e) {
    const oorzaak = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
    stuurJson(res, 502, { fout: `De berichtenuitvraag is niet bereikbaar (${busAdres}): ${oorzaak}` });
  }
}

async function verwerkApi(req: IncomingMessage, res: ServerResponse, pad: string): Promise<boolean> {
  const methode = req.method ?? 'GET';

  // Voorbeeld van de testbijlage, met een tekst op de plek van de tijd. Opent in de browser.
  if (pad === '/api/testbijlage/voorbeeld' && methode === 'GET') {
    const bijlage = await maakTestbijlage(new Date(), { voorbeeld: true });
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${bijlage.naam}"`,
      'cache-control': 'no-store',
    });
    res.end(Buffer.from(bijlage.pdf));
    return true;
  }

  if (pad === '/api/scenario' && methode === 'GET') {
    const dienst = bldMagazijn();
    stuurJson(res, 200, { modus: dienst.modus, adres: bestemming(dienst).adres, ontbreekt: ontbreekt(dienst) });
    return true;
  }

  // Voorbeeld van de beschikking, met de gegevens uit de zoekparameters. Opent in de browser.
  if (pad === '/api/scenario/beschikking' && methode === 'GET') {
    const vraag = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const aangifte = leesAangifte(Object.fromEntries(vraag));
    if (typeof aangifte === 'string') {
      stuurJson(res, 400, { fout: aangifte });
      return true;
    }
    const beschikking = await maakBeschikking(aangifte);
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${beschikking.naam}"`,
      'cache-control': 'no-store',
    });
    res.end(Buffer.from(beschikking.pdf));
    return true;
  }

  // Plaatst de beschikking als bericht met bijlage in het magazijn van de Belastingdienst.
  if (pad === '/api/scenario/plaatsen' && methode === 'POST') {
    const aangifte = leesAangifte(((await leesBody(req)) ?? {}) as Record<string, unknown>);
    if (typeof aangifte === 'string') {
      stuurJson(res, 400, { fout: aangifte });
      return true;
    }
    const dienst = bldMagazijn();
    const mist = ontbreekt(dienst);
    if (mist) {
      stuurJson(res, 409, { fout: `Voor het magazijn van de Belastingdienst ontbreekt nog ${mist}.` });
      return true;
    }
    const beschikking = await maakBeschikking(aangifte);
    const body = {
      // Het besluit komt van de Belastingdienst: hun OIN uit het stelseldocument van het fieldlab.
      afzender: bldAfzender,
      ontvanger: { type: 'KVK', waarde: aangifte.kvk },
      onderwerp: `Beschikking btw-aangifte ${aangifte.tijdvak} (fieldlab)`,
      inhoud: `Uw btw-aangifte over ${aangifte.tijdvak} is verwerkt. De beschikking staat in de bijlage. Dit is een testbericht van het Fieldlab Soevereine basis.`,
      bijlagen: [{ naam: beschikking.naam, mimeType: 'application/pdf', inhoud: Buffer.from(beschikking.pdf).toString('base64') }],
    };
    stuurJson(res, 200, await doorsturen('bericht', dienst, '/aanleveringen', body));
    return true;
  }

  if (pad.startsWith('/api/bus/') && methode === 'GET') {
    await viaBus(req, res, pad.slice('/api/bus'.length));
    return true;
  }

  // Logboek Dataverwerkingen (LDV) van de NMC, voor "Gegevensdeling en dataverwerking" in het
  // MOZa-portaal. De server vraagt het op (direct, zonder FSC), voor het bedrijf én voor het
  // demo-e-mailadres (decentrale notificaties staan in het logboek onder EMAIL:). Het adres
  // zelf gaat niet naar de browser.
  if (pad === '/api/portaal/ldv' && methode === 'GET') {
    const zoek = new URL(req.url ?? '/', 'http://x').searchParams;
    const betrokkene = zoek.get('betrokkene') ?? '';
    if (!/^(BSN:[0-9]{9}|RSIN:[0-9]{9}|KVK:[0-9]{8})$/.test(betrokkene)) {
      stuurJson(res, 400, { fout: 'Geef een betrokkene mee als BSN:, RSIN: of KVK: met het nummer.' });
      return true;
    }
    const basis = zonderSlash(process.env.NMC_DIRECT_URL || instellingen.nmc.directAdres || nmcFieldlabAdres);
    const periode = new URLSearchParams();
    for (const k of ['van', 'tot']) { const w = zoek.get(k); if (w) periode.set(k, w); }
    const vragen: { header: string; over: string }[] = [{ header: betrokkene, over: betrokkene.split(':')[0] }];
    if (instellingen.demoEmail) vragen.push({ header: `EMAIL:${instellingen.demoEmail}`, over: 'E-mailadres' });
    const verwerkingen: Record<string, unknown>[] = [];
    const fouten: string[] = [];
    await Promise.all(vragen.map(async (v) => {
      try {
        const a = await fetch(`${basis}/api/nmc/v1/logboek/verwerkingen${periode.size ? `?${periode}` : ''}`, {
          headers: { 'X-Betrokkene': v.header, accept: 'application/json', traceparent: traceparent() },
          signal: AbortSignal.timeout(15_000),
        });
        if (!a.ok) { fouten.push(`${v.over}: NMC antwoordde ${a.status}`); return; }
        const d = (await a.json()) as { verwerkingen?: Record<string, unknown>[] };
        for (const r of d.verwerkingen ?? []) verwerkingen.push({ ...r, over: v.over, organisatie: 'Notificatiedienst (NMC)' });
      } catch (e) {
        fouten.push(`${v.over}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }));
    verwerkingen.sort((x, y) => String(y.tijdstip).localeCompare(String(x.tijdstip)));
    stuurJson(res, 200, { betrokkene, verwerkingen, fouten });
    return true;
  }

  if (pad.startsWith('/api/portaal/berichten') && methode === 'GET') {
    await ophalenUitMagazijn(req, res, pad.slice('/api/portaal'.length));
    return true;
  }

  if (pad === '/api/instellingen' && methode === 'GET') {
    stuurJson(res, 200, openbaar(instellingen));
    return true;
  }

  if (pad === '/api/demo-email-schakelaar' && methode === 'PUT') {
    const { aan } = ((await leesBody(req)) ?? {}) as { aan?: unknown };
    if (typeof aan === 'boolean') {
      instellingen.demoEmailAan = aan;
      await writeFile(instellingenBestand, JSON.stringify(instellingen, null, 2) + '\n', 'utf8');
    }
    stuurJson(res, 200, { aan: instellingen.demoEmailAan, ingesteld: instellingen.demoEmail !== '' });
    return true;
  }

  if (pad === '/api/instellingen' && methode === 'PUT') {
    neemOver(instellingen, (await leesBody(req)) as Partial<Instellingen>);
    await writeFile(instellingenBestand, JSON.stringify(instellingen, null, 2) + '\n', 'utf8');
    stuurJson(res, 200, openbaar(instellingen));
    return true;
  }

  if (pad === '/api/logboek' && methode === 'GET') {
    stuurJson(res, 200, logboek);
    return true;
  }

  if (pad === '/api/logboek' && methode === 'DELETE') {
    logboek.length = 0;
    res.writeHead(204).end();
    return true;
  }

  if (pad === '/api/bericht' && methode === 'POST') {
    const mist = ontbreekt(instellingen.magazijn);
    if (mist) {
      stuurJson(res, 409, { fout: `Voor het berichtenmagazijn ontbreekt nog ${mist}.` });
      return true;
    }
    const invoer = (await leesBody(req)) as Record<string, string> & { metBijlage?: boolean };
    const body: Record<string, unknown> = {
      afzender: instellingen.afzender,
      ontvanger: { type: invoer.ontvangerType, waarde: invoer.ontvangerWaarde },
      onderwerp: invoer.onderwerp,
      inhoud: invoer.inhoud,
    };
    if (invoer.metBijlage) {
      const bijlage = await maakTestbijlage();
      body.bijlagen = [
        { naam: bijlage.naam, mimeType: 'application/pdf', inhoud: Buffer.from(bijlage.pdf).toString('base64') },
      ];
    }
    stuurJson(res, 200, await doorsturen('bericht', instellingen.magazijn, '/aanleveringen', body));
    return true;
  }

  if (pad === '/api/notificatie' && methode === 'POST') {
    const mist = ontbreekt(instellingen.nmc);
    if (mist) {
      stuurJson(res, 409, { fout: `Voor de NMC ontbreekt nog ${mist}.` });
      return true;
    }
    const invoer = (await leesBody(req)) as { emailAdres: string; berichtType: string; berichtgegevens?: string };
    const body: Record<string, unknown> = {
      emailAdres: invoer.emailAdres,
      berichtType: invoer.berichtType,
    };
    const gegevens = leesHeaders(invoer.berichtgegevens ?? '');
    if (Object.keys(gegevens).length > 0) body.berichtgegevens = gegevens;
    if (instellingen.terugmeldadres) body.callbackUrl = `${zonderSlash(instellingen.terugmeldadres)}/events`;
    stuurJson(res, 200, await doorsturen('notificatie', instellingen.nmc, '/api/nmc/v1/decentraal/notificaties', body));
    return true;
  }

  // Echte e-mail op het moment van de pop-up in de presentatie. De browser kiest alleen het
  // moment; het e-mailadres en het berichttype (sjabloon in de NMC) bepaalt de server.
  if (pad === '/api/demo-melding' && methode === 'POST') {
    const sjablonen: Record<string, string> = { herinnering: 'Herinnering-Fieldlab', magazijn: 'Magazijn-Fieldlab' };
    const { soort } = ((await leesBody(req)) ?? {}) as { soort?: string };
    const berichtType = soort ? sjablonen[soort] : undefined;
    if (!berichtType) {
      stuurJson(res, 400, { fout: 'Onbekende soort. Kies herinnering of magazijn.' });
      return true;
    }
    if (!instellingen.demoEmailAan) {
      // Schakelaar staat uit: de pop-up verschijnt wel, maar er gaat geen e-mail weg.
      stuurJson(res, 200, { overgeslagen: true, reden: 'Echte e-mails staan uit (schakelaar op de startdia).' });
      return true;
    }
    // Zoals in de keten: de herinnering komt van de procesapplicatie en volgt de NMC-instelling
    // (online via FSC); de melding na het magazijn gaat altijd direct, zonder FSC.
    const nmc: Dienst = soort === 'magazijn'
      ? { modus: 'direct', directAdres: process.env.NMC_DIRECT_URL || instellingen.nmc.directAdres || nmcFieldlabAdres, grantHash: '', fscPad: '' }
      : instellingen.nmc;
    const mist = ontbreekt(nmc) ?? (instellingen.demoEmail ? null : 'het e-mailadres voor de demo');
    if (mist) {
      stuurJson(res, 409, { fout: `Voor de echte e-mail ontbreekt nog ${mist}.` });
      return true;
    }
    const body: Record<string, unknown> = { emailAdres: instellingen.demoEmail, berichtType };
    if (instellingen.terugmeldadres) body.callbackUrl = `${zonderSlash(instellingen.terugmeldadres)}/events`;
    stuurJson(res, 200, await doorsturen('notificatie', nmc, '/api/nmc/v1/decentraal/notificaties', body));
    return true;
  }

  // Terugmelding van de NMC (CloudEvents NL GOV).
  if (pad === '/events' && methode === 'POST') {
    const body = await leesBody(req);
    voegToe({ soort: 'statusmelding', verzoek: { methode, url: pad, body } });
    res.writeHead(204).end();
    return true;
  }

  return false;
}

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

async function serveerStatisch(res: ServerResponse, pad: string): Promise<void> {
  const map = join(import.meta.dirname, 'dist');
  const bestand = normalize(join(map, pad === '/' ? 'index.html' : pad === '/instellingen' ? 'instellingen.html' : pad));
  if (!bestand.startsWith(map)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const inhoud = await readFile(bestand);
    res.writeHead(200, { 'content-type': mimeTypes[extname(bestand)] ?? 'application/octet-stream' });
    res.end(inhoud);
  } catch {
    res.writeHead(404).end('Niet gevonden. Draai eerst "npm run build", of start met "npm run dev".');
  }
}

let vite: import('vite').ViteDevServer | undefined;
if (isDev) {
  const { createServer: maakViteServer } = await import('vite');
  vite = await maakViteServer({ server: { middlewareMode: true }, appType: 'mpa' });
}

// Afscherming met een inlog (HTTP Basic), alleen als WACHTWOORD is gezet, bijvoorbeeld op ZAD.
// Zonder inlog kan iedereen met het adres berichten plaatsen en notificaties laten versturen.
// POST /events blijft open: daar meldt de NMC de bezorgstatus, en die kan niet inloggen.
const inlogGebruiker = process.env.GEBRUIKER ?? 'fieldlab';
const inlogWachtwoord = process.env.WACHTWOORD ?? '';

function magErin(req: IncomingMessage, pad: string): boolean {
  if (!inlogWachtwoord) return true;
  if (pad === '/events' && req.method === 'POST') return true;
  const [soort, waarde] = (req.headers.authorization ?? '').split(' ');
  if (soort !== 'Basic' || !waarde) return false;
  const verwacht = Buffer.from(`${inlogGebruiker}:${inlogWachtwoord}`);
  const gekregen = Buffer.from(Buffer.from(waarde, 'base64').toString('utf8'));
  return gekregen.length === verwacht.length && timingSafeEqual(gekregen, verwacht);
}

createServer(async (req, res) => {
  const pad = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (!magErin(req, pad)) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="Fundament Dienstverlener", charset="UTF-8"' }).end('Inloggen nodig.');
    return;
  }
  try {
    if (await verwerkApi(req, res, pad)) return;
    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    await serveerStatisch(res, pad);
  } catch (e) {
    stuurJson(res, 500, { fout: e instanceof Error ? e.message : String(e) });
  }
}).listen(poort, host, () => {
  console.log(`Fundament Dienstverlener draait op http://${host === '0.0.0.0' ? 'localhost' : host}:${poort}${isDev ? ' (ontwikkelmodus)' : ''}`);
});

// Maakt de fieldlab-beschikking voor het scenario "btw-aangifte": een kopie van het
// sjabloon met de gegevens van de aangifte erin. Het sjabloon zelf blijft ongewijzigd.
//
// Het sjabloon (testdata/beschikking-sjabloon.pdf) is afgedrukt uit
// testdata/beschikking.html. Die pagina meet waar elk gegeven moet komen en zet dat
// in de titel van de PDF; hier lezen we dat uit en zetten daarna een gewone titel.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { tekenTekst, tijdTekst, type Plaats } from './bijlage.ts';

export type Aangifte = {
  kvk: string;
  tijdvak: string;
  bedrag: number; // in euro's
  ontvangenOp: Date;
  beslotenOp: Date;
};

type Sjabloon = { sjabloon: string; plekken: Record<'kvk' | 'tijdvak' | 'bedrag' | 'ontvangen' | 'besloten', Plaats> };

const sjabloonPad = join(import.meta.dirname, 'testdata', 'beschikking-sjabloon.pdf');
let sjabloonBron: Promise<Uint8Array> | undefined;

export function bedragTekst(bedrag: number): string {
  return bedrag.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });
}

export async function maakBeschikking(aangifte: Aangifte): Promise<{ naam: string; pdf: Uint8Array }> {
  sjabloonBron ??= readFile(sjabloonPad);
  const doc = await PDFDocument.load(await sjabloonBron);
  const sjabloon = JSON.parse(doc.getTitle() ?? '') as Sjabloon;
  if (sjabloon.sjabloon !== 'beschikking') throw new Error('Het sjabloon bevat geen plekken voor de beschikking.');

  const { plekken } = sjabloon;
  await tekenTekst(doc, plekken.kvk, aangifte.kvk);
  await tekenTekst(doc, plekken.tijdvak, aangifte.tijdvak);
  await tekenTekst(doc, plekken.bedrag, bedragTekst(aangifte.bedrag));
  await tekenTekst(doc, plekken.ontvangen, tijdTekst(aangifte.ontvangenOp));
  await tekenTekst(doc, plekken.besloten, tijdTekst(aangifte.beslotenOp));

  doc.setTitle('Beschikking btw-aangifte (fieldlab)');
  doc.setSubject(`Fieldlab-beschikking over de btw-aangifte ${aangifte.tijdvak} van KVK ${aangifte.kvk}. Testdocument, geen echt besluit.`);
  doc.setCreationDate(aangifte.beslotenOp);
  doc.setModificationDate(aangifte.beslotenOp);

  const stempel = aangifte.beslotenOp
    .toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' })
    .replace(/[-:]/g, '')
    .replace(' ', '-');
  return { naam: `beschikking-btw-${stempel}.pdf`, pdf: await doc.save() };
}

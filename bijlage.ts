// Maakt per bericht een testbijlage: een kopie van het sjabloon met de exacte
// tijd van aanmaken erin. Het sjabloon zelf blijft ongewijzigd.
//
// Het sjabloon (testdata/testbijlage-sjabloon.pdf) is afgedrukt uit
// testdata/testbijlage.html. Die pagina meet waar de tijd moet komen en zet dat
// in de titel van de PDF; hier lezen we dat uit en zetten daarna een gewone titel.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// Een plek op de pagina waar tekst komt, gemeten door de sjabloonpagina.
export type Plaats = {
  x: number;
  basislijnVanafBoven: number;
  grootte: number;
  kleur: [number, number, number];
};

type Plek = Plaats & { sjabloon: string };

const sjabloonPad = join(import.meta.dirname, 'testdata', 'testbijlage-sjabloon.pdf');
const letterPad = join(
  import.meta.dirname,
  'node_modules',
  '@nldd',
  'design-system',
  'dist',
  'fonts',
  'RijksSansWeb-Regular.woff2',
);

let sjabloonBron: Promise<Uint8Array> | undefined;
let letterBron: Promise<ReturnType<typeof fontkit.create>> | undefined;

// Tekent tekst op een plek van de eerste pagina, als vormen in RijksSans. De PDF-bibliotheek
// kan het webfont (WOFF2) wel lezen, maar niet goed als lettertype in de PDF zetten. Dezelfde
// tekst komt onzichtbaar als gewone tekst eronder, zodat je hem kunt selecteren en zoeken.
export async function tekenTekst(doc: PDFDocument, plaats: Plaats, tekst: string): Promise<void> {
  letterBron ??= readFile(letterPad).then((letter) => fontkit.create(letter));
  const font = await letterBron;
  const pagina = doc.getPage(0);
  const basislijn = pagina.getHeight() - plaats.basislijnVanafBoven;
  const schaal = plaats.grootte / font.unitsPerEm;
  const regel = font.layout(tekst);
  let pen = 0;
  regel.glyphs.forEach((glyph, i) => {
    // fontkit: y omhoog; SVG: y omlaag. `scale` bestaat wel, maar ontbreekt in de types van fontkit.
    const pad = (glyph.path as unknown as { scale(x: number, y: number): { toSVG(): string } }).scale(1, -1).toSVG();
    if (pad) {
      pagina.drawSvgPath(pad, {
        x: plaats.x + pen * schaal,
        y: basislijn,
        scale: schaal,
        color: rgb(...plaats.kleur),
      });
    }
    pen += regel.positions[i].xAdvance;
  });

  const zoektekst = await doc.embedFont(StandardFonts.Helvetica);
  pagina.drawText(tekst, { x: plaats.x, y: basislijn, size: plaats.grootte, font: zoektekst, opacity: 0 });
}

export function tijdTekst(moment: Date): string {
  const datum = moment.toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Amsterdam',
  });
  const tijd = moment.toLocaleTimeString('nl-NL', { timeZone: 'Europe/Amsterdam' });
  return `${datum}, ${tijd}`;
}

// Voor het voorbeeld in het scherm: deze tekst staat op de plek van de tijd.
export const voorbeeldTekst = '[tijdstip van verzenden]';

export async function maakTestbijlage(
  moment = new Date(),
  { voorbeeld = false } = {},
): Promise<{ naam: string; pdf: Uint8Array; tijd: string }> {
  sjabloonBron ??= readFile(sjabloonPad);
  const doc = await PDFDocument.load(await sjabloonBron);
  const plek = JSON.parse(doc.getTitle() ?? '') as Plek;
  if (plek.sjabloon !== 'testbijlage') throw new Error('Het sjabloon bevat geen plek voor de tijd.');

  const tijd = voorbeeld ? voorbeeldTekst : tijdTekst(moment);
  await tekenTekst(doc, plek, tijd);

  doc.setTitle(voorbeeld ? 'Testbijlage (voorbeeld)' : 'Testbijlage');
  doc.setSubject(
    voorbeeld
      ? 'Voorbeeld van de testbijlage van de mock-dienstverlener; bij verzenden komt hier de tijd'
      : `Testbijlage van de mock-dienstverlener, gemaakt op ${tijd}`,
  );
  doc.setCreationDate(moment);
  doc.setModificationDate(moment);
  if (voorbeeld) return { naam: 'testbijlage-voorbeeld.pdf', pdf: await doc.save(), tijd };

  // Bestandsnaam met de tijd, zodat elke bijlage herkenbaar is.
  const stempel = moment
    .toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' })
    .replace(/[-:]/g, '')
    .replace(' ', '-');
  return { naam: `testbijlage-${stempel}.pdf`, pdf: await doc.save(), tijd };
}

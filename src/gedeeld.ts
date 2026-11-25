import '@nldd/design-system';

export type Dienst = {
  modus: 'direct' | 'fsc';
  directAdres: string;
  grantHash: string;
  fscPad: string;
};

export type Instellingen = {
  outwayAdres: string;
  magazijn: Dienst;
  nmc: Dienst;
  afzender: string;
  terugmeldadres: string;
  // Het adres zelf komt niet naar de browser; alleen of het is ingesteld.
  demoEmailIngesteld?: boolean;
  demoEmailAan?: boolean;
};

export function element<T extends HTMLElement>(selector: string): T {
  const gevonden = document.querySelector<T>(selector);
  if (!gevonden) throw new Error(`Niet gevonden: ${selector}`);
  return gevonden;
}

type MetWaarde = HTMLElement & { value?: string };

// Leest de waarde van een veld op naam, via de `value` van het component.
export function waarde(formulier: HTMLElement, naam: string): string {
  return (formulier.querySelector<MetWaarde>(`[name="${naam}"]`)?.value ?? '').toString();
}

export function zetWaarde(formulier: HTMLElement, naam: string, nieuw: string): void {
  const veld = formulier.querySelector<MetWaarde>(`[name="${naam}"]`);
  if (veld) {
    veld.value = nieuw;
    veld.setAttribute('value', nieuw);
  }
}

export function bijVersturen(formulier: HTMLElement, actie: () => Promise<void>): void {
  formulier.addEventListener('submit', (event) => {
    event.preventDefault();
    void actie();
  });
}

export async function haalInstellingen(): Promise<Instellingen> {
  return (await (await fetch('/api/instellingen')).json()) as Instellingen;
}

// Wat er nog ontbreekt voor een dienst, of undefined als hij klaar is.
export function ontbreekt(i: Instellingen, dienst: Dienst): string | undefined {
  if (dienst.modus === 'fsc') {
    if (!i.outwayAdres) return 'het adres van de eigen Outway';
    if (!dienst.grantHash) return 'de grant-hash';
    return undefined;
  }
  return dienst.directAdres ? undefined : 'het adres';
}

// Bekende adressen om uit te kiezen bij Instellingen (zonder FSC).
export const bekendeAdressen: Record<'magazijn' | 'nmc', { naam: string; adres: string }[]> = {
  magazijn: [
    { naam: 'Fieldlab, magazijn A (RVO)', adres: 'https://berichtenmagazijn-a.fbs.cluster-c.fieldlab2026.nl/api/v1' },
    { naam: 'Fieldlab, magazijn B (Belastingdienst)', adres: 'https://berichtenmagazijn-b.fbs.cluster-c.fieldlab2026.nl/api/v1' },
    { naam: 'ZAD, testomgeving', adres: 'https://magazijna-test-mpfm-w3h.rig.prd1.gn2.quattro.rijksapps.nl/api/v1' },
    { naam: 'Lokaal', adres: 'http://localhost:8090/api/v1' },
  ],
  nmc: [
    { naam: 'Fieldlab, Fundament (cluster-c)', adres: 'https://nmc.cluster-c.fieldlab2026.nl' },
    { naam: 'ZAD, stable', adres: 'https://nmcapi-stable-nd-j7s.rig.prd1.gn2.quattro.rijksapps.nl' },
  ],
};

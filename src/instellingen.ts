import {
  bekendeAdressen,
  bijVersturen,
  element,
  haalInstellingen,
  waarde,
  zetWaarde,
  type Instellingen,
} from './gedeeld.ts';

type DienstNaam = 'magazijn' | 'nmc';
type RadioVeld = HTMLElement & { checked?: boolean; value?: string };

const formulier = element<HTMLElement>('#form-instellingen');
const bewaard = element<HTMLElement>('#bewaard');
const diensten: DienstNaam[] = ['magazijn', 'nmc'];

// Huidige keuze per dienst: een bekend adres, of 'eigen'.
const bron: Record<DienstNaam, string> = { magazijn: 'eigen', nmc: 'eigen' };

function groep(dienst: DienstNaam): HTMLElement {
  return element<HTMLElement>(`[name="${dienst}Bron"]`);
}

// Zet de bekende adressen als keuzes vóór "Eigen adres".
function maakKeuzes(dienst: DienstNaam): void {
  const eigen = groep(dienst).querySelector('[value="eigen"]');
  for (const { naam, adres } of bekendeAdressen[dienst]) {
    const veld = document.createElement('nldd-radio-button-field');
    veld.setAttribute('value', adres);
    veld.setAttribute('label', `${naam}: ${adres}`);
    groep(dienst).insertBefore(veld, eigen);
  }
}

function kiesBron(dienst: DienstNaam, adres: string): void {
  const bekend = bekendeAdressen[dienst].some((b) => b.adres === adres);
  bron[dienst] = bekend ? adres : 'eigen';
  for (const veld of groep(dienst).querySelectorAll<RadioVeld>('nldd-radio-button-field')) {
    veld.checked = veld.getAttribute('value') === bron[dienst];
    veld.toggleAttribute('checked', veld.checked);
  }
}

// Toon alleen de velden die bij de gekozen verbinding en keuze horen.
function toonVelden(dienst: DienstNaam): void {
  const modus = waarde(formulier, `${dienst}Modus`) === 'fsc' ? 'fsc' : 'direct';
  for (const veld of formulier.querySelectorAll<HTMLElement>(`[data-modus^="${dienst}-"]`)) {
    const hoortBijModus = veld.dataset.modus === `${dienst}-${modus}`;
    const isEigen = veld.hasAttribute('data-eigen');
    veld.hidden = !hoortBijModus || (isEigen && bron[dienst] !== 'eigen');
  }
}

for (const dienst of diensten) {
  maakKeuzes(dienst);

  formulier.querySelector(`[name="${dienst}Modus"]`)?.addEventListener('change', () => {
    // Het component zet zijn waarde pas na het event; wacht daar even op.
    queueMicrotask(() => toonVelden(dienst));
    bewaard.hidden = true;
  });

  groep(dienst).addEventListener('change', (event) => {
    const detail = (event as CustomEvent<{ checked?: boolean; value?: string }>).detail;
    if (detail?.checked === false || !detail?.value) return;
    bron[dienst] = detail.value;
    if (detail.value !== 'eigen') zetWaarde(formulier, `${dienst}DirectAdres`, detail.value);
    toonVelden(dienst);
    bewaard.hidden = true;
  });
}

function toon(i: Instellingen): void {
  for (const dienst of diensten) {
    zetWaarde(formulier, `${dienst}Modus`, i[dienst].modus);
    zetWaarde(formulier, `${dienst}DirectAdres`, i[dienst].directAdres);
    zetWaarde(formulier, `${dienst}GrantHash`, i[dienst].grantHash);
    zetWaarde(formulier, `${dienst}FscPad`, i[dienst].fscPad);
    kiesBron(dienst, i[dienst].directAdres);
    toonVelden(dienst);
  }
  zetWaarde(formulier, 'outwayAdres', i.outwayAdres);
  zetWaarde(formulier, 'afzender', i.afzender);
  zetWaarde(formulier, 'terugmeldadres', i.terugmeldadres);
}

function dienstGegevens(dienst: DienstNaam) {
  return {
    modus: waarde(formulier, `${dienst}Modus`) === 'fsc' ? 'fsc' : 'direct',
    directAdres: bron[dienst] === 'eigen' ? waarde(formulier, `${dienst}DirectAdres`) : bron[dienst],
    grantHash: waarde(formulier, `${dienst}GrantHash`),
    fscPad: waarde(formulier, `${dienst}FscPad`),
  };
}

bijVersturen(formulier, async () => {
  const antwoord = await fetch('/api/instellingen', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      outwayAdres: waarde(formulier, 'outwayAdres'),
      magazijn: dienstGegevens('magazijn'),
      nmc: dienstGegevens('nmc'),
      afzender: waarde(formulier, 'afzender'),
      terugmeldadres: waarde(formulier, 'terugmeldadres'),
    }),
  });
  toon((await antwoord.json()) as Instellingen);
  bewaard.hidden = false;
});

toon(await haalInstellingen());

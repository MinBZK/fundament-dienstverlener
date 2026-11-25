# Fundament Dienstverlener

*Powered by AI*

Presentatie en werkende demo van het Fieldlab Soevereine basis in één app. Je klikt de presentatie door; op de dia's met een kaart "Live demo" open je het werkende deel. Daarachter zit een nagebootste dienstverlener die buiten Fundament draait en de diensten op Fundament aanroept: hij plaatst berichten in een berichtenmagazijn en stuurt notificaties via de NMC (Notificatie Management Component), direct of via een FSC-Outway.

## Starten

Nodig: Node.js 22.18 of hoger.

```bash
npm install
npm run dev
```

Open daarna http://127.0.0.1:3000. Je komt op de startpagina. Voor een gebouwde versie: `npm run build` en `npm start`.

## Wat er in de app zit

| Adres | Wat |
| --- | --- |
| `/` | Startpagina in de MOZa-stijl, met vier keuzes |
| `/presentatie/index.html` | De presentatie over het fieldlab |
| `/scenario.html` | Scenario btw-aangifte: aangifte → automatische verwerking → fieldlab-beschikking (PDF) → plaatsen in het magazijn van de Belastingdienst; los daarvan een notificatie |
| `/portaal.html` | Portaal-mock: berichten bekijken zoals de ontvanger (`?magazijn=bld` voor het magazijn van de Belastingdienst) |
| `/werkscherm.html` | Werkscherm: losse berichten plaatsen en notificaties sturen, met logboek |
| `/instellingen.html` | Adressen van magazijn en NMC, zonder of met FSC |

De kaarten "Live demo" in de presentatie:

| Dia | Opent |
| --- | --- |
| Stap 2 · Bericht klaarzetten | het scenario btw-aangifte |
| Stap 3 · Kennisgeving (melding) | de stap notificatie sturen in het scenario |
| Stap 4 · Bericht lezen | de Portaal-mock, magazijn van de Belastingdienst |

## Aanroepen

| Actie | Aanroep |
| --- | --- |
| Bericht plaatsen | `POST {magazijn}/aanleveringen` met `afzender`, `ontvanger` (BSN of KVK), `onderwerp`, `inhoud` en optioneel bijlagen |
| Berichten ophalen | `GET {magazijn}/berichten` met header `X-Ontvanger` (bijvoorbeeld `KVK:90000013`) |
| Notificatie sturen | `POST {nmc}/api/nmc/v1/decentraal/notificaties` met `emailAdres`, `berichtType` en `berichtgegevens.voornaam` (het Demo template vraagt om een voornaam) |
| Statusmelding ontvangen | `POST /events`: de NMC meldt hier de bezorgstatus |

Elke aanroep krijgt een `traceparent`. Wat het werkscherm verstuurt en ontvangt, staat in het logboek (alleen in het geheugen, maximaal 100 regels).

## Instellen

Stel de adressen in op de pagina Instellingen of vooraf met omgevingsvariabelen. Instellingen die je op de pagina bewaart, komen in `instellingen.json` (niet in Git).

| Variabele | Betekenis |
| --- | --- |
| `MAGAZIJN_URL` | Adres van het berichtenmagazijn voor het werkscherm, tot en met `/api/v1` |
| `BLD_MAGAZIJN_URL` | Adres van het magazijn van de Belastingdienst voor het scenario (standaard magazijn B op het fieldlab) |
| `BLD_AFZENDER_OIN` | OIN van de Belastingdienst als afzender van het besluit (standaard `00000001823288444000`, uit het stelseldocument) |
| `RVO_MAGAZIJN_URL` | Adres van magazijn A (RVO), alleen lezen voor de berichtenbox (standaard magazijn A op het fieldlab) |
| `BUS_URL` | Adres van de berichtenuitvraag (BUS), tot en met `/api/v1` (standaard `https://demo.fbs.cluster-c.fieldlab2026.nl/api/v1`) |
| `NMC_URL` | Adres van de NMC, zonder pad |
| `MAGAZIJN_MODUS`, `NMC_MODUS` | `direct` (zonder FSC) of `fsc` (via de eigen Outway) |
| `OUTWAY_URL`, `MAGAZIJN_GRANT_HASH`, `NMC_GRANT_HASH` | Voor de verbinding met FSC |
| `MAGAZIJN_FSC_PAD`, `NMC_FSC_PAD` | Pad tussen het adres van de Outway en de aanroep (standaard `/api/v1` voor het magazijn, leeg voor de NMC) |
| `AFZENDER_OIN` | OIN van de nagebootste dienstverlener (standaard `00000000000000100000`) |
| `TERUGMELDADRES` | Adres waarop de NMC deze app bereikt; de app zet er `/events` achter |
| `WACHTWOORD`, `GEBRUIKER` | Zet de inlog aan (HTTP Basic). Zonder `WACHTWOORD` is er geen inlog. Gebruiker standaard `fieldlab`. `POST /events` blijft open voor de NMC |
| `POORT`, `HOST` | Standaard `3000` en `127.0.0.1` |

Adressen op het fieldlab (cluster-c): magazijn A (RVO) `https://berichtenmagazijn-a.fbs.cluster-c.fieldlab2026.nl/api/v1`, magazijn B (Belastingdienst) `https://berichtenmagazijn-b.fbs.cluster-c.fieldlab2026.nl/api/v1`, NMC `https://nmc.cluster-c.fieldlab2026.nl`.

## NMC aanroepen via FSC (testnet)

De app kan al via FSC werken: met `NMC_MODUS=fsc` stuurt hij de notificatie naar `{OUTWAY_URL}{NMC_FSC_PAD}/api/nmc/v1/decentraal/notificaties`, met de header `Fsc-Grant-Hash`. Wat er nog nodig is, zit in de FSC-inrichting:

1. **Aansluiten op het testnet.** Vraag bij de beheerder van de testnet-directory een peer-ID en een certificaat van de testnet-CA aan. Noteer het `group_id`.
2. **Eigen FSC-stack draaien** (Manager, Outway, Controller en Postgres), bijvoorbeeld met de open-source FSC-implementatie.
   - De Manager moet van buitenaf bereikbaar zijn op poort 8443 (mTLS): de Manager van de NMC stuurt zijn handtekening op het contract daarheen terug.
   - De Outway hoeft alleen bereikbaar te zijn voor deze app (op ZAD: een extra component in hetzelfde project). Hij moet uitgaand de Inway van de NMC (443) en de Managers (8443) kunnen bereiken.
3. **Nagaan of de NMC in de testnet-directory staat**, met servicenaam en peer-ID van de aanbieder. Staat hij er niet in, dan moet de beheerder van de NMC eerst een Inway neerzetten en de NMC publiceren. Dat ligt buiten dit project.
4. **Contract aanvragen** in de Controller: een ServiceConnectionGrant voor de NMC-service, met de thumbprint van het certificaat van de eigen Outway.
5. **De beheerder van de NMC accepteert het contract.** Daarna is het contract geldig.
6. **De app instellen**, met omgevingsvariabelen of op de pagina Instellingen:
   - `NMC_MODUS=fsc`
   - `OUTWAY_URL`: adres van de eigen Outway
   - `NMC_GRANT_HASH`: de grant-hash uit het geaccepteerde contract
   - `NMC_FSC_PAD`: leeg als de Inway de NMC vanaf de root doorstuurt, anders het pad dat ervoor moet
7. **Statusmeldingen.** De NMC stuurt CloudEvents rechtstreeks naar `TERUGMELDADRES` + `/events`, buiten FSC om. Dat adres moet voor de NMC bereikbaar blijven. Moeten ook de statusmeldingen via FSC lopen, dan is er meer nodig: een eigen Inway, `/events` publiceren als service en een contract met de NMC in de andere richting.
8. **Testen** via het werkscherm. In het logboek staat dan "via FSC-Outway". Bij een fout geeft FSC een `ERROR_CODE_…` in het antwoord: `SERVICE_NOT_FOUND` wijst op een verkeerde servicenaam of een verkeerd pad, `ACCESS_TOKEN_*` op een probleem met het contract of de grant.

## Uitrollen op ZAD

Bij elke wijziging op `main` bouwt GitHub Actions (`.github/workflows/deploy.yml`) een container-image (`ghcr.io/minbzk/fundament-dienstverlener`) en rolt het uit naar ZAD met [`RijksICTGilde/zad-actions`](https://github.com/RijksICTGilde/zad-actions), zoals bij moza-mock. Bij een pull request controleert `.github/workflows/controle.yml` de app en bouwt het image zonder het te publiceren.

Het uitrollen gebeurt pas als ZAD is ingericht. Daarvoor is nodig:

1. In ZAD Operations Manager: een project, een deployment en een component voor deze app. De container luistert op poort 8080.
2. In deze repository (Settings → Secrets and variables → Actions): het secret `ZAD_API_KEY` en de variabele `ZAD_PROJECT_ID`. Optioneel `ZAD_DEPLOYMENT` (standaard `dev`) en `ZAD_COMPONENT` (standaard `fundament-dienstverlener`).
3. Op de component in ZAD de omgevingsvariabelen: in elk geval `WACHTWOORD` (zonder inlog kan iedereen met het adres berichten plaatsen en notificaties laten versturen), de adressen van de diensten (`MAGAZIJN_URL`, `BLD_MAGAZIJN_URL`, `NMC_URL`) en `TERUGMELDADRES` met het eigen adres op ZAD, zodat de NMC statusmeldingen kan sturen.

Instellingen die je op de pagina Instellingen bewaart, gaan op ZAD verloren bij een nieuwe uitrol; de omgevingsvariabelen zijn daar leidend.

Zelf een image bouwen en draaien: `docker build -t fundament-dienstverlener .` en `docker run -p 8080:8080 -e WACHTWOORD=... fundament-dienstverlener`.

## PDF's

De app maakt twee soorten PDF's met `pdf-lib`: een testbijlage (`bijlage.ts`) en de fieldlab-beschikking (`beschikking.ts`). Elk is een kopie van een sjabloon in `testdata/` met de gegevens erin. Het sjabloon is afgedrukt uit een HTML-pagina in `testdata/` die zelf meet waar de gegevens moeten komen en dat in de titel van de PDF zet. De tekst wordt getekend in de vormen van RijksSans; dezelfde tekst staat er onzichtbaar onder, zodat je hem kunt selecteren en zoeken.

Sjabloon opnieuw maken: start de app (`npm run dev`) en druk `http://127.0.0.1:3000/testdata/beschikking.html` (of `testbijlage.html`) af op A4 zonder marges, in een venster dat even breed is als A4.

## Opbouw

- `server.ts`: stuurt de aanroepen door (een browser mag de diensten niet zelf aanroepen), maakt de PDF's, ontvangt statusmeldingen en houdt het logboek bij. In ontwikkelmodus draait Vite in dezelfde server.
- `public/presentatie/index.html`: de presentatie, één bestand waarin alles zit (ook afbeeldingen en het designsysteem).
- De pagina's van de app zijn gebouwd met [`@nldd/design-system`](https://github.com/NederlandseDigitaleDienst/design-system), lokaal geïnstalleerd: tijdens gebruik wordt niets van internet geladen.
- Controleren: `npm run build` (typecontrole) en `npm run lint` (`nldd lint`).

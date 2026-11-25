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
| `NODE_EXTRA_CA_CERTS` | Extra CA's die Node vertrouwt. Met FSC: de internal-CA van de eigen peer(s), want de app praat over TLS met de Outway |
| `AFZENDER_OIN` | OIN van de nagebootste dienstverlener (standaard `00000000000000100000`) |
| `TERUGMELDADRES` | Adres waarop de NMC deze app bereikt; de app zet er `/events` achter |
| `WACHTWOORD`, `GEBRUIKER` | Zet de inlog aan (HTTP Basic). Zonder `WACHTWOORD` is er geen inlog. Gebruiker standaard `fieldlab`. `POST /events` blijft open voor de NMC |
| `POORT`, `HOST` | Standaard `3000` en `127.0.0.1` |

Adressen op het fieldlab (cluster-c): magazijn A (RVO) `https://berichtenmagazijn-a.fbs.cluster-c.fieldlab2026.nl/api/v1`, magazijn B (Belastingdienst) `https://berichtenmagazijn-b.fbs.cluster-c.fieldlab2026.nl/api/v1`, NMC `https://nmc.cluster-c.fieldlab2026.nl`.

## NMC aanroepen via FSC

Met `NMC_MODUS=fsc` stuurt de app de notificatie naar `{OUTWAY_URL}{NMC_FSC_PAD}/api/nmc/v1/decentraal/notificaties`, met de header `Fsc-Grant-Hash`. Daarvoor staan op ZAD (project `funda-xeq`) twee eigen FSC-peers, elk in een andere FSC-groep en elk met een eigen contract met de NMC. De app gebruikt er één tegelijk: `OUTWAY_URL` en `NMC_GRANT_HASH` bepalen welke.

| | MOZa FSC-testnet | fsc-fieldlab (RINIS) |
| --- | --- | --- |
| Groep | `moza-fbs-test` | `fsc-fieldlab` |
| Directory | `00000000000000000010`, op ZAD ([moza-fsc-testnet](https://github.com/MinBZK/moza-fsc-testnet)) | `07000000000000000001`, `https://fsc-directory.cluster-a.fieldlab2026.nl:443` |
| Onze peer | `00000000000000900000`, "Fundament Dienstverlener" | `19000000000000000090`, "Fundament Dienstverlener" |
| ZAD-deployment | `fsc-dienstverlener`, componenten `dienstverlener-fsc…` | `fsc-fieldlab`, componenten `fieldlab-fsc…` |
| NMC | dienst `nmc` van `00000000000000000050` | dienst `nmc` van `19000000000000000010` |
| `OUTWAY_URL` | `https://fsc-dienstverlener-dienstverlener-fscoutway:8443` | `https://fsc-fieldlab-fieldlab-fscoutway:8443` |
| Certificaten | test-CA van het testnet (`pki/` in moza-fsc-testnet), sleutels in de geheime repo | group-certificaat van de certportal van RINIS, sleutels alleen in ZAD |

### Wisselen tussen de routes

Sinds 25 november 2026 gebruikt de app fsc-fieldlab. Wisselen kost één herstart van `frontend`:

```bash
# fsc-fieldlab
zadctl env set -c frontend 'OUTWAY_URL=https://fsc-fieldlab-fieldlab-fscoutway:8443' \
  'NMC_GRANT_HASH=$1$3$_SxbrXUiQ3W6phHlLAs4GLh1fXFfCp1Dih4B3N7NVGs_XbAkqwdRlZ6YcL1xrCIa7R1ZaP6vazTy7uTkoHCvQg'
# MOZa FSC-testnet
zadctl env set -c frontend 'OUTWAY_URL=https://fsc-dienstverlener-dienstverlener-fscoutway:8443' \
  'NMC_GRANT_HASH=$1$3$1X0p400AfrU2x-4GhPCMnzQn3hDWkKpiTHd89tEomECd8iDgWsiUggV85rtehfZnaRBtl8ZiM5Fcpi8lciAuYQ'
```

Gebruik enkele aanhalingstekens, anders vult de shell `$1` en `$3` in. Verder hoeft er niets te veranderen:

- `NODE_EXTRA_CA_CERTS=/etc/fsc/internal-roots.pem` (bijlage `fsc-internal-roots`) bevat de internal-CA van beide peers.
- `cross-domain-access` laat `frontend` (deployment `dev`) bij beide Outways op poort 8443: een `outbound`-regel bij `dev` en een `inbound`-regel bij elke FSC-deployment.

Terug zonder FSC: `NMC_MODUS=direct` en `NMC_URL`.

### Hoe de peers zijn opgezet

- Losse OpenFSC-componenten volgens `docs/peer-aansluiten.md` van moza-fsc-testnet: Postgres (volume van 500Mi), manager, controller en txlog (de `*-migrate`-images van moza-fsc-testnet) en de Outway, alle op OpenFSC v2.9.0. De groep fsc-fieldlab draait 2.9.1; dat gaat samen.
- De manager is gepubliceerd met passthrough, omdat FSC zelf mTLS doet. De Outway is alleen intern bereikbaar.
- De certificaten zijn bijlagen onder `/etc/fsc/`: `ca/` (group-CA), `out/<peer>/` (group) en `internal/<peer>/` (internal).
- fsc-fieldlab: de certportal `https://fsc-certportal.cluster-a.fieldlab2026.nl` tekent een CSR (`POST /api/request_certificate` met `{"csr": …}`) en geeft de group-CA (`GET /root.crt`). De OIN komt in `serialNumber`, de organisatie in `O`. De portal heeft geen authenticatie: alleen voor testen. Zijn de sleutels kwijt, vraag dan nieuwe certificaten aan; de thumbprint van de Outway verandert dan, dus er is ook een nieuw contract nodig.
- Het contract diende een tijdelijk component in met `ghcr.io/minbzk/fbs-fsc-contract-bootstrap` (`FSC_ROL=consumer`, zie `federatie/contracts/zad-runbook.md` in moza-poc-fbs-berichtenbox); daarna accepteerde de NMC het. Het component is weer verwijderd.

### Controleren

- Een lege notificatie (`POST /api/notificatie` met `{}`) verstuurt geen mail, maar laat zien of de route werkt: `400 Malformed request body` komt van de NMC zelf. Een fout van FSC heeft een `ERROR_CODE_…`, bijvoorbeeld `SERVICE_NOT_FOUND` (servicenaam of pad) of `ACCESS_TOKEN_*` (contract of grant).
- De transactie staat in het transactielog van de eigen controller, met hetzelfde transactie-ID als in de log van de Inway van de NMC.
- De controllers hebben geen inlog: wie de URL heeft, tekent contracten namens de peer. Publiceer ze alleen als het nodig is:

  ```bash
  zadctl service config set publish-on-web --target component --component <x>-fscctl --set tls=standard
  # weer weg
  zadctl service config clear publish-on-web --target component --component <x>-fscctl
  zadctl service unassign publish-on-web --component <x>-fscctl
  ```

### Valkuilen

- In fsc-fieldlab kwam het contract na het indienen niet bij de NMC aan. **Opnieuw accepteren** in de eigen controller verstuurt het opnieuw.
- De contract-bootstrap bleef `proposed` melden terwijl het contract al geldig was. Kijk naar de status in de controller.
- `zadctl logs` geeft maar een regel of tien, en de health-probe van de manager vult die.
- In fsc-fieldlab toont de controller van de NMC geen transacties: de operator van RINIS geeft de manager geen `txLogAPIAddress`. De Inway legt ze wel vast.
- Statusmeldingen lopen buiten FSC om, naar `TERUGMELDADRES` + `/events`. Zonder `TERUGMELDADRES` komen er geen.

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

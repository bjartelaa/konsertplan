# Konsertplan

Et verktøy der en konsertarrangør legger inn forutsetninger, saler med leievilkår og et program, og ser bidrag per konsert, nåverdi, finansieringsbehov og saldo måned for måned. Bygget til MET3 Arbeidskrav 2 ved NHH (Bjarte Laa, Petter Garli og Maxime Boudailliez) som en tilleggsvri til muntlig eksamen: casen krever at alle tolv konsertene går i samme sal, og Konsertplan viser hva som skjer om Maja i Sceneskift tenker konsert for konsert.

Sceneskift, salene og tallene er fiktive og laget for undervisning. Åpen nettside: https://bjartelaa.github.io/konsertplan/ (presentasjonen: https://bjartelaa.github.io/sceneskift-kart/site/).

## Åpne

Dobbeltklikk `index.html`. Siden trenger ikke nett og ingen server. Alt regnes i nettleseren og lagres i nettleserens lokale lager på maskinen. «Lagre sesong» gir en JSON-fil som kan åpnes igjen med «Åpne sesong», også på en annen maskin.

Fanene står i rekkefølgen Anbefaling, Resultater, Program, Saler, Forutsetninger, og kan lenkes direkte: `index.html#anbefaling` (første fane, åpnes uten lenke, `#raadet` virker fortsatt), `#resultater`, `#program`, `#saler`, `#forutsetninger`, og `#spor` åpner chatten. Fanen byttes også når bare #-delen av adressen endres mens siden er åpen. Knappen «Fullskjerm» øverst (eller tasten F utenfor skrivefelt) åpner siden i fullskjerm. Holder man over en graf, vises tallene for den måneden eller konserten. Åpnes siden fra presentasjonen (`index.html?fra=presentasjon#program`), vises «Tilbake til presentasjonen» øverst. Lenken går til `../sceneskift-kart/site/index.html`, så de to repoene må ligge i samme mappe. Uten `?fra=presentasjon` er lenken skjult. Med `&tilbake=slutt` går lenken rett til den siden (`#slutt`, avslutningen) i stedet for tilbake i historikken.

## Sceneskift 2027 er utgangspunktet

Siden åpner alltid med casen ferdig lagt inn: Majas forutsetninger, tilbudene fra Lune Sal (A), Søyleverket (B) og Skarvkaien (C), og de tolv konsertene med salget fra tilsvarende konsert i 2026. All redigering skjer oppå dette. Hvert felt kan settes tilbake til casen, og «Nullstill alt til Sceneskift 2027» henter alt på nytt.

B har fast sesongleie og kan bare velges som hel sesong («Alt i B»). Blanding per konsert skjer mellom A og C og merkes «utenfor casen», fordi avtalene i casen gjelder hele programmet.

«Beste blanding» i programmet velger den kombinasjonen av saler per konsert som gir høyest nåverdi og holder rammen (`besteBlanding` i `src/forslag.js`). Med A og C prøves alle 4 096 kombinasjonene. Med flere saler (for eksempel B uten «Kun hel sesong») er det for mange til å prøve alle. Da starter søket fra alt i hver sal, høyest bidrag per konsert og beste blanding av salene uten fast leie, og bytter sal på én og én konsert så lenge det blir bedre. Kontrollert mot alle 531 441 kombinasjoner for seks oppsett av B: samme svar i alle. For 2027 gir den C A A C C C A A C C A C: nåverdi 192 021 kr og behov 223 068 kr, mot 173 787 og 216 696 for alt i C. Holder ingen kombinasjon rammen, velges den med høyest nåverdi likevel, og programmet får en merknad om at den går over rammen (og at avstå er bedre når nåverdien er negativ). Merknaden blir borte når sal, oppsett eller salg endres.

Sitteplasser er ikke oppgitt i tilbudene. B 250 og C 200 er antatt og merket slik. A regnes som sittende sal med 250 plasser (nettsiden sier 270 seter).

## Scenarioer og lokaleeffekt

Resultater starter med scenariovelgeren fra arbeidsboka: Basis (100 % av 2026-salget, 60 000 kr per konsert), Lav etterspørsel (80 %), Høyere pakkepris (66 000 kr), Samlet (80 % og 66 000 kr) og Høy etterspørsel (120 %, en oppside som ikke inngår i beslutningsreglene). Et scenario setter etterspørselsfaktoren og pakkeprisen, med begrunnelsen fra arbeidsboka under. Det finnes ingen egen «aktivt scenario»-tilstand: det aktive scenarioet er det som stemmer med verdiene akkurat nå (`aktivtScenario` i `src/motor.js`). Flyttes en glider, viser siden «Egne verdier». Scenarioene ligger i `sesong.scenarioer` og lagres med sesongen.

Konsekvenstabellen under gliderne viser nåverdi og finansieringsbehov for hver handling (alt i hver sal, egen plan når den blander, og avstå) i alle scenarioene samtidig, og hvilke som holder rammen. Testene krever at alle fem scenarioene treffer arbeidsboka på kronen.

Lokaleeffekt per sal (`sal.lokaleeffekt`, standard 100 %) står på salkortet under Saler og tilsvarer Forutsetninger D52:D54 i arbeidsboka: salget i salen i forhold til etterspørselen, med taket i salen som før. Det er gruppas egen følsomhet, ikke casens premiss, og Resultater viser en merknad så lenge en sal har noe annet enn 100 %. Testet mot datatabellen i arbeidsboka (B og C 70 % og 50 %, A 110 %, A med fullt hus 155 704 kr) og grensen der C blir like god som A (85,44 %, behov 229 001 kr).

## Hva snur rådet

Øverst i Resultater står de tre beslutningsreglene fra arbeidsboka og grensene der svaret snur (`beslutningsregler` og `grenser` i `src/motor.js`). Handlingene er alt i hver sal, egen plan når den blander, og avstå. Alle reglene rangerer etter nåverdien med verdiene som gjelder nå (scenario eller glidere). Regel 1 (robust) krever i tillegg at rammen holder i alle scenarioene utenom oppsider, regel 2 (verdi) at den holder nå, regel 3 ser bort fra rammen. Avstå har nåverdi null og holder alltid rammen, så reglene velger avstå når resten gir tap. I casen gir det avstå, C og B.

Grensene finnes med halveringssøk i motoren (`finnGrense`), ikke med datatabell og interpolasjon som i arbeidsboka: etterspørselen der nåverdien blir negativ, etterspørselen der behovet går over rammen (med pakkeprisen som gjelder nå), og pakkeprisen der behovet går over rammen (med etterspørselen som gjelder nå). Under hvert tall står avstanden fra der vi er nå, i billetter for hele sesongen (som Resultater F85 i arbeidsboka) eller i kroner. «Alltid» betyr at handlingen er på feil side uansett (B går over rammen selv med fullt hus), «aldri» at grensen ikke finnes. Testene krever A 86,7 %, B 80,8 % og C 79,8 % for nåverdien, A 83,0 % og C 75,9 % for rammen, og pakkegrensen for C 66 661 kr ved 100 % salg og 61 377 kr ved 80 %. A avviker 0,02 prosentpoeng fra arbeidsboka fordi kurven har en knekk ved 86,2 % (konsert 12 treffer taket) inne i interpolasjonssteget.

## Anbefaling (tidligere Rådet)

Første fane er rådet til Maja på hennes språk, regnet av motoren (`raadet` i `src/motor.js`). Regelen er den i beslutningsnotatet: høyest nåverdi blant handlingene som holder rammen både med verdiene nå og ved 20 % lavere salg. Pakkeprisen kjenner Maja før hun signerer, så den er et vilkår og ikke en del av regelen. I casen gir det C, med tre vilkår: rammen er bekreftet (C trenger 216 696 kr, 240 361 kr ved 20 % lavere salg), pakken er bekreftet (ved 20 % lavere salg holder C bare under 61 377 kr), og 450 plasser er salgbare. Gir regelen avstå, viser fanen hva som kan snu det.

Anbefaling er hjemskjermen. Over anbefalingen ligger scenario-brikkene (øverst, så de står stille når teksten i rådet endrer lengde), og «Finjuster i Resultater» går rett til gliderne. Under anbefalingen ligger (samme scenarioer som i Resultater) og fire nøkkeltall for rådet, hvert med en liten måler: verdien, hva dere må ha klart mot rammen, hvor langt salget kan falle (79,8 % før C taper penger, 75,9 % før rammen ryker), og pakkeprisen der rammen ryker ved 20 % lavere salg. Deretter kontoen måned for måned ved siden av alle valgene med verdi og hva de krever. Resten er utfellbart: «Hva tallene betyr» (nåverdi og finansieringsbehov uten fagord), når rådet snur (blant annet startfinansieringen som gir et annet råd: 372 120 kr gir B), praksisvinkelen «Artisten bestemmer salen» med beste blanding per konsert, og «Der vi går utenfor casen»: tabell over alt vi legger til utover casen, med verdien i casen, verdien nå og hva det gjør med rådet.

Utvidelsene utenfor casen har standard 0, fordi oppgaveteksten sier at det utover postene i tabellen og lokaleleien ikke er andre inntekter eller kostnader:

- Bar: omsetning per gjest (`barPerGjest`) og Sceneskifts andel (`barAndel`). Inn måneden etter konserten, som billettene. Snur ikke rådet i casen, fordi B er over rammen allerede i januar, før det første oppgjøret kommer. 10 kr per gjest til Sceneskift gir C 32 994 kr mer i nåverdi.
- Uforutsette kostnader (`uforutsett`), kr per konsert i konsertmåneden, for det pakken ikke dekker. C tåler 1 606,5 kr per konsert før den ikke holder rammen ved 20 % lavere salg (bunnen er i mars, 9 639 kr under rammen etter seks konserter).
- Ekstra markedsføring (`markedsforing`), kr for hele sesongen, fordelt likt på konsertene og betalt måneden før. Tenkt brukt sammen med Høy etterspørsel (Petters innspill 17.11: høy etterspørsel kommer sjelden uten tiltak).
- Pakkepris per konsert (`konsert.pakkeAvvik`): avviket fra sesongens pakke, endres i kolonnen Pakke i Programmet. Ligger oppå scenarioets pakke.

Alle endres under Anbefaling og Forutsetninger. Resultater og Rådet viser en merknad så lenge en av dem er i bruk.

## Spør: chatbot for Maja

Gaffarullen nede til høyre åpner chatpanelet fra alle fanene (lenker til `#spor` åpner det også). Der kan Maja stille spørsmål med egne ord. Svarene skrives av en språkmodell (Claude Opus 5.5 fra Anthropic, `claude-opus-5-5`), men modellen regner ikke selv. Arbeidsdelingen er den foreleser beskrev 4.11: motoren regner, språkmodellen formidler (`src/chat.js`).

1. Modellen får forutsetningene og resultatene fra motoren som JSON (`tilstand`): rådet, verdi og «må ha klart» for hvert valg nå og ved 20 % lavere salg, når rådet snur, grensene, reglene fra arbeidsboka og programmet. Forskjeller den trenger (over eller under rammen, mot rådet) er regnet ferdig. Tallene sendes med Majas første spørsmål og på nytt bare når planen er endret.
2. Spør Maja «hva om», bruker modellen verktøyet `prov_endring` (salg, pakke, startfinansiering, billettpris, scenario, og utenfor casen: bar, uforutsette kostnader, lokaleeffekt, sal, salg, oppsett og pakke per konsert). Verktøyet endrer en kopi av planen, motoren regner, og modellen får tallene før og etter. Ugyldige verdier avvises med en feilmelding til modellen, og ingenting regnes.
3. Under svaret viser siden selv hva Konsertplan regnet (endringen, verdi og «må ha klart» før og etter, og om rådet snur), med knappen «Bruk i planen». Majas plan endres bare når hun trykker.

Instruksen (`SYSTEM`) sier at modellen aldri skal regne, bare bruke tallene den har fått, svare kort på Majas språk uten fagord, ikke gi et annet råd enn Konsertplan, og si fra når noe er utenfor casen.

API-nøkkelen limes inn i fanen og lagres bare i nettleserens lokale lager på maskinen, under en egen nøkkel (`konsertplan.anthropic.nokkel`). Den er aldri med i sesongen, i «Lagre»-fila eller i repoet, og en test sjekker at ingen fil i repoet har noe som ligner en nøkkel. Kallet går rett fra nettleseren til `api.anthropic.com` med hodet `anthropic-dangerous-direct-browser-access`, fordi siden ikke har noen server. Det er greit fordi nøkkelen er brukerens egen. Lag en egen nøkkel med lav brukergrense til dette. Samtalen ligger bare i minnet og forsvinner når siden lastes på nytt.

Valg i kallet: adaptiv tenkning, `effort: "low"` (korte svar, tallene kommer fra motoren), `fallbacks: "default"` (avslår modellen, prøver API-et en annen modell) og ingen tvunget verktøybruk (gir feil på denne modellen). Avslag, nettfeil og feil fra API-et vises på norsk, og samtalen settes da tilbake til før spørsmålet.

Testene (`test/chat.test.js`) bruker en falsk modell og et falskt `fetch`, og stopper alt nett. De sjekker at verktøyet treffer scenarioene i arbeidsboka på kronen, at verktøysvaret som går tilbake til modellen har motorens tall, at Majas plan ikke endres, hodene i kallet, at nøkkelen bare ligger i hodet, og feilhåndteringen. Med ekte nøkkel er chatten ikke testet i denne versjonen.

## Reglene

Fra oppgaveteksten og arbeidsboka `Sceneskift_AK2_modell.xlsx`. Per konsert i måned m med N betalte billetter: oppgjør N × (350 − 10) i måned m + 1, publikumsutgift N × 10 i måned m, pakke 30 000 måneden før og 30 000 i konsertmåneden. Leie etter salens byggeklosser: fast beløp per konsert, andel av oppgjøret med minimum, engangsbeløp, eller sesongleie med betalingsplan. Nåverdi med (1,04)^(t/12). Finansieringsbehov er laveste saldo ved månedsslutt.

Lån ut over rammen (utvidelse, `laanPlan` i `src/motor.js`, egen modul i Resultater): ligger behovet over rammen, må det som mangler lånes. To typer: kassekreditt (standard) trekker bare det saldoen ligger under rammen ved hvert månedsslutt og betales ned av seg selv, og fast lån (`laanType: "fast"`) tas opp ved slutten av en valgt måned (`laanStart`, 0 = før januar) med et beløp (`laanBelop`, tomt = det største som trengs) og betales tilbake i en valgt måned (`laanSlutt`, tomt = når saldoen er innenfor rammen igjen). Det et fast lån ikke dekker, går på kassekreditt. Renten (12 % p.a., gruppas antakelse) regnes per måned på det som er lånt. Saldoen, behovet og casens nåverdi er uendret; når et valg trenger lån, viser siden nåverdien etter rente (rentene diskontert og trukket fra), slik gruppa bestemte 17.11. Regel 3 rangerer etter nåverdi etter rente. I casen: kassekreditt for B gir 1 559 kr i rente og 199 846 kr etter rente, fast lån fra før januar 2 644 kr og 198 763 kr.

Kontrolltallene (basis): nåverdi A 51 324, B 201 394, C 173 787 kr, behov A 231 900, B 316 100, C 216 696 kr. Testene i `test/` krever at motoren treffer disse på kronen.

## Filer

- `index.html`, `css/konsertplan.css`: siden
- `src/motor.js`: regnemotoren, uten DOM. Også scenarioene (`aktivtScenario`, `velgScenario`, `beregnScenarioer`), hva som snur rådet (`handlinger`, `finnGrense`, `grenser`, `beslutningsregler`) og rådet for Maja (`raadet`, `lokaleeffektGrense`, utvidelsene `pakkeFor`, `barTilSceneskift`, `utvidelserIBruk`)
- `src/forslag.js`: sjangerregelen (sjanger gir oppsett, forventet salg gir sal)
- `src/standard-2027.js`: Sceneskift 2027 som standardsesong, med de fem scenarioene fra arbeidsboka
- `src/chat.js`: chatboten (tilstand fra motoren, verktøyet `prov_endring`, samtalen og kallet mot API-et), uten DOM
- `src/lagring.js`, `src/figurer.js`, `src/app.js`: lagring, SVG-figurer, grensesnitt
- `konsertplan.js`: alle modulene slått sammen til én fil, så siden virker rett fra fil. Generert, ikke rediger
- `img/`: salbildene er hentet fra case-nettsidene (alu042.github.io/met3-lune-sal, met3-soyleverket, met3-skarvkaien). `publikum.jpg` er Bjartes eget

## Utvikle

Lenkene til `css/konsertplan.css` og `konsertplan.js` i `index.html` har `?v=<dato><bokstav>`. Bytt det ved hver publisering, så nettleseren ikke blander ny side med gamle filer fra hurtiglageret.

```
node --test            # kjører testene
node scripts/bygg.js   # bygger konsertplan.js på nytt etter endringer i src/
```

Ingen avhengigheter. Node 20 eller nyere.

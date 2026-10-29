# Konsertplan

Et verktøy der en konsertarrangør legger inn forutsetninger, saler med leievilkår og et program, og ser bidrag per konsert, nåverdi, finansieringsbehov og saldo måned for måned. Bygget til MET3 Arbeidskrav 2 ved NHH (Bjarte Laa, Petter Garli og Maxime Boudailliez) som en tilleggsvri til muntlig eksamen: casen krever at alle tolv konsertene går i samme sal, og Konsertplan viser hva som skjer om Maja i Sceneskift tenker konsert for konsert.

Sceneskift, salene og tallene er fiktive og laget for undervisning. Privat til etter innleveringsfristen 13.11.2026.

## Åpne

Dobbeltklikk `index.html`. Siden trenger ikke nett og ingen server. Alt regnes i nettleseren og lagres i nettleserens lokale lager på maskinen. «Lagre sesong» gir en JSON-fil som kan åpnes igjen med «Åpne sesong», også på en annen maskin.

Fanene kan lenkes direkte: `index.html#program`, `#resultater`, `#saler`, `#forutsetninger`.

## Sceneskift 2027 er utgangspunktet

Siden åpner alltid med casen ferdig lagt inn: Majas forutsetninger, tilbudene fra Lune Sal (A), Søyleverket (B) og Skarvkaien (C), og de tolv konsertene med salget fra tilsvarende konsert i 2026. All redigering skjer oppå dette. Hvert felt kan settes tilbake til casen, og «Nullstill alt til Sceneskift 2027» henter alt på nytt.

B har fast sesongleie og kan bare velges som hel sesong («Alt i B»). Blanding per konsert skjer mellom A og C og merkes «utenfor casen», fordi avtalene i casen gjelder hele programmet.

Sitteplasser er ikke oppgitt i tilbudene. B 250 og C 200 er antatt og merket slik. A regnes som sittende sal med 250 plasser (nettsiden sier 270 seter).

## Reglene

Fra oppgaveteksten og arbeidsboka `Sceneskift_AK2_modell.xlsx`. Per konsert i måned m med N betalte billetter: oppgjør N × (350 − 10) i måned m + 1, publikumsutgift N × 10 i måned m, pakke 30 000 måneden før og 30 000 i konsertmåneden. Leie etter salens byggeklosser: fast beløp per konsert, andel av oppgjøret med minimum, engangsbeløp, eller sesongleie med betalingsplan. Nåverdi med (1,04)^(t/12). Finansieringsbehov er laveste saldo ved månedsslutt.

Lån ut over rammen (utvidelse): ligger behovet over rammen, regnes det som en kassekreditt på det saldoen ligger under rammen ved hvert månedsslutt, med rente per måned (12 % p.a. er gruppas antakelse, kan endres under Forutsetninger). Renten holdes utenfor nåverdien og vises som egen linje, sammen med nåverdi etter rente.

Kontrolltallene (basis): nåverdi A 51 324, B 201 394, C 173 787 kr, behov A 231 900, B 316 100, C 216 696 kr. Testene i `test/` krever at motoren treffer disse på kronen.

## Filer

- `index.html`, `css/konsertplan.css`: siden
- `src/motor.js`: regnemotoren, uten DOM
- `src/forslag.js`: sjangerregelen (sjanger gir oppsett, forventet salg gir sal)
- `src/standard-2027.js`: Sceneskift 2027 som standardsesong
- `src/lagring.js`, `src/figurer.js`, `src/app.js`: lagring, SVG-figurer, grensesnitt
- `konsertplan.js`: alle modulene slått sammen til én fil, så siden virker rett fra fil. Generert, ikke rediger
- `img/`: salbildene er hentet fra case-nettsidene (alu042.github.io/met3-lune-sal, met3-soyleverket, met3-skarvkaien). `publikum.jpg` er Bjartes eget

## Utvikle

```
node --test            # kjører testene
node scripts/bygg.js   # bygger konsertplan.js på nytt etter endringer i src/
```

Ingen avhengigheter. Node 20 eller nyere.

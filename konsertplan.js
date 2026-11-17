// Generert av scripts/bygg.js fra src/. Rediger kildene, ikke denne fila.
(() => {
"use strict";

// ---- src/motor.js ----
// Regnemotor for Konsertplan. Ingen DOM, ingen avhengigheter.
// Reglene følger oppgaveteksten til MET3 AK2 og skript/fasit.py i arbeidsmappa.
//
// Tidslinje: t = 0 er like før første måned (ikke diskontert). t = 1 er slutten av
// måned 1, og så videre. Siste tidspunkt er måneden etter siste konsert, når
// billettoppgjøret kommer, eller senere hvis en leiebyggekloss forfaller senere.
//
// Per konsert i måned m med N betalte billetter:
//   billettoppgjør   + N × (billettpris − gebyr)      i m + 1
//   publikumsutgift  − N × utgiftPerBillett          i m
//   pakke, del 1     − pakke × pakkeDel1Andel        i m − 1 (t0 for første måned)
//   pakke, del 2     − pakke × (1 − pakkeDel1Andel)  i m
//   leie             etter salens byggeklosser
//   N = min(forventetSalg × etterspørselsfaktor × salens lokaleeffekt, plasser i salen)
//
// Utvidelser utenfor casen. Alle har standard 0 og gir da casens tall, fordi oppgaveteksten sier at det
// utover postene i tabellen og lokaleleien ikke er andre inntekter eller kostnader:
//   bar              + N × sesong.barPerGjest × sesong.barAndel   i m + 1 (gjøres opp som billettene)
//   uforutsett       − sesong.uforutsett                          i m (kostnader pakken ikke dekker)
//   pakke per konsert: pakken for konserten er sesong.pakke + konsert.pakkeAvvik
//
// Byggeklosser for leie (sal.leie er en liste):
//   { type: "perKonsert", belop, naar }                 naar: "konsertmaaned" | "maanedEtter" | "maanedFoer"
//   { type: "andel", andel, minimum, naar }             andel av billettoppgjøret etter gebyr, minst minimum per konsert
//   { type: "engang", belop, tidspunkt }                én betaling for hele sesongen
//   { type: "sesong", belop, plan: [{tidspunkt, andel}] } fast sesongleie med betalingsplan
// Engang og sesong betales én gang hvis salen er i bruk på minst én konsert.

const NAAR = { konsertmaaned: 0, maanedEtter: 1, maanedFoer: -1 };

function kapasitet(sal, oppsett) {
  const k = sal.kapasitet?.[oppsett];
  return typeof k === "number" && k > 0 ? k : null;
}

/** Antall betalte billetter for en konsert i en gitt sal og oppsett. */
function billetter(sesong, konsert, sal, oppsett = konsert.oppsett) {
  const faktor = sesong.etterspoerselsfaktor ?? 1;
  // Lokaleeffekt (arbeidsboka Forutsetninger D52:D54): salget i salen i forhold til etterspørselen.
  // 100 % er Majas premiss, lokalet påvirker ikke salget. Taket i salen gjelder uansett.
  const lokal = sal?.lokaleeffekt ?? 1;
  const onsket = (konsert.forventetSalg ?? 0) * faktor * lokal;
  const kap = kapasitet(sal, oppsett);
  if (kap === null) return { n: 0, onsket, kap: null, kappet: onsket > 0, mulig: false };
  const n = Math.min(onsket, kap);
  return { n, onsket, kap, kappet: onsket > kap, mulig: true };
}

/** Leie som avhenger av konserten (perKonsert og andel), udiskontert. */
function leieForKonsert(sesong, sal, n) {
  const oppgjoer = n * (sesong.billettpris - sesong.gebyr);
  let sum = 0;
  const deler = [];
  for (const b of sal.leie ?? []) {
    if (b.type === "perKonsert") { sum += b.belop; deler.push({ ...b, belop: b.belop }); }
    else if (b.type === "andel") {
      const belop = Math.max(b.minimum ?? 0, (b.andel ?? 0) * oppgjoer);
      sum += belop; deler.push({ ...b, belop, minimumSlaarInn: belop > (b.andel ?? 0) * oppgjoer });
    }
  }
  return { sum, deler };
}

/** Faste leiebetalinger for sesongen (engang og sesong), som liste av {tidspunkt, belop, type}. */
function fasteLeiebetalinger(sal) {
  const ut = [];
  for (const b of sal.leie ?? []) {
    if (b.type === "engang") ut.push({ tidspunkt: b.tidspunkt ?? 0, belop: b.belop, type: b.type });
    else if (b.type === "sesong") for (const p of b.plan ?? []) ut.push({ tidspunkt: p.tidspunkt, belop: b.belop * p.andel, type: b.type });
  }
  return ut;
}

/** Pakken for én konsert: sesongens pakke pluss konsertens avvik (utvidelse, standard 0). */
function pakkeFor(sesong, konsert) {
  return (sesong.pakke ?? 0) + (konsert.pakkeAvvik ?? 0);
}

/** Barinntekt til Sceneskift per betalt billett: omsetning per gjest × Sceneskifts andel (utvidelse, standard 0). */
function barTilSceneskift(sesong) {
  return (sesong.barPerGjest ?? 0) * (sesong.barAndel ?? 0);
}

/** Utvidelsene utenfor casen som er i bruk nå (ulik 0), til merknader i grensesnittet. */
function utvidelserIBruk(sesong, program) {
  const ut = [];
  if (barTilSceneskift(sesong)) ut.push("bar");
  if (sesong.uforutsett) ut.push("uforutsett");
  if (program.some(k => k.pakkeAvvik)) ut.push("pakkeAvvik");
  return ut;
}

function fastLeieSum(sal) {
  return fasteLeiebetalinger(sal).reduce((s, p) => s + p.belop, 0);
}

function diskonteringsfaktor(sesong, t) {
  const r = sesong.rente ?? 0;
  if (t === 0) return 1;
  return sesong.konvensjon === "maaned" ? 1 / (1 + r / 12) ** t : 1 / (1 + r) ** (t / 12);
}

/** Siste tidspunkt på tidslinja for et program og de salene som brukes. */
function sisteTidspunkt(program, salerIBruk) {
  let T = 1;
  for (const k of program) T = Math.max(T, k.maaned + 1); // oppgjøret kommer i m + 1
  for (const s of salerIBruk) {
    for (const b of s.leie ?? []) {
      if (b.type === "engang") T = Math.max(T, b.tidspunkt ?? 0);
      if (b.type === "sesong") for (const p of b.plan ?? []) T = Math.max(T, p.tidspunkt);
      if ((b.type === "perKonsert" || b.type === "andel") && NAAR[b.naar] === 1) for (const k of program) T = Math.max(T, k.maaned + 1);
    }
  }
  return T;
}

/**
 * Beregner en plan der salVelger(konsert) gir salen for hver konsert.
 * Returnerer kontantstrøm per tidspunkt, saldo, netto, nåverdi, finansieringsbehov og tall per konsert.
 */
function beregnPlan(sesong, saler, program, salVelger) {
  const salAv = new Map(saler.map(s => [s.id, s]));
  const valgt = program.map(k => {
    const s = salVelger(k);
    return typeof s === "string" ? salAv.get(s) : s;
  });
  const salerIBruk = [...new Set(valgt.filter(Boolean))];
  const T = sisteTidspunkt(program, salerIBruk);
  const cf = new Array(T + 1).fill(0);
  const linjer = { billetter: cf.slice(), utgift: cf.slice(), pakke: cf.slice(), leie: cf.slice(), bar: cf.slice(), uforutsett: cf.slice() };
  const legg = (linje, t, belop) => { const i = Math.max(0, Math.min(T, t)); cf[i] += belop; linjer[linje][i] += belop; };

  const del1 = sesong.pakkeDel1Andel ?? 0.5;
  const barPerBillett = barTilSceneskift(sesong);
  const uforutsett = sesong.uforutsett ?? 0;
  const perKonsert = program.map((k, i) => {
    const sal = valgt[i];
    const m = k.maaned;
    const pakke = pakkeFor(sesong, k);
    if (!sal) return { nr: k.nr, sal: null, n: 0, mulig: false, kappet: false, billettnetto: 0, utgift: 0, pakke, leie: 0, bar: 0, uforutsett: 0, bidrag: -pakke };
    const b = billetter(sesong, k, sal);
    const n = b.n;
    const billettnetto = n * (sesong.billettpris - sesong.gebyr);
    const utgift = n * sesong.utgiftPerBillett;
    const bar = n * barPerBillett;
    legg("billetter", m + 1, billettnetto);
    legg("utgift", m, -utgift);
    legg("pakke", m - 1, -pakke * del1);
    legg("pakke", m, -pakke * (1 - del1));
    if (bar) legg("bar", m + 1, bar);
    if (uforutsett) legg("uforutsett", m, -uforutsett);
    const leie = leieForKonsert(sesong, sal, n);
    for (const d of leie.deler) legg("leie", m + (NAAR[d.naar] ?? 0), -d.belop);
    return { nr: k.nr, sal: sal.id, n, onsket: b.onsket, kap: b.kap, mulig: b.mulig, kappet: b.kappet,
             billettnetto, utgift, pakke, leie: leie.sum, leieDeler: leie.deler, bar, uforutsett,
             bidrag: billettnetto - utgift - pakke - leie.sum + bar - uforutsett };
  });

  const faste = [];
  for (const s of salerIBruk) for (const p of fasteLeiebetalinger(s)) { legg("leie", p.tidspunkt, -p.belop); faste.push({ sal: s.id, ...p }); }

  const saldo = [];
  let s = 0;
  for (const c of cf) { s += c; saldo.push(s); }
  const nv = cf.reduce((sum, c, t) => sum + c * diskonteringsfaktor(sesong, t), 0);
  const netto = cf.reduce((a, b) => a + b, 0);
  const behov = Math.max(0, -Math.min(...saldo));
  const fastLeie = faste.reduce((a, p) => a + p.belop, 0);
  // Lån ut over rammen: det saldoen ligger under rammen ved hvert månedsslutt, som en kassekreditt.
  // Renten regnes per måned på trukket beløp og holdes utenfor nåverdien, slik casen krever.
  // Den vises som egen linje, og «nåverdi etter rente» diskonterer rentebetalingene på samme måte.
  const ramme = sesong.ramme ?? Infinity;
  const trekk = saldo.map(s => Math.max(0, -s - ramme));
  const renteMnd = sesong.laanRente ?? 0;
  const renter = trekk.map(t => t * renteMnd / 12);
  const laan = Math.max(0, ...trekk);
  const rentekostnad = renter.reduce((a, b) => a + b, 0);
  const nvEtterRente = nv - renter.reduce((sum, r, t) => sum + r * diskonteringsfaktor(sesong, t), 0);
  return { T, cf, linjer, saldo, netto, nv, behov, perKonsert, faste, fastLeie,
           holderRammen: sesong.ramme == null ? null : behov <= sesong.ramme,
           laan, trekk, renter, rentekostnad, nvEtterRente, maanederMedLaan: trekk.filter(t => t > 0).length,
           salerIBruk: salerIBruk.map(x => x.id) };
}

/** Alt i én sal: samme sal på alle konsertene, med konsertens oppsett der salen kan, ellers det andre oppsettet. */
function beregnAltI(sesong, saler, program, sal) {
  const tilpasset = program.map(k => {
    if (kapasitet(sal, k.oppsett) !== null) return k;
    const annet = k.oppsett === "sitte" ? "staa" : "sitte";
    return kapasitet(sal, annet) !== null ? { ...k, oppsett: annet, oppsettByttet: true } : k;
  });
  return beregnPlan(sesong, saler, tilpasset, () => sal);
}

/** Alle resultatene: «alt i <sal>» for hver sal, egen plan og avstå. */
function beregnAlle(sesong, saler, program) {
  const altI = {};
  for (const s of saler) altI[s.id] = beregnAltI(sesong, saler, program, s);
  const egen = beregnPlan(sesong, saler, program, k => k.salId);
  const blandet = new Set(program.map(k => k.salId)).size > 1;
  return { altI, egen, blandet, avstaa: { nv: 0, netto: 0, behov: 0, holderRammen: true, laan: 0, rentekostnad: 0, nvEtterRente: 0, maanederMedLaan: 0 } };
}

/* ---------- Scenarioer ----------
 * Et scenario setter to forutsetninger: etterspørselsfaktoren og pakkeprisen (som arket Forutsetninger
 * i arbeidsboka). Det finnes ingen egen «aktiv scenario»-tilstand: det aktive scenarioet er det som
 * stemmer med verdiene akkurat nå. Endres en glider, stemmer ingen, og siden viser «Egne verdier».
 */
const lik = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < 1e-9;

/** Scenarioet som stemmer med sesongens etterspørselsfaktor og pakkepris, eller null. */
function aktivtScenario(sesong) {
  return (sesong.scenarioer ?? []).find(sc => lik(sc.etterspoerselsfaktor, sesong.etterspoerselsfaktor ?? 1) && lik(sc.pakke, sesong.pakke)) ?? null;
}

/** Setter scenarioets verdier på sesongen (endrer objektet) og returnerer det. */
function velgScenario(sesong, scenario) {
  sesong.etterspoerselsfaktor = scenario.etterspoerselsfaktor;
  sesong.pakke = scenario.pakke;
  return sesong;
}

/** Alle resultatene for hvert scenario: [{ scenario, res }], der res er beregnAlle med scenarioets verdier. */
function beregnScenarioer(sesong, saler, program) {
  return (sesong.scenarioer ?? []).map(scenario => ({ scenario, res: beregnAlle(velgScenario({ ...sesong }, scenario), saler, program) }));
}

/** Dyp kopi uten funksjoner, til lagring og «tilbake til casen». */
const kopi = x => JSON.parse(JSON.stringify(x));

/* ---------- Hva snur rådet: grenser og beslutningsregler ----------
 * Grensene finnes med halveringssøk i motoren, ikke med datatabell og interpolasjon som i arbeidsboka.
 * Derfor kan en grense avvike med noen hundredels prosentpoeng fra arbeidsboka der kurven har en knekk
 * (en konsert treffer taket i salen) inne i et interpolasjonssteg.
 */

/** Handlingene som sammenlignes: alt i hver sal, egen plan når den blander, og avstå. hent(sesong) regner handlingen med en variant av sesongen. */
function handlinger(sesong, saler, program) {
  const ut = saler.map(s => ({ id: s.id, navn: s.navn, kort: s.kort, farge: s.farge, type: "sal",
                               hent: v => beregnAltI(v, saler, program, s) }));
  if (new Set(program.map(k => k.salId)).size > 1) ut.push({ id: "egen", navn: "Egen plan", type: "egen", farge: "gronn", hent: v => beregnPlan(v, saler, program, k => k.salId) });
  ut.push({ id: "avstaa", navn: "Avstå", type: "avstaa", farge: "graa", hent: () => ({ nv: 0, behov: 0, holderRammen: true }) });
  return ut;
}

/**
 * Halveringssøk etter punktet der ok(x) går fra usann (ved lo) til sann (ved hi).
 * Returnerer { verdi, status }: status "grense" med verdien, "aldri" hvis ok allerede ved lo (grensen finnes ikke
 * i intervallet), "alltid" hvis ok heller ikke ved hi.
 */
function finnGrense(ok, lo, hi, iter = 45) {
  if (ok(lo)) return { verdi: null, status: "aldri" };
  if (!ok(hi)) return { verdi: null, status: "alltid" };
  for (let i = 0; i < iter; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
  return { verdi: (lo + hi) / 2, status: "grense" };
}

const FULLT_HUS = 10; // etterspørselsfaktor så høy at alle salene er fulle på alle konsertene

/**
 * Grensene for hver handling, med de andre forutsetningene som de er nå:
 *   nvNegativUnder:   etterspørselsfaktoren der nåverdien blir negativ (lavere salg gir tap)
 *   overRammenUnder:  etterspørselsfaktoren der finansieringsbehovet går over rammen
 *   pakkeOverRammen:  pakkeprisen der behovet går over rammen (høyere pakke gir brudd)
 * status "aldri" betyr at grensen ikke finnes (for eksempel: holder rammen selv uten salg), "alltid" at handlingen
 * er på feil side uansett (B går over rammen selv med fullt hus). Avstå tas ikke med.
 */
function grenser(sesong, saler, program) {
  const ramme = sesong.ramme;
  const sumSalg = program.reduce((a, k) => a + (k.forventetSalg ?? 0), 0);
  return handlinger(sesong, saler, program).filter(hd => hd.type !== "avstaa").map(hd => {
    const vedSalg = x => hd.hent({ ...sesong, etterspoerselsfaktor: x });
    const vedPakke = p => hd.hent({ ...sesong, pakke: p });
    const naa = hd.hent(sesong);
    const nvNegativUnder = finnGrense(x => vedSalg(x).nv >= 0, 0, FULLT_HUS);
    const overRammenUnder = ramme == null ? { verdi: null, status: "aldri" } : finnGrense(x => vedSalg(x).behov <= ramme, 0, FULLT_HUS);
    const pakkeOverRammen = ramme == null ? { verdi: null, status: "aldri" } : finnGrense(p => vedPakke(p).behov > ramme, 0, Math.max(200000, (sesong.pakke ?? 0) * 3));
    const faktor = sesong.etterspoerselsfaktor ?? 1;
    // Avstand fra der vi er nå til grensen, i billetter for hele sesongen (som Resultater F85 i arbeidsboka) og i kroner for pakken
    const billetterTil = g => (g.status === "grense" ? (faktor - g.verdi) * sumSalg : null);
    return { id: hd.id, navn: hd.navn, kort: hd.kort, farge: hd.farge, type: hd.type, nv: naa.nv, behov: naa.behov, holderRammen: naa.holderRammen,
             nvNegativUnder: { ...nvNegativUnder, billetter: billetterTil(nvNegativUnder) },
             overRammenUnder: { ...overRammenUnder, billetter: billetterTil(overRammenUnder) },
             pakkeOverRammen: { ...pakkeOverRammen, kroner: pakkeOverRammen.status === "grense" ? pakkeOverRammen.verdi - (sesong.pakke ?? 0) : null } };
  });
}

/**
 * De tre beslutningsreglene fra arbeidsboka. Alle rangerer etter nåverdien med verdiene som gjelder nå:
 *   1 Robust: høyest nåverdi blant handlingene som holder rammen nå og i alle scenarioene (oppsider holdes utenfor)
 *   2 Verdi: høyest nåverdi blant handlingene som holder rammen nå
 *   3 Uten ramme: høyest nåverdi uansett
 * Avstå (nåverdi 0, holder alltid rammen) er alltid med, så regelen velger avstå når resten gir tap.
 * Returnerer [{ nr, navn, krav, valg: { id, navn, nv }, kandidater: [id] }].
 */
function beslutningsregler(sesong, saler, program) {
  const hd = handlinger(sesong, saler, program);
  const scenarioer = (sesong.scenarioer ?? []).filter(sc => !sc.oppside);
  const holder = r => r.holderRammen !== false;
  const naa = hd.map(x => ({ ...x, r: x.hent(sesong),
                             iAlle: scenarioer.every(sc => holder(x.hent(velgScenario({ ...sesong }, sc)))) }));
  const beste = liste => liste.reduce((a, b) => (b.r.nv > a.r.nv ? b : a));
  const regel = (nr, navn, krav, filter) => {
    const kandidater = naa.filter(filter);
    const v = beste(kandidater);
    return { nr, navn, krav, valg: { id: v.id, navn: v.navn, kort: v.kort, farge: v.farge, type: v.type, nv: v.r.nv, behov: v.r.behov }, kandidater: kandidater.map(x => x.id) };
  };
  return [
    regel(1, "Robust", `Holder rammen nå og i ${scenarioer.length ? `alle ${scenarioer.length} scenarioene` : "alle scenarioene"}`, x => holder(x.r) && x.iAlle),
    regel(2, "Verdi", "Holder rammen med verdiene nå", x => holder(x.r)),
    regel(3, "Uten ramme", "Høyest nåverdi uansett finansiering", () => true),
  ];
}

/* ---------- Rådet for Maja ----------
 * Regelen i beslutningsnotatet (levert 29.10.2026): høyest nåverdi blant handlingene som holder rammen både med
 * verdiene nå og ved 20 % lavere salg. Salget kan ikke rettes opp etter signering, så regelen tester det. Pakkeprisen
 * kjenner Maja før hun signerer, så den er et vilkår og ikke en del av regelen. Med verdiene i casen gir regelen C,
 * som i notatet. Regel 1 til 3 over er arbeidsbokas regler, og notatets regel ligger mellom regel 1 og 2.
 */
const LAVERE_SALG = 0.8; // «20 % lavere salg» i notatet

/** Handlingen regelen velger med en gitt sesong. hd er handlinger(...), som ikke avhenger av sesongen. */
function notatValg(sesong, hd) {
  const ramme = sesong.ramme;
  const lav = { ...sesong, etterspoerselsfaktor: (sesong.etterspoerselsfaktor ?? 1) * LAVERE_SALG };
  const holder = r => ramme == null || r.behov <= ramme;
  let best = null;
  for (const x of hd) {
    const naa = x.hent(sesong);
    if (!holder(naa) || !holder(x.hent(lav))) continue;
    if (!best || naa.nv > best.nv) best = { id: x.id, nv: naa.nv, hd: x };
  }
  return best;
}

/**
 * Rådet med verdiene nå, og det som snur det. Returnerer:
 *   valg          handlingen regelen velger, med tallene nå og ved 20 % lavere salg
 *   alle          alle handlingene med de samme tallene, tapte billetter (salen er full) og leie før første konsert
 *   grense        salgs- og pakkegrensene for valget (som grenser()), og pakkeLav: pakkegrensen ved 20 % lavere salg
 *   snu           punktene der regelen velger noe annet: ramme (mer startfinansiering), bar (kr mer per gjest til
 *                 Sceneskift) og uforutsett (kr mer per konsert). { verdi, status, til } som finnGrense, til er det nye valget
 *   barPer10      hvor mye nåverdien for valget øker med 10 kr mer per gjest til Sceneskift
 */
function raadet(sesong, saler, program) {
  const hd = handlinger(sesong, saler, program);
  const ramme = sesong.ramme;
  const lav = { ...sesong, etterspoerselsfaktor: (sesong.etterspoerselsfaktor ?? 1) * LAVERE_SALG };
  const holder = r => ramme == null || r.behov <= ramme;
  const alle = hd.map(x => {
    const naa = x.hent(sesong), l = x.hent(lav);
    const tapte = (naa.perKonsert ?? []).reduce((a, k) => a + Math.max(0, (k.onsket ?? 0) - k.n), 0);
    const fulle = (naa.perKonsert ?? []).filter(k => k.kappet).length;
    const bunnTid = naa.saldo ? naa.saldo.indexOf(Math.min(...naa.saldo)) : 0;
    return { id: x.id, navn: x.navn, kort: x.kort, farge: x.farge, type: x.type,
             nv: naa.nv, behov: naa.behov, netto: naa.netto ?? 0, nvLav: l.nv, behovLav: l.behov,
             holderNaa: holder(naa), holderLav: holder(l), tapteBilletter: tapte, fulleKonserter: fulle,
             leieFoerStart: naa.linjer ? -naa.linjer.leie[0] : 0, bunnTid, saldo: naa.saldo ?? null };
  });
  const v = notatValg(sesong, hd);
  const valg = alle.find(x => x.id === v.id);
  const info = id => { const x = alle.find(y => y.id === id); return x ? { id: x.id, navn: x.navn, kort: x.kort, farge: x.farge, type: x.type } : null; };

  // Grensene for valget. Avstå har ingen grenser
  let grense = null;
  if (valg.type !== "avstaa") {
    grense = grenser(sesong, saler, program).find(g => g.id === valg.id);
    const hent = v.hd.hent;
    grense.pakkeLav = ramme == null ? { verdi: null, status: "aldri" }
      : finnGrense(p => hent({ ...lav, pakke: p }).behov > ramme, 0, Math.max(200000, (sesong.pakke ?? 0) * 3));
  }

  // Der regelen velger noe annet. Søket legger til på toppen av verdiene nå, så x = 0 gir dagens råd
  const snuPunkt = (endre, hi) => {
    const g = finnGrense(x => notatValg(endre(x), hd)?.id !== valg.id, 0, hi, 40);
    const til = g.status === "grense" ? notatValg(endre(g.verdi * (1 + 1e-9) + 1e-6), hd) : null;
    return { ...g, til: til ? info(til.id) : null };
  };
  const barNaa = barTilSceneskift(sesong);
  const snu = {
    ramme: ramme == null ? null : snuPunkt(x => ({ ...sesong, ramme: ramme + x }), 2000000),
    bar: snuPunkt(x => ({ ...sesong, barPerGjest: barNaa + x, barAndel: 1 }), 2000),
    uforutsett: snuPunkt(x => ({ ...sesong, uforutsett: (sesong.uforutsett ?? 0) + x }), 200000),
  };
  if (snu.ramme?.status === "grense") snu.ramme.verdi += ramme; // som beløp, ikke som tillegg
  const barPer10 = valg.type === "avstaa" ? 0 : v.hd.hent({ ...sesong, barPerGjest: barNaa + 10, barAndel: 1 }).nv - valg.nv;
  return { regel: "Høyest verdi blant valgene som holder rammen både nå og ved 20 % lavere salg", ramme,
           lavFaktor: lav.etterspoerselsfaktor, valg, alle, grense, snu, barPer10 };
}

/**
 * Lokaleeffekten for salen salId der alt i salen gir samme nåverdi som alt i salen motId (med motIds lokaleeffekt
 * som nå). Under grensen er motId bedre. Arbeidsboka: C kan selge ned til 85,44 % før A er like god.
 */
function lokaleeffektGrense(sesong, saler, program, salId, motId) {
  const sal = saler.find(s => s.id === salId), mot = saler.find(s => s.id === motId);
  if (!sal || !mot) return null;
  const nvMot = beregnAltI(sesong, saler, program, mot).nv;
  const nvMed = x => { const s2 = { ...sal, lokaleeffekt: x }; return beregnAltI(sesong, saler.map(s => (s.id === salId ? s2 : s)), program, s2).nv; };
  return finnGrense(x => nvMed(x) >= nvMot, 0, 1.5);
}


// ---- src/forslag.js ----
// Sjangerregel: sjanger gir forslag til oppsett (sitte eller stå), forventet salg gir forslag
// til sal (den billigste salen som kan velges per konsert og har plass i det oppsettet).
// Regelen er enkel med vilje, og vises åpent i grensesnittet så Maja kan overstyre den.

const SITTENDE = ["indiefolk", "visepop", "jazz", "nordisk soul", "soul / jazz", "soul", "drømmepop", "folk", "klassisk", "vise"];
const STAAENDE = ["alternativ pop", "elektronika", "shoegaze", "indierock", "synthpop", "elektronisk pop", "pop", "rock", "hiphop", "elektronisk"];

function oppsettForSjanger(sjanger) {
  const s = (sjanger ?? "").trim().toLowerCase();
  if (!s) return null;
  if (SITTENDE.some(x => s === x || s.includes(x))) return "sitte";
  if (STAAENDE.some(x => s === x || s.includes(x))) return "staa";
  return null;
}

/**
 * Forslag for én konsert. Returnerer { oppsett, salId, hvorfor, kappet } eller null hvis ingen sal passer.
 * Saler med kunHelSesong holdes utenfor, siden de ikke kan velges per konsert.
 */
function forslagForKonsert(sesong, saler, konsert) {
  const oppsett = oppsettForSjanger(konsert.sjanger) ?? konsert.oppsett ?? "staa";
  const kandidater = saler.filter(s => !s.kunHelSesong);
  const vurdert = kandidater.map(s => {
    const b = billetter(sesong, konsert, s, oppsett);
    if (!b.mulig) return null;
    const leie = leieForKonsert(sesong, s, b.n).sum;
    const bidrag = b.n * (sesong.billettpris - sesong.gebyr - sesong.utgiftPerBillett + barTilSceneskift(sesong)) - leie;
    return { sal: s, n: b.n, onsket: b.onsket, kap: b.kap, kappet: b.kappet, leie, bidrag };
  }).filter(Boolean);
  if (vurdert.length === 0) return null;
  const medPlass = vurdert.filter(v => !v.kappet);
  let valg, hvorfor;
  if (medPlass.length) {
    valg = medPlass.reduce((a, b) => (b.leie < a.leie ? b : a));
    const andre = medPlass.filter(v => v !== valg).map(v => `${v.sal.kort ?? v.sal.navn} ${krTekst(v.leie)}`);
    hvorfor = `${oppsettTekst(oppsett)} ut fra sjangeren. ${valg.sal.navn} har plass til ${Math.round(valg.onsket)} og er billigst med ${krTekst(valg.leie)} i leie` +
      (andre.length ? ` (${andre.join(", ")})` : "") +
      (vurdert.length > medPlass.length ? `. ${vurdert.filter(v => v.kappet).map(v => `${v.sal.navn} har bare plass til ${v.kap}`).join(", ")}` : "") + ".";
  } else {
    valg = vurdert.reduce((a, b) => (b.bidrag > a.bidrag ? b : a));
    hvorfor = `${oppsettTekst(oppsett)} ut fra sjangeren. Ingen sal har plass til ${Math.round(valg.onsket)} ${oppsett === "sitte" ? "sittende" : "stående"}. ${valg.sal.navn} gir høyest bidrag, men salget kappes til ${valg.kap}.`;
  }
  return { oppsett, salId: valg.sal.id, hvorfor, kappet: valg.kappet, vurdert };
}

const krTekst = v => Math.round(v).toLocaleString("nb-NO") + " kr";
const oppsettTekst = o => (o === "sitte" ? "Sittende" : "Stående");

/**
 * Beste blanding: den kombinasjonen av saler per konsert som gir høyest nåverdi og holder rammen.
 * Hver sal får det oppsettet som gir høyest bidrag på konserten. Saler med kunHelSesong holdes utenfor.
 * Med få saler prøves alle kombinasjonene (to saler og tolv konserter er 4 096). Med flere (tre saler er
 * 531 441) starter søket fra flere utgangspunkt: alt i hver sal, høyest bidrag per konsert og beste blanding
 * av salene uten fast leie. Derfra byttes sal på én konsert om gangen så lenge det blir bedre, regnet med
 * hele motoren, så sesongleie og ramme er med. Returnerer { valg: [{ salId, oppsett }], nv, behov, holderRammen } eller null.
 */
function besteBlanding(sesong, saler, program) {
  const kandidater = saler.filter(s => !s.kunHelSesong);
  const margin = sesong.billettpris - sesong.gebyr - sesong.utgiftPerBillett + barTilSceneskift(sesong); // bar er utvidelse, standard 0
  const valgPerKonsert = program.map(k => kandidater.map(s => {
    let best = null;
    for (const oppsett of ["staa", "sitte"]) {
      const b = billetter(sesong, k, s, oppsett);
      if (!b.mulig) continue;
      const bidrag = b.n * margin - leieForKonsert(sesong, s, b.n).sum;
      if (!best || bidrag > best.bidrag) best = { salId: s.id, oppsett, bidrag };
    }
    return best;
  }).filter(Boolean));
  if (valgPerKonsert.some(v => v.length === 0)) return null;
  const regn = valg => {
    const p = beregnPlan(sesong, saler, program.map((k, i) => ({ ...k, salId: valg[i].salId, oppsett: valg[i].oppsett })), k => k.salId);
    return { valg, nv: p.nv, behov: p.behov, holderRammen: p.holderRammen !== false };
  };
  const bedre = (a, b) => (a.holderRammen !== b.holderRammen ? a.holderRammen : a.nv > b.nv);
  const alleKombinasjoner = valg => {
    const antall = valg.reduce((a, v) => a * v.length, 1);
    if (antall > 65536) return null;
    let best = null;
    const indeks = program.map(() => 0);
    for (let n = 0; n < antall; n++) {
      let rest = n;
      for (let i = 0; i < program.length; i++) { indeks[i] = rest % valg[i].length; rest = Math.floor(rest / valg[i].length); }
      const r = regn(valg.map((v, i) => v[indeks[i]]));
      if (!best || bedre(r, best)) best = r;
    }
    return best;
  };
  const alle = alleKombinasjoner(valgPerKonsert);
  if (alle) return alle;

  // For mange kombinasjoner: flere utgangspunkt, så forbedring én konsert om gangen
  const start = [valgPerKonsert.map(v => v.reduce((a, b) => (b.bidrag > a.bidrag ? b : a)))];
  for (const s of kandidater) {
    const alleI = valgPerKonsert.map(v => v.find(o => o.salId === s.id));
    if (alleI.every(Boolean)) start.push(alleI);
  }
  const utenFast = valgPerKonsert.map(v => v.filter(o => fasteLeiebetalinger(kandidater.find(s => s.id === o.salId)).length === 0));
  if (utenFast.every(v => v.length)) { const r = alleKombinasjoner(utenFast); if (r) start.push(r.valg); }
  let best = null;
  for (const valg of start) {
    let naa = regn(valg), bedret = true;
    while (bedret) {
      bedret = false;
      for (let i = 0; i < program.length; i++) {
        for (const o of valgPerKonsert[i]) {
          if (o === naa.valg[i]) continue;
          const r = regn(naa.valg.map((v, j) => (j === i ? o : v)));
          if (bedre(r, naa)) { naa = r; bedret = true; }
        }
      }
    }
    if (!best || bedre(naa, best)) best = naa;
  }
  return best;
}


// ---- src/standard-2027.js ----
// Sceneskift våren 2027 slik casen i MET3 AK2 beskriver den. Dette er utgangspunktet i alt:
// siden åpner med denne sesongen, og «tilbake til casen» henter verdier herfra.
// Kilder: oppgaveteksten (Majas forutsetninger og de tre tilbudene), program.html på
// Sceneskifts case-nettside, og 2026-salget fra ordreeksporten (betalte billetter uten
// avbrutte og dupliserte transaksjoner, se forstaelse.md kap. 2).

const SESONG_2027 = {
  navn: "Sceneskift våren 2027",
  aar: 2027,
  billettpris: 350,          // kr per betalt billett, alle billetter (ingen rabatter i 2027)
  gebyr: 10,                 // kr per betalt billett, trekkes i billettoppgjøret
  utgiftPerBillett: 10,      // andre publikumsavhengige utgifter, betalt i konsertmåneden
  pakke: 60000,              // artist og øvrig produksjon (Rigg & Ro), fast per konsert
  pakkeDel1Andel: 0.5,       // halvparten måneden før, resten i konsertmåneden
  rente: 0.04,               // real årsrente
  konvensjon: "aar",         // (1 + r)^(t/12). "maaned" gir (1 + r/12)^t
  ramme: 250000,             // startfinansiering Maja tror hun kan skaffe
  etterspoerselsfaktor: 1,   // 1 = Majas premiss: samme salg som 2026
  laanRente: 0.12,           // årlig rente på lån ut over rammen (kassekreditt). Gruppas antakelse, ikke fra casen
  // Utvidelser utenfor casen. Oppgaveteksten: «Utover postene i tabellen og lokaleleien er det ingen andre inntekter
  // eller kostnader.» Derfor står de på 0, som gir casens tall. De kan settes for å vise hva som skjer om det ikke stemmer.
  barPerGjest: 0,            // omsetning i baren per betalt billett, kr
  barAndel: 0,               // Sceneskifts andel av baromsetningen, gjøres opp måneden etter som billettene
  uforutsett: 0,             // buffer for kostnader pakken ikke dekker, kr per konsert, betalt i konsertmåneden
  scenarioer: [],            // fylles med SCENARIOER_2027 under
  maanedsnavn: ["Før januar", "Januar", "Februar", "Mars", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Desember"],
};

// Scenarioene fra arbeidsboka (Forutsetninger B13:F17). Hvert scenario setter etterspørselsfaktoren og
// pakkeprisen. Nivåene og begrunnelsene er gruppas, teksten er den samme som i arbeidsboka.
const SCENARIOER_2027 = [
  { navn: "Basis", etterspoerselsfaktor: 1, pakke: 60000,
    begrunnelse: "Majas premiss: samme salg som tilsvarende konsert i 2026. Rigg & Ro-tilbudet på 60 000 kr." },
  { navn: "Lav etterspørsel", etterspoerselsfaktor: 0.8, pakke: 60000,
    begrunnelse: "Student- og tidligrabatten forsvinner. 1 203 av 3 380 betalte billetter i 2026 (36 %) var rabatterte og blir 9 til 17 % dyrere. Nivået er gruppas antakelse." },
  { navn: "Høyere pakkepris", etterspoerselsfaktor: 1, pakke: 66000,
    begrunnelse: "Rigg & Ro kan revidere tilbudet før signering. 10 % høyere pris er gruppas antakelse." },
  { navn: "Samlet", etterspoerselsfaktor: 0.8, pakke: 66000,
    begrunnelse: "Lav etterspørsel og høyere pakkepris samtidig (oppgavens samlede scenario). Høy etterspørsel er ikke med." },
  { navn: "Høy etterspørsel", etterspoerselsfaktor: 1.2, pakke: 60000, oppside: true,
    begrunnelse: "Oppside: 20 % flere betalte billetter enn i 2026. Gruppas antakelse, inngår ikke i beslutningsreglene." },
];
SESONG_2027.scenarioer = SCENARIOER_2027;

const SALER_2027 = [
  {
    id: "A", navn: "Lune Sal", kort: "A", farge: "blaa",
    beskrivelse: "Liten kultursal i et tidligere snekkerverksted. Lav scene, intimt.",
    kilde: "https://alu042.github.io/met3-lune-sal/", bilde: "img/lune-sal.webp",
    kapasitet: { staa: null, sitte: 250 }, sitteAntatt: false, lokaleeffekt: 1,
    kapasitetNotat: "Tilbudet: 250 salgbare plasser. Nettsiden sier 270 seter. Regnes som sittende sal uten ståoppsett (antatt).",
    kunHelSesong: false,
    leie: [{ type: "perKonsert", belop: 9000, naar: "konsertmaaned" }],
  },
  {
    id: "B", navn: "Søyleverket", kort: "B", farge: "gul",
    beskrivelse: "Kulturrom med flatt gulv, fast scene og løse stoler. Fast sesongleie.",
    kilde: "https://alu042.github.io/met3-soyleverket/", bilde: "img/soyleverket.webp",
    kapasitet: { staa: 450, sitte: 250 }, sitteAntatt: true, lokaleeffekt: 1,
    kapasitetNotat: "Tilbudet: 450 salgbare plasser. Nettsiden sier inntil 500 personer. Sitteplasser 250 er antatt (løse stoler på flatt gulv).",
    kunHelSesong: true,
    leie: [
      { type: "engang", belop: 35000, tidspunkt: 0, navn: "Engangstilpasning" },
      { type: "sesong", belop: 140000, plan: [{ tidspunkt: 0, andel: 0.5 }, { tidspunkt: 3, andel: 0.5 }], navn: "Sesongleie" },
    ],
  },
  {
    id: "C", navn: "Skarvkaien", kort: "C", farge: "rosa",
    beskrivelse: "Havnelager med fast scene og åpent gulv. Leien følger billettoppgjøret.",
    kilde: "https://alu042.github.io/met3-skarvkaien/", bilde: "img/skarvkaien.webp",
    kapasitet: { staa: 450, sitte: 200 }, sitteAntatt: true, lokaleeffekt: 1,
    kapasitetNotat: "Tilbudet: 450 salgbare plasser. Nettsiden sier inntil 490 stående. Sitteplasser 200 er antatt (kan rigges sittende).",
    kunHelSesong: false,
    leie: [{ type: "andel", andel: 0.18, minimum: 7500, naar: "maanedEtter" }],
  },
];

// Programmet fra program.html, 2026-salget fra ordrene (K01 til K12 i samme rekkefølge),
// og tilsvarende konsert i 2026 fra arkiv.html og oppgjørsfila (navn, lokale, total kapasitet).
// Verkstedet (320) og Maskinhallen (550) er lokalene Sceneskift brukte i 2026.
const P = [
  [1, "15.01", "June Varde", "Indiefolk", "Solo, gitar", 1, 140, "Låtskriverkveld", "Verkstedet", 320],
  [2, "29.01", "Mellomlys", "Drømmepop", "Duo, gitar og synther", 1, 190, "To stemmer", "Verkstedet", 320],
  [3, "12.02", "Liv Eik", "Nordisk soul", "Band, tangenter, bass og trommer", 2, 230, "Soul på verkstedet", "Verkstedet", 320],
  [4, "26.02", "Blåtimekvartetten", "Jazz", "Kvartett", 2, 310, "Fredagsjazz", "Maskinhallen", 550],
  [5, "12.03", "Ravlinje", "Elektronika", "Duo, synther og trommemaskiner", 3, 370, "Elektronisk vår", "Maskinhallen", 550],
  [6, "26.03", "Vesperhagen", "Alternativ pop", "Femmannsband", 3, 480, "Pop i hallen", "Maskinhallen", 550],
  [7, "09.04", "Iben Vår", "Visepop", "Solo, piano og gitar", 4, 160, "Nære viser", "Verkstedet", 320],
  [8, "23.04", "Sølvregn", "Shoegaze", "Band, to gitarer, bass og trommer", 4, 250, "Gitarer i skumringen", "Verkstedet", 320],
  [9, "07.05", "Dobbeltspor", "Indierock", "Band, to vokalister", 5, 330, "Bandfredag", "Maskinhallen", 550],
  [10, "28.05", "Nattfiol", "Synthpop", "Trio, vokal, synther og elektroniske trommer", 5, 420, "Synthnatt", "Maskinhallen", 550],
  [11, "11.06", "Ada Mørk", "Soul / jazz", "Vokal med trio", 6, 210, "Soul i juni", "Verkstedet", 320],
  [12, "25.06", "Glassmorgen", "Elektronisk pop", "Duo, vokal, keyboard og elektronikk", 6, 290, "Vårens siste tone", "Maskinhallen", 550],
];

const PROGRAM_2027 = P.map(([nr, dato, artist, sjanger, besetning, maaned, salg2026, navn2026, lokale2026, kap2026]) => ({
  nr, dato, artist, sjanger, besetning, maaned, salg2026,
  i2026: { navn: navn2026, lokale: lokale2026, kapasitet: kap2026 },
  forventetSalg: salg2026,
  salId: "C",            // casens råd som utgangspunkt
  pakkeAvvik: 0,         // utvidelse: pakken for denne konserten minus sesongens pakke. 0 i casen (fast pris for alle)
  oppsett: "staa",
  notat: nr === 6 ? "«Vårens største navn» ifølge Sceneskift" : "",
}));

const LOKALER_2026 = [
  { navn: "Verkstedet", kapasitet: 320, beskrivelse: "Lyst rom med spor av det gamle seilloftet, lav scene. Ligner Lune Sal i størrelse og stemning." },
  { navn: "Maskinhallen", kapasitet: 550, beskrivelse: "Takhøyde, mørke flater, plass til store lydlandskap. Ligner Skarvkaien." },
];

const SJANGRE = [
  "Indiefolk", "Drømmepop", "Nordisk soul", "Jazz", "Elektronika", "Alternativ pop",
  "Visepop", "Shoegaze", "Indierock", "Synthpop", "Soul / jazz", "Elektronisk pop",
  "Pop", "Rock", "Hiphop", "Folk", "Klassisk", "Annet",
];

function standardSesong() {
  return JSON.parse(JSON.stringify({ sesong: SESONG_2027, saler: SALER_2027, program: PROGRAM_2027 }));
}


// ---- src/lagring.js ----
// Lagring: localStorage automatisk, og JSON-fil med «Lagre sesong» og «Åpne sesong».
const NOKKEL = "konsertplan.sesong.v1";

function lesLokalt() {
  try {
    const t = localStorage.getItem(NOKKEL);
    return t ? JSON.parse(t) : null;
  } catch { return null; }
}

function lagreLokalt(data) {
  try { localStorage.setItem(NOKKEL, JSON.stringify(data)); } catch { /* privat vindu eller fullt lager */ }
}

function slettLokalt() {
  try { localStorage.removeItem(NOKKEL); } catch { /* ingenting å gjøre */ }
}

function lastNedFil(data, filnavn) {
  const blob = new Blob([JSON.stringify({ format: "konsertplan", versjon: 1, lagret: new Date().toISOString(), ...data }, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filnavn;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function lesFil(fil) {
  return new Promise((ok, feil) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d.sesong || !Array.isArray(d.saler) || !Array.isArray(d.program)) throw new Error("Fila mangler sesong, saler eller program.");
        ok({ sesong: d.sesong, saler: d.saler, program: d.program });
      } catch (e) { feil(e); }
    };
    r.onerror = () => feil(new Error("Kunne ikke lese fila."));
    r.readAsText(fil);
  });
}


// ---- src/figurer.js ----
// SVG-figurer tegnet for hånd, samme teknikk som presentasjonen i sceneskift-kart.
const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}, tekst) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (tekst !== undefined) e.textContent = tekst;
  return e;
}

const tallF = v => Math.round(v).toLocaleString("nb-NO");
const pent = (v, steg) => Math.ceil(v / steg) * steg;

function stegFor(spenn) {
  const kandidater = [10000, 20000, 25000, 50000, 100000, 200000, 250000, 500000];
  return kandidater.find(s => spenn / s <= 7) ?? 1000000;
}

/** Saldo per måned: én linje per serie. serier = [{navn, farge, verdier, bred}] */
function tegnSaldo(svg, serier, etiketter, ramme) {
  svg.replaceChildren();
  const W = 900, H = 420;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const P = { x1: 90, x2: W - 24, y1: 24, y2: H - 54 };
  const alle = serier.flatMap(s => s.verdier);
  const steg = stegFor(Math.max(...alle) - Math.min(...alle, -ramme));
  const ymin = Math.floor(Math.min(...alle, -ramme) / steg) * steg;
  const ymax = pent(Math.max(...alle, 0), steg);
  const n = etiketter.length;
  const sx = i => P.x1 + (i / (n - 1)) * (P.x2 - P.x1);
  const sy = v => P.y2 - ((v - ymin) / (ymax - ymin)) * (P.y2 - P.y1);
  for (let v = ymin; v <= ymax; v += steg) {
    svg.appendChild(svgEl("line", { class: v === 0 ? "akse" : "rutenett", x1: P.x1, x2: P.x2, y1: sy(v), y2: sy(v) }));
    svg.appendChild(svgEl("text", { class: "etikett", x: P.x1 - 10, y: sy(v) + 4, "text-anchor": "end" }, tallF(v)));
  }
  if (ramme) {
    svg.appendChild(svgEl("line", { class: "rammestrek", x1: P.x1, x2: P.x2, y1: sy(-ramme), y2: sy(-ramme) }));
    svg.appendChild(svgEl("text", { class: "etikett minus", x: P.x2, y: sy(-ramme) - 6, "text-anchor": "end" }, `Rammen, ${tallF(ramme)} kr`));
  }
  etiketter.forEach((e, i) => svg.appendChild(svgEl("text", { class: "etikett", x: sx(i), y: P.y2 + 22, "text-anchor": "middle" }, e)));
  for (const s of serier) {
    const d = s.verdier.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
    svg.appendChild(svgEl("path", { class: "linje" + (s.bred ? " bred" : ""), d, style: `stroke: var(--${s.farge})` }));
    s.verdier.forEach((v, i) => svg.appendChild(svgEl("circle", { cx: sx(i), cy: sy(v), r: s.bred ? 4.5 : 3, style: `fill: var(--${s.farge})` })));
    if (s.bred) {
      const siste = s.verdier.length - 1;
      svg.appendChild(svgEl("text", { class: "serie", x: sx(siste) - 8, y: sy(s.verdier[siste]) - 12, "text-anchor": "end", style: `fill: var(--${s.farge})` }, s.navn));
    }
  }
}

/** Bidrag per konsert: to stolper per konsert. serier = [{navn, farge, verdier}], etiketter per konsert. */
function tegnBidrag(svg, serier, etiketter) {
  svg.replaceChildren();
  const W = 900, H = 380;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const P = { x1: 90, x2: W - 24, y1: 24, y2: H - 54 };
  const alle = serier.flatMap(s => s.verdier);
  const steg = stegFor(Math.max(...alle, 0) - Math.min(...alle, 0));
  const ymin = Math.floor(Math.min(...alle, 0) / steg) * steg;
  const ymax = pent(Math.max(...alle, 0), steg);
  const n = etiketter.length;
  const gruppe = (P.x2 - P.x1) / n;
  const bredde = Math.min(26, (gruppe - 10) / serier.length);
  const sy = v => P.y2 - ((v - ymin) / (ymax - ymin)) * (P.y2 - P.y1);
  for (let v = ymin; v <= ymax; v += steg) {
    svg.appendChild(svgEl("line", { class: v === 0 ? "akse" : "rutenett", x1: P.x1, x2: P.x2, y1: sy(v), y2: sy(v) }));
    svg.appendChild(svgEl("text", { class: "etikett", x: P.x1 - 10, y: sy(v) + 4, "text-anchor": "end" }, tallF(v)));
  }
  etiketter.forEach((e, i) => svg.appendChild(svgEl("text", { class: "etikett", x: P.x1 + gruppe * (i + 0.5), y: P.y2 + 22, "text-anchor": "middle" }, e)));
  serier.forEach((s, j) => {
    s.verdier.forEach((v, i) => {
      const x = P.x1 + gruppe * (i + 0.5) - (serier.length * bredde) / 2 + j * bredde;
      svg.appendChild(svgEl("rect", { x, y: Math.min(sy(v), sy(0)), width: bredde - 3, height: Math.abs(sy(v) - sy(0)), style: `fill: var(--${s.farge})`, opacity: j === 0 ? 1 : 0.55 }));
    });
  });
}


// ---- src/chat.js ----
// Chatbot for Maja: en språkmodell (Claude) forklarer rådet, men regner ikke selv.
// Arbeidsdelingen, som foreleser beskrev 4.11.2026: motoren regner, språkmodellen formidler.
//   1 Modellen får forutsetningene og resultatene fra motoren som tekst (tilstand).
//   2 Spør Maja «hva om», ber modellen om verktøyet prov_endring. Det endrer en kopi av planen,
//     motoren regner, og modellen får tallene før og etter tilbake. Majas plan endres ikke.
//   3 Modellen forklarer med tallene den har fått. Maja kan selv trykke «Bruk i planen».
// Ingen DOM her. Kallet mot API-et sendes inn (kall), så testene bruker en falsk modell uten nett.
// API-nøkkelen ligger bare i nettleserens lokale lager, under en egen nøkkel. Den er aldri med i
// sesongen, i «Lagre»-fila eller i repoet.

const CHAT_MODELL = "claude-opus-5-5";
const CHAT_API = "https://api.anthropic.com/v1/messages";
const CHAT_API_VERSJON = "2026-10-21";
const CHAT_NOKKEL_LAGER = "konsertplan.anthropic.nokkel";
const CHAT_MAKS_RUNDER = 6; // spørsmål, verktøy, svar: mer enn seks runder betyr at noe har gått i ring

/* ---------- API-nøkkelen, bare i nettleserens lokale lager ---------- */
const chatLager = lager => lager ?? (typeof localStorage !== "undefined" ? localStorage : null);
function lesNokkel(lager) {
  try { return chatLager(lager)?.getItem(CHAT_NOKKEL_LAGER) || ""; } catch { return ""; }
}
function lagreNokkel(nokkel, lager) {
  try { chatLager(lager)?.setItem(CHAT_NOKKEL_LAGER, String(nokkel).trim()); return true; } catch { return false; }
}
function glemNokkel(lager) {
  try { chatLager(lager)?.removeItem(CHAT_NOKKEL_LAGER); } catch { /* uten lager */ }
}

/* ---------- Tallene modellen får ---------- */
const kroner = v => Math.round(v ?? 0);
const prosent1 = v => Math.round((v ?? 0) * 1000) / 10;
const tallC = v => Math.round(v ?? 0).toLocaleString("nb-NO").replace(/\s/g, " "); // vanlig mellomrom, ikke hardt

/** Leievilkårene til en sal i klartekst, fra byggeklossene i motoren. */
function leieTekst(sal, mnd) {
  const naar = { konsertmaaned: "i konsertmåneden", maanedEtter: "måneden etter konserten", maanedFoer: "måneden før konserten" };
  return (sal.leie ?? []).map(b => {
    if (b.type === "perKonsert") return `${tallC(b.belop)} kr per konsert, betales ${naar[b.naar] ?? b.naar}`;
    if (b.type === "andel") return `${prosent1(b.andel)} % av billettoppgjøret (billettpris minus gebyr), minst ${tallC(b.minimum)} kr per konsert, betales ${naar[b.naar] ?? b.naar}`;
    if (b.type === "engang") return `${b.navn ?? "Engangsbeløp"} ${tallC(b.belop)} kr, betales ${(mnd[b.tidspunkt ?? 0] ?? "").toLowerCase()}`;
    if (b.type === "sesong") return `${b.navn ?? "Sesongleie"} ${tallC(b.belop)} kr for hele våren, betales ${(b.plan ?? []).map(p => `${tallC(b.belop * p.andel)} kr ${p.tidspunkt === 0 ? "før januar" : `ved slutten av ${(mnd[p.tidspunkt] ?? "").toLowerCase()}`}`).join(" og ")}`;
    return JSON.stringify(b);
  }).join(". ");
}

/** Hvordan Konsertplan regner, i klartekst, med verdiene som gjelder nå. Modellen bruker dette til å forklare. */
function slikRegnesDet(s) {
  const r = prosent1(s.rente), lr = prosent1(s.laanRente);
  return {
    pengene_per_konsert:
      `Billettoppgjøret er antall betalte billetter ganger (billettpris ${tallC(s.billettpris)} kr minus gebyr ${tallC(s.gebyr)} kr), og kommer måneden etter konserten. ` +
      `Publikumsutgiften er ${tallC(s.utgiftPerBillett)} kr per billett, betalt i konsertmåneden. ` +
      `Pakken fra Rigg & Ro betales med ${prosent1(s.pakkeDel1Andel ?? 0.5)} % måneden før konserten og resten i konsertmåneden. ` +
      `Leien følger vilkårene til salen (se saler). Antall billetter er forventet salg, men aldri mer enn plassene i salen.`,
    kontoen_ved_maanedsslutt:
      "Kontoen starter på 0 rett før januar. Hver måned legges inn- og utbetalingene til. Tallene per måned står i kontoen_ved_maanedsslutt_kr for hvert valg.",
    maa_ha_klart:
      "Det laveste kontoen kommer ved et månedsslutt, som et positivt beløp. Det er startfinansieringen dere trenger (finansieringsbehovet). Holder det seg under rammen, holder valget rammen.",
    verdi_for_sceneskift:
      `Alle inn- og utbetalinger fra før januar til siste oppgjør, regnet om til dagens kroner med ${r} % realrente per år: et beløp ved slutten av måned t ganges med 1 / (1 + ${r} %) opphøyd i t/12. Summen er verdien (nåverdien). Planleggingen er betalt uansett og er ikke med.`,
    laan_ut_over_rammen:
      `Utvidelse utenfor casen, gruppas antakelse. Casen holder lån utenfor. Går kontoen lenger ned enn rammen ved et månedsslutt, regnes det som ligger under rammen som et lån (kassekreditt) den måneden. ` +
      `Lånet er det største slike beløpet. Renten er ${lr} % per år og regnes per måned: lånet den måneden ganger ${lr} % delt på 12. Rentekostnaden er summen av månedene. ` +
      `Renten holdes utenfor verdien for Sceneskift. Verdi etter rente trekker rentene fra, regnet om til dagens kroner. Tallene per måned står i laan_per_maaned for hvert valg. ` +
      `Lånet gjør et valg mulig, men ikke tryggere: blir salget lavere, må lånet bli større.`,
  };
}

/** Lånetallene og kontoen per måned for en handling, fra motoren. Avstå har ingen pengestrøm. */
function pengerPerMaaned(r, mnd) {
  if (!r?.saldo) return { kontoen_ved_maanedsslutt_kr: null, laan_ut_over_rammen_kr: 0, maaneder_med_laan: 0, laan_per_maaned: [], rentekostnad_kr: 0, verdi_etter_rente_kr: 0 };
  const navn = t => mnd[t] ?? `Måned ${t}`;
  return {
    kontoen_ved_maanedsslutt_kr: Object.fromEntries(r.saldo.map((v, t) => [navn(t), kroner(v)])),
    laan_ut_over_rammen_kr: kroner(r.laan),
    maaneder_med_laan: r.maanederMedLaan ?? 0,
    laan_per_maaned: (r.trekk ?? []).map((v, t) => (v > 0 ? { maaned: navn(t), laan_kr: kroner(v), rente_kr: kroner(r.renter[t]) } : null)).filter(Boolean),
    rentekostnad_kr: kroner(r.rentekostnad),
    verdi_etter_rente_kr: kroner(r.nvEtterRente),
  };
}

/** En grense fra motoren, uten fagord. enhet "salg" gir prosent av 2026-salget, "kr" gir kroner. */
function chatGrense(g, enhet) {
  if (!g) return null;
  if (g.status === "aldri") return "finnes ikke: skjer ikke uansett hvor langt det går";
  if (g.status === "alltid") return "allerede der uansett";
  if (enhet === "salg") return { prosent_av_salget_i_2026: prosent1(g.verdi), billetter_aa_gaa_paa_i_sesongen: g.billetter == null ? null : kroner(g.billetter) };
  return { kr: kroner(g.verdi), kr_aa_gaa_paa: g.kroner == null ? null : kroner(g.kroner) };
}

/**
 * Forutsetningene og resultatene akkurat nå, regnet av motoren, som et objekt modellen kan lese.
 * Alle beløp er hele kroner. Differansene modellen trenger (mot rammen, mot rådet) er regnet her,
 * så modellen ikke trenger å regne.
 */
function tilstand(data) {
  const { sesong: s, saler, program } = data;
  const R = raadet(s, saler, program);
  const G = grenser(s, saler, program);
  const res = beregnAlle(s, saler, program);
  const sc = aktivtScenario(s);
  const ramme = s.ramme;
  const valg = R.valg;
  const navnFor = x => (x.type === "sal" && x.kort ? `${x.navn} (${x.kort})` : x.navn);
  const utenfor = utvidelserIBruk(s, program);
  const lokal = saler.filter(x => (x.lokaleeffekt ?? 1) !== 1);
  if (lokal.length) utenfor.push("lokaleeffekt");
  if (res.blandet) utenfor.push("blandet program");
  const g = R.grense;
  const mnd = s.maanedsnavn ?? [];
  const resFor = id => (id === "egen" ? res.egen : id === "avstaa" ? null : res.altI[id]);
  const snuTil = p => (p?.status === "grense" ? { verdi: kroner(p.verdi), raadet_blir: p.til ? navnFor(p.til) : null } : "snur ikke innenfor det vi har prøvd");
  return {
    forutsetninger: {
      scenario: sc ? sc.navn : "egne verdier",
      salg_i_prosent_av_2026: prosent1(s.etterspoerselsfaktor ?? 1),
      pakke_per_konsert_kr: kroner(s.pakke),
      billettpris_kr: kroner(s.billettpris),
      startfinansiering_ramme_kr: ramme == null ? null : kroner(ramme),
      realrente_prosent_per_aar: prosent1(s.rente),
      utenfor_casen: {
        bar_omsetning_per_gjest_kr: kroner(s.barPerGjest),
        bar_andel_til_sceneskift_prosent: prosent1(s.barAndel),
        uforutsette_kostnader_per_konsert_kr: kroner(s.uforutsett),
        lokaleeffekt_prosent: Object.fromEntries(saler.map(x => [x.id, prosent1(x.lokaleeffekt ?? 1)])),
        i_bruk_naa: utenfor,
      },
    },
    raadet: {
      valg: valg.type === "avstaa" ? "Avstå" : navnFor(valg),
      regel: R.regel,
      salg_ved_20_prosent_lavere_i_prosent_av_2026: prosent1(R.lavFaktor),
    },
    valgene: R.alle.map(x => ({
      navn: navnFor(x),
      vaart_raad: x.id === valg.id,
      verdi_for_sceneskift_kr: kroner(x.nv),
      maa_ha_klart_kr: kroner(x.behov),
      holder_rammen_naa: x.holderNaa,
      over_rammen_med_kr: ramme != null && x.behov > ramme ? kroner(x.behov - ramme) : 0,
      under_rammen_med_kr: ramme != null && x.behov <= ramme ? kroner(ramme - x.behov) : null,
      verdi_ved_20_prosent_lavere_salg_kr: kroner(x.nvLav),
      maa_ha_klart_ved_20_prosent_lavere_salg_kr: kroner(x.behovLav),
      holder_rammen_ved_20_prosent_lavere_salg: x.holderLav,
      verdi_mot_raadet_kr_positiv_er_mer: x.id === valg.id ? 0 : kroner(x.nv - valg.nv),
      leie_foer_foerste_konsert_kr: kroner(x.leieFoerStart),
      fulle_konserter: x.fulleKonserter,
      billetter_som_gaar_tapt_fordi_salen_er_full: kroner(x.tapteBilletter),
      ...pengerPerMaaned(resFor(x.id), mnd),
    })),
    naar_raadet_snur: valg.type === "avstaa" ? {
      merknad: "Rådet er å avstå. Startfinansieringen under er det som gir et annet råd.",
      startfinansiering_som_gir_annet_raad: snuTil(R.snu.ramme),
    } : {
      gjelder: navnFor(valg),
      salget_der_valget_taper_penger: chatGrense(g?.nvNegativUnder, "salg"),
      salget_der_rammen_ryker: chatGrense(g?.overRammenUnder, "salg"),
      pakken_der_rammen_ryker: chatGrense(g?.pakkeOverRammen, "kr"),
      pakken_der_rammen_ryker_ved_20_prosent_lavere_salg_kr: g?.pakkeLav?.status === "grense" ? kroner(g.pakkeLav.verdi) : chatGrense(g?.pakkeLav, "kr"),
      startfinansiering_som_gir_annet_raad: snuTil(R.snu.ramme),
      bar_kr_per_gjest_til_sceneskift_som_gir_annet_raad: snuTil(R.snu.bar),
      uforutsette_kostnader_per_konsert_som_gir_annet_raad: snuTil(R.snu.uforutsett),
      ti_kr_mer_per_gjest_fra_baren_gir_mer_verdi_kr: kroner(R.barPer10),
    },
    grenser_per_valg: G.map(x => ({
      navn: navnFor(x),
      salget_der_verdien_blir_negativ: chatGrense(x.nvNegativUnder, "salg"),
      salget_der_rammen_ryker: chatGrense(x.overRammenUnder, "salg"),
      pakken_der_rammen_ryker: chatGrense(x.pakkeOverRammen, "kr"),
    })),
    regler_fra_arbeidsboka: beslutningsregler(s, saler, program).map(r => ({ regel: `${r.nr} ${r.navn}`, krav: r.krav, velger: r.valg.type === "avstaa" ? "Avstå" : navnFor(r.valg) })),
    slik_regnes_det: slikRegnesDet(s),
    saler: saler.map(x => ({ id: x.id, navn: x.navn, leie: leieTekst(x, mnd), plasser_staaende: x.kapasitet?.staa ?? null, plasser_sittende: x.kapasitet?.sitte ?? null,
                             sitteplasser_antatt: !!x.sitteAntatt, kun_hel_sesong: !!x.kunHelSesong })),
    program: program.map((k, i) => ({
      nr: k.nr, dato: k.dato, artist: k.artist, sjanger: k.sjanger,
      forventet_salg: kroner(k.forventetSalg), salg_i_2026: k.salg2026 ?? null,
      sal_i_egen_plan: k.salId, oppsett: k.oppsett === "sitte" ? "sittende" : "stående",
      pakke_kr: kroner(pakkeFor(s, k)),
      fullt_i: Object.keys(res.altI).filter(id => res.altI[id].perKonsert[i]?.kappet),
    })),
  };
}

const tilstandTekst = data => JSON.stringify(tilstand(data));

/* ---------- Verktøyet: prøv en endring ---------- */
// Felt i verktøyet: [navn i verktøyet, felt i sesongen, faktor fra verktøy til sesong, min, maks, tekst]
const CHAT_FELT = [
  ["salg_prosent_av_2026", "etterspoerselsfaktor", 0.01, 0, 300, "Salg i forhold til 2026"],
  ["pakke_kr", "pakke", 1, 0, 1000000, "Pakke per konsert"],
  ["startfinansiering_kr", "ramme", 1, 0, 10000000, "Startfinansiering"],
  ["billettpris_kr", "billettpris", 1, 0, 5000, "Billettpris"],
  ["bar_omsetning_per_gjest_kr", "barPerGjest", 1, 0, 5000, "Bar, omsetning per gjest (utenfor casen)"],
  ["bar_andel_prosent", "barAndel", 0.01, 0, 100, "Bar, Sceneskifts andel (utenfor casen)"],
  ["uforutsette_kostnader_per_konsert_kr", "uforutsett", 1, 0, 1000000, "Uforutsette kostnader per konsert (utenfor casen)"],
];

const VERKTOY = [{
  name: "prov_endring",
  description:
    "Regner rådet og tallene på nytt i Konsertplan med én eller flere endrede forutsetninger, og gir tallene før og etter. " +
    "Bruk den hver gang Maja spør «hva om», og når du trenger et tall som ikke står i tallene du har fått. " +
    "Verdiene er nye verdier, ikke tillegg: salget 20 % lavere enn Majas premiss er salg_prosent_av_2026 = 80. " +
    "Felt du ikke tar med, beholdes som nå. Majas plan endres ikke: hun kan selv trykke «Bruk i planen» etterpå. " +
    "Bar, uforutsette kostnader, pakke per konsert, sal per konsert og lokaleeffekt er utenfor casen.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      scenario: { type: "string", description: "Navnet på et scenario fra arbeidsboka (Basis, Lav etterspørsel, Høyere pakkepris, Samlet, Høy etterspørsel). Setter salg og pakke. Andre felt legges oppå." },
      salg_prosent_av_2026: { type: "number", description: "Salget som prosent av salget på tilsvarende konsert i 2026. Majas premiss er 100." },
      pakke_kr: { type: "number", description: "Pakkeprisen fra Rigg & Ro per konsert, kr. Casen: 60 000." },
      startfinansiering_kr: { type: "number", description: "Rammen, startfinansieringen Maja kan skaffe, kr. Casen: 250 000." },
      billettpris_kr: { type: "number", description: "Billettpris, kr. Casen: 350." },
      bar_omsetning_per_gjest_kr: { type: "number", description: "Utenfor casen. Baromsetning per betalt billett, kr." },
      bar_andel_prosent: { type: "number", description: "Utenfor casen. Sceneskifts andel av baromsetningen, prosent." },
      uforutsette_kostnader_per_konsert_kr: { type: "number", description: "Utenfor casen. Kostnader pakken ikke dekker, kr per konsert." },
      lokaleeffekt: {
        type: "array", description: "Utenfor casen. Salget i en sal som prosent av etterspørselen (100 = lokalet påvirker ikke salget).",
        items: { type: "object", additionalProperties: false, properties: { sal: { type: "string", description: "Salens id, for eksempel C" }, prosent: { type: "number" } }, required: ["sal", "prosent"] },
      },
      konserter: {
        type: "array", description: "Endringer for enkeltkonserter i Majas plan, med konsertens nummer (1 til 12).",
        items: {
          type: "object", additionalProperties: false, required: ["nr"],
          properties: {
            nr: { type: "integer" },
            forventet_salg: { type: "number", description: "Forventet antall betalte billetter" },
            sal: { type: "string", description: "Salens id. Utenfor casen når planen da blander saler" },
            oppsett: { type: "string", enum: ["stående", "sittende"] },
            pakke_kr: { type: "number", description: "Utenfor casen. Pakken for denne konserten, kr" },
          },
        },
      },
    },
  },
}];

const kortTall = v => Math.round(v).toLocaleString("nb-NO");

/**
 * Tolker verktøyets input mot dataene. Returnerer { endringer: [{ tekst, fra, til }], feil: [tekst], bruk(data) }.
 * bruk(data) setter endringene på et dataobjekt (endrer det). Feil gir ingen endringer.
 */
function tolkEndring(data, input) {
  const feil = [], endringer = [], steg = [];
  const inn = input && typeof input === "object" ? input : {};
  const kjente = new Set(["scenario", "lokaleeffekt", "konserter", ...CHAT_FELT.map(f => f[0])]);
  for (const k of Object.keys(inn)) if (!kjente.has(k)) feil.push(`Ukjent felt: ${k}`);
  const s = data.sesong;
  const tallOk = (v, min, maks, navn) => {
    if (typeof v !== "number" || !Number.isFinite(v)) { feil.push(`${navn} må være et tall`); return false; }
    if (v < min || v > maks) { feil.push(`${navn} må være mellom ${kortTall(min)} og ${kortTall(maks)}`); return false; }
    return true;
  };
  if (inn.scenario != null) {
    const sc = (s.scenarioer ?? []).find(x => x.navn.toLowerCase() === String(inn.scenario).toLowerCase());
    if (!sc) feil.push(`Ukjent scenario: ${inn.scenario}. Finnes: ${(s.scenarioer ?? []).map(x => x.navn).join(", ")}`);
    else { endringer.push({ tekst: `Scenario ${sc.navn}`, fra: aktivtScenario(s)?.navn ?? "egne verdier", til: sc.navn }); steg.push(d => velgScenario(d.sesong, sc)); }
  }
  for (const [navn, felt, faktor, min, maks, tekst] of CHAT_FELT) {
    if (inn[navn] == null) continue;
    if (!tallOk(inn[navn], min, maks, tekst)) continue;
    const til = inn[navn] * faktor;
    const vis = v => (faktor === 1 ? `${kortTall(v ?? 0)} kr` : `${prosent1(v ?? 0).toLocaleString("nb-NO")} %`);
    endringer.push({ tekst, fra: vis(s[felt]), til: vis(til) });
    steg.push(d => { d.sesong[felt] = til; });
  }
  for (const l of Array.isArray(inn.lokaleeffekt) ? inn.lokaleeffekt : []) {
    const sal = data.saler.find(x => x.id === String(l?.sal).toUpperCase() || x.navn === l?.sal);
    if (!sal) { feil.push(`Ukjent sal: ${l?.sal}`); continue; }
    if (!tallOk(l.prosent, 0, 300, `Lokaleeffekt for ${sal.navn}`)) continue;
    endringer.push({ tekst: `Lokaleeffekt ${sal.navn} (utenfor casen)`, fra: `${prosent1(sal.lokaleeffekt ?? 1).toLocaleString("nb-NO")} %`, til: `${l.prosent.toLocaleString("nb-NO")} %` });
    steg.push(d => { d.saler.find(x => x.id === sal.id).lokaleeffekt = l.prosent / 100; });
  }
  for (const e of Array.isArray(inn.konserter) ? inn.konserter : []) {
    const k = data.program.find(x => x.nr === e?.nr);
    if (!k) { feil.push(`Fant ikke konsert nr ${e?.nr}`); continue; }
    const navn = `${k.nr} ${k.artist}`;
    if (e.forventet_salg != null && tallOk(e.forventet_salg, 0, 100000, `Forventet salg for ${navn}`)) {
      endringer.push({ tekst: `Forventet salg, ${navn}`, fra: kortTall(k.forventetSalg ?? 0), til: kortTall(e.forventet_salg) });
      steg.push(d => { d.program.find(x => x.nr === k.nr).forventetSalg = e.forventet_salg; });
    }
    if (e.sal != null) {
      const sal = data.saler.find(x => x.id === String(e.sal).toUpperCase() || x.navn === e.sal);
      if (!sal) feil.push(`Ukjent sal: ${e.sal}`);
      else if (sal.kunHelSesong) feil.push(`${sal.navn} kan bare velges for hele sesongen, ikke for én konsert`);
      else { endringer.push({ tekst: `Sal, ${navn}`, fra: k.salId, til: sal.id }); steg.push(d => { d.program.find(x => x.nr === k.nr).salId = sal.id; }); }
    }
    if (e.oppsett != null) {
      const ny = e.oppsett === "sittende" ? "sitte" : e.oppsett === "stående" ? "staa" : null;
      if (!ny) feil.push(`Oppsett må være stående eller sittende`);
      else { endringer.push({ tekst: `Oppsett, ${navn}`, fra: k.oppsett === "sitte" ? "sittende" : "stående", til: e.oppsett }); steg.push(d => { d.program.find(x => x.nr === k.nr).oppsett = ny; }); }
    }
    if (e.pakke_kr != null && tallOk(e.pakke_kr, 0, 1000000, `Pakke for ${navn}`)) {
      endringer.push({ tekst: `Pakke, ${navn} (utenfor casen)`, fra: `${kortTall(pakkeFor(s, k))} kr`, til: `${kortTall(e.pakke_kr)} kr` });
      // Pakken per konsert lagres som avvik fra sesongens pakke. Settes etter at sesongens pakke er endret
      steg.push(d => { d.program.find(x => x.nr === k.nr).pakkeAvvik = e.pakke_kr - (d.sesong.pakke ?? 0); });
    }
  }
  if (!feil.length && !endringer.length) feil.push("Ingen endringer. Oppgi minst én forutsetning som skal endres.");
  // Stegene kjøres i rekkefølgen over: scenario, sesongfelt, lokaleeffekt, konserter. Da regnes pakken per konsert mot en ny sesongpakke
  const bruk = d => { if (!feil.length) for (const f of steg) f(d); return d; };
  return { endringer, feil, bruk };
}

/** Kort utdrag av tilstanden, til før og etter i verktøyets svar og i grensesnittet. */
function utdrag(t) {
  return {
    raadet: t.raadet.valg,
    valgene: t.valgene.map(v => ({ navn: v.navn, verdi_for_sceneskift_kr: v.verdi_for_sceneskift_kr, maa_ha_klart_kr: v.maa_ha_klart_kr,
                                   holder_rammen_naa: v.holder_rammen_naa, holder_rammen_ved_20_prosent_lavere_salg: v.holder_rammen_ved_20_prosent_lavere_salg })),
  };
}

/**
 * Kjører verktøyet. Returnerer { ok, input, endringer, feil, foer, etter, svar } der svar er teksten modellen får.
 * data endres ikke.
 */
function provEndring(data, input) {
  const tolket = tolkEndring(data, input);
  if (tolket.feil.length) {
    return { ok: false, input, endringer: tolket.endringer, feil: tolket.feil,
             svar: JSON.stringify({ feil: tolket.feil, hint: "Ingenting er regnet. Rett feltene og prøv igjen, eller si til Maja hva Konsertplan ikke kan regne." }) };
  }
  const foerT = tilstand(data);
  const ny = tolket.bruk(kopi(data));
  const etterT = tilstand(ny);
  const foer = utdrag(foerT), etter = utdrag(etterT);
  const endring = etter.valgene.map(v => {
    const f = foer.valgene.find(x => x.navn === v.navn);
    return f ? { navn: v.navn, verdi_endres_med_kr: v.verdi_for_sceneskift_kr - f.verdi_for_sceneskift_kr, maa_ha_klart_endres_med_kr: v.maa_ha_klart_kr - f.maa_ha_klart_kr } : { navn: v.navn, ny: true };
  });
  const svar = {
    merknad: "Prøveberegning i Konsertplan. Majas plan er ikke endret.",
    endret: tolket.endringer,
    foer,
    etter: { ...etter, naar_raadet_snur: etterT.naar_raadet_snur, utenfor_casen_i_bruk: etterT.forutsetninger.utenfor_casen.i_bruk_naa },
    endring_fra_foer: endring,
    raadet_snur: foer.raadet !== etter.raadet,
  };
  return { ok: true, input, endringer: tolket.endringer, feil: [], foer, etter, svar: JSON.stringify(svar) };
}

/** Setter verktøyets endringer på Majas plan (endrer data). Brukes av knappen «Bruk i planen». */
function brukEndring(data, input) {
  const t = tolkEndring(data, input);
  if (t.feil.length) return false;
  t.bruk(data);
  return true;
}

/* ---------- Instruksen til modellen ---------- */
const SYSTEM = `Du er hjelperen i Konsertplan, et verktøy laget for Maja, daglig leder i konsertarrangøren Sceneskift. Hun skal velge sal for de tolv konsertene våren 2027: Lune Sal (A), Søyleverket (B) eller Skarvkaien (C), eller avstå. Verktøyet er laget av tre NHH-studenter i faget MET3. Sceneskift, salene og tallene er fiktive og laget for undervisning.

Slik jobber du:
- Du regner aldri selv. Hvert tall i svaret ditt skal stå i tallene fra Konsertplan som du har fått, eller i svaret fra verktøyet prov_endring. Ikke legg sammen, trekk fra, gang eller del, heller ikke for å finne en forskjell. Trenger du et tall som ikke står der, bruk verktøyet. Kan ikke verktøyet regne det, si at Konsertplan ikke viser det.
- Spør Maja hvordan et tall er regnet, forklar det med slik_regnes_det og tallene per måned for valget det gjelder. Du kan vise regnestykket slik det står der, med tallene du har fått, men regn ikke ut nye tall.
- «Lånet» betyr lån ut over rammen (kassekreditten i slik_regnes_det.laan_ut_over_rammen), ikke startfinansieringen. Trenger valget hun ser på ikke lån, si det, og vis hvilket valg som trenger lån og hvor mye. Kan spørsmålet bety begge deler, si kort hvilket du svarer på.
- Spør Maja «hva om» (annet salg, annen pakkepris, mer startfinansiering, bar, uforutsette kostnader, en konsert i en annen sal), bruk prov_endring. Det endrer ikke planen hennes. Hun kan selv trykke «Bruk i planen» under svaret ditt.
- Svar kort: to til fem setninger, eller noen få korte punkter med «- » foran. Svaret først, så hvorfor.
- Skriv på Majas språk, på norsk bokmål. Hun er arrangør, ikke økonom. Si «verdi for Sceneskift» (i dagens kroner) i stedet for nåverdi, og «det dere må ha klart» eller «startfinansieringen dere trenger» i stedet for finansieringsbehov. Forklar ordene bare hvis hun spør.
- Skriv beløp som «173 787 kr» og prosent som «79,8 %». Ingen markdown: ingen stjerner, overskrifter eller tabeller. Bruk aldri tankestrek eller bindestrek som skilletegn i en setning.
- Rådet følger regelen i gruppas notat: høyest verdi blant valgene som holder rammen både med salget nå og hvis salget blir 20 % lavere. Gi aldri et annet råd enn Konsertplan. Er Maja uenig, vis hva som må endres for at rådet skal snu.
- Casen sier at det utover billettene, publikumsutgiften, pakken og leien ikke er andre inntekter eller kostnader. Bar, uforutsette kostnader, pakkepris per konsert, saler blandet per konsert og lokaleeffekt er gruppas utvidelser. Når svaret bruker dem, si at det er utenfor casen. Står noe i forutsetninger.utenfor_casen.i_bruk_naa (for eksempel blandet program), nevn det alltid i svaret.
- Du vet ikke mer om salene, artistene eller markedet enn det som står i tallene. Ikke finn på fakta.
- Handler spørsmålet om noe annet enn sesongen og rådet, si kort at du bare kan hjelpe med Konsertplan.

Tallene fra Konsertplan kommer som JSON i Majas meldinger, merket «Tallene i Konsertplan nå». Nyeste versjon gjelder.`;

/* ---------- Samtalen ---------- */
function nySamtale() {
  return { meldinger: [], sendtTilstand: null };
}

function lagForespoersel(meldinger) {
  return {
    model: CHAT_MODELL,
    max_tokens: 16000,
    system: SYSTEM,
    tools: VERKTOY,
    messages: meldinger,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" }, // korte svar i en chat, tallene kommer fra motoren
    fallbacks: "default",             // avslår modellen, prøver API-et en annen modell (krever beta-hodet under)
    cache_control: { type: "ephemeral" },
  };
}

class ChatFeil extends Error {
  constructor(type, melding) { super(melding); this.type = type; }
}

/** Feilmelding på Majas språk for et svar fra API-et som ikke er 200. */
function feilFraStatus(status, json) {
  const detalj = json?.error?.message ? ` (${json.error.message})` : "";
  if (status === 401) return new ChatFeil("nokkel", "Anthropic godtok ikke nøkkelen. Sjekk at den er limt inn riktig.");
  if (status === 403) return new ChatFeil("nokkel", `Nøkkelen har ikke tilgang til modellen${detalj}.`);
  if (status === 429) return new ChatFeil("grense", "For mange spørsmål på kort tid, eller brukergrensen på nøkkelen er nådd. Vent litt og prøv igjen.");
  if (status === 400) return new ChatFeil("foresporsel", `API-et avviste forespørselen${detalj}.`);
  if (status === 529 || status >= 500) return new ChatFeil("opptatt", "Tjenesten hos Anthropic er opptatt akkurat nå. Prøv igjen om litt.");
  return new ChatFeil("ukjent", `Uventet svar fra Anthropic (${status})${detalj}.`);
}

/** Kall mot Messages API rett fra nettleseren. hent kan byttes ut i tester. */
function lagKall(nokkel, hent = globalThis.fetch) {
  return async body => {
    let svar;
    try {
      svar = await hent(CHAT_API, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": nokkel,
          "anthropic-version": CHAT_API_VERSJON,
          "anthropic-beta": "server-side-fallback-2026-07-01",
          "anthropic-dangerous-direct-browser-access": "true", // kall rett fra nettleseren, nøkkelen er brukerens egen
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ChatFeil("nett", "Fikk ikke kontakt med Anthropic. Sjekk at maskinen er på nett.");
    }
    let json = null;
    try { json = await svar.json(); } catch { /* tomt svar */ }
    if (!svar.ok) throw feilFraStatus(svar.status, json);
    return json;
  };
}

/**
 * Ett spørsmål fra Maja, med verktøyrunder til modellen er ferdig. Samtalen bygges bare på (aldri redigert bakover).
 * Får modellen ikke svart (avslag, feil, for mange runder), settes samtalen tilbake til før spørsmålet.
 * Returnerer { tekst, kjoringer: [provEndring-resultat], avslaatt, avkortet }.
 */
async function spor(samtale, data, tekst, kall) {
  const start = samtale.meldinger.length;
  const sendtFoer = samtale.sendtTilstand;
  const naa = tilstandTekst(data);
  const innhold = [];
  if (naa !== samtale.sendtTilstand) innhold.push({ type: "text", text: `Tallene i Konsertplan nå, regnet av motoren:\n${naa}` });
  innhold.push({ type: "text", text: tekst });
  samtale.meldinger.push({ role: "user", content: innhold });
  samtale.sendtTilstand = naa;
  const kjoringer = [];
  const tilbake = () => { samtale.meldinger.length = start; samtale.sendtTilstand = sendtFoer; };
  try {
    for (let runde = 0; runde < CHAT_MAKS_RUNDER; runde++) {
      const r = await kall(lagForespoersel(samtale.meldinger));
      if (!r || !Array.isArray(r.content)) throw new ChatFeil("ukjent", "Uventet svar fra modellen.");
      if (r.stop_reason === "refusal") {
        tilbake();
        return { tekst: "Modellen ville ikke svare på dette. Prøv å spørre på en annen måte.", kjoringer: [], avslaatt: true };
      }
      samtale.meldinger.push({ role: "assistant", content: r.content });
      if (r.stop_reason === "tool_use") {
        const resultater = [];
        for (const b of r.content.filter(x => x.type === "tool_use")) {
          if (b.name !== "prov_endring") {
            resultater.push({ type: "tool_result", tool_use_id: b.id, is_error: true, content: `Ukjent verktøy: ${b.name}` });
            continue;
          }
          const k = provEndring(data, b.input);
          if (k.ok) kjoringer.push(k);
          resultater.push({ type: "tool_result", tool_use_id: b.id, content: k.svar, ...(k.ok ? {} : { is_error: true }) });
        }
        samtale.meldinger.push({ role: "user", content: resultater });
        continue;
      }
      const svarTekst = r.content.filter(x => x.type === "text").map(x => x.text).join("\n\n").trim();
      return { tekst: svarTekst || "(Tomt svar fra modellen.)", kjoringer, avkortet: r.stop_reason === "max_tokens" };
    }
    throw new ChatFeil("runder", "Modellen kom ikke fram til et svar. Prøv å spørre enklere.");
  } catch (e) {
    tilbake();
    throw e;
  }
}

/** Rydder svaret til ren tekst: avsnitt og punkter, uten markdown-tegn modellen likevel kan ha tatt med. */
function avsnitt(tekst) {
  const ut = [];
  for (const blokk of String(tekst).replace(/\*\*|__|^#+\s*/gm, "").split(/\n\s*\n/)) {
    const linjer = blokk.split("\n").map(l => l.trim()).filter(Boolean);
    if (!linjer.length) continue;
    if (linjer.every(l => /^[-•*]\s+/.test(l))) ut.push({ type: "punkter", linjer: linjer.map(l => l.replace(/^[-•*]\s+/, "")) });
    else ut.push({ type: "avsnitt", tekst: linjer.join(" ") });
  }
  return ut;
}

/** Forslag til spørsmål, ut fra rådet nå. t er tilstand(data). */
function chatForslag(t) {
  const valg = t.raadet.valg;
  const avstaa = valg === "Avstå";
  const ut = [avstaa ? "Hvorfor bør vi avstå?" : `Hvorfor ${valg.replace(/ \(.\)$/, "")}?`];
  if (t.forutsetninger.salg_i_prosent_av_2026 === 100) ut.push("Hva om salget blir 20 % lavere enn i 2026?");
  ut.push(`Hva om Rigg & Ro vil ha ${(t.forutsetninger.pakke_per_konsert_kr + 6000).toLocaleString("nb-NO")} kr per konsert?`);
  const b = t.valgene.find(v => v.navn.startsWith("Søyleverket"));
  if (b && !b.vaart_raad) ut.push("Hvor mye startfinansiering trenger vi for å velge Søyleverket?");
  ut.push("Hva betyr «må ha klart»?");
  return ut;
}


// ---- src/app.js ----
// Konsertplan: tilstand og rendering. Alt regnes på nytt ved hver endring.

const tall = v => Math.round(v ?? 0).toLocaleString("nb-NO");
const kr = v => tall(v) + " kr";
const pst = v => Math.round(v * 100) + " %";
const MAANEDER = ["Start", "Jan", "Feb", "Mar", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Des"];
const FARGER = ["blaa", "gul", "rosa", "oransje", "gronn", "graa"];
const FARGENAVN = { blaa: "blå", gul: "gul", rosa: "rosa", oransje: "oransje", gronn: "grønn", graa: "grå" };
const FORKLAR_NOKKEL = "konsertplan.forklar";

function h(tag, attrs = {}, ...barn) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.setAttribute("style", v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else if (k === "checked" || k === "disabled" || k === "selected") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const b of barn.flat()) if (b !== null && b !== undefined && b !== false) e.append(b);
  return e;
}
const svg = (label) => { const e = document.createElementNS("http://www.w3.org/2000/svg", "svg"); e.setAttribute("role", "img"); e.setAttribute("aria-label", label); return e; };
/** Forklarende tekst som bare vises når bryteren «Forklaringer» er på. */
const fork = (tag, cls, ...barn) => h(tag, { class: `${cls} forklaring-tekst` }, ...barn);

const state = { data: null, fane: "raadet", referanse: "C", forklar: false, besteBlanding: null, aapneTrekk: new Set(),
                chatAapen: false, chat: { samtale: nySamtale(), logg: [], venter: false, utkast: "" } };

function salAv(id) { return state.data.saler.find(s => s.id === id); }
function salerPerKonsert() { return state.data.saler.filter(s => !s.kunHelSesong); }
function salTittel(s) { return s.kort ? `${s.kort}: ${s.navn}` : s.navn; }
function fargeFor(s) { return s?.farge ?? "graa"; }
function mini(s, cls = "mini") { return s?.bilde ? h("img", { class: cls, src: s.bilde, alt: "" }) : h("span", { class: "prikk" }); }

function lagre() { lagreLokalt(state.data); }
function oppdater() { lagre(); render(); }

/* ---------- Oppstart ---------- */
function init() {
  state.data = lesLokalt() ?? standardSesong();
  try { state.forklar = localStorage.getItem(FORKLAR_NOKKEL) === "1"; } catch { /* uten lager */ }
  if (/[?&]forklar=1/.test(location.search)) state.forklar = true;
  reparer();
  document.getElementById("sesongnavn").addEventListener("change", e => { state.data.sesong.navn = e.target.value.trim() || SESONG_2027.navn; oppdater(); });
  document.getElementById("knapp-lagre").addEventListener("click", () => {
    const navn = (state.data.sesong.navn || "sesong").replace(/[^\wæøåÆØÅ-]+/g, "-").toLowerCase();
    lastNedFil(state.data, `${navn}.konsertplan.json`);
  });
  document.getElementById("knapp-aapne").addEventListener("click", () => document.getElementById("fil").click());
  document.getElementById("fil").addEventListener("change", async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { state.data = await lesFil(f); reparer(); oppdater(); }
    catch (err) { alert(`Kunne ikke åpne fila: ${err.message}`); }
    e.target.value = "";
  });
  document.getElementById("knapp-nullstill").addEventListener("click", () => {
    if (!confirm("Nullstille alt til Sceneskift våren 2027? Endringene dine forsvinner, med mindre du har lagret dem som fil.")) return;
    slettLokalt(); state.data = standardSesong(); oppdater();
  });
  document.getElementById("knapp-forklar").addEventListener("click", () => {
    state.forklar = !state.forklar;
    try { localStorage.setItem(FORKLAR_NOKKEL, state.forklar ? "1" : "0"); } catch { /* uten lager */ }
    visForklaringer();
  });
  const faner = [...document.querySelectorAll(".faner button")].map(b => b.dataset.fane);
  // #spor er ikke lenger en fane, men åpner chatten (gamle lenker virker fortsatt)
  const fraHash = () => { const f = location.hash.replace("#", ""); if (f === "spor") aapneChat(); else if (faner.includes(f) && f !== state.fane) { state.fane = f; render(); } };
  for (const b of document.querySelectorAll(".faner button")) b.addEventListener("click", () => { state.fane = b.dataset.fane; history.replaceState(null, "", "#" + state.fane); render(); });
  window.addEventListener("hashchange", fraHash);
  if (faner.includes(location.hash.replace("#", ""))) state.fane = location.hash.replace("#", "");
  if (location.hash === "#spor") state.chatAapen = true;
  document.getElementById("gaffarull").addEventListener("click", () => aapneChat());
  document.addEventListener("keydown", e => { if (e.key === "Escape" && state.chatAapen) lukkChat(); });
  // Åpnet fra presentasjonen (MET3): vis lenke tilbake. Maja ser den ikke
  if (new URLSearchParams(location.search).get("fra") === "presentasjon") {
    const tilbake = document.getElementById("til-presentasjon");
    tilbake.hidden = false;
    // ?tilbake=slutt går rett til den siden i presentasjonen, ellers tilbake dit vi kom fra
    const til = new URLSearchParams(location.search).get("tilbake");
    if (til) tilbake.href = tilbake.href.replace(/#.*$/, "") + "#" + encodeURIComponent(til);
    else tilbake.addEventListener("click", e => { if (history.length > 1) { e.preventDefault(); history.back(); } });
  }
  visForklaringer();
  render();
}

function visForklaringer() {
  document.body.classList.toggle("forklar", state.forklar);
  document.getElementById("knapp-forklar").setAttribute("aria-pressed", String(state.forklar));
}

/** Rydder i data etter innlasting: manglende felt, saler som er slettet, oppsett som salen ikke har. */
function reparer() {
  const d = state.data;
  d.sesong = { ...kopi(SESONG_2027), ...d.sesong };
  if (!Array.isArray(d.sesong.scenarioer) || !d.sesong.scenarioer.length) d.sesong.scenarioer = kopi(SCENARIOER_2027);
  if (!d.saler.length) d.saler = kopi(SALER_2027);
  for (const s of d.saler) { s.leie ??= []; s.kapasitet ??= { staa: null, sitte: null }; s.farge ??= "graa"; s.lokaleeffekt ??= 1; }
  const perKonsert = salerPerKonsert();
  const standardProgram = standardSesong().program;
  for (const k of d.program) {
    const std = standardProgram.find(x => x.nr === k.nr && x.artist === k.artist);
    if (std) { k.i2026 ??= std.i2026; k.besetning ??= std.besetning; }
    k.oppsett ??= "staa";
    k.forventetSalg ??= k.salg2026 ?? 0;
    k.pakkeAvvik ??= 0;
    let s = salAv(k.salId);
    if (!s || s.kunHelSesong) s = perKonsert[0];
    k.salId = s?.id ?? null;
    if (s && kapasitet(s, k.oppsett) === null) {
      const annet = k.oppsett === "sitte" ? "staa" : "sitte";
      if (kapasitet(s, annet) !== null) k.oppsett = annet;
    }
  }
  if (!state.data.saler.some(s => s.id === state.referanse)) state.referanse = state.data.saler[0]?.id;
}

/* ---------- Rendering ---------- */
function beregn() { const d = state.data; return beregnAlle(d.sesong, d.saler, d.program); }

function render() {
  const d = state.data;
  document.getElementById("sesongnavn").value = d.sesong.navn;
  const sc = aktivtScenario(d.sesong);
  document.getElementById("undertekst").textContent = `${d.program.length} konserter, ${d.saler.length} saler, ramme ${kr(d.sesong.ramme)}. Scenario: ${sc ? sc.navn : "egne verdier"}`;
  for (const b of document.querySelectorAll(".faner button")) b.setAttribute("aria-pressed", String(b.dataset.fane === state.fane));
  document.body.classList.toggle("fane-resultater", state.fane === "resultater");
  document.body.classList.toggle("fane-raadet", state.fane === "raadet");
  const res = beregn();
  renderStripe(res);
  const main = document.getElementById("innhold");
  main.replaceChildren();
  ({ raadet: renderRaadetFane, program: renderProgram, resultater: renderResultater, saler: renderSaler, forutsetninger: renderForutsetninger })[state.fane](main, res);
  renderChat();
}

function statusTekst(r) {
  const s = state.data.sesong;
  if (s.ramme == null) return h("span", { class: "status svak" }, "Ingen ramme satt");
  if (r.behov <= s.ramme) return h("span", { class: "status pluss" }, `Holder rammen, ${kr(s.ramme - r.behov)} å gå på`);
  return h("span", { class: "status minus" }, `${kr(r.behov - s.ramme)} over rammen. Lån i ${r.maanederMedLaan} ${r.maanederMedLaan === 1 ? "måned" : "måneder"}, ca. ${kr(r.rentekostnad)} i rente`);
}

function renderStripe(res) {
  const el = document.getElementById("stripe");
  el.replaceChildren();
  const d = state.data;
  const s = d.sesong;
  const stor = state.fane === "resultater";
  const deler = [
    { navn: "Egen plan", merke: res.blandet ? h("span", { class: "merke varsel" }, "utenfor casen") : null, farge: "gronn", r: res.egen },
    ...d.saler.map(x => ({ navn: `Alt i ${salTittel(x)}`, farge: fargeFor(x), r: res.altI[x.id], bilde: stor && x.bilde ? mini(x) : null })),
  ];
  for (const p of deler) {
    const r = p.r;
    el.append(h("div", { class: "stripe-del", style: `--c: var(--${p.farge})` },
      h("div", { class: "navn" }, p.bilde, p.navn, p.merke),
      h("div", { class: `nv tall ${r.nv < 0 ? "minus" : ""}` }, kr(r.nv), stor ? h("span", { class: "nv-etikett" }, "nåverdi") : null),
      h("div", { class: "rad" }, stor ? "Trenger underveis" : "Trenger", h("b", { class: "tall" }, kr(r.behov))),
      stor ? h("div", { class: "rad" }, "Netto, udiskontert", h("b", { class: "tall" }, kr(r.netto))) : null,
      ...(stor && r.laan > 0 ? [
        h("div", { class: "rad" }, "Lån ut over rammen", h("b", { class: "tall minus" }, kr(r.laan))),
        h("div", { class: "rad" }, `Rente, ${pst(s.laanRente ?? 0)} p.a.`, h("b", { class: "tall minus" }, kr(r.rentekostnad))),
        h("div", { class: "rad" }, "Nåverdi etter rente", h("b", { class: "tall" }, kr(r.nvEtterRente))),
      ] : []),
      statusTekst(r)));
  }
  // Avstå er alltid et valg, så den står sist som en liten bolk
  el.append(h("div", { class: "stripe-del liten", style: "--c: var(--graa)" },
    h("div", { class: "navn" }, "Avstå"),
    h("div", { class: "nv tall" }, kr(0)),
    h("div", { class: "rad" }, "Ingen risiko, ingen inntekt")));
}

/* ---------- Rådet ---------- */
// Rådet på Majas språk: anbefaling med vilkår, hvorfor, to tall forklart uten fagord, når rådet snur,
// artisten bestemmer salen, og der vi går utenfor casen. Alle tall kommer fra motoren (raadet i motor.js).
const pst1 = v => (Math.round(v * 1000) / 10).toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
const navnMedKort = v => (v.type === "sal" && v.kort ? `${v.navn} (${v.kort})` : v.type === "avstaa" ? "å avstå" : v.navn);
function gaaTil(fane) { state.fane = fane; history.replaceState(null, "", "#" + fane); render(); window.scrollTo(0, 0); }

/** Leievilkårene i én linje, på vanlig språk. */
function leieType(sal) {
  const deler = [];
  let fast = 0;
  for (const b of sal.leie ?? []) {
    if (b.type === "perKonsert") deler.push(`fast leie, ${kr(b.belop)} per konsert`);
    else if (b.type === "andel") deler.push(`leien følger salget, ${pst(b.andel)} av oppgjøret, minst ${kr(b.minimum ?? 0)}`);
    else if (b.type === "engang") fast += b.belop;
    else if (b.type === "sesong") fast += b.belop;
  }
  if (fast) deler.push(`fast sesongleie, ${kr(fast)} i alt`);
  const t = deler.join(", ");
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/** Utfellbar bolk på hjemskjermen. Hvilke som er åpne huskes mellom tegningene. */
function trekk(id, tittel, under, ...innhold) {
  return h("details", { class: "trekk", open: state.aapneTrekk.has(id), ontoggle: e => { if (e.target.open) state.aapneTrekk.add(id); else state.aapneTrekk.delete(id); } },
    h("summary", {}, h("span", { class: "trekk-tittel" }, tittel), under ? h("span", { class: "trekk-under" }, under) : null),
    h("div", { class: "trekk-innhold" }, ...innhold));
}

const klem = v => Math.max(0, Math.min(1, v));
/** En liten måler under et nøkkeltall: fyll for verdien nå, rød sone der det går galt, strek for en grense. */
function maaler({ tittel, stort, minus, under, fyll, fyll2, sone, strek, farge }) {
  const skala = fyll == null ? null : h("div", { class: "maaler-skala", "aria-hidden": "true" },
    fyll2 != null ? h("span", { class: "maaler-fyll svak-fyll", style: `width: ${klem(fyll2) * 100}%` }) : null,
    h("span", { class: "maaler-fyll", style: `width: ${klem(fyll) * 100}%` }),
    sone ? h("span", { class: "maaler-sone", style: `left: ${klem(sone[0]) * 100}%; width: ${(klem(sone[1]) - klem(sone[0])) * 100}%` }) : null,
    strek != null ? h("span", { class: "maaler-strek", style: `left: ${klem(strek) * 100}%` }) : null);
  return h("div", { class: "maaler", style: `--c: var(--${farge ?? "graa"})` },
    h("h3", {}, tittel), h("div", { class: `maaler-tall tall${minus ? " minus" : ""}` }, stort), skala, h("p", { class: "maaler-under" }, ...[under].flat()));
}

function renderRaadetFane(main, res) {
  const d = state.data;
  const s = d.sesong;
  const R = raadet(s, d.saler, d.program);
  const v = R.valg;
  const sc = aktivtScenario(s);
  const ramme = s.ramme;
  const faktor = s.etterspoerselsfaktor ?? 1;
  const mnd = t => (t === 0 ? "før januar" : `i ${(s.maanedsnavn?.[t] ?? `måned ${t}`).toLowerCase()}`);
  const salV = v.type === "sal" ? salAv(v.id) : null;
  const alt = R.alle.filter(x => x.type !== "avstaa");
  const hoyest = alt.reduce((a, b) => (b.nv > a.nv ? b : a), alt[0]); // det regel 3 velger: høyest verdi uansett ramme
  const avstaar = v.type === "avstaa";
  // Ved avstå forklares tallene med den som gir mest av dem som holder rammen nå, ellers den som gir mest
  const x = avstaar ? (alt.filter(a => a.holderNaa).reduce((a, b) => (!a || b.nv > a.nv ? b : a), null) ?? hoyest) : v;

  /* 1 Anbefalingen med vilkår */
  const vilkaar = [];
  const spor = [];
  let tittel, under;
  if (avstaar) {
    tittel = "Ikke signer på disse vilkårene";
    under = alt.every(a => a.nv <= 0) ? "Alle salene gir tap med forutsetningene nå. Det som kan snu det:"
      : `Ingen av salene holder rammen på ${kr(ramme)} både med salget nå og hvis salget blir 20 % lavere. Det som kan snu det:`;
    if (R.snu.ramme?.status === "grense") vilkaar.push(`Skaff ${kr(R.snu.ramme.verdi)} i startfinansiering. Da holder ${navnMedKort(R.snu.ramme.til)} rammen også om salget blir 20 % lavere.`);
    vilkaar.push("Be Rigg & Ro om en lavere pakkepris før dere signerer.");
    vilkaar.push("Be utleierne om å flytte leie til senere i sesongen, eller om leie som følger salget.");
  } else {
    tittel = v.type === "egen" ? "Velg egen plan" : `Velg ${navnMedKort(v)}`;
    under = "men signer først når tre ting er på plass:";
    vilkaar.push(ramme == null
      ? `Startfinansieringen er avklart. Dere har ikke satt noen ramme, og ${v.navn} trenger ${kr(v.behov)} underveis, ${kr(v.behovLav)} hvis salget blir 20 % lavere.`
      : `Startfinansieringen på ${kr(ramme)} er bekreftet, gjerne med en buffer. ${v.navn} trenger ${kr(v.behov)} med salget nå og ${kr(v.behovLav)} hvis salget blir 20 % lavere.`);
    const pl = R.grense?.pakkeLav;
    vilkaar.push(pl?.status === "grense"
      ? `Rigg & Ro bekrefter pakkeprisen på ${kr(s.pakke)} per konsert. Hvis salget blir 20 % lavere, holder ${v.navn} rammen bare så lenge pakken koster under ${kr(pl.verdi)}.`
      : `Rigg & Ro bekrefter pakkeprisen på ${kr(s.pakke)} per konsert.`);
    if (v.type === "egen") vilkaar.push("Utleierne godtar enkeltkonserter. Casen sier at avtalene gjelder hele programmet, så det må avtales før signering.");
    else vilkaar.push(`${v.navn} bekrefter at ${tall(kapasitet(salV, "staa") ?? kapasitet(salV, "sitte"))} plasser er salgbare i oppsettet dere skal bruke.`);
  }
  if (ramme != null && hoyest && hoyest.id !== v.id && hoyest.type === "sal" && !hoyest.holderNaa && hoyest.leieFoerStart > 0)
    spor.push(`${hoyest.navn}: kan noe av de ${kr(hoyest.leieFoerStart)} i leie som forfaller før januar, betales senere? ${hoyest.navn} gir mest, men trenger ${kr(hoyest.behov - ramme)} mer enn rammen.`);
  if (!barTilSceneskift(s) && salV) spor.push(`${salV.navn}: får Sceneskift en del av barsalget? Casen regner ingen barinntekt (se «Der vi går utenfor casen»).`);

  const kildeLenke = salV?.kilde ? h("div", { class: "kilde" }, "Bilde: ", h("a", { href: salV.kilde, target: "_blank", rel: "noopener" }, salV.kilde.replace(/^https?:\/\//, ""))) : null;
  main.append(h("section", { class: "seksjon anbefaling", style: `--c: var(--${v.farge ?? "graa"})` },
    h("div", { class: "anb-tekst" },
      h("p", { class: "anb-over" }, "Vårt råd til Maja"),
      h("h2", { class: "anb-tittel" }, tittel, v.type === "egen" ? h("span", { class: "merke varsel" }, "utenfor casen") : null),
      h("p", { class: "anb-under" }, under),
      h("ol", { class: "vilkaar" }, ...vilkaar.map(t => h("li", {}, t))),
      avstaar ? h("p", { class: "anb-ellers" }, "Å avstå koster ingenting nå, fordi planleggingen er betalt uansett.")
              : h("p", { class: "anb-ellers" }, "Blir de ikke oppfylt, bør du forsøke å reforhandle før du signerer, eller avstå. Å avstå koster ingenting nå, fordi planleggingen er betalt uansett."),
      spor.length ? h("div", { class: "anb-spor" }, h("h3", {}, "Verdt å spørre om"), h("ul", {}, ...spor.map(t => h("li", {}, t)))) : null),
    salV?.bilde ? h("div", { class: "anb-bilde" }, h("img", { src: salV.bilde, alt: `Bilde av ${salV.navn}` }), kildeLenke) : null));

  /* 2 Scenario og spørsmål: rådet regnes på nytt med en gang */
  main.append(h("section", { class: "kontrollrad", "aria-label": "Scenario" },
    h("div", { class: "chips", role: "group", "aria-label": "Velg scenario" },
      ...s.scenarioer.map(x2 => h("button", { type: "button", class: `chip${x2.oppside ? " oppside" : ""}`, "aria-pressed": String(x2 === sc), title: x2.begrunnelse,
        onclick: () => { velgScenario(s, x2); oppdater(); } }, x2.navn)),
      sc ? null : h("span", { class: "chip egne" }, "Egne verdier")),
    h("div", { class: "kontroll-hoyre" },
      h("button", { type: "button", class: "stille", onclick: () => gaaTil("resultater") }, "Finjuster i Resultater"),
      h("button", { type: "button", class: "primaer", onclick: () => aapneChat() }, "Spør om rådet"))));
  const varsler = [utvidelserMerknad(), lokaleeffektMerknad(),
    res.blandet ? h("p", { class: "varsel" }, h("span", { class: "merke varsel" }, "utenfor casen"), " Programmet blander saler. Casen sier at avtalene gjelder hele programmet, så egen plan er et forslag Maja kan ta opp, ikke et tilbud som finnes.") : null].filter(Boolean);
  main.append(h("div", { class: "gjelder" },
    h("p", { class: "naa-linje svak" }, "Gjelder ", h("b", {}, sc ? sc.navn.toLowerCase() : "egne verdier"), ": ",
      h("b", { class: "tall" }, `${pst(faktor)} av salget i 2026`), " og ", h("b", { class: "tall" }, `${kr(s.pakke)} per konsert`), ". ",
      "Regelen, som i notatet: høyest verdi blant valgene som holder rammen både med salget nå og hvis salget blir 20 % lavere."),
    ...varsler));

  /* 3 Nøkkeltallene for rådet, hver med en liten måler */
  const fl = x?.farge ?? "graa";
  const kortNavn = a => a.kort ?? a.navn;
  const fliser = [];
  if (x) {
    const maks = Math.max(...alt.map(a => a.nv), 1);
    fliser.push(maaler({ tittel: avstaar ? `Verdi for Sceneskift, ${x.navn}` : "Verdi for Sceneskift", stort: kr(x.nv), minus: x.nv < 0, farge: fl,
      fyll: Math.max(0, x.nv) / maks, strek: hoyest && hoyest.id !== x.id ? Math.max(0, hoyest.nv) / maks : null,
      under: [`${kr(x.nvLav)} hvis salget blir 20 % lavere.`,
        hoyest && hoyest.id !== x.id ? ` ${kortNavn(hoyest)} gir mest (streken), ${kr(hoyest.nv)}, men holder ikke rammen${hoyest.holderNaa ? " hvis salget blir 20 % lavere" : ""}.` : ""] }));
    if (ramme != null) {
      const topp = Math.max(ramme, x.behovLav, x.behov) * 1.08;
      const over = x.behov > ramme;
      fliser.push(maaler({ tittel: "Må ha klart", stort: kr(x.behov), minus: over, farge: fl,
        fyll: x.behov / topp, fyll2: x.behovLav / topp, strek: ramme / topp, sone: [ramme / topp, 1],
        under: [over ? h("span", { class: "minus" }, `${kr(x.behov - ramme)} over rammen på ${kr(ramme)}.`) : `${kr(ramme - x.behov)} å gå på under rammen på ${kr(ramme)} (streken).`,
          ` ${kr(x.behovLav)} hvis salget blir 20 % lavere (lys del).`] }));
    }
  }
  if (!avstaar && R.grense) {
    const g = R.grense;
    const nvg = g.nvNegativUnder, rg = g.overRammenUnder, pl = g.pakkeLav;
    if (nvg.status === "grense") {
      const topp = Math.max(1.2, faktor * 1.1);
      fliser.push(maaler({ tittel: "Salget kan falle til", stort: pst1(nvg.verdi), farge: fl, minus: nvg.verdi > faktor,
        fyll: faktor / topp, sone: [0, nvg.verdi / topp], strek: rg.status === "grense" && ramme != null ? rg.verdi / topp : null,
        under: [`av salget i 2026 før sesongen gir tap (rødt). Nå: ${pst(faktor)}.`,
          rg.status === "grense" && ramme != null ? ` Pengene strekker ikke til under ${pst1(rg.verdi)} (streken).` : ""] }));
    }
    if (pl?.status === "grense") {
      const topp = Math.max(pl.verdi, s.pakke) * 1.15;
      fliser.push(maaler({ tittel: "Pakkeprisen må holde seg under", stort: kr(pl.verdi), farge: fl, minus: s.pakke > pl.verdi,
        fyll: s.pakke / topp, strek: pl.verdi / topp, sone: [pl.verdi / topp, 1],
        under: `så holder ${v.navn} rammen også om salget blir 20 % lavere. Nå: ${kr(s.pakke)} per konsert.` }));
    }
  } else if (avstaar && R.snu.ramme?.status === "grense") {
    fliser.push(maaler({ tittel: "Startfinansiering som snur rådet", stort: kr(R.snu.ramme.verdi), farge: R.snu.ramme.til?.farge,
      under: `Da blir ${navnMedKort(R.snu.ramme.til)} rådet. Rammen nå er ${kr(ramme)}.` }));
  }
  if (fliser.length) main.append(h("section", { class: "maalere", "aria-label": "Nøkkeltall for rådet" }, ...fliser));

  /* 4 Kontoen måned for måned, og alle valgene ved siden av */
  const flate = h("div", { class: "oversikt" });
  if (x) {
    const figur = svg("Kontoen ved slutten av hver måned");
    const serier = [{ navn: x.kort ?? x.navn, farge: x.farge ?? "graa", verdier: x.saldo ?? [], bred: true }];
    const annen = hoyest && hoyest.id !== x.id && hoyest.saldo ? hoyest : null;
    if (annen) serier.push({ navn: annen.kort ?? annen.navn, farge: annen.farge ?? "graa", verdier: annen.saldo });
    flate.append(h("div", { class: "figur raad-figur" }, h("h3", {}, "Kontoen ved slutten av hver måned"),
      h("div", { class: "forklaring" }, ...serier.map(sr => h("span", { style: `--c: var(--${sr.farge})` }, sr.navn === serier[0].navn ? x.navn : `${annen.navn}, gir mest`))),
      figur,
      h("p", { class: "liten svak" }, `Det laveste punktet er det dere må ha klart: ${kr(x.behov)} ${mnd(x.bunnTid)}. Den stiplede streken er rammen.`)));
    tegnSaldo(figur, serier, (x.saldo ?? []).map((_, t) => MAANEDER[t] ?? `M${t}`), ramme);
  }
  const radFor = a => {
    const sal = a.type === "sal" ? salAv(a.id) : null;
    const linjer = [];
    if (ramme != null) {
      if (!a.holderNaa) linjer.push(h("span", { class: "minus" }, `Trenger ${kr(a.behov - ramme)} mer enn rammen.`));
      else if (!a.holderLav) linjer.push(h("span", {}, `Holder rammen nå, men ikke hvis salget blir 20 % lavere (trenger da ${kr(a.behovLav)}).`));
      else linjer.push(h("span", { class: "pluss" }, "Holder rammen, også hvis salget blir 20 % lavere."));
    }
    if (a.leieFoerStart > 0) linjer.push(h("span", {}, `${kr(a.leieFoerStart)} i leie forfaller før første konsert.`));
    if (a.fulleKonserter) linjer.push(h("span", {}, `Full på ${a.fulleKonserter} ${a.fulleKonserter === 1 ? "konsert" : "konserter"}, ${tall(a.tapteBilletter)} billetter går tapt.`));
    if (a.nvLav < 0) linjer.push(h("span", {}, "Taper penger hvis salget blir 20 % lavere."));
    return h("li", { class: `valg-rad${a.id === v.id ? " valgt" : ""}`, style: `--c: var(--${a.farge ?? "graa"})` },
      h("div", { class: "valg-navn" }, sal ? mini(sal) : h("span", { class: "prikk" }), h("span", {}, sal ? salTittel(sal) : a.navn),
        a.type === "egen" ? h("span", { class: "merke varsel" }, "utenfor casen") : null,
        a.id === v.id ? h("span", { class: "merke raad-merke" }, "vårt råd") : null),
      h("div", { class: "valg-tall" },
        h("span", {}, h("b", { class: `tall${a.nv < 0 ? " minus" : ""}` }, kr(a.nv)), h("small", {}, "verdi")),
        h("span", {}, h("b", { class: `tall${ramme != null && a.behov > ramme ? " minus" : ""}` }, kr(a.behov)), h("small", {}, "må ha klart"))),
      sal ? h("p", { class: "valg-leie" }, leieType(sal)) : null,
      h("p", { class: "valg-linjer" }, ...linjer.flatMap((l, i) => (i ? [" ", l] : [l]))));
  };
  flate.append(h("div", { class: "valgliste" },
    h("h3", {}, avstaar ? "Hvorfor ingen av salene" : `Hvorfor ${v.type === "sal" ? v.navn : "egen plan"}`),
    h("ol", {}, ...alt.map(radFor),
      h("li", { class: `valg-rad avstaa${avstaar ? " valgt" : ""}`, style: "--c: var(--graa)" },
        h("div", { class: "valg-navn" }, h("span", { class: "prikk" }), h("span", {}, "Avstå"), avstaar ? h("span", { class: "merke raad-merke" }, "vårt råd") : null),
        h("div", { class: "valg-tall" }, h("span", {}, h("b", { class: "tall" }, kr(0)), h("small", {}, "verdi"))),
        h("p", { class: "valg-linjer" }, "Ingen risiko, ingen konserter. Planleggingen er betalt uansett.")))));
  main.append(flate);

  /* 5 Mer om rådet: utfellbart, så hjemskjermen holder seg kort */
  const mer = h("div", { class: "trekk-liste" });

  // To tall, forklart uten fagord
  if (x) {
    const T = (x.saldo?.length ?? 1) - 1;
    const forklarKort = (tittel2, stort, etikett, fagord, ...tekst) => h("div", { class: "forklar-kort" },
      h("h3", {}, tittel2), h("div", { class: `stor tall ${stort < 0 ? "minus" : ""}` }, kr(stort)), h("div", { class: "stor-etikett" }, etikett),
      ...tekst.map(t => h("p", {}, t)), h("p", { class: "liten svak" }, fagord));
    mer.append(trekk("tall", "To tall, forklart uten fagord", "Hva verdien og «må ha klart» betyr",
      h("div", { class: "forklar-rad" },
        forklarKort("Hva sesongen er verdt", x.nv, `${x.navn}, i dagens kroner`, "I Resultater og arbeidsboka heter dette nåverdi.",
          `Alt som kommer inn minus alt som går ut, fra nå til det siste oppgjøret ${mnd(T)}. For ${x.navn} er det ${kr(x.netto)} mer inn enn ut.`,
          `En krone som kommer i juli er litt mindre verdt enn en krone i dag, fordi kronen i dag kunne stått i banken og gitt ${pst(s.rente ?? 0)} i året. Regnet om til dagens kroner er sesongen verdt ${kr(x.nv)}.`,
          "Er tallet under null, taper Sceneskift penger på sesongen. Da er det bedre å la være."),
        forklarKort("Hvor mye dere må ha klart", x.behov, `${x.navn}, det laveste kontoen kommer`, "I Resultater og arbeidsboka heter dette finansieringsbehov.",
          "Dere betaler før billettpengene kommer. Halve pakken går ut måneden før konserten, mens billettselskapet betaler måneden etter. Derfor går kontoen i minus i starten av våren.",
          `Det laveste punktet er det dere må ha klart: ${kr(x.behov)} ${mnd(x.bunnTid)}.${ramme != null ? ` Rammen er ${kr(ramme)}.` : ""}`,
          "Tallene gjelder ved slutten av hver måned. Inne i måneden kan kontoen ligge lavere, så ha en buffer."))));
  }

  // Når snur rådet
  if (!avstaar && R.grense) {
    const g = R.grense;
    const snuKort = (stort, tittel2, tekst, minus) => h("div", { class: "kort snu-kort", style: `--c: var(--${v.farge ?? "graa"})` },
      h("h3", {}, tittel2), h("div", { class: `stor ${minus ? "minus" : ""}` }, stort), h("p", { class: "liten" }, tekst));
    const kortene = [];
    const nvg = g.nvNegativUnder;
    if (nvg.status === "grense") kortene.push(snuKort(pst1(nvg.verdi), "Salget der sesongen gir tap",
      nvg.billetter >= 0 ? `Selger dere mindre enn dette av salget i 2026, taper ${v.navn} penger. Det er ${tall(nvg.billetter)} færre billetter enn ${faktor === 1 ? "i 2026" : "nå"}, over hele våren.`
                         : `Salget nå er allerede under grensen. ${v.navn} taper penger.`, nvg.billetter < 0));
    const rg = g.overRammenUnder;
    if (ramme != null && rg.status === "grense") kortene.push(snuKort(pst1(rg.verdi), "Salget der pengene ikke strekker til",
      `Under dette trenger ${v.navn} mer enn ${kr(ramme)}. Det er ${tall(Math.max(0, rg.billetter))} færre billetter enn ${faktor === 1 ? "i 2026" : "nå"}.`));
    const pl = g.pakkeLav;
    if (pl?.status === "grense") kortene.push(snuKort(kr(pl.verdi), "Pakkeprisen der rammen ryker",
      `Hvis salget blir 20 % lavere, holder ${v.navn} rammen bare med pakke under dette.${g.pakkeOverRammen.status === "grense" ? ` Med salget nå er grensen ${kr(g.pakkeOverRammen.verdi)}.` : ""}`, pl.verdi < s.pakke));
    if (R.snu.ramme?.status === "grense") kortene.push(snuKort(kr(R.snu.ramme.verdi), "Startfinansieringen som gir et annet råd",
      `Kan dere skaffe så mye, blir ${navnMedKort(R.snu.ramme.til)} rådet. Den gir mer, og holder da rammen også om salget blir 20 % lavere.`));
    mer.append(trekk("snu", "Når snur rådet", R.snu.ramme?.status === "grense" ? `Blant annet med ${kr(R.snu.ramme.verdi)} i startfinansiering` : "Grensene for salget og pakkeprisen",
      h("p", { class: "ingress" }, `Det er salget og pakkeprisen som avgjør. Grensene under gjelder ${v.navn}, med de andre forutsetningene som nå. Salget er målt mot salget i 2026, konsert for konsert.`),
      h("div", { class: "kort-rad" }, ...kortene),
      h("p", { style: "margin-top: 12px" }, h("button", { type: "button", class: "stille", onclick: () => gaaTil("resultater") }, "Grensene for alle salene og alle scenarioene står i Resultater"))));
  }

  // Artisten bestemmer salen (praksisvinkelen)
  const bb = besteBlanding(s, d.saler, d.program);
  const lokaler = [...new Set(d.program.map(k => k.i2026?.lokale).filter(Boolean))];
  let i2026 = "";
  if (lokaler.length === 2) {
    const [l1, l2] = lokaler.map(l => ({ navn: l, ks: d.program.filter(k => k.i2026?.lokale === l && k.salg2026 != null) }));
    const maks = l => Math.max(...l.ks.map(k => k.salg2026)), min = l => Math.min(...l.ks.map(k => k.salg2026));
    const [liten, stor] = maks(l1) < min(l2) ? [l1, l2] : maks(l2) < min(l1) ? [l2, l1] : [null, null];
    const ord = n => ["null", "én", "to", "tre", "fire", "fem", "seks", "sju", "åtte", "ni", "ti", "elleve", "tolv"][n] ?? String(n);
    if (liten) i2026 = ` I 2026 gikk de ${ord(liten.ks.length)} minste konsertene i ${liten.navn} og de ${ord(stor.ks.length)} største i ${stor.navn}.`;
  }
  const artist = [h("p", { class: "ingress" }, `I casen går alle konsertene i samme sal, og Maja regner med samme salg som i fjor uansett sal. I praksis er det artisten dere booker, og hva dere booker dem til, som avgjør hvor mange som kjøper billett. En solist på en sittende låtskriverkveld og et band på en stående klubbkveld trenger ikke samme rom. Salget avgjør så hvilken sal som lønner seg.${i2026}`)];
  if (bb) {
    const ref = v.type === "sal" ? v : alt.filter(a => a.type === "sal" && a.holderNaa).reduce((a, b) => (!a || b.nv > a.nv ? b : a), null);
    const perSal = [...new Set(bb.valg.map(y => y.salId))].map(id => ({ sal: salAv(id), ks: d.program.filter((k, i) => bb.valg[i].salId === id) }));
    // Når fast leie per konsert slår leie som følger salget: der leien i den ene salen blir lik den faste i den andre
    let skille = null;
    const fastSal = perSal.map(p => p.sal).find(sl => sl?.leie?.length === 1 && sl.leie[0].type === "perKonsert");
    const andelSal = perSal.map(p => p.sal).find(sl => sl?.leie?.length === 1 && sl.leie[0].type === "andel");
    if (fastSal && andelSal) {
      const F = fastSal.leie[0].belop, a = andelSal.leie[0], netto = s.billettpris - s.gebyr;
      if ((a.minimum ?? 0) < F && a.andel > 0) skille = `Fast leie i ${fastSal.navn} (${kr(F)}) er billigere enn ${pst(a.andel)} av oppgjøret i ${andelSal.navn} når en konsert selger mer enn ${tall(Math.floor(F / (a.andel * netto)))} billetter. Men ${fastSal.navn} har bare ${tall(Math.max(kapasitet(fastSal, "staa") ?? 0, kapasitet(fastSal, "sitte") ?? 0))} plasser, så den passer for konsertene i midten.`;
    }
    const liste = a => (a.length > 1 ? `${a.slice(0, -1).join(", ")} og ${a[a.length - 1]}` : a.join(""));
    artist.push(
      h("div", { class: "blanding" }, ...d.program.map((k, i) => { const sl = salAv(bb.valg[i].salId); return h("div", { class: "blanding-konsert", style: `--c: var(--${fargeFor(sl)})`, title: `${k.artist}: ${tall((k.forventetSalg ?? 0) * faktor)} forventet` },
        h("span", { class: "blanding-nr" }, String(k.nr)), h("span", { class: "blanding-sal" }, sl?.kort ?? sl?.navn), h("span", { class: "blanding-artist" }, k.artist),
        h("span", { class: "blanding-salg tall" }, `${tall((k.forventetSalg ?? 0) * faktor)} solgt`)); })),
      h("p", { class: "blanding-tekst" }, ...perSal.map((p, j) => [j ? " " : "", h("b", {}, p.sal?.navn), ` passer best for konsert ${liste(p.ks.map(k => k.nr))}.`]), skille ? ` ${skille}` : ""),
      h("p", { class: "blanding-tekst" }, `Den beste blandingen gir `, h("b", { class: "tall" }, kr(bb.nv)), ` i verdi og trenger `, h("b", { class: "tall" }, kr(bb.behov)),
        ref ? [`, mot `, h("b", { class: "tall" }, kr(ref.nv)), ` og `, h("b", { class: "tall" }, kr(ref.behov)), ` for alt i ${ref.navn}.`] : ".",
        bb.holderRammen ? "" : " Den holder ikke rammen."),
      h("p", { class: "varsel", style: "margin-top: 12px" }, h("span", { class: "merke varsel" }, "utenfor casen"), " Det krever at utleierne godtar enkeltkonserter. Casen sier at avtalene gjelder hele programmet, så dette er noe Maja kan spørre om, ikke et tilbud som finnes. Programmet viser forslaget per konsert, og knappen «Beste blanding» legger det inn."));
  }
  mer.append(trekk("artist", "Artisten bestemmer salen", bb ? `Beste blanding gir ${kr(bb.nv)} i verdi` : "Praksisvinkelen", ...artist));

  // Der vi går utenfor casen
  const tallInput = (felt, opt = {}) => h("input", { type: "number", min: 0, step: opt.step ?? 10, value: opt.pst ? Math.round((s[felt] ?? 0) * 1000) / 10 : (s[felt] ?? 0), "aria-label": opt.navn,
    onchange: e => { const verdi = Math.max(0, Number(e.target.value) || 0); s[felt] = opt.pst ? verdi / 100 : verdi; oppdater(); } });
  const nullKnapp = (...felt) => (felt.some(f => s[f]) ? h("button", { type: "button", class: "stille liten", onclick: () => { for (const f of felt) s[f] = 0; oppdater(); } }, "tilbake til 0") : null);
  const merkeHvis = b => (b ? h("span", { class: "merke varsel" }, "utenfor casen") : null);
  const rader = [];
  // Bar
  const barTekst = [];
  if (!avstaar) barTekst.push(`Hver 10 kr per gjest til Sceneskift gir ${v.navn} ${kr(R.barPer10)} mer i verdi.`);
  if (R.snu.bar.status === "grense") barTekst.push(`Fra ${kr(R.snu.bar.verdi)} mer per gjest blir ${navnMedKort(R.snu.bar.til)} rådet.`);
  else {
    barTekst.push("Ingen barinntekt snur rådet.");
    if (hoyest && hoyest.id !== v.id && ramme != null && hoyest.saldo && -hoyest.saldo[1] > ramme) barTekst.push(`${hoyest.navn} er over rammen allerede i januar, før det første oppgjøret kommer.`);
  }
  rader.push(["Barinntekt", `${kr(0)}`, h("div", { class: "utenfor-felt" },
    h("label", {}, tallInput("barPerGjest", { navn: "Bar: omsetning per gjest" }), " kr per gjest"),
    h("label", {}, tallInput("barAndel", { navn: "Bar: Sceneskifts andel", pst: true, step: 5 }), " % til Sceneskift"),
    merkeHvis(barTilSceneskift(s)), nullKnapp("barPerGjest", "barAndel")), barTekst.join(" ")]);
  // Uforutsett
  const u = R.snu.uforutsett;
  rader.push(["Uforutsette kostnader", `${kr(0)}`, h("div", { class: "utenfor-felt" },
    h("label", {}, tallInput("uforutsett", { navn: "Uforutsette kostnader per konsert", step: 500 }), " kr per konsert"), merkeHvis(s.uforutsett), nullKnapp("uforutsett")),
    `Rigg & Ro bærer det pakken dekker. Dette er det som faller utenfor, for eksempel skade eller ekstra vakthold.${u.status === "grense" ? ` ${avstaar ? "Rådet" : v.navn} tåler ${kr(Math.floor(u.verdi))} mer per konsert før rådet blir ${navnMedKort(u.til)}.` : ""}`]);
  // Pakke per konsert
  const medAvvik = d.program.filter(k => k.pakkeAvvik).length;
  rader.push(["Pakkepris per konsert", `${kr(s.pakke)} på alle`, h("div", { class: "utenfor-felt" }, medAvvik ? [`${medAvvik} ${medAvvik === 1 ? "konsert har" : "konserter har"} egen pris `, merkeHvis(true)] : "Lik på alle",
    h("button", { type: "button", class: "stille liten", onclick: () => gaaTil("program") }, "endre i Programmet")),
    "Artisthonoraret varierer i virkeligheten. Et større navn koster mer og selger mer, og kan flytte konserten til en annen sal."]);
  // Blanding
  rader.push(["Sal per konsert", "Én sal for hele programmet", h("div", { class: "utenfor-felt" }, res.blandet ? [`Egen plan blander ${res.egen.salerIBruk.map(id => salAv(id)?.kort ?? id).join(" og ")} `, merkeHvis(true)] : "Én sal"),
    bb ? `Beste blanding gir ${kr(bb.nv)} i verdi. Krever at utleierne godtar enkeltkonserter.` : ""]);
  // Lokaleeffekt
  const endretLokal = d.saler.filter(sl => (sl.lokaleeffekt ?? 1) !== 1);
  const mot = v.type === "sal" ? alt.filter(a => a.type === "sal" && a.id !== v.id && a.holderNaa).reduce((a, b) => (!a || b.nv > a.nv ? b : a), null) : null;
  const lg = mot ? lokaleeffektGrense(s, d.saler, d.program, v.id, mot.id) : null;
  rader.push(["Lokalet påvirker salget", "100 %, Majas premiss", h("div", { class: "utenfor-felt" }, endretLokal.length ? [endretLokal.map(sl => `${sl.kort ?? sl.navn} ${pst(sl.lokaleeffekt)}`).join(", "), " ", merkeHvis(true)] : "100 % i alle",
    h("button", { type: "button", class: "stille liten", onclick: () => gaaTil("saler") }, "endre under Saler")),
    lg?.status === "grense" ? `Et kjent eller stort lokale kan selge bedre. ${v.navn} er bedre enn ${mot.navn} så lenge den får minst ${pst1(lg.verdi)} av publikummet, når ${mot.navn} får alt.` : "Et kjent eller stort lokale kan selge bedre. Gruppas følsomhet, ikke en del av casen."]);
  // Sitteplasser
  const antatt = d.saler.filter(sl => sl.sitteAntatt && kapasitet(sl, "sitte") !== null);
  if (antatt.length) rader.push(["Sitteplasser", "Ikke oppgitt i tilbudene", h("div", { class: "utenfor-felt" }, `${antatt.map(sl => `${sl.kort ?? sl.navn} ${kapasitet(sl, "sitte")}`).join(", ")}, antatt`),
    "Betyr bare noe for konserter som settes sittende i Programmet."]);
  // Lån over rammen
  if (ramme != null && hoyest && !hoyest.holderNaa && hoyest.type === "sal") {
    const rh = res.altI[hoyest.id];
    rader.push(["Lån ut over rammen", "Holdes utenfor", h("div", { class: "utenfor-felt" }, `${pst(s.laanRente ?? 0)} rente per år, vår antakelse`),
      `${hoyest.navn} kan gjennomføres med et lån på ${kr(rh.laan)} i ${rh.maanederMedLaan} ${rh.maanederMedLaan === 1 ? "måned" : "måneder"}, ca. ${kr(rh.rentekostnad)} i rente. Lånet gjør ${hoyest.kort ?? hoyest.navn} mulig, ikke tryggere: om salget blir 20 % lavere, må det bli ${kr(Math.max(0, hoyest.behovLav - ramme))}.`]);
  }
  // Inne i måneden
  rader.push(["Når i måneden pengene går", "Ved månedsslutt", h("div", { class: "utenfor-felt" }, "Ved månedsslutt"),
    "Rigg & Ro vil ha første halvdel den 1. i måneden før konserten, og Flytbillett betaler innen den 20. i måneden etter. Inne i måneden kan kontoen ligge lavere enn tallene her. Derfor rådet om buffer."]);
  const iBruk = [barTilSceneskift(s), s.uforutsett, medAvvik, res.blandet, endretLokal.length].filter(Boolean).length;
  mer.append(trekk("utenfor", "Der vi går utenfor casen", iBruk ? `${iBruk} tillegg i bruk nå` : "Alle tilleggene står på null, som i casen",
    h("p", { class: "ingress" }, "Oppgaveteksten sier: «Utover postene i tabellen og lokaleleien er det ingen andre inntekter eller kostnader.» I virkeligheten er det sjelden slik, og å utelate noe er å anta at det er null. Derfor står tilleggene på null, så tallene over er casens, og vi viser hva som skjer om de ikke er det."),
    h("div", { class: "tabellramme" }, h("table", { class: "utenfor" },
      h("thead", {}, h("tr", {}, h("th", {}, "Tillegg"), h("th", {}, "I casen"), h("th", {}, "Hos oss nå"), h("th", {}, "Hva det gjør med rådet"))),
      h("tbody", {}, ...rader.map(([t, c, n, e]) => h("tr", {}, h("td", { class: "utenfor-navn" }, t), h("td", { class: "svak" }, c), h("td", {}, n), h("td", { class: "liten" }, e))))))));

  main.append(h("section", { class: "seksjon mer-om" }, h("h2", {}, "Mer om rådet"), mer));
}

/* ---------- Program ---------- */
// Merknaden etter «Beste blanding» gjelder så lenge programmet er som da knappen ble trykket
const blandingNokkel = () => JSON.stringify(state.data.program.map(k => [k.salId, k.oppsett, k.forventetSalg]));
function merknadBesteBlanding(r) {
  if (!state.besteBlanding || state.besteBlanding !== blandingNokkel()) return null;
  const ramme = state.data.sesong.ramme;
  const over = ramme != null && r.behov > ramme;
  if (over && r.nv <= 0) return `Ingen blanding holder rammen med dette salget. Beste blanding går ${kr(r.behov - ramme)} over rammen og har negativ nåverdi (${kr(r.nv)}). Avstå er bedre.`;
  if (over) return `Ingen blanding holder rammen med dette salget. Beste blanding har høyest nåverdi, men går ${kr(r.behov - ramme)} over rammen.`;
  if (r.nv <= 0) return `Beste blanding holder rammen, men har negativ nåverdi (${kr(r.nv)}). Avstå er bedre.`;
  return null;
}

function renderProgram(main, res) {
  const d = state.data;
  const perKonsert = salerPerKonsert();
  const helSesong = d.saler.filter(s => s.kunHelSesong);
  const sek = h("section", { class: "seksjon" },
    h("h2", {}, "Programmet, konsert for konsert"),
    fork("p", "ingress", `Endre artist, forventet salg, oppsett og sal. Forventet salg starter på salget til tilsvarende konsert i 2026, som er Majas premiss. Bidraget er billettinntekt etter gebyr og publikumsutgift, minus pakken og leien for salen, uten diskontering.${helSesong.length ? ` ${helSesong.map(salTittel).join(" og ")} har fast sesongleie og kan bare velges som hel sesong, se stripa øverst.` : ""}`));

  sek.append(h("div", { class: "verktoylinje" },
    h("button", { type: "button", onclick: () => { for (const k of d.program) { const f = forslagForKonsert(d.sesong, d.saler, k); if (f) { k.salId = f.salId; k.oppsett = f.oppsett; } } oppdater(); } }, "Bruk forslagene på alle"),
    h("button", { type: "button", title: "Den kombinasjonen av saler per konsert som gir høyest nåverdi og holder rammen", onclick: () => { const b = besteBlanding(d.sesong, d.saler, d.program); if (b) { d.program.forEach((k, i) => { k.salId = b.valg[i].salId; k.oppsett = b.valg[i].oppsett; }); state.besteBlanding = blandingNokkel(); oppdater(); } } }, "Beste blanding"),
    h("button", { type: "button", class: "stille", onclick: () => { for (const k of d.program) k.forventetSalg = k.salg2026 ?? k.forventetSalg; oppdater(); } }, "Salg som i 2026"),
    ...perKonsert.map(s => h("button", { type: "button", class: "stille", onclick: () => { for (const k of d.program) { k.salId = s.id; if (kapasitet(s, k.oppsett) === null) k.oppsett = k.oppsett === "sitte" ? "staa" : "sitte"; } oppdater(); } }, `Alle i ${s.kort ?? s.navn}`)),
    h("span", { class: "mellomrom" }),
    h("button", { type: "button", onclick: () => leggTilKonsert() }, "Legg til konsert")));

  const merknad = merknadBesteBlanding(res.egen);
  if (merknad) sek.append(h("p", { class: "varsel", style: "margin-top: 14px" }, merknad));

  const hode = h("tr", {},
    h("th", {}, "Nr"), h("th", {}, "Dato"), h("th", {}, "Artist"), h("th", {}, "Sjanger"), h("th", { class: "hoyre" }, "Forventet salg"),
    h("th", {}, "Oppsett"), h("th", {}, "Sal"), h("th", {}, "Forslag"), h("th", { class: "hoyre" }, "Pakke"), h("th", { class: "hoyre" }, "Billetter"), h("th", { class: "hoyre" }, "Leie"), h("th", { class: "hoyre" }, "Bidrag"), h("th", {}));
  const rader = d.program.map((k, i) => radForKonsert(k, i, res.egen.perKonsert[i], perKonsert));
  const sumBidrag = res.egen.perKonsert.reduce((a, k) => a + k.bidrag, 0);
  const fot = h("tfoot", {},
    h("tr", {}, h("td", { colspan: 9 }, "Sum bidrag fra konsertene"), h("td", { class: "hoyre tall" }, tall(res.egen.perKonsert.reduce((a, k) => a + k.n, 0))), h("td", { class: "hoyre tall" }, kr(res.egen.perKonsert.reduce((a, k) => a + k.leie, 0))), h("td", { class: `hoyre tall ${sumBidrag < 0 ? "minus" : ""}` }, kr(sumBidrag)), h("td")),
    res.egen.fastLeie ? h("tr", {}, h("td", { colspan: 11 }, `Faste leiebetalinger for sesongen (${res.egen.salerIBruk.map(id => salAv(id)?.navn).join(", ")})`), h("td", { class: "hoyre tall minus" }, kr(-res.egen.fastLeie)), h("td")) : null,
    h("tr", {}, h("td", { colspan: 11 }, "Samlet netto for sesongen, udiskontert"), h("td", { class: `hoyre tall ${res.egen.netto < 0 ? "minus" : ""}` }, kr(res.egen.netto)), h("td")));
  sek.append(h("div", { class: "tabellramme" }, h("table", { class: "program" }, h("thead", {}, hode), h("tbody", {}, rader.flat()), fot)));

  const kappet = res.egen.perKonsert.filter(k => k.kappet);
  if (kappet.length) sek.append(h("p", { class: "varsel", style: "margin-top: 14px" }, `${kappet.length} ${kappet.length === 1 ? "konsert" : "konserter"} selger mindre enn forventet fordi salen er full: ${kappet.map(k => `nr ${k.nr} (${tall(k.onsket)} forventet, ${k.kap} plasser)`).join(", ")}. Tapte billetter: ${tall(kappet.reduce((a, k) => a + k.onsket - k.n, 0))}.`));
  main.append(sek);
}

function radForKonsert(k, i, r, perKonsert) {
  const d = state.data;
  const sal = salAv(k.salId);
  const f = forslagForKonsert(d.sesong, d.saler, k);
  const forslagLik = f && f.salId === k.salId && f.oppsett === k.oppsett;
  const endre = (felt, verdi) => { k[felt] = verdi; oppdater(); };
  const oppsettKnapp = (o, tekst) => h("button", { type: "button", "aria-pressed": String(k.oppsett === o), disabled: sal && kapasitet(sal, o) === null, title: sal && kapasitet(sal, o) === null ? `${sal.navn} har ikke ${tekst.toLowerCase()} oppsett` : `${tekst}: ${kapasitet(sal, o) ?? "?"} plasser`, onclick: () => endre("oppsett", o) }, tekst);
  const avvik = k.salg2026 != null && k.forventetSalg !== k.salg2026;
  const fSal = f ? salAv(f.salId) : null;
  const forklaringsrad = fork("tr", "forklaringsrad", h("td", { colspan: 13 },
    k.i2026 ? h("span", {}, `I 2026: ${k.i2026.navn} i ${k.i2026.lokale} (${k.i2026.kapasitet} plasser i alt), ${tall(k.salg2026)} betalte billetter. `) : null,
    f ? h("span", {}, `Forslag: ${f.hvorfor}`) : null,
    k.pakkeAvvik ? h("span", {}, `Pakken er ${kr(Math.abs(k.pakkeAvvik))} ${k.pakkeAvvik > 0 ? "dyrere" : "billigere"} enn for resten av sesongen (utenfor casen).`) : null));
  return [h("tr", {},
    h("td", { class: "nr" }, String(k.nr)),
    h("td", { class: "dato" }, h("input", { type: "text", value: k.dato ?? "", size: 5, "aria-label": "Dato", onchange: e => endre("dato", e.target.value) })),
    h("td", { class: "artist" }, h("input", { type: "text", value: k.artist ?? "", "aria-label": "Artist", onchange: e => endre("artist", e.target.value) }),
      k.besetning ? fork("div", "liten svak", k.besetning) : null),
    h("td", { class: "sjanger" }, h("select", { "aria-label": "Sjanger", onchange: e => endre("sjanger", e.target.value) },
      ...[...new Set([...SJANGRE, k.sjanger].filter(Boolean))].map(s => h("option", { value: s, selected: s === k.sjanger }, s)))),
    h("td", { class: "salg hoyre" },
      h("input", { type: "number", min: 0, step: 10, value: k.forventetSalg, "aria-label": "Forventet salg", onchange: e => endre("forventetSalg", Math.max(0, Number(e.target.value) || 0)) }),
      avvik ? h("div", { class: "liten" }, h("button", { type: "button", class: "stille liten", onclick: () => endre("forventetSalg", k.salg2026) }, `2026: ${tall(k.salg2026)}`)) : null),
    h("td", {}, h("div", { class: "oppsett-valg" }, oppsettKnapp("sitte", "Sitte"), oppsettKnapp("staa", "Stå"))),
    h("td", {}, h("div", { class: "salvalg", style: `--c: var(--${fargeFor(sal)})` }, mini(sal),
      h("select", { "aria-label": "Sal", onchange: e => { const s = salAv(e.target.value); k.salId = s.id; if (kapasitet(s, k.oppsett) === null) k.oppsett = k.oppsett === "sitte" ? "staa" : "sitte"; oppdater(); } },
        ...perKonsert.map(s => h("option", { value: s.id, selected: s.id === k.salId }, salTittel(s)))))),
    h("td", { class: "forslag" },
      f ? [
        forslagLik ? h("span", { class: "som-valgt", title: f.hvorfor }, "Som valgt")
                   : h("button", { type: "button", class: "forslag-knapp", title: f.hvorfor, onclick: () => { k.salId = f.salId; k.oppsett = f.oppsett; oppdater(); } }, `${fSal?.kort ?? fSal?.navn} ${f.oppsett === "sitte" ? "sittende" : "stående"}`),
      ] : h("span", { class: "som-valgt" }, "Ingen sal passer")),
    h("td", { class: "hoyre pakke" },
      h("input", { type: "number", min: 0, step: 1000, value: pakkeFor(d.sesong, k), "aria-label": "Pakkepris for konserten", title: "Pakken for denne konserten. I casen er den lik for alle (utenfor casen hvis den endres)",
                   onchange: e => endre("pakkeAvvik", Math.max(0, Number(e.target.value) || 0) - (d.sesong.pakke ?? 0)) }),
      k.pakkeAvvik ? h("div", { class: "liten" }, h("span", { class: "merke varsel" }, "utenfor casen"), " ", h("button", { type: "button", class: "stille liten", onclick: () => endre("pakkeAvvik", 0) }, "som resten")) : null),
    h("td", { class: "hoyre tall" }, tall(r.n), r.kappet ? h("div", {}, h("span", { class: "merke varsel" }, "fullt")) : null),
    h("td", { class: "hoyre tall leie" }, kr(r.leie), r.leieDeler?.some(x => x.minimumSlaarInn) ? h("div", {}, h("span", { class: "merke" }, "minimum")) : null),
    h("td", { class: `hoyre tall bidrag ${r.bidrag < 0 ? "minus" : ""}` }, kr(r.bidrag)),
    h("td", {}, h("button", { type: "button", class: "stille liten farlig", title: "Fjern konserten", onclick: () => { if (confirm(`Fjerne konsert ${k.nr} (${k.artist || "uten navn"})?`)) { d.program.splice(i, 1); oppdater(); } } }, "Fjern"))),
    forklaringsrad];
}

function leggTilKonsert() {
  const d = state.data;
  const sist = d.program[d.program.length - 1];
  const sal = salerPerKonsert()[0];
  d.program.push({ nr: Math.max(0, ...d.program.map(k => k.nr)) + 1, dato: "", artist: "", sjanger: "Pop", maaned: sist?.maaned ?? 1,
    salg2026: null, forventetSalg: 200, salId: sal?.id ?? null, oppsett: sal && kapasitet(sal, "staa") !== null ? "staa" : "sitte", notat: "" });
  oppdater();
}

/* ---------- Resultater ---------- */
function renderResultater(main, res) {
  const d = state.data;
  const s = d.sesong;

  // Gliderne bygges én gang og tegnes ikke på nytt mens du drar. Resten av fanen tegnes på nytt, throttlet.
  const innhold = h("div", { id: "res-innhold" });
  // «Hva snur rådet» ligger øverst og tegnes på nytt sammen med resten
  const raadBoks = h("div", { id: "res-raad" });
  let venter = false;
  const oppdaterInnhold = () => {
    lagre();
    if (venter) return;
    venter = true;
    requestAnimationFrame(() => { venter = false; const r = beregn(); renderStripe(r); tegnScenarioer(); raadBoks.replaceChildren(); fyllRaad(raadBoks); innhold.replaceChildren(); fyllResultater(innhold, r); });
  };
  // Scenariovelgeren tegnes på nytt når gliderne flyttes, så den viser «Egne verdier» når ingen stemmer
  const scenarioBoks = h("div", { class: "scenarioer" });
  const begrunnelse = h("p", { class: "scenario-begrunnelse" });
  const tegnScenarioer = () => {
    const aktiv = aktivtScenario(s);
    scenarioBoks.replaceChildren(...s.scenarioer.map(sc => h("button", { type: "button", class: `scenario${sc.oppside ? " oppside" : ""}`, "aria-pressed": String(sc === aktiv),
      onclick: () => { velgScenario(s, sc); render(); } },
      h("span", { class: "scenario-navn" }, sc.navn, sc.oppside ? h("span", { class: "merke" }, "oppside") : null),
      h("span", { class: "scenario-verdier tall" }, `${pst(sc.etterspoerselsfaktor)} salg, ${kr(sc.pakke)}`))),
      h("div", { class: `scenario egne${aktiv ? "" : " aktiv"}` },
        h("span", { class: "scenario-navn" }, "Egne verdier"),
        h("span", { class: "scenario-verdier tall" }, aktiv ? "flytt en glider" : `${pst(s.etterspoerselsfaktor)} salg, ${kr(s.pakke)}`)));
    begrunnelse.textContent = aktiv ? aktiv.begrunnelse : "Verdiene fra gliderne. Ingen av scenarioene i arbeidsboka stemmer akkurat med dem.";
  };
  tegnScenarioer();
  main.append(raadBoks);
  fyllRaad(raadBoks);
  main.append(h("section", { class: "seksjon" },
    h("h2", {}, "Scenario"),
    fork("p", "ingress", "Ett scenario om gangen, som i arbeidsboka. Scenarioet setter etterspørselen i forhold til 2026 og pakkeprisen per konsert. Alt på siden regnes på nytt. Nivåene er gruppas antakelser, ikke sannsynligheter, og Høy etterspørsel er en oppside som ikke inngår i beslutningsreglene."),
    scenarioBoks, begrunnelse));
  const glider = (navn, felt, min, max, steg, vis, basis) => {
    const inp = h("input", { type: "range", min, max, step: steg, value: s[felt], "aria-label": navn });
    const verdi = h("b", { class: "tall" });
    const basisKnapp = h("button", { type: "button", class: "stille liten", onclick: () => { s[felt] = basis; inp.value = basis; tegn(); oppdaterInnhold(); } }, "basis");
    const tegn = () => {
      verdi.replaceChildren(vis(s[felt]), s[felt] !== basis ? basisKnapp : "");
      inp.style.setProperty("--fyll", `${((s[felt] - min) / (max - min)) * 100}%`);
    };
    inp.addEventListener("input", e => { s[felt] = Number(e.target.value); tegn(); oppdaterInnhold(); });
    tegn();
    return h("div", { class: "glider" }, h("label", {}, h("span", {}, navn), verdi), inp, h("div", { class: "ende" }, h("span", {}, vis(min)), h("span", {}, vis(max))));
  };
  main.append(h("section", { class: "seksjon" },
    h("h2", {}, "Finjuster: hva om salget eller pakkeprisen blir noe annet?"),
    fork("p", "ingress", "Dra i gliderne for verdier mellom scenarioene. Alt på siden regnes på nytt. Basis er Majas premiss: samme salg som i 2026 og 60 000 kr per konsert."),
    h("div", { class: "glidere" },
      glider("Etterspørsel i forhold til 2026", "etterspoerselsfaktor", 0.5, 1.3, 0.01, pst, 1),
      glider("Pakkepris per konsert", "pakke", 48000, 78000, 500, kr, 60000))));
  main.append(innhold);
  fyllResultater(innhold, res);
}

/** Øverst i Resultater: de tre beslutningsreglene og grensene der rådet snur. Få og store tall. */
function fyllRaad(boks) {
  const d = state.data;
  const s = d.sesong;
  const sc = aktivtScenario(s);
  const regler = beslutningsregler(s, d.saler, d.program);
  const gr = grenser(s, d.saler, d.program);
  const pstEn = v => (Math.round(v * 1000) / 10).toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
  const handlingNavn = v => (v.type === "sal" ? (v.kort ? `${v.kort}: ${v.navn}` : v.navn) : v.navn);
  const chip = v => [h("span", { class: `valg-chip${v.type === "avstaa" ? " avstaa" : ""}`, style: `--c: var(--${v.farge ?? "graa"})` }, v.type === "sal" ? mini(salAv(v.id)) : h("span", { class: "prikk" }), handlingNavn(v)), v.type === "egen" ? h("span", { class: "merke varsel" }, "utenfor casen") : null];
  const regelRad = r => {
    const over = s.ramme != null && r.valg.behov > s.ramme;
    return h("div", { class: "regel" },
      h("div", { class: "regel-nr" }, `Regel ${r.nr}`),
      h("div", { class: "regel-tekst" }, h("b", {}, r.navn), h("span", { class: "svak" }, r.krav)),
      h("div", { class: "regel-valg" }, chip(r.valg),
        h("span", { class: "liten svak tall" }, r.valg.type === "avstaa" ? "ingen av salene tåler alle scenarioene" : `nåverdi ${kr(r.valg.nv)}, trenger ${kr(r.valg.behov)}${over ? ", over rammen" : ""}`)));
  };
  const naaTekst = `${pst(s.etterspoerselsfaktor ?? 1)} salg og ${kr(s.pakke)} per konsert${sc ? ` (${sc.navn})` : " (egne verdier)"}`;

  // Grensene som tabell: én rad per handling, tre grenser med stort tall og avstanden fra der vi er nå
  const celle = (g, slag) => {
    if (g.status !== "grense") {
      const tekst = { aldri: slag === "nv" ? "blir aldri negativ" : "holder rammen uansett", alltid: slag === "nv" ? "negativ selv med fullt hus" : slag === "pakke" ? "over rammen selv uten pakke" : "over rammen selv med fullt hus" }[g.status];
      return h("td", { class: "hoyre" }, h("div", { class: `grense-stor ${g.status === "alltid" ? "minus" : "svak"}` }, g.status === "alltid" ? "alltid" : "aldri"), h("div", { class: "liten svak" }, tekst));
    }
    const avstand = slag === "pakke" ? g.kroner : g.billetter;
    const under = avstand < 0;
    const enhet = slag === "pakke" ? "kr" : Math.abs(Math.round(avstand)) === 1 ? "billett" : "billetter";
    const margin = under ? `${tall(-avstand)} ${enhet} over grensen nå` : `${tall(avstand)} ${enhet} å gå på`;
    return h("td", { class: "hoyre" },
      h("div", { class: `grense-stor tall ${under ? "minus" : ""}` }, slag === "pakke" ? kr(g.verdi) : pstEn(g.verdi)),
      h("div", { class: `liten tall ${under ? "minus" : "svak"}` }, margin));
  };
  const tabell = h("div", { class: "tabellramme" }, h("table", { class: "grenser" },
    h("thead", {}, h("tr", {},
      h("th", {}, "Handling"),
      h("th", { class: "hoyre" }, "Nåverdien blir negativ når salget er under", h("div", { class: "liten svak tall" }, `med pakke ${kr(s.pakke)}`)),
      h("th", { class: "hoyre" }, "Behovet går over rammen når salget er under", h("div", { class: "liten svak tall" }, `med pakke ${kr(s.pakke)}`)),
      h("th", { class: "hoyre" }, "Behovet går over rammen når pakken er over", h("div", { class: "liten svak tall" }, `ved ${pst(s.etterspoerselsfaktor ?? 1)} salg`)))),
    h("tbody", {}, ...gr.map(g => h("tr", { style: `--c: var(--${g.farge ?? "graa"})` },
      h("td", { class: "handling" }, h("span", { class: "prikk" }), handlingNavn(g), g.type === "egen" ? h("span", { class: "merke varsel" }, "utenfor casen") : null),
      celle(g.nvNegativUnder, "nv"), celle(g.overRammenUnder, "behov"), celle(g.pakkeOverRammen, "pakke"))))));

  boks.append(h("section", { class: "seksjon raad" },
    h("h2", {}, "Hva snur rådet"),
    fork("p", "ingress", "Beslutningsreglene fra arbeidsboka og grensene der svaret snur. Regel 1 krever at rammen holder i alle scenarioene, regel 2 bare med verdiene som gjelder nå, og regel 3 ser bort fra rammen. Alle rangerer etter nåverdien nå. Avstå gir null og holder alltid rammen, så reglene velger avstå når resten gir tap. Grensene finnes med søk i motoren, med de andre forutsetningene som de er nå. Salget måles som andel av salget i 2026, og avstanden i billetter gjelder hele sesongen."),
    h("div", { class: "regler" }, ...regler.map(regelRad)),
    h("p", { class: "naa-linje svak" }, "Nå: ", h("b", { class: "tall" }, naaTekst), s.ramme != null ? [". Rammen er ", h("b", { class: "tall" }, kr(s.ramme))] : ". Ingen ramme satt", "."),
    h("h3", { class: "grenser-tittel" }, "Grensene"),
    tabell));
}

function fyllResultater(innhold, res) {
  const d = state.data;
  const s = d.sesong;
  const ref = salAv(state.referanse) ?? d.saler[0];

  innhold.append(h("section", { class: "seksjon" },
    fork("p", "ingress", "Stripa øverst viser nåverdi med 4 % realrente per år, og det største beløpet Sceneskift ligger ute med underveis, målt ved månedsslutt. Avstå gir null i begge. Ligger behovet over rammen, vises lånet som trengs (det saldoen ligger under rammen, som en kassekreditt) og renten på det. Renten holdes utenfor nåverdien, slik casen krever, og vises som egen linje."),
    res.blandet ? h("p", { class: "varsel" }, `Egen plan bruker ${res.egen.salerIBruk.map(id => salAv(id)?.navn).join(" og ")}. Casen sier at avtalene gjelder hele programmet, så en blanding krever at utleierne godtar enkeltkonserter. Vis det som et alternativ Maja kan ta opp før signering, ikke som et tilbud som finnes.`) : null,
    lokaleeffektMerknad(), utvidelserMerknad()));

  innhold.append(konsekvenstabell(res));

  const etiketter = res.egen.saldo.map((_, t) => MAANEDER[t] ?? `M${t}`);
  const serier = [
    ...d.saler.map(x => ({ navn: x.kort ?? x.navn, farge: fargeFor(x), verdier: padTil(res.altI[x.id].saldo, etiketter.length) })),
    { navn: "Egen plan", farge: "gronn", verdier: res.egen.saldo, bred: true },
  ];
  const saldoSvg = svg("Saldo per måned");
  const bidragSvg = svg("Bidrag per konsert");
  const refValg = h("select", { onchange: e => { state.referanse = e.target.value; render(); } }, ...d.saler.map(x => h("option", { value: x.id, selected: x.id === ref?.id }, `Alt i ${salTittel(x)}`)));
  innhold.append(h("section", { class: "seksjon" },
    h("div", { class: "figur-rad" },
      h("div", { class: "figur" }, h("h3", {}, "Saldo ved månedsslutt"), fork("p", "liten svak", "Bunnen på hver linje er det salen krever i startfinansiering."),
        h("div", { class: "forklaring" }, ...serier.map(x => h("span", { style: `--c: var(--${x.farge})` }, x.navn))), saldoSvg),
      h("div", { class: "figur" }, h("h3", {}, "Bidrag per konsert, egen plan mot ", refValg), fork("p", "liten svak", "Udiskontert. Faste sesongbetalinger er ikke fordelt på konsertene."),
        h("div", { class: "forklaring" }, h("span", { style: "--c: var(--gronn)" }, "Egen plan"), h("span", { style: `--c: var(--${fargeFor(ref)}); opacity: .7` }, `Alt i ${ref?.kort ?? ref?.navn}`)), bidragSvg))));
  tegnSaldo(saldoSvg, serier, etiketter, s.ramme);
  tegnBidrag(bidragSvg, [
    { navn: "Egen plan", farge: "gronn", verdier: res.egen.perKonsert.map(k => k.bidrag) },
    { navn: `Alt i ${ref?.kort}`, farge: fargeFor(ref), verdier: ref ? res.altI[ref.id].perKonsert.map(k => k.bidrag) : [] },
  ], d.program.map(k => `${k.nr}`));

  const L = res.egen.linjer;
  const rad = (navn, verdier, cls = "") => h("tr", { class: cls }, h("td", {}, navn), ...verdier.map(v => h("td", { class: `hoyre tall ${v < 0 ? "minus" : ""}` }, v === 0 ? h("span", { class: "svak" }, "0") : tall(v))));
  innhold.append(h("section", { class: "seksjon" },
    h("h2", {}, "Betalingene måned for måned, egen plan"),
    fork("p", "ingress", "Start er like før første konsertmåned og diskonteres ikke. Billettoppgjøret kommer måneden etter konserten, leie etter salens vilkår. Følg et tall herfra til stripa øverst."),
    h("div", { class: "tabellramme" }, h("table", { class: "kontantstrom" },
      h("thead", {}, h("tr", {}, h("th", {}, "Kroner"), ...etiketter.map(e => h("th", { class: "hoyre" }, e)))),
      h("tbody", {}, rad("Billettoppgjør", L.billetter), rad("Publikumsutgift", L.utgift), rad("Pakke", L.pakke), rad("Leie", L.leie),
        ...(L.bar.some(Boolean) ? [rad("Bar, Sceneskifts andel", L.bar)] : []), ...(L.uforutsett.some(Boolean) ? [rad("Uforutsette kostnader", L.uforutsett)] : []),
        rad("Sum i måneden", res.egen.cf), rad("Saldo", res.egen.saldo, "saldo"),
        ...(res.egen.laan > 0 ? [rad("Under rammen, lån", res.egen.trekk.map(x => -x)), rad("Rente på lånet", res.egen.renter.map(x => -x))] : []))))));
}

/** Merknad når en sal har lokaleeffekt ulik 100 %, så det ikke skjer i stillhet. */
function lokaleeffektMerknad() {
  const saler = state.data.saler.filter(s => (s.lokaleeffekt ?? 1) !== 1);
  if (!saler.length) return null;
  return h("p", { class: "varsel", style: "margin-top: 12px" }, h("span", { class: "merke varsel" }, "følsomhet"), " ",
    `Lokaleeffekt: ${saler.map(s => `${s.navn} ${pst(s.lokaleeffekt)}`).join(", ")}. Salget i ${saler.length === 1 ? "den salen" : "de salene"} regnes som den andelen av etterspørselen, og taket i salen gjelder fortsatt. Majas premiss er 100 %. Endres under Saler.`);
}

/** Merknad når en utvidelse utenfor casen (bar, uforutsett, pakke per konsert) er i bruk. */
function utvidelserMerknad() {
  const d = state.data;
  const tekst = utvidelserTekst(d.sesong, d.program);
  if (!tekst.length) return null;
  return h("p", { class: "varsel", style: "margin-top: 12px" }, h("span", { class: "merke varsel" }, "utenfor casen"), " ",
    `${tekst.join(". ")}. Casen har ingen andre inntekter eller kostnader enn pakken, leien og postene per billett. Settes tilbake under Rådet eller Forutsetninger.`);
}

function utvidelserTekst(s, program) {
  const ut = [];
  for (const u of utvidelserIBruk(s, program)) {
    if (u === "bar") ut.push(`Bar: ${kr(s.barPerGjest)} per gjest, ${pst(s.barAndel)} til Sceneskift (${kr(barTilSceneskift(s))} per gjest)`);
    if (u === "uforutsett") ut.push(`Uforutsette kostnader: ${kr(s.uforutsett)} per konsert`);
    if (u === "pakkeAvvik") { const n = program.filter(k => k.pakkeAvvik).length; ut.push(`Egen pakkepris på ${n} ${n === 1 ? "konsert" : "konserter"}`); }
  }
  return ut;
}

/** Konsekvenstabellen fra oppgaveteksten: én rad per handling (også å avstå), én kolonne per scenario. Nåverdi og om rammen holder. */
function konsekvenstabell(res) {
  const d = state.data;
  const s = d.sesong;
  const aktiv = aktivtScenario(s);
  const alleSc = beregnScenarioer(s, d.saler, d.program);
  const hodeKlasse = sc => `${sc === aktiv ? "aktiv" : ""}${sc.oppside ? " oppside" : ""}`;
  const celle = (sc, r) => {
    const over = s.ramme != null && r.behov > s.ramme;
    return h("td", { class: `hoyre ${hodeKlasse(sc)}` },
      h("div", { class: `tall nv-celle ${r.nv < 0 ? "minus" : ""}` }, kr(r.nv)),
      h("div", { class: `liten tall ${over ? "minus" : "svak"}` }, r.behov ? `trenger ${tall(r.behov)}${over ? ", over rammen" : ""}` : "trenger 0"));
  };
  const rader = [
    ...d.saler.map(x => ({ navn: `Alt i ${salTittel(x)}`, farge: fargeFor(x), hent: r => r.altI[x.id] })),
    ...(res.blandet ? [{ navn: "Egen plan", farge: "gronn", merke: "utenfor casen", hent: r => r.egen }] : []),
    { navn: "Avstå", farge: "graa", hent: r => r.avstaa },
  ];
  const holder = sc => rader.filter(r => r.navn !== "Avstå" && sc.res && r.hent(sc.res).holderRammen).map(r => r.navn.replace("Alt i ", "").split(":")[0]);
  return h("section", { class: "seksjon" },
    h("h2", {}, "Alle scenarioene samlet"),
    fork("p", "ingress", "Konsekvenstabellen fra oppgaveteksten: én rad per handling, også å avstå, og én kolonne per scenario. Nåverdien står stort, og under hvor mye Sceneskift må ligge ute med. Rødt betyr tap eller over rammen. Den aktive kolonnen er valgt over."),
    h("div", { class: "tabellramme" }, h("table", { class: "konsekvens" },
      h("thead", {}, h("tr", {}, h("th", {}, "Handling"), ...alleSc.map(({ scenario: sc }) => h("th", { class: `hoyre ${hodeKlasse(sc)}` }, sc.navn, h("div", { class: "liten svak tall" }, `${pst(sc.etterspoerselsfaktor)} salg, ${kr(sc.pakke)}`))))),
      h("tbody", {}, ...rader.map(rad => h("tr", { style: `--c: var(--${rad.farge})` },
        h("td", { class: "handling" }, h("span", { class: "prikk" }), rad.navn, rad.merke ? h("span", { class: "merke varsel" }, rad.merke) : null),
        ...alleSc.map(({ scenario: sc, res: r }) => celle(sc, rad.hent(r)))))),
      s.ramme == null ? null : h("tfoot", {}, h("tr", {}, h("td", {}, "Holder rammen"), ...alleSc.map(({ scenario: sc, res: r }) => {
        const ok = holder({ res: r });
        return h("td", { class: `hoyre liten ${hodeKlasse(sc)} ${ok.length ? "" : "minus"}` }, ok.length ? ok.join(", ") : "ingen");
      }))))));
}

function padTil(arr, n) { const ut = arr.slice(); while (ut.length < n) ut.push(ut[ut.length - 1]); return ut; }

/* ---------- Saler ---------- */
function renderSaler(main, res) {
  const d = state.data;
  const sek = h("section", { class: "seksjon" },
    h("h2", {}, "Salene og vilkårene"),
    fork("p", "ingress", "Kapasitet er salgbare plasser per oppsett. Tomt felt betyr at salen ikke tilbyr oppsettet. Leien settes sammen av byggeklosser, så nye saler og nye vilkår kan legges inn uten å endre noe annet."),
    h("div", { class: "verktoylinje" },
      h("button", { type: "button", onclick: () => leggTilSal() }, "Legg til sal"),
      h("button", { type: "button", class: "stille", onclick: () => { const C = d.saler.find(x => x.id === "C") ?? d.saler[0]; leggTilSal(C); } }, "Legg til som kopi av C")));
  const liste = h("div", { class: "sal-liste" });
  for (const s of d.saler) liste.append(salKort(s, res));
  sek.append(liste);
  main.append(sek);
  main.append(h("section", { class: "seksjon" },
    h("h2", {}, "Lokalene i 2026, til sammenligning"),
    fork("p", "ingress", "Sceneskift delte 2026 mellom to rom (arkivet på nettsiden og oppgjørsfila). De seks minste konsertene gikk i Verkstedet, de seks største i Maskinhallen. Tallene er total publikumskapasitet inkludert fribilletter, ikke salgbare plasser. Ingen konsert var full: høyest var konsert 6 med 480 av 550."),
    h("div", { class: "kort-rad" }, ...LOKALER_2026.map(l => h("div", { class: "kort", style: "--c: var(--graa)" },
      h("h3", {}, l.navn),
      h("div", { class: "stor" }, String(l.kapasitet)),
      h("div", { class: "stor-etikett" }, "total kapasitet"),
      h("dl", {}, h("dt", {}, "Konserter i 2026"), h("dd", {}, String(d.program.filter(k => k.i2026?.lokale === l.navn).length)),
        h("dt", {}, "Solgte, snitt"), h("dd", {}, (() => { const ks = d.program.filter(k => k.i2026?.lokale === l.navn && k.salg2026 != null); return ks.length ? tall(ks.reduce((a, k) => a + k.salg2026, 0) / ks.length) : "0"; })())),
      fork("p", "notat", l.beskrivelse))))));
}

function salKort(s, res) {
  const d = state.data;
  const standard = SALER_2027.find(x => x.id === s.id);
  const erEndret = standard && JSON.stringify(stripp(s)) !== JSON.stringify(stripp(standard));
  const endre = (felt, verdi) => { s[felt] = verdi; reparer(); oppdater(); };
  const kapFelt = (o, navn) => h("label", { class: "felt" },
    h("span", {}, navn, o === "sitte" && s.sitteAntatt ? h("span", { class: "merke" }, "antatt") : null),
    h("input", { type: "number", min: 0, step: 10, value: s.kapasitet[o] ?? "", placeholder: "ingen", onchange: e => { s.kapasitet[o] = e.target.value === "" ? null : Math.max(0, Number(e.target.value)); reparer(); oppdater(); } }));
  const brukt = d.program.filter(k => k.salId === s.id).length;
  const r = res.altI[s.id];
  return h("article", { class: "sal", style: `--c: var(--${fargeFor(s)})` },
    h("div", { class: "bilde" },
      s.bilde ? h("img", { src: s.bilde, alt: `Bilde av ${s.navn}` }) : null,
      s.kilde ? h("div", { class: "kilde" }, "Bilde og opplysninger: ", h("a", { href: s.kilde, target: "_blank", rel: "noopener" }, s.kilde.replace(/^https?:\/\//, ""))) : null),
    h("div", { class: "tekst" },
      h("h3", {},
        h("input", { class: "kort", type: "text", value: s.kort ?? "", placeholder: "A", "aria-label": "Kort navn", maxlength: 3, onchange: e => endre("kort", e.target.value.trim()) }),
        h("input", { type: "text", value: s.navn, "aria-label": "Navn på salen", onchange: e => endre("navn", e.target.value.trim() || s.navn) }),
        h("select", { "aria-label": "Farge", onchange: e => endre("farge", e.target.value) }, ...FARGER.map(f => h("option", { value: f, selected: f === s.farge }, FARGENAVN[f]))),
        s.kunHelSesong ? h("span", { class: "merke" }, "kun hel sesong") : null),
      h("p", { class: "liten svak" }, `Alt i denne salen: nåverdi ${kr(r.nv)}, trenger ${kr(r.behov)}.`, fork("span", "", ` ${brukt ? `Valgt på ${brukt} ${brukt === 1 ? "konsert" : "konserter"} i egen plan.` : "Ikke valgt på noen konsert i egen plan."}`)),
      h("div", { class: "felt-rad" },
        kapFelt("staa", "Stående, plasser"), kapFelt("sitte", "Sittende, plasser"),
        h("label", { class: "avkryss" }, h("input", { type: "checkbox", checked: !!s.sitteAntatt, onchange: e => endre("sitteAntatt", e.target.checked) }), "Sitteplasser er antatt"),
        h("label", { class: "avkryss" }, h("input", { type: "checkbox", checked: !!s.kunHelSesong, onchange: e => endre("kunHelSesong", e.target.checked) }), "Kun hel sesong"),
        h("label", { class: "felt" },
          h("span", {}, "Lokaleeffekt på salget", h("span", { class: "merke" }, "følsomhet")),
          h("div", { class: "prosentfelt" },
            h("input", { type: "number", min: 0, max: 300, step: 5, value: Math.round((s.lokaleeffekt ?? 1) * 1000) / 10, "aria-label": "Lokaleeffekt i prosent", onchange: e => endre("lokaleeffekt", Math.max(0, Number(e.target.value) || 0) / 100) }),
            h("span", { class: "svak" }, "%")))),
      fork("p", "notat", "Lokaleeffekt: salget her i forhold til etterspørselen. 100 % er Majas premiss (lokalet påvirker ikke salget), 85 % betyr 15 % færre kjøpere når konserten er her. Taket i salen gjelder uansett. Gruppas egen følsomhet, som i arbeidsboka."),
      fork("label", "felt bred", h("span", {}, "Beskrivelse og kapasitetsnotat"),
        h("input", { type: "text", value: s.kapasitetNotat ?? s.beskrivelse ?? "", onchange: e => endre("kapasitetNotat", e.target.value) })),
      h("div", { class: "byggeklosser" },
        h("h4", {}, "Leie"),
        ...s.leie.map((b, i) => klossRad(s, b, i)),
        h("div", { class: "verktoylinje", style: "margin: 8px 0 0" },
          h("select", { "aria-label": "Ny byggekloss", onchange: e => { if (!e.target.value) return; s.leie.push(nyKloss(e.target.value)); e.target.value = ""; oppdater(); } },
            h("option", { value: "" }, "Legg til byggekloss"),
            h("option", { value: "perKonsert" }, "Fast beløp per konsert"),
            h("option", { value: "andel" }, "Andel av billettoppgjøret, med minimum"),
            h("option", { value: "engang" }, "Engangsbeløp for sesongen"),
            h("option", { value: "sesong" }, "Sesongleie med betalingsplan")))),
      h("div", { class: "handlinger" },
        erEndret ? h("button", { type: "button", class: "stille", onclick: () => { Object.assign(s, kopi(standard)); reparer(); oppdater(); } }, "Tilbake til casen") : null,
        h("button", { type: "button", class: "stille farlig", onclick: () => { if (d.saler.length <= 1) return alert("Minst én sal må være igjen."); if (confirm(`Fjerne ${s.navn}?${brukt ? ` ${brukt} konserter flyttes til en annen sal.` : ""}`)) { d.saler.splice(d.saler.indexOf(s), 1); reparer(); oppdater(); } } }, "Fjern salen"))));
}

function stripp(s) { const { bilde, kilde, beskrivelse, ...rest } = s; return rest; }

function nyKloss(type) {
  return { perKonsert: { type, belop: 10000, naar: "konsertmaaned" }, andel: { type, andel: 0.15, minimum: 5000, naar: "maanedEtter" },
           engang: { type, belop: 20000, tidspunkt: 0 }, sesong: { type, belop: 100000, plan: [{ tidspunkt: 0, andel: 0.5 }, { tidspunkt: 3, andel: 0.5 }] } }[type];
}

function klossRad(s, b, i) {
  const endre = (felt, verdi) => { b[felt] = verdi; oppdater(); };
  const felt = (navn, inp) => h("label", { class: "felt" }, h("span", {}, navn), inp);
  const naar = () => felt("Betales", h("select", { onchange: e => endre("naar", e.target.value) },
    h("option", { value: "maanedFoer", selected: b.naar === "maanedFoer" }, "måneden før"),
    h("option", { value: "konsertmaaned", selected: b.naar === "konsertmaaned" || !b.naar }, "i konsertmåneden"),
    h("option", { value: "maanedEtter", selected: b.naar === "maanedEtter" }, "måneden etter")));
  const tid = (verdi, ved) => h("select", { onchange: e => ved(Number(e.target.value)) }, ...MAANEDER.slice(0, 8).map((m, t) => h("option", { value: t, selected: t === verdi }, t === 0 ? "ved start (t0)" : m)));
  let innhold;
  if (b.type === "perKonsert") innhold = [h("b", {}, "Per konsert"), felt("Kroner", h("input", { type: "number", min: 0, step: 500, value: b.belop, onchange: e => endre("belop", Number(e.target.value) || 0) })), naar()];
  else if (b.type === "andel") innhold = [h("b", {}, "Andel av oppgjøret"), felt("Prosent", h("input", { type: "number", min: 0, max: 100, step: 1, value: Math.round(b.andel * 1000) / 10, onchange: e => endre("andel", (Number(e.target.value) || 0) / 100) })), felt("Minst per konsert", h("input", { type: "number", min: 0, step: 500, value: b.minimum ?? 0, onchange: e => endre("minimum", Number(e.target.value) || 0) })), naar()];
  else if (b.type === "engang") innhold = [h("b", {}, b.navn ?? "Engangsbeløp"), felt("Kroner", h("input", { type: "number", min: 0, step: 1000, value: b.belop, onchange: e => endre("belop", Number(e.target.value) || 0) })), felt("Betales", tid(b.tidspunkt ?? 0, v => endre("tidspunkt", v)))];
  else innhold = [h("b", {}, b.navn ?? "Sesongleie"), felt("Kroner i alt", h("input", { type: "number", min: 0, step: 1000, value: b.belop, onchange: e => endre("belop", Number(e.target.value) || 0) })),
    h("div", { class: "plan" }, ...(b.plan ?? []).map((p, j) => h("div", { class: "felt" }, h("span", {}, `Del ${j + 1}, prosent`), h("div", { style: "display:flex; gap:6px; align-items:center" },
      h("input", { type: "number", min: 0, max: 100, step: 5, value: Math.round(p.andel * 100), style: "width: 7ch", onchange: e => { p.andel = (Number(e.target.value) || 0) / 100; oppdater(); } }),
      tid(p.tidspunkt, v => { p.tidspunkt = v; oppdater(); }),
      b.plan.length > 1 ? h("button", { type: "button", class: "stille liten", onclick: () => { b.plan.splice(j, 1); oppdater(); } }, "fjern") : null)))),
    h("button", { type: "button", class: "stille liten", onclick: () => { b.plan.push({ tidspunkt: 0, andel: 0 }); oppdater(); } }, "Legg til del"),
    Math.abs((b.plan ?? []).reduce((a, p) => a + p.andel, 0) - 1) > 0.001 ? h("span", { class: "merke feil" }, "delene summerer ikke til 100 %") : null];
  return h("div", { class: "kloss" }, ...innhold, h("button", { type: "button", class: "stille liten farlig", onclick: () => { s.leie.splice(i, 1); oppdater(); } }, "Fjern"));
}

function leggTilSal(mal) {
  const d = state.data;
  const brukte = new Set(d.saler.map(s => s.id));
  let id = "D"; while (brukte.has(id)) id = String.fromCharCode(id.charCodeAt(0) + 1);
  const ny = mal ? { ...kopi(mal), id, kort: id, navn: `${mal.navn} (kopi)`, bilde: null, kilde: null }
                 : { id, kort: id, navn: "Ny sal", farge: FARGER[d.saler.length % FARGER.length], beskrivelse: "", kilde: null, bilde: null,
                     kapasitet: { staa: 400, sitte: 200 }, sitteAntatt: true, kapasitetNotat: "", kunHelSesong: false, leie: [nyKloss("perKonsert")] };
  d.saler.push(ny);
  oppdater();
}

/* ---------- Forutsetninger ---------- */
/* ---------- Spør: chatboten for Maja ----------
 * Språkmodellen forklarer, motoren regner (src/chat.js). Nøkkelen ligger bare i nettleserens lokale lager.
 * Samtalen ligger bare i minnet og forsvinner når siden lastes på nytt.
 */
/** Chatpanelet glir inn fra høyre og kan åpnes fra alle fanene med gaffarullen nede til høyre. */
function aapneChat() {
  if (!state.chatAapen) { state.chatAapen = true; renderChat(true); }
  else renderChat(true);
}
function lukkChat() {
  state.chatAapen = false;
  renderChat();
  if (location.hash === "#spor") history.replaceState(null, "", "#" + state.fane);
  document.getElementById("gaffarull").focus({ preventScroll: true });
}

function renderChat(fokus = false) {
  const panel = document.getElementById("chatpanel");
  const rull = document.getElementById("gaffarull");
  const c = state.chat;
  panel.classList.toggle("aapen", state.chatAapen);
  panel.inert = !state.chatAapen;
  panel.setAttribute("aria-hidden", String(!state.chatAapen));
  rull.setAttribute("aria-expanded", String(state.chatAapen));
  document.body.classList.toggle("chat-aapen", state.chatAapen);
  if (!state.chatAapen) return;
  const nokkel = lesNokkel();
  panel.replaceChildren(
    h("header", { class: "chatpanel-topp" },
      h("div", {},
        h("h2", { id: "chatpanel-tittel" }, "Spør om rådet"),
        h("p", { class: "liten" }, "Konsertplan regner, Claude fra Anthropic forklarer. «Hva om» prøves uten å endre planen din.")),
      h("button", { type: "button", class: "lukk", "aria-label": "Lukk", onclick: lukkChat }, "×")),
    nokkel ? chatFlate(c) : nokkelBoks());
  const logg = panel.querySelector(".chat-logg");
  if (logg) logg.scrollTop = logg.scrollHeight;
  if (fokus) requestAnimationFrame(() => panel.querySelector("#chat-felt:not([disabled]), #chat-nokkel")?.focus({ preventScroll: true }));
}

function nokkelBoks() {
  const felt = h("input", { type: "password", id: "chat-nokkel", autocomplete: "off", spellcheck: "false", placeholder: "Lim inn nøkkelen her" });
  const lagreN = () => { if (felt.value.trim()) { lagreNokkel(felt.value); renderChat(true); } };
  felt.addEventListener("keydown", e => { if (e.key === "Enter") lagreN(); });
  return h("div", { class: "chat-nokkel" },
    h("label", { for: "chat-nokkel" }, "Anthropic API-nøkkel"),
    h("div", { class: "chat-nokkel-rad" }, felt, h("button", { type: "button", class: "primaer", onclick: lagreN }, "Lagre i denne nettleseren")),
    h("p", { class: "liten svak" }, "Nøkkelen lagres bare i nettleserens lokale lager på denne maskinen og sendes bare til Anthropic. Den er aldri med i «Lagre»-fila. Hvert spørsmål koster litt på kontoen nøkkelen tilhører, så sett gjerne en brukergrense på nøkkelen."));
}

function chatFlate(c) {
  const t = tilstand(state.data);
  const logg = h("div", { class: "chat-logg", "aria-live": "polite" });
  if (!c.logg.length) logg.append(h("p", { class: "chat-tom svak" }, `Rådet nå: ${t.raadet.valg === "Avstå" ? "avstå" : t.raadet.valg}. Spør om hvorfor, eller om hva som skal til for at det snur.`));
  for (const m of c.logg) logg.append(chatMelding(m));
  if (c.venter) logg.append(h("div", { class: "chat-melding bot venter" }, h("span", { class: "svak" }, "Konsertplan regner og skriver svar")));
  const felt = h("textarea", { id: "chat-felt", rows: "2", placeholder: "Skriv et spørsmål, for eksempel: Hva om vi bare selger 85 %?", disabled: c.venter, "aria-label": "Spørsmål" });
  felt.value = c.utkast ?? "";
  felt.addEventListener("input", () => { c.utkast = felt.value; });
  const send = tekst => { tekst = (tekst ?? felt.value).trim(); if (tekst && !c.venter) { c.utkast = ""; sporModellen(tekst); } };
  felt.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  return h("div", { class: "chat" },
    logg,
    c.venter ? null : h("div", { class: "chat-forslag" }, ...chatForslag(t).map(f => h("button", { type: "button", class: "forslag-knapp", onclick: () => send(f) }, f))),
    h("form", { class: "chat-skjema", onsubmit: e => { e.preventDefault(); send(); } },
      felt, h("button", { type: "submit", class: "primaer", disabled: c.venter }, "Spør")),
    h("p", { class: "liten svak chat-bunn" }, "Nøkkelen er lagret i denne nettleseren. ",
      h("button", { type: "button", class: "stille liten", onclick: () => { glemNokkel(); renderChat(true); } }, "Glem nøkkelen"), " ",
      c.logg.length ? h("button", { type: "button", class: "stille liten", disabled: c.venter, onclick: () => { state.chat = { samtale: nySamtale(), logg: [], venter: false, utkast: "" }; renderChat(true); } }, "Tøm samtalen") : null));
}

function chatMelding(m) {
  if (m.rolle === "maja") return h("div", { class: "chat-melding maja" }, m.tekst);
  if (m.rolle === "feil") return h("div", { class: "chat-melding feil varsel" }, m.tekst);
  return h("div", { class: "chat-melding bot" },
    ...avsnitt(m.tekst).map(a => (a.type === "punkter" ? h("ul", {}, ...a.linjer.map(l => h("li", {}, l))) : h("p", {}, a.tekst))),
    m.avkortet ? h("p", { class: "liten svak" }, "Svaret ble kuttet fordi det ble for langt.") : null,
    ...m.kjoringer.map(chatRegnet));
}

/** Det Konsertplan regnet for et «hva om»: endringen, tallene før og etter, og knappen «Bruk i planen». */
function chatRegnet(k) {
  const utenfor = k.endringer.some(e => e.tekst.includes("utenfor casen")) || k.endringer.some(e => /^Sal, /.test(e.tekst));
  const rader = k.etter.valgene.filter(v => v.navn !== "Avstå").map(v => {
    const f = k.foer.valgene.find(x => x.navn === v.navn);
    const raad = v.navn === k.etter.raadet;
    return h("tr", { class: raad ? "raad" : "" },
      h("td", {}, v.navn, raad ? h("span", { class: "merke raad-merke" }, "rådet") : null),
      h("td", { class: `hoyre tall ${v.verdi_for_sceneskift_kr < 0 ? "minus" : ""}` }, f ? `${tall(f.verdi_for_sceneskift_kr)} → ` : "", h("b", {}, kr(v.verdi_for_sceneskift_kr))),
      h("td", { class: `hoyre tall ${v.holder_rammen_naa === false ? "minus" : ""}` }, f ? `${tall(f.maa_ha_klart_kr)} → ` : "", h("b", {}, kr(v.maa_ha_klart_kr))));
  });
  return h("div", { class: "chat-regnet" },
    h("p", { class: "chat-regnet-tittel" }, "Konsertplan regnet", utenfor ? h("span", { class: "merke varsel" }, "utenfor casen") : null),
    h("ul", { class: "liten" }, ...k.endringer.map(e => h("li", {}, `${e.tekst}: ${e.fra} → ${e.til}`))),
    h("div", { class: "tabellramme" }, h("table", { class: "chat-tabell" },
      h("thead", {}, h("tr", {}, h("th", {}, "Valg"), h("th", { class: "hoyre" }, "Verdi for Sceneskift"), h("th", { class: "hoyre" }, "Må ha klart"))),
      h("tbody", {}, ...rader))),
    h("p", { class: "liten" }, k.foer.raadet === k.etter.raadet ? `Rådet er fortsatt ${k.etter.raadet === "Avstå" ? "å avstå" : k.etter.raadet}.` : `Rådet snur: ${k.foer.raadet} → ${k.etter.raadet === "Avstå" ? "avstå" : k.etter.raadet}.`,
      " ",
      k.brukt ? h("span", { class: "svak" }, "Brukt i planen.")
        : h("button", { type: "button", class: "stille liten", onclick: () => { if (brukEndring(state.data, k.input)) { k.brukt = true; reparer(); oppdater(); } } }, "Bruk i planen")));
}

async function sporModellen(tekst) {
  const c = state.chat;
  const nokkel = lesNokkel();
  c.logg.push({ rolle: "maja", tekst });
  c.venter = true;
  renderChat();
  try {
    const svar = await spor(c.samtale, state.data, tekst, lagKall(nokkel));
    c.logg.push({ rolle: "bot", ...svar });
  } catch (e) {
    c.logg.push({ rolle: "feil", tekst: e.message || "Noe gikk galt." });
  } finally {
    c.venter = false;
    if (state.chat === c) renderChat(true);
  }
}

function renderForutsetninger(main) {
  const s = state.data.sesong;
  const felter = [
    ["billettpris", "Billettpris", "kr", "Oppgaveteksten: 350 kr per betalt billett, alle billetter i 2027", { step: 10 }],
    ["gebyr", "Billettgebyr", "kr", "Trekkes i oppgjøret fra Flytbillett, 10 kr per betalt billett", { step: 1 }],
    ["utgiftPerBillett", "Publikumsavhengig utgift", "kr", "10 kr per betalt billett, betalt i konsertmåneden", { step: 1 }],
    ["pakke", "Artist og produksjon, pakke", "kr", "Rigg & Ro: 60 000 kr per konsert, fast etter signering", { step: 1000 }],
    ["pakkeDel1Andel", "Del av pakken måneden før", "%", "Halvparten måneden før, resten i konsertmåneden", { step: 5, pst: true }],
    ["rente", "Realrente per år", "%", "Oppgaveteksten: 4 % real årsrente", { step: 0.5, pst: true }],
    ["ramme", "Startfinansiering, ramme", "kr", "Maja tror hun kan skaffe 250 000 kr, ikke avklart", { step: 10000 }],
    ["etterspoerselsfaktor", "Etterspørsel i forhold til 2026", "%", "Majas premiss er 100 %. Samme glider som i Resultater", { step: 5, pst: true }],
    ["laanRente", "Rente på lån ut over rammen, per år", "%", "Gruppas antakelse (29.10.2026): kassekreditt uten sikkerhet. Ikke fra casen. Renten holdes utenfor nåverdien", { step: 1, pst: true }],
  ];
  const boks = h("div", { class: "forutsetninger" },
    h("div", { class: "rad hode" }, h("span", {}, "Forutsetning"), h("span", { class: "hoyre" }, "Verdi"), h("span", {}, "Enhet"), fork("span", "", "Kilde"), h("span")));
  const radFor = ([felt, navn, enhet, kilde, o]) => {
    const vis = v => o.pst ? Math.round(v * 1000) / 10 : v;
    const basis = SESONG_2027[felt];
    return h("div", { class: "rad" },
      h("label", { for: `f-${felt}` }, navn, o.merke ? h("span", { class: "merke varsel", style: "margin-left: 8px" }, o.merke) : null),
      h("input", { id: `f-${felt}`, type: "number", step: o.step, min: o.min, value: vis(s[felt] ?? 0), onchange: e => { const v = Math.max(o.min ?? -Infinity, Number(e.target.value) || 0); s[felt] = o.pst ? v / 100 : v; oppdater(); } }),
      h("span", { class: "svak" }, enhet),
      fork("span", "liten svak", kilde),
      s[felt] !== basis ? h("button", { type: "button", class: "stille liten", onclick: () => { s[felt] = basis; oppdater(); } }, `Tilbake til casen (${vis(basis)} ${enhet})`) : h("span", { class: "liten svak" }, "Som i casen"));
  };
  for (const f of felter) boks.append(radFor(f));
  boks.append(h("div", { class: "rad" },
    h("label", { for: "f-konv" }, "Diskontering per måned"),
    h("select", { id: "f-konv", onchange: e => { s.konvensjon = e.target.value; oppdater(); } },
      h("option", { value: "aar", selected: s.konvensjon !== "maaned" }, "(1 + r)^(t/12)"),
      h("option", { value: "maaned", selected: s.konvensjon === "maaned" }, "(1 + r/12)^t")),
    h("span"), fork("span", "liten svak", "Arbeidsboka bruker (1 + r)^(t/12). Den andre gir litt lavere nåverdi"),
    s.konvensjon !== "aar" ? h("button", { type: "button", class: "stille liten", onclick: () => { s.konvensjon = "aar"; oppdater(); } }, "Tilbake til casen") : h("span", { class: "liten svak" }, "Som i casen")));
  main.append(h("section", { class: "seksjon" },
    h("h2", {}, "Forutsetningene for sesongen"),
    fork("p", "ingress", "Tallene fra Majas e-post og vedleggene. Alt kan endres, og alt kan settes tilbake. Faste 2026-kroner, før skatt og finansiering."),
    boks,
    fork("p", "notat", "Det som ikke kan endres her: strukturen i betalingene. Billettoppgjøret kommer alltid måneden etter konserten, publikumsutgiften i konsertmåneden, og pakken i to deler. Det er slik casen er lagt opp, og slik arbeidsboka regner.")));
  // Utvidelser utenfor casen: standard 0, som gir casens tall
  const utenfor = [
    ["barPerGjest", "Bar: omsetning per gjest", "kr", "Per betalt billett. Ikke i casen. Gjøres opp måneden etter, som billettene", { step: 10, min: 0, merke: "utenfor casen" }],
    ["barAndel", "Bar: Sceneskifts andel", "%", "Andelen av baromsetningen Sceneskift får. Avtales med salen", { step: 5, min: 0, pst: true, merke: "utenfor casen" }],
    ["uforutsett", "Uforutsette kostnader per konsert", "kr", "Det pakken ikke dekker, betalt i konsertmåneden. Casen: ingen andre kostnader", { step: 500, min: 0, merke: "utenfor casen" }],
  ];
  main.append(h("section", { class: "seksjon" },
    h("h2", {}, "Utenfor casen"),
    fork("p", "ingress", "Oppgaveteksten sier at det utover postene over og lokaleleien ikke er andre inntekter eller kostnader. Derfor står disse på 0, som gir casens tall. Pakkepris per konsert endres i Programmet. Rådet viser hva hver av dem gjør med rådet."),
    h("div", { class: "forutsetninger" }, ...utenfor.map(radFor))));
}

document.addEventListener("DOMContentLoaded", init);


})();

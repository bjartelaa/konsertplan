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

export const NAAR = { konsertmaaned: 0, maanedEtter: 1, maanedFoer: -1 };

export function kapasitet(sal, oppsett) {
  const k = sal.kapasitet?.[oppsett];
  return typeof k === "number" && k > 0 ? k : null;
}

/** Antall betalte billetter for en konsert i en gitt sal og oppsett. */
export function billetter(sesong, konsert, sal, oppsett = konsert.oppsett) {
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
export function leieForKonsert(sesong, sal, n) {
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
export function fasteLeiebetalinger(sal) {
  const ut = [];
  for (const b of sal.leie ?? []) {
    if (b.type === "engang") ut.push({ tidspunkt: b.tidspunkt ?? 0, belop: b.belop, type: b.type });
    else if (b.type === "sesong") for (const p of b.plan ?? []) ut.push({ tidspunkt: p.tidspunkt, belop: b.belop * p.andel, type: b.type });
  }
  return ut;
}

/** Pakken for én konsert: sesongens pakke pluss konsertens avvik (utvidelse, standard 0). */
export function pakkeFor(sesong, konsert) {
  return (sesong.pakke ?? 0) + (konsert.pakkeAvvik ?? 0);
}

/** Barinntekt til Sceneskift per betalt billett: omsetning per gjest × Sceneskifts andel (utvidelse, standard 0). */
export function barTilSceneskift(sesong) {
  return (sesong.barPerGjest ?? 0) * (sesong.barAndel ?? 0);
}

/** Utvidelsene utenfor casen som er i bruk nå (ulik 0), til merknader i grensesnittet. */
export function utvidelserIBruk(sesong, program) {
  const ut = [];
  if (barTilSceneskift(sesong)) ut.push("bar");
  if (sesong.uforutsett) ut.push("uforutsett");
  if (program.some(k => k.pakkeAvvik)) ut.push("pakkeAvvik");
  return ut;
}

export function fastLeieSum(sal) {
  return fasteLeiebetalinger(sal).reduce((s, p) => s + p.belop, 0);
}

function diskonteringsfaktor(sesong, t) {
  const r = sesong.rente ?? 0;
  if (t === 0) return 1;
  return sesong.konvensjon === "maaned" ? 1 / (1 + r / 12) ** t : 1 / (1 + r) ** (t / 12);
}

/** Siste tidspunkt på tidslinja for et program og de salene som brukes. */
export function sisteTidspunkt(program, salerIBruk) {
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
export function beregnPlan(sesong, saler, program, salVelger) {
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
export function beregnAltI(sesong, saler, program, sal) {
  const tilpasset = program.map(k => {
    if (kapasitet(sal, k.oppsett) !== null) return k;
    const annet = k.oppsett === "sitte" ? "staa" : "sitte";
    return kapasitet(sal, annet) !== null ? { ...k, oppsett: annet, oppsettByttet: true } : k;
  });
  return beregnPlan(sesong, saler, tilpasset, () => sal);
}

/** Alle resultatene: «alt i <sal>» for hver sal, egen plan og avstå. */
export function beregnAlle(sesong, saler, program) {
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
export function aktivtScenario(sesong) {
  return (sesong.scenarioer ?? []).find(sc => lik(sc.etterspoerselsfaktor, sesong.etterspoerselsfaktor ?? 1) && lik(sc.pakke, sesong.pakke)) ?? null;
}

/** Setter scenarioets verdier på sesongen (endrer objektet) og returnerer det. */
export function velgScenario(sesong, scenario) {
  sesong.etterspoerselsfaktor = scenario.etterspoerselsfaktor;
  sesong.pakke = scenario.pakke;
  return sesong;
}

/** Alle resultatene for hvert scenario: [{ scenario, res }], der res er beregnAlle med scenarioets verdier. */
export function beregnScenarioer(sesong, saler, program) {
  return (sesong.scenarioer ?? []).map(scenario => ({ scenario, res: beregnAlle(velgScenario({ ...sesong }, scenario), saler, program) }));
}

/** Dyp kopi uten funksjoner, til lagring og «tilbake til casen». */
export const kopi = x => JSON.parse(JSON.stringify(x));

/* ---------- Hva snur rådet: grenser og beslutningsregler ----------
 * Grensene finnes med halveringssøk i motoren, ikke med datatabell og interpolasjon som i arbeidsboka.
 * Derfor kan en grense avvike med noen hundredels prosentpoeng fra arbeidsboka der kurven har en knekk
 * (en konsert treffer taket i salen) inne i et interpolasjonssteg.
 */

/** Handlingene som sammenlignes: alt i hver sal, egen plan når den blander, og avstå. hent(sesong) regner handlingen med en variant av sesongen. */
export function handlinger(sesong, saler, program) {
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
export function finnGrense(ok, lo, hi, iter = 45) {
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
export function grenser(sesong, saler, program) {
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
export function beslutningsregler(sesong, saler, program) {
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
export const LAVERE_SALG = 0.8; // «20 % lavere salg» i notatet

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
export function raadet(sesong, saler, program) {
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

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
  const onsket = (konsert.forventetSalg ?? 0) * faktor;
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
  const linjer = { billetter: cf.slice(), utgift: cf.slice(), pakke: cf.slice(), leie: cf.slice() };
  const legg = (linje, t, belop) => { const i = Math.max(0, Math.min(T, t)); cf[i] += belop; linjer[linje][i] += belop; };

  const del1 = sesong.pakkeDel1Andel ?? 0.5;
  const perKonsert = program.map((k, i) => {
    const sal = valgt[i];
    const m = k.maaned;
    if (!sal) return { nr: k.nr, sal: null, n: 0, mulig: false, kappet: false, billettnetto: 0, utgift: 0, pakke: sesong.pakke, leie: 0, bidrag: -sesong.pakke };
    const b = billetter(sesong, k, sal);
    const n = b.n;
    const billettnetto = n * (sesong.billettpris - sesong.gebyr);
    const utgift = n * sesong.utgiftPerBillett;
    legg("billetter", m + 1, billettnetto);
    legg("utgift", m, -utgift);
    legg("pakke", m - 1, -sesong.pakke * del1);
    legg("pakke", m, -sesong.pakke * (1 - del1));
    const leie = leieForKonsert(sesong, sal, n);
    for (const d of leie.deler) legg("leie", m + (NAAR[d.naar] ?? 0), -d.belop);
    return { nr: k.nr, sal: sal.id, n, onsket: b.onsket, kap: b.kap, mulig: b.mulig, kappet: b.kappet,
             billettnetto, utgift, pakke: sesong.pakke, leie: leie.sum, leieDeler: leie.deler,
             bidrag: billettnetto - utgift - sesong.pakke - leie.sum };
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

/** Dyp kopi uten funksjoner, til lagring og «tilbake til casen». */
export const kopi = x => JSON.parse(JSON.stringify(x));

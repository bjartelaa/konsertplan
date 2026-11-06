import { test } from "node:test";
import assert from "node:assert/strict";
import { beregnAlle, beregnAltI, beregnPlan, leieForKonsert } from "../src/motor.js";
import { standardSesong } from "../src/standard-2027.js";

const r0 = x => Math.round(x);
const alle = (endring = {}) => {
  const d = standardSesong();
  Object.assign(d.sesong, endring);
  return beregnAlle(d.sesong, d.saler, d.program);
};

test("basis: nåverdi og finansieringsbehov som i arbeidsboka 29.10.2026", () => {
  const { altI } = alle();
  assert.equal(r0(altI.A.nv), 51324);
  assert.equal(r0(altI.B.nv), 201394);
  assert.equal(r0(altI.C.nv), 173787);
  assert.equal(r0(altI.A.behov), 231900);
  assert.equal(r0(altI.B.behov), 316100);
  assert.equal(r0(altI.C.behov), 216696);
});

test("basis: saldo per måned t0 til juli", () => {
  const { altI } = alle();
  assert.deepEqual(altI.A.saldo.map(r0), [-60000, -201300, -231900, -211700, -183800, -187400, -100000, 56400]);
  assert.deepEqual(altI.B.saldo.map(r0), [-165000, -288300, -301500, -316100, -161400, -149500, 40500, 210500]);
  assert.deepEqual(altI.C.saldo.map(r0), [-60000, -183300, -216696, -194344, -89828, -103020, 41080, 180480]);
});

test("basis: samlet netto udiskontert", () => {
  const { altI } = alle();
  assert.equal(r0(altI.A.netto), 56400);
  assert.equal(r0(altI.B.netto), 210500);
  assert.equal(r0(altI.C.netto), 180480);
});

test("scenarioer fra forstaelse.md kap. 9", () => {
  let { altI } = alle({ etterspoerselsfaktor: 0.8 });
  assert.deepEqual([altI.A.nv, altI.B.nv, altI.C.nv].map(r0), [-31964, -8529, 2157]);
  assert.deepEqual([altI.A.behov, altI.B.behov, altI.C.behov].map(r0), [253200, 372120, 240361]);
  ({ altI } = alle({ pakke: 66000 }));
  assert.deepEqual([altI.A.nv, altI.B.nv, altI.C.nv].map(r0), [-19974, 130095, 102488]);
  ({ altI } = alle({ etterspoerselsfaktor: 0.8, pakke: 66000 }));
  assert.deepEqual([altI.A.nv, altI.B.nv, altI.C.nv].map(r0), [-103263, -79828, -69141]);
  assert.deepEqual([altI.A.behov, altI.B.behov, altI.C.behov].map(r0), [318080, 414120, 282361]);
  ({ altI } = alle({ etterspoerselsfaktor: 1.2 }));
  assert.deepEqual([altI.A.nv, altI.B.nv, altI.C.nv].map(r0), [102783, 372350, 313035]);
});

test("egen plan: C på alle gir samme som alt i C, blanding A og C gir cirka 18 600 kr mer udiskontert", () => {
  const d = standardSesong();
  const alt = beregnAlle(d.sesong, d.saler, d.program);
  assert.equal(r0(alt.egen.nv), r0(alt.altI.C.nv));
  assert.equal(alt.blandet, false);
  // A der A er billigst: 147 til 250 solgte (K02, K03, K07, K08, K11)
  for (const k of d.program) k.salId = [2, 3, 7, 8, 11].includes(k.nr) ? "A" : "C";
  for (const k of d.program) if (k.salId === "A") k.oppsett = "sitte";
  const mix = beregnAlle(d.sesong, d.saler, d.program);
  assert.equal(mix.blandet, true);
  assert.equal(r0(mix.egen.netto), 199128);
  assert.ok(mix.egen.nv > alt.altI.C.nv);
});

test("C: minimumsleien slår inn under 123 billetter", () => {
  const d = standardSesong();
  const C = d.saler.find(s => s.id === "C");
  assert.equal(leieForKonsert(d.sesong, C, 100).sum, 7500);
  assert.equal(r0(leieForKonsert(d.sesong, C, 200).sum), 12240);
});

test("generell: fjerde sal og kortere program, kontrollert for hånd", () => {
  const d = standardSesong();
  // Oppdiktet sal D: 300 plasser, 5 000 kr per konsert måneden etter, 20 000 kr engang i t0
  d.saler.push({ id: "D", navn: "Prøvesalen", kapasitet: { staa: 300, sitte: 150 }, kunHelSesong: false,
                 leie: [{ type: "perKonsert", belop: 5000, naar: "maanedEtter" }, { type: "engang", belop: 20000, tidspunkt: 0 }] });
  // To konserter: måned 1 med 200 billetter, måned 2 med 400 (kappes til 300)
  d.program = [
    { nr: 1, maaned: 1, forventetSalg: 200, salId: "D", oppsett: "staa" },
    { nr: 2, maaned: 2, forventetSalg: 400, salId: "D", oppsett: "staa" },
  ];
  const r = beregnPlan(d.sesong, d.saler, d.program, k => k.salId);
  // t0: pakke del 1 konsert 1 (30 000) + engang 20 000 = −50 000
  // t1: utgift 2 000 + pakke 30 000 (k1) + pakke del 1 k2 30 000 = −62 000
  // t2: oppgjør k1 200 × 340 = 68 000, leie k1 5 000, utgift k2 3 000, pakke k2 30 000 = +30 000
  // t3: oppgjør k2 300 × 340 = 102 000, leie k2 5 000 = +97 000
  assert.deepEqual(r.cf.map(r0), [-50000, -62000, 30000, 97000]);
  assert.equal(r.T, 3);
  assert.equal(r0(r.behov), 112000);
  assert.equal(r.perKonsert[1].kappet, true);
  assert.equal(r.perKonsert[1].n, 300);
  const nv = -50000 - 62000 / 1.04 ** (1 / 12) + 30000 / 1.04 ** (2 / 12) + 97000 / 1.04 ** (3 / 12);
  assert.equal(r0(r.nv), r0(nv));
});

test("alt i A bytter til sittende der A ikke har ståoppsett", () => {
  const d = standardSesong();
  const A = d.saler.find(s => s.id === "A");
  const r = beregnAltI(d.sesong, d.saler, d.program, A);
  assert.ok(r.perKonsert.every(k => k.mulig));
  assert.equal(r.perKonsert.filter(k => k.kappet).length, 6);
});

test("lån ut over rammen: B i basis trenger 66 100 kr i tre måneder, rente 12 % gir 1 559 kr", () => {
  const { altI } = alle();
  assert.equal(r0(altI.B.laan), 66100);
  assert.equal(altI.B.maanederMedLaan, 3);
  assert.deepEqual(altI.B.trekk.map(r0), [0, 38300, 51500, 66100, 0, 0, 0, 0]);
  assert.equal(r0(altI.B.rentekostnad), 1559);            // (38 300 + 51 500 + 66 100) × 0,12 / 12
  assert.ok(altI.B.nvEtterRente < altI.B.nv && altI.B.nvEtterRente > altI.B.nv - 1559);
  assert.equal(altI.C.laan, 0);
  assert.equal(altI.C.rentekostnad, 0);
  assert.equal(r0(altI.C.nvEtterRente), r0(altI.C.nv));
  const samlet = alle({ etterspoerselsfaktor: 0.8, pakke: 66000 }).altI;
  assert.equal(r0(samlet.B.laan), 164120);
  assert.equal(samlet.B.maanederMedLaan, 5);
});

test("scenarioene i arbeidsboka: alle fem treffer forstaelse.md kap. 9 på kronen, nåverdi og behov", async () => {
  const { SCENARIOER_2027 } = await import("../src/standard-2027.js");
  const fasit = {
    "Basis":             [[51324, 201394, 173787], [231900, 316100, 216696]],
    "Lav etterspørsel":  [[-31964, -8529, 2157],   [253200, 372120, 240361]],
    "Høyere pakkepris":  [[-19974, 130095, 102488], [261900, 358100, 246696]],
    "Samlet":            [[-103263, -79828, -69141], [318080, 414120, 282361]],
    "Høy etterspørsel":  [[102783, 372350, 313035], [210320, 288960, 200035]],
  };
  assert.deepEqual(SCENARIOER_2027.map(s => s.navn), Object.keys(fasit));
  for (const sc of SCENARIOER_2027) {
    const { altI } = alle({ etterspoerselsfaktor: sc.etterspoerselsfaktor, pakke: sc.pakke });
    assert.deepEqual([altI.A.nv, altI.B.nv, altI.C.nv].map(r0), fasit[sc.navn][0], `nåverdi ${sc.navn}`);
    assert.deepEqual([altI.A.behov, altI.B.behov, altI.C.behov].map(r0), fasit[sc.navn][1], `behov ${sc.navn}`);
  }
  assert.equal(SCENARIOER_2027.filter(s => s.oppside).map(s => s.navn).join(), "Høy etterspørsel");
});

test("aktivt scenario følger verdiene: Basis i casen, Samlet etter velgScenario, ingen etter en glider", async () => {
  const { aktivtScenario, velgScenario, beregnScenarioer } = await import("../src/motor.js");
  const d = standardSesong();
  assert.equal(aktivtScenario(d.sesong)?.navn, "Basis");
  velgScenario(d.sesong, d.sesong.scenarioer.find(s => s.navn === "Samlet"));
  assert.equal(d.sesong.etterspoerselsfaktor, 0.8);
  assert.equal(d.sesong.pakke, 66000);
  assert.equal(aktivtScenario(d.sesong)?.navn, "Samlet");
  d.sesong.pakke = 66500;
  assert.equal(aktivtScenario(d.sesong), null);
  // beregnScenarioer regner alle fem uten å endre sesongen
  const alleSc = beregnScenarioer(d.sesong, d.saler, d.program);
  assert.equal(alleSc.length, 5);
  assert.equal(d.sesong.pakke, 66500);
  assert.equal(r0(alleSc[0].res.altI.C.nv), 173787);
  assert.equal(r0(alleSc[3].res.altI.C.behov), 282361);
});

test("lokaleeffekt per sal: Usikkerhet del 6 og Resultater del 5 i arbeidsboka (29.10.2026)", () => {
  const med = lokal => {
    const d = standardSesong();
    for (const s of d.saler) if (lokal[s.id] != null) s.lokaleeffekt = lokal[s.id];
    return beregnAlle(d.sesong, d.saler, d.program).altI;
  };
  // B og C 70 % (datatabell B232): NV −118 376 og −88 802, behov 399 980 og 266 617. A uendret
  let r = med({ B: 0.7, C: 0.7 });
  assert.deepEqual([r.A.nv, r.B.nv, r.C.nv].map(r0), [51324, -118376, -88802]);
  assert.deepEqual([r.A.behov, r.B.behov, r.C.behov].map(r0), [231900, 399980, 266617]);
  // B og C 50 % (B212)
  r = med({ B: 0.5, C: 0.5 });
  assert.deepEqual([r.B.nv, r.C.nv].map(r0), [-338070, -274560]);
  assert.deepEqual([r.B.behov, r.C.behov].map(r0), [487300, 385446]);
  // A 110 % (B298): flere konserter treffer taket på 250
  r = med({ A: 1.1 });
  assert.equal(r0(r.A.nv), 80644);
  assert.equal(r0(r.A.behov), 221210);
  assert.equal(r0(r.C.nv), 173787);
  // A med fullt hus hver kveld når aldri C (Resultater F44: 155 704 mot 173 787)
  r = med({ A: 2 });
  assert.equal(r0(r.A.nv), 155704);
  assert.ok(r.A.perKonsert.every(k => k.n === 250));
  assert.ok(r.A.nv < r.C.nv);
  // Grensen (Resultater C42 og F42): C kan selge ned til 85,44 % av etterspørselen før nåverdien er lik A,
  // og behovet for C er da 229 001 kr. Arbeidsboka interpolerer i en datatabell, her finnes punktet med halveringssøk
  let lav = 0.5, hoy = 1;
  for (let i = 0; i < 40; i++) { const m = (lav + hoy) / 2; if (med({ C: m }).C.nv < 51324.4579) lav = m; else hoy = m; }
  assert.equal(Math.round(hoy * 10000) / 10000, 0.8544);
  assert.equal(r0(med({ C: hoy }).C.behov), 229001);
});

test("grenser: hva snur rådet, mot forstaelse.md kap. 9 og notat_tall.py (halveringssøk, ikke interpolasjon)", async () => {
  const { grenser, finnGrense } = await import("../src/motor.js");
  const d = standardSesong();
  const g = Object.fromEntries(grenser(d.sesong, d.saler, d.program).map(x => [x.id, x]));
  const p1 = v => Math.round(v * 1000) / 10; // prosent med én desimal
  // Nåverdien blir negativ under 86,7 % (A), 80,8 % (B), 79,8 % (C). A har en knekk ved 86,2 % (konsert 12 treffer taket),
  // så arbeidsbokas interpolasjon gir 86,66 og søket 86,64. Begge er 86,6 eller 86,7 avrundet
  assert.ok(Math.abs(p1(g.A.nvNegativUnder.verdi) - 86.7) < 0.15, `A ${p1(g.A.nvNegativUnder.verdi)}`);
  assert.equal(p1(g.B.nvNegativUnder.verdi), 80.8);
  assert.equal(p1(g.C.nvNegativUnder.verdi), 79.8);
  // Behovet går over rammen under 83,0 % (A) og 75,9 % (C). B holder aldri rammen, selv med fullt hus
  assert.equal(p1(g.A.overRammenUnder.verdi), 83.0);
  assert.equal(p1(g.C.overRammenUnder.verdi), 75.9);
  assert.equal(g.B.overRammenUnder.status, "alltid");
  assert.equal(g.B.overRammenUnder.verdi, null);
  // Pakkepris der C slutter å holde rammen: 66 661 kr ved 100 % salg, 61 377 kr ved 80 % (notat_tall.py)
  assert.equal(r0(g.C.pakkeOverRammen.verdi), 66661);
  assert.equal(r0(g.C.pakkeOverRammen.kroner), 6661);
  d.sesong.etterspoerselsfaktor = 0.8;
  const g80 = Object.fromEntries(grenser(d.sesong, d.saler, d.program).map(x => [x.id, x]));
  assert.equal(r0(g80.C.pakkeOverRammen.verdi), 61377);
  // Ved 80 % salg har C om lag 8 billetter å gå på før nåverdien blir negativ (Resultater F85: 8,07)
  assert.equal(Math.round(g80.C.nvNegativUnder.billetter * 100) / 100, 8.07);
  assert.ok(g80.A.nvNegativUnder.billetter < 0); // A er allerede under grensen
  // finnGrense: statusene
  assert.deepEqual(finnGrense(() => true, 0, 1), { verdi: null, status: "aldri" });
  assert.deepEqual(finnGrense(() => false, 0, 1), { verdi: null, status: "alltid" });
  assert.equal(Math.round(finnGrense(x => x >= 0.3, 0, 1).verdi * 1000) / 1000, 0.3);
});

test("beslutningsreglene: 1 avstå, 2 C, 3 B i basis; ved 80 % salg velger alle tre C eller avstå", async () => {
  const { beslutningsregler } = await import("../src/motor.js");
  const d = standardSesong();
  const r = beslutningsregler(d.sesong, d.saler, d.program);
  assert.deepEqual(r.map(x => x.valg.id), ["avstaa", "C", "B"]);
  assert.deepEqual(r[1].kandidater, ["A", "C", "avstaa"]);   // B holder ikke rammen i basis
  assert.deepEqual(r[0].kandidater, ["avstaa"]);             // ingen sal holder rammen i Samlet
  assert.equal(r0(r[1].valg.nv), 173787);
  assert.equal(r0(r[2].valg.nv), 201394);
  d.sesong.etterspoerselsfaktor = 0.8;
  assert.deepEqual(beslutningsregler(d.sesong, d.saler, d.program).map(x => x.valg.id), ["avstaa", "C", "C"]);
  // Uten ramme faller regel 1 og 2 sammen med regel 3
  d.sesong.etterspoerselsfaktor = 1;
  d.sesong.ramme = null;
  assert.deepEqual(beslutningsregler(d.sesong, d.saler, d.program).map(x => x.valg.id), ["B", "B", "B"]);
  // Egen plan som blander A og C tas med som handling
  d.sesong.ramme = 250000;
  for (const k of d.program) if ([2, 3, 7, 8, 11].includes(k.nr)) { k.salId = "A"; k.oppsett = "sitte"; }
  const med = beslutningsregler(d.sesong, d.saler, d.program);
  assert.ok(med[1].kandidater.includes("egen"));
  assert.equal(med[1].valg.id, "egen");
});

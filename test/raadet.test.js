// Etappe 3: utvidelsene utenfor casen (standard 0) og rådet for Maja (regelen i beslutningsnotatet).
import { test } from "node:test";
import assert from "node:assert/strict";
import { beregnAlle, beregnAltI, raadet, utvidelserIBruk } from "../src/motor.js";
import { standardSesong, SESONG_2027 } from "../src/standard-2027.js";

const r0 = x => Math.round(x);
const C = d => d.saler.find(s => s.id === "C");

test("utvidelsene står på 0 i casen og endrer ingen kontrolltall", () => {
  assert.equal(SESONG_2027.barPerGjest, 0);
  assert.equal(SESONG_2027.barAndel, 0);
  assert.equal(SESONG_2027.uforutsett, 0);
  const d = standardSesong();
  assert.ok(d.program.every(k => k.pakkeAvvik === 0));
  assert.deepEqual(utvidelserIBruk(d.sesong, d.program), []);
  const { altI } = beregnAlle(d.sesong, d.saler, d.program);
  assert.deepEqual([altI.A.nv, altI.B.nv, altI.C.nv].map(r0), [51324, 201394, 173787]);
  assert.deepEqual([altI.A.behov, altI.B.behov, altI.C.behov].map(r0), [231900, 316100, 216696]);
  // Omsetning i baren uten andel til Sceneskift gir heller ingen endring
  d.sesong.barPerGjest = 80;
  assert.equal(r0(beregnAltI(d.sesong, d.saler, d.program, C(d)).nv), 173787);
});

test("bar: 100 kr per gjest, halvparten til Sceneskift, kommer måneden etter konserten", () => {
  const d = standardSesong();
  Object.assign(d.sesong, { barPerGjest: 100, barAndel: 0.5 });
  const r = beregnAltI(d.sesong, d.saler, d.program, C(d));
  // 3 350 betalte billetter i C × 50 kr = 167 500 kr mer, udiskontert
  assert.equal(r0(r.netto), 180480 + 167500);
  // Januar: ingen bar ennå. Februar: januarkonsertene (140 + 190) × 50 = 16 500 kr
  assert.equal(r0(r.saldo[1]), -183300);
  assert.equal(r0(r.saldo[2]), -216696 + 16500);
  assert.equal(r0(r.linjer.bar[2]), 16500);
  assert.deepEqual(utvidelserIBruk(d.sesong, d.program), ["bar"]);
});

test("uforutsette kostnader: 5 000 kr per konsert i konsertmåneden", () => {
  const d = standardSesong();
  d.sesong.uforutsett = 5000;
  const r = beregnAltI(d.sesong, d.saler, d.program, C(d));
  assert.equal(r0(r.netto), 180480 - 12 * 5000);
  assert.equal(r0(r.saldo[0]), -60000);              // ingenting før januar
  assert.equal(r0(r.saldo[1]), -183300 - 10000);     // to konserter i januar
  assert.equal(r0(r.behov), 216696 + 20000);         // bunnen er fortsatt i februar, fire konserter
});

test("pakkepris per konsert: konsert 6 koster 20 000 kr mer, og avviket ligger oppå scenarioets pakke", () => {
  const d = standardSesong();
  d.program.find(k => k.nr === 6).pakkeAvvik = 20000;
  let r = beregnAltI(d.sesong, d.saler, d.program, C(d));
  assert.equal(r0(r.netto), 180480 - 20000);
  // Konsert 6 er i mars: del 1 i februar, del 2 i mars
  assert.equal(r0(r.saldo[2]), -216696 - 10000);
  assert.equal(r0(r.saldo[3]), -194344 - 20000);
  assert.equal(r.perKonsert[5].pakke, 80000);
  d.sesong.pakke = 66000;
  r = beregnAltI(d.sesong, d.saler, d.program, C(d));
  assert.equal(r.perKonsert[5].pakke, 86000);
  assert.equal(r0(r.netto), 180480 - 12 * 6000 - 20000);
  assert.deepEqual(utvidelserIBruk(d.sesong, d.program), ["pakkeAvvik"]);
});

test("rådet i basis: C, som i notatet, med vilkårene og det som snur rådet", () => {
  const d = standardSesong();
  const r = raadet(d.sesong, d.saler, d.program);
  assert.equal(r.valg.id, "C");
  const x = Object.fromEntries(r.alle.map(a => [a.id, a]));
  // Holder rammen nå og ved 20 % lavere salg (forstaelse.md kap. 9: Lav etterspørsel)
  assert.deepEqual([x.A.holderNaa, x.A.holderLav, x.B.holderNaa, x.B.holderLav, x.C.holderNaa, x.C.holderLav], [true, false, false, false, true, true]);
  assert.deepEqual([x.A.behovLav, x.B.behovLav, x.C.behovLav].map(r0), [253200, 372120, 240361]);
  assert.equal(r0(x.C.nvLav), 2157);
  // A er full på seks konserter og mister 700 billetter, B og C mister 30 på konsert 6
  assert.deepEqual([x.A.fulleKonserter, x.A.tapteBilletter, x.C.tapteBilletter], [6, 700, 30]);
  // B betaler 105 000 kr i leie før januar, bunnen for C er i februar
  assert.equal(x.B.leieFoerStart, 105000);
  assert.equal(x.C.bunnTid, 2);
  // Vilkåret om pakken: ved 20 % lavere salg holder C rammen under 61 377 kr (notat_tall.py), ellers under 66 661 kr
  assert.equal(r0(r.grense.pakkeLav.verdi), 61377);
  assert.equal(r0(r.grense.pakkeOverRammen.verdi), 66661);
  // Mer startfinansiering: B blir rådet når rammen dekker B ved 20 % lavere salg (372 120 kr)
  assert.equal(r.snu.ramme.til.id, "B");
  assert.equal(r0(r.snu.ramme.verdi), 372120);
  // Uforutsette kostnader: ved 80 % salg er bunnen for C i mars, 9 639 kr under rammen, etter seks konserter.
  // 9 639 / 6 = 1 606,5 kr per konsert, så snur rådet til avstå
  assert.equal(Math.round(r.snu.uforutsett.verdi * 10) / 10, 1606.5);
  assert.equal(r.snu.uforutsett.til.id, "avstaa");
  // Bar snur ikke rådet: B er over rammen i januar (288 300 kr), før noe oppgjør er kommet
  assert.equal(r.snu.bar.status, "alltid");
  assert.equal(r0(beregnAltI(d.sesong, d.saler, d.program, d.saler[1]).saldo[1]), -288300);
  // 10 kr mer per gjest gir C 33 500 kr udiskontert (3 350 billetter), 32 994 kr i nåverdi
  assert.equal(r0(r.barPer10), 32994);
});

test("rådet i scenarioene: avstå når salget eller pakken svikter, B uten ramme", () => {
  const d = standardSesong();
  const med = (endring, f) => f(raadet({ ...d.sesong, ...endring }, d.saler, d.program));
  // Lav etterspørsel: 20 % lavere enn 80 % er 64 %, der C trenger mer enn rammen. Mer penger gjør C mulig igjen
  med({ etterspoerselsfaktor: 0.8 }, r => {
    assert.equal(r.valg.id, "avstaa");
    assert.equal(r.snu.ramme.til.id, "C");
    const behovC64 = beregnAltI({ ...d.sesong, etterspoerselsfaktor: 0.64 }, d.saler, d.program, C(d)).behov;
    assert.ok(Math.abs(r.snu.ramme.verdi - behovC64) < 1);
  });
  // Pakke 66 000: C trenger 282 361 kr ved 80 % salg (Samlet i kap. 9)
  med({ pakke: 66000 }, r => { assert.equal(r.valg.id, "avstaa"); assert.equal(r0(r.snu.ramme.verdi), 282361); });
  // Samlet: alle gir tap, så ingen ramme snur rådet
  med({ etterspoerselsfaktor: 0.8, pakke: 66000 }, r => { assert.equal(r.valg.id, "avstaa"); assert.equal(r.snu.ramme.status, "alltid"); });
  med({ ramme: null }, r => { assert.equal(r.valg.id, "B"); assert.equal(r.snu.ramme, null); });
});

test("rådet med beste blanding i programmet: egen plan velges og er merket som handling", async () => {
  const { besteBlanding } = await import("../src/forslag.js");
  const d = standardSesong();
  const b = besteBlanding(d.sesong, d.saler, d.program);
  d.program.forEach((k, i) => { k.salId = b.valg[i].salId; k.oppsett = b.valg[i].oppsett; });
  const r = raadet(d.sesong, d.saler, d.program);
  assert.equal(r.valg.id, "egen");
  assert.equal(r0(r.valg.nv), 192021);
  assert.ok(r.valg.behovLav <= 250000);
});

test("lokaleeffekt: C kan selge ned til 85,44 % av etterspørselen før A er like god (arbeidsboka, Usikkerhet del 6)", async () => {
  const { lokaleeffektGrense } = await import("../src/motor.js");
  const d = standardSesong();
  const g = lokaleeffektGrense(d.sesong, d.saler, d.program, "C", "A");
  assert.equal(Math.round(g.verdi * 10000) / 100, 85.44);
});

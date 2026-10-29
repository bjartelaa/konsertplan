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

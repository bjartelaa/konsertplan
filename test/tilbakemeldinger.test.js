// Tilbakemeldingene fra gruppa 17.11.2026: lånemodulen (nr 2) og ekstra markedsføring (nr 5). Casens tall skal være uendret.
import { test } from "node:test";
import assert from "node:assert/strict";
import { beregnAlle, beslutningsregler } from "../src/motor.js";
import { standardSesong } from "../src/standard-2027.js";

const r0 = v => Math.round(v);
const med = endring => { const d = standardSesong(); Object.assign(d.sesong, endring); return { d, res: beregnAlle(d.sesong, d.saler, d.program) }; };

test("standard: kassekreditt og ingen markedsføring, casens tall uendret", () => {
  const { d, res } = med({});
  assert.equal(d.sesong.laanType, "kassekreditt");
  assert.equal(d.sesong.markedsforing, 0);
  assert.deepEqual(["A", "B", "C"].map(id => r0(res.altI[id].nv)), [51324, 201394, 173787]);
  assert.deepEqual(["A", "B", "C"].map(id => r0(res.altI[id].behov)), [231900, 316100, 216696]);
});

test("kassekreditt for B: 66 100 kr i tre måneder, 1 559 kr i rente, nåverdi etter rente 199 846", () => {
  const B = med({}).res.altI.B;
  assert.deepEqual(B.trekk.map(r0), [0, 38300, 51500, 66100, 0, 0, 0, 0]);
  assert.equal(r0(B.rentekostnad), 1559);
  assert.equal(r0(B.nvEtterRente), 199846);
});

test("fast lån for B fra før januar: 66 100 kr i fire måneder, 2 644 kr i rente, tilbake i april", () => {
  const B = med({ laanType: "fast", laanStart: 0 }).res.altI.B;
  assert.deepEqual(B.trekk.map(r0), [66100, 66100, 66100, 66100, 0, 0, 0, 0]);
  assert.equal(B.laanSlutt, 4);
  assert.equal(r0(B.rentekostnad), 2644);
  assert.equal(r0(B.nv), 201394);           // lånet endrer ikke casens nåverdi
  assert.ok(B.nvEtterRente < med({}).res.altI.B.nvEtterRente);
});

test("fast lån fra februar: januar går på kassekreditt", () => {
  const B = med({ laanType: "fast", laanStart: 2 }).res.altI.B;
  assert.deepEqual(B.fastLaan.map(r0), [0, 0, 66100, 66100, 0, 0, 0, 0]);
  assert.deepEqual(B.kreditt.map(r0), [0, 38300, 0, 0, 0, 0, 0, 0]);
  assert.equal(r0(B.rentekostnad), 1705);
});

test("for lite fast lån: resten går på kassekreditt, så rammen alltid holder med lånet", () => {
  const B = med({ laanType: "fast", laanStart: 0, laanBelop: 40000 }).res.altI.B;
  B.saldo.forEach((s, t) => assert.ok(s + B.trekk[t] >= -250000 - 1e-6, `måned ${t}`));
  assert.equal(r0(B.restKreditt), 26100);
});

test("valg som holder rammen har ingen lån og samme nåverdi etter rente", () => {
  const C = med({ laanType: "fast" }).res.altI.C;
  assert.equal(C.laan, 0);
  assert.equal(r0(C.nvEtterRente), r0(C.nv));
});

test("regel 3 (uten ramme) velger B med nåverdi etter rente", () => {
  const d = standardSesong();
  const r = beslutningsregler(d.sesong, d.saler, d.program);
  assert.equal(r[2].valg.id, "B");
  assert.equal(r0(r[2].valg.nvEtterRente), 199846);
});

test("ekstra markedsføring 12 000 kr for sesongen: 1 000 kr per konsert måneden før, netto 12 000 lavere", () => {
  const uten = med({}).res.altI.C, medMf = med({ markedsforing: 12000 }).res.altI.C;
  assert.equal(r0(uten.netto - medMf.netto), 12000);
  assert.equal(r0(-medMf.linjer.markedsforing.reduce((a, b) => a + b, 0)), 12000);
  assert.ok(medMf.nv < uten.nv);
});

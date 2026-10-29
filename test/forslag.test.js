import { test } from "node:test";
import assert from "node:assert/strict";
import { forslagForKonsert, oppsettForSjanger } from "../src/forslag.js";
import { standardSesong } from "../src/standard-2027.js";

test("sjanger gir oppsett", () => {
  assert.equal(oppsettForSjanger("Indiefolk"), "sitte");
  assert.equal(oppsettForSjanger("Soul / jazz"), "sitte");
  assert.equal(oppsettForSjanger("Synthpop"), "staa");
  assert.equal(oppsettForSjanger("Alternativ pop"), "staa");
  assert.equal(oppsettForSjanger("Noe rart"), null);
});

test("forslag per konsert i 2027: A for små sittende, C for store stående", () => {
  const d = standardSesong();
  const f = nr => forslagForKonsert(d.sesong, d.saler, d.program.find(k => k.nr === nr));
  assert.deepEqual([f(2).salId, f(2).oppsett], ["A", "sitte"]);     // 190, drømmepop
  assert.deepEqual([f(1).salId, f(1).oppsett], ["C", "sitte"]);     // 140, C er billigere under 147
  assert.deepEqual([f(6).salId, f(6).oppsett], ["C", "staa"]);      // 480, kappes til 450
  assert.equal(f(6).kappet, true);
  assert.deepEqual([f(4).salId, f(4).oppsett], ["A", "sitte"]);     // 310 sittende: A 250 og C 200 for små, A gir høyest bidrag (73 500 mot 53 760)
  assert.equal(f(4).kappet, true);
  assert.ok(f(2).hvorfor.includes("Lune Sal"));
});

test("forslagene på alle konsertene gir høyere nåverdi enn alt i C", async () => {
  const { beregnAlle } = await import("../src/motor.js");
  const d = standardSesong();
  for (const k of d.program) { const f = forslagForKonsert(d.sesong, d.saler, k); k.salId = f.salId; k.oppsett = f.oppsett; }
  const r = beregnAlle(d.sesong, d.saler, d.program);
  assert.ok(r.blandet);
  assert.ok(r.egen.nv > r.altI.C.nv, `egen ${r.egen.nv} mot C ${r.altI.C.nv}`);
  assert.ok(r.egen.netto - r.altI.C.netto > 15000);
});

test("beste blanding av A og C holder rammen og slår alt i C", async () => {
  const { besteBlanding } = await import("../src/forslag.js");
  const d = standardSesong();
  const b = besteBlanding(d.sesong, d.saler, d.program);
  assert.equal(b.valg.map(v => v.salId).join(""), "CAACCCAACCAC");
  assert.equal(Math.round(b.nv), 192021);
  assert.equal(Math.round(b.behov), 223068);
  assert.equal(b.holderRammen, true);
});

test("beste blanding med B frigjort: sesongleien gjør at B ikke velges", async () => {
  const { besteBlanding } = await import("../src/forslag.js");
  const d = standardSesong();
  d.saler.find(s => s.id === "B").kunHelSesong = false;
  const b = besteBlanding(d.sesong, d.saler, d.program);
  assert.equal(b.valg.map(v => v.salId).join(""), "CAACCCAACCAC");
  assert.equal(Math.round(b.nv), 192021);
});

test("beste blanding med B til 15 000 per konsert blander A, B og C (kontrollert mot alle 531 441 kombinasjoner)", async () => {
  const { besteBlanding } = await import("../src/forslag.js");
  const d = standardSesong();
  const B = d.saler.find(s => s.id === "B");
  B.kunHelSesong = false;
  B.leie = [{ type: "perKonsert", belop: 15000, naar: "konsertmaaned" }];
  const b = besteBlanding(d.sesong, d.saler, d.program);
  assert.equal(b.valg.map(v => v.salId).join(""), "CAABBBAABBAB");
  assert.equal(Math.round(b.nv), 233863);
  assert.equal(Math.round(b.behov), 238068);
});

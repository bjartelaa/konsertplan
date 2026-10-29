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

// Den bygde fila må kunne kjøres. Modulene slås sammen i ett skop, så to moduler kan ikke ha
// samme navn på toppnivå (det gjorde siden blank 17.11.2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("konsertplan.js bygges uten navnekollisjoner mellom modulene", () => {
  execFileSync(process.execPath, [join(rot, "scripts", "bygg.js")]);
  const kode = readFileSync(join(rot, "konsertplan.js"), "utf8");
  assert.doesNotThrow(() => new Script(kode, { filename: "konsertplan.js" }));
});

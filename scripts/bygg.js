// Slår sammen modulene i src/ til én klassisk skriptfil, konsertplan.js, så index.html
// virker rett fra fil (nettlesere nekter ES-moduler fra file://). Ingen avhengigheter.
// Kjør: node scripts/bygg.js
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rot = join(dirname(fileURLToPath(import.meta.url)), "..");
const rekkefolge = ["motor.js", "forslag.js", "standard-2027.js", "lagring.js", "figurer.js", "chat.js", "app.js"];
let ut = "// Generert av scripts/bygg.js fra src/. Rediger kildene, ikke denne fila.\n(() => {\n\"use strict\";\n";
for (const f of rekkefolge) {
  const kode = readFileSync(join(rot, "src", f), "utf8")
    .split("\n")
    .filter(l => !/^import\s/.test(l))
    .map(l => l.replace(/^export\s+(default\s+)?/, ""))
    .join("\n");
  ut += `\n// ---- src/${f} ----\n${kode}\n`;
}
ut += "\n})();\n";
writeFileSync(join(rot, "konsertplan.js"), ut);
console.log(`konsertplan.js: ${ut.length.toLocaleString("nb-NO")} tegn fra ${rekkefolge.length} filer`);

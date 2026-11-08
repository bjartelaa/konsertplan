// Etappe 4: chatboten for Maja. Testene bruker en falsk modell og et falskt fetch. Ingen nettverk.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tilstand, tilstandTekst, provEndring, brukEndring, tolkEndring, nySamtale, spor, lagForespoersel, lagKall,
         ChatFeil, lesNokkel, lagreNokkel, glemNokkel, avsnitt, chatForslag, VERKTOY, SYSTEM, CHAT_MODELL } from "../src/chat.js";
import { lagreLokalt } from "../src/lagring.js";
import { standardSesong } from "../src/standard-2027.js";

const rot = join(dirname(fileURLToPath(import.meta.url)), "..");
const FALSK_NOKKEL = "test-nokkel-ikke-ekte-123";

before(() => {
  // Sikring: ingen test får gå på nett
  globalThis.fetch = () => { throw new Error("Testene skal ikke bruke nett"); };
});

/** Falsk modell: svarer med svarene i rekkefølge og husker forespørslene. svar kan være funksjoner av forespørselen. */
function falskModell(...svar) {
  const forespoersler = [];
  const kall = async body => {
    forespoersler.push(JSON.parse(JSON.stringify(body)));
    const s = svar.shift();
    if (!s) throw new Error("Den falske modellen har ikke flere svar");
    return typeof s === "function" ? s(body) : s;
  };
  return { kall, forespoersler };
}
const tekstSvar = text => ({ role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text }] });
const verktoySvar = (input, id = "tu_1") => ({ role: "assistant", stop_reason: "tool_use",
  content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "Jeg regner på det." }, { type: "tool_use", id, name: "prov_endring", input }] });
const valgFor = (t, start) => t.valgene.find(v => v.navn.startsWith(start));

test("tilstanden modellen får har kontrolltallene og rådet fra motoren", () => {
  const t = tilstand(standardSesong());
  assert.equal(t.raadet.valg, "Skarvkaien (C)");
  assert.equal(t.forutsetninger.scenario, "Basis");
  assert.deepEqual(["Lune", "Søyleverket", "Skarvkaien"].map(n => valgFor(t, n).verdi_for_sceneskift_kr), [51324, 201394, 173787]);
  assert.deepEqual(["Lune", "Søyleverket", "Skarvkaien"].map(n => valgFor(t, n).maa_ha_klart_kr), [231900, 316100, 216696]);
  // Ved 20 % lavere salg (forstaelse.md kap. 9, Lav etterspørsel)
  assert.deepEqual(["Lune", "Søyleverket", "Skarvkaien"].map(n => valgFor(t, n).verdi_ved_20_prosent_lavere_salg_kr), [-31964, -8529, 2157]);
  assert.equal(valgFor(t, "Skarvkaien").maa_ha_klart_ved_20_prosent_lavere_salg_kr, 240361);
  // Forskjellene er regnet her, så modellen slipper
  assert.equal(valgFor(t, "Søyleverket").over_rammen_med_kr, 66100);
  assert.equal(valgFor(t, "Skarvkaien").under_rammen_med_kr, 33304);
  assert.equal(valgFor(t, "Søyleverket").verdi_mot_raadet_kr_positiv_er_mer, 27607);
  // Når rådet snur (kap. 9 og etappe 2 og 3)
  const s = t.naar_raadet_snur;
  assert.equal(s.salget_der_valget_taper_penger.prosent_av_salget_i_2026, 79.8);
  assert.equal(s.salget_der_rammen_ryker.prosent_av_salget_i_2026, 75.9);
  assert.equal(s.pakken_der_rammen_ryker.kr, 66661);
  assert.equal(s.pakken_der_rammen_ryker_ved_20_prosent_lavere_salg_kr, 61377);
  assert.deepEqual(s.startfinansiering_som_gir_annet_raad, { verdi: 372120, raadet_blir: "Søyleverket (B)" });
  assert.deepEqual(t.regler_fra_arbeidsboka.map(r => r.velger), ["Avstå", "Skarvkaien (C)", "Søyleverket (B)"]);
  assert.equal(t.program.length, 12);
  assert.deepEqual(t.forutsetninger.utenfor_casen.i_bruk_naa, []);
});

test("verktøyet regner scenarioene fra arbeidsboka på kronen og endrer ikke Majas plan", () => {
  const d = standardSesong();
  const urort = JSON.stringify(d);
  const tall = r => ["Lune", "Søyleverket", "Skarvkaien"].map(n => { const v = r.etter.valgene.find(x => x.navn.startsWith(n)); return [v.verdi_for_sceneskift_kr, v.maa_ha_klart_kr]; });
  const samlet = provEndring(d, { scenario: "Samlet" });
  assert.ok(samlet.ok);
  assert.deepEqual(tall(samlet), [[-103263, 318080], [-79828, 414120], [-69141, 282361]]);
  assert.equal(samlet.etter.raadet, "Avstå");
  assert.equal(JSON.parse(samlet.svar).raadet_snur, true);
  // Samme svar med feltene i stedet for scenarionavnet
  assert.deepEqual(tall(provEndring(d, { salg_prosent_av_2026: 80, pakke_kr: 66000 })), tall(samlet));
  assert.deepEqual(tall(provEndring(d, { salg_prosent_av_2026: 80 })), [[-31964, 253200], [-8529, 372120], [2157, 240361]]);
  assert.deepEqual(tall(provEndring(d, { pakke_kr: 66000 })), [[-19974, 261900], [130095, 358100], [102488, 246696]]);
  assert.deepEqual(tall(provEndring(d, { scenario: "høy etterspørsel" })), [[102783, 210320], [372350, 288960], [313035, 200035]]);
  // Mer startfinansiering snur rådet til B ved 372 120 kr, ikke før
  assert.equal(provEndring(d, { startfinansiering_kr: 372120 }).etter.raadet, "Søyleverket (B)");
  assert.equal(provEndring(d, { startfinansiering_kr: 372000 }).etter.raadet, "Skarvkaien (C)");
  // Endringen fra før er regnet av verktøyet
  const c = JSON.parse(provEndring(d, { pakke_kr: 66000 }).svar).endring_fra_foer.find(x => x.navn.startsWith("Skarvkaien"));
  assert.deepEqual([c.verdi_endres_med_kr, c.maa_ha_klart_endres_med_kr], [102488 - 173787, 30000]);
  assert.equal(JSON.stringify(d), urort);
});

test("utvidelser i verktøyet er merket utenfor casen", () => {
  const d = standardSesong();
  const bar = provEndring(d, { bar_omsetning_per_gjest_kr: 10, bar_andel_prosent: 100 });
  assert.equal(bar.etter.valgene.find(x => x.navn.startsWith("Skarvkaien")).verdi_for_sceneskift_kr, 173787 + 32994);
  assert.ok(bar.endringer.every(e => e.tekst.includes("utenfor casen")));
  assert.deepEqual(JSON.parse(bar.svar).etter.utenfor_casen_i_bruk, ["bar"]);
  const lokal = provEndring(d, { lokaleeffekt: [{ sal: "C", prosent: 85 }] });
  assert.deepEqual(JSON.parse(lokal.svar).etter.utenfor_casen_i_bruk, ["lokaleeffekt"]);
  const blandet = provEndring(d, { konserter: [{ nr: 1, sal: "A" }] });
  assert.ok(JSON.parse(blandet.svar).etter.utenfor_casen_i_bruk.includes("blandet program"));
  assert.ok(blandet.etter.valgene.some(v => v.navn === "Egen plan"));
});

test("ugyldig input fra modellen gir feil og ingen beregning", () => {
  const d = standardSesong();
  const f = (inn) => tolkEndring(d, inn).feil;
  assert.match(f({ hemmelig: 1 }).join(), /Ukjent felt: hemmelig/);
  assert.match(f({ salg_prosent_av_2026: -5 }).join(), /mellom/);
  assert.match(f({ pakke_kr: "mye" }).join(), /må være et tall/);
  assert.match(f({ scenario: "Krise" }).join(), /Ukjent scenario/);
  assert.match(f({ konserter: [{ nr: 3, sal: "B" }] }).join(), /bare velges for hele sesongen/);
  assert.match(f({ konserter: [{ nr: 99, forventet_salg: 10 }] }).join(), /Fant ikke konsert nr 99/);
  assert.match(f({}).join(), /Ingen endringer/);
  const r = provEndring(d, { salg_prosent_av_2026: 500 });
  assert.equal(r.ok, false);
  assert.ok(JSON.parse(r.svar).feil.length);
});

test("«Bruk i planen» setter endringen på Majas plan, også pakke per konsert mot ny sesongpakke", () => {
  const d = standardSesong();
  assert.ok(brukEndring(d, { pakke_kr: 62000, konserter: [{ nr: 6, pakke_kr: 80000, forventet_salg: 500 }] }));
  assert.equal(d.sesong.pakke, 62000);
  const k6 = d.program.find(k => k.nr === 6);
  assert.equal(k6.pakkeAvvik, 18000);
  assert.equal(k6.forventetSalg, 500);
  assert.equal(brukEndring(d, { salg_prosent_av_2026: 1000 }), false);
  assert.equal(d.sesong.etterspoerselsfaktor, 1);
});

test("samtalen: modellen ber om verktøyet, motoren regner, modellen forklarer med tallene den fikk", async () => {
  const d = standardSesong();
  const samtale = nySamtale();
  const m = falskModell(
    verktoySvar({ salg_prosent_av_2026: 80 }),
    body => {
      // Verktøysvaret som går tilbake til modellen, har motorens tall
      const siste = body.messages.at(-1);
      assert.equal(siste.role, "user");
      assert.equal(siste.content[0].type, "tool_result");
      assert.equal(siste.content[0].tool_use_id, "tu_1");
      assert.equal(siste.content[0].is_error, undefined);
      const r = JSON.parse(siste.content[0].content);
      assert.equal(r.etter.valgene.find(x => x.navn.startsWith("Skarvkaien")).verdi_for_sceneskift_kr, 2157);
      return tekstSvar("Skarvkaien tjener fortsatt penger, 2 157 kr.");
    });
  const svar = await spor(samtale, d, "Hva om salget blir 20 % lavere?", m.kall);
  assert.equal(svar.tekst, "Skarvkaien tjener fortsatt penger, 2 157 kr.");
  assert.equal(svar.kjoringer.length, 1);
  assert.equal(svar.kjoringer[0].endringer[0].til, "80 %");
  assert.deepEqual(samtale.meldinger.map(x => x.role), ["user", "assistant", "user", "assistant"]);
  // Første melding har tallene fra motoren, deretter spørsmålet
  const forste = samtale.meldinger[0].content;
  assert.match(forste[0].text, /^Tallene i Konsertplan nå/);
  assert.equal(JSON.parse(forste[0].text.split("\n").slice(1).join("\n")).raadet.valg, "Skarvkaien (C)");
  assert.equal(forste[1].text, "Hva om salget blir 20 % lavere?");
  // Svaret fra modellen (også thinking) føres tilbake uendret
  assert.equal(samtale.meldinger[1].content[0].type, "thinking");
  assert.equal(m.forespoersler[1].messages[1].content[0].signature, "sig");
  // Majas plan er ikke endret
  assert.equal(d.sesong.etterspoerselsfaktor, 1);
  const forsteRunde = JSON.parse(JSON.stringify(samtale.meldinger));

  // Nytt spørsmål uten endring i planen: tallene sendes ikke på nytt
  const m2 = falskModell(tekstSvar("Fordi C holder rammen."));
  await spor(samtale, d, "Hvorfor C?", m2.kall);
  assert.equal(samtale.meldinger.at(-2).content.length, 1);
  // Maja endrer planen: neste spørsmål får de nye tallene først
  d.sesong.pakke = 66000;
  const m3 = falskModell(tekstSvar("Nå er rådet å avstå."));
  await spor(samtale, d, "Og nå?", m3.kall);
  const ny = samtale.meldinger.at(-2).content;
  assert.equal(ny.length, 2);
  assert.equal(JSON.parse(ny[0].text.split("\n").slice(1).join("\n")).forutsetninger.pakke_per_konsert_kr, 66000);
  // Historikken bygges bare på: de tidligere meldingene er de samme i siste forespørsel
  assert.deepEqual(m3.forespoersler[0].messages.slice(0, 4), forsteRunde);
});

test("feil input fra modellen går tilbake som is_error, og ukjente verktøy avvises", async () => {
  const d = standardSesong();
  const samtale = nySamtale();
  const m = falskModell(
    { stop_reason: "tool_use", content: [
      { type: "tool_use", id: "a", name: "prov_endring", input: { salg_prosent_av_2026: 900 } },
      { type: "tool_use", id: "b", name: "slett_alt", input: {} }] },
    body => {
      const [a, b] = body.messages.at(-1).content;
      assert.equal(a.is_error, true);
      assert.match(a.content, /mellom/);
      assert.equal(b.is_error, true);
      assert.match(b.content, /Ukjent verktøy/);
      return tekstSvar("Det kan ikke Konsertplan regne.");
    });
  const svar = await spor(samtale, d, "Hva om salget blir ni ganger så stort?", m.kall);
  assert.equal(svar.kjoringer.length, 0);
  // Begge verktøysvarene ligger i én melding
  assert.equal(samtale.meldinger[2].content.length, 2);
});

test("avslag, feil og evig løkke setter samtalen tilbake til før spørsmålet", async () => {
  const d = standardSesong();
  const samtale = nySamtale();
  await spor(samtale, d, "Hei", falskModell(tekstSvar("Hei Maja.")).kall);
  const lengde = samtale.meldinger.length, sendt = samtale.sendtTilstand;
  const avslag = await spor(samtale, d, "Noe rart", falskModell({ stop_reason: "refusal", stop_details: { type: "refusal", category: null }, content: [] }).kall);
  assert.equal(avslag.avslaatt, true);
  assert.equal(samtale.meldinger.length, lengde);
  await assert.rejects(spor(samtale, d, "Hva om?", falskModell(verktoySvar({ pakke_kr: 1 }), async () => { throw new ChatFeil("opptatt", "opptatt"); }).kall), { type: "opptatt" });
  assert.equal(samtale.meldinger.length, lengde);
  const evig = falskModell(...Array.from({ length: 10 }, (_, i) => verktoySvar({ pakke_kr: 60000 + i }, `t${i}`)));
  await assert.rejects(spor(samtale, d, "Regn i det uendelige", evig.kall), { type: "runder" });
  assert.equal(samtale.meldinger.length, lengde);
  assert.equal(samtale.sendtTilstand, sendt);
});

test("forespørselen: nyeste modell, verktøyet, ingen tvunget verktøy og ingen nøkkel i innholdet", () => {
  const body = lagForespoersel([{ role: "user", content: "Hei" }]);
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(CHAT_MODELL, "claude-opus-5-5");
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.equal(body.tool_choice, undefined); // tvunget verktøy gir 400 på denne modellen
  assert.equal(body.temperature, undefined);
  assert.equal(body.fallbacks, "default");
  assert.deepEqual(body.tools.map(t => t.name), ["prov_endring"]);
  assert.equal(VERKTOY[0].input_schema.additionalProperties, false);
  assert.match(SYSTEM, /Du regner aldri selv/);
  assert.match(SYSTEM, /utenfor casen/);
  assert.doesNotMatch(SYSTEM, / [–—] /);
});

test("kallet mot API-et: riktige hoder, nøkkelen bare i hodet, feil på Majas språk", async () => {
  const kall = [];
  const hent = async (url, opt) => { kall.push({ url, opt }); return { ok: true, status: 200, json: async () => tekstSvar("ok") }; };
  const svar = await lagKall(FALSK_NOKKEL, hent)(lagForespoersel([{ role: "user", content: "Hei" }]));
  assert.equal(svar.content[0].text, "ok");
  const { url, opt } = kall[0];
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(opt.method, "POST");
  assert.equal(opt.headers["x-api-key"], FALSK_NOKKEL);
  assert.equal(opt.headers["anthropic-version"], "2026-10-21");
  assert.equal(opt.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(opt.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.ok(!opt.body.includes(FALSK_NOKKEL));

  const med = (status, json) => lagKall(FALSK_NOKKEL, async () => ({ ok: false, status, json: async () => json }))({});
  await assert.rejects(med(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { type: "nokkel" });
  await assert.rejects(med(429, null), { type: "grense" });
  await assert.rejects(med(529, null), { type: "opptatt" });
  await assert.rejects(med(400, { error: { message: "dårlig" } }), e => e.type === "foresporsel" && /dårlig/.test(e.message));
  await assert.rejects(lagKall(FALSK_NOKKEL, async () => { throw new TypeError("Failed to fetch"); })({}), { type: "nett" });
});

test("nøkkelen lagres bare i nettleserens lager, under egen nøkkel, og aldri med sesongen", () => {
  const lager = new Map();
  const falsk = { getItem: k => lager.get(k) ?? null, setItem: (k, v) => lager.set(k, String(v)), removeItem: k => lager.delete(k) };
  const forrige = globalThis.localStorage;
  globalThis.localStorage = falsk;
  try {
    assert.equal(lesNokkel(), "");
    lagreNokkel(`  ${FALSK_NOKKEL}\n`);
    assert.equal(lesNokkel(), FALSK_NOKKEL);
    lagreLokalt(standardSesong());
    const sesongen = [...lager].filter(([k]) => k !== "konsertplan.anthropic.nokkel");
    assert.equal(sesongen.length, 1);
    assert.ok(!sesongen[0][1].includes(FALSK_NOKKEL));
    glemNokkel();
    assert.equal(lesNokkel(), "");
  } finally { globalThis.localStorage = forrige; }
  // Uten lager (privat vindu) går det stille
  assert.equal(lesNokkel({ getItem: () => { throw new Error("blokkert"); } }), "");
});

test("ingen API-nøkler i repoet", () => {
  const filer = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: rot, encoding: "utf8" }).split("\n").filter(Boolean);
  const moenster = new RegExp("sk" + "-ant-" + "[A-Za-z0-9_-]{10,}");
  for (const f of filer) {
    if (/\.(webp|jpg|png|woff2)$/.test(f)) continue;
    assert.doesNotMatch(readFileSync(join(rot, f), "utf8"), moenster, f);
  }
});

test("svaret ryddes til avsnitt og punkter uten markdown", () => {
  assert.deepEqual(avsnitt("**Velg C.** Den holder rammen.\n\n- Verdi 173 787 kr\n- Må ha klart 216 696 kr"),
    [{ type: "avsnitt", tekst: "Velg C. Den holder rammen." }, { type: "punkter", linjer: ["Verdi 173 787 kr", "Må ha klart 216 696 kr"] }]);
  assert.deepEqual(avsnitt("## Svar\nKort."), [{ type: "avsnitt", tekst: "Svar Kort." }]);
});

test("forslagene til spørsmål følger rådet", () => {
  const d = standardSesong();
  assert.equal(chatForslag(tilstand(d))[0], "Hvorfor Skarvkaien?");
  d.sesong.pakke = 66000; d.sesong.etterspoerselsfaktor = 0.8;
  const f = chatForslag(tilstand(d));
  assert.equal(f[0], "Hvorfor bør vi avstå?");
  assert.ok(!f.some(x => x.includes("20 % lavere")));
  assert.ok(f.map(x => x.replace(/\s/g, " ")).includes("Hva om Rigg & Ro vil ha 72 000 kr per konsert?"));
  assert.ok(tilstandTekst(d).length < 12000);
});

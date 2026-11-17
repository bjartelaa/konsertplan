// Chatbot for Maja: en språkmodell (Claude) forklarer rådet, men regner ikke selv.
// Arbeidsdelingen, som foreleser beskrev 4.11.2026: motoren regner, språkmodellen formidler.
//   1 Modellen får forutsetningene og resultatene fra motoren som tekst (tilstand).
//   2 Spør Maja «hva om», ber modellen om verktøyet prov_endring. Det endrer en kopi av planen,
//     motoren regner, og modellen får tallene før og etter tilbake. Majas plan endres ikke.
//   3 Modellen forklarer med tallene den har fått. Maja kan selv trykke «Bruk i planen».
// Ingen DOM her. Kallet mot API-et sendes inn (kall), så testene bruker en falsk modell uten nett.
// API-nøkkelen ligger bare i nettleserens lokale lager, under en egen nøkkel. Den er aldri med i
// sesongen, i «Lagre»-fila eller i repoet.
import { beregnAlle, raadet, grenser, beslutningsregler, aktivtScenario, velgScenario, kopi, pakkeFor, utvidelserIBruk, LAVERE_SALG } from "./motor.js";

export const CHAT_MODELL = "claude-opus-5-5";
export const CHAT_API = "https://api.anthropic.com/v1/messages";
export const CHAT_API_VERSJON = "2026-10-21";
const CHAT_NOKKEL_LAGER = "konsertplan.anthropic.nokkel";
const CHAT_MAKS_RUNDER = 6; // spørsmål, verktøy, svar: mer enn seks runder betyr at noe har gått i ring

/* ---------- API-nøkkelen, bare i nettleserens lokale lager ---------- */
const chatLager = lager => lager ?? (typeof localStorage !== "undefined" ? localStorage : null);
export function lesNokkel(lager) {
  try { return chatLager(lager)?.getItem(CHAT_NOKKEL_LAGER) || ""; } catch { return ""; }
}
export function lagreNokkel(nokkel, lager) {
  try { chatLager(lager)?.setItem(CHAT_NOKKEL_LAGER, String(nokkel).trim()); return true; } catch { return false; }
}
export function glemNokkel(lager) {
  try { chatLager(lager)?.removeItem(CHAT_NOKKEL_LAGER); } catch { /* uten lager */ }
}

/* ---------- Tallene modellen får ---------- */
const kroner = v => Math.round(v ?? 0);
const prosent1 = v => Math.round((v ?? 0) * 1000) / 10;
const tallC = v => Math.round(v ?? 0).toLocaleString("nb-NO").replace(/\s/g, " "); // vanlig mellomrom, ikke hardt

/** Leievilkårene til en sal i klartekst, fra byggeklossene i motoren. */
function leieTekst(sal, mnd) {
  const naar = { konsertmaaned: "i konsertmåneden", maanedEtter: "måneden etter konserten", maanedFoer: "måneden før konserten" };
  return (sal.leie ?? []).map(b => {
    if (b.type === "perKonsert") return `${tallC(b.belop)} kr per konsert, betales ${naar[b.naar] ?? b.naar}`;
    if (b.type === "andel") return `${prosent1(b.andel)} % av billettoppgjøret (billettpris minus gebyr), minst ${tallC(b.minimum)} kr per konsert, betales ${naar[b.naar] ?? b.naar}`;
    if (b.type === "engang") return `${b.navn ?? "Engangsbeløp"} ${tallC(b.belop)} kr, betales ${(mnd[b.tidspunkt ?? 0] ?? "").toLowerCase()}`;
    if (b.type === "sesong") return `${b.navn ?? "Sesongleie"} ${tallC(b.belop)} kr for hele våren, betales ${(b.plan ?? []).map(p => `${tallC(b.belop * p.andel)} kr ${p.tidspunkt === 0 ? "før januar" : `ved slutten av ${(mnd[p.tidspunkt] ?? "").toLowerCase()}`}`).join(" og ")}`;
    return JSON.stringify(b);
  }).join(". ");
}

/** Hvordan Konsertplan regner, i klartekst, med verdiene som gjelder nå. Modellen bruker dette til å forklare. */
function slikRegnesDet(s) {
  const r = prosent1(s.rente), lr = prosent1(s.laanRente);
  return {
    pengene_per_konsert:
      `Billettoppgjøret er antall betalte billetter ganger (billettpris ${tallC(s.billettpris)} kr minus gebyr ${tallC(s.gebyr)} kr), og kommer måneden etter konserten. ` +
      `Publikumsutgiften er ${tallC(s.utgiftPerBillett)} kr per billett, betalt i konsertmåneden. ` +
      `Pakken fra Rigg & Ro betales med ${prosent1(s.pakkeDel1Andel ?? 0.5)} % måneden før konserten og resten i konsertmåneden. ` +
      `Leien følger vilkårene til salen (se saler). Antall billetter er forventet salg, men aldri mer enn plassene i salen.`,
    kontoen_ved_maanedsslutt:
      "Kontoen starter på 0 rett før januar. Hver måned legges inn- og utbetalingene til. Tallene per måned står i kontoen_ved_maanedsslutt_kr for hvert valg.",
    maa_ha_klart:
      "Det laveste kontoen kommer ved et månedsslutt, som et positivt beløp. Det er startfinansieringen dere trenger (finansieringsbehovet). Holder det seg under rammen, holder valget rammen.",
    verdi_for_sceneskift:
      `Alle inn- og utbetalinger fra før januar til siste oppgjør, regnet om til dagens kroner med ${r} % realrente per år: et beløp ved slutten av måned t ganges med 1 / (1 + ${r} %) opphøyd i t/12. Summen er verdien (nåverdien). Planleggingen er betalt uansett og er ikke med.`,
    laan_ut_over_rammen:
      `Utvidelse utenfor casen, gruppas antakelse. Casen holder lån utenfor. Går kontoen lenger ned enn rammen ved et månedsslutt, regnes det som ligger under rammen som et lån (kassekreditt) den måneden. ` +
      `Lånet er det største slike beløpet. Renten er ${lr} % per år og regnes per måned: lånet den måneden ganger ${lr} % delt på 12. Rentekostnaden er summen av månedene. ` +
      `Renten holdes utenfor verdien for Sceneskift. Verdi etter rente trekker rentene fra, regnet om til dagens kroner. Tallene per måned står i laan_per_maaned for hvert valg. ` +
      `Lånet gjør et valg mulig, men ikke tryggere: blir salget lavere, må lånet bli større.`,
  };
}

/** Lånetallene og kontoen per måned for en handling, fra motoren. Avstå har ingen pengestrøm. */
function pengerPerMaaned(r, mnd) {
  if (!r?.saldo) return { kontoen_ved_maanedsslutt_kr: null, laan_ut_over_rammen_kr: 0, maaneder_med_laan: 0, laan_per_maaned: [], rentekostnad_kr: 0, verdi_etter_rente_kr: 0 };
  const navn = t => mnd[t] ?? `Måned ${t}`;
  return {
    kontoen_ved_maanedsslutt_kr: Object.fromEntries(r.saldo.map((v, t) => [navn(t), kroner(v)])),
    laan_ut_over_rammen_kr: kroner(r.laan),
    maaneder_med_laan: r.maanederMedLaan ?? 0,
    laan_per_maaned: (r.trekk ?? []).map((v, t) => (v > 0 ? { maaned: navn(t), laan_kr: kroner(v), rente_kr: kroner(r.renter[t]) } : null)).filter(Boolean),
    rentekostnad_kr: kroner(r.rentekostnad),
    verdi_etter_rente_kr: kroner(r.nvEtterRente),
  };
}

/** En grense fra motoren, uten fagord. enhet "salg" gir prosent av 2026-salget, "kr" gir kroner. */
function chatGrense(g, enhet) {
  if (!g) return null;
  if (g.status === "aldri") return "finnes ikke: skjer ikke uansett hvor langt det går";
  if (g.status === "alltid") return "allerede der uansett";
  if (enhet === "salg") return { prosent_av_salget_i_2026: prosent1(g.verdi), billetter_aa_gaa_paa_i_sesongen: g.billetter == null ? null : kroner(g.billetter) };
  return { kr: kroner(g.verdi), kr_aa_gaa_paa: g.kroner == null ? null : kroner(g.kroner) };
}

/**
 * Forutsetningene og resultatene akkurat nå, regnet av motoren, som et objekt modellen kan lese.
 * Alle beløp er hele kroner. Differansene modellen trenger (mot rammen, mot rådet) er regnet her,
 * så modellen ikke trenger å regne.
 */
export function tilstand(data) {
  const { sesong: s, saler, program } = data;
  const R = raadet(s, saler, program);
  const G = grenser(s, saler, program);
  const res = beregnAlle(s, saler, program);
  const sc = aktivtScenario(s);
  const ramme = s.ramme;
  const valg = R.valg;
  const navnFor = x => (x.type === "sal" && x.kort ? `${x.navn} (${x.kort})` : x.navn);
  const utenfor = utvidelserIBruk(s, program);
  const lokal = saler.filter(x => (x.lokaleeffekt ?? 1) !== 1);
  if (lokal.length) utenfor.push("lokaleeffekt");
  if (res.blandet) utenfor.push("blandet program");
  const g = R.grense;
  const mnd = s.maanedsnavn ?? [];
  const resFor = id => (id === "egen" ? res.egen : id === "avstaa" ? null : res.altI[id]);
  const snuTil = p => (p?.status === "grense" ? { verdi: kroner(p.verdi), raadet_blir: p.til ? navnFor(p.til) : null } : "snur ikke innenfor det vi har prøvd");
  return {
    forutsetninger: {
      scenario: sc ? sc.navn : "egne verdier",
      salg_i_prosent_av_2026: prosent1(s.etterspoerselsfaktor ?? 1),
      pakke_per_konsert_kr: kroner(s.pakke),
      billettpris_kr: kroner(s.billettpris),
      startfinansiering_ramme_kr: ramme == null ? null : kroner(ramme),
      realrente_prosent_per_aar: prosent1(s.rente),
      utenfor_casen: {
        bar_omsetning_per_gjest_kr: kroner(s.barPerGjest),
        bar_andel_til_sceneskift_prosent: prosent1(s.barAndel),
        uforutsette_kostnader_per_konsert_kr: kroner(s.uforutsett),
        lokaleeffekt_prosent: Object.fromEntries(saler.map(x => [x.id, prosent1(x.lokaleeffekt ?? 1)])),
        i_bruk_naa: utenfor,
      },
    },
    raadet: {
      valg: valg.type === "avstaa" ? "Avstå" : navnFor(valg),
      regel: R.regel,
      salg_ved_20_prosent_lavere_i_prosent_av_2026: prosent1(R.lavFaktor),
    },
    valgene: R.alle.map(x => ({
      navn: navnFor(x),
      vaart_raad: x.id === valg.id,
      verdi_for_sceneskift_kr: kroner(x.nv),
      maa_ha_klart_kr: kroner(x.behov),
      holder_rammen_naa: x.holderNaa,
      over_rammen_med_kr: ramme != null && x.behov > ramme ? kroner(x.behov - ramme) : 0,
      under_rammen_med_kr: ramme != null && x.behov <= ramme ? kroner(ramme - x.behov) : null,
      verdi_ved_20_prosent_lavere_salg_kr: kroner(x.nvLav),
      maa_ha_klart_ved_20_prosent_lavere_salg_kr: kroner(x.behovLav),
      holder_rammen_ved_20_prosent_lavere_salg: x.holderLav,
      verdi_mot_raadet_kr_positiv_er_mer: x.id === valg.id ? 0 : kroner(x.nv - valg.nv),
      leie_foer_foerste_konsert_kr: kroner(x.leieFoerStart),
      fulle_konserter: x.fulleKonserter,
      billetter_som_gaar_tapt_fordi_salen_er_full: kroner(x.tapteBilletter),
      ...pengerPerMaaned(resFor(x.id), mnd),
    })),
    naar_raadet_snur: valg.type === "avstaa" ? {
      merknad: "Rådet er å avstå. Startfinansieringen under er det som gir et annet råd.",
      startfinansiering_som_gir_annet_raad: snuTil(R.snu.ramme),
    } : {
      gjelder: navnFor(valg),
      salget_der_valget_taper_penger: chatGrense(g?.nvNegativUnder, "salg"),
      salget_der_rammen_ryker: chatGrense(g?.overRammenUnder, "salg"),
      pakken_der_rammen_ryker: chatGrense(g?.pakkeOverRammen, "kr"),
      pakken_der_rammen_ryker_ved_20_prosent_lavere_salg_kr: g?.pakkeLav?.status === "grense" ? kroner(g.pakkeLav.verdi) : chatGrense(g?.pakkeLav, "kr"),
      startfinansiering_som_gir_annet_raad: snuTil(R.snu.ramme),
      bar_kr_per_gjest_til_sceneskift_som_gir_annet_raad: snuTil(R.snu.bar),
      uforutsette_kostnader_per_konsert_som_gir_annet_raad: snuTil(R.snu.uforutsett),
      ti_kr_mer_per_gjest_fra_baren_gir_mer_verdi_kr: kroner(R.barPer10),
    },
    grenser_per_valg: G.map(x => ({
      navn: navnFor(x),
      salget_der_verdien_blir_negativ: chatGrense(x.nvNegativUnder, "salg"),
      salget_der_rammen_ryker: chatGrense(x.overRammenUnder, "salg"),
      pakken_der_rammen_ryker: chatGrense(x.pakkeOverRammen, "kr"),
    })),
    regler_fra_arbeidsboka: beslutningsregler(s, saler, program).map(r => ({ regel: `${r.nr} ${r.navn}`, krav: r.krav, velger: r.valg.type === "avstaa" ? "Avstå" : navnFor(r.valg) })),
    slik_regnes_det: slikRegnesDet(s),
    saler: saler.map(x => ({ id: x.id, navn: x.navn, leie: leieTekst(x, mnd), plasser_staaende: x.kapasitet?.staa ?? null, plasser_sittende: x.kapasitet?.sitte ?? null,
                             sitteplasser_antatt: !!x.sitteAntatt, kun_hel_sesong: !!x.kunHelSesong })),
    program: program.map((k, i) => ({
      nr: k.nr, dato: k.dato, artist: k.artist, sjanger: k.sjanger,
      forventet_salg: kroner(k.forventetSalg), salg_i_2026: k.salg2026 ?? null,
      sal_i_egen_plan: k.salId, oppsett: k.oppsett === "sitte" ? "sittende" : "stående",
      pakke_kr: kroner(pakkeFor(s, k)),
      fullt_i: Object.keys(res.altI).filter(id => res.altI[id].perKonsert[i]?.kappet),
    })),
  };
}

export const tilstandTekst = data => JSON.stringify(tilstand(data));

/* ---------- Verktøyet: prøv en endring ---------- */
// Felt i verktøyet: [navn i verktøyet, felt i sesongen, faktor fra verktøy til sesong, min, maks, tekst]
const CHAT_FELT = [
  ["salg_prosent_av_2026", "etterspoerselsfaktor", 0.01, 0, 300, "Salg i forhold til 2026"],
  ["pakke_kr", "pakke", 1, 0, 1000000, "Pakke per konsert"],
  ["startfinansiering_kr", "ramme", 1, 0, 10000000, "Startfinansiering"],
  ["billettpris_kr", "billettpris", 1, 0, 5000, "Billettpris"],
  ["bar_omsetning_per_gjest_kr", "barPerGjest", 1, 0, 5000, "Bar, omsetning per gjest (utenfor casen)"],
  ["bar_andel_prosent", "barAndel", 0.01, 0, 100, "Bar, Sceneskifts andel (utenfor casen)"],
  ["uforutsette_kostnader_per_konsert_kr", "uforutsett", 1, 0, 1000000, "Uforutsette kostnader per konsert (utenfor casen)"],
];

export const VERKTOY = [{
  name: "prov_endring",
  description:
    "Regner rådet og tallene på nytt i Konsertplan med én eller flere endrede forutsetninger, og gir tallene før og etter. " +
    "Bruk den hver gang Maja spør «hva om», og når du trenger et tall som ikke står i tallene du har fått. " +
    "Verdiene er nye verdier, ikke tillegg: salget 20 % lavere enn Majas premiss er salg_prosent_av_2026 = 80. " +
    "Felt du ikke tar med, beholdes som nå. Majas plan endres ikke: hun kan selv trykke «Bruk i planen» etterpå. " +
    "Bar, uforutsette kostnader, pakke per konsert, sal per konsert og lokaleeffekt er utenfor casen.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      scenario: { type: "string", description: "Navnet på et scenario fra arbeidsboka (Basis, Lav etterspørsel, Høyere pakkepris, Samlet, Høy etterspørsel). Setter salg og pakke. Andre felt legges oppå." },
      salg_prosent_av_2026: { type: "number", description: "Salget som prosent av salget på tilsvarende konsert i 2026. Majas premiss er 100." },
      pakke_kr: { type: "number", description: "Pakkeprisen fra Rigg & Ro per konsert, kr. Casen: 60 000." },
      startfinansiering_kr: { type: "number", description: "Rammen, startfinansieringen Maja kan skaffe, kr. Casen: 250 000." },
      billettpris_kr: { type: "number", description: "Billettpris, kr. Casen: 350." },
      bar_omsetning_per_gjest_kr: { type: "number", description: "Utenfor casen. Baromsetning per betalt billett, kr." },
      bar_andel_prosent: { type: "number", description: "Utenfor casen. Sceneskifts andel av baromsetningen, prosent." },
      uforutsette_kostnader_per_konsert_kr: { type: "number", description: "Utenfor casen. Kostnader pakken ikke dekker, kr per konsert." },
      lokaleeffekt: {
        type: "array", description: "Utenfor casen. Salget i en sal som prosent av etterspørselen (100 = lokalet påvirker ikke salget).",
        items: { type: "object", additionalProperties: false, properties: { sal: { type: "string", description: "Salens id, for eksempel C" }, prosent: { type: "number" } }, required: ["sal", "prosent"] },
      },
      konserter: {
        type: "array", description: "Endringer for enkeltkonserter i Majas plan, med konsertens nummer (1 til 12).",
        items: {
          type: "object", additionalProperties: false, required: ["nr"],
          properties: {
            nr: { type: "integer" },
            forventet_salg: { type: "number", description: "Forventet antall betalte billetter" },
            sal: { type: "string", description: "Salens id. Utenfor casen når planen da blander saler" },
            oppsett: { type: "string", enum: ["stående", "sittende"] },
            pakke_kr: { type: "number", description: "Utenfor casen. Pakken for denne konserten, kr" },
          },
        },
      },
    },
  },
}];

const kortTall = v => Math.round(v).toLocaleString("nb-NO");

/**
 * Tolker verktøyets input mot dataene. Returnerer { endringer: [{ tekst, fra, til }], feil: [tekst], bruk(data) }.
 * bruk(data) setter endringene på et dataobjekt (endrer det). Feil gir ingen endringer.
 */
export function tolkEndring(data, input) {
  const feil = [], endringer = [], steg = [];
  const inn = input && typeof input === "object" ? input : {};
  const kjente = new Set(["scenario", "lokaleeffekt", "konserter", ...CHAT_FELT.map(f => f[0])]);
  for (const k of Object.keys(inn)) if (!kjente.has(k)) feil.push(`Ukjent felt: ${k}`);
  const s = data.sesong;
  const tallOk = (v, min, maks, navn) => {
    if (typeof v !== "number" || !Number.isFinite(v)) { feil.push(`${navn} må være et tall`); return false; }
    if (v < min || v > maks) { feil.push(`${navn} må være mellom ${kortTall(min)} og ${kortTall(maks)}`); return false; }
    return true;
  };
  if (inn.scenario != null) {
    const sc = (s.scenarioer ?? []).find(x => x.navn.toLowerCase() === String(inn.scenario).toLowerCase());
    if (!sc) feil.push(`Ukjent scenario: ${inn.scenario}. Finnes: ${(s.scenarioer ?? []).map(x => x.navn).join(", ")}`);
    else { endringer.push({ tekst: `Scenario ${sc.navn}`, fra: aktivtScenario(s)?.navn ?? "egne verdier", til: sc.navn }); steg.push(d => velgScenario(d.sesong, sc)); }
  }
  for (const [navn, felt, faktor, min, maks, tekst] of CHAT_FELT) {
    if (inn[navn] == null) continue;
    if (!tallOk(inn[navn], min, maks, tekst)) continue;
    const til = inn[navn] * faktor;
    const vis = v => (faktor === 1 ? `${kortTall(v ?? 0)} kr` : `${prosent1(v ?? 0).toLocaleString("nb-NO")} %`);
    endringer.push({ tekst, fra: vis(s[felt]), til: vis(til) });
    steg.push(d => { d.sesong[felt] = til; });
  }
  for (const l of Array.isArray(inn.lokaleeffekt) ? inn.lokaleeffekt : []) {
    const sal = data.saler.find(x => x.id === String(l?.sal).toUpperCase() || x.navn === l?.sal);
    if (!sal) { feil.push(`Ukjent sal: ${l?.sal}`); continue; }
    if (!tallOk(l.prosent, 0, 300, `Lokaleeffekt for ${sal.navn}`)) continue;
    endringer.push({ tekst: `Lokaleeffekt ${sal.navn} (utenfor casen)`, fra: `${prosent1(sal.lokaleeffekt ?? 1).toLocaleString("nb-NO")} %`, til: `${l.prosent.toLocaleString("nb-NO")} %` });
    steg.push(d => { d.saler.find(x => x.id === sal.id).lokaleeffekt = l.prosent / 100; });
  }
  for (const e of Array.isArray(inn.konserter) ? inn.konserter : []) {
    const k = data.program.find(x => x.nr === e?.nr);
    if (!k) { feil.push(`Fant ikke konsert nr ${e?.nr}`); continue; }
    const navn = `${k.nr} ${k.artist}`;
    if (e.forventet_salg != null && tallOk(e.forventet_salg, 0, 100000, `Forventet salg for ${navn}`)) {
      endringer.push({ tekst: `Forventet salg, ${navn}`, fra: kortTall(k.forventetSalg ?? 0), til: kortTall(e.forventet_salg) });
      steg.push(d => { d.program.find(x => x.nr === k.nr).forventetSalg = e.forventet_salg; });
    }
    if (e.sal != null) {
      const sal = data.saler.find(x => x.id === String(e.sal).toUpperCase() || x.navn === e.sal);
      if (!sal) feil.push(`Ukjent sal: ${e.sal}`);
      else if (sal.kunHelSesong) feil.push(`${sal.navn} kan bare velges for hele sesongen, ikke for én konsert`);
      else { endringer.push({ tekst: `Sal, ${navn}`, fra: k.salId, til: sal.id }); steg.push(d => { d.program.find(x => x.nr === k.nr).salId = sal.id; }); }
    }
    if (e.oppsett != null) {
      const ny = e.oppsett === "sittende" ? "sitte" : e.oppsett === "stående" ? "staa" : null;
      if (!ny) feil.push(`Oppsett må være stående eller sittende`);
      else { endringer.push({ tekst: `Oppsett, ${navn}`, fra: k.oppsett === "sitte" ? "sittende" : "stående", til: e.oppsett }); steg.push(d => { d.program.find(x => x.nr === k.nr).oppsett = ny; }); }
    }
    if (e.pakke_kr != null && tallOk(e.pakke_kr, 0, 1000000, `Pakke for ${navn}`)) {
      endringer.push({ tekst: `Pakke, ${navn} (utenfor casen)`, fra: `${kortTall(pakkeFor(s, k))} kr`, til: `${kortTall(e.pakke_kr)} kr` });
      // Pakken per konsert lagres som avvik fra sesongens pakke. Settes etter at sesongens pakke er endret
      steg.push(d => { d.program.find(x => x.nr === k.nr).pakkeAvvik = e.pakke_kr - (d.sesong.pakke ?? 0); });
    }
  }
  if (!feil.length && !endringer.length) feil.push("Ingen endringer. Oppgi minst én forutsetning som skal endres.");
  // Stegene kjøres i rekkefølgen over: scenario, sesongfelt, lokaleeffekt, konserter. Da regnes pakken per konsert mot en ny sesongpakke
  const bruk = d => { if (!feil.length) for (const f of steg) f(d); return d; };
  return { endringer, feil, bruk };
}

/** Kort utdrag av tilstanden, til før og etter i verktøyets svar og i grensesnittet. */
function utdrag(t) {
  return {
    raadet: t.raadet.valg,
    valgene: t.valgene.map(v => ({ navn: v.navn, verdi_for_sceneskift_kr: v.verdi_for_sceneskift_kr, maa_ha_klart_kr: v.maa_ha_klart_kr,
                                   holder_rammen_naa: v.holder_rammen_naa, holder_rammen_ved_20_prosent_lavere_salg: v.holder_rammen_ved_20_prosent_lavere_salg })),
  };
}

/**
 * Kjører verktøyet. Returnerer { ok, input, endringer, feil, foer, etter, svar } der svar er teksten modellen får.
 * data endres ikke.
 */
export function provEndring(data, input) {
  const tolket = tolkEndring(data, input);
  if (tolket.feil.length) {
    return { ok: false, input, endringer: tolket.endringer, feil: tolket.feil,
             svar: JSON.stringify({ feil: tolket.feil, hint: "Ingenting er regnet. Rett feltene og prøv igjen, eller si til Maja hva Konsertplan ikke kan regne." }) };
  }
  const foerT = tilstand(data);
  const ny = tolket.bruk(kopi(data));
  const etterT = tilstand(ny);
  const foer = utdrag(foerT), etter = utdrag(etterT);
  const endring = etter.valgene.map(v => {
    const f = foer.valgene.find(x => x.navn === v.navn);
    return f ? { navn: v.navn, verdi_endres_med_kr: v.verdi_for_sceneskift_kr - f.verdi_for_sceneskift_kr, maa_ha_klart_endres_med_kr: v.maa_ha_klart_kr - f.maa_ha_klart_kr } : { navn: v.navn, ny: true };
  });
  const svar = {
    merknad: "Prøveberegning i Konsertplan. Majas plan er ikke endret.",
    endret: tolket.endringer,
    foer,
    etter: { ...etter, naar_raadet_snur: etterT.naar_raadet_snur, utenfor_casen_i_bruk: etterT.forutsetninger.utenfor_casen.i_bruk_naa },
    endring_fra_foer: endring,
    raadet_snur: foer.raadet !== etter.raadet,
  };
  return { ok: true, input, endringer: tolket.endringer, feil: [], foer, etter, svar: JSON.stringify(svar) };
}

/** Setter verktøyets endringer på Majas plan (endrer data). Brukes av knappen «Bruk i planen». */
export function brukEndring(data, input) {
  const t = tolkEndring(data, input);
  if (t.feil.length) return false;
  t.bruk(data);
  return true;
}

/* ---------- Instruksen til modellen ---------- */
export const SYSTEM = `Du er hjelperen i Konsertplan, et verktøy laget for Maja, daglig leder i konsertarrangøren Sceneskift. Hun skal velge sal for de tolv konsertene våren 2027: Lune Sal (A), Søyleverket (B) eller Skarvkaien (C), eller avstå. Verktøyet er laget av tre NHH-studenter i faget MET3. Sceneskift, salene og tallene er fiktive og laget for undervisning.

Slik jobber du:
- Du regner aldri selv. Hvert tall i svaret ditt skal stå i tallene fra Konsertplan som du har fått, eller i svaret fra verktøyet prov_endring. Ikke legg sammen, trekk fra, gang eller del, heller ikke for å finne en forskjell. Trenger du et tall som ikke står der, bruk verktøyet. Kan ikke verktøyet regne det, si at Konsertplan ikke viser det.
- Spør Maja hvordan et tall er regnet, forklar det med slik_regnes_det og tallene per måned for valget det gjelder. Du kan vise regnestykket slik det står der, med tallene du har fått, men regn ikke ut nye tall.
- «Lånet» betyr lån ut over rammen (kassekreditten i slik_regnes_det.laan_ut_over_rammen), ikke startfinansieringen. Trenger valget hun ser på ikke lån, si det, og vis hvilket valg som trenger lån og hvor mye. Kan spørsmålet bety begge deler, si kort hvilket du svarer på.
- Spør Maja «hva om» (annet salg, annen pakkepris, mer startfinansiering, bar, uforutsette kostnader, en konsert i en annen sal), bruk prov_endring. Det endrer ikke planen hennes. Hun kan selv trykke «Bruk i planen» under svaret ditt.
- Svar kort: to til fem setninger, eller noen få korte punkter med «- » foran. Svaret først, så hvorfor.
- Skriv på Majas språk, på norsk bokmål. Hun er arrangør, ikke økonom. Si «verdi for Sceneskift» (i dagens kroner) i stedet for nåverdi, og «det dere må ha klart» eller «startfinansieringen dere trenger» i stedet for finansieringsbehov. Forklar ordene bare hvis hun spør.
- Skriv beløp som «173 787 kr» og prosent som «79,8 %». Ingen markdown: ingen stjerner, overskrifter eller tabeller. Bruk aldri tankestrek eller bindestrek som skilletegn i en setning.
- Rådet følger regelen i gruppas notat: høyest verdi blant valgene som holder rammen både med salget nå og hvis salget blir 20 % lavere. Gi aldri et annet råd enn Konsertplan. Er Maja uenig, vis hva som må endres for at rådet skal snu.
- Casen sier at det utover billettene, publikumsutgiften, pakken og leien ikke er andre inntekter eller kostnader. Bar, uforutsette kostnader, pakkepris per konsert, saler blandet per konsert og lokaleeffekt er gruppas utvidelser. Når svaret bruker dem, si at det er utenfor casen. Står noe i forutsetninger.utenfor_casen.i_bruk_naa (for eksempel blandet program), nevn det alltid i svaret.
- Du vet ikke mer om salene, artistene eller markedet enn det som står i tallene. Ikke finn på fakta.
- Handler spørsmålet om noe annet enn sesongen og rådet, si kort at du bare kan hjelpe med Konsertplan.

Tallene fra Konsertplan kommer som JSON i Majas meldinger, merket «Tallene i Konsertplan nå». Nyeste versjon gjelder.`;

/* ---------- Samtalen ---------- */
export function nySamtale() {
  return { meldinger: [], sendtTilstand: null };
}

export function lagForespoersel(meldinger) {
  return {
    model: CHAT_MODELL,
    max_tokens: 16000,
    system: SYSTEM,
    tools: VERKTOY,
    messages: meldinger,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" }, // korte svar i en chat, tallene kommer fra motoren
    fallbacks: "default",             // avslår modellen, prøver API-et en annen modell (krever beta-hodet under)
    cache_control: { type: "ephemeral" },
  };
}

export class ChatFeil extends Error {
  constructor(type, melding) { super(melding); this.type = type; }
}

/** Feilmelding på Majas språk for et svar fra API-et som ikke er 200. */
export function feilFraStatus(status, json) {
  const detalj = json?.error?.message ? ` (${json.error.message})` : "";
  if (status === 401) return new ChatFeil("nokkel", "Anthropic godtok ikke nøkkelen. Sjekk at den er limt inn riktig.");
  if (status === 403) return new ChatFeil("nokkel", `Nøkkelen har ikke tilgang til modellen${detalj}.`);
  if (status === 429) return new ChatFeil("grense", "For mange spørsmål på kort tid, eller brukergrensen på nøkkelen er nådd. Vent litt og prøv igjen.");
  if (status === 400) return new ChatFeil("foresporsel", `API-et avviste forespørselen${detalj}.`);
  if (status === 529 || status >= 500) return new ChatFeil("opptatt", "Tjenesten hos Anthropic er opptatt akkurat nå. Prøv igjen om litt.");
  return new ChatFeil("ukjent", `Uventet svar fra Anthropic (${status})${detalj}.`);
}

/** Kall mot Messages API rett fra nettleseren. hent kan byttes ut i tester. */
export function lagKall(nokkel, hent = globalThis.fetch) {
  return async body => {
    let svar;
    try {
      svar = await hent(CHAT_API, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": nokkel,
          "anthropic-version": CHAT_API_VERSJON,
          "anthropic-beta": "server-side-fallback-2026-07-01",
          "anthropic-dangerous-direct-browser-access": "true", // kall rett fra nettleseren, nøkkelen er brukerens egen
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ChatFeil("nett", "Fikk ikke kontakt med Anthropic. Sjekk at maskinen er på nett.");
    }
    let json = null;
    try { json = await svar.json(); } catch { /* tomt svar */ }
    if (!svar.ok) throw feilFraStatus(svar.status, json);
    return json;
  };
}

/**
 * Ett spørsmål fra Maja, med verktøyrunder til modellen er ferdig. Samtalen bygges bare på (aldri redigert bakover).
 * Får modellen ikke svart (avslag, feil, for mange runder), settes samtalen tilbake til før spørsmålet.
 * Returnerer { tekst, kjoringer: [provEndring-resultat], avslaatt, avkortet }.
 */
export async function spor(samtale, data, tekst, kall) {
  const start = samtale.meldinger.length;
  const sendtFoer = samtale.sendtTilstand;
  const naa = tilstandTekst(data);
  const innhold = [];
  if (naa !== samtale.sendtTilstand) innhold.push({ type: "text", text: `Tallene i Konsertplan nå, regnet av motoren:\n${naa}` });
  innhold.push({ type: "text", text: tekst });
  samtale.meldinger.push({ role: "user", content: innhold });
  samtale.sendtTilstand = naa;
  const kjoringer = [];
  const tilbake = () => { samtale.meldinger.length = start; samtale.sendtTilstand = sendtFoer; };
  try {
    for (let runde = 0; runde < CHAT_MAKS_RUNDER; runde++) {
      const r = await kall(lagForespoersel(samtale.meldinger));
      if (!r || !Array.isArray(r.content)) throw new ChatFeil("ukjent", "Uventet svar fra modellen.");
      if (r.stop_reason === "refusal") {
        tilbake();
        return { tekst: "Modellen ville ikke svare på dette. Prøv å spørre på en annen måte.", kjoringer: [], avslaatt: true };
      }
      samtale.meldinger.push({ role: "assistant", content: r.content });
      if (r.stop_reason === "tool_use") {
        const resultater = [];
        for (const b of r.content.filter(x => x.type === "tool_use")) {
          if (b.name !== "prov_endring") {
            resultater.push({ type: "tool_result", tool_use_id: b.id, is_error: true, content: `Ukjent verktøy: ${b.name}` });
            continue;
          }
          const k = provEndring(data, b.input);
          if (k.ok) kjoringer.push(k);
          resultater.push({ type: "tool_result", tool_use_id: b.id, content: k.svar, ...(k.ok ? {} : { is_error: true }) });
        }
        samtale.meldinger.push({ role: "user", content: resultater });
        continue;
      }
      const svarTekst = r.content.filter(x => x.type === "text").map(x => x.text).join("\n\n").trim();
      return { tekst: svarTekst || "(Tomt svar fra modellen.)", kjoringer, avkortet: r.stop_reason === "max_tokens" };
    }
    throw new ChatFeil("runder", "Modellen kom ikke fram til et svar. Prøv å spørre enklere.");
  } catch (e) {
    tilbake();
    throw e;
  }
}

/** Rydder svaret til ren tekst: avsnitt og punkter, uten markdown-tegn modellen likevel kan ha tatt med. */
export function avsnitt(tekst) {
  const ut = [];
  for (const blokk of String(tekst).replace(/\*\*|__|^#+\s*/gm, "").split(/\n\s*\n/)) {
    const linjer = blokk.split("\n").map(l => l.trim()).filter(Boolean);
    if (!linjer.length) continue;
    if (linjer.every(l => /^[-•*]\s+/.test(l))) ut.push({ type: "punkter", linjer: linjer.map(l => l.replace(/^[-•*]\s+/, "")) });
    else ut.push({ type: "avsnitt", tekst: linjer.join(" ") });
  }
  return ut;
}

/** Forslag til spørsmål, ut fra rådet nå. t er tilstand(data). */
export function chatForslag(t) {
  const valg = t.raadet.valg;
  const avstaa = valg === "Avstå";
  const ut = [avstaa ? "Hvorfor bør vi avstå?" : `Hvorfor ${valg.replace(/ \(.\)$/, "")}?`];
  if (t.forutsetninger.salg_i_prosent_av_2026 === 100) ut.push("Hva om salget blir 20 % lavere enn i 2026?");
  ut.push(`Hva om Rigg & Ro vil ha ${(t.forutsetninger.pakke_per_konsert_kr + 6000).toLocaleString("nb-NO")} kr per konsert?`);
  const b = t.valgene.find(v => v.navn.startsWith("Søyleverket"));
  if (b && !b.vaart_raad) ut.push("Hvor mye startfinansiering trenger vi for å velge Søyleverket?");
  ut.push("Hva betyr «må ha klart»?");
  return ut;
}

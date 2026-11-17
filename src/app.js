// Konsertplan: tilstand og rendering. Alt regnes på nytt ved hver endring.
import { beregnAlle, beregnAltI, beregnScenarioer, handlinger, aktivtScenario, velgScenario, grenser, beslutningsregler, kapasitet, kopi, raadet, utvidelserIBruk, pakkeFor, barTilSceneskift, lokaleeffektGrense } from "./motor.js";
import { forslagForKonsert, besteBlanding } from "./forslag.js";
import { SESONG_2027, SALER_2027, SCENARIOER_2027, SJANGRE, LOKALER_2026, standardSesong } from "./standard-2027.js";
import { lesLokalt, lagreLokalt, slettLokalt, lastNedFil, lesFil } from "./lagring.js";
import { tegnSaldo, tegnBidrag } from "./figurer.js";
import { nySamtale, spor, lagKall, lesNokkel, lagreNokkel, glemNokkel, brukEndring, avsnitt, chatForslag, tilstand } from "./chat.js";

const tall = v => Math.round(v ?? 0).toLocaleString("nb-NO");
const kr = v => tall(v) + " kr";
const pst = v => Math.round(v * 100) + " %";
/** Nåverdien som vises: etter rente når valget trenger lån ut over rammen (gruppas valg 17.11), ellers casens nåverdi. */
const nvVist = r => (r?.laan > 0 && r.nvEtterRente != null ? r.nvEtterRente : r?.nv ?? 0);
const etterRente = r => (r?.laan > 0 ? h("span", { class: "etter-rente" }, "etter rente") : null);
const MAANEDER = ["Start", "Jan", "Feb", "Mar", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Des"];
const FARGER = ["blaa", "gul", "rosa", "oransje", "gronn", "graa"];
const FARGENAVN = { blaa: "blå", gul: "gul", rosa: "rosa", oransje: "oransje", gronn: "grønn", graa: "grå" };
const FORKLAR_NOKKEL = "konsertplan.forklar";

function h(tag, attrs = {}, ...barn) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.setAttribute("style", v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else if (k === "checked" || k === "disabled" || k === "selected") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const b of barn.flat()) if (b !== null && b !== undefined && b !== false) e.append(b);
  return e;
}
const svg = (label) => { const e = document.createElementNS("http://www.w3.org/2000/svg", "svg"); e.setAttribute("role", "img"); e.setAttribute("aria-label", label); return e; };
/** Forklarende tekst som bare vises når bryteren «Forklaringer» er på. */
const fork = (tag, cls, ...barn) => h(tag, { class: `${cls} forklaring-tekst` }, ...barn);

const state = { data: null, fane: "raadet", referanse: "C", forklar: false, besteBlanding: null, aapneTrekk: new Set(),
                chatAapen: false, chat: { samtale: nySamtale(), logg: [], venter: false, utkast: "" } };

const HASH_ALIAS = { anbefaling: "raadet" };   // det som står i adressen → fanen i koden
function hashFor(fane) { return fane === "raadet" ? "anbefaling" : fane; }
function faneFraHash() {
  const f = location.hash.replace("#", "");
  const fane = HASH_ALIAS[f] ?? f;
  return [...document.querySelectorAll(".faner button")].some(b => b.dataset.fane === fane) ? fane : null;
}

function salAv(id) { return state.data.saler.find(s => s.id === id); }
function salerPerKonsert() { return state.data.saler.filter(s => !s.kunHelSesong); }
function salTittel(s) { return s.kort ? `${s.kort}: ${s.navn}` : s.navn; }
function fargeFor(s) { return s?.farge ?? "graa"; }
function mini(s, cls = "mini") { return s?.bilde ? h("img", { class: cls, src: s.bilde, alt: "" }) : h("span", { class: "prikk" }); }

function lagre() { lagreLokalt(state.data); }
function oppdater() { lagre(); render(); }

/* ---------- Oppstart ---------- */
function init() {
  state.data = lesLokalt() ?? standardSesong();
  try { state.forklar = localStorage.getItem(FORKLAR_NOKKEL) === "1"; } catch { /* uten lager */ }
  if (/[?&]forklar=1/.test(location.search)) state.forklar = true;
  reparer();
  document.getElementById("sesongnavn").addEventListener("change", e => { state.data.sesong.navn = e.target.value.trim() || SESONG_2027.navn; oppdater(); });
  document.getElementById("knapp-lagre").addEventListener("click", () => {
    const navn = (state.data.sesong.navn || "sesong").replace(/[^\wæøåÆØÅ-]+/g, "-").toLowerCase();
    lastNedFil(state.data, `${navn}.konsertplan.json`);
  });
  document.getElementById("knapp-aapne").addEventListener("click", () => document.getElementById("fil").click());
  document.getElementById("fil").addEventListener("change", async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { state.data = await lesFil(f); reparer(); oppdater(); }
    catch (err) { alert(`Kunne ikke åpne fila: ${err.message}`); }
    e.target.value = "";
  });
  document.getElementById("knapp-nullstill").addEventListener("click", () => {
    if (!confirm("Nullstille alt til Sceneskift våren 2027? Endringene dine forsvinner, med mindre du har lagret dem som fil.")) return;
    slettLokalt(); state.data = standardSesong(); oppdater();
  });
  document.getElementById("knapp-forklar").addEventListener("click", () => {
    state.forklar = !state.forklar;
    try { localStorage.setItem(FORKLAR_NOKKEL, state.forklar ? "1" : "0"); } catch { /* uten lager */ }
    visForklaringer();
  });
  // #spor er ikke lenger en fane, men åpner chatten (gamle lenker virker fortsatt). #raadet er det gamle navnet på #anbefaling.
  // Fanen leses fra adressen ved hashchange, popstate og pageshow (siden hentet fra nettleserens hurtiglager),
  // og sammenlignes med fanen som faktisk vises, så å endre bare #-delen i adressefeltet alltid bytter fane.
  const fraHash = () => {
    const f = faneFraHash();
    if (location.hash === "#spor") { aapneChat(); return; }
    const vist = document.querySelector(".faner button[aria-pressed='true']")?.dataset.fane;
    if (f && (f !== state.fane || f !== vist)) { state.fane = f; render(); window.scrollTo(0, 0); }
  };
  for (const b of document.querySelectorAll(".faner button")) b.addEventListener("click", () => { state.fane = b.dataset.fane; history.replaceState(null, "", "#" + hashFor(state.fane)); render(); });
  window.addEventListener("hashchange", fraHash);
  window.addEventListener("popstate", fraHash);
  window.addEventListener("pageshow", fraHash);
  if (faneFraHash()) state.fane = faneFraHash();
  if (location.hash === "#spor") state.chatAapen = true;
  // Fullskjerm (nr 16 i tilbakemeldingene): knappen øverst, eller tasten F utenfor skrivefelt
  const fsKnapp = document.getElementById("knapp-fullskjerm");
  const fsMulig = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  if (!fsMulig) fsKnapp.hidden = true;
  const fsElement = () => document.fullscreenElement ?? document.webkitFullscreenElement;
  const vekslFullskjerm = () => {
    if (fsElement()) (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
    else (document.documentElement.requestFullscreen ?? document.documentElement.webkitRequestFullscreen).call(document.documentElement);
  };
  fsKnapp.addEventListener("click", vekslFullskjerm);
  const fsOppdater = () => { fsKnapp.setAttribute("aria-pressed", String(!!fsElement())); fsKnapp.textContent = fsElement() ? "Avslutt fullskjerm" : "Fullskjerm"; };
  document.addEventListener("fullscreenchange", fsOppdater);
  document.addEventListener("webkitfullscreenchange", fsOppdater);
  document.addEventListener("keydown", e => {
    if (e.key !== "f" && e.key !== "F") return;
    if (e.metaKey || e.ctrlKey || e.altKey || !fsMulig) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    e.preventDefault(); vekslFullskjerm();
  });
  document.getElementById("gaffarull").addEventListener("click", () => aapneChat());
  document.addEventListener("keydown", e => { if (e.key === "Escape" && state.chatAapen) lukkChat(); });
  // Åpnet fra presentasjonen (MET3): vis lenke tilbake. Maja ser den ikke
  if (new URLSearchParams(location.search).get("fra") === "presentasjon") {
    const tilbake = document.getElementById("til-presentasjon");
    tilbake.hidden = false;
    // ?tilbake=slutt går rett til den siden i presentasjonen, ellers tilbake dit vi kom fra
    const til = new URLSearchParams(location.search).get("tilbake");
    if (til) tilbake.href = tilbake.href.replace(/#.*$/, "") + "#" + encodeURIComponent(til);
    else tilbake.addEventListener("click", e => { if (history.length > 1) { e.preventDefault(); history.back(); } });
  }
  visForklaringer();
  render();
}

function visForklaringer() {
  document.body.classList.toggle("forklar", state.forklar);
  document.getElementById("knapp-forklar").setAttribute("aria-pressed", String(state.forklar));
}

/** Rydder i data etter innlasting: manglende felt, saler som er slettet, oppsett som salen ikke har. */
function reparer() {
  const d = state.data;
  d.sesong = { ...kopi(SESONG_2027), ...d.sesong };
  if (!Array.isArray(d.sesong.scenarioer) || !d.sesong.scenarioer.length) d.sesong.scenarioer = kopi(SCENARIOER_2027);
  if (!d.saler.length) d.saler = kopi(SALER_2027);
  for (const s of d.saler) { s.leie ??= []; s.kapasitet ??= { staa: null, sitte: null }; s.farge ??= "graa"; s.lokaleeffekt ??= 1; }
  const perKonsert = salerPerKonsert();
  const standardProgram = standardSesong().program;
  for (const k of d.program) {
    const std = standardProgram.find(x => x.nr === k.nr && x.artist === k.artist);
    if (std) { k.i2026 ??= std.i2026; k.besetning ??= std.besetning; }
    k.oppsett ??= "staa";
    k.forventetSalg ??= k.salg2026 ?? 0;
    k.pakkeAvvik ??= 0;
    let s = salAv(k.salId);
    if (!s || s.kunHelSesong) s = perKonsert[0];
    k.salId = s?.id ?? null;
    if (s && kapasitet(s, k.oppsett) === null) {
      const annet = k.oppsett === "sitte" ? "staa" : "sitte";
      if (kapasitet(s, annet) !== null) k.oppsett = annet;
    }
  }
  if (!state.data.saler.some(s => s.id === state.referanse)) state.referanse = state.data.saler[0]?.id;
}

/* ---------- Rendering ---------- */
function beregn() { const d = state.data; return beregnAlle(d.sesong, d.saler, d.program); }

function render() {
  const d = state.data;
  document.getElementById("sesongnavn").value = d.sesong.navn;
  const sc = aktivtScenario(d.sesong);
  document.getElementById("undertekst").textContent = `${d.program.length} konserter, ${d.saler.length} saler, ramme ${kr(d.sesong.ramme)}. Scenario: ${sc ? sc.navn : "egne verdier"}`;
  for (const b of document.querySelectorAll(".faner button")) b.setAttribute("aria-pressed", String(b.dataset.fane === state.fane));
  document.body.classList.toggle("fane-resultater", state.fane === "resultater");
  document.body.classList.toggle("fane-raadet", state.fane === "raadet");
  const res = beregn();
  renderStripe(res);
  const main = document.getElementById("innhold");
  main.replaceChildren();
  ({ raadet: renderRaadetFane, program: renderProgram, resultater: renderResultater, saler: renderSaler, forutsetninger: renderForutsetninger })[state.fane](main, res);
  renderChat();
}

function statusTekst(r) {
  const s = state.data.sesong;
  if (s.ramme == null) return h("span", { class: "status svak" }, "Ingen ramme satt");
  if (r.behov <= s.ramme) return h("span", { class: "status pluss" }, `Holder rammen, ${kr(s.ramme - r.behov)} å gå på`);
  return h("span", { class: "status minus" }, `${kr(r.behov - s.ramme)} over rammen. Lån i ${r.maanederMedLaan} ${r.maanederMedLaan === 1 ? "måned" : "måneder"}, ca. ${kr(r.rentekostnad)} i rente`);
}

function renderStripe(res) {
  const el = document.getElementById("stripe");
  el.replaceChildren();
  const d = state.data;
  const s = d.sesong;
  const stor = state.fane === "resultater";
  const deler = [
    { navn: "Egen plan", merke: res.blandet ? h("span", { class: "merke varsel" }, "utenfor casen") : null, farge: "gronn", r: res.egen },
    ...d.saler.map(x => ({ navn: `Alt i ${salTittel(x)}`, farge: fargeFor(x), r: res.altI[x.id], bilde: stor && x.bilde ? mini(x) : null })),
  ];
  for (const p of deler) {
    const r = p.r;
    el.append(h("div", { class: "stripe-del", style: `--c: var(--${p.farge})` },
      h("div", { class: "navn" }, p.bilde, p.navn, p.merke),
      h("div", { class: `nv tall ${nvVist(r) < 0 ? "minus" : ""}` }, kr(nvVist(r)), stor ? h("span", { class: `nv-etikett${r.laan > 0 ? " lang" : ""}` }, r.laan > 0 ? "nåverdi etter rente" : "nåverdi") : etterRente(r)),
      h("div", { class: "rad" }, stor ? "Trenger underveis" : "Trenger", h("b", { class: "tall" }, kr(r.behov))),
      stor ? h("div", { class: "rad" }, "Netto, udiskontert", h("b", { class: "tall" }, kr(r.netto))) : null,
      ...(stor && r.laan > 0 ? [
        h("div", { class: "rad" }, "Nåverdi før rente (casen)", h("b", { class: "tall" }, kr(r.nv))),
        h("div", { class: "rad" }, r.laanType === "fast" ? "Fast lån" : "Kassekreditt", h("b", { class: "tall minus" }, kr(r.laan))),
        h("div", { class: "rad" }, `Rente, ${pst(s.laanRente ?? 0)} p.a.`, h("b", { class: "tall minus" }, kr(r.rentekostnad))),
      ] : []),
      statusTekst(r)));
  }
  // Avstå er alltid et valg, så den står sist som en liten bolk
  el.append(h("div", { class: "stripe-del liten", style: "--c: var(--graa)" },
    h("div", { class: "navn" }, "Avstå"),
    h("div", { class: "nv tall" }, kr(0)),
    h("div", { class: "rad" }, "Ingen risiko, ingen inntekt")));
}

/* ---------- Rådet ---------- */
// Rådet på Majas språk: anbefaling med vilkår, hvorfor, to tall forklart uten fagord, når rådet snur,
// artisten bestemmer salen, og der vi går utenfor casen. Alle tall kommer fra motoren (raadet i motor.js).
const pst1 = v => (Math.round(v * 1000) / 10).toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
const navnMedKort = v => (v.type === "sal" && v.kort ? `${v.navn} (${v.kort})` : v.type === "avstaa" ? "å avstå" : v.navn);
/** Går til en fane. Med anker rulles det til den delen av fanen (for eksempel «finjuster» i Resultater). */
function gaaTil(fane, anker) {
  state.fane = fane; history.replaceState(null, "", "#" + hashFor(fane)); render();
  const mal = anker ? document.getElementById(anker) : null;
  if (mal) mal.scrollIntoView({ block: "start" }); else window.scrollTo(0, 0);
}

/** Leievilkårene i én linje, på vanlig språk. */
function leieType(sal) {
  const deler = [];
  let fast = 0;
  for (const b of sal.leie ?? []) {
    if (b.type === "perKonsert") deler.push(`fast leie, ${kr(b.belop)} per konsert`);
    else if (b.type === "andel") deler.push(`leien følger salget, ${pst(b.andel)} av oppgjøret, minst ${kr(b.minimum ?? 0)}`);
    else if (b.type === "engang") fast += b.belop;
    else if (b.type === "sesong") fast += b.belop;
  }
  if (fast) deler.push(`fast sesongleie, ${kr(fast)} i alt`);
  const t = deler.join(", ");
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/** Utfellbar bolk på hjemskjermen. Hvilke som er åpne huskes mellom tegningene. */
function trekk(id, tittel, under, ...innhold) {
  return h("details", { class: "trekk", open: state.aapneTrekk.has(id), ontoggle: e => { if (e.target.open) state.aapneTrekk.add(id); else state.aapneTrekk.delete(id); } },
    h("summary", {}, h("span", { class: "trekk-tittel" }, tittel), under ? h("span", { class: "trekk-under" }, under) : null),
    h("div", { class: "trekk-innhold" }, ...innhold));
}

const klem = v => Math.max(0, Math.min(1, v));
/** En liten måler under et nøkkeltall: fyll for verdien nå, rød sone der det går galt, strek for en grense. */
function maaler({ tittel, stort, minus, under, fyll, fyll2, sone, strek, farge }) {
  const skala = fyll == null ? null : h("div", { class: "maaler-skala", "aria-hidden": "true" },
    fyll2 != null ? h("span", { class: "maaler-fyll svak-fyll", style: `width: ${klem(fyll2) * 100}%` }) : null,
    h("span", { class: "maaler-fyll", style: `width: ${klem(fyll) * 100}%` }),
    sone ? h("span", { class: "maaler-sone", style: `left: ${klem(sone[0]) * 100}%; width: ${(klem(sone[1]) - klem(sone[0])) * 100}%` }) : null,
    strek != null ? h("span", { class: "maaler-strek", style: `left: ${klem(strek) * 100}%` }) : null);
  return h("div", { class: "maaler", style: `--c: var(--${farge ?? "graa"})` },
    h("h3", {}, tittel), h("div", { class: `maaler-tall tall${minus ? " minus" : ""}` }, stort), skala, h("p", { class: "maaler-under" }, ...[under].flat()));
}

function renderRaadetFane(main, res) {
  const d = state.data;
  const s = d.sesong;
  const R = raadet(s, d.saler, d.program);
  const v = R.valg;
  const sc = aktivtScenario(s);
  const ramme = s.ramme;
  const faktor = s.etterspoerselsfaktor ?? 1;
  const mnd = t => (t === 0 ? "før januar" : `i ${(s.maanedsnavn?.[t] ?? `måned ${t}`).toLowerCase()}`);
  const salV = v.type === "sal" ? salAv(v.id) : null;
  const alt = R.alle.filter(x => x.type !== "avstaa");
  const hoyest = alt.reduce((a, b) => (nvVist(b) > nvVist(a) ? b : a), alt[0]); // det regel 3 velger: høyest verdi uansett ramme (etter rente)
  const avstaar = v.type === "avstaa";
  // Ved avstå forklares tallene med den som gir mest av dem som holder rammen nå, ellers den som gir mest
  const x = avstaar ? (alt.filter(a => a.holderNaa).reduce((a, b) => (!a || b.nv > a.nv ? b : a), null) ?? hoyest) : v;

  /* 2 Anbefalingen med vilkår (bygges her, vises under scenariovelgeren) */
  const vilkaar = [];
  const spor = [];
  let tittel, under;
  if (avstaar) {
    tittel = "Ikke signer på disse vilkårene";
    under = alt.every(a => a.nv <= 0) ? "Alle salene gir tap med forutsetningene nå. Det som kan snu det:"
      : `Ingen av salene holder rammen på ${kr(ramme)} både med salget nå og hvis salget blir 20 % lavere. Det som kan snu det:`;
    if (R.snu.ramme?.status === "grense") vilkaar.push(`Skaff ${kr(R.snu.ramme.verdi)} i startfinansiering. Da holder ${navnMedKort(R.snu.ramme.til)} rammen også om salget blir 20 % lavere.`);
    vilkaar.push("Be Rigg & Ro om en lavere pakkepris før dere signerer.");
    vilkaar.push("Be utleierne om å flytte leie til senere i sesongen, eller om leie som følger salget.");
  } else {
    tittel = v.type === "egen" ? "Velg egen plan" : `Velg ${navnMedKort(v)}`;
    under = "men signer først når tre ting er på plass:";
    vilkaar.push(ramme == null
      ? `Startfinansieringen er avklart. Dere har ikke satt noen ramme, og ${v.navn} trenger ${kr(v.behov)} underveis, ${kr(v.behovLav)} hvis salget blir 20 % lavere.`
      : `Startfinansieringen på ${kr(ramme)} er bekreftet, gjerne med en buffer. ${v.navn} trenger ${kr(v.behov)} med salget nå og ${kr(v.behovLav)} hvis salget blir 20 % lavere.`);
    const pl = R.grense?.pakkeLav;
    vilkaar.push(pl?.status === "grense"
      ? `Rigg & Ro bekrefter pakkeprisen på ${kr(s.pakke)} per konsert. Hvis salget blir 20 % lavere, holder ${v.navn} rammen bare så lenge pakken koster under ${kr(pl.verdi)}.`
      : `Rigg & Ro bekrefter pakkeprisen på ${kr(s.pakke)} per konsert.`);
    if (v.type === "egen") vilkaar.push("Utleierne godtar enkeltkonserter. Casen sier at avtalene gjelder hele programmet, så det må avtales før signering.");
    else vilkaar.push(`${v.navn} bekrefter at ${tall(kapasitet(salV, "staa") ?? kapasitet(salV, "sitte"))} plasser er salgbare i oppsettet dere skal bruke.`);
  }
  if (ramme != null && hoyest && hoyest.id !== v.id && hoyest.type === "sal" && !hoyest.holderNaa && hoyest.leieFoerStart > 0)
    spor.push(`${hoyest.navn}: kan noe av de ${kr(hoyest.leieFoerStart)} i leie som forfaller før januar, betales senere? ${hoyest.navn} gir mest, men trenger ${kr(hoyest.behov - ramme)} mer enn rammen.`);
  if (!barTilSceneskift(s) && salV) spor.push(`${salV.navn}: får Sceneskift en del av barsalget? Casen regner ingen barinntekt (se «Der vi går utenfor casen»).`);

  /* 1 Scenario og spørsmål øverst, så velgeren står stille når rådet under endrer lengde. Rådet regnes på nytt med en gang */
  main.append(h("section", { class: "kontrollrad", "aria-label": "Scenario" },
    h("div", { class: "chips", role: "group", "aria-label": "Velg scenario" },
      ...s.scenarioer.map(x2 => h("button", { type: "button", class: `chip${x2.oppside ? " oppside" : ""}`, "aria-pressed": String(x2 === sc), title: x2.begrunnelse,
        onclick: () => { velgScenario(s, x2); oppdater(); } }, x2.navn)),
      sc ? null : h("span", { class: "chip egne" }, "Egne verdier")),
    h("div", { class: "kontroll-hoyre" },
      h("button", { type: "button", class: "stille", onclick: () => gaaTil("resultater", "finjuster") }, "Finjuster i Resultater"),
      h("button", { type: "button", class: "primaer", onclick: () => aapneChat() }, "Spør om rådet"))));
  const kildeLenke = salV?.kilde ? h("div", { class: "kilde" }, "Bilde: ", h("a", { href: salV.kilde, target: "_blank", rel: "noopener" }, salV.kilde.replace(/^https?:\/\//, ""))) : null;
  main.append(h("section", { class: "seksjon anbefaling", style: `--c: var(--${v.farge ?? "graa"})` },
    h("div", { class: "anb-tekst" },
      h("p", { class: "anb-over" }, "Vårt råd til Maja"),
      h("h2", { class: "anb-tittel" }, tittel, v.type === "egen" ? h("span", { class: "merke varsel" }, "utenfor casen") : null),
      h("p", { class: "anb-under" }, under),
      h("ol", { class: "vilkaar" }, ...vilkaar.map(t => h("li", {}, t))),
      avstaar ? h("p", { class: "anb-ellers" }, "Å avstå koster ingenting nå, fordi planleggingen er betalt uansett.")
              : h("p", { class: "anb-ellers" }, "Blir de ikke oppfylt, bør du forsøke å reforhandle før du signerer, eller avstå. Å avstå koster ingenting nå, fordi planleggingen er betalt uansett."),
      spor.length ? h("div", { class: "anb-spor" }, h("h3", {}, "Verdt å spørre om"), h("ul", {}, ...spor.map(t => h("li", {}, t)))) : null),
    salV?.bilde ? h("div", { class: "anb-bilde" }, h("img", { src: salV.bilde, alt: `Bilde av ${salV.navn}` }), kildeLenke) : null));

  const varsler = [utvidelserMerknad(), lokaleeffektMerknad(),
    res.blandet ? h("p", { class: "varsel" }, h("span", { class: "merke varsel" }, "utenfor casen"), " Programmet blander saler. Casen sier at avtalene gjelder hele programmet, så egen plan er et forslag Maja kan ta opp, ikke et tilbud som finnes.") : null].filter(Boolean);
  main.append(h("div", { class: "gjelder" },
    h("p", { class: "naa-linje svak" }, "Gjelder ", h("b", {}, sc ? sc.navn.toLowerCase() : "egne verdier"), ": ",
      h("b", { class: "tall" }, `${pst(faktor)} av salget i 2026`), " og ", h("b", { class: "tall" }, `${kr(s.pakke)} per konsert`), ". ",
      "Regelen, som i notatet: høyest verdi blant valgene som holder rammen både med salget nå og hvis salget blir 20 % lavere."),
    ...varsler));

  /* 3 Nøkkeltallene for rådet, hver med en liten måler */
  const fl = x?.farge ?? "graa";
  const kortNavn = a => a.kort ?? a.navn;
  const fliser = [];
  if (x) {
    const maks = Math.max(...alt.map(a => nvVist(a)), 1);
    fliser.push(maaler({ tittel: avstaar ? `Verdi for Sceneskift, ${x.navn}` : "Verdi for Sceneskift", stort: kr(x.nv), minus: x.nv < 0, farge: fl,
      fyll: Math.max(0, x.nv) / maks, strek: hoyest && hoyest.id !== x.id ? Math.max(0, nvVist(hoyest)) / maks : null,
      under: [`${kr(x.nvLav)} hvis salget blir 20 % lavere.`,
        hoyest && hoyest.id !== x.id ? ` ${kortNavn(hoyest)} gir mest (streken), ${kr(nvVist(hoyest))}${hoyest.laan > 0 ? " etter rente på lånet" : ""}, men holder ikke rammen${hoyest.holderNaa ? " hvis salget blir 20 % lavere" : ""}.` : ""] }));
    if (ramme != null) {
      const topp = Math.max(ramme, x.behovLav, x.behov) * 1.08;
      const over = x.behov > ramme;
      fliser.push(maaler({ tittel: "Må ha klart", stort: kr(x.behov), minus: over, farge: fl,
        fyll: x.behov / topp, fyll2: x.behovLav / topp, strek: ramme / topp, sone: [ramme / topp, 1],
        under: [over ? h("span", { class: "minus" }, `${kr(x.behov - ramme)} over rammen på ${kr(ramme)}.`) : `${kr(ramme - x.behov)} å gå på under rammen på ${kr(ramme)} (streken).`,
          ` ${kr(x.behovLav)} hvis salget blir 20 % lavere (lys del).`] }));
    }
  }
  if (!avstaar && R.grense) {
    const g = R.grense;
    const nvg = g.nvNegativUnder, rg = g.overRammenUnder, pl = g.pakkeLav;
    if (nvg.status === "grense") {
      const topp = Math.max(1.2, faktor * 1.1);
      fliser.push(maaler({ tittel: "Salget kan falle til", stort: pst1(nvg.verdi), farge: fl, minus: nvg.verdi > faktor,
        fyll: faktor / topp, sone: [0, nvg.verdi / topp], strek: rg.status === "grense" && ramme != null ? rg.verdi / topp : null,
        under: [`av salget i 2026 før sesongen gir tap (rødt). Nå: ${pst(faktor)}.`,
          rg.status === "grense" && ramme != null ? ` Pengene strekker ikke til under ${pst1(rg.verdi)} (streken).` : ""] }));
    }
    if (pl?.status === "grense") {
      const topp = Math.max(pl.verdi, s.pakke) * 1.15;
      fliser.push(maaler({ tittel: "Pakkeprisen må holde seg under", stort: kr(pl.verdi), farge: fl, minus: s.pakke > pl.verdi,
        fyll: s.pakke / topp, strek: pl.verdi / topp, sone: [pl.verdi / topp, 1],
        under: `så holder ${v.navn} rammen også om salget blir 20 % lavere. Nå: ${kr(s.pakke)} per konsert.` }));
    }
  } else if (avstaar && R.snu.ramme?.status === "grense") {
    fliser.push(maaler({ tittel: "Startfinansiering som snur rådet", stort: kr(R.snu.ramme.verdi), farge: R.snu.ramme.til?.farge,
      under: `Da blir ${navnMedKort(R.snu.ramme.til)} rådet. Rammen nå er ${kr(ramme)}.` }));
  }
  if (fliser.length) main.append(h("section", { class: "maalere", "aria-label": "Nøkkeltall for rådet" }, ...fliser));

  /* 4 Kontoen måned for måned, og alle valgene ved siden av */
  const flate = h("div", { class: "oversikt" });
  if (x) {
    const figur = svg("Kontoen ved slutten av hver måned");
    const serier = [{ navn: x.kort ?? x.navn, farge: x.farge ?? "graa", verdier: x.saldo ?? [], bred: true }];
    const annen = hoyest && hoyest.id !== x.id && hoyest.saldo ? hoyest : null;
    if (annen) serier.push({ navn: annen.kort ?? annen.navn, farge: annen.farge ?? "graa", verdier: annen.saldo });
    flate.append(h("div", { class: "figur raad-figur" }, h("h3", {}, "Kontoen ved slutten av hver måned"),
      h("div", { class: "forklaring" }, ...serier.map(sr => h("span", { style: `--c: var(--${sr.farge})` }, sr.navn === serier[0].navn ? x.navn : `${annen.navn}, gir mest`))),
      figur,
      h("p", { class: "liten svak" }, `Det laveste punktet er det dere må ha klart: ${kr(x.behov)} ${mnd(x.bunnTid)}. Den stiplede streken er rammen.`)));
    tegnSaldo(figur, serier, (x.saldo ?? []).map((_, t) => MAANEDER[t] ?? `M${t}`), ramme);
  }
  const radFor = a => {
    const sal = a.type === "sal" ? salAv(a.id) : null;
    const linjer = [];
    if (ramme != null) {
      if (!a.holderNaa) linjer.push(h("span", { class: "minus" }, `Trenger ${kr(a.behov - ramme)} mer enn rammen.`));
      else if (!a.holderLav) linjer.push(h("span", {}, `Holder rammen nå, men ikke hvis salget blir 20 % lavere (trenger da ${kr(a.behovLav)}).`));
      else linjer.push(h("span", { class: "pluss" }, "Holder rammen, også hvis salget blir 20 % lavere."));
    }
    if (a.leieFoerStart > 0) linjer.push(h("span", {}, `${kr(a.leieFoerStart)} i leie forfaller før første konsert.`));
    if (a.fulleKonserter) linjer.push(h("span", {}, `Full på ${a.fulleKonserter} ${a.fulleKonserter === 1 ? "konsert" : "konserter"}, ${tall(a.tapteBilletter)} billetter går tapt.`));
    if (a.nvLav < 0) linjer.push(h("span", {}, "Taper penger hvis salget blir 20 % lavere."));
    return h("li", { class: `valg-rad${a.id === v.id ? " valgt" : ""}`, style: `--c: var(--${a.farge ?? "graa"})` },
      h("div", { class: "valg-navn" }, sal ? mini(sal) : h("span", { class: "prikk" }), h("span", {}, sal ? salTittel(sal) : a.navn),
        a.type === "egen" ? h("span", { class: "merke varsel" }, "utenfor casen") : null,
        a.id === v.id ? h("span", { class: "merke raad-merke" }, "vårt råd") : null),
      h("div", { class: "valg-tall" },
        h("span", {}, h("b", { class: `tall${nvVist(a) < 0 ? " minus" : ""}` }, kr(nvVist(a))), h("small", {}, a.laan > 0 ? "verdi etter rente" : "verdi")),
        h("span", {}, h("b", { class: `tall${ramme != null && a.behov > ramme ? " minus" : ""}` }, kr(a.behov)), h("small", {}, "må ha klart"))),
      sal ? h("p", { class: "valg-leie" }, leieType(sal)) : null,
      h("p", { class: "valg-linjer" }, ...linjer.flatMap((l, i) => (i ? [" ", l] : [l]))));
  };
  flate.append(h("div", { class: "valgliste" },
    h("h3", {}, avstaar ? "Hvorfor ingen av salene" : `Hvorfor ${v.type === "sal" ? v.navn : "egen plan"}`),
    h("ol", {}, ...alt.map(radFor),
      h("li", { class: `valg-rad avstaa${avstaar ? " valgt" : ""}`, style: "--c: var(--graa)" },
        h("div", { class: "valg-navn" }, h("span", { class: "prikk" }), h("span", {}, "Avstå"), avstaar ? h("span", { class: "merke raad-merke" }, "vårt råd") : null),
        h("div", { class: "valg-tall" }, h("span", {}, h("b", { class: "tall" }, kr(0)), h("small", {}, "verdi"))),
        h("p", { class: "valg-linjer" }, "Ingen risiko, ingen konserter. Planleggingen er betalt uansett.")))));
  main.append(flate);

  /* 5 Mer om rådet: utfellbart, så hjemskjermen holder seg kort */
  const mer = h("div", { class: "trekk-liste" });

  // Hva tallene betyr: verdien og «må ha klart» uten fagord
  if (x) {
    const T = (x.saldo?.length ?? 1) - 1;
    const forklarKort = (tittel2, stort, etikett, fagord, ...tekst) => h("div", { class: "forklar-kort" },
      h("h3", {}, tittel2), h("div", { class: `stor tall ${stort < 0 ? "minus" : ""}` }, kr(stort)), h("div", { class: "stor-etikett" }, etikett),
      ...tekst.map(t => h("p", {}, t)), h("p", { class: "liten svak" }, fagord));
    mer.append(trekk("tall", "Hva tallene betyr", "Hva verdien og «må ha klart» betyr",
      h("div", { class: "forklar-rad" },
        forklarKort("Hva sesongen er verdt", x.nv, `${x.navn}, i dagens kroner`, "I Resultater og arbeidsboka heter dette nåverdi.",
          `Alt som kommer inn minus alt som går ut, fra nå til det siste oppgjøret ${mnd(T)}. For ${x.navn} er det ${kr(x.netto)} mer inn enn ut.`,
          `En krone som kommer i juli er litt mindre verdt enn en krone i dag, fordi kronen i dag kunne stått i banken og gitt ${pst(s.rente ?? 0)} i året. Regnet om til dagens kroner er sesongen verdt ${kr(x.nv)}.`,
          "Er tallet under null, taper Sceneskift penger på sesongen. Da er det bedre å la være."),
        forklarKort("Hvor mye dere må ha klart", x.behov, `${x.navn}, det laveste kontoen kommer`, "I Resultater og arbeidsboka heter dette finansieringsbehov.",
          "Dere betaler før billettpengene kommer. Halve pakken går ut måneden før konserten, mens billettselskapet betaler måneden etter. Derfor går kontoen i minus i starten av våren.",
          `Det laveste punktet er det dere må ha klart: ${kr(x.behov)} ${mnd(x.bunnTid)}.${ramme != null ? ` Rammen er ${kr(ramme)}.` : ""}`,
          "Tallene gjelder ved slutten av hver måned. Inne i måneden kan kontoen ligge lavere, så ha en buffer."))));
  }

  // Når snur rådet
  if (!avstaar && R.grense) {
    const g = R.grense;
    const snuKort = (stort, tittel2, tekst, minus) => h("div", { class: "kort snu-kort", style: `--c: var(--${v.farge ?? "graa"})` },
      h("h3", {}, tittel2), h("div", { class: `stor ${minus ? "minus" : ""}` }, stort), h("p", { class: "liten" }, tekst));
    const kortene = [];
    const nvg = g.nvNegativUnder;
    if (nvg.status === "grense") kortene.push(snuKort(pst1(nvg.verdi), "Salget der sesongen gir tap",
      nvg.billetter >= 0 ? `Selger dere mindre enn dette av salget i 2026, taper ${v.navn} penger. Det er ${tall(nvg.billetter)} færre billetter enn ${faktor === 1 ? "i 2026" : "nå"}, over hele våren.`
                         : `Salget nå er allerede under grensen. ${v.navn} taper penger.`, nvg.billetter < 0));
    const rg = g.overRammenUnder;
    if (ramme != null && rg.status === "grense") kortene.push(snuKort(pst1(rg.verdi), "Salget der pengene ikke strekker til",
      `Under dette trenger ${v.navn} mer enn ${kr(ramme)}. Det er ${tall(Math.max(0, rg.billetter))} færre billetter enn ${faktor === 1 ? "i 2026" : "nå"}.`));
    const pl = g.pakkeLav;
    if (pl?.status === "grense") kortene.push(snuKort(kr(pl.verdi), "Pakkeprisen der rammen ryker",
      `Hvis salget blir 20 % lavere, holder ${v.navn} rammen bare med pakke under dette.${g.pakkeOverRammen.status === "grense" ? ` Med salget nå er grensen ${kr(g.pakkeOverRammen.verdi)}.` : ""}`, pl.verdi < s.pakke));
    if (R.snu.ramme?.status === "grense") kortene.push(snuKort(kr(R.snu.ramme.verdi), "Startfinansieringen som gir et annet råd",
      `Kan dere skaffe så mye, blir ${navnMedKort(R.snu.ramme.til)} rådet. Den gir mer, og holder da rammen også om salget blir 20 % lavere.`));
    mer.append(trekk("snu", "Når snur rådet", R.snu.ramme?.status === "grense" ? `Blant annet med ${kr(R.snu.ramme.verdi)} i startfinansiering` : "Grensene for salget og pakkeprisen",
      h("p", { class: "ingress" }, `Det er salget og pakkeprisen som avgjør. Grensene under gjelder ${v.navn}, med de andre forutsetningene som nå. Salget er målt mot salget i 2026, konsert for konsert.`),
      h("div", { class: "kort-rad" }, ...kortene),
      h("p", { style: "margin-top: 12px" }, h("button", { type: "button", class: "stille", onclick: () => gaaTil("resultater") }, "Grensene for alle salene og alle scenarioene står i Resultater"))));
  }

  // Artisten bestemmer salen (praksisvinkelen)
  const bb = besteBlanding(s, d.saler, d.program);
  const lokaler = [...new Set(d.program.map(k => k.i2026?.lokale).filter(Boolean))];
  let i2026 = "";
  if (lokaler.length === 2) {
    const [l1, l2] = lokaler.map(l => ({ navn: l, ks: d.program.filter(k => k.i2026?.lokale === l && k.salg2026 != null) }));
    const maks = l => Math.max(...l.ks.map(k => k.salg2026)), min = l => Math.min(...l.ks.map(k => k.salg2026));
    const [liten, stor] = maks(l1) < min(l2) ? [l1, l2] : maks(l2) < min(l1) ? [l2, l1] : [null, null];
    const ord = n => ["null", "én", "to", "tre", "fire", "fem", "seks", "sju", "åtte", "ni", "ti", "elleve", "tolv"][n] ?? String(n);
    if (liten) i2026 = ` I 2026 gikk de ${ord(liten.ks.length)} minste konsertene i ${liten.navn} og de ${ord(stor.ks.length)} største i ${stor.navn}.`;
  }
  const artist = [h("p", { class: "ingress" }, `I casen går alle konsertene i samme sal, og Maja regner med samme salg som i fjor uansett sal. I praksis er det artisten dere booker, og hva dere booker dem til, som avgjør hvor mange som kjøper billett. En solist på en sittende låtskriverkveld og et band på en stående klubbkveld trenger ikke samme rom. Salget avgjør så hvilken sal som lønner seg.${i2026}`)];
  if (bb) {
    const ref = v.type === "sal" ? v : alt.filter(a => a.type === "sal" && a.holderNaa).reduce((a, b) => (!a || b.nv > a.nv ? b : a), null);
    const perSal = [...new Set(bb.valg.map(y => y.salId))].map(id => ({ sal: salAv(id), ks: d.program.filter((k, i) => bb.valg[i].salId === id) }));
    // Når fast leie per konsert slår leie som følger salget: der leien i den ene salen blir lik den faste i den andre
    let skille = null;
    const fastSal = perSal.map(p => p.sal).find(sl => sl?.leie?.length === 1 && sl.leie[0].type === "perKonsert");
    const andelSal = perSal.map(p => p.sal).find(sl => sl?.leie?.length === 1 && sl.leie[0].type === "andel");
    if (fastSal && andelSal) {
      const F = fastSal.leie[0].belop, a = andelSal.leie[0], netto = s.billettpris - s.gebyr;
      if ((a.minimum ?? 0) < F && a.andel > 0) skille = `Fast leie i ${fastSal.navn} (${kr(F)}) er billigere enn ${pst(a.andel)} av oppgjøret i ${andelSal.navn} når en konsert selger mer enn ${tall(Math.floor(F / (a.andel * netto)))} billetter. Men ${fastSal.navn} har bare ${tall(Math.max(kapasitet(fastSal, "staa") ?? 0, kapasitet(fastSal, "sitte") ?? 0))} plasser, så den passer for konsertene i midten.`;
    }
    const liste = a => (a.length > 1 ? `${a.slice(0, -1).join(", ")} og ${a[a.length - 1]}` : a.join(""));
    artist.push(
      h("div", { class: "blanding" }, ...d.program.map((k, i) => { const sl = salAv(bb.valg[i].salId); return h("div", { class: "blanding-konsert", style: `--c: var(--${fargeFor(sl)})`, title: `${k.artist}: ${tall((k.forventetSalg ?? 0) * faktor)} forventet` },
        h("span", { class: "blanding-nr" }, String(k.nr)), h("span", { class: "blanding-sal" }, sl?.kort ?? sl?.navn), h("span", { class: "blanding-artist" }, k.artist),
        h("span", { class: "blanding-salg tall" }, `${tall((k.forventetSalg ?? 0) * faktor)} solgt`)); })),
      h("p", { class: "blanding-tekst" }, ...perSal.map((p, j) => [j ? " " : "", h("b", {}, p.sal?.navn), ` passer best for konsert ${liste(p.ks.map(k => k.nr))}.`]), skille ? ` ${skille}` : ""),
      h("p", { class: "blanding-tekst" }, `Den beste blandingen gir `, h("b", { class: "tall" }, kr(bb.nv)), ` i verdi og trenger `, h("b", { class: "tall" }, kr(bb.behov)),
        ref ? [`, mot `, h("b", { class: "tall" }, kr(ref.nv)), ` og `, h("b", { class: "tall" }, kr(ref.behov)), ` for alt i ${ref.navn}.`] : ".",
        bb.holderRammen ? "" : " Den holder ikke rammen."),
      h("p", { class: "varsel", style: "margin-top: 12px" }, h("span", { class: "merke varsel" }, "utenfor casen"), " Det krever at utleierne godtar enkeltkonserter. Casen sier at avtalene gjelder hele programmet, så dette er noe Maja kan spørre om, ikke et tilbud som finnes. Programmet viser forslaget per konsert, og knappen «Beste blanding» legger det inn."));
  }
  mer.append(trekk("artist", "Artisten bestemmer salen", bb ? `Beste blanding gir ${kr(bb.nv)} i verdi` : "Praksisvinkelen", ...artist));

  // Der vi går utenfor casen
  const tallInput = (felt, opt = {}) => h("input", { type: "number", min: 0, step: opt.step ?? 10, value: opt.pst ? Math.round((s[felt] ?? 0) * 1000) / 10 : (s[felt] ?? 0), "aria-label": opt.navn,
    onchange: e => { const verdi = Math.max(0, Number(e.target.value) || 0); s[felt] = opt.pst ? verdi / 100 : verdi; oppdater(); } });
  const nullKnapp = (...felt) => (felt.some(f => s[f]) ? h("button", { type: "button", class: "stille liten", onclick: () => { for (const f of felt) s[f] = 0; oppdater(); } }, "tilbake til 0") : null);
  const merkeHvis = b => (b ? h("span", { class: "merke varsel" }, "utenfor casen") : null);
  const rader = [];
  // Bar
  const barTekst = [];
  if (!avstaar) barTekst.push(`Hver 10 kr per gjest til Sceneskift gir ${v.navn} ${kr(R.barPer10)} mer i verdi.`);
  if (R.snu.bar.status === "grense") barTekst.push(`Fra ${kr(R.snu.bar.verdi)} mer per gjest blir ${navnMedKort(R.snu.bar.til)} rådet.`);
  else {
    barTekst.push("Ingen barinntekt snur rådet.");
    if (hoyest && hoyest.id !== v.id && ramme != null && hoyest.saldo && -hoyest.saldo[1] > ramme) barTekst.push(`${hoyest.navn} er over rammen allerede i januar, før det første oppgjøret kommer.`);
  }
  rader.push(["Barinntekt", `${kr(0)}`, h("div", { class: "utenfor-felt" },
    h("label", {}, tallInput("barPerGjest", { navn: "Bar: omsetning per gjest" }), " kr per gjest"),
    h("label", {}, tallInput("barAndel", { navn: "Bar: Sceneskifts andel", pst: true, step: 5 }), " % til Sceneskift"),
    merkeHvis(barTilSceneskift(s)), nullKnapp("barPerGjest", "barAndel")), barTekst.join(" ")]);
  // Uforutsett
  const u = R.snu.uforutsett;
  rader.push(["Uforutsette kostnader", `${kr(0)}`, h("div", { class: "utenfor-felt" },
    h("label", {}, tallInput("uforutsett", { navn: "Uforutsette kostnader per konsert", step: 500 }), " kr per konsert"), merkeHvis(s.uforutsett), nullKnapp("uforutsett")),
    `Rigg & Ro bærer det pakken dekker. Dette er det som faller utenfor, for eksempel skade eller ekstra vakthold.${u.status === "grense" ? ` ${avstaar ? "Rådet" : v.navn} tåler ${kr(Math.floor(u.verdi))} mer per konsert før rådet blir ${navnMedKort(u.til)}.` : ""}`]);
  // Ekstra markedsføring (Petter, nr 5 i tilbakemeldingene): høy etterspørsel kommer sjelden uten tiltak
  const mfDiff = (() => {
    if (avstaar) return null;
    const hd = handlinger(s, d.saler, d.program).find(a => a.id === v.id);
    if (!hd) return null;
    const med = hd.hent({ ...s, markedsforing: (s.markedsforing ?? 0) + 10000 });
    return nvVist(hd.hent(s)) - nvVist(med);
  })();
  rader.push(["Ekstra markedsføring", `${kr(0)}`, h("div", { class: "utenfor-felt" },
    h("label", {}, tallInput("markedsforing", { navn: "Ekstra markedsføring for sesongen", step: 1000 }), " kr for sesongen"), merkeHvis(s.markedsforing), nullKnapp("markedsforing")),
    `Høy etterspørsel kommer sjelden av seg selv. Beløpet fordeles likt på konsertene og betales måneden før.${mfDiff != null ? ` Hver 10 000 kr gir ${v.navn} ${kr(mfDiff)} lavere verdi.` : ""} Bruk det sammen med scenarioet Høy etterspørsel.`]);
  // Pakke per konsert
  const medAvvik = d.program.filter(k => k.pakkeAvvik).length;
  rader.push(["Pakkepris per konsert", `${kr(s.pakke)} på alle`, h("div", { class: "utenfor-felt" }, medAvvik ? [`${medAvvik} ${medAvvik === 1 ? "konsert har" : "konserter har"} egen pris `, merkeHvis(true)] : "Lik på alle",
    h("button", { type: "button", class: "stille liten", onclick: () => gaaTil("program") }, "endre i Programmet")),
    "Artisthonoraret varierer i virkeligheten. Et større navn koster mer og selger mer, og kan flytte konserten til en annen sal."]);
  // Blanding
  rader.push(["Sal per konsert", "Én sal for hele programmet", h("div", { class: "utenfor-felt" }, res.blandet ? [`Egen plan blander ${res.egen.salerIBruk.map(id => salAv(id)?.kort ?? id).join(" og ")} `, merkeHvis(true)] : "Én sal"),
    bb ? `Beste blanding gir ${kr(bb.nv)} i verdi. Krever at utleierne godtar enkeltkonserter.` : ""]);
  // Lokaleeffekt
  const endretLokal = d.saler.filter(sl => (sl.lokaleeffekt ?? 1) !== 1);
  const mot = v.type === "sal" ? alt.filter(a => a.type === "sal" && a.id !== v.id && a.holderNaa).reduce((a, b) => (!a || b.nv > a.nv ? b : a), null) : null;
  const lg = mot ? lokaleeffektGrense(s, d.saler, d.program, v.id, mot.id) : null;
  rader.push(["Lokalet påvirker salget", "100 %, Majas premiss", h("div", { class: "utenfor-felt" }, endretLokal.length ? [endretLokal.map(sl => `${sl.kort ?? sl.navn} ${pst(sl.lokaleeffekt)}`).join(", "), " ", merkeHvis(true)] : "100 % i alle",
    h("button", { type: "button", class: "stille liten", onclick: () => gaaTil("saler") }, "endre under Saler")),
    lg?.status === "grense" ? `Et kjent eller stort lokale kan selge bedre. ${v.navn} er bedre enn ${mot.navn} så lenge den får minst ${pst1(lg.verdi)} av publikummet, når ${mot.navn} får alt.` : "Et kjent eller stort lokale kan selge bedre. Gruppas følsomhet, ikke en del av casen."]);
  // Sitteplasser
  const antatt = d.saler.filter(sl => sl.sitteAntatt && kapasitet(sl, "sitte") !== null);
  if (antatt.length) rader.push(["Sitteplasser", "Ikke oppgitt i tilbudene", h("div", { class: "utenfor-felt" }, `${antatt.map(sl => `${sl.kort ?? sl.navn} ${kapasitet(sl, "sitte")}`).join(", ")}, antatt`),
    "Betyr bare noe for konserter som settes sittende i Programmet."]);
  // Lån over rammen
  if (ramme != null && hoyest && !hoyest.holderNaa && hoyest.type === "sal") {
    const rh = res.altI[hoyest.id];
    rader.push(["Lån ut over rammen", "Ikke med, rammen er et krav", h("div", { class: "utenfor-felt" }, `${s.laanType === "fast" ? "Fast lån" : "Kassekreditt"}, ${pst(s.laanRente ?? 0)} rente per år, vår antakelse`,
      h("button", { type: "button", class: "stille liten", onclick: () => gaaTil("resultater", "laan") }, "lånemodulen i Resultater")),
      `${hoyest.navn} kan gjennomføres med et lån på ${kr(rh.laan)} (${kr(rh.nvEtterRente)} i verdi etter rente) i ${rh.maanederMedLaan} ${rh.maanederMedLaan === 1 ? "måned" : "måneder"}, ca. ${kr(rh.rentekostnad)} i rente. Lånet gjør ${hoyest.kort ?? hoyest.navn} mulig, ikke tryggere: om salget blir 20 % lavere, må det bli ${kr(Math.max(0, hoyest.behovLav - ramme))}.`]);
  }
  // Inne i måneden
  rader.push(["Når i måneden pengene går", "Ved månedsslutt", h("div", { class: "utenfor-felt" }, "Ved månedsslutt"),
    "Rigg & Ro vil ha første halvdel den 1. i måneden før konserten, og Flytbillett betaler innen den 20. i måneden etter. Inne i måneden kan kontoen ligge lavere enn tallene her. Derfor rådet om buffer."]);
  const iBruk = [barTilSceneskift(s), s.uforutsett, s.markedsforing, medAvvik, res.blandet, endretLokal.length].filter(Boolean).length;
  mer.append(trekk("utenfor", "Der vi går utenfor casen", iBruk ? `${iBruk} tillegg i bruk nå` : "Alle tilleggene står på null, som i casen",
    h("p", { class: "ingress" }, "Oppgaveteksten sier: «Utover postene i tabellen og lokaleleien er det ingen andre inntekter eller kostnader.» I virkeligheten er det sjelden slik, og å utelate noe er å anta at det er null. Derfor står tilleggene på null, så tallene over er casens, og vi viser hva som skjer om de ikke er det."),
    h("div", { class: "tabellramme" }, h("table", { class: "utenfor" },
      h("thead", {}, h("tr", {}, h("th", {}, "Tillegg"), h("th", {}, "I casen"), h("th", {}, "Hos oss nå"), h("th", {}, "Hva det gjør med rådet"))),
      h("tbody", {}, ...rader.map(([t, c, n, e]) => h("tr", {}, h("td", { class: "utenfor-navn" }, t), h("td", { class: "svak" }, c), h("td", {}, n), h("td", { class: "liten" }, e))))))));

  main.append(h("section", { class: "seksjon mer-om" }, h("h2", {}, "Mer om rådet"), mer));
}

/* ---------- Program ---------- */
// Merknaden etter «Beste blanding» gjelder så lenge programmet er som da knappen ble trykket
const blandingNokkel = () => JSON.stringify(state.data.program.map(k => [k.salId, k.oppsett, k.forventetSalg]));
function merknadBesteBlanding(r) {
  if (!state.besteBlanding || state.besteBlanding !== blandingNokkel()) return null;
  const ramme = state.data.sesong.ramme;
  const over = ramme != null && r.behov > ramme;
  if (over && r.nv <= 0) return `Ingen blanding holder rammen med dette salget. Beste blanding går ${kr(r.behov - ramme)} over rammen og har negativ nåverdi (${kr(r.nv)}). Avstå er bedre.`;
  if (over) return `Ingen blanding holder rammen med dette salget. Beste blanding har høyest nåverdi, men går ${kr(r.behov - ramme)} over rammen.`;
  if (r.nv <= 0) return `Beste blanding holder rammen, men har negativ nåverdi (${kr(r.nv)}). Avstå er bedre.`;
  return null;
}

function renderProgram(main, res) {
  const d = state.data;
  const perKonsert = salerPerKonsert();
  const helSesong = d.saler.filter(s => s.kunHelSesong);
  const sek = h("section", { class: "seksjon" },
    h("h2", {}, "Programmet, konsert for konsert"),
    fork("p", "ingress", `Endre artist, forventet salg, oppsett og sal. Forventet salg starter på salget til tilsvarende konsert i 2026, som er Majas premiss. Bidraget er billettinntekt etter gebyr og publikumsutgift, minus pakken og leien for salen, uten diskontering.${helSesong.length ? ` ${helSesong.map(salTittel).join(" og ")} har fast sesongleie og kan bare velges som hel sesong, se stripa øverst.` : ""}`));

  sek.append(h("div", { class: "verktoylinje" },
    h("button", { type: "button", onclick: () => { for (const k of d.program) { const f = forslagForKonsert(d.sesong, d.saler, k); if (f) { k.salId = f.salId; k.oppsett = f.oppsett; } } oppdater(); } }, "Bruk forslagene på alle"),
    h("button", { type: "button", title: "Den kombinasjonen av saler per konsert som gir høyest nåverdi og holder rammen", onclick: () => { const b = besteBlanding(d.sesong, d.saler, d.program); if (b) { d.program.forEach((k, i) => { k.salId = b.valg[i].salId; k.oppsett = b.valg[i].oppsett; }); state.besteBlanding = blandingNokkel(); oppdater(); } } }, "Beste blanding"),
    h("button", { type: "button", class: "stille", onclick: () => { for (const k of d.program) k.forventetSalg = k.salg2026 ?? k.forventetSalg; oppdater(); } }, "Salg som i 2026"),
    ...perKonsert.map(s => h("button", { type: "button", class: "stille", onclick: () => { for (const k of d.program) { k.salId = s.id; if (kapasitet(s, k.oppsett) === null) k.oppsett = k.oppsett === "sitte" ? "staa" : "sitte"; } oppdater(); } }, `Alle i ${s.kort ?? s.navn}`)),
    h("span", { class: "mellomrom" }),
    h("button", { type: "button", onclick: () => leggTilKonsert() }, "Legg til konsert")));

  const merknad = merknadBesteBlanding(res.egen);
  if (merknad) sek.append(h("p", { class: "varsel", style: "margin-top: 14px" }, merknad));

  const hode = h("tr", {},
    h("th", {}, "Nr"), h("th", {}, "Dato"), h("th", {}, "Artist"), h("th", {}, "Sjanger"), h("th", { class: "hoyre" }, "Forventet salg"),
    h("th", {}, "Oppsett"), h("th", {}, "Sal"), h("th", {}, "Forslag"), h("th", { class: "hoyre" }, "Pakke"), h("th", { class: "hoyre" }, "Billetter"), h("th", { class: "hoyre" }, "Leie"), h("th", { class: "hoyre" }, "Bidrag"), h("th", {}));
  const rader = d.program.map((k, i) => radForKonsert(k, i, res.egen.perKonsert[i], perKonsert));
  const sumBidrag = res.egen.perKonsert.reduce((a, k) => a + k.bidrag, 0);
  const fot = h("tfoot", {},
    h("tr", {}, h("td", { colspan: 9 }, "Sum bidrag fra konsertene"), h("td", { class: "hoyre tall" }, tall(res.egen.perKonsert.reduce((a, k) => a + k.n, 0))), h("td", { class: "hoyre tall" }, kr(res.egen.perKonsert.reduce((a, k) => a + k.leie, 0))), h("td", { class: `hoyre tall ${sumBidrag < 0 ? "minus" : ""}` }, kr(sumBidrag)), h("td")),
    res.egen.fastLeie ? h("tr", {}, h("td", { colspan: 11 }, `Faste leiebetalinger for sesongen (${res.egen.salerIBruk.map(id => salAv(id)?.navn).join(", ")})`), h("td", { class: "hoyre tall minus" }, kr(-res.egen.fastLeie)), h("td")) : null,
    h("tr", {}, h("td", { colspan: 11 }, "Samlet netto for sesongen, udiskontert"), h("td", { class: `hoyre tall ${res.egen.netto < 0 ? "minus" : ""}` }, kr(res.egen.netto)), h("td")));
  sek.append(h("div", { class: "tabellramme" }, h("table", { class: "program" }, h("thead", {}, hode), h("tbody", {}, rader.flat()), fot)));

  const kappet = res.egen.perKonsert.filter(k => k.kappet);
  if (kappet.length) sek.append(h("p", { class: "varsel", style: "margin-top: 14px" }, `${kappet.length} ${kappet.length === 1 ? "konsert" : "konserter"} selger mindre enn forventet fordi salen er full: ${kappet.map(k => `nr ${k.nr} (${tall(k.onsket)} forventet, ${k.kap} plasser)`).join(", ")}. Tapte billetter: ${tall(kappet.reduce((a, k) => a + k.onsket - k.n, 0))}.`));
  main.append(sek);
}

function radForKonsert(k, i, r, perKonsert) {
  const d = state.data;
  const sal = salAv(k.salId);
  const f = forslagForKonsert(d.sesong, d.saler, k);
  const forslagLik = f && f.salId === k.salId && f.oppsett === k.oppsett;
  const endre = (felt, verdi) => { k[felt] = verdi; oppdater(); };
  const oppsettKnapp = (o, tekst) => h("button", { type: "button", "aria-pressed": String(k.oppsett === o), disabled: sal && kapasitet(sal, o) === null, title: sal && kapasitet(sal, o) === null ? `${sal.navn} har ikke ${tekst.toLowerCase()} oppsett` : `${tekst}: ${kapasitet(sal, o) ?? "?"} plasser`, onclick: () => endre("oppsett", o) }, tekst);
  const avvik = k.salg2026 != null && k.forventetSalg !== k.salg2026;
  const fSal = f ? salAv(f.salId) : null;
  const forklaringsrad = fork("tr", "forklaringsrad", h("td", { colspan: 13 },
    k.i2026 ? h("span", {}, `I 2026: ${k.i2026.navn} i ${k.i2026.lokale} (${k.i2026.kapasitet} plasser i alt), ${tall(k.salg2026)} betalte billetter. `) : null,
    f ? h("span", {}, `Forslag: ${f.hvorfor}`) : null,
    k.pakkeAvvik ? h("span", {}, `Pakken er ${kr(Math.abs(k.pakkeAvvik))} ${k.pakkeAvvik > 0 ? "dyrere" : "billigere"} enn for resten av sesongen (utenfor casen).`) : null));
  return [h("tr", {},
    h("td", { class: "nr" }, String(k.nr)),
    h("td", { class: "dato" }, h("input", { type: "text", value: k.dato ?? "", size: 5, "aria-label": "Dato", onchange: e => endre("dato", e.target.value) })),
    h("td", { class: "artist" }, h("input", { type: "text", value: k.artist ?? "", "aria-label": "Artist", onchange: e => endre("artist", e.target.value) }),
      k.besetning ? fork("div", "liten svak", k.besetning) : null),
    h("td", { class: "sjanger" }, h("select", { "aria-label": "Sjanger", onchange: e => endre("sjanger", e.target.value) },
      ...[...new Set([...SJANGRE, k.sjanger].filter(Boolean))].map(s => h("option", { value: s, selected: s === k.sjanger }, s)))),
    h("td", { class: "salg hoyre" },
      h("input", { type: "number", min: 0, step: 10, value: k.forventetSalg, "aria-label": "Forventet salg", onchange: e => endre("forventetSalg", Math.max(0, Number(e.target.value) || 0)) }),
      avvik ? h("div", { class: "liten" }, h("button", { type: "button", class: "stille liten", onclick: () => endre("forventetSalg", k.salg2026) }, `2026: ${tall(k.salg2026)}`)) : null),
    h("td", {}, h("div", { class: "oppsett-valg" }, oppsettKnapp("sitte", "Sitte"), oppsettKnapp("staa", "Stå"))),
    h("td", {}, h("div", { class: "salvalg", style: `--c: var(--${fargeFor(sal)})` }, mini(sal),
      h("select", { "aria-label": "Sal", onchange: e => { const s = salAv(e.target.value); k.salId = s.id; if (kapasitet(s, k.oppsett) === null) k.oppsett = k.oppsett === "sitte" ? "staa" : "sitte"; oppdater(); } },
        ...perKonsert.map(s => h("option", { value: s.id, selected: s.id === k.salId }, salTittel(s)))))),
    h("td", { class: "forslag" },
      f ? [
        forslagLik ? h("span", { class: "som-valgt", title: f.hvorfor }, "Som valgt")
                   : h("button", { type: "button", class: "forslag-knapp", title: f.hvorfor, onclick: () => { k.salId = f.salId; k.oppsett = f.oppsett; oppdater(); } }, `${fSal?.kort ?? fSal?.navn} ${f.oppsett === "sitte" ? "sittende" : "stående"}`),
      ] : h("span", { class: "som-valgt" }, "Ingen sal passer")),
    h("td", { class: "hoyre pakke" },
      h("input", { type: "number", min: 0, step: 1000, value: pakkeFor(d.sesong, k), "aria-label": "Pakkepris for konserten", title: "Pakken for denne konserten. I casen er den lik for alle (utenfor casen hvis den endres)",
                   onchange: e => endre("pakkeAvvik", Math.max(0, Number(e.target.value) || 0) - (d.sesong.pakke ?? 0)) }),
      k.pakkeAvvik ? h("div", { class: "liten" }, h("span", { class: "merke varsel" }, "utenfor casen"), " ", h("button", { type: "button", class: "stille liten", onclick: () => endre("pakkeAvvik", 0) }, "som resten")) : null),
    h("td", { class: "hoyre tall" }, tall(r.n), r.kappet ? h("div", {}, h("span", { class: "merke varsel" }, "fullt")) : null),
    h("td", { class: "hoyre tall leie" }, kr(r.leie), r.leieDeler?.some(x => x.minimumSlaarInn) ? h("div", {}, h("span", { class: "merke" }, "minimum")) : null),
    h("td", { class: `hoyre tall bidrag ${r.bidrag < 0 ? "minus" : ""}` }, kr(r.bidrag)),
    h("td", {}, h("button", { type: "button", class: "stille liten farlig", title: "Fjern konserten", onclick: () => { if (confirm(`Fjerne konsert ${k.nr} (${k.artist || "uten navn"})?`)) { d.program.splice(i, 1); oppdater(); } } }, "Fjern"))),
    forklaringsrad];
}

function leggTilKonsert() {
  const d = state.data;
  const sist = d.program[d.program.length - 1];
  const sal = salerPerKonsert()[0];
  d.program.push({ nr: Math.max(0, ...d.program.map(k => k.nr)) + 1, dato: "", artist: "", sjanger: "Pop", maaned: sist?.maaned ?? 1,
    salg2026: null, forventetSalg: 200, salId: sal?.id ?? null, oppsett: sal && kapasitet(sal, "staa") !== null ? "staa" : "sitte", notat: "" });
  oppdater();
}

/* ---------- Resultater ---------- */
function renderResultater(main, res) {
  const d = state.data;
  const s = d.sesong;

  // Gliderne bygges én gang og tegnes ikke på nytt mens du drar. Resten av fanen tegnes på nytt, throttlet.
  const innhold = h("div", { id: "res-innhold" });
  // «Hva snur rådet» ligger øverst og tegnes på nytt sammen med resten
  const raadBoks = h("div", { id: "res-raad" });
  let venter = false;
  const oppdaterInnhold = () => {
    lagre();
    if (venter) return;
    venter = true;
    requestAnimationFrame(() => { venter = false; const r = beregn(); renderStripe(r); tegnScenarioer(); raadBoks.replaceChildren(); fyllRaad(raadBoks); innhold.replaceChildren(); fyllResultater(innhold, r); });
  };
  // Scenariovelgeren tegnes på nytt når gliderne flyttes, så den viser «Egne verdier» når ingen stemmer
  const scenarioBoks = h("div", { class: "scenarioer" });
  const begrunnelse = h("p", { class: "scenario-begrunnelse" });
  const tegnScenarioer = () => {
    const aktiv = aktivtScenario(s);
    scenarioBoks.replaceChildren(...s.scenarioer.map(sc => h("button", { type: "button", class: `scenario${sc.oppside ? " oppside" : ""}`, "aria-pressed": String(sc === aktiv),
      onclick: () => { velgScenario(s, sc); render(); } },
      h("span", { class: "scenario-navn" }, sc.navn, sc.oppside ? h("span", { class: "merke" }, "oppside") : null),
      h("span", { class: "scenario-verdier tall" }, `${pst(sc.etterspoerselsfaktor)} salg, ${kr(sc.pakke)}`))),
      h("div", { class: `scenario egne${aktiv ? "" : " aktiv"}` },
        h("span", { class: "scenario-navn" }, "Egne verdier"),
        h("span", { class: "scenario-verdier tall" }, aktiv ? "flytt en glider" : `${pst(s.etterspoerselsfaktor)} salg, ${kr(s.pakke)}`)));
    begrunnelse.textContent = aktiv ? aktiv.begrunnelse : "Verdiene fra gliderne. Ingen av scenarioene i arbeidsboka stemmer akkurat med dem.";
  };
  tegnScenarioer();
  main.append(raadBoks);
  fyllRaad(raadBoks);
  main.append(h("section", { class: "seksjon" },
    h("h2", {}, "Scenario"),
    fork("p", "ingress", "Ett scenario om gangen, som i arbeidsboka. Scenarioet setter etterspørselen i forhold til 2026 og pakkeprisen per konsert. Alt på siden regnes på nytt. Nivåene er gruppas antakelser, ikke sannsynligheter, og Høy etterspørsel er en oppside som ikke inngår i beslutningsreglene."),
    scenarioBoks, begrunnelse));
  const glider = (navn, felt, min, max, steg, vis, basis) => {
    const inp = h("input", { type: "range", min, max, step: steg, value: s[felt], "aria-label": navn });
    const verdi = h("b", { class: "tall" });
    const basisKnapp = h("button", { type: "button", class: "stille liten", onclick: () => { s[felt] = basis; inp.value = basis; tegn(); oppdaterInnhold(); } }, "basis");
    const tegn = () => {
      verdi.replaceChildren(vis(s[felt]), s[felt] !== basis ? basisKnapp : "");
      inp.style.setProperty("--fyll", `${((s[felt] - min) / (max - min)) * 100}%`);
    };
    inp.addEventListener("input", e => { s[felt] = Number(e.target.value); tegn(); oppdaterInnhold(); });
    tegn();
    return h("div", { class: "glider" }, h("label", {}, h("span", {}, navn), verdi), inp, h("div", { class: "ende" }, h("span", {}, vis(min)), h("span", {}, vis(max))));
  };
  main.append(h("section", { class: "seksjon", id: "finjuster" },
    h("h2", {}, "Finjuster: hva om salget eller pakkeprisen blir noe annet?"),
    fork("p", "ingress", "Dra i gliderne for verdier mellom scenarioene. Alt på siden regnes på nytt. Basis er Majas premiss: samme salg som i 2026 og 60 000 kr per konsert."),
    h("div", { class: "glidere" },
      glider("Etterspørsel i forhold til 2026", "etterspoerselsfaktor", 0.5, 1.3, 0.01, pst, 1),
      glider("Pakkepris per konsert", "pakke", 48000, 78000, 500, kr, 60000))));
  main.append(innhold);
  fyllResultater(innhold, res);
}

/** Forklaring av grensetabellen med et eksempel fra tallene nå (nr 3 i tilbakemeldingene: grensene var uklare). */
function grenseForklaring(gr, s) {
  const pstEn = v => (Math.round(v * 1000) / 10).toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
  const eks = gr.find(g => g.nvNegativUnder.status === "grense" && g.nvNegativUnder.billetter > 0) ?? gr.find(g => g.nvNegativUnder.status === "grense");
  const navn = eks ? (eks.kort ? `alt i ${eks.kort}` : eks.navn.toLowerCase()) : null;
  return h("div", { class: "grense-forklaring" },
    h("p", {}, "Hver rad er en handling. Hver kolonne er en ting som kan gå galt. Tallet er punktet der det skjer: hvor lavt salget kan falle (i prosent av salget i 2026), eller hvor høy pakkeprisen kan bli, før handlingen gir tap eller trenger mer enn rammen. De andre forutsetningene holdes som nå."),
    eks ? h("p", {}, h("b", {}, "Les slik: "), `For ${navn} blir nåverdien negativ hvis salget faller under ${pstEn(eks.nvNegativUnder.verdi)} av salget i 2026. ${eks.nvNegativUnder.billetter >= 0 ? `Det er ${tall(eks.nvNegativUnder.billetter)} billetter færre enn nå, over hele sesongen.` : "Salget nå er allerede under grensen."} Stort tall langt unna dagens verdi betyr god margin. Rødt betyr at vi allerede er på feil side.`) : null,
    h("p", { class: "svak" }, "«Alltid» betyr at handlingen er på feil side uansett (for eksempel over rammen selv med fullt hus). «Aldri» betyr at grensen ikke finnes. I arbeidsboka er det samme regnet med datatabeller i arket Usikkerhet."));
}

/** Øverst i Resultater: de tre beslutningsreglene og grensene der rådet snur. Få og store tall. */
function fyllRaad(boks) {
  const d = state.data;
  const s = d.sesong;
  const sc = aktivtScenario(s);
  const regler = beslutningsregler(s, d.saler, d.program);
  const gr = grenser(s, d.saler, d.program);
  const pstEn = v => (Math.round(v * 1000) / 10).toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
  const handlingNavn = v => (v.type === "sal" ? (v.kort ? `${v.kort}: ${v.navn}` : v.navn) : v.navn);
  const chip = v => [h("span", { class: `valg-chip${v.type === "avstaa" ? " avstaa" : ""}`, style: `--c: var(--${v.farge ?? "graa"})` }, v.type === "sal" ? mini(salAv(v.id)) : h("span", { class: "prikk" }), handlingNavn(v)), v.type === "egen" ? h("span", { class: "merke varsel" }, "utenfor casen") : null];
  const regelRad = r => {
    const over = s.ramme != null && r.valg.behov > s.ramme;
    return h("div", { class: "regel" },
      h("div", { class: "regel-nr" }, `Regel ${r.nr}`),
      h("div", { class: "regel-tekst" }, h("b", {}, r.navn), h("span", { class: "svak" }, r.krav)),
      h("div", { class: "regel-valg" }, chip(r.valg),
        h("span", { class: "liten svak tall" }, r.valg.type === "avstaa" ? "ingen av salene tåler alle scenarioene" : `nåverdi ${kr(nvVist(r.valg))}${r.valg.laan > 0 ? " etter rente" : ""}, trenger ${kr(r.valg.behov)}${over ? ", over rammen" : ""}`)));
  };
  const naaTekst = `${pst(s.etterspoerselsfaktor ?? 1)} salg og ${kr(s.pakke)} per konsert${sc ? ` (${sc.navn})` : " (egne verdier)"}`;

  // Grensene som tabell: én rad per handling, tre grenser med stort tall og avstanden fra der vi er nå
  const celle = (g, slag) => {
    if (g.status !== "grense") {
      const tekst = { aldri: slag === "nv" ? "blir aldri negativ" : "holder rammen uansett", alltid: slag === "nv" ? "negativ selv med fullt hus" : slag === "pakke" ? "over rammen selv uten pakke" : "over rammen selv med fullt hus" }[g.status];
      return h("td", { class: "hoyre" }, h("div", { class: `grense-stor ${g.status === "alltid" ? "minus" : "svak"}` }, g.status === "alltid" ? "alltid" : "aldri"), h("div", { class: "liten svak" }, tekst));
    }
    const avstand = slag === "pakke" ? g.kroner : g.billetter;
    const under = avstand < 0;
    const enhet = slag === "pakke" ? "kr" : Math.abs(Math.round(avstand)) === 1 ? "billett" : "billetter";
    const margin = under ? `${tall(-avstand)} ${enhet} over grensen nå` : `${tall(avstand)} ${enhet} å gå på`;
    return h("td", { class: "hoyre" },
      h("div", { class: `grense-stor tall ${under ? "minus" : ""}` }, slag === "pakke" ? kr(g.verdi) : pstEn(g.verdi)),
      h("div", { class: `liten tall ${under ? "minus" : "svak"}` }, margin));
  };
  const tabell = h("div", { class: "tabellramme" }, h("table", { class: "grenser" },
    h("thead", {}, h("tr", {},
      h("th", {}, "Handling"),
      h("th", { class: "hoyre" }, "Nåverdien blir negativ når salget er under", h("div", { class: "liten svak tall" }, `med pakke ${kr(s.pakke)}`)),
      h("th", { class: "hoyre" }, "Behovet går over rammen når salget er under", h("div", { class: "liten svak tall" }, `med pakke ${kr(s.pakke)}`)),
      h("th", { class: "hoyre" }, "Behovet går over rammen når pakken er over", h("div", { class: "liten svak tall" }, `ved ${pst(s.etterspoerselsfaktor ?? 1)} salg`)))),
    h("tbody", {}, ...gr.map(g => h("tr", { style: `--c: var(--${g.farge ?? "graa"})` },
      h("td", { class: "handling" }, h("span", { class: "prikk" }), handlingNavn(g), g.type === "egen" ? h("span", { class: "merke varsel" }, "utenfor casen") : null),
      celle(g.nvNegativUnder, "nv"), celle(g.overRammenUnder, "behov"), celle(g.pakkeOverRammen, "pakke"))))));

  boks.append(h("section", { class: "seksjon raad" },
    h("h2", {}, "Hva snur rådet"),
    fork("p", "ingress", "Beslutningsreglene fra arbeidsboka og grensene der svaret snur. Regel 1 krever at rammen holder i alle scenarioene, regel 2 bare med verdiene som gjelder nå, og regel 3 ser bort fra rammen. Alle rangerer etter nåverdien nå. Avstå gir null og holder alltid rammen, så reglene velger avstå når resten gir tap. Grensene finnes med søk i motoren, med de andre forutsetningene som de er nå. Salget måles som andel av salget i 2026, og avstanden i billetter gjelder hele sesongen."),
    h("div", { class: "regler" }, ...regler.map(regelRad)),
    h("p", { class: "naa-linje svak" }, "Nå: ", h("b", { class: "tall" }, naaTekst), s.ramme != null ? [". Rammen er ", h("b", { class: "tall" }, kr(s.ramme))] : ". Ingen ramme satt", "."),
    h("h3", { class: "grenser-tittel" }, "Grensene: hvor langt kan det gå før svaret snur?"),
    grenseForklaring(gr, s),
    tabell));
}

function fyllResultater(innhold, res) {
  const d = state.data;
  const s = d.sesong;
  const ref = salAv(state.referanse) ?? d.saler[0];

  innhold.append(h("section", { class: "seksjon" },
    fork("p", "ingress", "Stripa øverst viser nåverdi med 4 % realrente per år, og det største beløpet Sceneskift ligger ute med underveis, målt ved månedsslutt. Avstå gir null i begge. Ligger behovet over rammen, vises lånet som trengs (det saldoen ligger under rammen, som en kassekreditt) og renten på det. Renten holdes utenfor nåverdien, slik casen krever, og vises som egen linje."),
    res.blandet ? h("p", { class: "varsel" }, `Egen plan bruker ${res.egen.salerIBruk.map(id => salAv(id)?.navn).join(" og ")}. Casen sier at avtalene gjelder hele programmet, så en blanding krever at utleierne godtar enkeltkonserter. Vis det som et alternativ Maja kan ta opp før signering, ikke som et tilbud som finnes.`) : null,
    lokaleeffektMerknad(), utvidelserMerknad()));

  innhold.append(konsekvenstabell(res));
  innhold.append(laanModul(res));

  const etiketter = res.egen.saldo.map((_, t) => MAANEDER[t] ?? `M${t}`);
  const serier = [
    ...d.saler.map(x => ({ navn: x.kort ?? x.navn, farge: fargeFor(x), verdier: padTil(res.altI[x.id].saldo, etiketter.length) })),
    { navn: "Egen plan", farge: "gronn", verdier: res.egen.saldo, bred: true },
  ];
  const saldoSvg = svg("Saldo per måned");
  const bidragSvg = svg("Bidrag per konsert");
  const refValg = h("select", { onchange: e => { state.referanse = e.target.value; render(); } }, ...d.saler.map(x => h("option", { value: x.id, selected: x.id === ref?.id }, `Alt i ${salTittel(x)}`)));
  innhold.append(h("section", { class: "seksjon" },
    h("div", { class: "figur-rad" },
      h("div", { class: "figur" }, h("h3", {}, "Saldo ved månedsslutt"), fork("p", "liten svak", "Bunnen på hver linje er det salen krever i startfinansiering."),
        h("div", { class: "forklaring" }, ...serier.map(x => h("span", { style: `--c: var(--${x.farge})` }, x.navn))), saldoSvg),
      h("div", { class: "figur" }, h("h3", {}, "Bidrag per konsert, egen plan mot ", refValg), fork("p", "liten svak", "Udiskontert. Faste sesongbetalinger er ikke fordelt på konsertene."),
        h("div", { class: "forklaring" }, h("span", { style: "--c: var(--gronn)" }, "Egen plan"), h("span", { style: `--c: var(--${fargeFor(ref)}); opacity: .7` }, `Alt i ${ref?.kort ?? ref?.navn}`)), bidragSvg))));
  tegnSaldo(saldoSvg, serier, etiketter, s.ramme);
  tegnBidrag(bidragSvg, [
    { navn: "Egen plan", farge: "gronn", verdier: res.egen.perKonsert.map(k => k.bidrag) },
    { navn: `Alt i ${ref?.kort}`, farge: fargeFor(ref), verdier: ref ? res.altI[ref.id].perKonsert.map(k => k.bidrag) : [] },
  ], d.program.map(k => `${k.nr}`));

  const L = res.egen.linjer;
  const rad = (navn, verdier, cls = "") => h("tr", { class: cls }, h("td", {}, navn), ...verdier.map(v => h("td", { class: `hoyre tall ${v < 0 ? "minus" : ""}` }, v === 0 ? h("span", { class: "svak" }, "0") : tall(v))));
  innhold.append(h("section", { class: "seksjon" },
    h("h2", {}, "Betalingene måned for måned, egen plan"),
    fork("p", "ingress", "Start er like før første konsertmåned og diskonteres ikke. Billettoppgjøret kommer måneden etter konserten, leie etter salens vilkår. Følg et tall herfra til stripa øverst."),
    h("div", { class: "tabellramme" }, h("table", { class: "kontantstrom" },
      h("thead", {}, h("tr", {}, h("th", {}, "Kroner"), ...etiketter.map(e => h("th", { class: "hoyre" }, e)))),
      h("tbody", {}, rad("Billettoppgjør", L.billetter), rad("Publikumsutgift", L.utgift), rad("Pakke", L.pakke), rad("Leie", L.leie),
        ...(L.bar.some(Boolean) ? [rad("Bar, Sceneskifts andel", L.bar)] : []), ...(L.uforutsett.some(Boolean) ? [rad("Uforutsette kostnader", L.uforutsett)] : []),
        ...(L.markedsforing?.some(Boolean) ? [rad("Ekstra markedsføring", L.markedsforing)] : []),
        rad("Sum i måneden", res.egen.cf), rad("Saldo", res.egen.saldo, "saldo"),
        ...(res.egen.laan > 0 ? [rad("Under rammen, lån", res.egen.trekk.map(x => -x)), rad("Rente på lånet", res.egen.renter.map(x => -x))] : []))))));
}

/** Merknad når en sal har lokaleeffekt ulik 100 %, så det ikke skjer i stillhet. */
function lokaleeffektMerknad() {
  const saler = state.data.saler.filter(s => (s.lokaleeffekt ?? 1) !== 1);
  if (!saler.length) return null;
  return h("p", { class: "varsel", style: "margin-top: 12px" }, h("span", { class: "merke varsel" }, "følsomhet"), " ",
    `Lokaleeffekt: ${saler.map(s => `${s.navn} ${pst(s.lokaleeffekt)}`).join(", ")}. Salget i ${saler.length === 1 ? "den salen" : "de salene"} regnes som den andelen av etterspørselen, og taket i salen gjelder fortsatt. Majas premiss er 100 %. Endres under Saler.`);
}

/** Merknad når en utvidelse utenfor casen (bar, uforutsett, pakke per konsert) er i bruk. */
function utvidelserMerknad() {
  const d = state.data;
  const tekst = utvidelserTekst(d.sesong, d.program);
  if (!tekst.length) return null;
  return h("p", { class: "varsel", style: "margin-top: 12px" }, h("span", { class: "merke varsel" }, "utenfor casen"), " ",
    `${tekst.join(". ")}. Casen har ingen andre inntekter eller kostnader enn pakken, leien og postene per billett. Settes tilbake under Anbefaling eller Forutsetninger.`);
}

function utvidelserTekst(s, program) {
  const ut = [];
  for (const u of utvidelserIBruk(s, program)) {
    if (u === "bar") ut.push(`Bar: ${kr(s.barPerGjest)} per gjest, ${pst(s.barAndel)} til Sceneskift (${kr(barTilSceneskift(s))} per gjest)`);
    if (u === "uforutsett") ut.push(`Uforutsette kostnader: ${kr(s.uforutsett)} per konsert`);
    if (u === "markedsforing") ut.push(`Ekstra markedsføring: ${kr(s.markedsforing)} for sesongen`);
    if (u === "pakkeAvvik") { const n = program.filter(k => k.pakkeAvvik).length; ut.push(`Egen pakkepris på ${n} ${n === 1 ? "konsert" : "konserter"}`); }
  }
  return ut;
}

/** Konsekvenstabellen fra oppgaveteksten: én rad per handling (også å avstå), én kolonne per scenario. Nåverdi og om rammen holder. */
function konsekvenstabell(res) {
  const d = state.data;
  const s = d.sesong;
  const aktiv = aktivtScenario(s);
  const alleSc = beregnScenarioer(s, d.saler, d.program);
  const hodeKlasse = sc => `${sc === aktiv ? "aktiv" : ""}${sc.oppside ? " oppside" : ""}`;
  const celle = (sc, r) => {
    const over = s.ramme != null && r.behov > s.ramme;
    return h("td", { class: `hoyre ${hodeKlasse(sc)}` },
      h("div", { class: `tall nv-celle ${nvVist(r) < 0 ? "minus" : ""}` }, kr(nvVist(r))),
      h("div", { class: `liten tall ${over ? "minus" : "svak"}` }, r.behov ? `trenger ${tall(r.behov)}${over ? ", over rammen, nåverdi etter rente" : ""}` : "trenger 0"));
  };
  const rader = [
    ...d.saler.map(x => ({ navn: `Alt i ${salTittel(x)}`, farge: fargeFor(x), hent: r => r.altI[x.id] })),
    ...(res.blandet ? [{ navn: "Egen plan", farge: "gronn", merke: "utenfor casen", hent: r => r.egen }] : []),
    { navn: "Avstå", farge: "graa", hent: r => r.avstaa },
  ];
  const holder = sc => rader.filter(r => r.navn !== "Avstå" && sc.res && r.hent(sc.res).holderRammen).map(r => r.navn.replace("Alt i ", "").split(":")[0]);
  return h("section", { class: "seksjon" },
    h("h2", {}, "Alle scenarioene samlet"),
    fork("p", "ingress", "Konsekvenstabellen fra oppgaveteksten: én rad per handling, også å avstå, og én kolonne per scenario. Nåverdien står stort, og under hvor mye Sceneskift må ligge ute med. Rødt betyr tap eller over rammen. Den aktive kolonnen er valgt over."),
    h("div", { class: "tabellramme" }, h("table", { class: "konsekvens" },
      h("thead", {}, h("tr", {}, h("th", {}, "Handling"), ...alleSc.map(({ scenario: sc }) => h("th", { class: `hoyre ${hodeKlasse(sc)}` }, sc.navn, h("div", { class: "liten svak tall" }, `${pst(sc.etterspoerselsfaktor)} salg, ${kr(sc.pakke)}`))))),
      h("tbody", {}, ...rader.map(rad => h("tr", { style: `--c: var(--${rad.farge})` },
        h("td", { class: "handling" }, h("span", { class: "prikk" }), rad.navn, rad.merke ? h("span", { class: "merke varsel" }, rad.merke) : null),
        ...alleSc.map(({ scenario: sc, res: r }) => celle(sc, rad.hent(r)))))),
      s.ramme == null ? null : h("tfoot", {}, h("tr", {}, h("td", {}, "Holder rammen"), ...alleSc.map(({ scenario: sc, res: r }) => {
        const ok = holder({ res: r });
        return h("td", { class: `hoyre liten ${hodeKlasse(sc)} ${ok.length ? "" : "minus"}` }, ok.length ? ok.join(", ") : "ingen");
      }))))));
}

/**
 * Lånemodulen (nr 2 i tilbakemeldingene 17.11): lån ut over rammen for valget som trenger det. Kassekreditt eller
 * fast lån fra en valgt måned, sammenlignet side om side, og lånet måned for måned. Utenfor casen.
 */
function laanModul(res) {
  const d = state.data;
  const s = d.sesong;
  const hd = handlinger(s, d.saler, d.program).filter(a => a.type !== "avstaa");
  const medLaan = hd.map(a => ({ ...a, r: a.hent(s) })).filter(a => a.r.laan > 0);
  const sek = h("section", { class: "seksjon laanmodul", id: "laan" },
    h("h2", {}, "Lån ut over rammen ", h("span", { class: "merke varsel" }, "utenfor casen")),
    h("p", { class: "ingress synlig" }, `Casen sier at rammen på ${kr(s.ramme ?? 0)} er et krav, og arbeidsboka har ikke lån. Her ser dere hva det koster å låne det som mangler. Når et valg trenger lån, viser siden nåverdien etter rente. Selve lånet (inn og tilbake) holdes utenfor nåverdien, bare renten trekkes fra.`));
  if (s.ramme == null || !medLaan.length) {
    sek.append(h("p", { class: "naa-linje svak" }, s.ramme == null ? "Ingen ramme satt, så ingen trenger lån." : "Ingen av valgene trenger lån med forutsetningene nå."));
    return sek;
  }
  if (!medLaan.some(a => a.id === state.laanValg)) state.laanValg = medLaan.reduce((a, b) => (nvVist(b.r) > nvVist(a.r) ? b : a)).id;
  const valgt = medLaan.find(a => a.id === state.laanValg);
  const T = valgt.r.saldo.length - 1;
  const mndNavn = t => (t === 0 ? "Start (før januar)" : MAANEDER[t] ?? `M${t}`);
  const kk = valgt.hent({ ...s, laanType: "kassekreditt" });
  const fl = valgt.hent({ ...s, laanType: "fast" });
  const r = valgt.r;
  const sett = (felt, verdi) => { s[felt] = verdi; oppdater(); };

  // Styring: valg, lånetype, måneder, beløp og rente
  const typeKnapp = (type, navn) => h("button", { type: "button", class: "chip", "aria-pressed": String((s.laanType ?? "kassekreditt") === type), onclick: () => sett("laanType", type) }, navn);
  const mndValg = (felt, fra, til, auto) => h("select", { "aria-label": felt, onchange: e => sett(felt, e.target.value === "" ? null : Number(e.target.value)) },
    auto ? h("option", { value: "", selected: s[felt] == null }, auto) : null,
    ...Array.from({ length: til - fra + 1 }, (_, i) => fra + i).map(t => h("option", { value: t, selected: s[felt] === t }, mndNavn(t))));
  sek.append(h("div", { class: "laan-styring" },
    medLaan.length > 1 ? h("label", { class: "felt" }, h("span", {}, "Valget"),
      h("select", { onchange: e => { state.laanValg = e.target.value; render(); } }, ...medLaan.map(a => h("option", { value: a.id, selected: a.id === valgt.id }, a.type === "sal" ? `Alt i ${a.kort ? `${a.kort}: ` : ""}${a.navn}` : a.navn))))
      : h("div", { class: "felt" }, h("span", {}, "Valget"), h("b", {}, valgt.type === "sal" ? `Alt i ${valgt.kort ? `${valgt.kort}: ` : ""}${valgt.navn}` : valgt.navn)),
    h("div", { class: "felt" }, h("span", {}, "Lånetype som brukes i tallene"), h("div", { class: "chips" }, typeKnapp("kassekreditt", "Kassekreditt"), typeKnapp("fast", "Fast lån"))),
    s.laanType === "fast" ? h("label", { class: "felt" }, h("span", {}, "Tas opp ved slutten av"), mndValg("laanStart", 0, T - 1)) : null,
    s.laanType === "fast" ? h("label", { class: "felt" }, h("span", {}, "Betales tilbake ved slutten av"), mndValg("laanSlutt", 1, T, `Automatisk (${(MAANEDER[fl.laanSlutt ?? 1] ?? "").toLowerCase()})`)) : null,
    s.laanType === "fast" ? h("label", { class: "felt" }, h("span", {}, "Beløp, tomt = det som trengs"),
      h("input", { type: "number", min: 0, step: 5000, value: s.laanBelop ?? "", placeholder: tall(fl.laanBelop), onchange: e => sett("laanBelop", e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0)) })) : null,
    h("label", { class: "felt" }, h("span", {}, "Rente per år, vår antakelse"),
      h("div", { class: "prosentfelt" }, h("input", { type: "number", min: 0, step: 1, value: Math.round((s.laanRente ?? 0) * 1000) / 10, onchange: e => sett("laanRente", Math.max(0, Number(e.target.value) || 0) / 100) }), h("span", { class: "svak" }, "%")))));

  // Sammenligning: kassekreditt mot fast lån, med nåverdien før og etter rente
  const fastNavn = `Fast lån fra ${mndNavn(fl.laanStart ?? 0).toLowerCase()}`;
  const kort = (navn, x, i_bruk, tekst) => h("div", { class: `kort laan-kort${i_bruk ? " i-bruk" : ""}`, style: `--c: var(--${valgt.farge ?? "graa"})` },
    h("h3", {}, navn, i_bruk ? h("span", { class: "merke raad-merke" }, "brukes nå") : null),
    h("div", { class: "stor tall" }, kr(x.nvEtterRente)), h("div", { class: "stor-etikett" }, "nåverdi etter rente"),
    h("dl", {}, h("dt", {}, "Nåverdi før rente (casen)"), h("dd", { class: "tall" }, kr(x.nv)),
      h("dt", {}, "Største lån"), h("dd", { class: "tall" }, kr(x.laan)),
      h("dt", {}, "Måneder med lån"), h("dd", { class: "tall" }, String(x.maanederMedLaan)),
      h("dt", {}, "Rente i alt"), h("dd", { class: "tall minus" }, kr(x.rentekostnad))),
    h("p", { class: "liten" }, tekst));
  const forskjell = kk.nvEtterRente - fl.nvEtterRente;
  sek.append(h("div", { class: "kort-rad" },
    kort("Kassekreditt", kk, (s.laanType ?? "kassekreditt") !== "fast", "Lån bare det som mangler hver måned. Betales ned av seg selv når oppgjørene kommer."),
    kort(fastNavn, fl, s.laanType === "fast", `${kr(fl.laanBelop)} tas opp ${fl.laanStart === 0 ? "før januar" : `ved slutten av ${mndNavn(fl.laanStart).toLowerCase()}`} og betales tilbake ved slutten av ${mndNavn(fl.laanSlutt).toLowerCase()}.${fl.restKreditt > 0 ? ` Det lånet ikke dekker (inntil ${kr(fl.restKreditt)}), går på kassekreditt.` : ""}`)),
    h("p", { class: "naa-linje" }, Math.abs(forskjell) < 1 ? "De to gir samme nåverdi etter rente." :
      [`Forskjellen er `, h("b", { class: "tall" }, kr(Math.abs(forskjell))), ` i nåverdi etter rente, i favør av ${forskjell > 0 ? "kassekreditt" : "fast lån"}. Jo tidligere et fast lån tas opp, jo flere måneder betaler dere rente på penger dere ikke trenger ennå.`]));

  // Måned for måned
  const rad = (navn, verdier, cls = "") => h("tr", { class: cls }, h("td", {}, navn), ...verdier.map(v => h("td", { class: `hoyre tall ${v < 0 ? "minus" : ""}` }, Math.round(v) === 0 ? h("span", { class: "svak" }, "0") : tall(v))));
  const nedbetalt = r.trekk.map((x, t) => Math.max(0, (t ? r.trekk[t - 1] : 0) - x));
  sek.append(h("h3", { class: "grenser-tittel" }, `Lånet måned for måned, ${r.laanType === "fast" ? fastNavn.toLowerCase() : "kassekreditt"}`),
    h("div", { class: "tabellramme" }, h("table", { class: "kontantstrom" },
      h("thead", {}, h("tr", {}, h("th", {}, "Kroner, ved månedsslutt"), ...r.saldo.map((_, t) => h("th", { class: "hoyre" }, MAANEDER[t] ?? `M${t}`)))),
      h("tbody", {},
        rad("Kontoen uten lån", r.saldo, "saldo"),
        rad("Mangler mot rammen", r.behovOver.map(x => -x)),
        ...(r.laanType === "fast" ? [rad("Fast lån", r.fastLaan), rad("Kassekreditt", r.kreditt)] : []),
        rad("Lånt i alt", r.trekk, "saldo"),
        rad("Betalt ned", nedbetalt),
        rad("Rente", r.renter.map(x => -x))))),
    h("p", { class: "liten svak", style: "margin-top: 8px" }, `Renten er ${pst(s.laanRente ?? 0)} per år på det som er lånt ved månedsslutt, delt på 12. Nåverdi etter rente trekker fra rentene regnet om til dagens kroner. Lånet gjør valget mulig, ikke tryggere: blir salget lavere, må lånet bli større.`));
  return sek;
}

function padTil(arr, n) { const ut = arr.slice(); while (ut.length < n) ut.push(ut[ut.length - 1]); return ut; }

/* ---------- Saler ---------- */
function renderSaler(main, res) {
  const d = state.data;
  const sek = h("section", { class: "seksjon" },
    h("h2", {}, "Salene og vilkårene"),
    fork("p", "ingress", "Kapasitet er salgbare plasser per oppsett. Tomt felt betyr at salen ikke tilbyr oppsettet. Leien settes sammen av byggeklosser, så nye saler og nye vilkår kan legges inn uten å endre noe annet."),
    h("div", { class: "verktoylinje" },
      h("button", { type: "button", onclick: () => leggTilSal() }, "Legg til sal"),
      h("button", { type: "button", class: "stille", onclick: () => { const C = d.saler.find(x => x.id === "C") ?? d.saler[0]; leggTilSal(C); } }, "Legg til som kopi av C")));
  const liste = h("div", { class: "sal-liste" });
  for (const s of d.saler) liste.append(salKort(s, res));
  sek.append(liste);
  main.append(sek);
  main.append(h("section", { class: "seksjon" },
    h("h2", {}, "Lokalene i 2026, til sammenligning"),
    fork("p", "ingress", "Sceneskift delte 2026 mellom to rom (arkivet på nettsiden og oppgjørsfila). De seks minste konsertene gikk i Verkstedet, de seks største i Maskinhallen. Tallene er total publikumskapasitet inkludert fribilletter, ikke salgbare plasser. Ingen konsert var full: høyest var konsert 6 med 480 av 550."),
    h("div", { class: "kort-rad" }, ...LOKALER_2026.map(l => h("div", { class: "kort", style: "--c: var(--graa)" },
      h("h3", {}, l.navn),
      h("div", { class: "stor" }, String(l.kapasitet)),
      h("div", { class: "stor-etikett" }, "total kapasitet"),
      h("dl", {}, h("dt", {}, "Konserter i 2026"), h("dd", {}, String(d.program.filter(k => k.i2026?.lokale === l.navn).length)),
        h("dt", {}, "Solgte, snitt"), h("dd", {}, (() => { const ks = d.program.filter(k => k.i2026?.lokale === l.navn && k.salg2026 != null); return ks.length ? tall(ks.reduce((a, k) => a + k.salg2026, 0) / ks.length) : "0"; })())),
      fork("p", "notat", l.beskrivelse))))));
}

function salKort(s, res) {
  const d = state.data;
  const standard = SALER_2027.find(x => x.id === s.id);
  const erEndret = standard && JSON.stringify(stripp(s)) !== JSON.stringify(stripp(standard));
  const endre = (felt, verdi) => { s[felt] = verdi; reparer(); oppdater(); };
  const kapFelt = (o, navn) => h("label", { class: "felt" },
    h("span", {}, navn, o === "sitte" && s.sitteAntatt ? h("span", { class: "merke" }, "antatt") : null),
    h("input", { type: "number", min: 0, step: 10, value: s.kapasitet[o] ?? "", placeholder: "ingen", onchange: e => { s.kapasitet[o] = e.target.value === "" ? null : Math.max(0, Number(e.target.value)); reparer(); oppdater(); } }));
  const brukt = d.program.filter(k => k.salId === s.id).length;
  const r = res.altI[s.id];
  return h("article", { class: "sal", style: `--c: var(--${fargeFor(s)})` },
    h("div", { class: "bilde" },
      s.bilde ? h("img", { src: s.bilde, alt: `Bilde av ${s.navn}` }) : null,
      s.kilde ? h("div", { class: "kilde" }, "Bilde og opplysninger: ", h("a", { href: s.kilde, target: "_blank", rel: "noopener" }, s.kilde.replace(/^https?:\/\//, ""))) : null),
    h("div", { class: "tekst" },
      h("h3", {},
        h("input", { class: "kort", type: "text", value: s.kort ?? "", placeholder: "A", "aria-label": "Kort navn", maxlength: 3, onchange: e => endre("kort", e.target.value.trim()) }),
        h("input", { type: "text", value: s.navn, "aria-label": "Navn på salen", onchange: e => endre("navn", e.target.value.trim() || s.navn) }),
        h("select", { "aria-label": "Farge", onchange: e => endre("farge", e.target.value) }, ...FARGER.map(f => h("option", { value: f, selected: f === s.farge }, FARGENAVN[f]))),
        s.kunHelSesong ? h("span", { class: "merke" }, "kun hel sesong") : null),
      h("p", { class: "liten svak" }, `Alt i denne salen: nåverdi ${kr(nvVist(r))}${r.laan > 0 ? " etter rente på lånet" : ""}, trenger ${kr(r.behov)}.`, fork("span", "", ` ${brukt ? `Valgt på ${brukt} ${brukt === 1 ? "konsert" : "konserter"} i egen plan.` : "Ikke valgt på noen konsert i egen plan."}`)),
      h("div", { class: "felt-rad" },
        kapFelt("staa", "Stående, plasser"), kapFelt("sitte", "Sittende, plasser"),
        h("label", { class: "avkryss" }, h("input", { type: "checkbox", checked: !!s.sitteAntatt, onchange: e => endre("sitteAntatt", e.target.checked) }), "Sitteplasser er antatt"),
        h("label", { class: "avkryss" }, h("input", { type: "checkbox", checked: !!s.kunHelSesong, onchange: e => endre("kunHelSesong", e.target.checked) }), "Kun hel sesong"),
        h("label", { class: "felt" },
          h("span", {}, "Lokaleeffekt på salget", h("span", { class: "merke" }, "følsomhet")),
          h("div", { class: "prosentfelt" },
            h("input", { type: "number", min: 0, max: 300, step: 5, value: Math.round((s.lokaleeffekt ?? 1) * 1000) / 10, "aria-label": "Lokaleeffekt i prosent", onchange: e => endre("lokaleeffekt", Math.max(0, Number(e.target.value) || 0) / 100) }),
            h("span", { class: "svak" }, "%")))),
      fork("p", "notat", "Lokaleeffekt: salget her i forhold til etterspørselen. 100 % er Majas premiss (lokalet påvirker ikke salget), 85 % betyr 15 % færre kjøpere når konserten er her. Taket i salen gjelder uansett. Gruppas egen følsomhet, som i arbeidsboka."),
      fork("label", "felt bred", h("span", {}, "Beskrivelse og kapasitetsnotat"),
        h("input", { type: "text", value: s.kapasitetNotat ?? s.beskrivelse ?? "", onchange: e => endre("kapasitetNotat", e.target.value) })),
      h("div", { class: "byggeklosser" },
        h("h4", {}, "Leie"),
        ...s.leie.map((b, i) => klossRad(s, b, i)),
        h("div", { class: "verktoylinje", style: "margin: 8px 0 0" },
          h("select", { "aria-label": "Ny byggekloss", onchange: e => { if (!e.target.value) return; s.leie.push(nyKloss(e.target.value)); e.target.value = ""; oppdater(); } },
            h("option", { value: "" }, "Legg til byggekloss"),
            h("option", { value: "perKonsert" }, "Fast beløp per konsert"),
            h("option", { value: "andel" }, "Andel av billettoppgjøret, med minimum"),
            h("option", { value: "engang" }, "Engangsbeløp for sesongen"),
            h("option", { value: "sesong" }, "Sesongleie med betalingsplan")))),
      h("div", { class: "handlinger" },
        erEndret ? h("button", { type: "button", class: "stille", onclick: () => { Object.assign(s, kopi(standard)); reparer(); oppdater(); } }, "Tilbake til casen") : null,
        h("button", { type: "button", class: "stille farlig", onclick: () => { if (d.saler.length <= 1) return alert("Minst én sal må være igjen."); if (confirm(`Fjerne ${s.navn}?${brukt ? ` ${brukt} konserter flyttes til en annen sal.` : ""}`)) { d.saler.splice(d.saler.indexOf(s), 1); reparer(); oppdater(); } } }, "Fjern salen"))));
}

function stripp(s) { const { bilde, kilde, beskrivelse, ...rest } = s; return rest; }

function nyKloss(type) {
  return { perKonsert: { type, belop: 10000, naar: "konsertmaaned" }, andel: { type, andel: 0.15, minimum: 5000, naar: "maanedEtter" },
           engang: { type, belop: 20000, tidspunkt: 0 }, sesong: { type, belop: 100000, plan: [{ tidspunkt: 0, andel: 0.5 }, { tidspunkt: 3, andel: 0.5 }] } }[type];
}

function klossRad(s, b, i) {
  const endre = (felt, verdi) => { b[felt] = verdi; oppdater(); };
  const felt = (navn, inp) => h("label", { class: "felt" }, h("span", {}, navn), inp);
  const naar = () => felt("Betales", h("select", { onchange: e => endre("naar", e.target.value) },
    h("option", { value: "maanedFoer", selected: b.naar === "maanedFoer" }, "måneden før"),
    h("option", { value: "konsertmaaned", selected: b.naar === "konsertmaaned" || !b.naar }, "i konsertmåneden"),
    h("option", { value: "maanedEtter", selected: b.naar === "maanedEtter" }, "måneden etter")));
  const tid = (verdi, ved) => h("select", { onchange: e => ved(Number(e.target.value)) }, ...MAANEDER.slice(0, 8).map((m, t) => h("option", { value: t, selected: t === verdi }, t === 0 ? "ved start (t0)" : m)));
  let innhold;
  if (b.type === "perKonsert") innhold = [h("b", {}, "Per konsert"), felt("Kroner", h("input", { type: "number", min: 0, step: 500, value: b.belop, onchange: e => endre("belop", Number(e.target.value) || 0) })), naar()];
  else if (b.type === "andel") innhold = [h("b", {}, "Andel av oppgjøret"), felt("Prosent", h("input", { type: "number", min: 0, max: 100, step: 1, value: Math.round(b.andel * 1000) / 10, onchange: e => endre("andel", (Number(e.target.value) || 0) / 100) })), felt("Minst per konsert", h("input", { type: "number", min: 0, step: 500, value: b.minimum ?? 0, onchange: e => endre("minimum", Number(e.target.value) || 0) })), naar()];
  else if (b.type === "engang") innhold = [h("b", {}, b.navn ?? "Engangsbeløp"), felt("Kroner", h("input", { type: "number", min: 0, step: 1000, value: b.belop, onchange: e => endre("belop", Number(e.target.value) || 0) })), felt("Betales", tid(b.tidspunkt ?? 0, v => endre("tidspunkt", v)))];
  else innhold = [h("b", {}, b.navn ?? "Sesongleie"), felt("Kroner i alt", h("input", { type: "number", min: 0, step: 1000, value: b.belop, onchange: e => endre("belop", Number(e.target.value) || 0) })),
    h("div", { class: "plan" }, ...(b.plan ?? []).map((p, j) => h("div", { class: "felt" }, h("span", {}, `Del ${j + 1}, prosent`), h("div", { style: "display:flex; gap:6px; align-items:center" },
      h("input", { type: "number", min: 0, max: 100, step: 5, value: Math.round(p.andel * 100), style: "width: 7ch", onchange: e => { p.andel = (Number(e.target.value) || 0) / 100; oppdater(); } }),
      tid(p.tidspunkt, v => { p.tidspunkt = v; oppdater(); }),
      b.plan.length > 1 ? h("button", { type: "button", class: "stille liten", onclick: () => { b.plan.splice(j, 1); oppdater(); } }, "fjern") : null)))),
    h("button", { type: "button", class: "stille liten", onclick: () => { b.plan.push({ tidspunkt: 0, andel: 0 }); oppdater(); } }, "Legg til del"),
    Math.abs((b.plan ?? []).reduce((a, p) => a + p.andel, 0) - 1) > 0.001 ? h("span", { class: "merke feil" }, "delene summerer ikke til 100 %") : null];
  return h("div", { class: "kloss" }, ...innhold, h("button", { type: "button", class: "stille liten farlig", onclick: () => { s.leie.splice(i, 1); oppdater(); } }, "Fjern"));
}

function leggTilSal(mal) {
  const d = state.data;
  const brukte = new Set(d.saler.map(s => s.id));
  let id = "D"; while (brukte.has(id)) id = String.fromCharCode(id.charCodeAt(0) + 1);
  const ny = mal ? { ...kopi(mal), id, kort: id, navn: `${mal.navn} (kopi)`, bilde: null, kilde: null }
                 : { id, kort: id, navn: "Ny sal", farge: FARGER[d.saler.length % FARGER.length], beskrivelse: "", kilde: null, bilde: null,
                     kapasitet: { staa: 400, sitte: 200 }, sitteAntatt: true, kapasitetNotat: "", kunHelSesong: false, leie: [nyKloss("perKonsert")] };
  d.saler.push(ny);
  oppdater();
}

/* ---------- Forutsetninger ---------- */
/* ---------- Spør: chatboten for Maja ----------
 * Språkmodellen forklarer, motoren regner (src/chat.js). Nøkkelen ligger bare i nettleserens lokale lager.
 * Samtalen ligger bare i minnet og forsvinner når siden lastes på nytt.
 */
/** Chatpanelet glir inn fra høyre og kan åpnes fra alle fanene med gaffarullen nede til høyre. */
function aapneChat() {
  if (!state.chatAapen) { state.chatAapen = true; renderChat(true); }
  else renderChat(true);
}
function lukkChat() {
  state.chatAapen = false;
  renderChat();
  if (location.hash === "#spor") history.replaceState(null, "", "#" + state.fane);
  document.getElementById("gaffarull").focus({ preventScroll: true });
}

function renderChat(fokus = false) {
  const panel = document.getElementById("chatpanel");
  const rull = document.getElementById("gaffarull");
  const c = state.chat;
  panel.classList.toggle("aapen", state.chatAapen);
  panel.inert = !state.chatAapen;
  panel.setAttribute("aria-hidden", String(!state.chatAapen));
  rull.setAttribute("aria-expanded", String(state.chatAapen));
  document.body.classList.toggle("chat-aapen", state.chatAapen);
  if (!state.chatAapen) return;
  const nokkel = lesNokkel();
  panel.replaceChildren(
    h("header", { class: "chatpanel-topp" },
      h("div", {},
        h("h2", { id: "chatpanel-tittel" }, "Spør om rådet"),
        h("p", { class: "liten" }, "Konsertplan regner, Claude fra Anthropic forklarer. «Hva om» prøves uten å endre planen din.")),
      h("button", { type: "button", class: "lukk", "aria-label": "Lukk", onclick: lukkChat }, "×")),
    nokkel ? chatFlate(c) : nokkelBoks());
  const logg = panel.querySelector(".chat-logg");
  if (logg) logg.scrollTop = logg.scrollHeight;
  if (fokus) requestAnimationFrame(() => panel.querySelector("#chat-felt:not([disabled]), #chat-nokkel")?.focus({ preventScroll: true }));
}

function nokkelBoks() {
  const felt = h("input", { type: "password", id: "chat-nokkel", autocomplete: "off", spellcheck: "false", placeholder: "Lim inn nøkkelen her" });
  const lagreN = () => { if (felt.value.trim()) { lagreNokkel(felt.value); renderChat(true); } };
  felt.addEventListener("keydown", e => { if (e.key === "Enter") lagreN(); });
  return h("div", { class: "chat-nokkel" },
    h("label", { for: "chat-nokkel" }, "Anthropic API-nøkkel"),
    h("div", { class: "chat-nokkel-rad" }, felt, h("button", { type: "button", class: "primaer", onclick: lagreN }, "Lagre i denne nettleseren")),
    h("p", { class: "liten svak" }, "Nøkkelen lagres bare i nettleserens lokale lager på denne maskinen og sendes bare til Anthropic. Den er aldri med i «Lagre»-fila. Hvert spørsmål koster litt på kontoen nøkkelen tilhører, så sett gjerne en brukergrense på nøkkelen."));
}

function chatFlate(c) {
  const t = tilstand(state.data);
  const logg = h("div", { class: "chat-logg", "aria-live": "polite" });
  if (!c.logg.length) logg.append(h("p", { class: "chat-tom svak" }, `Rådet nå: ${t.raadet.valg === "Avstå" ? "avstå" : t.raadet.valg}. Spør om hvorfor, eller om hva som skal til for at det snur.`));
  for (const m of c.logg) logg.append(chatMelding(m));
  if (c.venter) logg.append(h("div", { class: "chat-melding bot venter" }, h("span", { class: "svak" }, "Konsertplan regner og skriver svar")));
  const felt = h("textarea", { id: "chat-felt", rows: "2", placeholder: "Skriv et spørsmål, for eksempel: Hva om vi bare selger 85 %?", disabled: c.venter, "aria-label": "Spørsmål" });
  felt.value = c.utkast ?? "";
  felt.addEventListener("input", () => { c.utkast = felt.value; });
  const send = tekst => { tekst = (tekst ?? felt.value).trim(); if (tekst && !c.venter) { c.utkast = ""; sporModellen(tekst); } };
  felt.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  return h("div", { class: "chat" },
    logg,
    c.venter ? null : h("div", { class: "chat-forslag" }, ...chatForslag(t).map(f => h("button", { type: "button", class: "forslag-knapp", onclick: () => send(f) }, f))),
    h("form", { class: "chat-skjema", onsubmit: e => { e.preventDefault(); send(); } },
      felt, h("button", { type: "submit", class: "primaer", disabled: c.venter }, "Spør")),
    h("p", { class: "liten svak chat-bunn" }, "Nøkkelen er lagret i denne nettleseren. ",
      h("button", { type: "button", class: "stille liten", onclick: () => { glemNokkel(); renderChat(true); } }, "Glem nøkkelen"), " ",
      c.logg.length ? h("button", { type: "button", class: "stille liten", disabled: c.venter, onclick: () => { state.chat = { samtale: nySamtale(), logg: [], venter: false, utkast: "" }; renderChat(true); } }, "Tøm samtalen") : null));
}

function chatMelding(m) {
  if (m.rolle === "maja") return h("div", { class: "chat-melding maja" }, m.tekst);
  if (m.rolle === "feil") return h("div", { class: "chat-melding feil varsel" }, m.tekst);
  return h("div", { class: "chat-melding bot" },
    ...avsnitt(m.tekst).map(a => (a.type === "punkter" ? h("ul", {}, ...a.linjer.map(l => h("li", {}, l))) : h("p", {}, a.tekst))),
    m.avkortet ? h("p", { class: "liten svak" }, "Svaret ble kuttet fordi det ble for langt.") : null,
    ...m.kjoringer.map(chatRegnet));
}

/** Det Konsertplan regnet for et «hva om»: endringen, tallene før og etter, og knappen «Bruk i planen». */
function chatRegnet(k) {
  const utenfor = k.endringer.some(e => e.tekst.includes("utenfor casen")) || k.endringer.some(e => /^Sal, /.test(e.tekst));
  const rader = k.etter.valgene.filter(v => v.navn !== "Avstå").map(v => {
    const f = k.foer.valgene.find(x => x.navn === v.navn);
    const raad = v.navn === k.etter.raadet;
    return h("tr", { class: raad ? "raad" : "" },
      h("td", {}, v.navn, raad ? h("span", { class: "merke raad-merke" }, "rådet") : null),
      h("td", { class: `hoyre tall ${v.verdi_for_sceneskift_kr < 0 ? "minus" : ""}` }, f ? `${tall(f.verdi_for_sceneskift_kr)} → ` : "", h("b", {}, kr(v.verdi_for_sceneskift_kr))),
      h("td", { class: `hoyre tall ${v.holder_rammen_naa === false ? "minus" : ""}` }, f ? `${tall(f.maa_ha_klart_kr)} → ` : "", h("b", {}, kr(v.maa_ha_klart_kr))));
  });
  return h("div", { class: "chat-regnet" },
    h("p", { class: "chat-regnet-tittel" }, "Konsertplan regnet", utenfor ? h("span", { class: "merke varsel" }, "utenfor casen") : null),
    h("ul", { class: "liten" }, ...k.endringer.map(e => h("li", {}, `${e.tekst}: ${e.fra} → ${e.til}`))),
    h("div", { class: "tabellramme" }, h("table", { class: "chat-tabell" },
      h("thead", {}, h("tr", {}, h("th", {}, "Valg"), h("th", { class: "hoyre" }, "Verdi for Sceneskift"), h("th", { class: "hoyre" }, "Må ha klart"))),
      h("tbody", {}, ...rader))),
    h("p", { class: "liten" }, k.foer.raadet === k.etter.raadet ? `Rådet er fortsatt ${k.etter.raadet === "Avstå" ? "å avstå" : k.etter.raadet}.` : `Rådet snur: ${k.foer.raadet} → ${k.etter.raadet === "Avstå" ? "avstå" : k.etter.raadet}.`,
      " ",
      k.brukt ? h("span", { class: "svak" }, "Brukt i planen.")
        : h("button", { type: "button", class: "stille liten", onclick: () => { if (brukEndring(state.data, k.input)) { k.brukt = true; reparer(); oppdater(); } } }, "Bruk i planen")));
}

async function sporModellen(tekst) {
  const c = state.chat;
  const nokkel = lesNokkel();
  c.logg.push({ rolle: "maja", tekst });
  c.venter = true;
  renderChat();
  try {
    const svar = await spor(c.samtale, state.data, tekst, lagKall(nokkel));
    c.logg.push({ rolle: "bot", ...svar });
  } catch (e) {
    c.logg.push({ rolle: "feil", tekst: e.message || "Noe gikk galt." });
  } finally {
    c.venter = false;
    if (state.chat === c) renderChat(true);
  }
}

function renderForutsetninger(main) {
  const s = state.data.sesong;
  const felter = [
    ["billettpris", "Billettpris", "kr", "Oppgaveteksten: 350 kr per betalt billett, alle billetter i 2027", { step: 10 }],
    ["gebyr", "Billettgebyr", "kr", "Trekkes i oppgjøret fra Flytbillett, 10 kr per betalt billett", { step: 1 }],
    ["utgiftPerBillett", "Publikumsavhengig utgift", "kr", "10 kr per betalt billett, betalt i konsertmåneden", { step: 1 }],
    ["pakke", "Artist og produksjon, pakke", "kr", "Rigg & Ro: 60 000 kr per konsert, fast etter signering", { step: 1000 }],
    ["pakkeDel1Andel", "Del av pakken måneden før", "%", "Halvparten måneden før, resten i konsertmåneden", { step: 5, pst: true }],
    ["rente", "Realrente per år", "%", "Oppgaveteksten: 4 % real årsrente", { step: 0.5, pst: true }],
    ["ramme", "Startfinansiering, ramme", "kr", "Maja tror hun kan skaffe 250 000 kr, ikke avklart", { step: 10000 }],
    ["etterspoerselsfaktor", "Etterspørsel i forhold til 2026", "%", "Majas premiss er 100 %. Samme glider som i Resultater", { step: 5, pst: true }],
    ["laanRente", "Rente på lån ut over rammen, per år", "%", "Gruppas antakelse (29.10.2026): kassekreditt uten sikkerhet. Ikke fra casen. Renten holdes utenfor nåverdien", { step: 1, pst: true }],
  ];
  const boks = h("div", { class: "forutsetninger" },
    h("div", { class: "rad hode" }, h("span", {}, "Forutsetning"), h("span", { class: "hoyre" }, "Verdi"), h("span", {}, "Enhet"), fork("span", "", "Kilde"), h("span")));
  const radFor = ([felt, navn, enhet, kilde, o]) => {
    const vis = v => o.pst ? Math.round(v * 1000) / 10 : v;
    const basis = SESONG_2027[felt];
    return h("div", { class: "rad" },
      h("label", { for: `f-${felt}` }, navn, o.merke ? h("span", { class: "merke varsel", style: "margin-left: 8px" }, o.merke) : null),
      h("input", { id: `f-${felt}`, type: "number", step: o.step, min: o.min, value: vis(s[felt] ?? 0), onchange: e => { const v = Math.max(o.min ?? -Infinity, Number(e.target.value) || 0); s[felt] = o.pst ? v / 100 : v; oppdater(); } }),
      h("span", { class: "svak" }, enhet),
      fork("span", "liten svak", kilde),
      s[felt] !== basis ? h("button", { type: "button", class: "stille liten", onclick: () => { s[felt] = basis; oppdater(); } }, `Tilbake til casen (${vis(basis)} ${enhet})`) : h("span", { class: "liten svak" }, "Som i casen"));
  };
  for (const f of felter) boks.append(radFor(f));
  boks.append(h("div", { class: "rad" },
    h("label", { for: "f-konv" }, "Diskontering per måned"),
    h("select", { id: "f-konv", onchange: e => { s.konvensjon = e.target.value; oppdater(); } },
      h("option", { value: "aar", selected: s.konvensjon !== "maaned" }, "(1 + r)^(t/12)"),
      h("option", { value: "maaned", selected: s.konvensjon === "maaned" }, "(1 + r/12)^t")),
    h("span"), fork("span", "liten svak", "Arbeidsboka bruker (1 + r)^(t/12). Den andre gir litt lavere nåverdi"),
    s.konvensjon !== "aar" ? h("button", { type: "button", class: "stille liten", onclick: () => { s.konvensjon = "aar"; oppdater(); } }, "Tilbake til casen") : h("span", { class: "liten svak" }, "Som i casen")));
  main.append(h("section", { class: "seksjon" },
    h("h2", {}, "Forutsetningene for sesongen"),
    fork("p", "ingress", "Tallene fra Majas e-post og vedleggene. Alt kan endres, og alt kan settes tilbake. Faste 2026-kroner, før skatt og finansiering."),
    boks,
    fork("p", "notat", "Det som ikke kan endres her: strukturen i betalingene. Billettoppgjøret kommer alltid måneden etter konserten, publikumsutgiften i konsertmåneden, og pakken i to deler. Det er slik casen er lagt opp, og slik arbeidsboka regner.")));
  // Utvidelser utenfor casen: standard 0, som gir casens tall
  const utenfor = [
    ["barPerGjest", "Bar: omsetning per gjest", "kr", "Per betalt billett. Ikke i casen. Gjøres opp måneden etter, som billettene", { step: 10, min: 0, merke: "utenfor casen" }],
    ["barAndel", "Bar: Sceneskifts andel", "%", "Andelen av baromsetningen Sceneskift får. Avtales med salen", { step: 5, min: 0, pst: true, merke: "utenfor casen" }],
    ["uforutsett", "Uforutsette kostnader per konsert", "kr", "Det pakken ikke dekker, betalt i konsertmåneden. Casen: ingen andre kostnader", { step: 500, min: 0, merke: "utenfor casen" }],
    ["markedsforing", "Ekstra markedsføring for sesongen", "kr", "Fordelt likt på konsertene, betalt måneden før. Tenkt brukt med Høy etterspørsel: mer salg kommer sjelden av seg selv. Casen: ingen andre kostnader", { step: 1000, min: 0, merke: "utenfor casen" }],
  ];
  main.append(h("section", { class: "seksjon" },
    h("h2", {}, "Utenfor casen"),
    fork("p", "ingress", "Oppgaveteksten sier at det utover postene over og lokaleleien ikke er andre inntekter eller kostnader. Derfor står disse på 0, som gir casens tall. Pakkepris per konsert endres i Programmet. Rådet viser hva hver av dem gjør med rådet."),
    h("div", { class: "forutsetninger" }, ...utenfor.map(radFor))));
}

document.addEventListener("DOMContentLoaded", init);

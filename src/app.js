// Konsertplan: tilstand og rendering. Alt regnes på nytt ved hver endring.
import { beregnAlle, beregnScenarioer, aktivtScenario, velgScenario, kapasitet, kopi } from "./motor.js";
import { forslagForKonsert, besteBlanding } from "./forslag.js";
import { SESONG_2027, SALER_2027, SCENARIOER_2027, SJANGRE, LOKALER_2026, standardSesong } from "./standard-2027.js";
import { lesLokalt, lagreLokalt, slettLokalt, lastNedFil, lesFil } from "./lagring.js";
import { tegnSaldo, tegnBidrag } from "./figurer.js";

const tall = v => Math.round(v ?? 0).toLocaleString("nb-NO");
const kr = v => tall(v) + " kr";
const pst = v => Math.round(v * 100) + " %";
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

const state = { data: null, fane: "program", referanse: "C", forklar: false, besteBlanding: null };

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
  const faner = [...document.querySelectorAll(".faner button")].map(b => b.dataset.fane);
  const fraHash = () => { const f = location.hash.replace("#", ""); if (faner.includes(f) && f !== state.fane) { state.fane = f; render(); } };
  for (const b of document.querySelectorAll(".faner button")) b.addEventListener("click", () => { state.fane = b.dataset.fane; history.replaceState(null, "", "#" + state.fane); render(); });
  window.addEventListener("hashchange", fraHash);
  if (faner.includes(location.hash.replace("#", ""))) state.fane = location.hash.replace("#", "");
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
  const res = beregn();
  renderStripe(res);
  const main = document.getElementById("innhold");
  main.replaceChildren();
  ({ program: renderProgram, resultater: renderResultater, saler: renderSaler, forutsetninger: renderForutsetninger })[state.fane](main, res);
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
      h("div", { class: `nv tall ${r.nv < 0 ? "minus" : ""}` }, kr(r.nv), stor ? h("span", { class: "nv-etikett" }, "nåverdi") : null),
      h("div", { class: "rad" }, stor ? "Trenger underveis" : "Trenger", h("b", { class: "tall" }, kr(r.behov))),
      stor ? h("div", { class: "rad" }, "Netto, udiskontert", h("b", { class: "tall" }, kr(r.netto))) : null,
      ...(stor && r.laan > 0 ? [
        h("div", { class: "rad" }, "Lån ut over rammen", h("b", { class: "tall minus" }, kr(r.laan))),
        h("div", { class: "rad" }, `Rente, ${pst(s.laanRente ?? 0)} p.a.`, h("b", { class: "tall minus" }, kr(r.rentekostnad))),
        h("div", { class: "rad" }, "Nåverdi etter rente", h("b", { class: "tall" }, kr(r.nvEtterRente))),
      ] : []),
      statusTekst(r)));
  }
  // Avstå er alltid et valg, så den står sist som en liten bolk
  el.append(h("div", { class: "stripe-del liten", style: "--c: var(--graa)" },
    h("div", { class: "navn" }, "Avstå"),
    h("div", { class: "nv tall" }, kr(0)),
    h("div", { class: "rad" }, "Ingen risiko, ingen inntekt")));
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
    h("th", {}, "Oppsett"), h("th", {}, "Sal"), h("th", {}, "Forslag"), h("th", { class: "hoyre" }, "Billetter"), h("th", { class: "hoyre" }, "Leie"), h("th", { class: "hoyre" }, "Bidrag"), h("th", {}));
  const rader = d.program.map((k, i) => radForKonsert(k, i, res.egen.perKonsert[i], perKonsert));
  const sumBidrag = res.egen.perKonsert.reduce((a, k) => a + k.bidrag, 0);
  const fot = h("tfoot", {},
    h("tr", {}, h("td", { colspan: 8 }, "Sum bidrag fra konsertene"), h("td", { class: "hoyre tall" }, tall(res.egen.perKonsert.reduce((a, k) => a + k.n, 0))), h("td", { class: "hoyre tall" }, kr(res.egen.perKonsert.reduce((a, k) => a + k.leie, 0))), h("td", { class: `hoyre tall ${sumBidrag < 0 ? "minus" : ""}` }, kr(sumBidrag)), h("td")),
    res.egen.fastLeie ? h("tr", {}, h("td", { colspan: 10 }, `Faste leiebetalinger for sesongen (${res.egen.salerIBruk.map(id => salAv(id)?.navn).join(", ")})`), h("td", { class: "hoyre tall minus" }, kr(-res.egen.fastLeie)), h("td")) : null,
    h("tr", {}, h("td", { colspan: 10 }, "Samlet netto for sesongen, udiskontert"), h("td", { class: `hoyre tall ${res.egen.netto < 0 ? "minus" : ""}` }, kr(res.egen.netto)), h("td")));
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
  const forklaringsrad = fork("tr", "forklaringsrad", h("td", { colspan: 12 },
    k.i2026 ? h("span", {}, `I 2026: ${k.i2026.navn} i ${k.i2026.lokale} (${k.i2026.kapasitet} plasser i alt), ${tall(k.salg2026)} betalte billetter. `) : null,
    f ? h("span", {}, `Forslag: ${f.hvorfor}`) : null));
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
  let venter = false;
  const oppdaterInnhold = () => {
    lagre();
    if (venter) return;
    venter = true;
    requestAnimationFrame(() => { venter = false; const r = beregn(); renderStripe(r); tegnScenarioer(); innhold.replaceChildren(); fyllResultater(innhold, r); });
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
  main.append(h("section", { class: "seksjon" },
    h("h2", {}, "Finjuster: hva om salget eller pakkeprisen blir noe annet?"),
    fork("p", "ingress", "Dra i gliderne for verdier mellom scenarioene. Alt på siden regnes på nytt. Basis er Majas premiss: samme salg som i 2026 og 60 000 kr per konsert."),
    h("div", { class: "glidere" },
      glider("Etterspørsel i forhold til 2026", "etterspoerselsfaktor", 0.5, 1.3, 0.01, pst, 1),
      glider("Pakkepris per konsert", "pakke", 48000, 78000, 500, kr, 60000))));
  main.append(innhold);
  fyllResultater(innhold, res);
}

function fyllResultater(innhold, res) {
  const d = state.data;
  const s = d.sesong;
  const ref = salAv(state.referanse) ?? d.saler[0];

  innhold.append(h("section", { class: "seksjon" },
    fork("p", "ingress", "Stripa øverst viser nåverdi med 4 % realrente per år, og det største beløpet Sceneskift ligger ute med underveis, målt ved månedsslutt. Avstå gir null i begge. Ligger behovet over rammen, vises lånet som trengs (det saldoen ligger under rammen, som en kassekreditt) og renten på det. Renten holdes utenfor nåverdien, slik casen krever, og vises som egen linje."),
    res.blandet ? h("p", { class: "varsel" }, `Egen plan bruker ${res.egen.salerIBruk.map(id => salAv(id)?.navn).join(" og ")}. Casen sier at avtalene gjelder hele programmet, så en blanding krever at utleierne godtar enkeltkonserter. Vis det som et alternativ Maja kan ta opp før signering, ikke som et tilbud som finnes.`) : null,
    lokaleeffektMerknad()));

  innhold.append(konsekvenstabell(res));

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
      h("tbody", {}, rad("Billettoppgjør", L.billetter), rad("Publikumsutgift", L.utgift), rad("Pakke", L.pakke), rad("Leie", L.leie), rad("Sum i måneden", res.egen.cf), rad("Saldo", res.egen.saldo, "saldo"),
        ...(res.egen.laan > 0 ? [rad("Under rammen, lån", res.egen.trekk.map(x => -x)), rad("Rente på lånet", res.egen.renter.map(x => -x))] : []))))));
}

/** Merknad når en sal har lokaleeffekt ulik 100 %, så det ikke skjer i stillhet. */
function lokaleeffektMerknad() {
  const saler = state.data.saler.filter(s => (s.lokaleeffekt ?? 1) !== 1);
  if (!saler.length) return null;
  return h("p", { class: "varsel", style: "margin-top: 12px" }, h("span", { class: "merke varsel" }, "følsomhet"), " ",
    `Lokaleeffekt: ${saler.map(s => `${s.navn} ${pst(s.lokaleeffekt)}`).join(", ")}. Salget i ${saler.length === 1 ? "den salen" : "de salene"} regnes som den andelen av etterspørselen, og taket i salen gjelder fortsatt. Majas premiss er 100 %. Endres under Saler.`);
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
      h("div", { class: `tall nv-celle ${r.nv < 0 ? "minus" : ""}` }, kr(r.nv)),
      h("div", { class: `liten tall ${over ? "minus" : "svak"}` }, r.behov ? `trenger ${tall(r.behov)}${over ? ", over rammen" : ""}` : "trenger 0"));
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
      h("p", { class: "liten svak" }, `Alt i denne salen: nåverdi ${kr(r.nv)}, trenger ${kr(r.behov)}.`, fork("span", "", ` ${brukt ? `Valgt på ${brukt} ${brukt === 1 ? "konsert" : "konserter"} i egen plan.` : "Ikke valgt på noen konsert i egen plan."}`)),
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
  for (const [felt, navn, enhet, kilde, o] of felter) {
    const vis = v => o.pst ? Math.round(v * 1000) / 10 : v;
    const basis = SESONG_2027[felt];
    boks.append(h("div", { class: "rad" },
      h("label", { for: `f-${felt}` }, navn),
      h("input", { id: `f-${felt}`, type: "number", step: o.step, value: vis(s[felt]), onchange: e => { const v = Number(e.target.value); s[felt] = o.pst ? v / 100 : v; oppdater(); } }),
      h("span", { class: "svak" }, enhet),
      fork("span", "liten svak", kilde),
      s[felt] !== basis ? h("button", { type: "button", class: "stille liten", onclick: () => { s[felt] = basis; oppdater(); } }, `Tilbake til casen (${vis(basis)} ${enhet})`) : h("span", { class: "liten svak" }, "Som i casen")));
  }
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
}

document.addEventListener("DOMContentLoaded", init);

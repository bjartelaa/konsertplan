// Sjangerregel: sjanger gir forslag til oppsett (sitte eller stå), forventet salg gir forslag
// til sal (den billigste salen som kan velges per konsert og har plass i det oppsettet).
// Regelen er enkel med vilje, og vises åpent i grensesnittet så Maja kan overstyre den.
import { barTilSceneskift, beregnPlan, billetter, fasteLeiebetalinger, kapasitet, leieForKonsert } from "./motor.js";

export const SITTENDE = ["indiefolk", "visepop", "jazz", "nordisk soul", "soul / jazz", "soul", "drømmepop", "folk", "klassisk", "vise"];
export const STAAENDE = ["alternativ pop", "elektronika", "shoegaze", "indierock", "synthpop", "elektronisk pop", "pop", "rock", "hiphop", "elektronisk"];

export function oppsettForSjanger(sjanger) {
  const s = (sjanger ?? "").trim().toLowerCase();
  if (!s) return null;
  if (SITTENDE.some(x => s === x || s.includes(x))) return "sitte";
  if (STAAENDE.some(x => s === x || s.includes(x))) return "staa";
  return null;
}

/**
 * Forslag for én konsert. Returnerer { oppsett, salId, hvorfor, kappet } eller null hvis ingen sal passer.
 * Saler med kunHelSesong holdes utenfor, siden de ikke kan velges per konsert.
 */
export function forslagForKonsert(sesong, saler, konsert) {
  const oppsett = oppsettForSjanger(konsert.sjanger) ?? konsert.oppsett ?? "staa";
  const kandidater = saler.filter(s => !s.kunHelSesong);
  const vurdert = kandidater.map(s => {
    const b = billetter(sesong, konsert, s, oppsett);
    if (!b.mulig) return null;
    const leie = leieForKonsert(sesong, s, b.n).sum;
    const bidrag = b.n * (sesong.billettpris - sesong.gebyr - sesong.utgiftPerBillett + barTilSceneskift(sesong)) - leie;
    return { sal: s, n: b.n, onsket: b.onsket, kap: b.kap, kappet: b.kappet, leie, bidrag };
  }).filter(Boolean);
  if (vurdert.length === 0) return null;
  const medPlass = vurdert.filter(v => !v.kappet);
  let valg, hvorfor;
  if (medPlass.length) {
    valg = medPlass.reduce((a, b) => (b.leie < a.leie ? b : a));
    const andre = medPlass.filter(v => v !== valg).map(v => `${v.sal.kort ?? v.sal.navn} ${krTekst(v.leie)}`);
    hvorfor = `${oppsettTekst(oppsett)} ut fra sjangeren. ${valg.sal.navn} har plass til ${Math.round(valg.onsket)} og er billigst med ${krTekst(valg.leie)} i leie` +
      (andre.length ? ` (${andre.join(", ")})` : "") +
      (vurdert.length > medPlass.length ? `. ${vurdert.filter(v => v.kappet).map(v => `${v.sal.navn} har bare plass til ${v.kap}`).join(", ")}` : "") + ".";
  } else {
    valg = vurdert.reduce((a, b) => (b.bidrag > a.bidrag ? b : a));
    hvorfor = `${oppsettTekst(oppsett)} ut fra sjangeren. Ingen sal har plass til ${Math.round(valg.onsket)} ${oppsett === "sitte" ? "sittende" : "stående"}. ${valg.sal.navn} gir høyest bidrag, men salget kappes til ${valg.kap}.`;
  }
  return { oppsett, salId: valg.sal.id, hvorfor, kappet: valg.kappet, vurdert };
}

const krTekst = v => Math.round(v).toLocaleString("nb-NO") + " kr";
const oppsettTekst = o => (o === "sitte" ? "Sittende" : "Stående");

/**
 * Beste blanding: den kombinasjonen av saler per konsert som gir høyest nåverdi og holder rammen.
 * Hver sal får det oppsettet som gir høyest bidrag på konserten. Saler med kunHelSesong holdes utenfor.
 * Med få saler prøves alle kombinasjonene (to saler og tolv konserter er 4 096). Med flere (tre saler er
 * 531 441) starter søket fra flere utgangspunkt: alt i hver sal, høyest bidrag per konsert og beste blanding
 * av salene uten fast leie. Derfra byttes sal på én konsert om gangen så lenge det blir bedre, regnet med
 * hele motoren, så sesongleie og ramme er med. Returnerer { valg: [{ salId, oppsett }], nv, behov, holderRammen } eller null.
 */
export function besteBlanding(sesong, saler, program) {
  const kandidater = saler.filter(s => !s.kunHelSesong);
  const margin = sesong.billettpris - sesong.gebyr - sesong.utgiftPerBillett + barTilSceneskift(sesong); // bar er utvidelse, standard 0
  const valgPerKonsert = program.map(k => kandidater.map(s => {
    let best = null;
    for (const oppsett of ["staa", "sitte"]) {
      const b = billetter(sesong, k, s, oppsett);
      if (!b.mulig) continue;
      const bidrag = b.n * margin - leieForKonsert(sesong, s, b.n).sum;
      if (!best || bidrag > best.bidrag) best = { salId: s.id, oppsett, bidrag };
    }
    return best;
  }).filter(Boolean));
  if (valgPerKonsert.some(v => v.length === 0)) return null;
  const regn = valg => {
    const p = beregnPlan(sesong, saler, program.map((k, i) => ({ ...k, salId: valg[i].salId, oppsett: valg[i].oppsett })), k => k.salId);
    return { valg, nv: p.nv, behov: p.behov, holderRammen: p.holderRammen !== false };
  };
  const bedre = (a, b) => (a.holderRammen !== b.holderRammen ? a.holderRammen : a.nv > b.nv);
  const alleKombinasjoner = valg => {
    const antall = valg.reduce((a, v) => a * v.length, 1);
    if (antall > 65536) return null;
    let best = null;
    const indeks = program.map(() => 0);
    for (let n = 0; n < antall; n++) {
      let rest = n;
      for (let i = 0; i < program.length; i++) { indeks[i] = rest % valg[i].length; rest = Math.floor(rest / valg[i].length); }
      const r = regn(valg.map((v, i) => v[indeks[i]]));
      if (!best || bedre(r, best)) best = r;
    }
    return best;
  };
  const alle = alleKombinasjoner(valgPerKonsert);
  if (alle) return alle;

  // For mange kombinasjoner: flere utgangspunkt, så forbedring én konsert om gangen
  const start = [valgPerKonsert.map(v => v.reduce((a, b) => (b.bidrag > a.bidrag ? b : a)))];
  for (const s of kandidater) {
    const alleI = valgPerKonsert.map(v => v.find(o => o.salId === s.id));
    if (alleI.every(Boolean)) start.push(alleI);
  }
  const utenFast = valgPerKonsert.map(v => v.filter(o => fasteLeiebetalinger(kandidater.find(s => s.id === o.salId)).length === 0));
  if (utenFast.every(v => v.length)) { const r = alleKombinasjoner(utenFast); if (r) start.push(r.valg); }
  let best = null;
  for (const valg of start) {
    let naa = regn(valg), bedret = true;
    while (bedret) {
      bedret = false;
      for (let i = 0; i < program.length; i++) {
        for (const o of valgPerKonsert[i]) {
          if (o === naa.valg[i]) continue;
          const r = regn(naa.valg.map((v, j) => (j === i ? o : v)));
          if (bedre(r, naa)) { naa = r; bedret = true; }
        }
      }
    }
    if (!best || bedre(naa, best)) best = naa;
  }
  return best;
}

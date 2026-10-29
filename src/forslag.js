// Sjangerregel: sjanger gir forslag til oppsett (sitte eller stå), forventet salg gir forslag
// til sal (den billigste salen som kan velges per konsert og har plass i det oppsettet).
// Regelen er enkel med vilje, og vises åpent i grensesnittet så Maja kan overstyre den.
import { billetter, kapasitet, leieForKonsert } from "./motor.js";

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
  const onsket = (konsert.forventetSalg ?? 0) * (sesong.etterspoerselsfaktor ?? 1);
  const vurdert = kandidater.map(s => {
    const b = billetter(sesong, konsert, s, oppsett);
    if (!b.mulig) return null;
    const leie = leieForKonsert(sesong, s, b.n).sum;
    const bidrag = b.n * (sesong.billettpris - sesong.gebyr - sesong.utgiftPerBillett) - leie;
    return { sal: s, n: b.n, kap: b.kap, kappet: b.kappet, leie, bidrag };
  }).filter(Boolean);
  if (vurdert.length === 0) return null;
  const medPlass = vurdert.filter(v => !v.kappet);
  let valg, hvorfor;
  if (medPlass.length) {
    valg = medPlass.reduce((a, b) => (b.leie < a.leie ? b : a));
    const andre = medPlass.filter(v => v !== valg).map(v => `${v.sal.kort ?? v.sal.navn} ${kr(v.leie)}`);
    hvorfor = `${oppsettTekst(oppsett)} ut fra sjangeren. ${valg.sal.navn} har plass til ${Math.round(onsket)} og er billigst med ${kr(valg.leie)} i leie` +
      (andre.length ? ` (${andre.join(", ")})` : "") +
      (vurdert.length > medPlass.length ? `. ${vurdert.filter(v => v.kappet).map(v => `${v.sal.navn} har bare plass til ${v.kap}`).join(", ")}` : "") + ".";
  } else {
    valg = vurdert.reduce((a, b) => (b.bidrag > a.bidrag ? b : a));
    hvorfor = `${oppsettTekst(oppsett)} ut fra sjangeren. Ingen sal har plass til ${Math.round(onsket)} ${oppsett === "sitte" ? "sittende" : "stående"}. ${valg.sal.navn} gir høyest bidrag, men salget kappes til ${valg.kap}.`;
  }
  return { oppsett, salId: valg.sal.id, hvorfor, kappet: valg.kappet, vurdert };
}

const kr = v => Math.round(v).toLocaleString("nb-NO") + " kr";
const oppsettTekst = o => (o === "sitte" ? "Sittende" : "Stående");

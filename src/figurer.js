// SVG-figurer tegnet for hånd, samme teknikk som presentasjonen i sceneskift-kart.
const SVG_NS = "http://www.w3.org/2000/svg";

export function svgEl(tag, attrs = {}, tekst) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (tekst !== undefined) e.textContent = tekst;
  return e;
}

const tallF = v => Math.round(v).toLocaleString("nb-NO");
const pent = (v, steg) => Math.ceil(v / steg) * steg;

function stegFor(spenn) {
  const kandidater = [10000, 20000, 25000, 50000, 100000, 200000, 250000, 500000];
  return kandidater.find(s => spenn / s <= 7) ?? 1000000;
}

/** Saldo per måned: én linje per serie. serier = [{navn, farge, verdier, bred}] */
export function tegnSaldo(svg, serier, etiketter, ramme) {
  svg.replaceChildren();
  const W = 900, H = 420;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const P = { x1: 90, x2: W - 24, y1: 24, y2: H - 54 };
  const alle = serier.flatMap(s => s.verdier);
  const steg = stegFor(Math.max(...alle) - Math.min(...alle, -ramme));
  const ymin = Math.floor(Math.min(...alle, -ramme) / steg) * steg;
  const ymax = pent(Math.max(...alle, 0), steg);
  const n = etiketter.length;
  const sx = i => P.x1 + (i / (n - 1)) * (P.x2 - P.x1);
  const sy = v => P.y2 - ((v - ymin) / (ymax - ymin)) * (P.y2 - P.y1);
  for (let v = ymin; v <= ymax; v += steg) {
    svg.appendChild(svgEl("line", { class: v === 0 ? "akse" : "rutenett", x1: P.x1, x2: P.x2, y1: sy(v), y2: sy(v) }));
    svg.appendChild(svgEl("text", { class: "etikett", x: P.x1 - 10, y: sy(v) + 4, "text-anchor": "end" }, tallF(v)));
  }
  if (ramme) {
    svg.appendChild(svgEl("line", { class: "rammestrek", x1: P.x1, x2: P.x2, y1: sy(-ramme), y2: sy(-ramme) }));
    svg.appendChild(svgEl("text", { class: "etikett minus", x: P.x2, y: sy(-ramme) - 6, "text-anchor": "end" }, `Rammen, ${tallF(ramme)} kr`));
  }
  etiketter.forEach((e, i) => svg.appendChild(svgEl("text", { class: "etikett", x: sx(i), y: P.y2 + 22, "text-anchor": "middle" }, e)));
  for (const s of serier) {
    const d = s.verdier.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
    svg.appendChild(svgEl("path", { class: "linje" + (s.bred ? " bred" : ""), d, style: `stroke: var(--${s.farge})` }));
    s.verdier.forEach((v, i) => svg.appendChild(svgEl("circle", { cx: sx(i), cy: sy(v), r: s.bred ? 4.5 : 3, style: `fill: var(--${s.farge})` })));
    if (s.bred) {
      const siste = s.verdier.length - 1;
      svg.appendChild(svgEl("text", { class: "serie", x: sx(siste) - 8, y: sy(s.verdier[siste]) - 12, "text-anchor": "end", style: `fill: var(--${s.farge})` }, s.navn));
    }
  }
}

/** Bidrag per konsert: to stolper per konsert. serier = [{navn, farge, verdier}], etiketter per konsert. */
export function tegnBidrag(svg, serier, etiketter) {
  svg.replaceChildren();
  const W = 900, H = 380;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const P = { x1: 90, x2: W - 24, y1: 24, y2: H - 54 };
  const alle = serier.flatMap(s => s.verdier);
  const steg = stegFor(Math.max(...alle, 0) - Math.min(...alle, 0));
  const ymin = Math.floor(Math.min(...alle, 0) / steg) * steg;
  const ymax = pent(Math.max(...alle, 0), steg);
  const n = etiketter.length;
  const gruppe = (P.x2 - P.x1) / n;
  const bredde = Math.min(26, (gruppe - 10) / serier.length);
  const sy = v => P.y2 - ((v - ymin) / (ymax - ymin)) * (P.y2 - P.y1);
  for (let v = ymin; v <= ymax; v += steg) {
    svg.appendChild(svgEl("line", { class: v === 0 ? "akse" : "rutenett", x1: P.x1, x2: P.x2, y1: sy(v), y2: sy(v) }));
    svg.appendChild(svgEl("text", { class: "etikett", x: P.x1 - 10, y: sy(v) + 4, "text-anchor": "end" }, tallF(v)));
  }
  etiketter.forEach((e, i) => svg.appendChild(svgEl("text", { class: "etikett", x: P.x1 + gruppe * (i + 0.5), y: P.y2 + 22, "text-anchor": "middle" }, e)));
  serier.forEach((s, j) => {
    s.verdier.forEach((v, i) => {
      const x = P.x1 + gruppe * (i + 0.5) - (serier.length * bredde) / 2 + j * bredde;
      svg.appendChild(svgEl("rect", { x, y: Math.min(sy(v), sy(0)), width: bredde - 3, height: Math.abs(sy(v) - sy(0)), style: `fill: var(--${s.farge})`, opacity: j === 0 ? 1 : 0.55 }));
    });
  });
}

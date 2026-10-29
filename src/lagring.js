// Lagring: localStorage automatisk, og JSON-fil med «Lagre sesong» og «Åpne sesong».
const NOKKEL = "konsertplan.sesong.v1";

export function lesLokalt() {
  try {
    const t = localStorage.getItem(NOKKEL);
    return t ? JSON.parse(t) : null;
  } catch { return null; }
}

export function lagreLokalt(data) {
  try { localStorage.setItem(NOKKEL, JSON.stringify(data)); } catch { /* privat vindu eller fullt lager */ }
}

export function slettLokalt() {
  try { localStorage.removeItem(NOKKEL); } catch { /* ingenting å gjøre */ }
}

export function lastNedFil(data, filnavn) {
  const blob = new Blob([JSON.stringify({ format: "konsertplan", versjon: 1, lagret: new Date().toISOString(), ...data }, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filnavn;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function lesFil(fil) {
  return new Promise((ok, feil) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d.sesong || !Array.isArray(d.saler) || !Array.isArray(d.program)) throw new Error("Fila mangler sesong, saler eller program.");
        ok({ sesong: d.sesong, saler: d.saler, program: d.program });
      } catch (e) { feil(e); }
    };
    r.onerror = () => feil(new Error("Kunne ikke lese fila."));
    r.readAsText(fil);
  });
}

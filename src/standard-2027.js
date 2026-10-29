// Sceneskift våren 2027 slik casen i MET3 AK2 beskriver den. Dette er utgangspunktet i alt:
// siden åpner med denne sesongen, og «tilbake til casen» henter verdier herfra.
// Kilder: oppgaveteksten (Majas forutsetninger og de tre tilbudene), program.html på
// Sceneskifts case-nettside, og 2026-salget fra ordreeksporten (betalte billetter uten
// avbrutte og dupliserte transaksjoner, se forstaelse.md kap. 2).

export const SESONG_2027 = {
  navn: "Sceneskift våren 2027",
  aar: 2027,
  billettpris: 350,          // kr per betalt billett, alle billetter (ingen rabatter i 2027)
  gebyr: 10,                 // kr per betalt billett, trekkes i billettoppgjøret
  utgiftPerBillett: 10,      // andre publikumsavhengige utgifter, betalt i konsertmåneden
  pakke: 60000,              // artist og øvrig produksjon (Rigg & Ro), fast per konsert
  pakkeDel1Andel: 0.5,       // halvparten måneden før, resten i konsertmåneden
  rente: 0.04,               // real årsrente
  konvensjon: "aar",         // (1 + r)^(t/12). "maaned" gir (1 + r/12)^t
  ramme: 250000,             // startfinansiering Maja tror hun kan skaffe
  etterspoerselsfaktor: 1,   // 1 = Majas premiss: samme salg som 2026
  maanedsnavn: ["Før januar", "Januar", "Februar", "Mars", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Desember"],
};

export const SALER_2027 = [
  {
    id: "A", navn: "Lune Sal", kort: "A", farge: "blaa",
    beskrivelse: "Liten kultursal i et tidligere snekkerverksted. Lav scene, intimt.",
    kilde: "https://alu042.github.io/met3-lune-sal/", bilde: "img/lune-sal.jpg",
    kapasitet: { staa: null, sitte: 250 }, sitteAntatt: false,
    kapasitetNotat: "Tilbudet: 250 salgbare plasser. Nettsiden sier 270 seter. Regnes som sittende sal uten ståoppsett (antatt).",
    kunHelSesong: false,
    leie: [{ type: "perKonsert", belop: 9000, naar: "konsertmaaned" }],
  },
  {
    id: "B", navn: "Søyleverket", kort: "B", farge: "gul",
    beskrivelse: "Kulturrom med flatt gulv, fast scene og løse stoler. Fast sesongleie.",
    kilde: "https://alu042.github.io/met3-soyleverket/", bilde: "img/soyleverket.jpg",
    kapasitet: { staa: 450, sitte: 250 }, sitteAntatt: true,
    kapasitetNotat: "Tilbudet: 450 salgbare plasser. Nettsiden sier inntil 500 personer. Sitteplasser 250 er antatt (løse stoler på flatt gulv).",
    kunHelSesong: true,
    leie: [
      { type: "engang", belop: 35000, tidspunkt: 0, navn: "Engangstilpasning" },
      { type: "sesong", belop: 140000, plan: [{ tidspunkt: 0, andel: 0.5 }, { tidspunkt: 3, andel: 0.5 }], navn: "Sesongleie" },
    ],
  },
  {
    id: "C", navn: "Skarvkaien", kort: "C", farge: "rosa",
    beskrivelse: "Havnelager med fast scene og åpent gulv. Leien følger billettoppgjøret.",
    kilde: "https://alu042.github.io/met3-skarvkaien/", bilde: "img/skarvkaien.jpg",
    kapasitet: { staa: 450, sitte: 200 }, sitteAntatt: true,
    kapasitetNotat: "Tilbudet: 450 salgbare plasser. Nettsiden sier inntil 490 stående. Sitteplasser 200 er antatt (kan rigges sittende).",
    kunHelSesong: false,
    leie: [{ type: "andel", andel: 0.18, minimum: 7500, naar: "maanedEtter" }],
  },
];

// Programmet fra program.html, 2026-salget fra ordrene (K01 til K12 i samme rekkefølge).
const P = [
  [1, "15.01", "June Varde", "Indiefolk", 1, 140],
  [2, "29.01", "Mellomlys", "Drømmepop", 1, 190],
  [3, "12.02", "Liv Eik", "Nordisk soul", 2, 230],
  [4, "26.02", "Blåtimekvartetten", "Jazz", 2, 310],
  [5, "12.03", "Ravlinje", "Elektronika", 3, 370],
  [6, "26.03", "Vesperhagen", "Alternativ pop", 3, 480],
  [7, "09.04", "Iben Vår", "Visepop", 4, 160],
  [8, "23.04", "Sølvregn", "Shoegaze", 4, 250],
  [9, "07.05", "Dobbeltspor", "Indierock", 5, 330],
  [10, "28.05", "Nattfiol", "Synthpop", 5, 420],
  [11, "11.06", "Ada Mørk", "Soul / jazz", 6, 210],
  [12, "25.06", "Glassmorgen", "Elektronisk pop", 6, 290],
];

export const PROGRAM_2027 = P.map(([nr, dato, artist, sjanger, maaned, salg2026]) => ({
  nr, dato, artist, sjanger, maaned, salg2026,
  forventetSalg: salg2026,
  salId: "C",            // casens råd som utgangspunkt
  oppsett: "staa",
  notat: nr === 6 ? "«Vårens største navn» ifølge Sceneskift" : "",
}));

export const SJANGRE = [
  "Indiefolk", "Drømmepop", "Nordisk soul", "Jazz", "Elektronika", "Alternativ pop",
  "Visepop", "Shoegaze", "Indierock", "Synthpop", "Soul / jazz", "Elektronisk pop",
  "Pop", "Rock", "Hiphop", "Folk", "Klassisk", "Annet",
];

export function standardSesong() {
  return JSON.parse(JSON.stringify({ sesong: SESONG_2027, saler: SALER_2027, program: PROGRAM_2027 }));
}

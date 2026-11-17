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
  laanRente: 0.12,           // årlig rente på lån ut over rammen (kassekreditt). Gruppas antakelse, ikke fra casen
  // Utvidelser utenfor casen. Oppgaveteksten: «Utover postene i tabellen og lokaleleien er det ingen andre inntekter
  // eller kostnader.» Derfor står de på 0, som gir casens tall. De kan settes for å vise hva som skjer om det ikke stemmer.
  barPerGjest: 0,            // omsetning i baren per betalt billett, kr
  barAndel: 0,               // Sceneskifts andel av baromsetningen, gjøres opp måneden etter som billettene
  uforutsett: 0,             // buffer for kostnader pakken ikke dekker, kr per konsert, betalt i konsertmåneden
  markedsforing: 0,          // ekstra markedsføring for hele sesongen, fordelt likt på konsertene, betalt måneden før. Utenfor casen
  laanType: "kassekreditt",  // lån ut over rammen: "kassekreditt" (det som trengs hver måned) eller "fast" (fast beløp fra laanStart)
  laanStart: 0,              // fast lån: måneden lånet tas opp (0 = før januar)
  laanSlutt: null,           // fast lån: måneden det betales tilbake (null = når saldoen er innenfor rammen igjen)
  laanBelop: null,           // fast lån: beløpet (null = det største som trengs)
  scenarioer: [],            // fylles med SCENARIOER_2027 under
  maanedsnavn: ["Før januar", "Januar", "Februar", "Mars", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Desember"],
};

// Scenarioene fra arbeidsboka (Forutsetninger B13:F17). Hvert scenario setter etterspørselsfaktoren og
// pakkeprisen. Nivåene og begrunnelsene er gruppas, teksten er den samme som i arbeidsboka.
export const SCENARIOER_2027 = [
  { navn: "Basis", etterspoerselsfaktor: 1, pakke: 60000,
    begrunnelse: "Majas premiss: samme salg som tilsvarende konsert i 2026. Rigg & Ro-tilbudet på 60 000 kr." },
  { navn: "Lav etterspørsel", etterspoerselsfaktor: 0.8, pakke: 60000,
    begrunnelse: "Student- og tidligrabatten forsvinner. 1 203 av 3 380 betalte billetter i 2026 (36 %) var rabatterte og blir 9 til 17 % dyrere. Nivået er gruppas antakelse." },
  { navn: "Høyere pakkepris", etterspoerselsfaktor: 1, pakke: 66000,
    begrunnelse: "Rigg & Ro kan revidere tilbudet før signering. 10 % høyere pris er gruppas antakelse." },
  { navn: "Samlet", etterspoerselsfaktor: 0.8, pakke: 66000,
    begrunnelse: "Lav etterspørsel og høyere pakkepris samtidig (oppgavens samlede scenario). Høy etterspørsel er ikke med." },
  { navn: "Høy etterspørsel", etterspoerselsfaktor: 1.2, pakke: 60000, oppside: true,
    begrunnelse: "Oppside: 20 % flere betalte billetter enn i 2026. Gruppas antakelse, inngår ikke i beslutningsreglene." },
];
SESONG_2027.scenarioer = SCENARIOER_2027;

export const SALER_2027 = [
  {
    id: "A", navn: "Lune Sal", kort: "A", farge: "blaa",
    beskrivelse: "Liten kultursal i et tidligere snekkerverksted. Lav scene, intimt.",
    kilde: "https://alu042.github.io/met3-lune-sal/", bilde: "img/lune-sal.webp",
    kapasitet: { staa: null, sitte: 250 }, sitteAntatt: false, lokaleeffekt: 1,
    kapasitetNotat: "Tilbudet: 250 salgbare plasser. Nettsiden sier 270 seter. Regnes som sittende sal uten ståoppsett (antatt).",
    kunHelSesong: false,
    leie: [{ type: "perKonsert", belop: 9000, naar: "konsertmaaned" }],
  },
  {
    id: "B", navn: "Søyleverket", kort: "B", farge: "gul",
    beskrivelse: "Kulturrom med flatt gulv, fast scene og løse stoler. Fast sesongleie.",
    kilde: "https://alu042.github.io/met3-soyleverket/", bilde: "img/soyleverket.webp",
    kapasitet: { staa: 450, sitte: 250 }, sitteAntatt: true, lokaleeffekt: 1,
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
    kilde: "https://alu042.github.io/met3-skarvkaien/", bilde: "img/skarvkaien.webp",
    kapasitet: { staa: 450, sitte: 200 }, sitteAntatt: true, lokaleeffekt: 1,
    kapasitetNotat: "Tilbudet: 450 salgbare plasser. Nettsiden sier inntil 490 stående. Sitteplasser 200 er antatt (kan rigges sittende).",
    kunHelSesong: false,
    leie: [{ type: "andel", andel: 0.18, minimum: 7500, naar: "maanedEtter" }],
  },
];

// Programmet fra program.html, 2026-salget fra ordrene (K01 til K12 i samme rekkefølge),
// og tilsvarende konsert i 2026 fra arkiv.html og oppgjørsfila (navn, lokale, total kapasitet).
// Verkstedet (320) og Maskinhallen (550) er lokalene Sceneskift brukte i 2026.
const P = [
  [1, "15.01", "June Varde", "Indiefolk", "Solo, gitar", 1, 140, "Låtskriverkveld", "Verkstedet", 320],
  [2, "29.01", "Mellomlys", "Drømmepop", "Duo, gitar og synther", 1, 190, "To stemmer", "Verkstedet", 320],
  [3, "12.02", "Liv Eik", "Nordisk soul", "Band, tangenter, bass og trommer", 2, 230, "Soul på verkstedet", "Verkstedet", 320],
  [4, "26.02", "Blåtimekvartetten", "Jazz", "Kvartett", 2, 310, "Fredagsjazz", "Maskinhallen", 550],
  [5, "12.03", "Ravlinje", "Elektronika", "Duo, synther og trommemaskiner", 3, 370, "Elektronisk vår", "Maskinhallen", 550],
  [6, "26.03", "Vesperhagen", "Alternativ pop", "Femmannsband", 3, 480, "Pop i hallen", "Maskinhallen", 550],
  [7, "09.04", "Iben Vår", "Visepop", "Solo, piano og gitar", 4, 160, "Nære viser", "Verkstedet", 320],
  [8, "23.04", "Sølvregn", "Shoegaze", "Band, to gitarer, bass og trommer", 4, 250, "Gitarer i skumringen", "Verkstedet", 320],
  [9, "07.05", "Dobbeltspor", "Indierock", "Band, to vokalister", 5, 330, "Bandfredag", "Maskinhallen", 550],
  [10, "28.05", "Nattfiol", "Synthpop", "Trio, vokal, synther og elektroniske trommer", 5, 420, "Synthnatt", "Maskinhallen", 550],
  [11, "11.06", "Ada Mørk", "Soul / jazz", "Vokal med trio", 6, 210, "Soul i juni", "Verkstedet", 320],
  [12, "25.06", "Glassmorgen", "Elektronisk pop", "Duo, vokal, keyboard og elektronikk", 6, 290, "Vårens siste tone", "Maskinhallen", 550],
];

export const PROGRAM_2027 = P.map(([nr, dato, artist, sjanger, besetning, maaned, salg2026, navn2026, lokale2026, kap2026]) => ({
  nr, dato, artist, sjanger, besetning, maaned, salg2026,
  i2026: { navn: navn2026, lokale: lokale2026, kapasitet: kap2026 },
  forventetSalg: salg2026,
  salId: "C",            // casens råd som utgangspunkt
  pakkeAvvik: 0,         // utvidelse: pakken for denne konserten minus sesongens pakke. 0 i casen (fast pris for alle)
  oppsett: "staa",
  notat: nr === 6 ? "«Vårens største navn» ifølge Sceneskift" : "",
}));

export const LOKALER_2026 = [
  { navn: "Verkstedet", kapasitet: 320, beskrivelse: "Lyst rom med spor av det gamle seilloftet, lav scene. Ligner Lune Sal i størrelse og stemning." },
  { navn: "Maskinhallen", kapasitet: 550, beskrivelse: "Takhøyde, mørke flater, plass til store lydlandskap. Ligner Skarvkaien." },
];

export const SJANGRE = [
  "Indiefolk", "Drømmepop", "Nordisk soul", "Jazz", "Elektronika", "Alternativ pop",
  "Visepop", "Shoegaze", "Indierock", "Synthpop", "Soul / jazz", "Elektronisk pop",
  "Pop", "Rock", "Hiphop", "Folk", "Klassisk", "Annet",
];

export function standardSesong() {
  return JSON.parse(JSON.stringify({ sesong: SESONG_2027, saler: SALER_2027, program: PROGRAM_2027 }));
}

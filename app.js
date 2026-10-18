/* app.js — Piantina corso: disegna le schermate e risponde ai tocchi.
   I dati li tiene dati.js. Le chiavi usate:
     classe:<id>           { nome, ordine }   ← l'elenco delle classi
   e, dentro ogni classe, con il prefisso "c:<idClasse>/":
     impostazioni          { righe, colonne }
     staff                 [{ id, nome, colore }]
     corsista:<id>         { nome, cognome, appunti: { generali, venSala, … } }
     piantina:<giorno>     { posti: { "riga-colonna": idCorsista }, staff: { idCorsista: [idStaff] } }
     diario:<giorno>:<id>  { ora, testo }
     test                  { coppie: [{ id, slot, posti: [sedia, sedia], seguono: [idStaff] }], supervisori: [idStaff],
                             assenti: ["c:<id>" | "s:<id>"] ← tolti dalle colonne con × (oggi non ci sono) }
                           sedia = { tipo: "corsista", id } | { tipo: "staff", id } (= allievo) | null
                           slot = numero del posto fisso nella stanza (3 per fila, da sinistra a destra e dall'alto) */
import * as D from "./dati.js";

const GIORNI = [
  { k: "ven", corto: "Ven", nome: "Venerdì" },
  { k: "sab", corto: "Sab", nome: "Sabato" },
  { k: "dom", corto: "Dom", nome: "Domenica" },
];
// gli spazi della scheda del corsista (sono anche le tacchette sul banco, una per spazio)
const CAMPI = [
  { k: "generali", gruppo: "Appunti generali" },
  { k: "venSala", gruppo: "Feedback venerdì", nome: "Sala" },
  { k: "venPausa", gruppo: "Feedback venerdì", nome: "Pausa" },
  { k: "venCaratteristica", gruppo: "Feedback venerdì", nome: "Caratteristica da allenare", tipo: "scelta" },
  { k: "venPerche", gruppo: "Feedback venerdì", nome: "Approfondimenti", aiuto: "Perché questa caratteristica? Cosa approfondire…" },
  { k: "sabMattina", gruppo: "Feedback sabato", nome: "Mattina" },
  { k: "pav18", gruppo: "Feedback sabato", sotto: "PAV", nome: "18 parole" },
  { k: "pav20", gruppo: "Feedback sabato", sotto: "PAV", nome: "20 guidate" },
  { k: "pavFormule", gruppo: "Feedback sabato", sotto: "PAV", nome: "Formule" },
  { k: "numerone", gruppo: "Feedback sabato", sotto: "PAV", nome: "Numerone" },
  { k: "domVocaboli", gruppo: "Feedback domenica", sotto: "Mattina", nome: "Vocaboli stranieri" },
  { k: "domAppunti", gruppo: "Feedback domenica", sotto: "Mattina", nome: "Appunti generali" },
  { k: "domTest", gruppo: "Feedback domenica", nome: "Test" },
];
// le caratteristiche del bambino da allenare (scelta nel feedback di venerdì)
const CARATTERISTICHE = [
  { nome: "Curiosità", colore: "#FBB424" },
  { nome: "Fiducia", colore: "#F97316" },
  { nome: "No paura del giudizio/fallimento", colore: "#E9446A" },
  { nome: "Tenacia", colore: "#8B4FC9" },
  { nome: "No limits", colore: "#0A84FF" },
  { nome: "Entusiasmo", colore: "#14A098" },
  { nome: "Protagonismo", colore: "#34A060" },
];
const coloreDi = nome => CARATTERISTICHE.find(x => x.nome === nome)?.colore || "transparent";
const COLORI = ["#F2C94C", "#6CB4FF", "#F28FB0", "#5FD3A0", "#B59CFF", "#F6A35C", "#4FD1E0", "#E57373"];

const $ = s => document.querySelector(s);
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SCHERMO_TELEFONO = matchMedia("(max-width: 700px)");
const telefono = () => SCHERMO_TELEFONO.matches;
const nuovoId = () => crypto.randomUUID().slice(0, 8);
function ricorda(k, v) {
  try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; }
}

// stato della schermata (non salvato online)
const S = {
  giorno: ricorda("piantina.giorno") || "ven",
  aperto: null,        // id del corsista con la scheda aperta
  sposta: false,       // modalità "Sposta"
  preso: null,         // { posto } oppure { id } quando stai spostando qualcuno
  evidenzia: null,     // id dello staff evidenziato (gli altri banchi si spengono)
  nuovoAccount: false,
  classe: null,        // id della classe aperta (null = elenco delle classi)
};

// ---------- le classi ----------
// Ogni classe (es. «Mind ottobre 2026») ha i suoi cassetti: "c:<idClasse>/staff", "c:<idClasse>/corsista:…".
// L / W / E leggono, scrivono ed elencano nella classe aperta (S.classe), senza il prefisso.
const pre = () => `c:${S.classe}/`;
const L = k => D.leggi(pre() + k);
const W = (k, v, opz) => D.scrivi(pre() + k, v, opz);
const E = p => D.elenco(pre() + p).map(([k, v]) => [k.slice(pre().length), v]);
const classe = id => D.leggi("classe:" + id);
const classi = () => D.elenco("classe:")
  .map(([k, v]) => ({ id: k.slice(7), ...v }))
  .sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0) || a.nome.localeCompare(b.nome, "it"));
const quantiIn = (id, cosa) => D.elenco(`c:${id}/${cosa}`).length;
function leggiIndirizzo() {
  const m = location.hash.match(/^#c=([\w-]+)/);
  S.classe = m && classe(m[1]) ? m[1] : null;
}

/** I dati di prima delle classi (senza prefisso) finiscono in una classe sola, «principale».
    Stesso id su ogni dispositivo: se lo fanno due dispositivi, il risultato è lo stesso. */
const VECCHIE = /^(impostazioni|staff|corsista:|piantina:|diario:)/;
function migra() {
  const vecchie = D.chiavi().filter(k => VECCHIE.test(k));
  if (!vecchie.length) return;
  D.senzaRegistro(() => migraOra(vecchie));
}
function migraOra(vecchie) {
  const id = "principale";
  if (!classe(id)) D.scrivi("classe:" + id, { nome: D.leggi("impostazioni")?.corso || "Il mio corso", ordine: 0 });
  vecchie.forEach(k => {
    if (D.leggi(`c:${id}/${k}`) == null) D.scrivi(`c:${id}/${k}`, D.leggi(k));
    D.scrivi(k, null);
  });
}

// ---------- i dati della classe aperta, in comodo ----------
const imp = () => ({ righe: 2, colonne: 6, ...(L("impostazioni") || {}) });
const staff = () => L("staff") || [];
const membro = id => staff().find(s => s.id === id);
const corsista = id => L("corsista:" + id);
const corsisti = () => E("corsista:")
  .map(([k, v]) => ({ id: k.slice(9), ...v }))
  .sort((a, b) => nomeIntero(a).localeCompare(nomeIntero(b), "it"));
const semplice = t => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const nomeIntero = c => [c?.nome, c?.cognome].filter(Boolean).join(" ") || "Senza nome";
const nomeGiorno = g => g === "test" ? "Test" : GIORNI.find(x => x.k === g).nome;
const pieni = c => CAMPI.filter(f => (c?.appunti?.[f.k] || "").trim()).length;

function piantina(g) {
  const p = L("piantina:" + g) || {};
  const posti = {};
  for (const [posto, id] of Object.entries(p.posti || {})) if (corsista(id)) posti[posto] = id;
  return { posti, staff: { ...(p.staff || {}) } };
}
const salvaPiantina = (g, p) => W("piantina:" + g, p);
const postoDi = (p, id) => Object.keys(p.posti).find(k => p.posti[k] === id);
const staffDi = (p, id) => (p.staff[id] || []).map(membro).filter(Boolean);
function postiValidi() {
  const { righe, colonne } = imp(), v = [];
  for (let r = 0; r < righe; r++) for (let c = 0; c < colonne; c++) v.push(`${r}-${c}`);
  return v;
}
/** chi non ha un banco nella piantina di quel giorno */
function fuoriSala(g) {
  const p = piantina(g), validi = new Set(postiValidi());
  const seduti = new Set(Object.entries(p.posti).filter(([k]) => validi.has(k)).map(([, id]) => id));
  return corsisti().filter(c => !seduti.has(c.id));
}

// ---------- disegno ----------
const app = $("#app");

function disegna() {
  if (!D.chiSei() && !D.PROVA) return disegnaAccesso();
  if (!S.classe) return disegnaClassi();
  app.innerHTML = `<div class="app" id="quadro">
    <header class="barra" id="barra"></header>
    <main class="sala-wrap" id="sala"></main>
    <footer class="diario" id="diario"></footer>
    <aside class="scheda" id="scheda"></aside>
  </div>`;
  disegnaBarra(); disegnaSala(); disegnaDiario(); disegnaScheda();
  new ResizeObserver(() => { scalaStanza(); adattaNomi(); }).observe($("#sala"));
}

function disegnaBarra() {
  $("#barra").innerHTML = `
    <div class="titolo">
      <button class="tasto indietro" data-az="classi" title="Tutte le classi" aria-label="Tutte le classi">‹</button>
      <div class="titolo-testo">${esc(classe(S.classe)?.nome || "Classe")}<small>Piantina corso</small></div>
    </div>
    <nav class="giorni">${[...GIORNI, { k: "test", corto: "Test" }].map(g => `<button class="${g.k === S.giorno ? "attivo" : ""}" data-az="giorno" data-g="${g.k}">${g.corto}</button>`).join("")}</nav>
    <div class="spazio"></div>
    <span class="sync" id="sync"></span>
    <div class="azioni">${S.giorno === "test" ? `
      <button class="btn" data-az="nuovo-corsista">+ Corsista</button>
      <button class="btn pieno" data-az="nuova-coppia">+ Coppia</button>` : `
      <button class="btn ${S.sposta ? "acceso" : ""}" data-az="sposta">${S.sposta ? "Fine" : "Sposta"}</button>
      <button class="btn" data-az="copia-su">Copia su…</button>
      <button class="btn pieno" data-az="nuovo-corsista">+ Corsista</button>`}
    </div>
    ${tastoAnnulla()}
    <button class="btn tondo" data-az="impostazioni" title="Impostazioni" aria-label="Impostazioni">⚙︎</button>`;
  mostraStato(D.stato_());
}

const tastoAnnulla = () => `<button class="btn tondo annulla" data-az="annulla" title="Annulla l'ultima azione (⌘Z)" aria-label="Annulla l'ultima azione" ${D.puoiAnnullare() ? "" : "disabled"}>↶</button>`;
function aggiornaAnnulla() {
  document.querySelectorAll("[data-az=annulla].tondo").forEach(b => { b.disabled = !D.puoiAnnullare(); });
}
/** annulla (o ripete) l'ultima azione e ridisegna tutto */
function eseguiAnnulla(ripeti = false) {
  if (!(ripeti ? D.ripeti() : D.annulla())) return avvisa(ripeti ? "Niente da ripetere" : "Niente da annullare");
  chiudiFoglio();
  Object.assign(S, { tSel: null, preso: null });
  if (S.classe && !classe(S.classe)) { location.hash = ""; S.classe = null; }
  disegna();
  avvisa(ripeti ? "Ripetuto" : "Annullato", !ripeti);
}

function mostraStato(s) {
  const el = $("#sync");
  if (!el) return;
  if (D.PROVA) { el.textContent = "modalità prova"; el.className = "sync prova"; return; }
  el.textContent = { ok: "✓ salvato", invio: "salvataggio…", offline: "offline · salvato qui" }[s];
  el.className = "sync " + s;
}

function disegnaSala() {
  if (S.giorno === "test") return disegnaTest();
  const { righe, colonne } = imp();
  const p = piantina(S.giorno);
  const sx = Math.ceil(colonne / 2), dx = colonne - sx;
  const ruotata = telefono();
  let griglia, celle;
  if (!ruotata) {
    // Mac e iPad: lavagna in alto, file dall'alto in basso, corridoio verticale
    const colonneCss = dx ? `repeat(${sx}, minmax(0,1fr)) var(--corridoio) repeat(${dx}, minmax(0,1fr))` : `repeat(${sx}, minmax(0,1fr))`;
    griglia = `grid-template-columns:${colonneCss};grid-template-rows:repeat(${righe}, minmax(108px, 1fr));max-height:${righe * 180}px`;
    celle = dx ? `<div class="corridoio" style="grid-column:${sx + 1};grid-row:1 / span ${righe}"></div>` : "";
    for (let r = 0; r < righe; r++) for (let c = 0; c < colonne; c++) {
      const posto = `${r}-${c}`;
      celle += htmlBanco(posto, p.posti[posto], p, `grid-row:${r + 1};grid-column:${c < sx ? c + 1 : c + 2}`);
    }
  } else {
    // telefono: la stessa sala girata di un quarto di giro (lavagna a sinistra), così i banchi sono larghi
    // e i nomi ci stanno interi. La metà destra della sala va in alto, il corridoio diventa orizzontale.
    const righeCss = dx ? `repeat(${dx}, auto) var(--corridoio) repeat(${sx}, auto)` : `repeat(${sx}, auto)`;
    griglia = `grid-template-columns:22px repeat(${righe}, minmax(0,1fr));grid-template-rows:${righeCss}`;
    celle = `<div class="lavagna-v" style="grid-column:1;grid-row:1 / -1"><span>lavagna</span></div>`
      + (dx ? `<div class="corridoio oriz" style="grid-row:${dx + 1};grid-column:2 / span ${righe}"></div>` : "");
    for (let r = 0; r < righe; r++) for (let c = 0; c < colonne; c++) {
      const posto = `${r}-${c}`, dallAlto = colonne - 1 - c;
      celle += htmlBanco(posto, p.posti[posto], p, `grid-column:${r + 2};grid-row:${c >= sx ? dallAlto + 1 : dallAlto + 2}`);
    }
  }
  const fuori = fuoriSala(S.giorno);
  const conti = {};
  Object.values(p.posti).forEach(id => (p.staff[id] || []).forEach(s => { conti[s] = (conti[s] || 0) + 1; }));
  const nomePreso = S.preso && nomeIntero(corsista(S.preso.id ?? p.posti[S.preso.posto]));

  $("#sala").innerHTML = `
    ${S.sposta ? `<div class="avviso">${S.preso
      ? `<b>${esc(nomePreso)}</b>: tocca il banco dove spostarlo (se è occupato si scambiano). <button class="link" data-az="annulla-preso">Annulla</button>`
      : "Tocca un corsista, poi il banco dove va. Puoi anche trascinarlo."}</div>` : ""}
    ${ruotata ? "" : `<div class="lavagna"><span>lavagna</span></div>`}
    <div class="sala ${ruotata ? "ruotata" : ""} ${S.sposta ? "spostando" : ""} ${S.evidenzia ? "evidenziando" : ""}" style="${griglia}">${celle}</div>
    <div class="fuori" id="fuori" data-zona="fuori">
      ${fuori.length ? `<span class="etic">Non in sala ${GIORNI.find(g => g.k === S.giorno).nome.toLowerCase()}</span>
        ${fuori.map(c => `<button class="chip persona ${S.preso?.id === c.id ? "preso" : ""}" draggable="true" data-az="fuori" data-id="${c.id}">${esc(nomeIntero(c))}</button>`).join("")}`
        : S.sposta ? `<span class="etic">Trascina qui un corsista per toglierlo dal banco</span>` : ""}
    </div>
    <div class="legenda">
      <span class="etic">Staff${staff().length ? `<span class="solo-grande"> · trascina sui banchi</span>` : ""}</span>
      ${staff().map(s => `<button class="chip ${S.evidenzia === s.id ? "attivo" : ""}" style="--colore:${s.colore}" draggable="true" data-az="evidenzia" data-sid="${s.id}" title="Trascina su un banco · tocca per evidenziare i suoi corsisti"><i></i>${esc(s.nome)} <b>${conti[s.id] || 0}</b></button>`).join("")}
      <button class="chip agg" data-az="gestisci-staff">${staff().length ? "✎ gestisci" : "+ aggiungi lo staff"}</button>
    </div>`;
  adattaNomi();
}

/** I nomi non si spezzano mai: se non stanno nel banco, il carattere si rimpicciolisce finché ci stanno. */
function adattaNomi() {
  document.querySelectorAll(".banco .nome, .banco .cognome, .t-nome").forEach(el => {
    el.style.fontSize = "";
    let misura = parseFloat(getComputedStyle(el).fontSize);
    const minimo = el.closest(".t-chip") ? 12 : 8;   // nelle pillole del test: mai sotto 12, piuttosto «…»
    while (el.scrollWidth > el.clientWidth + 0.5 && misura > minimo) {
      misura -= 0.5;
      el.style.fontSize = misura + "px";
    }
  });
}

function htmlBanco(posto, id, p, stile) {
  const c = id && corsista(id);
  const preso = S.preso && (S.preso.posto === posto) ? " preso" : "";
  if (!c) return `<button class="banco libero${preso}" style="${stile}" data-az="libero" data-posto="${posto}" aria-label="Banco libero">+</button>`;
  const ss = staffDi(p, id);
  const n = ss.length;
  const striscia = n ? `linear-gradient(90deg,${ss.map((s, i) => `${s.colore} ${(i * 100) / n}% ${((i + 1) * 100) / n}%`).join(",")})` : "var(--linea)";
  const spento = S.evidenzia && !ss.some(s => s.id === S.evidenzia) ? " spento" : "";
  const aperto = S.aperto === id ? " aperto" : "";
  const quanti = pieni(c);
  return `<div class="banco${preso}${spento}${aperto}" style="${stile};--striscia:${striscia}" draggable="true" data-posto="${posto}" data-id="${id}">
    <button class="b-apri" data-az="apri" data-id="${id}" data-posto="${posto}">
      <span class="nome">${esc(c.nome || "—")}</span>
      <span class="cognome">${esc(c.cognome || "")}</span>
      <span class="tacche" title="${quanti} spazi su ${CAMPI.length} già scritti">${CAMPI.map((_, i) => `<i class="${i < quanti ? "si" : ""}"></i>`).join("")}</span>
    </button>
    <div class="b-staff">
      ${n ? ss.slice(0, 2).map(s => `<button class="pill" style="--colore:${s.colore}" data-az="togli-staff-banco" data-id="${id}" data-sid="${s.id}" title="Togli ${esc(s.nome)} da questo banco"><i></i><span>${esc(s.nome)}</span><b>×</b></button>`).join("")
          + `<button class="piu" data-az="staff" data-id="${id}" data-g="${S.giorno}" title="Scegli lo staff">${n > 2 ? `+${n - 2}` : "+"}</button>`
          : `<button class="piu vuoto" data-az="staff" data-id="${id}" data-g="${S.giorno}" title="Scegli lo staff (o trascina qui un nome)">+ staff</button>`}
    </div>
  </div>`;
}

function disegnaScheda() {
  const corpo = $("#quadro"), el = $("#scheda");
  const c = S.aperto && corsista(S.aperto);
  if (!c) { S.aperto = null; corpo.classList.remove("con-scheda"); el.innerHTML = ""; scalaStanza(); return adattaNomi(); }
  corpo.classList.add("con-scheda");
  scalaStanza(); adattaNomi();   // la sala si è ristretta per far posto alla scheda
  const p = piantina(S.giorno), posto = postoDi(p, S.aperto);
  let gruppo = "", sotto = "", campi = "";
  for (const f of CAMPI) {
    if (sotto && (f.sotto !== sotto || f.gruppo !== gruppo)) { campi += "</div></div>"; sotto = ""; }
    if (f.gruppo !== gruppo) {
      campi += `${gruppo ? "</div>" : ""}<div class="gruppo"><h3>${f.gruppo}</h3>`;
      gruppo = f.gruppo;
    }
    if (f.sotto && f.sotto !== sotto) { campi += `<div class="campo"><label>${f.sotto}</label><div class="sotto">`; sotto = f.sotto; }
    const valore = c.appunti?.[f.k] || "";
    campi += `<div class="campo">${f.nome ? `<label for="c-${f.k}">${f.nome}</label>` : ""}
      ${f.tipo === "scelta"
        ? `<div class="scelta" style="--colore:${coloreDi(valore)}"><select id="c-${f.k}" data-campo="${f.k}">
            <option value="">Scegli la caratteristica…</option>
            ${CARATTERISTICHE.map(x => `<option ${x.nome === valore ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}
          </select></div>`
        : `<textarea id="c-${f.k}" data-campo="${f.k}" rows="2" placeholder="${f.aiuto || "Scrivi qui…"}">${esc(valore)}</textarea>`}</div>`;
  }
  campi += (sotto ? "</div></div>" : "") + "</div>";

  el.innerHTML = `
    <div class="s-capo">
      <div class="s-nomi">
        <input class="s-nome" data-nome="nome" value="${esc(c.nome || "")}" placeholder="Nome" aria-label="Nome" autocomplete="off">
        <input class="s-cognome" data-nome="cognome" value="${esc(c.cognome || "")}" placeholder="Cognome" aria-label="Cognome" autocomplete="off">
      </div>
      <div class="s-tasti">
        <button class="tasto" data-az="menu-corsista" title="Altro" aria-label="Altro">⋯</button>
        <button class="tasto" data-az="chiudi-scheda" title="Chiudi" aria-label="Chiudi">×</button>
      </div>
    </div>
    <div class="s-dove">${S.giorno === "test" ? dovenelTest(S.aperto)
      : posto ? `${nomeGiorno(S.giorno)}: fila ${+posto.split("-")[0] + 1}, banco ${+posto.split("-")[1] + 1}` : `Non in sala ${nomeGiorno(S.giorno).toLowerCase()}`}</div>
    <div class="chi">${GIORNI.map(g => {
      const ss = staffDi(piantina(g.k), S.aperto);
      return `<button class="mini" data-az="staff" data-id="${S.aperto}" data-g="${g.k}">
        <b>${g.corto}</b>${ss.length ? ss.map(s => `<span style="--colore:${s.colore}"><i></i>${esc(s.nome)}</span>`).join("") : `<span class="vuoto">—</span>`}</button>`;
    }).join("")}</div>
    ${campi}`;
  el.querySelectorAll("textarea").forEach(allunga);
}

/** dopo modifiche arrivate da altri dispositivi: aggiorno la scheda senza toccare ciò che stai scrivendo */
function aggiornaScheda() {
  const c = S.aperto && corsista(S.aperto);
  if (!c) return disegnaScheda();
  const scrivendo = document.activeElement?.closest?.("#scheda");
  if (!scrivendo) return disegnaScheda();
  document.querySelectorAll("#scheda [data-campo]").forEach(t => {
    const v = c.appunti?.[t.dataset.campo] || "";
    if (t !== document.activeElement && t.value !== v) {
      t.value = v;
      if (t.tagName === "SELECT") t.parentElement.style.setProperty("--colore", coloreDi(v)); else allunga(t);
    }
  });
  document.querySelectorAll("#scheda [data-nome]").forEach(i => {
    const v = c[i.dataset.nome] || "";
    if (i !== document.activeElement && i.value !== v) i.value = v;
  });
}

const allunga = t => { t.style.height = "auto"; t.style.height = t.scrollHeight + 2 + "px"; };

function disegnaDiario() {
  const chiuso = ricorda("piantina.diario") === "chiuso";
  const d = $("#diario");
  d.classList.toggle("chiuso", chiuso);
  d.innerHTML = `
    <button class="d-testa" data-az="diario-apri" aria-expanded="${!chiuso}">
      <span>Diario di bordo · ${nomeGiorno(S.giorno).toLowerCase()} <b id="d-conta"></b></span>
      <span class="d-freccia">${chiuso ? "▴ apri" : "▾ chiudi"}</span>
    </button>
    <div class="d-corpo">
      <section class="d-scrivi">
        <textarea id="d-testo" placeholder="Come sta andando la sala? Cosa noti? (Invio per aggiungere)"></textarea>
        <button class="btn" data-az="d-aggiungi">Aggiungi</button>
      </section>
      <section class="d-voci" id="d-voci"></section>
    </div>`;
  disegnaVoci();
}

function disegnaVoci() {
  const voci = E(`diario:${S.giorno}:`).map(([k, v]) => ({ k, ...v })).sort((a, b) => b.ora.localeCompare(a.ora));
  const conta = $("#d-conta");
  if (conta) conta.textContent = voci.length ? `${voci.length} ${voci.length === 1 ? "nota" : "note"}` : "";
  const attivo = document.activeElement?.dataset?.voce;
  if (attivo || !$("#d-voci")) return;   // stai correggendo una nota: non la ridisegno sotto le dita
  $("#d-voci").innerHTML = voci.length ? voci.map(v => `<div class="voce">
        <time>${new Date(v.ora).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</time>
        <textarea data-voce="${v.k}" rows="1" aria-label="Nota delle ${new Date(v.ora).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}">${esc(v.testo)}</textarea>
        <button class="tasto piccolo" data-az="d-elimina" data-voce="${v.k}" title="Elimina nota" aria-label="Elimina nota">×</button>
      </div>`).join("")
    : `<p class="tenue">Ancora nessuna nota: ognuna prende l'ora da sola.</p>`;
  document.querySelectorAll("#d-voci textarea").forEach(allunga);
}

// ---------- elenco delle classi ----------
function disegnaClassi() {
  const elenco = classi();
  app.innerHTML = `<div class="casa">
    <header class="barra">
      <div class="titolo"><div class="titolo-testo">Piantina corso<small>Le tue classi</small></div></div>
      <div class="spazio"></div>
      <span class="sync" id="sync"></span>
      ${tastoAnnulla()}
      <button class="btn tondo" data-az="account" title="Account e copie" aria-label="Account e copie">⚙︎</button>
    </header>
    <main class="classi" id="classi">
      <div class="classi-capo">
        <h1>Le tue classi</h1>
        <button class="btn pieno" data-az="nuova-classe">+ Nuova classe</button>
      </div>
      ${elenco.length ? `<div class="griglia-classi">${elenco.map((c, i) => `
        <div class="classe-card">
          <button class="classe-apri" data-az="apri-classe" data-cid="${c.id}">
            <b>${esc(c.nome)}</b>
            <span>${quantiIn(c.id, "corsista:")} corsisti · ${(D.leggi(`c:${c.id}/staff`) || []).length} staff</span>
          </button>
          <div class="classe-tasti">
            <button class="tasto piccolo" data-az="classe-sposta" data-cid="${c.id}" data-d="-1" ${i ? "" : "disabled"} title="Sposta su" aria-label="Sposta su">↑</button>
            <button class="tasto piccolo" data-az="menu-classe" data-cid="${c.id}" title="Rinomina, copia, elimina" aria-label="Altro">⋯</button>
            <button class="tasto piccolo" data-az="classe-sposta" data-cid="${c.id}" data-d="1" ${i < elenco.length - 1 ? "" : "disabled"} title="Sposta giù" aria-label="Sposta giù">↓</button>
          </div>
        </div>`).join("")}</div>`
      : `<p class="tenue vuota">Ancora nessuna classe. Crea la prima con «+ Nuova classe».</p>`}
    </main>
  </div>`;
  mostraStato(D.stato_());
}

function foglioNuovaClasse() {
  S.foglio = { tipo: "nuova-classe" };
  const elenco = classi();
  foglio(`<h2>Nuova classe</h2>
    <form data-form="nuova-classe" class="colonna">
      <label>Nome<input name="nome" placeholder="es. Mind ottobre 2026" autocomplete="off" autofocus required></label>
      ${elenco.length ? `<label>Staff e misure della sala
        <select name="da" class="tendina">
          <option value="${elenco[0].id}">Copia da «${esc(elenco[0].nome)}»</option>
          ${elenco.slice(1).map(c => `<option value="${c.id}">Copia da «${esc(c.nome)}»</option>`).join("")}
          <option value="">Parti da zero</option>
        </select></label>` : ""}
      <button class="btn pieno">Crea e apri</button>
    </form>`);
}

function foglioMenuClasse(cid) {
  S.foglio = { tipo: "menu-classe", cid };
  const c = classe(cid);
  foglio(`<h2>${esc(c.nome)}</h2>
    <label class="campo-largo">Nome della classe<input data-rinomina-classe="${cid}" value="${esc(c.nome)}" autocomplete="off"></label>
    <div class="colonna">
      <button class="btn" data-az="scarica-copia" data-cid="${cid}">Scarica una copia di sicurezza</button>
      <button class="btn rosso" data-az="elimina-classe" data-cid="${cid}">Elimina la classe</button>
    </div>
    <div class="piede"><button class="btn pieno" data-az="chiudi-foglio">Fatto</button></div>`);
}

function foglioAccount() {
  S.foglio = { tipo: "account" };
  foglio(`<h2>Account e copie</h2>
    <h3>Importa</h3>
    <p class="tenue">Da una copia di sicurezza scaricata prima: diventa una nuova classe.</p>
    <div class="scelte"><label class="btn">Scegli il file…<input type="file" accept=".json,application/json" data-file="importa" hidden></label></div>
    ${D.PROVA ? "" : `<h3>Account</h3><p class="tenue">${esc(D.chiSei()?.email)}</p><div class="scelte"><button class="btn" data-az="esci">Esci</button></div>`}
    <div class="piede"><button class="btn pieno" data-az="chiudi-foglio">Fatto</button></div>`);
}

function creaClasse(nome, da) {
  const id = nuovoId();
  const primo = classi()[0];
  D.scrivi("classe:" + id, { nome: nome.trim(), ordine: primo ? (primo.ordine ?? 0) - 1 : 0 });   // la più nuova va in cima
  if (da) {
    if (D.leggi(`c:${da}/staff`)) D.scrivi(`c:${id}/staff`, D.leggi(`c:${da}/staff`));
    if (D.leggi(`c:${da}/impostazioni`)) D.scrivi(`c:${id}/impostazioni`, D.leggi(`c:${da}/impostazioni`));
  }
  return id;
}

function spostaClasse(cid, d) {
  const elenco = classi(), i = elenco.findIndex(c => c.id === cid), j = i + d;
  if (i < 0 || j < 0 || j >= elenco.length) return;
  [elenco[i], elenco[j]] = [elenco[j], elenco[i]];
  elenco.forEach((c, n) => { if (c.ordine !== n) { const { id, ...v } = c; D.scrivi("classe:" + id, { ...v, ordine: n }); } });
  disegnaClassi();
}

function disegnaAccesso(errore = "") {
  app.innerHTML = `<div class="accesso">
    <form class="finestra" data-form="accesso">
      <h1>Piantina corso</h1>
      <p class="tenue">${S.nuovoAccount ? "Crea un account: email e una password nuova." : "Accedi con lo stesso account di Annona."}</p>
      <label>Email<input type="email" name="email" autocomplete="username" required></label>
      <label>Password<input type="password" name="password" autocomplete="${S.nuovoAccount ? "new-password" : "current-password"}" minlength="6" required></label>
      <button class="btn pieno grande">${S.nuovoAccount ? "Crea account" : "Accedi"}</button>
      <p class="errore">${esc(errore)}</p>
      <button type="button" class="link" data-az="cambia-accesso">${S.nuovoAccount ? "Ho già un account" : "Non hai un account? Creane uno"}</button>
    </form>
  </div>`;
}

// ---------- TEST: coppie di sedie messe liberamente nella stanza ----------
// Le persone si identificano con "c:<idCorsista>" o "s:<idStaff>".
// Regole: chi è seduto (corsista o staff-allievo) sta solo lì e non segue nessuno; lo staff in «segue» può seguire
// più coppie; un supervisore gira per la sala e non sta altrove.
function test() {
  const t = L("test") || {};
  const coppie = (t.coppie || []).map(c => ({ ...c, posti: [...(c.posti || [null, null])], seguono: [...(c.seguono || [])] }));
  // ogni coppia ha il suo posto fisso; quelle senza (o con un posto doppio) prendono il libero più vicino
  const usati = new Set();
  coppie.forEach(c => { if (Number.isInteger(c.slot) && c.slot >= 0 && !usati.has(c.slot)) usati.add(c.slot); else c.slot = null; });
  coppie.forEach(c => {
    if (c.slot !== null) return;
    const vecchia = { x: (c.x ?? 0) <= 1 ? (c.x ?? 0) * 700 : c.x, y: (c.y ?? 0) <= 1 ? (c.y ?? 0) * 500 : c.y };
    c.slot = slotLiberoVicino(usati, vecchia.x, vecchia.y, coppie.length);
    usati.add(c.slot);
  });
  return { coppie, supervisori: [...(t.supervisori || [])], assenti: [...(t.assenti || [])] };
}
const salvaTest = t => W("test", t);
const coppiaDi = (t, cid) => t.coppie.find(c => c.id === cid);
/** numero della coppia in ordine di lettura (da sinistra a destra, fila per fila) */
const numeroCoppia = (t, c) => [...t.coppie].sort((a, b) => a.slot - b.slot).indexOf(c) + 1;
const chiDi = p => p?.tipo === "corsista" ? "c:" + p.id : p?.tipo === "staff" ? "s:" + p.id : null;
// la stanza ha sempre la stessa forma: su ogni schermo si ingrandisce o rimpicciolisce tutta insieme (scala),
// così la disposizione è identica su Mac, iPad e iPhone
// Posti fissi (slot): 3 per fila, celle di 333 × 175 punti. Quando lasci una coppia va nel posto più vicino.
const STANZA = { l: 1000, coppia: 300, colonne: 3, cella: 1000 / 3, fila: 175 };
const slotXY = n => ({ x: (n % STANZA.colonne) * STANZA.cella + (STANZA.cella - STANZA.coppia) / 2, y: Math.floor(n / STANZA.colonne) * STANZA.fila + 16 });
/** quante file di posti: sempre almeno 4, e sempre una fila libera in fondo per crescere */
const fileStanza = t => Math.max(4, Math.ceil((t.coppie.length + 1) / STANZA.colonne) + 1,
  ...t.coppie.map(c => Math.floor(c.slot / STANZA.colonne) + 2));
const altezzaStanza = t => fileStanza(t) * STANZA.fila + 10;
/** il posto più vicino al punto (x, y) — angolo in alto a sinistra della coppia */
function slotVicino(x, y, file) {
  const col = Math.max(0, Math.min(STANZA.colonne - 1, Math.round((x - (STANZA.cella - STANZA.coppia) / 2) / STANZA.cella)));
  const riga = Math.max(0, Math.min(file - 1, Math.round((y - 16) / STANZA.fila)));
  return riga * STANZA.colonne + col;
}
function slotLiberoVicino(usati, x, y, quante) {
  let meglio = null, dist = Infinity;
  for (let n = 0; n < (quante + 6) * 2; n++) {
    if (usati.has(n)) continue;
    const p = slotXY(n), d = Math.hypot(p.x - x, p.y - y);
    if (d < dist) { dist = d; meglio = n; }
  }
  return meglio ?? 0;
}
function scalaStanza() {
  const fuori = $("#stanza"), dentro = $("#stanza-dentro");
  if (!fuori || !dentro) return;
  const s = Math.max(telefono() ? 0.55 : 0.4, Math.min(1.25, fuori.clientWidth / STANZA.l));   // sul telefono si scorre di lato
  dentro.style.transform = `scale(${s})`;
  dentro.parentElement.style.height = dentro.offsetHeight * s + "px";
  dentro.parentElement.style.width = STANZA.l * s + "px";
  S.scala = s;
}
function togliOvunque(t, chi) {
  for (const c of t.coppie) {
    c.posti = c.posti.map(p => p && chiDi(p) === chi ? null : p);
    c.seguono = c.seguono.filter(s => "s:" + s !== chi);
  }
  t.supervisori = t.supervisori.filter(s => "s:" + s !== chi);
}
/** staff che non può più essere scelto per «segue»: seduto o supervisore */
function staffBloccato(t) {
  const set = new Set(t.supervisori);
  t.coppie.forEach(c => c.posti.forEach(p => p?.tipo === "staff" && set.add(p.id)));
  return set;
}
const quanteSegue = (t, sid) => t.coppie.filter(c => c.seguono.includes(sid)).length;
/** chi è già nella stanza del test */
function messiNelTest(t) {
  const set = new Set();
  t.coppie.forEach(c => { c.posti.forEach(p => chiDi(p) && set.add(chiDi(p))); c.seguono.forEach(s => set.add("s:" + s)); });
  t.supervisori.forEach(s => set.add("s:" + s));
  return set;
}
function dovenelTest(id) {
  const t = test();
  let i = t.coppie.findIndex(c => c.posti.some(p => p?.tipo === "corsista" && p.id === id));
  if (i < 0) return "Test: non ancora in una coppia";
  const c = t.coppie[i];
  i = numeroCoppia(t, c) - 1;
  const altro = c.posti.find(p => p && !(p.tipo === "corsista" && p.id === id));
  const conChi = !altro ? "" : altro.tipo === "staff" ? `con ${membro(altro.id)?.nome || "—"}`
    : altro.tipo === "corsista" ? `con ${nomeIntero(corsista(altro.id))}` : `con ${altro.nome}`;
  const seguono = c.seguono.map(membro).filter(Boolean).map(s => s.nome);
  return `Test: coppia ${i + 1} ${conChi}${seguono.length ? ` · segue ${seguono.join(", ")}` : ""}`;
}

function disegnaTest() {
  const t = test(), messi = messiNelTest(t);
  // chi è stato tolto con × (assente) non compare e non si conta
  const via = new Set(t.assenti);
  const tuttoStaff = staff().filter(s => !via.has("s:" + s.id)), tuttiCorsisti = corsisti().filter(c => !via.has("c:" + c.id));
  const bloccati = staffBloccato(t);
  const liberiS = tuttoStaff.filter(s => !bloccati.has(s.id));   // chi segue resta qui: può seguire altre coppie
  const senzaRuolo = tuttoStaff.filter(s => !messi.has("s:" + s.id)).length;
  const liberiC = tuttiCorsisti.filter(c => !messi.has("c:" + c.id));
  const sel = chi => S.tSel?.chi === chi ? " scelto" : "";
  const chipS = (s, da) => `<button class="t-chip staff${da === "lista" ? sel("s:" + s.id) : ""}" data-trascina="persona" data-chi="s:${s.id}" data-da="${da}" data-az="${da === "lista" ? "t-sel" : "t-nulla"}" style="--colore:${s.colore}">
      <i></i>${da === "lista"
        ? `<span class="t-righe"><span class="t-nome">${esc(s.nome)}</span>${quanteSegue(t, s.id) ? `<small class="segue-n">segue ${quanteSegue(t, s.id)} ${quanteSegue(t, s.id) === 1 ? "coppia" : "coppie"}</small>` : ""}</span>` + tastiLista("s:" + s.id, s.nome)
        : `<span class="t-nome">${esc(s.nome)}</span><b data-az="togli-t" title="Togli" aria-label="Togli ${esc(s.nome)}">×</b>`}</button>`;
  // ✎ rinomina, × toglie dalla colonna (oggi non c'è): si può rimettere
  const tastiLista = (chi, nome) => `<b class="t-tasto" data-az="t-rinomina" data-chi="${chi}" title="Correggi il nome" aria-label="Correggi ${esc(nome)}">✎</b><b class="t-tasto" data-az="assente" data-chi="${chi}" title="Togli dalla colonna (non c'è)" aria-label="Togli ${esc(nome)}">×</b>`;
  const assentiS = t.assenti.filter(k => k.startsWith("s:") && membro(k.slice(2))).length;
  const assentiC = t.assenti.filter(k => k.startsWith("c:") && corsista(k.slice(2))).length;

  const htmlSedia = (c, i) => {
    const p = c.posti[i], meta = `posto:${c.id}:${i}`;
    const pc = p?.tipo === "corsista" && corsista(p.id);
    if (pc) return `<div class="sedia piena" data-meta="${meta}">
        <button class="t-chip corsista" data-trascina="persona" data-chi="c:${p.id}" data-da="${meta}" data-az="apri-t" data-id="${p.id}">
          <span class="t-righe"><span class="t-nome">${esc(pc.nome || nomeIntero(pc))}</span>${pc.cognome ? `<span class="t-nome t-cogn">${esc(pc.cognome)}</span>` : ""}</span>
          <b data-az="togli-t" title="Togli dalla sedia" aria-label="Togli">×</b></button></div>`;
    const ps = p?.tipo === "staff" && membro(p.id);
    if (ps) return `<div class="sedia piena" data-meta="${meta}">
        <button class="t-chip staff" data-trascina="persona" data-chi="s:${ps.id}" data-da="${meta}" data-az="t-nulla" style="--colore:${ps.colore}">
          <span class="t-righe"><span class="t-nome">${esc(ps.nome)}</span></span>
          <b data-az="togli-t" title="Togli dalla sedia" aria-label="Togli">×</b></button></div>`;
    return `<button class="sedia vuota" data-meta="${meta}" data-az="sedia" data-cid="${c.id}" data-i="${i}" aria-label="Sedia libera">+</button>`;
  };

  $("#sala").innerHTML = `<div class="test">
    <aside class="t-liste" data-meta="lista">
      <section>
        <h3><i class="pallino-s"></i>Staff <b title="Ancora senza posto, su tutto lo staff">${senzaRuolo}/${tuttoStaff.length}</b></h3>
        ${liberiS.map(s => chipS(s, "lista")).join("") || `<p class="tenue piccolo">${tuttoStaff.length ? "Tutti sistemati" : "Ancora nessuno"}</p>`}
        <button class="t-agg" data-az="t-aggiungi" data-tipo="s">+ Aggiungi</button>
        ${assentiS ? `<button class="link piccolo" data-az="t-assenti" data-tipo="s">${assentiS} ${assentiS === 1 ? "tolto" : "tolti"} · rimetti</button>` : ""}
      </section>
      <section>
        <h3><i class="pallino-c"></i>Corsisti <b>${liberiC.length}/${tuttiCorsisti.length}</b></h3>
        ${liberiC.map(c => `<button class="t-chip corsista${sel("c:" + c.id)}" data-trascina="persona" data-chi="c:${c.id}" data-da="lista" data-az="t-sel"><span class="t-righe"><span class="t-nome">${esc(c.nome || nomeIntero(c))}</span>${c.cognome ? `<span class="t-nome t-cogn">${esc(c.cognome)}</span>` : ""}</span>${tastiLista("c:" + c.id, nomeIntero(c))}</button>`).join("")
          || `<p class="tenue piccolo">${tuttiCorsisti.length ? "Tutti seduti" : "Ancora nessuno"}</p>`}
        <button class="t-agg" data-az="t-aggiungi" data-tipo="c">+ Aggiungi</button>
        ${assentiC ? `<button class="link piccolo" data-az="t-assenti" data-tipo="c">${assentiC} ${assentiC === 1 ? "tolto" : "tolti"} · rimetti</button>` : ""}
      </section>
    </aside>
    <div class="t-stanza-wrap">
      ${S.tSel ? `<div class="avviso">Tocca una sedia${S.tSel.chi.startsWith("s:") ? ", lo spazio «segue» di una coppia o i supervisori" : ""} per metterlo lì. <button class="link" data-az="t-annulla">Annulla</button></div>` : ""}
      <div class="supervisori" data-meta="super" data-az="super-qui">
        <span class="etic">Supervisori</span>
        ${t.supervisori.map(membro).filter(Boolean).map(s => chipS(s, "super")).join("") || `<span class="tenue piccolo">trascina qui chi dello staff gira per la sala</span>`}
      </div>
      <div class="stanza" id="stanza"><div class="stanza-misura"><div class="stanza-dentro" id="stanza-dentro" style="width:${STANZA.l}px;height:${altezzaStanza(t)}px">
        ${Array.from({ length: fileStanza(t) * STANZA.colonne }, (_, n) => n).filter(n => !t.coppie.some(c => c.slot === n)).map(n => {
          const p = slotXY(n);
          return `<button class="slot" data-slot="${n}" data-az="coppia-qui" style="left:${p.x}px;top:${p.y}px;width:${STANZA.coppia}px" title="Nuova coppia qui">+</button>`;
        }).join("")}
        ${t.coppie.map(c => ({ c, n: numeroCoppia(t, c) - 1 })).map(({ c, n }) => `<div class="coppia" data-coppia="${c.id}" style="left:${slotXY(c.slot).x}px;top:${slotXY(c.slot).y}px;width:${STANZA.coppia}px">
          <div class="c-testa" data-trascina="coppia" data-cid="${c.id}"><span>⠿ Coppia ${n + 1}</span><button class="tasto piccolo" data-az="elimina-coppia" data-cid="${c.id}" title="Elimina la coppia" aria-label="Elimina la coppia ${n + 1}">×</button></div>
          <div class="c-corpo">
            ${htmlSedia(c, 0)}${htmlSedia(c, 1)}
            <div class="segue" data-meta="segue:${c.id}" data-az="segue-qui" data-cid="${c.id}">
              ${c.seguono.map(membro).filter(Boolean).map(s => chipS(s, "segue:" + c.id)).join("") || `<span class="vuoto piccolo">segue…</span>`}
            </div>
          </div>
        </div>`).join("")}
        ${t.coppie.length ? "" : `<p class="tenue stanza-vuota">Tocca un posto (+) o «+ Coppia» in alto per mettere la prima coppia.</p>`}
      </div></div></div>
    </div>
  </div>`;
  scalaStanza();
  adattaNomi();
}

/** una coppia nuova va nel posto indicato, oppure nel primo posto libero (da sinistra, fila per fila) */
function nuovaCoppia(slot) {
  const t = test(), usati = new Set(t.coppie.map(c => c.slot));
  if (!Number.isInteger(slot) || usati.has(slot)) { slot = 0; while (usati.has(slot)) slot++; }
  t.coppie.push({ id: nuovoId(), slot, posti: [null, null], seguono: [] });
  salvaTest(t); disegnaTest();
}

/** toglie la persona solo dal posto da cui l'hai presa (le altre coppie che segue restano) */
function togliDaOrigine(t, sorg) {
  const [tipo, cid, i] = sorg.da.split(":"), sid = sorg.chi.slice(2);
  if (tipo === "posto") { const c = coppiaDi(t, cid); if (c) c.posti[+i] = null; }
  else if (tipo === "segue") { const c = coppiaDi(t, cid); if (c) c.seguono = c.seguono.filter(x => x !== sid); }
  else if (tipo === "super") t.supervisori = t.supervisori.filter(x => x !== sid);
}

/** mette una persona (presa dalla lista o da un altro posto) dove indica "meta" */
function applica(sorg, meta) {
  const t = test();
  const staffista = sorg.chi.startsWith("s:");
  const da = sorg.da.startsWith("posto:") ? sorg.da.split(":") : null;
  const sediaDa = da && coppiaDi(t, da[1]);
  const persona = sorg.chi.startsWith("c:") ? { tipo: "corsista", id: sorg.chi.slice(2) }
    : staffista ? { tipo: "staff", id: sorg.chi.slice(2) } : sediaDa?.posti[+da[2]];
  S.tSel = null;
  if (meta.startsWith("posto:")) {
    const [, cid, i] = meta.split(":"), c = coppiaDi(t, cid);
    if (!c || !persona || (da && da[1] === cid && da[2] === i)) return disegnaTest();
    const occupante = c.posti[+i];
    if (sediaDa) sediaDa.posti[+da[2]] = occupante || null;   // scambio di sedia
    else togliOvunque(t, sorg.chi);
    c.posti[+i] = persona;
  } else if (meta === "super") {
    if (!staffista) { avvisa("Qui va lo staff: i corsisti vanno sulle sedie"); return disegnaTest(); }
    togliOvunque(t, sorg.chi);   // il supervisore gira per la sala: non è seduto e non segue una coppia
    t.supervisori.push(sorg.chi.slice(2));
  } else if (meta.startsWith("segue:")) {
    if (!staffista) { avvisa("Qui va lo staff: i corsisti vanno sulle sedie"); return disegnaTest(); }
    const sid = sorg.chi.slice(2), c = coppiaDi(t, meta.split(":")[1]);
    if (!c) return disegnaTest();
    togliDaOrigine(t, sorg);   // da una sedia, da un'altra coppia o dai supervisori: lì non c'è più
    if (staffBloccato(t).has(sid)) { avvisa("È seduto in una coppia: chi è seduto non può seguire"); return disegnaTest(); }
    if (!c.seguono.includes(sid)) c.seguono.push(sid);   // dalle colonne: si aggiunge, può seguire più coppie
  } else if (meta === "lista") {
    togliDaOrigine(t, sorg);
  } else return disegnaTest();
  salvaTest(t); disegnaTest(); disegnaScheda();
}

function foglioSedia(cid, i) {
  S.foglio = { tipo: "sedia", meta: `posto:${cid}:${i}` };
  const messi = messiNelTest(test());
  const bloccati = staffBloccato(test());
  const liberi = corsisti().filter(c => !messi.has("c:" + c.id)), liberiS = staff().filter(s => !bloccati.has(s.id));
  foglio(`<h2>Sedia libera</h2>
    <h3>Un corsista</h3>
    <div class="scelte">${liberi.map(c => `<button class="chip persona" data-az="siedi" data-chi="c:${c.id}">${esc(nomeIntero(c))}</button>`).join("") || `<p class="tenue">Tutti i corsisti sono già seduti.</p>`}</div>
    <h3>Oppure una persona dello staff · se seguiva qualche coppia, smette</h3>
    <div class="scelte">${liberiS.map(s => `<button class="chip" style="--colore:${s.colore}" data-az="siedi" data-chi="s:${s.id}"><i></i>${esc(s.nome)}</button>`).join("") || `<p class="tenue">Tutto lo staff è già sistemato.</p>`}</div>
    <div class="piede"><button class="btn" data-az="chiudi-foglio">Annulla</button></div>`);
}
function foglioAggiungiT(tipo) {
  S.foglio = { tipo: "t-aggiungi", chi: tipo };
  foglio(tipo === "s" ? `<h2>Nuova persona dello staff</h2>
      <form class="colonna" data-form="t-nuovo"><label>Nome<input name="nome" autocomplete="off" autofocus required></label><button class="btn pieno">Aggiungi</button></form>`
    : `<h2>Nuovo corsista</h2>
      <form class="colonna" data-form="t-nuovo"><div class="due"><label>Nome<input name="nome" autocomplete="off" autofocus required></label><label>Cognome<input name="cognome" autocomplete="off"></label></div><button class="btn pieno">Aggiungi</button></form>`);
}
function foglioRinominaT(chi) {
  S.foglio = { tipo: "t-rinomina", chi };
  if (chi.startsWith("s:")) {
    const s = membro(chi.slice(2));
    return foglio(`<h2>Correggi il nome</h2>
      <form class="colonna" data-form="t-rinomina"><label>Nome<input name="nome" value="${esc(s?.nome || "")}" autocomplete="off" autofocus required></label><button class="btn pieno">Salva</button></form>`);
  }
  const c = corsista(chi.slice(2));
  foglio(`<h2>Correggi il nome</h2>
    <form class="colonna" data-form="t-rinomina"><div class="due"><label>Nome<input name="nome" value="${esc(c?.nome || "")}" autocomplete="off" autofocus required></label><label>Cognome<input name="cognome" value="${esc(c?.cognome || "")}" autocomplete="off"></label></div><button class="btn pieno">Salva</button></form>`);
}
function foglioAssenti(tipo) {
  S.foglio = { tipo: "t-assenti", chi: tipo };
  const t = test(), via = t.assenti.filter(k => k.startsWith(tipo + ":"));
  const nome = k => tipo === "s" ? membro(k.slice(2))?.nome : corsista(k.slice(2)) && nomeIntero(corsista(k.slice(2)));
  foglio(`<h2>Tolti dalla colonna ${tipo === "s" ? "Staff" : "Corsisti"}</h2>
    <p class="tenue">Oggi non ci sono. Tocca un nome per rimetterlo.</p>
    <div class="scelte">${via.filter(nome).map(k => `<button class="chip persona" data-az="rimetti" data-chi="${k}">↺ ${esc(nome(k))}</button>`).join("")}</div>
    <div class="piede"><button class="btn pieno" data-az="chiudi-foglio">Fatto</button></div>`);
}

function foglioSceltaStaff(meta) {
  S.foglio = { tipo: "scelta-staff", meta };
  const t = test(), bloccati = staffBloccato(t), coppia = meta.startsWith("segue:") && coppiaDi(t, meta.split(":")[1]);
  const liberi = staff().filter(s => !bloccati.has(s.id) && !(coppia && coppia.seguono.includes(s.id)));
  foglio(`<h2>${meta === "super" ? "Supervisori" : "Chi segue questa coppia?"}</h2>
    ${coppia ? `<p class="tenue">Chi segue può seguire anche altre coppie. Chi è seduto o fa il supervisore non compare.</p>` : ""}
    <div class="scelte">${liberi.map(s => `<button class="chip" style="--colore:${s.colore}" data-az="siedi" data-chi="s:${s.id}"><i></i>${esc(s.nome)}</button>`).join("")
      || `<p class="tenue">Tutto lo staff è già sistemato. Trascina qui qualcuno da un altro posto per spostarlo.</p>`}</div>
    <div class="piede"><button class="btn" data-az="chiudi-foglio">Fatto</button></div>`);
}

// ---------- trascinare con mouse e dito (stanza del test) ----------
let presa = null;
document.addEventListener("pointerdown", e => {
  const el = e.target.closest("[data-trascina]");
  if (!el || e.button > 0 || e.target.closest("[data-az=togli-t], [data-az=elimina-coppia], [data-az=assente], [data-az=t-rinomina]")) return;
  presa = { el, x0: e.clientX, y0: e.clientY, avviata: false };
});
document.addEventListener("pointermove", e => {
  if (!presa) return;
  const dx = e.clientX - presa.x0, dy = e.clientY - presa.y0;
  if (!presa.avviata) {
    if (Math.hypot(dx, dy) < 6) return;
    presa.avviata = true;
    const r = presa.el.getBoundingClientRect();
    if (presa.el.dataset.trascina === "coppia") {
      presa.card = presa.el.closest(".coppia");
      presa.l0 = presa.card.offsetLeft; presa.t0 = presa.card.offsetTop; presa.s = S.scala || 1;
      presa.card.classList.add("in-volo");
    } else {
      presa.fantasma = presa.el.cloneNode(true);
      presa.fantasma.className += " fantasma";
      Object.assign(presa.fantasma.style, { width: r.width + "px", left: r.left + "px", top: r.top + "px" });
      presa.dx = e.clientX - r.left; presa.dy = e.clientY - r.top;
      document.body.append(presa.fantasma);
      presa.el.classList.add("trascinato");
    }
  }
  e.preventDefault();
  if (presa.card) {
    const { card, s } = presa, alta = $("#stanza-dentro").offsetHeight;
    const l = Math.max(0, Math.min(STANZA.l - card.offsetWidth, presa.l0 + dx / s));
    const t = Math.max(0, Math.min(alta - card.offsetHeight, presa.t0 + dy / s));
    Object.assign(card.style, { left: l + "px", top: t + "px" });
    // mostro dove andrà: il posto libero si illumina, oppure la coppia con cui si scambierà
    const n = slotVicino(l, t, Math.floor(alta / STANZA.fila));
    const meta = document.querySelector(`.slot[data-slot="${n}"]`) || [...document.querySelectorAll(".coppia")].find(el => el !== card && test().coppie.find(c => c.id === el.dataset.coppia)?.slot === n);
    document.querySelectorAll(".sopra").forEach(x => x !== meta && x.classList.remove("sopra"));
    meta?.classList.add("sopra");
  } else {
    Object.assign(presa.fantasma.style, { left: e.clientX - presa.dx + "px", top: e.clientY - presa.dy + "px" });
    const meta = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-meta]");
    document.querySelectorAll(".sopra").forEach(x => x !== meta && x.classList.remove("sopra"));
    meta?.classList.add("sopra");
  }
}, { passive: false });
document.addEventListener("pointerup", e => {
  const p = presa;
  presa = null;
  if (!p?.avviata) return;
  S.fineTrascino = Date.now();
  document.querySelectorAll(".sopra").forEach(x => x.classList.remove("sopra"));
  if (p.card) {
    const t = test(), c = coppiaDi(t, p.card.dataset.coppia);
    if (c) {
      const n = slotVicino(parseFloat(p.card.style.left), parseFloat(p.card.style.top), fileStanza(t));
      const altra = t.coppie.find(x => x !== c && x.slot === n);
      if (altra) altra.slot = c.slot;   // posto occupato: le due coppie si scambiano
      c.slot = n;
      salvaTest(t);
    }
    return disegnaTest();
  }
  p.fantasma.remove();
  const meta = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-meta]")?.dataset.meta;
  if (meta) applica({ chi: p.el.dataset.chi, da: p.el.dataset.da }, meta);
  else disegnaTest();
});
document.addEventListener("pointercancel", () => { presa?.fantasma?.remove(); presa = null; if (S.giorno === "test" && $("#stanza")) disegnaTest(); });
// dopo un trascinamento il browser manda anche un «clic»: lo ignoro
document.addEventListener("click", e => {
  if (Date.now() - (S.fineTrascino || 0) < 350) { e.stopPropagation(); e.preventDefault(); }
}, true);

// ---------- fogli (finestre sopra la sala) ----------
function foglio(html) {
  const f = $("#foglio");
  f.innerHTML = `<div class="velo" data-az="chiudi-foglio"></div><div class="finestra" role="dialog" aria-modal="true">${html}</div>`;
  f.hidden = false;
  f.querySelector("[autofocus]")?.focus();
}
function chiudiFoglio() { const f = $("#foglio"); f.hidden = true; f.innerHTML = ""; S.foglio = null; }

let timerAvviso;
function avvisa(testo, conAnnulla = false) {
  const t = $("#avviso");
  t.innerHTML = esc(testo) + (conAnnulla ? (testo.startsWith("Annullato")
    ? ` <button class="link" data-az="ripeti">Ripeti</button>` : ` <button class="link" data-az="annulla">Annulla</button>`) : "");
  t.hidden = false;
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => { t.hidden = true; }, conAnnulla ? 5000 : 2600);
}

function foglioStaff(id, g) {
  S.foglio = { tipo: "staff", id, g };
  const c = corsista(id), scelti = piantina(g).staff[id] || [];
  foglio(`<h2>Chi segue ${esc(c.nome || nomeIntero(c))}?</h2>
    <p class="tenue">${nomeGiorno(g)} · puoi sceglierne più di uno</p>
    <div class="scelte">${staff().map(s => `<button class="chip ${scelti.includes(s.id) ? "attivo" : ""}" style="--colore:${s.colore}" data-az="scegli-staff" data-sid="${s.id}"><i></i>${esc(s.nome)}</button>`).join("")
      || `<p class="tenue">Lo staff è ancora vuoto: aggiungi qui sotto la prima persona.</p>`}</div>
    <form class="riga-form" data-form="staff-qui"><input name="nome" placeholder="Nuova persona dello staff" autocomplete="off" ${staff().length ? "" : "autofocus"}><button class="btn">Aggiungi</button></form>
    <div class="piede"><button class="btn pieno" data-az="chiudi-foglio">Fatto</button></div>`);
}

function foglioGestisciStaff() {
  S.foglio = { tipo: "gestisci" };
  foglio(`<h2>Staff</h2>
    <p class="tenue">Tocca il pallino per cambiare colore. Il nome si corregge direttamente.</p>
    <div class="elenco">${staff().map(s => `<div class="riga-staff">
        <button class="pallino" style="--colore:${s.colore}" data-az="colore-staff" data-sid="${s.id}" aria-label="Cambia colore"></button>
        <input value="${esc(s.nome)}" data-rinomina-staff="${s.id}" aria-label="Nome" autocomplete="off">
        <button class="tasto" data-az="togli-staff" data-sid="${s.id}" title="Togli dallo staff" aria-label="Togli ${esc(s.nome)}">×</button>
      </div>`).join("") || `<p class="tenue">Ancora nessuno.</p>`}</div>
    <form class="riga-form" data-form="staff"><input name="nome" placeholder="Nome della persona" autocomplete="off" autofocus><button class="btn">Aggiungi</button></form>
    <div class="piede"><button class="btn pieno" data-az="chiudi-foglio">Fatto</button></div>`);
}

function aggiungiStaff(nome) {
  nome = nome.trim();
  if (!nome) return null;
  const elenco = staff();
  const usati = elenco.map(s => s.colore);
  const colore = COLORI.find(c => !usati.includes(c)) || COLORI[elenco.length % COLORI.length];
  const s = { id: nuovoId(), nome, colore };
  W("staff", [...elenco, s]);
  return s;
}

function foglioNuovoCorsista(posto) {
  S.foglio = { tipo: "nuovo", posto };
  const fuori = fuoriSala(S.giorno);
  foglio(`<h2>${posto ? "Banco libero" : "Nuovo corsista"}</h2>
    <form data-form="corsista" class="colonna">
      <div class="due"><label>Nome<input name="nome" autocomplete="off" autofocus required></label><label>Cognome<input name="cognome" autocomplete="off"></label></div>
      <button class="btn pieno">Aggiungi ${posto ? "in questo banco" : S.giorno === "test" ? "alla classe" : `alla piantina di ${nomeGiorno(S.giorno).toLowerCase()}`}</button>
    </form>
    ${fuori.length && S.giorno !== "test" ? `<div id="recenti"><h3>Corsisti recenti · non in sala ${nomeGiorno(S.giorno).toLowerCase()}</h3>
      <div class="scelte">${fuori.map(c => `<button class="chip persona" data-az="metti" data-id="${c.id}" data-cerca="${esc(semplice(nomeIntero(c)))}">${esc(nomeIntero(c))}</button>`).join("")}</div></div>` : ""}
    <details class="tanti"><summary>Aggiungi tanti corsisti insieme</summary>
      <form data-form="elenco" class="colonna">
        <textarea name="elenco" rows="6" placeholder="Uno per riga, prima il nome:&#10;Giulia Ferri&#10;Alessandro Riva&#10;…"></textarea>
        <button class="btn">${S.giorno === "test" ? "Aggiungili alla classe" : "Mettili nei banchi liberi"}</button>
      </form>
    </details>`);
}

/** crea un corsista e lo mette nel banco indicato, o nel primo libero del giorno */
function creaCorsista(nome, cognome, posto) {
  const id = nuovoId();
  W("corsista:" + id, { nome: nome.trim(), cognome: cognome.trim(), appunti: {} });
  if (S.giorno === "test") return { id, dove: "lista" };   // nel test finisce nella colonna «Corsisti»
  const p = piantina(S.giorno);
  const dove = posto && !p.posti[posto] ? posto : postiValidi().find(k => !p.posti[k]);
  if (dove) { p.posti[dove] = id; salvaPiantina(S.giorno, p); }
  return { id, dove };
}

function foglioCopia() {
  S.foglio = { tipo: "copia" };
  foglio(`<h2>Copia la piantina di ${nomeGiorno(S.giorno).toLowerCase()}</h2>
    <p class="tenue">Copia posti e staff sul giorno che scegli, sostituendo la sua piantina. Gli appunti dei corsisti e il diario non cambiano.</p>
    <div class="scelte">${GIORNI.filter(g => g.k !== S.giorno).map(g => `<button class="btn" data-az="copia" data-g="${g.k}">Su ${g.nome.toLowerCase()}</button>`).join("")}</div>
    <div class="piede"><button class="btn" data-az="chiudi-foglio">Annulla</button></div>`);
}

function foglioImpostazioni() {
  S.foglio = { tipo: "impostazioni" };
  const { righe, colonne } = imp();
  foglio(`<h2>Impostazioni della classe</h2>
    <label class="campo-largo">Nome della classe<input data-rinomina-classe="${S.classe}" value="${esc(classe(S.classe)?.nome || "")}" autocomplete="off"></label>
    <div class="misure">
      <div><span>File di banchi</span><div class="passi"><button class="tasto" data-az="misura" data-m="righe" data-d="-1">−</button><b>${righe}</b><button class="tasto" data-az="misura" data-m="righe" data-d="1">+</button></div></div>
      <div><span>Banchi per fila</span><div class="passi"><button class="tasto" data-az="misura" data-m="colonne" data-d="-1">−</button><b>${colonne}</b><button class="tasto" data-az="misura" data-m="colonne" data-d="1">+</button></div></div>
    </div>
    <p class="tenue">Il corridoio resta sempre a metà. Vale per tutti e tre i giorni: chi resta senza banco finisce in «Non in sala».</p>
    <h3>Copia di sicurezza</h3>
    <div class="scelte"><button class="btn" data-az="scarica-copia" data-cid="${S.classe}">Scarica una copia di questa classe</button></div>
    <p class="tenue">Per una nuova classe, o per eliminarla: torna all'elenco delle classi con ‹ in alto a sinistra.</p>
    <div class="piede"><button class="btn pieno" data-az="chiudi-foglio">Fatto</button></div>`);
}

function foglioMenuCorsista() {
  const id = S.aperto, c = corsista(id), p = piantina(S.giorno);
  S.foglio = { tipo: "menu" };
  foglio(`<h2>${esc(nomeIntero(c))}</h2>
    <div class="colonna">
      ${postoDi(p, id) ? `<button class="btn" data-az="togli-banco">Togli dal banco di ${nomeGiorno(S.giorno).toLowerCase()}</button>` : ""}
      <button class="btn rosso" data-az="elimina-corsista">Elimina del tutto (anche gli appunti)</button>
      <button class="btn" data-az="chiudi-foglio">Annulla</button>
    </div>`);
}

function ridisegnaFoglio() {
  const f = S.foglio;
  if (!f) return;
  if (f.tipo === "staff") foglioStaff(f.id, f.g);
  else if (f.tipo === "gestisci") foglioGestisciStaff();
  else if (f.tipo === "impostazioni") foglioImpostazioni();
}

// ---------- spostare ----------
function spostaIn(posto) {
  const p = piantina(S.giorno);
  const da = S.preso?.posto, id = S.preso?.id ?? p.posti[da];
  S.preso = null;
  if (!id || da === posto) return disegnaSala();
  const altro = p.posti[posto];
  if (da) { if (altro) p.posti[da] = altro; else delete p.posti[da]; }
  p.posti[posto] = id;
  salvaPiantina(S.giorno, p);
  disegnaSala(); disegnaScheda();
}
function togliDalBanco(id) {
  const p = piantina(S.giorno), posto = postoDi(p, id);
  if (!posto) return;
  delete p.posti[posto];
  salvaPiantina(S.giorno, p);
  disegnaSala(); disegnaScheda();
}

// ---------- copia di sicurezza ----------
function scaricaCopia(cid) {
  const prefisso = `c:${cid}/`, nome = classe(cid)?.nome || "classe";
  const dati = Object.fromEntries(D.elenco(prefisso).map(([k, v]) => [k.slice(prefisso.length), v]));
  const blob = new Blob([JSON.stringify({ app: "piantina-corso", classe: nome, quando: new Date().toISOString(), dati }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `piantina-${nome.toLowerCase().replace(/[^a-z0-9àèéìòù]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/** una copia di sicurezza diventa una nuova classe (vanno bene anche le copie di prima delle classi) */
async function importa(file) {
  let copia;
  try { copia = JSON.parse(await file.text()); } catch { return avvisa("Questo file non è una copia di Piantina corso"); }
  if (copia?.app !== "piantina-corso" || !copia.dati) return avvisa("Questo file non è una copia di Piantina corso");
  const id = creaClasse(copia.classe || copia.dati.impostazioni?.corso || "Classe importata", null);
  Object.entries(copia.dati).forEach(([k, v]) => D.scrivi(`c:${id}/${k}`, v));
  chiudiFoglio(); disegnaClassi(); avvisa("Classe importata");
}

// ---------- tocchi ----------
document.addEventListener("click", async e => {
  // la scheda del corsista si chiude toccando fuori (aprire un altro corsista la cambia e basta)
  if (S.aperto && !e.target.closest("#scheda, #foglio, [data-az=apri], [data-az=fuori], [data-az=apri-t]")) {
    S.aperto = null; disegnaSala(); disegnaScheda();
  }
  const b = e.target.closest("[data-az]");
  if (!b) return;
  const { az, id, g, sid, posto } = b.dataset;
  switch (az) {
    case "giorno":
      S.giorno = g; S.preso = null; S.tSel = null; S.sposta = false; ricorda("piantina.giorno", g);
      disegnaBarra(); disegnaSala(); disegnaDiario(); disegnaScheda(); break;
    case "sposta":
      S.sposta = !S.sposta; S.preso = null; disegnaBarra(); disegnaSala(); break;
    case "annulla-preso": S.preso = null; disegnaSala(); break;
    case "apri":
      if (S.sposta) {
        if (S.preso) spostaIn(posto); else { S.preso = { posto }; disegnaSala(); }
        break;
      }
      S.aperto = S.aperto === id ? null : id;
      disegnaSala(); disegnaScheda(); break;
    case "libero":
      if (S.preso) spostaIn(posto); else foglioNuovoCorsista(posto);
      break;
    case "fuori":
      if (S.sposta || S.preso) { S.preso = S.preso?.id === id ? null : { id }; disegnaSala(); }
      else { S.aperto = id; disegnaSala(); disegnaScheda(); }
      break;
    case "metti": {
      const p = piantina(S.giorno);
      const dove = S.foglio.posto && !p.posti[S.foglio.posto] ? S.foglio.posto : postiValidi().find(k => !p.posti[k]);
      chiudiFoglio();
      if (!dove) { avvisa("Non ci sono banchi liberi"); break; }
      p.posti[dove] = id; salvaPiantina(S.giorno, p);
      disegnaSala(); disegnaScheda(); break;
    }
    case "staff": foglioStaff(id, g); break;
    case "scegli-staff": {
      const { id: cid, g: gg } = S.foglio, p = piantina(gg);
      const scelti = p.staff[cid] || [];
      p.staff[cid] = scelti.includes(sid) ? scelti.filter(x => x !== sid) : [...scelti, sid];
      salvaPiantina(gg, p);
      foglioStaff(cid, gg); disegnaSala(); disegnaScheda(); break;
    }
    case "togli-staff-banco": {
      const p = piantina(S.giorno);
      p.staff[id] = (p.staff[id] || []).filter(x => x !== sid);
      salvaPiantina(S.giorno, p);
      disegnaSala(); disegnaScheda(); break;
    }
    case "evidenzia": S.evidenzia = S.evidenzia === sid ? null : sid; disegnaSala(); break;
    case "gestisci-staff": foglioGestisciStaff(); break;
    case "colore-staff": {
      const elenco = staff().map(s => s.id === sid ? { ...s, colore: COLORI[(COLORI.indexOf(s.colore) + 1) % COLORI.length] } : s);
      W("staff", elenco); foglioGestisciStaff(); disegnaSala(); disegnaScheda(); break;
    }
    case "togli-staff": {
      const s = membro(sid);
      W("staff", staff().filter(x => x.id !== sid));
      avvisa(`${s.nome} tolto dallo staff`, true);
      if (S.evidenzia === sid) S.evidenzia = null;
      foglioGestisciStaff(); disegnaSala(); disegnaScheda(); break;
    }
    case "nuovo-corsista": foglioNuovoCorsista(null); break;
    case "copia-su": foglioCopia(); break;
    case "copia": {
      salvaPiantina(g, piantina(S.giorno));
      chiudiFoglio(); avvisa(`Piantina copiata su ${nomeGiorno(g).toLowerCase()}`, true); break;
    }
    case "impostazioni": foglioImpostazioni(); break;
    case "misura": {
      const i = imp(), m = b.dataset.m;
      i[m] = Math.max(1, Math.min(m === "righe" ? 10 : 14, i[m] + +b.dataset.d));
      W("impostazioni", i); foglioImpostazioni(); disegnaSala(); break;
    }
    case "scarica-copia": scaricaCopia(b.dataset.cid); break;
    case "classi": location.hash = ""; break;
    case "apri-classe": location.hash = "c=" + b.dataset.cid; break;
    case "nuova-classe": foglioNuovaClasse(); break;
    case "menu-classe": foglioMenuClasse(b.dataset.cid); break;
    case "account": foglioAccount(); break;
    case "classe-sposta": spostaClasse(b.dataset.cid, +b.dataset.d); break;
    case "elimina-classe": {
      const cid = b.dataset.cid, nome = classe(cid)?.nome;
      if (!b.classList.contains("conferma")) {   // secondo tocco per eliminare (niente finestre del browser)
        b.classList.add("conferma"); b.textContent = `Tocca di nuovo per eliminare «${nome}»`; break;
      }
      D.elenco(`c:${cid}/`).forEach(([k]) => D.scrivi(k, null));
      D.scrivi("classe:" + cid, null);
      chiudiFoglio(); disegnaClassi(); avvisa(`«${nome}» eliminata`, true); break;
    }
    case "esci": chiudiFoglio(); await D.esci(); location.hash = ""; S.classe = null; disegna(); break;
    case "chiudi-foglio": chiudiFoglio(); break;
    case "chiudi-scheda": S.aperto = null; disegnaSala(); disegnaScheda(); break;
    case "menu-corsista": foglioMenuCorsista(); break;
    case "togli-banco": chiudiFoglio(); togliDalBanco(S.aperto); break;
    case "elimina-corsista": {
      const cid = S.aperto, nome = nomeIntero(corsista(cid));
      W("corsista:" + cid, null);
      GIORNI.forEach(({ k }) => {
        const p = piantina(k);   // piantina() salta già i corsisti eliminati
        delete p.staff[cid];
        salvaPiantina(k, p);
      });
      if (L("test")) { const t = test(); togliOvunque(t, "c:" + cid); salvaTest(t); }
      S.aperto = null; chiudiFoglio(); disegnaSala(); disegnaScheda();
      avvisa(`${nome} eliminato`, true); break;
    }
    case "annulla": eseguiAnnulla(); break;
    case "diario-apri": {
      const chiuso = ricorda("piantina.diario") === "chiuso";
      ricorda("piantina.diario", chiuso ? "aperto" : "chiuso");
      disegnaDiario();
      if (chiuso) $("#d-testo")?.focus();
      break;
    }
    case "ripeti": eseguiAnnulla(true); break;
    case "nuova-coppia": nuovaCoppia(); break;
    case "coppia-qui": nuovaCoppia(+b.dataset.slot); break;
    case "t-sel": {
      const chi = b.dataset.chi;
      S.tSel = S.tSel?.chi === chi ? null : { chi, da: "lista" };
      disegnaTest(); break;
    }
    case "t-annulla": S.tSel = null; disegnaTest(); break;
    case "assente": {
      const t = test(), chi = b.dataset.chi;
      togliOvunque(t, chi);   // se seguiva qualche coppia, smette
      if (!t.assenti.includes(chi)) t.assenti.push(chi);
      if (S.tSel?.chi === chi) S.tSel = null;
      salvaTest(t); disegnaTest(); break;
    }
    case "t-assenti": foglioAssenti(b.dataset.tipo); break;
    case "rimetti": {
      const t = test();
      t.assenti = t.assenti.filter(k => k !== b.dataset.chi);
      salvaTest(t); disegnaTest();
      if (t.assenti.some(k => k.startsWith(S.foglio.chi + ":"))) foglioAssenti(S.foglio.chi); else chiudiFoglio();
      break;
    }
    case "t-aggiungi": foglioAggiungiT(b.dataset.tipo); break;
    case "t-rinomina": foglioRinominaT(b.dataset.chi); break;
    case "t-nulla":   // persona dello staff già sistemata: se hai scelto qualcuno a sinistra, scambio con lei
      if (S.tSel && b.closest(".sedia")) applica(S.tSel, b.closest("[data-meta]").dataset.meta);
      break;
    case "togli-t": {
      const chip = b.closest("[data-chi]");
      applica({ chi: chip.dataset.chi, da: chip.dataset.da }, "lista"); break;
    }
    case "apri-t":
      if (S.tSel) { applica(S.tSel, b.closest("[data-meta]").dataset.meta); break; }
      S.aperto = S.aperto === id ? null : id; disegnaScheda(); break;
    case "sedia": {
      const meta = `posto:${b.dataset.cid}:${b.dataset.i}`;
      if (S.tSel) applica(S.tSel, meta); else foglioSedia(b.dataset.cid, b.dataset.i);
      break;
    }
    case "segue-qui": case "super-qui": {
      if (e.target.closest(".t-chip")) break;   // tocco su una persona già lì
      const meta = az === "super-qui" ? "super" : "segue:" + b.dataset.cid;
      if (S.tSel) applica(S.tSel, meta); else foglioSceltaStaff(meta);
      break;
    }
    case "siedi": {
      const meta = S.foglio.meta;
      chiudiFoglio(); applica({ chi: b.dataset.chi, da: "lista" }, meta); break;
    }
    case "elimina-coppia": {
      const t = test(), c = coppiaDi(t, b.dataset.cid);
      if (!c) break;
      t.coppie = t.coppie.filter(x => x !== c);
      salvaTest(t); disegnaTest();
      if (c.posti.some(Boolean) || c.seguono.length) avvisa("Coppia eliminata", true);
      break;
    }
    case "d-aggiungi": aggiungiNota(); break;
    case "d-elimina":
      W(b.dataset.voce, null); disegnaVoci(); avvisa("Nota eliminata", true);
      break;
    case "cambia-accesso": S.nuovoAccount = !S.nuovoAccount; disegnaAccesso(); break;
  }
});

function aggiungiNota() {
  const t = $("#d-testo"), testo = t.value.trim();
  if (!testo) return t.focus();
  W(`diario:${S.giorno}:${nuovoId()}`, { ora: new Date().toISOString(), testo });
  t.value = "";
  disegnaVoci();
  t.focus();
}

document.addEventListener("keydown", e => {
  // ⌘Z annulla, ⇧⌘Z ripete (dentro un campo di testo vale l'annulla normale del testo)
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.target.closest?.("input, textarea, select, [contenteditable]")) {
    e.preventDefault();
    eseguiAnnulla(e.shiftKey);
    return;
  }
  if (e.target.id === "d-testo" && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); aggiungiNota(); }
  if (e.key === "Escape") {
    if (!$("#foglio").hidden) chiudiFoglio();
    else if (S.preso) { S.preso = null; disegnaSala(); }
    else if (S.aperto) { S.aperto = null; disegnaSala(); disegnaScheda(); }
  }
});

// scrivere nella scheda: si salva a ogni lettera
document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.campo || t.dataset.nome) {
    const c = corsista(S.aperto);
    if (!c) return;
    const nuovo = t.dataset.campo
      ? { ...c, appunti: { ...(c.appunti || {}), [t.dataset.campo]: t.value } }
      : { ...c, [t.dataset.nome]: t.value };
    W("corsista:" + S.aperto, nuovo, { unisci: true });
    if (t.tagName === "TEXTAREA") allunga(t);
    if (t.tagName === "SELECT") t.parentElement.style.setProperty("--colore", coloreDi(t.value));
    disegnaSala();
  } else if (t.closest?.("[data-form=corsista]")) {
    // mentre scrivi il nome, tra i corsisti recenti restano solo quelli che somigliano
    const f = t.form, cerca = semplice(`${f.nome.value} ${f.cognome.value}`);
    const parole = cerca.split(/\s+/).filter(Boolean);
    let visibili = 0;
    document.querySelectorAll("#recenti [data-cerca]").forEach(ch => {
      const si = parole.every(p => ch.dataset.cerca.includes(p));
      ch.hidden = !si; visibili += si;
    });
    const r = $("#recenti"); if (r) r.hidden = !visibili;
  } else if (t.dataset.voce) {
    allunga(t);
  } else if (t.id === "d-testo") {
    // niente: si salva con Invio o «Aggiungi»
  }
});

document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.voce) {   // nota del diario corretta
    const v = L(t.dataset.voce);
    if (!v) return;
    if (!t.value.trim()) { W(t.dataset.voce, null); disegnaVoci(); avvisa("Nota eliminata", true); return; }
    W(t.dataset.voce, { ...v, testo: t.value.trim() });
  } else if (t.dataset.rinominaStaff) {
    const nome = t.value.trim();
    if (!nome) return foglioGestisciStaff();
    W("staff", staff().map(s => s.id === t.dataset.rinominaStaff ? { ...s, nome } : s));
    disegnaSala(); disegnaScheda();
  } else if (t.dataset.rinominaClasse) {
    const cid = t.dataset.rinominaClasse, nome = t.value.trim();
    if (!nome || !classe(cid)) return;
    D.scrivi("classe:" + cid, { ...classe(cid), nome });
    if ($("#barra")) disegnaBarra(); else disegnaClassi();
  } else if (t.dataset.file === "importa" && t.files[0]) {
    importa(t.files[0]);
  }
});

document.addEventListener("submit", async e => {
  const f = e.target, tipo = f.dataset.form;
  if (!tipo) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f));
  if (tipo === "accesso") {
    f.querySelector("button").disabled = true;
    try { await D.accedi(v.email.trim(), v.password, S.nuovoAccount); disegna(); }
    catch (err) { disegnaAccesso(err.message === "Invalid login credentials" ? "Email o password sbagliate." : err.message); }
  } else if (tipo === "t-nuovo") {
    if (!v.nome.trim()) return;
    if (S.foglio.chi === "s") aggiungiStaff(v.nome); else creaCorsista(v.nome, v.cognome || "", null);
    chiudiFoglio(); disegnaTest();
  } else if (tipo === "t-rinomina") {
    const chi = S.foglio.chi, nome = v.nome.trim();
    if (!nome) return;
    if (chi.startsWith("s:")) W("staff", staff().map(s => s.id === chi.slice(2) ? { ...s, nome } : s));
    else { const c = corsista(chi.slice(2)); if (c) W("corsista:" + chi.slice(2), { ...c, nome, cognome: (v.cognome || "").trim() }); }
    chiudiFoglio(); disegnaTest(); disegnaScheda();
  } else if (tipo === "nuova-classe") {
    if (!v.nome.trim()) return;
    const id = creaClasse(v.nome, v.da || null);
    chiudiFoglio();
    location.hash = "c=" + id;
  } else if (tipo === "staff" || tipo === "staff-qui") {
    const s = aggiungiStaff(v.nome);
    if (!s) return;
    if (tipo === "staff-qui") {
      const { id, g } = S.foglio, p = piantina(g);
      p.staff[id] = [...(p.staff[id] || []), s.id];
      salvaPiantina(g, p);
    }
    ridisegnaFoglio(); disegnaSala(); disegnaScheda();
    $("#foglio input[name=nome]")?.focus();
  } else if (tipo === "corsista") {
    if (!v.nome.trim()) return;
    const { dove } = creaCorsista(v.nome, v.cognome || "", S.foglio.posto);
    chiudiFoglio(); disegnaSala();
    if (!dove) avvisa("Banchi pieni: è in «Non in sala»");
  } else if (tipo === "elenco") {
    const righe = v.elenco.split("\n").map(r => r.trim()).filter(Boolean);
    let senzaBanco = 0;
    for (const r of righe) {
      const [nome, ...resto] = r.split(/\s+/);
      if (!creaCorsista(nome, resto.join(" "), null).dove) senzaBanco++;
    }
    chiudiFoglio(); disegnaSala();
    avvisa(`${righe.length} corsisti aggiunti${senzaBanco ? ` · ${senzaBanco} senza banco` : ""}`);
  }
});

// ---------- trascinare (Mac e iPad) ----------
document.addEventListener("dragstart", e => {
  const el = e.target.closest?.("[draggable=true]");
  if (!el) return;
  if (el.dataset.sid) {   // una persona dello staff presa dalla legenda
    S.staffTrascinato = el.dataset.sid; S.preso = null;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", el.dataset.sid);
    return el.classList.add("trascinato");
  }
  S.preso = el.dataset.posto ? { posto: el.dataset.posto } : { id: el.dataset.id };
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", el.dataset.id || "");
  el.classList.add("trascinato");
});
document.addEventListener("dragend", e => {
  e.target.classList?.remove("trascinato");
  S.staffTrascinato = null;
  document.querySelectorAll(".sopra").forEach(x => x.classList.remove("sopra"));
});
document.addEventListener("dragover", e => {
  if (S.staffTrascinato) {
    const banco = e.target.closest?.(".banco[data-id]");
    document.querySelectorAll(".sopra").forEach(x => x !== banco && x.classList.remove("sopra"));
    if (!banco) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    return banco.classList.add("sopra");
  }
  const meta = e.target.closest?.("[data-posto], [data-zona=fuori]");
  if (!meta || !S.preso) return;
  e.preventDefault();
  document.querySelectorAll(".sopra").forEach(x => x !== meta && x.classList.remove("sopra"));
  meta.classList.add("sopra");
});
document.addEventListener("drop", e => {
  if (S.staffTrascinato) {
    const banco = e.target.closest?.(".banco[data-id]"), sid = S.staffTrascinato;
    S.staffTrascinato = null;
    if (!banco) return;
    e.preventDefault();
    const p = piantina(S.giorno), id = banco.dataset.id;
    const scelti = p.staff[id] || [];
    if (!scelti.includes(sid)) { p.staff[id] = [...scelti, sid]; salvaPiantina(S.giorno, p); }
    disegnaSala(); disegnaScheda();
    return;
  }
  const meta = e.target.closest?.("[data-posto], [data-zona=fuori]");
  if (!meta || !S.preso) return;
  e.preventDefault();
  if (meta.dataset.zona === "fuori") {
    const id = S.preso.id ?? piantina(S.giorno).posti[S.preso.posto];
    S.preso = null;
    togliDalBanco(id);
  } else spostaIn(meta.dataset.posto);
});

// ---------- modifiche arrivate dagli altri dispositivi ----------
D.suCambio(() => {
  migra();
  if (presa?.avviata) return;   // non ridisegno sotto le dita mentre trascini
  if (!D.chiSei() && !D.PROVA) return;
  if (S.classe && !classe(S.classe)) { location.hash = ""; return; }   // classe eliminata da un altro dispositivo
  if (!$("#barra")) {   // sono nell'elenco delle classi
    leggiIndirizzo();
    if (S.classe) return disegna();
    if (!document.activeElement?.closest?.("#foglio")) disegnaClassi();
    return;
  }
  disegnaBarra(); disegnaSala(); disegnaVoci(); aggiornaScheda();
  if (S.foglio?.tipo === "staff" || S.foglio?.tipo === "gestisci") {
    if (!document.activeElement?.closest?.("#foglio")) ridisegnaFoglio();
  }
});
D.suStato(mostraStato);
D.suRegistro(aggiornaAnnulla);
addEventListener("hashchange", () => {
  leggiIndirizzo();
  Object.assign(S, { aperto: null, preso: null, sposta: false, evidenzia: null });
  chiudiFoglio(); disegna();
});
// passando da stretto a largo (es. iPhone girato) la sala cambia disposizione
SCHERMO_TELEFONO.addEventListener("change", () => { if ($("#sala")) disegnaSala(); });

// ---------- partenza ----------
function datiDiProva() {
  if (classi().length) return;
  const prima = S.classe;
  S.classe = creaClasse("Corso di prova", null);
  const nomi = ["Giulia Ferri", "Alessandro Riva", "Sara Conti", "Pietro Gallo", "Elena Marchi", "Marco De Luca", "Chiara Bassi", "Tommaso Neri", "Francesca Villa", "Luca Mori"];
  ["Marta", "Luca", "Anna", "Davide"].forEach(aggiungiStaff);
  nomi.forEach(n => { const [a, ...b] = n.split(" "); creaCorsista(a, b.join(" "), null); });
  S.classe = prima;
}

(async () => {
  try {
    await D.avvia();
  } catch (e) {
    console.warn(e);
  }
  if (D.PROVA || D.stato_() === "ok") migra();   // solo dopo aver scaricato le ultime novità
  if (D.PROVA) D.senzaRegistro(datiDiProva);
  leggiIndirizzo();
  disegna();
})();

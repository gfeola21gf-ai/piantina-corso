/* dati.js — dove stanno i dati.
   Tutto è salvato SUBITO sul dispositivo (localStorage) e poi mandato a Supabase,
   così l'app funziona anche se la rete cade. Ogni 20 secondi (e quando torni sull'app)
   scarica le modifiche fatte dagli altri tuoi dispositivi.

   I dati sono "cassetti" chiave → valore (vedi supabase/piantina.sql).
   valore = null vuol dire eliminato. */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";
import { SUPABASE_URL, SUPABASE_CHIAVE_PUBBLICA } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_CHIAVE_PUBBLICA);
const TABELLA = "piantina_dati";

/** ?prova nell'indirizzo = modalità prova: niente account, dati solo su questo dispositivo */
export const PROVA = new URLSearchParams(location.search).has("prova");

let utente = null;
let mappa = {};              // chiave → valore
let inAttesa = new Set();    // chiavi cambiate qui e non ancora arrivate a Supabase
let ultimo = null;           // ora dell'ultima modifica scaricata
let stato = "ok";            // ok | invio | offline
// CLASSI CONDIVISE: chi c'è in ogni classe condivisa (anche le mie) → [{owner_id, classe_id, user_id, nome, colore}]
let soci = [];
let unisci = null;           // funzione dell'app per unire due versioni della stessa chiave (scritte da persone diverse)
const suCambi = new Set(), suStati = new Set();

const cassetto = () => PROVA ? "piantina.prova" : "piantina." + utente?.id;

function salvaLocale() {
  try { localStorage.setItem(cassetto(), JSON.stringify({ mappa, inAttesa: [...inAttesa], ultimo, soci })); } catch { /* spazio pieno o privato */ }
}
function caricaLocale() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(cassetto()) || "null"); } catch { /* niente */ }
  mappa = d?.mappa || {};
  inAttesa = new Set(d?.inAttesa || []);
  ultimo = d?.ultimo || null;
  soci = d?.soci || [];
}

// ---------- classi condivise ----------
/** id della classe a cui appartiene una chiave ("classe:<id>" o "c:<id>/…"), oppure null */
const classeDi = k => k.startsWith("classe:") ? k.slice(7) : k.startsWith("c:") ? k.slice(2, k.indexOf("/")) : null;
/** di chi sono i dati di quella classe: il proprietario se me l'hanno condivisa, altrimenti io */
export function proprietario(cid) {
  const s = soci.find(x => x.classe_id === cid && x.user_id === utente?.id);
  return s ? s.owner_id : ioSono();
}
/** modalità prova: persone finte per vedere i colori */
export const sociDiProva = l => { soci = l; };
export const condivisaConMe = cid => !!utente && proprietario(cid) !== utente.id;
/** le persone di una classe condivisa (vuoto = non condivisa) */
export const sociDi = cid => soci.filter(x => x.classe_id === cid && x.owner_id === proprietario(cid));
export const ioSono = () => PROVA ? "prova" : utente?.id;
export const suUnisci = f => { unisci = f; };

async function scaricaSoci() {
  const { data, error } = await sb.from("piantina_membri").select("owner_id, classe_id, user_id, nome, colore").order("entrato_il");
  if (error) { console.warn("Membri non scaricati:", error.message); return false; }
  const mie = l => new Set(l.filter(x => x.user_id === utente.id && x.owner_id !== utente.id).map(x => x.owner_id + "/" + x.classe_id));
  const prima = mie(soci), dopo = mie(data);
  const cambiato = JSON.stringify(soci) !== JSON.stringify(data);
  soci = data;
  // una classe nuova condivisa con me: riscarico tutto da capo (i suoi dati sono "vecchi" rispetto al mio ultimo download)
  if ([...dopo].some(x => !prima.has(x))) ultimo = null;
  // non sono più in una classe: tolgo i suoi dati da questo dispositivo
  for (const x of prima) if (!dopo.has(x)) {
    const cid = x.split("/")[1];
    Object.keys(mappa).forEach(k => { if (classeDi(k) === cid) { delete mappa[k]; inAttesa.delete(k); } });
  }
  if (cambiato) { salvaLocale(); suCambi.forEach(f => f()); }
  return true;
}
function cambiaStato(s) {
  if (s === stato) return;
  stato = s;
  suStati.forEach(f => f(s));
}

// ---------- leggere e scrivere ----------
export const leggi = chiave => mappa[chiave] ?? null;
/** tutte le coppie [chiave, valore] che iniziano con il prefisso (eliminate escluse) */
export const elenco = prefisso => Object.entries(mappa).filter(([k, v]) => v != null && k.startsWith(prefisso));
export const chiavi = () => Object.keys(mappa).filter(k => mappa[k] != null);

export function scrivi(chiave, valore, { unisci = false } = {}) {
  if (registro) ricordaPrima(chiave, unisci);
  mappa[chiave] = valore ?? null;
  inAttesa.add(chiave);
  salvaLocale();
  programmaInvio();
}

// ---------- annulla / ripeti (⌘Z, ⇧⌘Z) ----------
// Ogni azione è un "passo": le scritture fatte nello stesso istante (es. elimina corsista = 4 chiavi) stanno insieme.
// Mentre scrivi in un campo, le lettere della stessa casella si uniscono in un passo solo (fino a 2 secondi di pausa).
const annullabili = [], ripetibili = [], suRegistri = new Set();
let registro = true, passo = null;
const copia = v => v == null ? null : JSON.parse(JSON.stringify(v));
function ricordaPrima(chiave, unisci) {
  const ultimo = annullabili[annullabili.length - 1], ora = Date.now();
  if (!passo && unisci && ultimo?.unisci === chiave && ora - ultimo.quando < 2000) { ultimo.quando = ora; return; }
  if (!passo) {
    passo = { prima: {}, quando: ora, unisci: unisci ? chiave : null };
    annullabili.push(passo);
    if (annullabili.length > 100) annullabili.shift();
    ripetibili.length = 0;
    setTimeout(() => { passo = null; suRegistri.forEach(f => f()); }, 0);
  }
  if (!(chiave in passo.prima)) passo.prima[chiave] = copia(mappa[chiave]);
}
function applicaPasso(da, verso) {
  const p = da.pop();
  if (!p) return false;
  const opposto = { prima: {}, quando: Date.now(), unisci: null };
  registro = false;
  for (const [k, v] of Object.entries(p.prima)) { opposto.prima[k] = copia(mappa[k]); scrivi(k, v); }
  registro = true;
  verso.push(opposto);
  suRegistri.forEach(f => f());
  return true;
}
export const annulla = () => applicaPasso(annullabili, ripetibili);
export const ripeti = () => applicaPasso(ripetibili, annullabili);
export const puoiAnnullare = () => annullabili.length > 0;
export const suRegistro = f => suRegistri.add(f);
/** scritture che non si annullano (es. sistemare i dati vecchi all'apertura) */
export function senzaRegistro(f) { registro = false; try { f(); } finally { registro = true; } }

export const stato_ = () => stato;
export const suCambio = f => suCambi.add(f);   // chiamata quando arrivano modifiche da altri dispositivi
export const suStato = f => suStati.add(f);
export const chiSei = () => utente;

// ---------- sincronizzazione con Supabase ----------
let timerInvio = null, inCorso = false;
function programmaInvio(ms = 800) {
  if (PROVA || !utente) return;
  cambiaStato("invio");
  clearTimeout(timerInvio);
  timerInvio = setTimeout(sincronizza, ms);
}

async function invia() {
  if (!inAttesa.size) return true;
  const chiaviDaInviare = [...inAttesa];
  const testi = chiaviDaInviare.map(k => JSON.stringify(mappa[k] ?? null));   // "fotografia" di ciò che mando
  const righe = chiaviDaInviare.map((k, i) => {
    const cid = classeDi(k);
    return { user_id: cid ? proprietario(cid) : utente.id, chiave: k, valore: JSON.parse(testi[i]) };
  });
  const { error } = await sb.from(TABELLA).upsert(righe, { onConflict: "user_id,chiave" });
  if (error) { console.warn("Invio non riuscito:", error.message); return false; }
  // tolgo dall'attesa solo ciò che non è cambiato mentre inviavo
  chiaviDaInviare.forEach((k, i) => { if (JSON.stringify(mappa[k] ?? null) === testi[i]) inAttesa.delete(k); });
  salvaLocale();
  return true;
}

async function scarica() {
  let cambiato = false;
  for (let giro = 0; giro < 50; giro++) {
    let q = sb.from(TABELLA).select("chiave, valore, aggiornato_il").order("aggiornato_il").limit(500);
    if (ultimo) q = q.gt("aggiornato_il", ultimo);
    const { data, error } = await q;
    if (error) { console.warn("Download non riuscito:", error.message); return false; }
    for (const r of data) {
      ultimo = r.aggiornato_il;
      if (inAttesa.has(r.chiave)) {
        // qui c'è una versione non ancora inviata: se un'altra persona ha scritto la stessa chiave, unisco le due
        const unita = unisci && r.valore != null && mappa[r.chiave] != null ? unisci(r.chiave, mappa[r.chiave], r.valore) : null;
        if (unita && JSON.stringify(unita) !== JSON.stringify(mappa[r.chiave])) { mappa[r.chiave] = unita; cambiato = true; }
        continue;
      }
      if (JSON.stringify(mappa[r.chiave] ?? null) !== JSON.stringify(r.valore ?? null)) {
        mappa[r.chiave] = r.valore;
        cambiato = true;
      }
    }
    if (data.length < 500) break;
  }
  salvaLocale();
  if (cambiato) suCambi.forEach(f => f());
  return true;
}

export async function sincronizza() {
  if (PROVA || !utente || inCorso) return;
  inCorso = true;
  clearTimeout(timerInvio);
  try {
    // prima scarico (così unisco ciò che hanno scritto gli altri), poi invio
    const ok = (await scaricaSoci()) && (await scarica()) && (await invia());
    if (inAttesa.size && ok) programmaInvio(300);
    else cambiaStato(ok ? "ok" : "offline");
    if (!ok) { clearTimeout(timerInvio); timerInvio = setTimeout(sincronizza, 15000); }
  } catch (e) {
    console.warn(e);
    cambiaStato("offline");
  } finally {
    inCorso = false;
  }
}

// ---------- account ----------
/** all'apertura: true se si può entrare (account già collegato o modalità prova) */
export async function avvia() {
  if (PROVA) { caricaLocale(); return true; }
  const { data } = await sb.auth.getSession();
  utente = data.session?.user || null;
  if (!utente) return false;
  caricaLocale();
  await sincronizza();   // prima di mostrare le classi, scarico le ultime novità (se c'è rete)
  return true;
}

export async function accedi(email, password, nuovo = false) {
  const { data, error } = nuovo
    ? await sb.auth.signUp({ email, password })
    : await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.session) throw new Error("Controlla la posta: c'è un'email per confermare l'account, poi accedi.");
  utente = data.session.user;
  caricaLocale();
  await sincronizza();
}

export async function esci() {
  await sincronizza();
  await sb.auth.signOut();
  utente = null;
  mappa = {}; soci = [];
}

// ---------- condividere una classe ----------
async function rpc(nome, args) {
  const { data, error } = await sb.rpc(nome, args);
  if (error) throw new Error(error.message);
  return data;
}
/** il proprietario condivide: entra con nome e colore, riceve il codice del link */
export async function condividi(cid, nome, colore) {
  await sincronizza();   // la classe deve essere già online
  const codice = await rpc("piantina_condividi", { p_classe: cid, p_nome: nome, p_colore: colore });
  await scaricaSoci();
  return codice;
}
export async function codiceInvito(cid) {
  const { data } = await sb.from("piantina_inviti").select("codice").eq("classe_id", cid).eq("owner_id", utente.id).maybeSingle();
  return data?.codice || null;
}
export const nuovoInvito = cid => rpc("piantina_nuovo_invito", { p_classe: cid });
export const infoInvito = codice => rpc("piantina_invito", { p_codice: codice });
export async function entra(codice, nome, colore) {
  const r = await rpc("piantina_entra", { p_codice: codice, p_nome: nome, p_colore: colore });
  await sincronizza();
  return r.classe_id;
}
/** cambio il mio nome o colore in una classe */
export async function cambiaProfilo(cid, nome, colore) {
  const { error } = await sb.from("piantina_membri").update({ nome, colore })
    .eq("owner_id", proprietario(cid)).eq("classe_id", cid).eq("user_id", utente.id);
  if (error) throw new Error(error.message);
  await scaricaSoci();
}
/** esco da una classe condivisa con me, oppure (proprietario) tolgo qualcuno */
export async function togliSocio(cid, uid) {
  const { error } = await sb.from("piantina_membri").delete()
    .eq("owner_id", proprietario(cid)).eq("classe_id", cid).eq("user_id", uid);
  if (error) throw new Error(error.message);
  await scaricaSoci();
}

// controlli periodici: ogni 10 secondi, quando torni sull'app e quando torna la rete
setInterval(() => { if (!document.hidden) sincronizza(); }, 10000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) sincronizza(); });
addEventListener("online", () => sincronizza());
addEventListener("pagehide", () => { if (inAttesa.size) sincronizza(); });

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
const suCambi = new Set(), suStati = new Set();

const cassetto = () => PROVA ? "piantina.prova" : "piantina." + utente?.id;

function salvaLocale() {
  try { localStorage.setItem(cassetto(), JSON.stringify({ mappa, inAttesa: [...inAttesa], ultimo })); } catch { /* spazio pieno o privato */ }
}
function caricaLocale() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(cassetto()) || "null"); } catch { /* niente */ }
  mappa = d?.mappa || {};
  inAttesa = new Set(d?.inAttesa || []);
  ultimo = d?.ultimo || null;
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
  const righe = chiaviDaInviare.map((k, i) => ({ user_id: utente.id, chiave: k, valore: JSON.parse(testi[i]) }));
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
      if (inAttesa.has(r.chiave)) continue;   // qui c'è una versione più nuova, non ancora inviata
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
    const ok = (await invia()) && (await scarica());
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
  mappa = {};
}

// controlli periodici: ogni 20 secondi, quando torni sull'app e quando torna la rete
setInterval(() => { if (!document.hidden) sincronizza(); }, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) sincronizza(); });
addEventListener("online", () => sincronizza());
addEventListener("pagehide", () => { if (inAttesa.size) sincronizza(); });

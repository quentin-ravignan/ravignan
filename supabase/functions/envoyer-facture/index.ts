// Envoie la facture PDF d'une transaction au client :
// - par email depuis la boîte contact@armagnac-ravignan.com (Gmail), PDF joint, si le client a un email ;
// - sinon par SMS (OVH) avec un lien court de téléchargement, si le client a un portable.
//   Le PDF est rangé dans le bucket « factures » sous un nom aléatoire impossible à deviner.
//   Si OVH n'est pas configuré, la fonction renvoie le lien : l'app ouvre alors Messages sur le téléphone du vendeur.
// Secrets (Edge Functions → Secrets) : GMAIL_USER, GMAIL_APP_PASSWORD ;
//   pour le SMS : OVH_APP_KEY, OVH_APP_SECRET, OVH_CONSUMER_KEY ; OVH_SMS_SERVICE (sinon le 1er service du compte) et OVH_SMS_SENDER facultatifs.
// L'adresse et le numéro sont relus dans la base (collection « clients ») : l'appelant ne peut pas les choisir.
// Réservé aux membres connectés.
import nodemailer from "npm:nodemailer@6.9.14";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_ENVOIS = 5;
const SITE = "https://app.armagnac-ravignan.com";
const AVIS = "https://maps.google.com/?cid=9627672053882881379"; // fiche Google Maps du Château de Ravignan
const LOGO = "https://app.armagnac-ravignan.com/images/blason.jpg";
// signature : prénom du vendeur, puis le domaine et ses coordonnées
const signature = (vendeur: string) =>
  [String(vendeur || "").trim().split(/\s+/)[0], "Domaine de Ravignan", "40190 Perquie · 05 58 45 33 07", "contact@armagnac-ravignan.com"]
    .filter(Boolean).join("\n");
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
// pied de mail commun (textes validés par Benoît) : modération (loi Évin), identité de la SCEA, information RGPD, désinscription
const MODERATION = "L'abus d'alcool est dangereux pour la santé, à consommer avec modération.";
const IDENTITE = "SCEA du Domaine de Ravignan, société civile d'exploitation agricole au capital de 451 680 €, Château de Ravignan, 40190 Perquie. SIREN 478 355 779 RCS Mont-de-Marsan.";
const MENTION_DONNEES = "Vos coordonnées, recueillies lors de votre achat, sont utilisées par la SCEA du Domaine de Ravignan pour établir votre facture et, sauf opposition de votre part, pour vous informer de nos ventes et nouveautés. Elles ne sont jamais cédées et sont conservées 3 ans après notre dernier échange (10 ans pour les factures). Vous pouvez y accéder, les rectifier, les supprimer ou vous opposer à leur utilisation en écrivant à contact@armagnac-ravignan.com, et saisir la CNIL (cnil.fr).";
const BOUTIQUE = "https://www.armagnac-ravignan.com";
const piedTexte = (desabo: string) =>
  `${MODERATION}\n\n${IDENTITE}\n\n${MENTION_DONNEES}${desabo ? ` Ne plus recevoir nos emails : ${desabo}` : ""}`;
// lien de désabonnement personnel (jeton aléatoire, sans l'adresse dans le lien)
async function lienDesabo(db: any, email: string) {
  const { data } = await db.rpc("jeton_desabonnement", { adresse: email });
  return data ? `https://app.armagnac-ravignan.com/desabonnement/?j=${data}` : "";
}
// paragraphes : texte simple ; les adresses web deviennent des liens
const lier = (t: string) => esc(t).replace(/(https?:\/\/[^\s<]+|armagnac-ravignan\.com)(?![^<]*>)/g, (u) =>
  `<a href="${u.startsWith("http") ? u : "https://www." + u}" style="color:#5a2f28">${u.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>`);
const html = (paragraphes: string[], vendeur: string, desabo = "") =>
  `<div style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#2b1a17;max-width:560px">`
  + paragraphes.map((p) => `<p>${lier(p)}</p>`).join("")
  + `<p><a href="${AVIS}" style="display:inline-block;background:#5a2f28;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-family:Arial,sans-serif;font-weight:bold">⭐ Donner mon avis sur Google</a></p>`
  + `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid #e8dcd6"><tr>`
  + `<td style="padding:14px 14px 0 0;vertical-align:top"><img src="${LOGO}" alt="Domaine de Ravignan" width="64" height="64" style="display:block;border:0"></td>`
  + `<td style="padding-top:14px;vertical-align:top;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#7a625d">`
  + signature(vendeur).split("\n").map((l, i) => i === 0 && vendeur.trim() ? `<b style="color:#5a2f28;font-size:14px">${esc(l)}</b>` : esc(l)).join("<br>")
  + `</td></tr></table>`
  + `<p style="margin-top:18px;font-family:Arial,sans-serif;font-size:12px;font-weight:bold;color:#7a625d">${esc(MODERATION)}</p>`
  + `<p style="font-family:Arial,sans-serif;font-size:11px;line-height:1.5;color:#9b8580">${esc(IDENTITE)}<br><br>${esc(MENTION_DONNEES)}`
  + (desabo ? ` <a href="${desabo}" style="color:#9b8580">Ne plus recevoir nos emails</a>` : "")
  + `</p></div>`;
const reponse = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// portable français (06/07) ou numéro international, au format +33612345678 ; sinon null
function portable(t: string): string | null {
  const d = String(t || "").replace(/[\s.\-()]/g, "");
  let m = d.match(/^(?:\+33|0033|0)([67]\d{8})$/);
  if (m) return "+33" + m[1];
  m = d.match(/^(?:\+|00)(\d{8,15})$/);
  if (m && !m[1].startsWith("33")) return "+" + m[1];
  return null;
}
const codeAleatoire = () => {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(22)), (b) => a[b % a.length]).join("");
};
const sha1 = async (t: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(t))), (b) => b.toString(16).padStart(2, "0")).join("");

// SMS par l'API OVH (requête signée)
async function appelOvh(methode: string, url: string, corps = "") {
  const ak = Deno.env.get("OVH_APP_KEY")!, as = Deno.env.get("OVH_APP_SECRET")!, ck = Deno.env.get("OVH_CONSUMER_KEY")!;
  const ts = String(await fetch("https://eu.api.ovh.com/1.0/auth/time").then((r) => r.text()).then((s) => parseInt(s)).catch(() => Math.round(Date.now() / 1000)));
  const sig = "$1$" + await sha1([as, ck, methode, url, corps, ts].join("+"));
  return fetch(url, {
    method: methode, ...(corps ? { body: corps } : {}),
    headers: { "Content-Type": "application/json", "X-Ovh-Application": ak, "X-Ovh-Consumer": ck, "X-Ovh-Timestamp": ts, "X-Ovh-Signature": sig },
  });
}
async function smsOvh(numero: string, message: string) {
  if (!Deno.env.get("OVH_APP_KEY") || !Deno.env.get("OVH_APP_SECRET") || !Deno.env.get("OVH_CONSUMER_KEY")) throw new Error("SMS OVH pas encore configuré");
  // service SMS : secret OVH_SMS_SERVICE, sinon le premier service du compte
  let service = Deno.env.get("OVH_SMS_SERVICE");
  if (!service) {
    const l = await appelOvh("GET", "https://eu.api.ovh.com/1.0/sms").then((r) => r.json()).catch(() => []);
    service = Array.isArray(l) ? l[0] : undefined;
    if (!service) throw new Error("Aucun service SMS sur le compte OVH");
  }
  // expéditeur : secret OVH_SMS_SENDER, sinon le premier expéditeur validé du compte (ex. RAVIGNAN).
  // Sans expéditeur, OVH envoie par numéro court, qui refuse les SMS contenant un lien.
  let sender = Deno.env.get("OVH_SMS_SENDER");
  if (!sender) {
    const noms = await appelOvh("GET", `https://eu.api.ovh.com/1.0/sms/${service}/senders`).then((r) => r.json()).catch(() => []);
    for (const n of Array.isArray(noms) ? noms : []) {
      const d = await appelOvh("GET", `https://eu.api.ovh.com/1.0/sms/${service}/senders/${encodeURIComponent(n)}`).then((r) => r.json()).catch(() => ({}));
      if (d.status === "enable") { sender = n; break; }
    }
  }
  const url = `https://eu.api.ovh.com/1.0/sms/${service}/jobs`;
  const corps = JSON.stringify({
    message, receivers: [numero], charset: "UTF-8", coding: "7bit", priority: "high", noStopClause: true,
    ...(sender ? { sender, senderForResponse: false } : { senderForResponse: true }),
  });
  const r = await appelOvh("POST", url, corps);
  const res = await r.json().catch(() => ({}));
  if (!r.ok || (Array.isArray(res.invalidReceivers) && res.invalidReceivers.length)) {
    console.error("OVH", r.status, res);
    if (!sender && /shortcode|contact information/i.test(String(res.message || "")))
      throw new Error("OVH : aucun expéditeur validé (ex. RAVIGNAN) sur le compte SMS ; sans lui, OVH refuse les SMS avec un lien");
    throw new Error(res.message ? "OVH : " + res.message : "Le SMS n'est pas parti");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reponse({ erreur: "Méthode non autorisée" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const moi = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: membre } = await moi.rpc("est_membre");
    if (membre !== true) return reponse({ erreur: "Connectez-vous pour envoyer une facture." }, 403);

    const { tx, pdf } = await req.json();
    if (typeof tx !== "string" || typeof pdf !== "string") return reponse({ erreur: "Requête incomplète" }, 400);
    if (pdf.length > 2_800_000) return reponse({ erreur: "PDF trop lourd" }, 413);
    const contenu = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
    if (new TextDecoder().decode(contenu.slice(0, 5)) !== "%PDF-") return reponse({ erreur: "Ce n'est pas un PDF" }, 400);

    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: t } = await db.from("docs").select("data").eq("collection", "transactions").eq("id", tx).maybeSingle();
    if (!t) return reponse({ erreur: "Transaction inconnue" }, 404);
    const num = t.data.facture;
    if (!num) return reponse({ erreur: "La facture n'a pas encore de numéro" }, 409);
    // archive légale (10 ans) : la première version de chaque facture est gardée, jamais remplacée
    await db.storage.from("archives").upload(`${num}.pdf`, contenu, { contentType: "application/pdf", upsert: false }).catch(() => {});
    const envois = Array.isArray(t.data.facture_envois) ? t.data.facture_envois : [];
    if (envois.length >= MAX_ENVOIS) return reponse({ erreur: "Facture déjà envoyée " + MAX_ENVOIS + " fois" }, 429);
    const { data: c } = await db.from("docs").select("data").eq("collection", "clients").eq("id", tx).maybeSingle();
    const email = String(c?.data?.email || "").trim();
    const tel = portable(String(c?.data?.tel || ""));
    const total = Number(t.data.total || 0).toFixed(2).replace(".", ",") + " €";
    const avoir = t.data.type === "avoir";
    const vendeur = String(t.data.vendeurPrenom || "");
    const enregistrer = async (envoi: Record<string, string>, extra: Record<string, unknown> = {}) =>
      await db.from("docs").update({ data: { ...t.data, ...extra, ...(envoi.a ? { facture_envois: [...envois, envoi] } : {}) }, updated_at: new Date().toISOString() })
        .eq("collection", "transactions").eq("id", tx);

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const user = Deno.env.get("GMAIL_USER")!;
      const desabo = await lienDesabo(db, email);
      const transport = nodemailer.createTransport({
        host: "smtp.gmail.com", port: 465, secure: true,
        auth: { user, pass: Deno.env.get("GMAIL_APP_PASSWORD")! },
      });
      // mail 1 (texte validé par Benoît) : la vente (événement) et sa date
      const { data: ve } = await db.from("docs").select("data").eq("collection", "ventes").eq("id", String(t.data.venteId || "")).maybeSingle();
      // jamais le nom interne de la vente : « notre vente à Toulouse »
      const lieu = String(ve?.data?.lieu || "").trim();
      const evenement = lieu ? `notre vente à ${lieu}` : "notre vente";
      const jour = new Date(t.data.date || Date.now()).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
      const paragraphes = avoir
        ? [`Madame, Monsieur,`,
          `Vous trouverez ci-joint l'avoir n° ${num} (${total}), qui annule ${t.data.partiel ? "en partie " : ""}la facture ${t.data.factureOrigine || ""} de votre achat lors de ${evenement}.`,
          `Pour retrouver toutes nos cuvées : armagnac-ravignan.com`]
        : [`Madame, Monsieur,`,
          `Merci pour votre achat lors de ${evenement}, le ${jour}. Vous trouverez ci-joint votre facture n° ${num}.`,
          `Si notre armagnac vous a plu, votre avis compte beaucoup pour un domaine familial comme le nôtre. Une minute suffit pour le partager sur Google : ${AVIS}`,
          `Pour retrouver toutes nos cuvées : armagnac-ravignan.com`];
      await transport.sendMail({
        from: `"Domaine de Ravignan" <${user}>`,
        to: email,
        subject: avoir ? `Votre avoir Domaine de Ravignan` : `Votre facture Domaine de Ravignan`,
        text: `${paragraphes.join("\n\n")}\n\n${signature(vendeur)}\n\n${piedTexte(desabo)}`,
        html: html(paragraphes, vendeur, desabo),
        ...(desabo ? { list: { unsubscribe: desabo } } : {}),
        attachments: [{ filename: `${avoir ? "Avoir" : "Facture"} ${num} - Château de Ravignan.pdf`, content: contenu, contentType: "application/pdf" }],
      });
      await enregistrer({ date: new Date().toISOString(), a: email, canal: "email" });
      return reponse({ ok: true, a: email, canal: "email", envois: envois.length + 1 });
    }

    if (!tel) return reponse({ erreur: "Ni email ni portable pour ce client" }, 422);
    // PDF rangé sous un nom aléatoire (le même à chaque renvoi), lien court /f/?k=…
    const code = /^[A-Za-z0-9]{16,40}$/.test(String(t.data.facture_code || "")) ? t.data.facture_code : codeAleatoire();
    const { error: eUp } = await db.storage.from("factures").upload(code + ".pdf", contenu, { contentType: "application/pdf", upsert: true });
    if (eUp) { console.error(eUp); return reponse({ erreur: "Le PDF n'a pas pu être enregistré" }, 500); }
    const lien = `${SITE}/f/?k=${code}`;
    // texte sans accents rares, pour tenir en SMS standard
    const message = `Chateau de Ravignan : votre ${avoir ? "avoir" : "facture"} ${num} (${total.replace("€", "EUR")}) : ${lien} - Merci ! Un avis Google nous ferait plaisir : ${SITE}/avis/`;
    try {
      await smsOvh(tel, message);
    } catch (e) {
      await enregistrer({}, { facture_code: code });
      return reponse({ ok: false, erreur: (e as Error).message, lien, tel, canal: "sms" });
    }
    await enregistrer({ date: new Date().toISOString(), a: tel, canal: "sms" }, { facture_code: code });
    return reponse({ ok: true, a: tel, canal: "sms", lien, envois: envois.length + 1 });
  } catch (e) {
    console.error(e);
    // Gmail refuse la connexion (erreur 535) : le mot de passe d'application de contact@ est à renouveler
    const m = String((e as Error)?.message || "");
    if (/535|Invalid login|Username and Password not accepted/i.test(m))
      return reponse({ erreur: "Gmail refuse la connexion de contact@ : le mot de passe d'application est à renouveler (Supabase, secret GMAIL_APP_PASSWORD)." }, 502);
    return reponse({ erreur: "L'envoi a échoué" + (m ? " : " + m.slice(0, 120) : "") }, 500);
  }
});

// Envoie la facture PDF d'une transaction au client :
// - par email depuis la boîte contact@armagnac-ravignan.com (Gmail), PDF joint, si le client a un email ;
// - sinon par SMS (OVH) avec un lien court de téléchargement, si le client a un portable.
//   Le PDF est rangé dans le bucket « factures » sous un nom aléatoire impossible à deviner.
//   Si OVH n'est pas configuré, la fonction renvoie le lien : l'app ouvre alors Messages sur le téléphone du vendeur.
// Secrets (Edge Functions → Secrets) : GMAIL_USER, GMAIL_APP_PASSWORD ;
//   pour le SMS : OVH_APP_KEY, OVH_APP_SECRET, OVH_CONSUMER_KEY, OVH_SMS_SERVICE (ex. sms-ab12345-1), OVH_SMS_SENDER (facultatif).
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
const AVIS_TXT = "Si vous avez passé un bon moment, laissez-nous une note et un petit commentaire sur Google : cela nous aide beaucoup !";
const LOGO = "https://app.armagnac-ravignan.com/images/blason.jpg";
// signature : prénom du vendeur, puis le domaine et ses coordonnées
const signature = (vendeur: string) =>
  [String(vendeur || "").trim().split(/\s+/)[0], "Domaine de Ravignan", "40190 Perquie · 05 58 45 33 07", "contact@armagnac-ravignan.com"]
    .filter(Boolean).join("\n");
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const html = (paragraphes: string[], vendeur: string) =>
  `<div style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#2b1a17;max-width:560px">`
  + paragraphes.map((p) => `<p>${esc(p)}</p>`).join("")
  + `<p><a href="${AVIS}" style="display:inline-block;background:#5a2f28;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-family:Arial,sans-serif;font-weight:bold">⭐ Laisser un avis sur Google</a></p>`
  + `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid #e8dcd6"><tr>`
  + `<td style="padding:14px 14px 0 0;vertical-align:top"><img src="${LOGO}" alt="Domaine de Ravignan" width="64" height="64" style="display:block;border:0"></td>`
  + `<td style="padding-top:14px;vertical-align:top;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#7a625d">`
  + signature(vendeur).split("\n").map((l, i) => i === 0 && vendeur.trim() ? `<b style="color:#5a2f28;font-size:14px">${esc(l)}</b>` : esc(l)).join("<br>")
  + `</td></tr></table></div>`;
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
async function smsOvh(numero: string, message: string) {
  const ak = Deno.env.get("OVH_APP_KEY"), as = Deno.env.get("OVH_APP_SECRET"), ck = Deno.env.get("OVH_CONSUMER_KEY"), service = Deno.env.get("OVH_SMS_SERVICE");
  if (!ak || !as || !ck || !service) throw new Error("SMS OVH pas encore configuré");
  const sender = Deno.env.get("OVH_SMS_SENDER");
  const url = `https://eu.api.ovh.com/1.0/sms/${service}/jobs`;
  const corps = JSON.stringify({
    message, receivers: [numero], charset: "UTF-8", coding: "7bit", priority: "high", noStopClause: true,
    ...(sender ? { sender, senderForResponse: false } : { senderForResponse: true }),
  });
  const ts = String(await fetch("https://eu.api.ovh.com/1.0/auth/time").then((r) => r.text()).then((s) => parseInt(s)).catch(() => Math.round(Date.now() / 1000)));
  const sig = "$1$" + await sha1([as, ck, "POST", url, corps, ts].join("+"));
  const r = await fetch(url, {
    method: "POST", body: corps,
    headers: { "Content-Type": "application/json", "X-Ovh-Application": ak, "X-Ovh-Consumer": ck, "X-Ovh-Timestamp": ts, "X-Ovh-Signature": sig },
  });
  const res = await r.json().catch(() => ({}));
  if (!r.ok || (Array.isArray(res.invalidReceivers) && res.invalidReceivers.length)) {
    console.error("OVH", r.status, res);
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
    const envois = Array.isArray(t.data.facture_envois) ? t.data.facture_envois : [];
    if (envois.length >= MAX_ENVOIS) return reponse({ erreur: "Facture déjà envoyée " + MAX_ENVOIS + " fois" }, 429);
    const { data: c } = await db.from("docs").select("data").eq("collection", "clients").eq("id", tx).maybeSingle();
    const email = String(c?.data?.email || "").trim();
    const tel = portable(String(c?.data?.tel || ""));
    const prenom = String(c?.data?.prenom || "").trim();
    const total = Number(t.data.total || 0).toFixed(2).replace(".", ",") + " €";
    const avoir = t.data.type === "avoir";
    const vendeur = String(t.data.vendeurPrenom || "");
    const enregistrer = async (envoi: Record<string, string>, extra: Record<string, unknown> = {}) =>
      await db.from("docs").update({ data: { ...t.data, ...extra, ...(envoi.a ? { facture_envois: [...envois, envoi] } : {}) }, updated_at: new Date().toISOString() })
        .eq("collection", "transactions").eq("id", tx);

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const user = Deno.env.get("GMAIL_USER")!;
      const transport = nodemailer.createTransport({
        host: "smtp.gmail.com", port: 465, secure: true,
        auth: { user, pass: Deno.env.get("GMAIL_APP_PASSWORD")! },
      });
      const intro = avoir
        ? `Vous trouverez ci-joint l'avoir ${num} (${total}), qui annule ${t.data.partiel ? "en partie " : ""}la facture ${t.data.factureOrigine || ""}.`
        : `Vous trouverez ci-joint votre facture ${num} (${total}) pour vos achats au Château de Ravignan.\n\nMerci et à bientôt !`;
      await transport.sendMail({
        from: `"Château de Ravignan" <${user}>`,
        to: email,
        subject: `Votre ${avoir ? "avoir" : "facture"} ${num} – Château de Ravignan`,
        text: `Bonjour ${prenom},\n\n${intro}\n\n${AVIS_TXT}\n⭐ ${AVIS}\n\n${signature(vendeur)}`,
        html: html([`Bonjour ${prenom},`, ...intro.split("\n\n"), AVIS_TXT], vendeur),
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
    return reponse({ erreur: "L'envoi a échoué" }, 500);
  }
});

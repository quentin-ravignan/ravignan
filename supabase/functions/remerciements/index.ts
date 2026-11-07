// Email de remerciement à tous les clients d'une vente, depuis contact@armagnac-ravignan.com (Gmail),
// avec l'invitation à laisser un avis Google. Une seule fois par vente (marque « remerciements » sur la vente).
// - Tous les matins (pg_cron, corps vide) : les ventes terminées depuis 7 à 13 jours, pas encore remerciées.
// - Bouton « Envoyer maintenant » de l'app ({ vente }) : réservé aux administrateurs connectés.
// Secrets : GMAIL_USER, GMAIL_APP_PASSWORD (les mêmes que « envoyer-facture »).
import nodemailer from "npm:nodemailer@6.9.14";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const AVIS = "https://maps.google.com/?cid=9627672053882881379"; // fiche Google Maps du Château de Ravignan
const AVIS_TXT = "Si vous avez passé un bon moment, laissez-nous une note et un petit commentaire sur Google : cela nous aide beaucoup !";
const LOGO = "https://app.armagnac-ravignan.com/images/blason.jpg";
// signature : prénom du vendeur, puis le domaine et ses coordonnées
const signature = (vendeur: string) =>
  [String(vendeur || "").trim().split(/\s+/)[0], "Domaine de Ravignan", "40190 Perquie · 05 58 45 33 07", "contact@armagnac-ravignan.com"]
    .filter(Boolean).join("\n");
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
// mentions de bas d'email : données utilisées en interne (RGPD), désabonnement, modération (loi Évin)
const MENTION_DONNEES = "Vos coordonnées sont utilisées uniquement en interne par le Domaine de Ravignan (vos achats, vos factures et nos nouvelles). Elles ne sont jamais vendues ni transmises à des tiers. Vous pouvez y accéder, les corriger ou les faire supprimer en écrivant à contact@armagnac-ravignan.com.";
const MODERATION = "L'abus d'alcool est dangereux pour la santé, à consommer avec modération.";
const piedTexte = (desabo: string) =>
  `${MENTION_DONNEES}\n${desabo ? `Ne plus recevoir nos emails d'information : ${desabo}\n` : ""}${MODERATION}`;
// lien de désabonnement personnel (jeton aléatoire, sans l'adresse dans le lien)
async function lienDesabo(db: any, email: string) {
  const { data } = await db.rpc("jeton_desabonnement", { adresse: email });
  return data ? `https://app.armagnac-ravignan.com/desabonnement/?j=${data}` : "";
}
const html = (paragraphes: string[], vendeur: string, desabo = "") =>
  `<div style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#2b1a17;max-width:560px">`
  + paragraphes.map((p) => `<p>${esc(p)}</p>`).join("")
  + `<p><a href="${AVIS}" style="display:inline-block;background:#5a2f28;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-family:Arial,sans-serif;font-weight:bold">⭐ Laisser un avis sur Google</a></p>`
  + `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid #e8dcd6"><tr>`
  + `<td style="padding:14px 14px 0 0;vertical-align:top"><img src="${LOGO}" alt="Domaine de Ravignan" width="64" height="64" style="display:block;border:0"></td>`
  + `<td style="padding-top:14px;vertical-align:top;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#7a625d">`
  + signature(vendeur).split("\n").map((l, i) => i === 0 && vendeur.trim() ? `<b style="color:#5a2f28;font-size:14px">${esc(l)}</b>` : esc(l)).join("<br>")
  + `</td></tr></table>`
  + `<p style="margin-top:18px;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;color:#9b8580">${esc(MENTION_DONNEES)}`
  + (desabo ? `<br><a href="${desabo}" style="color:#9b8580">Se désabonner de nos emails d'information</a>` : "")
  + `<br>${esc(MODERATION)}</p></div>`;

type Doc = { id: string; data: Record<string, any> };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reponse({ erreur: "Méthode non autorisée" }, 405);
  try {
    const corps = await req.json().catch(() => ({}));
    const url = Deno.env.get("SUPABASE_URL")!;
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let ventes: Doc[] = [];

    if (typeof corps.vente === "string") {
      // envoi à la main : administrateur connecté
      const auth = req.headers.get("Authorization") || "";
      const moi = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
      const { data: admin } = await moi.rpc("est_admin");
      if (admin !== true) return reponse({ erreur: "Réservé aux administrateurs connectés." }, 403);
      const { data: v } = await db.from("docs").select("id,data").eq("collection", "ventes").eq("id", corps.vente).maybeSingle();
      if (!v) return reponse({ erreur: "Vente inconnue" }, 404);
      if (v.data.remerciements) return reponse({ erreur: "Les remerciements de cette vente sont déjà partis." }, 409);
      ventes = [v as Doc];
    } else {
      // tous les matins : ventes terminées depuis 7 à 13 jours
      const { data } = await db.from("docs").select("id,data").eq("collection", "ventes");
      const maintenant = Date.now();
      ventes = ((data || []) as Doc[]).filter((v) => {
        if (v.data.remerciements) return false;
        const fin = Date.parse(String(v.data.dateFin || v.data.dateDebut || "") + "T00:00:00Z");
        const jours = (maintenant - fin) / JOUR;
        return jours >= 7 && jours < 14;
      });
    }
    if (!ventes.length) return reponse({ ok: true, ventes: [] });

    const user = Deno.env.get("GMAIL_USER")!;
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user, pass: Deno.env.get("GMAIL_APP_PASSWORD")! },
    });
    const resultats = [];
    for (const v of ventes) {
      // marque posée avant l'envoi : une vente n'est jamais remerciée deux fois
      const debut = new Date().toISOString();
      await db.rpc("marquer_remerciements", { vente: v.id, info: { date: debut, n: 0, etat: "envoi" } });

      // clients des transactions encaissées (ni avoir, ni annulée, ni paiement carte en attente)
      const { data: txs } = await db.from("docs").select("id,data").eq("collection", "transactions").eq("data->>venteId", v.id);
      const ids = ((txs || []) as Doc[])
        .filter((t) => t.data.type !== "avoir" && !t.data.annuleePar && t.data.statut !== "attente")
        .map((t) => t.id);
      const destinataires = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data: cls } = await db.from("docs").select("id,data").eq("collection", "clients").in("id", ids.slice(i, i + 100));
        for (const c of (cls || []) as Doc[]) {
          const email = String(c.data.email || "").trim().toLowerCase();
          if (EMAIL.test(email) && !destinataires.has(email)) destinataires.set(email, String(c.data.prenom || "").trim());
        }
      }
      // les clients désabonnés ne reçoivent pas les remerciements
      if (destinataires.size) {
        const { data: des } = await db.from("desabonnes").select("email").in("email", [...destinataires.keys()]);
        for (const d of des || []) destinataires.delete(d.email);
      }

      const nom = String(v.data.nom || "notre vente");
      const lieu = v.data.lieu ? ` à ${v.data.lieu}` : "";
      const vendeur = String(v.data.vendeurPrincipal || (v.data.vendeurs || [])[0] || "");
      let n = 0, echecs = 0;
      for (const [email, prenom] of destinataires) {
        const desabo = await lienDesabo(db, email);
        const paragraphes = [
          `Bonjour${prenom ? " " + prenom : ""},`,
          `Merci de votre visite à notre vente « ${nom} »${lieu} ! C'était super : un vrai plaisir de vous y retrouver et de partager nos armagnacs avec vous.`,
          "Nous espérons que vos bouteilles vous régalent déjà. À très bientôt au Château de Ravignan !",
          AVIS_TXT,
        ];
        try {
          await transport.sendMail({
            from: `"Château de Ravignan" <${user}>`,
            to: email,
            subject: `Merci pour « ${nom} » – Château de Ravignan`,
            text: `${paragraphes.join("\n\n")}\n⭐ ${AVIS}\n\n${signature(vendeur)}\n\n${piedTexte(desabo)}`,
            html: html(paragraphes, vendeur, desabo),
            list: { unsubscribe: desabo },
          });
          n++;
        } catch (e) {
          console.error(email, e);
          echecs++;
        }
      }
      await db.rpc("marquer_remerciements", { vente: v.id, info: { date: new Date().toISOString(), n, echecs } });
      resultats.push({ vente: v.id, n, echecs });
    }
    return reponse({ ok: true, ventes: resultats });
  } catch (e) {
    console.error(e);
    return reponse({ erreur: "L'envoi a échoué" }, 500);
  }
});

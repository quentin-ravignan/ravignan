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

// conseil de dégustation : l'accord de la note du millésime (contenu/degustation.json), sinon un conseil général
let notesDegu: Record<string, any> = {};
const conseil = (produit: string) => {
  const an = (produit.match(/\b(19|20)\d{2}\b/) || [])[0];
  const n = an ? notesDegu[an] : null;
  const a = String(n?.accord || "").trim();
  return a ? a.charAt(0).toLowerCase() + a.slice(1) : "servez-le à température ambiante dans un verre tulipe, et laissez-le respirer quelques minutes avant de le déguster.";
};
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
    notesDegu = await fetch("https://app.armagnac-ravignan.com/contenu/degustation.json").then((r) => r.json()).then((d) => d.notes || {}).catch(() => ({}));
    const resultats = [];
    for (const v of ventes) {
      // marque posée avant l'envoi : une vente n'est jamais remerciée deux fois
      const debut = new Date().toISOString();
      await db.rpc("marquer_remerciements", { vente: v.id, info: { date: debut, n: 0, etat: "envoi" } });

      // clients des transactions encaissées (ni avoir, ni annulée, ni paiement carte en attente)
      const { data: txs } = await db.from("docs").select("id,data").eq("collection", "transactions").eq("data->>venteId", v.id);
      const valides = ((txs || []) as Doc[]).filter((t) => t.data.type !== "avoir" && !t.data.annuleePar && t.data.statut !== "attente");
      const lignesDe = new Map(valides.map((t) => [t.id, (t.data.lignes || []) as any[]]));
      const ids = valides.map((t) => t.id);
      // par adresse : prénom et bouteilles achetées. Exclus : opposition ; vente encaissée par une association sans consentement.
      const association = !!v.data.association;
      const destinataires = new Map<string, { prenom: string; achats: Map<string, number> }>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data: cls } = await db.from("docs").select("id,data").eq("collection", "clients").in("id", ids.slice(i, i + 100));
        for (const c of (cls || []) as Doc[]) {
          const email = String(c.data.email || "").trim().toLowerCase();
          if (!EMAIL.test(email) || c.data.opposition || (association && c.data.consentement !== true)) continue;
          const d = destinataires.get(email) || { prenom: String(c.data.prenom || "").trim(), achats: new Map<string, number>() };
          for (const l of lignesDe.get(c.id) || []) d.achats.set(String(l.nom || ""), (d.achats.get(String(l.nom || "")) || 0) + Number(l.qte || 0));
          destinataires.set(email, d);
        }
      }
      // les clients désabonnés ne reçoivent pas les remerciements
      if (destinataires.size) {
        const { data: des } = await db.from("desabonnes").select("email").in("email", [...destinataires.keys()]);
        for (const d of des || []) destinataires.delete(d.email);
      }

      // jamais le nom interne de la vente : « notre vente à Toulouse »
      const lieu = String(v.data.lieu || "").trim();
      const nom = lieu ? `notre vente à ${lieu}` : "notre vente";
      const vendeur = String(v.data.vendeurPrincipal || (v.data.vendeurs || [])[0] || "");
      let n = 0, echecs = 0;
      for (const [email, { prenom, achats }] of destinataires) {
        const desabo = await lienDesabo(db, email);
        // mail 2 (texte validé par Benoît) : le produit le plus acheté et un conseil de dégustation
        const produit = [...achats].filter(([p]) => p).sort((a, b) => b[1] - a[1])[0]?.[0] || "armagnac";
        const paragraphes = [
          `Madame, Monsieur,`,
          `Merci encore pour votre passage sur notre stand lors de ${nom}. Ces ventes sont pour notre famille l'occasion de partager l'histoire du domaine et le travail de nos chais.`,
          `Nous espérons que votre ${produit} tient ses promesses. Notre conseil : ${conseil(produit)}`,
          `Si ce n'est pas déjà fait, un avis sur Google nous aiderait beaucoup à faire connaître le domaine : ${AVIS}`,
          `Nos prochaines ventes et la boutique en ligne : armagnac-ravignan.com`,
        ];
        try {
          await transport.sendMail({
            from: `"Domaine de Ravignan" <${user}>`,
            to: email,
            subject: `Merci pour votre visite lors de ${nom}`,
            text: `${paragraphes.join("\n\n")}\n\n${signature(vendeur)}\n\n${piedTexte(desabo)}`,
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
    // Gmail refuse la connexion (erreur 535) : le mot de passe d'application de contact@ est à renouveler
    const m = String((e as Error)?.message || "");
    if (/535|Invalid login|Username and Password not accepted/i.test(m))
      return reponse({ erreur: "Gmail refuse la connexion de contact@ : le mot de passe d'application est à renouveler (Supabase, secret GMAIL_APP_PASSWORD)." }, 502);
    return reponse({ erreur: "L'envoi a échoué" + (m ? " : " + m.slice(0, 120) : "") }, 500);
  }
});

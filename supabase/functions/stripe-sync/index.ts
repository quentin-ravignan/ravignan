// Ventes du site armagnac-ravignan.com (boutique Squarespace, payée par Stripe) → vente permanente « site-web » de l'app.
// - Chaque paiement Stripe d'une commande du site devient une transaction de la vente « Site web armagnac-ravignan.com »
//   (vendeur : Domaine de Ravignan, c'est-à-dire contact@armagnac-ravignan.com), avec sa fiche client (email, nom, adresse de livraison).
// - Pas de facture de l'app : Squarespace s'en charge (transactions marquées source « site »).
// - Toutes les heures (pg_cron) et au bouton « Synchroniser » ; 1re fois : tout l'historique.
// Secret : STRIPE_API_KEY = clé restreinte Stripe en LECTURE seule (Charges et PaymentIntents).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const VENTE = "site-web", VENDEUR = "Domaine de Ravignan";
const reponse = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// paiement Stripe (charge, avec son PaymentIntent) → transaction + fiche client de l'app
function versDocs(ch: any) {
  const pi = typeof ch.payment_intent === "object" && ch.payment_intent ? ch.payment_intent : {};
  const md = { ...(pi.metadata || {}), ...(ch.metadata || {}) };
  const commande = String(md.orderId || "");
  const id = "web-" + (commande || ch.id);
  const total = Math.round(Number(ch.amount || 0)) / 100, rembourse = Math.round(Number(ch.amount_refunded || 0)) / 100;
  const email = String(ch.billing_details?.email || ch.receipt_email || pi.receipt_email || (String(ch.description || "").match(/[^\s]+@[^\s]+/) || [""])[0]).toLowerCase();
  const destinataire = String(md.shipping_recipient || ch.billing_details?.name || ch.shipping?.name || "").trim();
  const [prenom, ...reste] = destinataire.split(/\s+/);
  const adr = ch.shipping?.address || ch.billing_details?.address || {};
  const date = new Date(Number(ch.created) * 1000).toISOString();
  const transaction = {
    venteId: VENTE, source: "site", date, total: Math.round((total - rembourse) * 100) / 100, paiement: "CB",
    vendeurPrenom: VENDEUR, statut: rembourse >= total ? "annulee" : "payee", lignes: [],
    commande, stripe: { charge: ch.id, montant: total, rembourse },
  };
  const client = {
    prenom: prenom || "", nom: reste.join(" "), email,
    adresse: [md.shipping_address1 || adr.line1, md.shipping_address2 || adr.line2].filter(Boolean).join(", "),
    cp: String(md.shipping_zip || adr.postal_code || ""), ville: String(md.shipping_city || adr.city || ""), pays: String(md.shipping_country || adr.country || ""),
    tel: String(ch.billing_details?.phone || ""), source: "Site web",
  };
  return { id, transaction, client, commande };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reponse({ erreur: "Méthode non autorisée" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const marque = async (d: Record<string, unknown>) => {
    const { data: m } = await db.from("docs").select("data").eq("collection", "reglages").eq("id", "stripe_sync").maybeSingle();
    await db.from("docs").upsert({ collection: "reglages", id: "stripe_sync", data: { ...(m?.data || {}), ...d } });
  };
  try {
    const cle = Deno.env.get("STRIPE_API_KEY");
    if (!cle) return reponse({ erreur: "Clé Stripe pas encore configurée (secret STRIPE_API_KEY)." }, 503);
    const { data: m } = await db.from("docs").select("data").eq("collection", "reglages").eq("id", "stripe_sync").maybeSingle();
    const etat = m?.data || {};
    const debut = new Date();
    if (etat.encours && debut.getTime() - Date.parse(etat.encours) < 60_000) return reponse({ ok: true, n: 0, deja: true });
    await marque({ encours: debut.toISOString(), erreur: null });

    // la vente permanente existe toujours
    const { data: v } = await db.from("docs").select("id").eq("collection", "ventes").eq("id", VENTE).maybeSingle();
    if (!v) await db.from("docs").insert({ collection: "ventes", id: VENTE, data: {
      nom: "Site web armagnac-ravignan.com", lieu: "En ligne", permanente: true, dateDebut: "", dateFin: "",
      vendeurPrincipal: VENDEUR, vendeurs: [VENDEUR], refs: [], cloturee: false, createdAt: debut.toISOString() } });

    // incrémental : paiements créés depuis la dernière synchro (marge d'un jour, pour les remboursements récents)
    const depuis = etat.dernier ? Math.floor(Date.parse(etat.dernier) / 1000) - 86_400 : 0;
    let apres = "", n = 0, pages = 0, premiere = "";
    while (pages < 100) {
      const p = new URLSearchParams({ limit: "100" });
      p.append("expand[]", "data.payment_intent");
      if (depuis) p.set("created[gte]", String(depuis));
      if (apres) p.set("starting_after", apres);
      const r = await fetch("https://api.stripe.com/v1/charges?" + p, { headers: { Authorization: `Bearer ${cle}` } });
      if (r.status === 401 || r.status === 403) throw new Error("Clé Stripe refusée : il faut une clé restreinte avec la lecture des Charges et des PaymentIntents.");
      if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 2000)); continue; }
      if (!r.ok) throw new Error("Stripe a répondu " + r.status);
      const page = await r.json();
      const lignes: any[] = [];
      for (const ch of page.data || []) {
        if (!ch.paid || ch.status !== "succeeded" || !ch.livemode) continue;
        const md = { ...(ch.payment_intent?.metadata || {}), ...(ch.metadata || {}) };
        if (!md.orderId && !md.websiteId) continue; // seulement les commandes du site Squarespace
        const d = versDocs(ch);
        const maj = new Date().toISOString();
        lignes.push({ collection: "transactions", id: d.id, data: d.transaction, updated_at: maj });
        lignes.push({ collection: "clients", id: d.id, data: d.client, updated_at: maj });
        if (!premiere || d.transaction.date < premiere) premiere = d.transaction.date;
        n++;
      }
      // commandes déjà connues (import de l'export Squarespace, avec le détail des produits) : on n'y touche pas
      if (lignes.length) { const { error } = await db.from("docs").upsert(lignes, { onConflict: "collection,id", ignoreDuplicates: true }); if (error) throw error; }
      pages++;
      if (!page.has_more || !page.data?.length) break;
      apres = page.data[page.data.length - 1].id;
    }
    // date de début de la vente permanente = première commande connue
    if (premiere) {
      const { data: vv } = await db.from("docs").select("data").eq("collection", "ventes").eq("id", VENTE).maybeSingle();
      const dd = String(vv?.data?.dateDebut || "");
      if (vv && (!dd || premiere.slice(0, 10) < dd)) await db.from("docs").update({ data: { ...vv.data, dateDebut: premiere.slice(0, 10) } }).eq("collection", "ventes").eq("id", VENTE);
    }
    await marque({ dernier: debut.toISOString(), n, encours: null, erreur: null });
    return reponse({ ok: true, n });
  } catch (e) {
    console.error(e);
    const msg = (e as Error).message || "La synchronisation a échoué";
    await marque({ encours: null, erreur: msg });
    return reponse({ erreur: msg }, 500);
  }
});

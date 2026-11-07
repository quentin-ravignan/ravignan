// Récupère les commandes de la boutique Squarespace (API Commerce Orders) et les range dans la collection « squarespace »
// (lisible par les administrateurs seulement, comme le fichier clients).
// - Toutes les heures (pg_cron) et au bouton « Synchroniser » de l'app.
// - 1re fois : tout l'historique ; ensuite : les commandes modifiées depuis la dernière synchro (marque reglages/squarespace_sync).
// Secret : SQUARESPACE_API_KEY (Squarespace → Paramètres → Avancé → Clés d'API pour développeurs, droit « Commandes » en lecture).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const API = "https://api.squarespace.com/1.0/commerce/orders";
const reponse = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const euros = (m: any) => Math.round(Number(m?.value || 0) * 100) / 100;

// commande Squarespace → document de l'app
function versDoc(o: any) {
  const b = o.billingAddress || {};
  return {
    numero: String(o.orderNumber || ""),
    date: o.createdOn,
    modifie: o.modifiedOn,
    statut: o.fulfillmentStatus, // PENDING, FULFILLED, CANCELED
    paiement: o.paymentState || null,
    total: euros(o.grandTotal),
    rembourse: euros(o.refundedTotal),
    devise: o.grandTotal?.currency || "EUR",
    client: {
      prenom: b.firstName || "", nom: b.lastName || "", email: String(o.customerEmail || "").toLowerCase(),
      tel: b.phone || "", cp: b.postalCode || "", ville: b.city || "", pays: b.countryCode || "",
    },
    lignes: (o.lineItems || []).map((l: any) => ({
      nom: l.productName || "Produit",
      variante: (l.variantOptions || []).map((v: any) => v.value).filter(Boolean).join(" · "),
      sku: l.sku || "",
      qte: Number(l.quantity || 0),
      prix: euros(l.unitPricePaid),
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reponse({ erreur: "Méthode non autorisée" }, 405);
  try {
    const cle = Deno.env.get("SQUARESPACE_API_KEY");
    if (!cle) return reponse({ erreur: "Clé API Squarespace pas encore configurée (secret SQUARESPACE_API_KEY)." }, 503);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: m } = await db.from("docs").select("data").eq("collection", "reglages").eq("id", "squarespace_sync").maybeSingle();
    const etat = m?.data || {};
    const debut = new Date();
    // au plus une synchro par minute (appel par l'app ou par la tâche planifiée)
    if (etat.encours && debut.getTime() - Date.parse(etat.encours) < 60_000) return reponse({ ok: true, n: 0, deja: true });
    await db.from("docs").upsert({ collection: "reglages", id: "squarespace_sync", data: { ...etat, encours: debut.toISOString() } });

    const entetes = { Authorization: `Bearer ${cle}`, "User-Agent": "Ravignan-ventes/1.0" };
    // incrémental : marge d'une heure sur la dernière synchro réussie
    let url = API;
    if (etat.dernier) {
      const apres = new Date(Date.parse(etat.dernier) - 3_600_000).toISOString();
      url += `?modifiedAfter=${encodeURIComponent(apres)}&modifiedBefore=${encodeURIComponent(debut.toISOString())}`;
    }
    let n = 0, pages = 0;
    while (url && pages < 200) {
      const r = await fetch(url, { headers: entetes });
      if (r.status === 401 || r.status === 403) throw new Error("Clé API Squarespace refusée (vérifiez qu'elle a le droit Commandes).");
      if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
      if (!r.ok) throw new Error("Squarespace a répondu " + r.status);
      const page = await r.json();
      const lignes = (page.result || []).filter((o: any) => !o.testmode)
        .map((o: any) => ({ collection: "squarespace", id: String(o.id), data: versDoc(o), updated_at: new Date().toISOString() }));
      if (lignes.length) {
        const { error } = await db.from("docs").upsert(lignes);
        if (error) throw error;
        n += lignes.length;
      }
      pages++;
      url = page.pagination?.hasNextPage && page.pagination?.nextPageCursor
        ? `${API}?cursor=${encodeURIComponent(page.pagination.nextPageCursor)}` : "";
    }
    await db.from("docs").upsert({ collection: "reglages", id: "squarespace_sync", data: { dernier: debut.toISOString(), n } });
    return reponse({ ok: true, n });
  } catch (e) {
    console.error(e);
    const msg = (e as Error).message || "La synchronisation a échoué";
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: m } = await db.from("docs").select("data").eq("collection", "reglages").eq("id", "squarespace_sync").maybeSingle();
    await db.from("docs").upsert({ collection: "reglages", id: "squarespace_sync", data: { ...(m?.data || {}), encours: null, erreur: msg } });
    return reponse({ erreur: msg }, 500);
  }
});

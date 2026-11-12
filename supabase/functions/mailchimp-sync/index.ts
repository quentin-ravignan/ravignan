// Contacts de l'audience Mailchimp → fichier clients de l'app (collection « crm »), sans doublon : même email, même fiche.
// - Toutes les heures (pg_cron) et au bouton « Synchroniser » ; 1re fois : toute l'audience, ensuite les contacts modifiés.
// - Abonné : case Newsletter cochée ; désabonné : tag « Désabonné » et Newsletter décochée ; adresse invalide : tag « Email invalide ».
// Secrets : MAILCHIMP_API_KEY (Mailchimp → Profil → Extras → Clés API, de la forme xxxxxxxx-us21) ;
//           MAILCHIMP_LIST_ID facultatif (sinon la première audience du compte).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reponse = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });
// même clé et même identifiant de fiche que l'app (cleClient / idCrm dans index.html)
const normEmail = (e: unknown) => String(e || "").trim().toLowerCase();
const idCrm = (cle: string) => "c" + [...cle].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7).toString(36) + cle.replace(/[^a-z0-9]/g, "").slice(0, 24);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reponse({ erreur: "Méthode non autorisée" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const marque = async (d: Record<string, unknown>) => {
    const { data: m } = await db.from("docs").select("data").eq("collection", "reglages").eq("id", "mailchimp_sync").maybeSingle();
    await db.from("docs").upsert({ collection: "reglages", id: "mailchimp_sync", data: { ...(m?.data || {}), ...d } });
  };
  try {
    const cle = Deno.env.get("MAILCHIMP_API_KEY") || "";
    const dc = cle.split("-")[1];
    if (!cle || !dc) return reponse({ erreur: "Clé Mailchimp pas encore configurée (secret MAILCHIMP_API_KEY, de la forme …-us21)." }, 503);
    const api = `https://${dc}.api.mailchimp.com/3.0`;
    const entetes = { Authorization: "Basic " + btoa("ravignan:" + cle) };
    const appel = async (chemin: string) => {
      const r = await fetch(api + chemin, { headers: entetes });
      if (r.status === 401 || r.status === 403) throw new Error("Clé Mailchimp refusée.");
      if (!r.ok) throw new Error("Mailchimp a répondu " + r.status);
      return r.json();
    };
    const { data: m } = await db.from("docs").select("data").eq("collection", "reglages").eq("id", "mailchimp_sync").maybeSingle();
    const etat = m?.data || {};
    const debut = new Date();
    if (etat.encours && debut.getTime() - Date.parse(etat.encours) < 60_000) return reponse({ ok: true, n: 0, deja: true });
    await marque({ encours: debut.toISOString(), erreur: null });

    let liste = Deno.env.get("MAILCHIMP_LIST_ID") || "";
    if (!liste) { const l = await appel("/lists?count=1&fields=lists.id,lists.name"); liste = l.lists?.[0]?.id || ""; }
    if (!liste) throw new Error("Aucune audience sur le compte Mailchimp.");

    // fiches existantes, par email
    const parEmail = new Map<string, { id: string; data: any }>();
    for (let de = 0; ; de += 1000) {
      const { data, error } = await db.from("docs").select("id,data").eq("collection", "crm").range(de, de + 999);
      if (error) throw error;
      for (const r of data || []) { const e = normEmail(r.data?.email); if (e) parEmail.set(e, r); }
      if (!data || data.length < 1000) break;
    }

    // contacts modifiés depuis la dernière synchro (marge d'une heure) ; la 1re fois, toute l'audience
    const depuis = etat.dernier ? "&since_last_changed=" + encodeURIComponent(new Date(Date.parse(etat.dernier) - 3_600_000).toISOString()) : "";
    const champs = "members.email_address,members.status,members.merge_fields,members.tags,members.last_changed";
    let n = 0, nouveaux = 0;
    for (let offset = 0; offset < 50_000; offset += 1000) {
      const page = await appel(`/lists/${liste}/members?count=1000&offset=${offset}&fields=${champs},total_items${depuis}`);
      const lot: any[] = [];
      for (const mb of page.members || []) {
        const email = normEmail(mb.email_address);
        if (!email) continue;
        const mf = mb.merge_fields || {};
        const ex = parEmail.get(email);
        const d = ex ? { ...ex.data } : { prenom: "", nom: "", email, tel: "", adresse: "", cp: "", ville: "", pays: "", tags: [], notes: "", sources: [], achats: [], newsletter: false };
        const adr = typeof mf.ADDRESS === "object" && mf.ADDRESS ? mf.ADDRESS : {};
        const complete: Record<string, string> = { prenom: mf.FNAME, nom: mf.LNAME, tel: mf.PHONE, adresse: [adr.addr1, adr.addr2].filter(Boolean).join(", "), cp: adr.zip, ville: adr.city, pays: adr.country };
        for (const [k, val] of Object.entries(complete)) if (!d[k] && val) d[k] = String(val);
        d.sources = [...new Set([...(d.sources || []), "Mailchimp"])];
        const statut = mb.status === "unsubscribed" ? "Désabonné" : mb.status === "cleaned" ? "Email invalide" : "";
        d.newsletter = mb.status === "subscribed";
        const tags = new Set((d.tags || []).filter((t: string) => t !== "Désabonné" && t !== "Email invalide"));
        (mb.tags || []).forEach((t: any) => t?.name && tags.add(t.name));
        if (statut) tags.add(statut);
        d.tags = [...tags];
        d.maj = new Date().toISOString();
        const id = ex ? ex.id : idCrm("e:" + email);
        if (!ex) nouveaux++;
        parEmail.set(email, { id, data: d });
        lot.push({ collection: "crm", id, data: d, updated_at: d.maj });
        n++;
      }
      for (let i = 0; i < lot.length; i += 200) {
        const { error } = await db.from("docs").upsert(lot.slice(i, i + 200), { onConflict: "collection,id" });
        if (error) throw error;
      }
      if ((page.members || []).length < 1000) break;
    }
    await marque({ dernier: debut.toISOString(), n, nouveaux, encours: null, erreur: null });
    return reponse({ ok: true, n, nouveaux });
  } catch (e) {
    console.error(e);
    const msg = (e as Error).message || "La synchronisation a échoué";
    await marque({ encours: null, erreur: msg });
    return reponse({ erreur: msg }, 500);
  }
});

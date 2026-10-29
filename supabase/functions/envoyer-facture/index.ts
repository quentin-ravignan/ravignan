// Envoie la facture PDF d'une transaction au client, depuis la boîte contact@armagnac-ravignan.com (Gmail).
// Secrets à définir dans Supabase (Edge Functions → Secrets) : GMAIL_USER, GMAIL_APP_PASSWORD.
// L'adresse du destinataire est relue dans la base (collection « clients ») : l'appelant ne peut pas la choisir.
import nodemailer from "npm:nodemailer@6.9.14";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_ENVOIS = 5;
const reponse = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reponse({ erreur: "Méthode non autorisée" }, 405);
  try {
    const { tx, pdf } = await req.json();
    if (typeof tx !== "string" || typeof pdf !== "string") return reponse({ erreur: "Requête incomplète" }, 400);
    if (pdf.length > 2_800_000) return reponse({ erreur: "PDF trop lourd" }, 413);
    const contenu = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
    if (new TextDecoder().decode(contenu.slice(0, 5)) !== "%PDF-") return reponse({ erreur: "Ce n'est pas un PDF" }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: t } = await db.from("docs").select("data").eq("collection", "transactions").eq("id", tx).maybeSingle();
    if (!t) return reponse({ erreur: "Transaction inconnue" }, 404);
    const num = t.data.facture;
    if (!num) return reponse({ erreur: "La facture n'a pas encore de numéro" }, 409);
    const envois = Array.isArray(t.data.facture_envois) ? t.data.facture_envois : [];
    if (envois.length >= MAX_ENVOIS) return reponse({ erreur: "Facture déjà envoyée " + MAX_ENVOIS + " fois" }, 429);
    const { data: c } = await db.from("docs").select("data").eq("collection", "clients").eq("id", tx).maybeSingle();
    const email = String(c?.data?.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reponse({ erreur: "Pas d'email pour ce client" }, 422);
    const prenom = String(c?.data?.prenom || "").trim();

    const user = Deno.env.get("GMAIL_USER")!;
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user, pass: Deno.env.get("GMAIL_APP_PASSWORD")! },
    });
    const total = Number(t.data.total || 0).toFixed(2).replace(".", ",") + " €";
    const avoir = t.data.type === "avoir";
    const intro = avoir
      ? `Vous trouverez ci-joint l'avoir ${num} (${total}), qui annule la facture ${t.data.factureOrigine || ""}.`
      : `Vous trouverez ci-joint votre facture ${num} (${total}) pour vos achats au Château de Ravignan.\n\nMerci et à bientôt !`;
    await transport.sendMail({
      from: `"Château de Ravignan" <${user}>`,
      to: email,
      subject: `Votre ${avoir ? "avoir" : "facture"} ${num} – Château de Ravignan`,
      text: `Bonjour ${prenom},\n\n${intro}\n\nChâteau de Ravignan\n40190 Perquie\n05 58 45 33 07 · contact@armagnac-ravignan.com`,
      attachments: [{ filename: `${avoir ? "Avoir" : "Facture"} ${num} - Château de Ravignan.pdf`, content: contenu, contentType: "application/pdf" }],
    });

    const envoi = { date: new Date().toISOString(), a: email };
    await db.from("docs").update({ data: { ...t.data, facture_envois: [...envois, envoi] }, updated_at: envoi.date })
      .eq("collection", "transactions").eq("id", tx);
    return reponse({ ok: true, a: email, envois: envois.length + 1 });
  } catch (e) {
    console.error(e);
    return reponse({ erreur: "L'envoi a échoué" }, 500);
  }
});

// « I Armagnac » : l'assistant vocal de l'app. Répond aux personnes connectées en s'appuyant sur les données du site.
// Secret à définir dans Supabase (Edge Functions → Secrets) : ANTHROPIC_API_KEY.
// Ce que l'assistant voit dépend de la personne : ventes et notes pour les membres, fichier clients pour les
// administrateurs, généalogie et chambres pour Benoit et Quentin — comme dans l'app.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SITE = "https://app.armagnac-ravignan.com";
const reponse = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const PERSONNAGE = `Tu es « I Armagnac », l'assistant du Château de Ravignan (Bas-Armagnac, Perquie, Landes).
Tu parles à un membre de la famille ou à un vendeur, pendant une vente privée ou au domaine.
Tes réponses sont lues à voix haute : 1 à 4 phrases courtes, en français parlé, sans liste, sans titre, sans markdown, sans émoji.
Tu as le parler du Sud-Ouest landais : chaleureux et direct, avec de temps en temps une expression gasconne (« hè bé », « macarel », « adishatz » pour dire au revoir, « boudu ») — une au plus par réponse, jamais forcée.
Tu réponds uniquement à partir des données fournies ci-dessous. Si l'information n'y est pas, dis-le simplement. N'invente jamais un chiffre, un client ou une note de dégustation.
Les montants sont en euros TTC ; dis « euros » en toutes lettres. Les dates : dis le jour et le mois.
Ne lis jamais à voix haute une adresse email ou un numéro de téléphone, même si on te le demande.`;

type Doc = { id: string; data: Record<string, any> };
const eur = (n: number) => `${Math.round((Number(n) || 0) * 100) / 100} €`;
const jour = (d?: string) => (d ? String(d).slice(0, 10) : "?");

async function contenu(nom: string) {
  try { const r = await fetch(`${SITE}/contenu/${nom}.json`); return r.ok ? await r.json() : null; } catch { return null; }
}

function resumeVentes(ventes: Doc[], txs: Doc[]) {
  const lignes: string[] = [];
  for (const v of ventes.sort((a, b) => String(b.data.dateDebut || "").localeCompare(String(a.data.dateDebut || "")))) {
    const t = txs.filter((x) => x.data.venteId === v.id);
    const payees = t.filter((x) => x.data.statut !== "attente");
    const ca = payees.reduce((s, x) => s + (Number(x.data.total) || 0), 0);
    const parProduit = (v.data.refs || []).map((r: any) => {
      const vendu = t.reduce((s, x) => s + (x.data.lignes || []).filter((l: any) => l.refId === r.id).reduce((a: number, l: any) => a + (l.qte || 0), 0), 0);
      return `${r.nom} ${r.format || ""} : ${vendu} vendu(s)${r.stock ? `, stock ${r.stock}, reste ${r.stock - vendu}` : ""}, ${eur(r.prix)}`;
    });
    const parVendeur: Record<string, number> = {};
    payees.forEach((x) => { const n = x.data.vendeurPrenom || "?"; parVendeur[n] = (parVendeur[n] || 0) + (Number(x.data.total) || 0); });
    lignes.push(`- Vente « ${v.data.nom} » (${v.data.lieu || ""}, du ${jour(v.data.dateDebut)} au ${jour(v.data.dateFin)}, ${v.data.cloturee ? "clôturée" : "en cours"}) : ${payees.length} transaction(s), CA ${eur(ca)}`
      + `${t.length > payees.length ? `, ${t.length - payees.length} paiement(s) carte en attente` : ""}.`
      + `\n  Produits : ${parProduit.join(" ; ") || "aucun"}.`
      + `\n  Par vendeur : ${Object.entries(parVendeur).map(([n, s]) => `${n} ${eur(s)}`).join(", ") || "aucun"}.`);
  }
  const recentes = txs.sort((a, b) => String(b.data.date || "").localeCompare(String(a.data.date || ""))).slice(0, 150).map((x) => {
    const v = ventes.find((w) => w.id === x.data.venteId);
    const c = x.data.client || {};
    return `- ${jour(x.data.date)} · ${v?.data.nom || "?"} · ${c.prenom || ""} ${c.initiale ? c.initiale + "." : ""} · ${(x.data.lignes || []).map((l: any) => `${l.qte}× ${l.nom} ${l.format || ""}`).join(", ")} · ${eur(x.data.total)} · ${x.data.paiement}${x.data.type === "avoir" ? " (avoir)" : ""}${x.data.statut === "attente" ? " (en attente)" : ""} · vendeur ${x.data.vendeurPrenom || "?"}`;
  });
  return `VENTES PRIVÉES\n${lignes.join("\n") || "Aucune."}\n\n150 DERNIÈRES TRANSACTIONS\n${recentes.join("\n") || "Aucune."}`;
}

function resumeClients(crm: Doc[], clients: Doc[], txs: Doc[]) {
  // fiches du fichier clients, plus les clients des ventes privées ; sans email ni téléphone
  const fiches = crm.map((c) => {
    const d = c.data, achats = d.achats || [];
    const total = achats.reduce((s: number, a: any) => s + (Number(a.total) || 0), 0);
    const dernier = achats.map((a: any) => a.date).filter(Boolean).sort().pop();
    return `- ${d.prenom || ""} ${d.nom || ""} · ${[d.cp, d.ville, d.pays].filter(Boolean).join(" ")} · ${(d.sources || []).join("/")} · ${achats.length} achat(s), ${eur(total)}${dernier ? `, dernier le ${jour(dernier)}` : ""}${d.newsletter ? " · newsletter" : ""}${(d.tags || []).length ? " · " + d.tags.join(", ") : ""}${d.notes ? " · note : " + String(d.notes).slice(0, 120) : ""}`;
  });
  const prives = clients.map((c) => {
    const t = txs.find((x) => x.id === c.id);
    return `- ${c.data.prenom || ""} ${c.data.nom || ""}${c.data.cp ? " · " + c.data.cp : ""} · ${jour(t?.data.date || c.data.date)} · ${t ? eur(t.data.total) + " " + t.data.paiement : ""}`;
  });
  return `FICHIER CLIENTS (${fiches.length} fiches)\n${fiches.slice(0, 600).join("\n")}\n\nCLIENTS DES VENTES PRIVÉES\n${prives.slice(0, 400).join("\n")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reponse({ erreur: "Méthode non autorisée" }, 405);
  try {
    // qui parle ? la clé publique de l'app ne suffit pas : il faut une session de membre
    const jeton = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: u } = await db.auth.getUser(jeton);
    const email = (u?.user?.email || "").toLowerCase();
    if (!email) return reponse({ erreur: "Connectez-vous pour parler à I Armagnac." }, 401);
    const { data: membre } = await db.from("membres").select("role,nom").eq("email", email).maybeSingle();
    if (!membre) return reponse({ erreur: "Réservé aux membres." }, 403);
    const admin = membre.role === "admin";
    const prive = ["benoit.deravignan@gmail.com", "benoit.deravignan@sfr.fr", "quentin.ravignan@gmail.com"].includes(email);

    const { messages } = await req.json();
    if (!Array.isArray(messages) || !messages.length || messages.length > 20) return reponse({ erreur: "Conversation invalide" }, 400);
    const histo = messages.map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 2000) }));
    if (histo[histo.length - 1].role !== "user") return reponse({ erreur: "Conversation invalide" }, 400);

    const lire = async (c: string) => ((await db.from("docs").select("id,data").eq("collection", c)).data || []) as Doc[];
    const [ventes, txs, degu, aide] = await Promise.all([lire("ventes"), lire("transactions"), contenu("degustation"), contenu("aide-vente")]);
    const blocs = [
      `Aujourd'hui : ${new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric" })}. Tu parles à ${membre.nom || email}.`,
      resumeVentes(ventes, txs),
      degu ? `NOTES DE DÉGUSTATION (contenu de la page)\n${JSON.stringify(degu)}` : "",
      aide ? `AIDE À LA VENTE (contenu de la page)\n${JSON.stringify(aide)}` : "",
    ];
    if (admin) { const [crm, clients] = await Promise.all([lire("crm"), lire("clients")]); blocs.push(resumeClients(crm, clients, txs)); }
    else blocs.push("Le fichier clients est réservé aux administrateurs : si on te le demande, dis-le.");
    if (prive) {
      const [famille, chambres] = await Promise.all([lire("famille"), lire("chambres")]);
      blocs.push(`GÉNÉALOGIE\n${famille.map((f) => `- ${f.data.prenom || ""} ${f.data.nom || ""}${f.data.naissance ? " (" + f.data.naissance + (f.data.deces ? "–" + f.data.deces : "") + ")" : ""}${f.data.bio ? " : " + String(f.data.bio).slice(0, 200) : ""}`).join("\n")}`);
      blocs.push(`CHAMBRES DU CHÂTEAU\n${chambres.map((c) => `- ${c.data.nom || c.id}${c.data.etage ? " (" + c.data.etage + ")" : ""}${c.data.lits ? ", " + c.data.lits : ""}`).join("\n")}`);
    }

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
    const r = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 1024,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" }, // réponses parlées, courtes : la vitesse compte plus que la profondeur
      system: [
        { type: "text", text: PERSONNAGE },
        { type: "text", text: blocs.filter(Boolean).join("\n\n"), cache_control: { type: "ephemeral" } },
      ],
      messages: histo,
    } as any);
    if (r.stop_reason === "refusal") return reponse({ texte: "Hè bé, celle-là je ne peux pas y répondre." });
    const texte = r.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ").trim();
    return reponse({ texte: texte || "Je n'ai pas de réponse, macarel." });
  } catch (e) {
    console.error(e);
    return reponse({ erreur: "I Armagnac ne répond pas pour l'instant." }, 500);
  }
});

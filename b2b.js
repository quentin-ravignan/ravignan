/* ---------- Commercial B2B : bars, hôtels, restaurants (administrateurs) ----------
   Recherche de prospects par ville dans OpenStreetMap (données ouvertes, licence ODbL), fiches et suivi des contacts,
   relances, tableau de bord, propositions d'actions, stratégie et modèles d'emails.
   Les prospects sont rangés dans la collection « prospects » (lecture et écriture réservées aux administrateurs). */

const B2B_STATUTS=[
  ["a_contacter","À contacter","#9b8580"],["contacte","Contacté","#b0826f"],["interesse","Intéressé","#c9a227"],
  ["degustation","Dégustation prévue","#5a8fbf"],["client","Client","#3f8f5a"],["perdu","Perdu","#b0473f"]];
const B2B_TYPES={restaurant:"🍽️ Restaurant",bar:"🍸 Bar",hotel:"🏨 Hôtel",cave:"🍷 Caviste",epicerie:"🧺 Épicerie fine",autre:"🏢 Autre"};
const B2B_INTER={appel:"📞 Appel",email:"✉️ Email",visite:"🚶 Visite",degustation:"🥃 Dégustation",commande:"📦 Commande",note:"📝 Note"};
// délai avant la relance suivante, selon l'étape
const B2B_DELAI={a_contacter:0,contacte:4,interesse:7,degustation:3,client:60,perdu:null};
const B2B_VILLES=["Bordeaux","Toulouse","Pau","Bayonne","Biarritz","Mont-de-Marsan","Dax","Auch","Agen","Arcachon","Hossegor","Paris","Lyon"];
let prospects=[],prospectsAbonne=false,b2bOnglet="tableau",b2bFiltre={statut:"",ville:"",type:"",q:""},b2bRecherche={ville:"",rayon:2,types:["restaurant","bar","hotel"],res:[],charge:false,msg:""};

const statutDe=k=>B2B_STATUTS.find(s=>s[0]===k)||B2B_STATUTS[0];
const aujourdhui=()=>new Date().toISOString().slice(0,10);
const plusJours=n=>{const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
const frJour=s=>s?new Date(s+(s.length===10?"T12:00:00":"")).toLocaleDateString("fr-FR",{day:"numeric",month:"short"}):"";

function abonnerProspects(){
  if(prospectsAbonne)return;prospectsAbonne=true;
  db.collection("prospects").onSnapshot(s=>{prospects=s.docs.map(x=>({id:x.id,...x.data()}));if(page==="b2b")render();},e=>flash(dbMessage(e)));
}
async function majProspect(p,patch,msg){
  try{await db.collection("prospects").doc(p.id).update(patch);Object.assign(p,patch);if(msg)flash(msg,"ok");}
  catch(e){flash(dbMessage(e));}
  render();
}
// note de priorité : hôtels et établissements avec site et téléphone d'abord
function scoreProspect(p){
  let s={hotel:3,restaurant:2,bar:2,cave:2,epicerie:1,autre:1}[p.type]||1;
  if(p.etoiles>=4)s+=2;if(p.site)s+=1;if(p.tel)s+=1;if(p.email)s+=1;
  return Math.min(5,s);
}

/* ---------- page ---------- */
function renderB2B(m){
  abonnerProspects();
  m.appendChild(el("div","card soft",`<p style="font-weight:800;color:var(--accent-ink)">🤝 Commercial B2B · bars, hôtels, restaurants</p>
    <p class="muted">Trouvez des établissements par ville, suivez chaque contact jusqu'à la commande et ne ratez aucune relance.</p>`));
  const tabs=el("div","tabs b2b-tabs");
  [["tableau","📊 Tableau de bord"],["recherche","🔎 Trouver"],["prospects","📇 Prospects"],["relances","⏰ Relances"],["strategie","🧭 Stratégie"]].forEach(([k,l])=>{
    const n=k==="relances"?prospects.filter(p=>p.relance&&p.relance<=aujourdhui()&&p.statut!=="perdu").length:0;
    const b=el("button",b2bOnglet===k?"active":"",l+(n?` <span class="b2b-pastille">${n}</span>`:""));b.onclick=()=>{b2bOnglet=k;render();};tabs.appendChild(b);});
  m.appendChild(tabs);
  ({tableau:b2bTableau,recherche:b2bRechercheVue,prospects:b2bListe,relances:b2bRelances,strategie:b2bStrategie}[b2bOnglet]||b2bTableau)(m);
}

/* ---------- tableau de bord et propositions ---------- */
function b2bTableau(m){
  const actifs=prospects.filter(p=>p.statut!=="perdu"),clients=prospects.filter(p=>p.statut==="client");
  const contactes=prospects.filter(p=>p.statut&&p.statut!=="a_contacter");
  const retard=prospects.filter(p=>p.relance&&p.relance<aujourdhui()&&p.statut!=="perdu");
  const potentiel=actifs.reduce((s,p)=>s+(+p.potentiel||0),0);
  const k=el("div","dash-kpis");
  [[prospects.length,"Prospects"],[contactes.length,"Contactés"],[clients.length,"Clients CHR"],
   [contactes.length?Math.round(clients.length/contactes.length*100)+" %":"–","Transformation"],[retard.length,"Relances en retard"],[fmt(potentiel),"Potentiel / an"]]
    .forEach(([v,l])=>k.appendChild(el("div","kpi",`<div class="val num">${v}</div><div class="lab">${l}</div>`)));
  const c=el("div","card");c.appendChild(txt("h2","","Tableau de bord"));c.appendChild(k);
  // entonnoir
  const ent=el("div","dash-bloc");ent.appendChild(txt("h3","sub","Entonnoir"));const max=Math.max(1,...B2B_STATUTS.map(([s])=>prospects.filter(p=>p.statut===s).length));
  B2B_STATUTS.forEach(([s,l,col])=>{const n=prospects.filter(p=>p.statut===s).length;
    const r=el("div","dash-ligne",`<span></span><span class="dash-nom">${l}</span><b class="num">${n}</b><span class="dash-barre"><i style="width:${Math.max(2,n/max*100)}%;background:${col}"></i></span>`);
    r.style.cursor="pointer";r.onclick=()=>{b2bFiltre={...b2bFiltre,statut:s};b2bOnglet="prospects";render();};ent.appendChild(r);});
  const g=el("div","dash-grille");g.appendChild(ent);
  // par ville
  const pv={};prospects.forEach(p=>{const v=p.ville||"?";pv[v]=pv[v]||{n:0,c:0};pv[v].n++;if(p.statut==="client")pv[v].c++;});
  const vb=el("div","dash-bloc");vb.appendChild(txt("h3","sub","Par ville"));
  Object.entries(pv).sort((a,b)=>b[1].n-a[1].n).slice(0,8).forEach(([v,o])=>{const r=el("div","dash-ligne",`<span></span><span class="dash-nom">${esc(v)}</span><b class="num">${o.n}${o.c?` · ${o.c} client${o.c>1?"s":""}`:""}</b>`);
    r.style.cursor="pointer";r.onclick=()=>{b2bFiltre={...b2bFiltre,ville:v};b2bOnglet="prospects";render();};vb.appendChild(r);});
  if(!Object.keys(pv).length)vb.appendChild(txt("p","muted","Aucun prospect pour l'instant."));
  g.appendChild(vb);c.appendChild(g);m.appendChild(c);
  // propositions du commercial digital
  const pr=el("div","card");pr.appendChild(txt("h2","","💡 Propositions du commercial"));
  propositionsB2B().forEach(([ico,t,act])=>{const r=el("div","b2b-prop");r.appendChild(el("span","b2b-prop-ico",ico));r.appendChild(el("span","b2b-prop-txt",t));
    if(act){const b=el("button","btn ghost sm",act[0]);b.onclick=act[1];r.appendChild(b);}pr.appendChild(r);});
  m.appendChild(pr);
}
function propositionsB2B(){
  const out=[],auj=aujourdhui();
  const retard=prospects.filter(p=>p.relance&&p.relance<=auj&&p.statut!=="perdu");
  if(retard.length)out.push(["⏰",`${retard.length} relance${retard.length>1?"s":""} à faire aujourd'hui, dont ${esc(retard.slice(0,3).map(p=>p.nom).join(", "))}.`,["Voir",()=>{b2bOnglet="relances";render();}]]);
  const inter=prospects.filter(p=>p.statut==="interesse");
  if(inter.length)out.push(["🥃",`${inter.length} établissement${inter.length>1?"s":""} intéressé${inter.length>1?"s":""} : proposez une dégustation sur place, c'est l'étape qui fait signer.`,["Voir",()=>{b2bFiltre={...b2bFiltre,statut:"interesse"};b2bOnglet="prospects";render();}]]);
  const deg=prospects.filter(p=>p.statut==="degustation"&&p.relance&&p.relance<auj);
  if(deg.length)out.push(["📦",`Dégustation passée chez ${esc(deg[0].nom)}${deg.length>1?` et ${deg.length-1} autre${deg.length>2?"s":""}`:""} : envoyez l'offre et proposez une première commande.`,null]);
  const parVille={};prospects.filter(p=>p.statut==="a_contacter").forEach(p=>{parVille[p.ville||"?"]=(parVille[p.ville||"?"]||0)+1;});
  const top=Object.entries(parVille).sort((a,b)=>b[1]-a[1])[0];
  if(top&&top[1]>=3)out.push(["📞",`Session d'appels à ${esc(top[0])} : ${top[1]} établissements à contacter. Commencez par les mieux notés (★).`,["Lancer",()=>{b2bFiltre={statut:"a_contacter",ville:top[0],type:"",q:""};b2bOnglet="prospects";render();}]]);
  const clientsCalmes=prospects.filter(p=>p.statut==="client"&&(!p.derniere||p.derniere<plusJours(-60)));
  if(clientsCalmes.length)out.push(["🔁",`${clientsCalmes.length} client${clientsCalmes.length>1?"s":""} CHR sans nouvelles depuis 2 mois : appel de réassort (fêtes, nouvelle carte).`,null]);
  // villes à prospecter : lieux des ventes privées et villes du Sud-Ouest pas encore explorées
  const deja=new Set(prospects.map(p=>normTxt(p.ville||"")));
  const lieux=[...new Set(ventes.map(v=>(v.lieu||"").split(/[,(]/)[0].trim()).filter(Boolean))];
  const idees=[...new Map([...lieux,...B2B_VILLES].map(v=>[normTxt(v),v])).values()].filter(v=>!deja.has(normTxt(v))).slice(0,3);
  if(idees.length)out.push(["🔎",`Nouvelles villes à explorer : ${esc(idees.join(", "))}.`,["Chercher",()=>{b2bRecherche.ville=idees[0];b2bOnglet="recherche";render();}]]);
  if(!prospects.length)out.unshift(["🚀","Commencez par chercher les restaurants, bars et hôtels d'une ville où le domaine a déjà des clients.",["Trouver",()=>{b2bOnglet="recherche";render();}]]);
  if(!out.length)out.push(["✅","Tout est à jour. Prochaine étape : élargir la prospection à une nouvelle ville.",null]);
  return out;
}

/* ---------- recherche dans OpenStreetMap ---------- */
const OSM_FILTRES={restaurant:['node["amenity"="restaurant"]','way["amenity"="restaurant"]'],bar:['node["amenity"~"^(bar|pub)$"]','way["amenity"~"^(bar|pub)$"]'],
  hotel:['node["tourism"="hotel"]','way["tourism"="hotel"]'],cave:['node["shop"="wine"]','way["shop"="wine"]'],epicerie:['node["shop"="deli"]','way["shop"="deli"]']};
function b2bRechercheVue(m){
  const r=b2bRecherche,c=el("div","card");
  c.innerHTML=`<h2>Trouver des établissements</h2><p class="muted">Source : OpenStreetMap (données ouvertes). Les coordonnées publiques des établissements y sont souvent indiquées (téléphone, site, parfois email).</p>
    <div class="grid2"><div class="field"><label for="b2b-ville">Ville</label><input id="b2b-ville" list="b2b-villes" placeholder="ex : Toulouse" value="${esc(r.ville)}"></div>
    <div class="field"><label for="b2b-rayon">Rayon autour du centre</label><select id="b2b-rayon">${[1,2,5,10].map(k=>`<option value="${k}"${r.rayon===k?" selected":""}>${k} km</option>`).join("")}</select></div></div>
    <datalist id="b2b-villes">${B2B_VILLES.map(v=>`<option value="${esc(v)}">`).join("")}</datalist>
    <div class="chips" id="b2b-types">${Object.keys(OSM_FILTRES).map(t=>`<label class="chip${r.types.includes(t)?" sel":""}"><input type="checkbox" value="${t}"${r.types.includes(t)?" checked":""} hidden>${B2B_TYPES[t]}</label>`).join("")}</div>`;
  const go=el("button","btn primary full","🔎 Chercher");c.appendChild(go);
  c.querySelector("#b2b-ville").oninput=e=>{r.ville=e.target.value;};
  c.querySelector("#b2b-rayon").onchange=e=>{r.rayon=+e.target.value;};
  c.querySelectorAll("#b2b-types input").forEach(i=>i.onchange=()=>{r.types=[...c.querySelectorAll("#b2b-types input:checked")].map(x=>x.value);i.parentElement.classList.toggle("sel",i.checked);});
  go.onclick=()=>chercherOSM();
  if(r.msg)c.appendChild(txt("p","muted",r.msg));
  m.appendChild(c);
  if(r.res.length){
    const l=el("div","card");const deja=new Set(prospects.map(p=>p.osm).filter(Boolean));
    const nouveaux=r.res.filter(x=>!deja.has(x.osm));
    const t=el("div","row");t.appendChild(txt("h2","",`${r.res.length} établissement${r.res.length>1?"s":""} trouvé${r.res.length>1?"s":""}`));
    if(nouveaux.length){const all=el("button","btn go sm",`+ Ajouter les ${nouveaux.length} nouveaux`);all.onclick=()=>ajouterProspects(nouveaux);t.appendChild(all);}
    l.appendChild(t);
    r.res.sort((a,b)=>scoreProspect(b)-scoreProspect(a)).forEach(x=>{
      const row=el("div","b2b-res");const dj=deja.has(x.osm);
      row.innerHTML=`<div style="min-width:0"><b>${esc(x.nom)}</b> <small class="muted">${B2B_TYPES[x.type]}${x.etoiles?" · "+"★".repeat(Math.min(5,x.etoiles)):""}</small>
        <p class="muted" style="font-size:13px">${esc([x.adresse,x.cp,x.ville].filter(Boolean).join(" "))}${x.tel?" · 📞 "+esc(x.tel):""}${x.site?" · 🌐":""}${x.email?" · ✉️":""}</p></div>`;
      const b=el("button","btn ghost sm",dj?"✓ Déjà suivi":"+ Suivre");b.disabled=dj;b.onclick=()=>ajouterProspects([x]);row.appendChild(b);l.appendChild(row);});
    l.appendChild(txt("p","muted","© contributeurs OpenStreetMap (ODbL)."));
    m.appendChild(l);
  }
}
async function chercherOSM(){
  const r=b2bRecherche;if(!r.ville.trim())return flash("Indiquez une ville.");if(!r.types.length)return flash("Choisissez au moins un type d'établissement.");
  r.msg="Recherche en cours…";r.res=[];render();
  try{
    const g=await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fr&accept-language=fr&q="+encodeURIComponent(r.ville.trim())).then(x=>x.json());
    if(!g.length)throw new Error("ville introuvable");
    const lat=+g[0].lat,lon=+g[0].lon,ray=r.rayon*1000;
    const q=`[out:json][timeout:40];(${r.types.flatMap(t=>OSM_FILTRES[t].map(f=>`${f}(around:${ray},${lat},${lon});`)).join("")});out center tags 400;`;
    const res=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",body:"data="+encodeURIComponent(q),headers:{"Content-Type":"application/x-www-form-urlencoded"}}).then(x=>{if(!x.ok)throw new Error("OpenStreetMap est occupé, réessayez dans une minute");return x.json();});
    const villeCherchee=g[0].name||r.ville.trim();
    r.res=(res.elements||[]).filter(e=>e.tags&&e.tags.name).map(e=>{const t=e.tags;
      const type=t.tourism==="hotel"?"hotel":t.shop==="wine"?"cave":t.shop==="deli"?"epicerie":/^(bar|pub)$/.test(t.amenity)?"bar":"restaurant";
      return {osm:e.type+"/"+e.id,nom:t.name,type,adresse:[t["addr:housenumber"],t["addr:street"]].filter(Boolean).join(" "),cp:t["addr:postcode"]||"",
        ville:t["addr:city"]||villeCherchee,tel:t.phone||t["contact:phone"]||"",email:t.email||t["contact:email"]||"",site:t.website||t["contact:website"]||"",
        etoiles:parseInt(t.stars)||0,cuisine:t.cuisine||"",lat:e.lat||e.center?.lat,lon:e.lon||e.center?.lon};});
    r.msg=r.res.length?"":"Aucun établissement trouvé : élargissez le rayon.";
  }catch(e){r.msg="⚠️ Recherche impossible : "+(e.message||e);}
  render();
}
async function ajouterProspects(liste){
  let n=0;
  for(const x of liste){const id="osm_"+x.osm.replace("/","_");if(prospects.some(p=>p.id===id))continue;
    const p={...x,statut:"a_contacter",priorite:scoreProspect(x),relance:aujourdhui(),interactions:[],source:"OpenStreetMap",createdAt:new Date().toISOString(),par:monPrenom||""};
    try{await db.collection("prospects").doc(id).set(p);n++;}catch(e){flash(dbMessage(e));break;}}
  if(n)flash(`${n} prospect${n>1?"s":""} ajouté${n>1?"s":""} à suivre.`,"ok");render();
}

/* ---------- liste des prospects ---------- */
function b2bListe(m){
  const f=b2bFiltre,c=el("div","card");
  const villes=[...new Set(prospects.map(p=>p.ville).filter(Boolean))].sort();
  c.innerHTML=`<div class="row" style="flex-wrap:wrap;gap:8px"><h2 style="margin:0">Prospects</h2><span style="flex:1"></span></div>
    <div class="b2b-filtres"><input class="search" id="b2b-q" type="search" placeholder="Nom, ville, note…" value="${esc(f.q)}">
    <select id="b2b-st"><option value="">Tous les statuts</option>${B2B_STATUTS.map(([k,l])=>`<option value="${k}"${f.statut===k?" selected":""}>${l}</option>`).join("")}</select>
    <select id="b2b-vi"><option value="">Toutes les villes</option>${villes.map(v=>`<option${f.ville===v?" selected":""}>${esc(v)}</option>`).join("")}</select>
    <select id="b2b-ty"><option value="">Tous les types</option>${Object.entries(B2B_TYPES).map(([k,l])=>`<option value="${k}"${f.type===k?" selected":""}>${l}</option>`).join("")}</select></div>`;
  const tete=c.querySelector(".row");
  const nv=el("button","btn ghost sm","+ Nouveau");nv.onclick=()=>ficheProspect(null);tete.appendChild(nv);
  const ex=el("button","btn ghost sm","📊 Excel");ex.onclick=exporterProspects;tete.appendChild(ex);
  const q=c.querySelector("#b2b-q");q.oninput=e=>{f.q=e.target.value;dessiner();};
  c.querySelector("#b2b-st").onchange=e=>{f.statut=e.target.value;dessiner();};
  c.querySelector("#b2b-vi").onchange=e=>{f.ville=e.target.value;dessiner();};
  c.querySelector("#b2b-ty").onchange=e=>{f.type=e.target.value;dessiner();};
  const liste=el("div","stack");c.appendChild(liste);m.appendChild(c);
  function dessiner(){liste.innerHTML="";const t=normTxt(f.q);
    const l=prospects.filter(p=>(!f.statut||p.statut===f.statut)&&(!f.ville||p.ville===f.ville)&&(!f.type||p.type===f.type)&&(!t||normTxt([p.nom,p.ville,p.notes,p.contact].join(" ")).includes(t)))
      .sort((a,b)=>(b.priorite||0)-(a.priorite||0)||String(a.relance||"9").localeCompare(String(b.relance||"9")));
    if(!l.length){liste.appendChild(txt("p","muted",prospects.length?"Aucun prospect ne correspond.":"Aucun prospect : utilisez l'onglet « Trouver »."));return;}
    l.slice(0,200).forEach(p=>liste.appendChild(ligneProspect(p)));
    if(l.length>200)liste.appendChild(txt("p","muted",`… et ${l.length-200} autres : affinez les filtres.`));}
  dessiner();
}
function ligneProspect(p){
  const [,lab,col]=statutDe(p.statut),retard=p.relance&&p.relance<aujourdhui()&&p.statut!=="perdu";
  const r=el("button","b2b-ligne");
  r.innerHTML=`<span class="b2b-statut" style="background:${col}">${lab}</span>
    <span style="flex:1;min-width:0;text-align:left"><b>${esc(p.nom)}</b> <small class="muted">${B2B_TYPES[p.type]||""} · ${esc(p.ville||"")}</small>
    <small class="muted" style="display:block">${"★".repeat(p.priorite||0)}${p.contact?" · "+esc(p.contact):""}${p.tel?" · 📞 "+esc(p.tel):""}</small></span>
    <span class="num ${retard?"b2b-retard":"muted"}" style="font-size:12px;white-space:nowrap">${p.relance?(retard?"⚠️ ":"⏰ ")+frJour(p.relance):""}</span>`;
  r.onclick=()=>ficheProspect(p);return r;
}

/* ---------- fiche d'un prospect ---------- */
function ficheProspect(p0){
  const nouveau=!p0,p=p0?{...p0}:{nom:"",type:"restaurant",ville:"",statut:"a_contacter",priorite:3,interactions:[],relance:aujourdhui()};
  qs("#b2b-modal")?.remove();
  const m=el("div","modal");m.id="b2b-modal";const sh=el("div","sheet b2b-fiche");m.appendChild(sh);
  const fermer=()=>m.remove();m.onclick=e=>{if(e.target===m)fermer();};
  sh.appendChild(txt("h2","sheet-title",nouveau?"Nouveau prospect":p.nom));
  if(!nouveau){const liens=el("div","chips");
    if(p.tel){const a=el("a","chip");a.href="tel:"+p.tel.replace(/[^\d+]/g,"");a.textContent="📞 Appeler";liens.appendChild(a);}
    if(p.email){const a=el("a","chip");a.href=mailtoB2B(p,"premier");a.textContent="✉️ Écrire";liens.appendChild(a);}
    if(p.site){const a=el("a","chip");a.href=/^https?:/.test(p.site)?p.site:"https://"+p.site;a.target="_blank";a.rel="noopener";a.textContent="🌐 Site";liens.appendChild(a);}
    if(p.lat&&p.lon){const a=el("a","chip");a.href=`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`;a.target="_blank";a.rel="noopener";a.textContent="📍 Carte";liens.appendChild(a);}
    sh.appendChild(liens);}
  const f=el("div","stack",`
    <div class="grid2"><div class="field"><label for="pf-nom">Établissement *</label><input id="pf-nom"></div>
    <div class="field"><label for="pf-type">Type</label><select id="pf-type">${Object.entries(B2B_TYPES).map(([k,l])=>`<option value="${k}">${l}</option>`).join("")}</select></div></div>
    <div class="grid2"><div class="field"><label for="pf-statut">Étape</label><select id="pf-statut">${B2B_STATUTS.map(([k,l])=>`<option value="${k}">${l}</option>`).join("")}</select></div>
    <div class="field"><label for="pf-relance">Prochaine relance</label><input id="pf-relance" type="date"></div></div>
    <div class="grid2"><div class="field"><label for="pf-contact">Contact (nom, fonction)</label><input id="pf-contact" placeholder="ex : Julie, cheffe sommelière"></div>
    <div class="field"><label for="pf-tel">Téléphone</label><input id="pf-tel" type="tel"></div></div>
    <div class="grid2"><div class="field"><label for="pf-email">Email</label><input id="pf-email" type="email"></div>
    <div class="field"><label for="pf-site">Site</label><input id="pf-site"></div></div>
    <div class="grid2"><div class="field"><label for="pf-adresse">Adresse</label><input id="pf-adresse"></div>
    <div class="field"><label for="pf-ville">Ville</label><input id="pf-ville"></div></div>
    <div class="grid2"><div class="field"><label for="pf-potentiel">Potentiel annuel (€ HT)</label><input id="pf-potentiel" type="number" min="0" step="50"></div>
    <div class="field"><label for="pf-priorite">Priorité</label><select id="pf-priorite">${[5,4,3,2,1].map(n=>`<option value="${n}">${"★".repeat(n)}</option>`).join("")}</select></div></div>
    <div class="field"><label for="pf-notes">Notes</label><textarea id="pf-notes" rows="3" placeholder="Carte des digestifs, prix pratiqués, objections…"></textarea></div>`);
  sh.appendChild(f);
  const champs={nom:"pf-nom",type:"pf-type",statut:"pf-statut",relance:"pf-relance",contact:"pf-contact",tel:"pf-tel",email:"pf-email",site:"pf-site",adresse:"pf-adresse",ville:"pf-ville",potentiel:"pf-potentiel",priorite:"pf-priorite",notes:"pf-notes"};
  Object.entries(champs).forEach(([k,id])=>{f.querySelector("#"+id).value=p[k]??"";});
  // changement d'étape : la relance suivante se cale toute seule
  f.querySelector("#pf-statut").onchange=e=>{const d=B2B_DELAI[e.target.value];f.querySelector("#pf-relance").value=d==null?"":plusJours(d);};
  // journal des échanges
  if(!nouveau){
    const j=el("div","stack");j.appendChild(txt("h3","sub","Échanges"));
    const ajout=el("div","b2b-ajout",`<select id="pf-it">${Object.entries(B2B_INTER).map(([k,l])=>`<option value="${k}">${l}</option>`).join("")}</select><input id="pf-in" placeholder="Ce qui s'est dit, la suite…">`);
    const ok=el("button","btn go sm","Noter");ajout.appendChild(ok);j.appendChild(ajout);
    ok.onclick=async()=>{const type=ajout.querySelector("#pf-it").value,note=ajout.querySelector("#pf-in").value.trim();
      const it={type,note,date:new Date().toISOString(),par:monPrenom||""};
      let statut=p.statut;if(statut==="a_contacter"&&["appel","email","visite"].includes(type))statut="contacte";if(type==="degustation")statut="degustation";if(type==="commande")statut="client";
      const d=B2B_DELAI[statut];
      await majProspect(p0,{interactions:[...(p0.interactions||[]),it],statut,derniere:aujourdhui(),relance:d==null?"":plusJours(d||3)},"Échange noté, relance recalée.");fermer();ficheProspect(prospects.find(x=>x.id===p0.id)||p0);};
    [...(p.interactions||[])].reverse().forEach(it=>j.appendChild(el("div","journal-ligne",`<span>${(B2B_INTER[it.type]||"📝").split(" ")[0]}</span><span class="journal-txt"><b>${esc(it.note||B2B_INTER[it.type]||"")}</b><small class="muted">${new Date(it.date).toLocaleDateString("fr-FR")}${it.par?" · "+esc(it.par):""}</small></span>`)));
    sh.appendChild(j);
    const mod=el("div","chips");mod.appendChild(txt("span","muted","Modèles d'email :"));
    [["premier","1er contact"],["relance","Relance"],["degustation","Dégustation"],["offre","Offre"],["reassort","Réassort"]].forEach(([k,l])=>{const a=el("a","chip",l);a.href=mailtoB2B(p,k);mod.appendChild(a);});
    if(p.email)sh.appendChild(mod);
  }
  const enr=el("button","btn primary full",nouveau?"Créer le prospect":"Enregistrer");
  enr.onclick=async()=>{const d={};Object.entries(champs).forEach(([k,id])=>{d[k]=f.querySelector("#"+id).value.trim();});
    if(!d.nom)return flash("Indiquez le nom de l'établissement.");d.potentiel=+d.potentiel||0;d.priorite=+d.priorite||3;
    if(nouveau){const id="p"+uid();try{await db.collection("prospects").doc(id).set({...d,interactions:[],source:"Saisie",createdAt:new Date().toISOString(),par:monPrenom||""});flash("Prospect créé.","ok");}catch(e){return flash(dbMessage(e));}}
    else await majProspect(p0,d,"Fiche enregistrée.");
    fermer();render();};
  sh.appendChild(enr);
  if(!nouveau){const del=el("button","link","Supprimer ce prospect");del.style.color="var(--bad)";
    del.onclick=async()=>{if(await confirmer({titre:`Supprimer ${p.nom} ?`,texte:"<p class=\"muted\">La fiche et ses échanges seront effacés.</p>",bouton:"Supprimer"})){try{await db.collection("prospects").doc(p0.id).delete();flash("Prospect supprimé.","ok");}catch(e){flash(dbMessage(e));}fermer();render();}};
    sh.appendChild(del);}
  const an=el("button","btn ghost full","Fermer");an.onclick=fermer;sh.appendChild(an);
  document.body.appendChild(m);
}

/* ---------- relances ---------- */
function b2bRelances(m){
  const auj=aujourdhui(),semaine=plusJours(7);
  const l=prospects.filter(p=>p.relance&&p.relance<=semaine&&p.statut!=="perdu").sort((a,b)=>a.relance.localeCompare(b.relance));
  const c=el("div","card");c.appendChild(txt("h2","","Relances des 7 prochains jours"));
  if(!l.length)c.appendChild(txt("p","muted","Aucune relance prévue cette semaine."));
  [["En retard",x=>x.relance<auj],["Aujourd'hui",x=>x.relance===auj],["Cette semaine",x=>x.relance>auj]].forEach(([t,fn])=>{const g=l.filter(fn);if(!g.length)return;
    c.appendChild(txt("h3","sub",`${t} (${g.length})`));g.forEach(p=>c.appendChild(ligneProspect(p)));});
  m.appendChild(c);
}

/* ---------- stratégie et modèles ---------- */
function b2bStrategie(m){
  const c=el("div","card b2b-strat");
  c.innerHTML=`<h2>🧭 Stratégie CHR du Domaine de Ravignan</h2>
  <h3 class="sub">1. Qui viser en premier</h3>
  <ul><li><b>Restaurants gastronomiques et bistronomiques</b> du Sud-Ouest : la carte des digestifs se construit autour d'un armagnac de domaine, avec son histoire.</li>
  <li><b>Hôtels 4 et 5 étoiles</b> et leurs bars : clientèle internationale, prix de vente élevés, besoin de produits singuliers.</li>
  <li><b>Bars à cocktails et à whisky</b> : l'armagnac comme alternative premium au cognac et au whisky.</li>
  <li><b>Cavistes et épiceries fines</b> : revente en bouteilles, coffrets pour les fêtes.</li></ul>
  <h3 class="sub">2. Ce qu'on apporte</h3>
  <ul><li>Un armagnac de propriété familiale depuis 1732, des millésimes rares pour la carte (verre de l'année de naissance, anniversaires).</li>
  <li>Une dégustation sur place offerte, et une formation courte de l'équipe de salle.</li>
  <li>Des supports : fiche de chaque millésime, texte pour la carte, histoire du château.</li>
  <li>Des tarifs professionnels HT dégressifs et une livraison groupée par ville (à fixer par le domaine).</li></ul>
  <h3 class="sub">3. La séquence de prospection</h3>
  <ol><li><b>Jour 0</b> : email court de premier contact (modèle ci-dessous), ou appel en dehors des services (10 h-11 h 30, 15 h-17 h).</li>
  <li><b>Jour 4</b> : appel de relance, demander le nom du décisionnaire (chef, sommelier, directeur de bar).</li>
  <li><b>Jour 10</b> : proposer une dégustation de 15 minutes sur place, avec 3 millésimes.</li>
  <li><b>Après la dégustation</b> : envoyer l'offre dans les 48 h, proposer une première commande modeste.</li>
  <li><b>Client</b> : appel tous les 2 mois (réassort, fêtes, nouvelle carte), invitation aux ventes du domaine.</li></ol>
  <h3 class="sub">4. Ce qu'on mesure</h3>
  <p>Nombre de contacts par semaine, dégustations obtenues, taux de transformation, commande moyenne, réassort. L'onglet « Tableau de bord » suit tout cela.</p>
  <h3 class="sub">5. Règles à respecter</h3>
  <ul><li>Prospection B2B par email autorisée vers une adresse professionnelle, avec une phrase pour ne plus être contacté (incluse dans les modèles).</li>
  <li>Loi Évin : chaque email promotionnel porte « L'abus d'alcool est dangereux pour la santé. À consommer avec modération. » (inclus).</li>
  <li>Ventes aux professionnels : facture électronique obligatoire via une plateforme agréée à partir de septembre 2027.</li></ul>`;
  m.appendChild(c);
}
const B2B_MODELES={
  premier:["Armagnac du Domaine de Ravignan pour votre carte","Bonjour,\n\nJe suis {moi}, de la famille de Ravignan, propriétaire du château de Ravignan à Perquie, dans le Bas-Armagnac, depuis 1732.\n\nNous produisons nos armagnacs au domaine et proposons aux restaurants, bars et hôtels des millésimes rares pour leur carte des digestifs. J'aimerais vous faire déguster trois millésimes sur place, en un quart d'heure, au moment qui vous arrange.\n\nSeriez-vous disponible dans les prochains jours ?\n\nBien cordialement,\n{moi}\nDomaine de Ravignan · 05 58 45 33 07 · armagnac-ravignan.com"],
  relance:["Une dégustation d'armagnac chez {nom} ?","Bonjour,\n\nJe me permets de revenir vers vous au sujet de nos armagnacs du Domaine de Ravignan. Une dégustation de 15 minutes sur place vous permettrait de juger par vous-même, sans engagement.\n\nQuel jour vous conviendrait ?\n\nBien cordialement,\n{moi}\nDomaine de Ravignan · 05 58 45 33 07"],
  degustation:["Dégustation Domaine de Ravignan : proposition de date","Bonjour,\n\nComme convenu, je vous propose de passer chez {nom} pour une dégustation de nos millésimes. Seriez-vous disponible le … à … ?\n\nJ'apporterai trois millésimes et leurs fiches pour la carte.\n\nBien cordialement,\n{moi}\nDomaine de Ravignan · 05 58 45 33 07"],
  offre:["Notre offre pour {nom}","Bonjour,\n\nMerci pour votre accueil lors de la dégustation. Vous trouverez ci-dessous notre proposition pour {nom} : … (millésimes, tarifs professionnels HT, conditions de livraison).\n\nNous pouvons démarrer par une première commande de quelques bouteilles pour tester la carte.\n\nBien cordialement,\n{moi}\nDomaine de Ravignan · 05 58 45 33 07"],
  reassort:["Réassort armagnac pour {nom}","Bonjour,\n\nComment se passe l'armagnac du Domaine de Ravignan sur votre carte ? À l'approche des fêtes, souhaitez-vous refaire le point sur votre stock, ou découvrir un nouveau millésime ?\n\nBien cordialement,\n{moi}\nDomaine de Ravignan · 05 58 45 33 07"]};
function mailtoB2B(p,k){
  const [obj,corps]=B2B_MODELES[k]||B2B_MODELES.premier;const moi=monPrenom||"Domaine de Ravignan";
  const r=s=>s.replace(/\{nom\}/g,p.nom||"votre établissement").replace(/\{moi\}/g,moi);
  const pied="\n\nL'abus d'alcool est dangereux pour la santé. À consommer avec modération.\nSi vous ne souhaitez plus être contacté par le domaine, répondez simplement « stop ».";
  return `mailto:${encodeURIComponent(p.email||"")}?subject=${encodeURIComponent(r(obj))}&body=${encodeURIComponent(r(corps)+pied)}`;
}
async function exporterProspects(){
  try{if(!window.XLSX)await chargerScript(XLSX_SRC);}catch(e){return flash("L'export Excel n'a pas pu se charger.");}
  const rows=prospects.map(p=>({"Établissement":p.nom,"Type":(B2B_TYPES[p.type]||"").replace(/^\S+\s/,""),"Étape":statutDe(p.statut)[1],"Priorité":p.priorite||"","Ville":p.ville||"","Adresse":p.adresse||"","Code postal":p.cp||"",
    "Contact":p.contact||"","Téléphone":p.tel||"","Email":p.email||"","Site":p.site||"","Potentiel € HT":+p.potentiel||0,"Prochaine relance":p.relance||"","Dernier échange":p.derniere||"","Échanges":(p.interactions||[]).length,"Notes":p.notes||"","Source":p.source||""}));
  const wb=XLSX.utils.book_new();const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{"Établissement":"Aucun prospect"}]);ws["!autofilter"]={ref:ws["!ref"]};
  XLSX.utils.book_append_sheet(wb,ws,"Prospects");XLSX.writeFile(wb,"ravignan-prospects-chr.xlsx");flash("Prospects exportés.","ok");
}

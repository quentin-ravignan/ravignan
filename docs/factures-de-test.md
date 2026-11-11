# Factures de test supprimées (11/11/2026)

Avant l'examen des chiffres, les essais faits pendant la mise au point de l'application ont été retirés de la base.
Il n'y a jamais eu de vente réelle derrière ces numéros : ils expliquent les trous dans la numérotation continue.

| Numéro | Origine |
|---|---|
| 2026-11-05-0008 | essai, vente « Paroisse en Fête Bordeaux 2026 » (avant son ouverture le 21/11) |
| 2026-11-05-0009 | essai, Paroisse en Fête |
| 2026-11-07-0053 | essai, Paroisse en Fête |
| 2026-11-09-0087 | essai, Paroisse en Fête |
| 2026-11-09-0088 | essai, Paroisse en Fête |
| 2026-11-10-0089 | essai, vente de test « Test 2 » |
| 2026-11-10-0091 | essai, vente de test « test » |
| AV-2026-0001 | avoir d'essai, Paroisse en Fête |
| VP-2026-0001 à VP-2026-0005 | ancienne numérotation, essais sur Paroisse en Fête |

Huit autres transactions d'essai n'avaient pas de numéro de facture.

Au total : 21 transactions d'essai (Paroisse en Fête : 19, ventes « test » et « Test 2 » : 2) et les 2 ventes de test.
Les lignes supprimées sont gardées dans la table `docs_corbeille` de Supabase, lisible seulement depuis le tableau de bord.

Après le nettoyage, la seule vente avec des transactions est « Vente toulouse 07/11 » : 82 transactions, 3 477,90 €.
Deux de ces ventes (factures 2026-11-06-0051, 38 €, et 2026-11-07-0071, 19 €, en espèces) n'ont pas de client identifié : « Client non renseigné ».

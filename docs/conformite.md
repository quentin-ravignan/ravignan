# Conformité : facturation et RGPD

Dernière mise à jour : 7 novembre 2026, avec les recommandations de Benoît et l'extrait Kbis du 15 juin 2026. Ce document résume ce que l'application fait et ce qui reste à la charge du domaine. Il ne remplace pas l'avis d'un expert-comptable ou d'un juriste.

## Facturation

### Ce que fait l'application
- Numéro unique et continu : `AAAA-MM-JJ-NNNN` pour les factures, `AV-AAAA-MM-JJ-NNNN` pour les avoirs (fonction `numero_facture`). Une vente par carte abandonnée après avoir reçu son numéro reste en base, vidée, pour qu'il n'y ait pas de trou dans la numérotation.
- Aucune facture n'est modifiée après coup : une erreur ou un retour se corrige par un avoir qui renvoie à la facture d'origine.
- Mentions portées sur chaque facture :
  - vendeur : SCEA du Domaine de Ravignan, société civile d'exploitation agricole au capital de 451 680 €, siège au Château de Ravignan 40190 Perquie, SIREN 478 355 779 RCS Mont-de-Marsan, SIRET, code APE, n° de TVA intracommunautaire, n° d'accise ;
  - client : nom, adresse (si elle est saisie), code postal, ville ;
  - numéro et date ; nature de l'opération (livraison de biens) ;
  - désignation, quantité, prix unitaire HT, taux de TVA, totaux HT, TVA et TTC, remise éventuelle ;
  - règlement : facture acquittée et moyen de paiement, ou IBAN ;
  - conditions : paiement à réception, pas d'escompte, pénalités de retard et indemnité de 40 € pour les clients professionnels ;
  - information sur les données personnelles et message de modération (loi Évin).
- Archive : la première version de chaque facture en PDF est gardée dans le stockage privé `archives` (lecture par les administrateurs, ni modification ni suppression), pour la conservation de 10 ans.

### À compléter par le domaine
- **Numéro de TVA** : la facture porte FR 80782106108, alors que le numéro calculé à partir du SIREN 478 355 779 serait FR73478355779. À vérifier avec le comptable (ou sur le site de la Commission européenne, VIES) avant de corriger.
- **Facturation électronique (réforme 2026-2027)** :
  - depuis le 1er septembre 2026, toutes les entreprises doivent pouvoir **recevoir** des factures électroniques : choisir une plateforme agréée (PA) ;
  - les ventes aux particuliers (B2C) ne sont pas concernées par l'émission de factures électroniques, mais leurs montants devront être transmis à l'administration (**e-reporting**) à partir du 1er septembre 2027 pour les PME, via la plateforme agréée ;
  - les ventes à des professionnels (B2B) devront être **émises** au format électronique via la plateforme agréée à partir du 1er septembre 2027 ; pour ces clients, il faudra aussi leur SIREN. L'export des ventes de l'application pourra alimenter la plateforme.
- **Logiciel de caisse (loi anti-fraude TVA, article 286 du CGI)** : un assujetti qui encaisse des particuliers doit utiliser un logiciel de caisse respectant les conditions d'inaltérabilité, de sécurisation, de conservation et d'archivage, justifiées par un certificat (NF525 ou équivalent). L'application n'est pas certifiée. Deux options : faire passer les ventes aux particuliers par une caisse certifiée (par exemple l'application SumUp, qui tient ce rôle pour les paiements par carte) en gardant l'application comme outil de suivi, ou demander à l'expert-comptable la conduite à tenir.

## RGPD

### Registre des traitements (article 30)
| Traitement | Finalité | Base légale | Personnes | Données | Destinataires | Durée |
|---|---|---|---|---|---|---|
| Ventes et factures | Vendre, facturer, encaisser | Contrat, obligation légale | Clients | Identité, coordonnées, achats | Membres de l'app, Supabase, Gmail, OVH (SMS), SumUp (carte) | 10 ans |
| Remerciements et nouvelles | Fidéliser les clients | Intérêt légitime, sauf opposition ; consentement (opt-in) si la vente est encaissée par une association | Clients | Prénom, email, produits achetés | Gmail | 3 ans après le dernier achat |
| Fichier clients (CRM) | Suivi de la relation | Intérêt légitime | Clients et prospects | Identité, coordonnées, historique | Membres de l'app | 3 ans après le dernier contact |
| Accès des membres | Organiser les ventes | Intérêt légitime | Famille, vendeurs | Nom, email, photo Google, rôle | Supabase, Google | Tant que l'accès est ouvert |
| Généalogie | Histoire de la famille | Intérêt légitime (usage familial) | Membres de la famille | Identité, dates, liens, coordonnées | Administrateurs | Sans limite (usage familial) |

### Prestataires (sous-traitants)
Supabase (base de données, UE), Google (Gmail pour l'envoi des emails, connexion Google), OVHcloud (SMS), SumUp (paiement par carte), GitHub Pages (hébergement des pages, sans donnée client). Netlify n'est pas utilisé par l'application.

### Mesures en place
- Case à la caisse : « Le client ne souhaite pas recevoir d'informations du domaine » (opposition) ; pour une vente encaissée par une association, case d'accord à cocher (opt-in) : sans elle, seule la facture est envoyée.
- Avis Google demandé à tous les clients, sans contrepartie.
- Information des clients : mention dans chaque email, sur chaque facture, à la caisse (phrase à dire au client) et page `confidentialite.html`.
- Engagement : données utilisées uniquement en interne, jamais transmises à des tiers.
- Désabonnement : lien personnel dans chaque email (jeton aléatoire, sans l'adresse dans le lien) ; un client désabonné ne reçoit plus les remerciements. Les factures restent envoyées, car elles sont dues.
- Accès selon le rôle : vendeurs et membres d'un côté, administrateurs de l'autre ; tout le site demande une connexion.
- Hébergement des données dans l'Union européenne (Supabase, Irlande).
- Fichiers clients jamais publiés dans le dépôt public.

### À faire
- Purge : retirer du fichier clients (CRM) les personnes sans achat ni contact depuis 3 ans, au moins une fois par an.
- Demandes des personnes (accès, suppression) : répondre sous un mois à partir de contact@.

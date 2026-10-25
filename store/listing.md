# Fiche Chrome Web Store

Tout ce qu'il faut coller dans le tableau de bord du Chrome Web Store.

## Identité

| Champ | Valeur |
|---|---|
| Nom (fr) | Outils de prix pour WikiMasters |
| Nom (en) | Price Tools for WikiMasters |
| Catégorie | Fun |
| Langue par défaut | Français |
| Page d'accueil | https://github.com/quentinjuarez/wikimasters-tools |
| Support | https://github.com/quentinjuarez/wikimasters-tools/issues |
| Politique de confidentialité | https://quentinjuarez.github.io/wikimasters-tools/privacy.html (GitHub Pages, dossier `docs`) |

## Description courte (132 caractères maximum)

fr (122) : Prix moyens des cartes, valeur estimée de ta collection et raccourcis de vente et d'enchère sur WikiMasters. Non officiel.

en (115) : Average card prices, collection value estimate and sell and bid shortcuts on WikiMasters. Unofficial, runs locally.

## Description détaillée (fr)

Outils de prix pour WikiMasters ajoute à wiki-masters.com ce qui manque pour estimer et vendre ses cartes sans quitter la page.

Cette extension est indépendante : elle n'est ni éditée, ni approuvée, ni parrainée par WikiMasters.

Ce que tu obtiens

- Le prix moyen de chaque carte, affiché directement sur la carte dans ta collection, le marché, les enchères, les paquets et les échanges. Un prix calculé est gardé : il n'est jamais recalculé tout seul, un clic sur le prix le met à jour.
- La valeur estimée de ta collection, avec filtres par rareté, étiquette et texte, et une répartition par rareté.
- Un tri « Prix décroissant » ajouté au tri de ta collection, avec les filtres du site.
- Un bouton Vendre sur chaque carte, avec le montant et la durée que tu as choisis une fois pour toutes.
- Un bouton Enchérir sur les ventes du marché, qui propose directement la mise minimale.
- Tes filtres de collection mémorisés d'une visite à l'autre.
- Des raccourcis clavier pour les paquets : flèche haut pour ouvrir, flèche bas pour continuer, flèches gauche et droite pour passer d'une carte à l'autre.

Respect du site

- Les prix sont chargés un par un, avec un rythme qui s'adapte aux limites du site et une pause automatique si le site demande de ralentir.
- Une action (vente, mise, ouverture) n'est faite que quand tu cliques. L'extension ne joue jamais à ta place, et si le site demande une vérification anti-bot, c'est toi qui la passes.

Confidentialité

- Aucune donnée n'est envoyée à l'auteur ni à un tiers. Les prix, ta collection et tes réglages restent dans ton navigateur.
- L'extension ne parle qu'à www.wiki-masters.com, avec ta session déjà ouverte. Aucun mot de passe n'est lu.

## Description détaillée (en)

Price Tools for WikiMasters adds what is missing on wiki-masters.com to estimate and sell your cards without leaving the page.

This extension is independent: it is not published, endorsed or sponsored by WikiMasters.

What you get

- The average price of every card, shown right on the card in your collection, the market, auctions, packs and trades. A computed price is kept: it is never recomputed on its own, one click on the price refreshes it.
- The estimated value of your collection, with rarity, tag and text filters, and a breakdown by rarity.
- A "Prix décroissant" (price, descending) option added to your collection sort, working with the site's own filters.
- A Sell button on every card, using the amount and duration you set once.
- A Bid button on market listings that proposes the minimum bid.
- Your collection filters remembered from one visit to the next.
- Keyboard shortcuts for packs: up arrow to open, down arrow to continue, left and right arrows to move between cards.

Respect for the site

- Prices are loaded one at a time, at a pace that adapts to the site's limits, with an automatic pause when the site asks to slow down.
- An action (sale, bid, opening) only happens when you click. The extension never plays for you, and if the site asks for an anti-bot check, you pass it yourself.

Privacy

- No data is sent to the author or to any third party. Prices, your collection and your settings stay in your browser.
- The extension only talks to www.wiki-masters.com, using your existing session. No password is read.

## Onglet Confidentialité

**Objectif unique** : afficher les prix moyens des cartes et proposer des outils d'estimation, de vente et d'enchère sur le site WikiMasters.

**Justification des autorisations**

| Autorisation | Justification |
|---|---|
| `storage` | Garder localement les prix calculés, l'instantané de la collection et les réglages de l'utilisateur. |
| `unlimitedStorage` | Le cache d'une grande collection (plusieurs dizaines de milliers de cartes avec leurs prix) peut dépasser la limite par défaut de 10 Mo. |
| Accès au site `https://www.wiki-masters.com/*` (scripts de contenu) | Lire les cartes affichées pour y ajouter les prix, et appeler l'API du site depuis ses pages avec la session de l'utilisateur. Un script s'exécute dans le contexte de la page pour lire les réponses que le site reçoit déjà, afin d'identifier les cartes sans requête supplémentaire. |

**Code distant** : Non, je n'utilise pas de code distant.

**Utilisation des données** : ne cocher aucune catégorie de données collectées (aucune donnée n'est collectée ni transmise). Cocher les trois certifications : pas de vente de données, pas d'usage sans rapport avec l'objectif unique, pas d'utilisation pour évaluer la solvabilité.

## Instructions pour le relecteur (champ « Instructions de test »)

L'extension agit sur wiki-masters.com, qui demande un compte gratuit. Pour la tester : créer un compte sur le site, ouvrir la Collection (des badges de prix apparaissent sous la rareté des cartes après quelques secondes), cliquer sur la pastille « prix en cache » en bas de l'écran pour ouvrir le panneau d'estimation, et ouvrir l'onglet Parcourir du Marché pour voir les boutons Enchérir. Les boutons de vente et d'enchère n'agissent que sur un clic.

## Captures d'écran (1280x800)

Dans `store/screenshots/`, à envoyer dans cet ordre :

1. `01-collection.png` : prix sur chaque carte et bouton Vendre au même endroit.
2. `02-estimation.png` : valeur estimée de la collection, filtres et progression du calcul.
3. `03-marche.png` : onglet Parcourir avec le bouton Enchérir sur chaque vente.
4. `04-tri-par-prix.png` : tri « Prix décroissant » avec les filtres du site.

Images promotionnelles : `promo-small-440x280.png` (petite) et `promo-marquee-1400x560.png` (bannière). Ces captures sont générées avec les vrais composants de l'extension (`npm run store-assets`) sur des cartes d'exemple. Remplace-les par de vraies captures de ton écran si tu préfères.

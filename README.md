# Bible QSSE

Bibliothèque locale installable, conçue pour Chrome/Edge avec accès à un dossier de documents. Aucune transmission des documents à un serveur.

## Utilisation

- **Choisir un dossier** : donne accès à ta bibliothèque sur l’appareil.
- **Grille / Liste** : change la présentation ; la liste affiche les tailles et dates.
- **Tags** : ajoute plusieurs étiquettes par document et filtre la bibliothèque.
- **Indexer le texte des PDF** : prépare la recherche dans leur contenu, sur cet appareil. À relancer après l’ajout ou la modification de fichiers. Un résultat indique la page et ouvre le lecteur à cet endroit.
- **Ouvrir un PDF** : lit aussi un fichier isolé, sans sélectionner de dossier.
- Dans le lecteur : sélectionne du texte puis **Surligner la sélection**, ou trace une **zone** avec le doigt/la souris. **Ajouter une note** permet de placer une note sur la page. Les annotations sont enregistrées automatiquement.
- **Exporter une copie annotée** : télécharge un nouveau PDF. Les surlignages sont intégrés visuellement à la copie ; les notes sont des annotations PDF standard, consultables dans un lecteur qui les prend en charge. L’original n’est pas réécrit.

Les tags, annotations et textes indexés sont stockés dans le navigateur de l’appareil. Les effacer dans les réglages du navigateur les supprime ; les copies PDF exportées restent indépendantes. Pas de synchronisation entre appareils. Les annotations sont associées au contenu exact du fichier, afin de rester disponibles si celui-ci est renommé.

La recherche dans le contenu concerne les PDF contenant du texte. Les scans sans couche texte nécessitent un OCR, non inclus ; ils restent lisibles et annotables par zone. Les PDF protégés par mot de passe s’ouvrent avec un lecteur externe. Les autres formats s’ouvrent via le navigateur ou l’application associée.

Après un premier chargement complet en ligne, l’interface et les outils PDF sont mis en cache pour fonctionner hors connexion avec les fichiers locaux autorisés.

## Développement et tests

Site statique sans compilation. `npm ci` puis `npm test` (Node 24+).

Les tests vérifient l’indexation, les métadonnées locales, la recherche et les pages ciblées, l’export des notes, le rendu des surlignages, les rotations, les fichiers d’installation et le cache hors connexion.

Bibliothèques embarquées : PDF.js 6.3.289 (distribution legacy, Apache-2.0), pdf-lib 1.17.1 (MIT). Licences dans `vendor/`. Aucune dépendance à un CDN à l’exécution.

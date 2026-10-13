// The documentation site (GitHub Pages): role guides first, then the technical reference.
// Pages stay readable on GitHub too, so links between them are relative `.md` links.
import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

const repo = "https://github.com/FB-UNIV/trip-challenges";

// GitHub's heading anchors, so `page.md#section` links work both here and on github.com.
const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}\p{M}\- _]/gu, "").replace(/ /g, "-");

// Diagrams are ```mermaid blocks: rendered here by the plugin, and natively on github.com.
export default withMermaid(defineConfig({
  lang: "fr-FR",
  title: "PixExplore",
  description: "Défis photo pour les sorties scolaires, avec effacement vérifiable des données des élèves.",
  base: "/trip-challenges/",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["**/README.md"],
  markdown: { anchor: { slugify } },
  ignoreDeadLinks: "localhostLinks", // dev URLs in the development guide

  themeConfig: {
    nav: [
      { text: "Rôles", link: "/#qui-etes-vous" },
      { text: "Sécurité", link: "/securite/menaces" },
      { text: "Exploitation", link: "/deployment" },
      { text: "Code source", link: repo },
    ],

    sidebar: [
      {
        text: "Par rôle",
        items: [
          { text: "Enseignant", link: "/roles/enseignant" },
          { text: "Élève et familles", link: "/roles/eleve" },
          { text: "Chef d'établissement", link: "/roles/direction" },
          { text: "DPO et sécurité des données", link: "/roles/dpo" },
          { text: "Administrateur (exploitant)", link: "/roles/administrateur" },
        ],
      },
      {
        text: "Sécurité et RGPD",
        items: [
          { text: "Modèle de menaces", link: "/securite/menaces" },
          { text: "RGPD : fiche et note aux familles", link: "/rgpd" },
        ],
      },
      {
        text: "Exploitation",
        items: [
          { text: "Déploiement", link: "/deployment" },
          { text: "Durcissement pour la production", link: "/production-hardening" },
        ],
      },
      {
        text: "Développement",
        items: [
          { text: "Environnement de développement", link: "/development" },
          { text: "Glossaire du domaine", link: "/glossaire" },
          { text: "Modèle de données", link: "/data-model" },
          {
            text: "Décisions d'architecture (ADR)",
            collapsed: true,
            items: [
              { text: "0001 · Effacement cryptographique", link: "/adr/0001-crypto-erasure-with-vault-per-trip-keys" },
              { text: "0002 · Vote par paire", link: "/adr/0002-pairwise-voting-with-wilson-ranking" },
              { text: "0003 · Auto-hébergement", link: "/adr/0003-self-hosted-docker-compose-over-managed-ha" },
              { text: "0004 · L'établissement responsable", link: "/adr/0004-roster-import-school-as-controller" },
              { text: "0005 · Connexion via PocketID", link: "/adr/0005-teacher-auth-via-self-hosted-pocketid-oidc" },
              { text: "0006 · E-mails visibles des enseignants", link: "/adr/0006-teachers-read-student-emails-back" },
              { text: "0007 · Noms d'équipe vérifiés", link: "/adr/0007-team-names-survive-erasure-only-if-reviewed" },
            ],
          },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: repo }],
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: "Proposer une modification de cette page" },
    footer: {
      message: `Sous licence <a href="${repo}/blob/main/LICENSE">AGPL-3.0</a>. Vulnérabilité ? <a href="${repo}/security/advisories/new">Signalement privé</a>.`,
    },

    search: {
      provider: "local",
      options: {
        translations: {
          button: { buttonText: "Rechercher", buttonAriaLabel: "Rechercher" },
          modal: {
            noResultsText: "Aucun résultat pour",
            resetButtonTitle: "Effacer la recherche",
            backButtonTitle: "Fermer la recherche",
            displayDetails: "Afficher la liste détaillée",
            footer: { selectText: "choisir", navigateText: "naviguer", closeText: "fermer" },
          },
        },
      },
    },

    outline: { level: [2, 3], label: "Sur cette page" },
    docFooter: { prev: "Page précédente", next: "Page suivante" },
    lastUpdated: { text: "Mis à jour le" },
    darkModeSwitchLabel: "Apparence",
    lightModeSwitchTitle: "Passer au thème clair",
    darkModeSwitchTitle: "Passer au thème sombre",
    sidebarMenuLabel: "Menu",
    returnToTopLabel: "Retour en haut",
    langMenuLabel: "Langue",
    notFound: { title: "Page introuvable", quote: "Cette page n'existe pas ou a été déplacée.", linkText: "Retour à l'accueil" },
  },
  mermaid: { theme: "neutral" },
}));

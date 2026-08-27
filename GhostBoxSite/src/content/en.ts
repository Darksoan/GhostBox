import { DISCORD_URL, POLICY_PATHS } from "./links";
import type { SiteContent } from "./types";

export const en: SiteContent = {
  htmlLang: "en",
  meta: {
    title: "GhostBox — your Steam library, your way",
    description:
      "A desktop launcher that organizes your Steam library: catalogue, collections, achievements, downloads and cloud backup in a quiet dark interface.",
  },
  skipToContent: "Skip to content",
  nav: {
    brand: "GhostBox",
    links: [
      { label: "Features", href: "#recursos" },
      { label: "Premium", href: "#premium" },
      { label: "Install", href: "#instalacao" },
      { label: "FAQ", href: "#perguntas" },
    ],
    cta: "Download",
    menuOpen: "Open menu",
    menuClose: "Close menu",
    languageLabel: "Language",
  },
  hero: {
    eyebrow: "Windows launcher",
    title: "Your Steam library, organized your way",
    lead: "GhostBox brings catalogue, collections, achievements and downloads together in a dark interface that never competes with game art.",
    ctaPrimary: "Download for Windows",
    ctaSecondary: "See plans",
    note: "Free to use. Premium is optional.",
    mockupLabel: "Illustration of the GhostBox interface",
  },
  showcase: {
    title: "What you see when it opens",
    items: [
      {
        id: "library",
        eyebrow: "Library",
        title: "Every game on one surface",
        body: "Connected Steam accounts become a single library, with playtime, last session and full-resolution cover art.",
        bullets: [
          "Several Steam accounts in one list",
          "Instant search by title",
          "Collections and favorites you define",
        ],
      },
      {
        id: "catalogue",
        eyebrow: "Catalogue",
        title: "Discovery with filters that hold up",
        body: "Genre, tag, developer, publisher and year combine. Sort by popularity, recent additions or what people are playing right now.",
        bullets: [
          "Combined filters with a count per option",
          "Grid or list, your call",
          "Screenshot preview on hover",
        ],
      },
      {
        id: "achievements",
        eyebrow: "Achievements",
        title: "Progress you can see, game by game",
        body: "Each title shows completion, unlocked achievements and dates. Your profile gathers total playtime, 100% games and recent activity.",
        bullets: [
          "Completion per game",
          "Sort by most achievements or 100% games",
          "Steam metrics on your profile",
        ],
      },
    ],
  },
  features: {
    eyebrow: "Features",
    title: "Built for large libraries",
    lead: "Each tab solves one specific job, without burying what matters in menus.",
    items: [
      {
        icon: "LibraryBig",
        title: "Unified library",
        body: "Connect your Steam accounts and see everything in one list, with playtime and last session.",
      },
      {
        icon: "Compass",
        title: "Filtered catalogue",
        body: "Genre, tag, studio and year combine so the next game is a few clicks away.",
      },
      {
        icon: "Star",
        title: "Collections and favorites",
        body: "Build your own lists and mark favorites. The organization is yours, not the store's.",
      },
      {
        icon: "Trophy",
        title: "Achievements",
        body: "Track completion per game, rare achievements and your recent activity on the profile.",
      },
      {
        icon: "Download",
        title: "Downloads in the app",
        body: "Download, pause, resume and watch the queue and disk usage without leaving GhostBox.",
      },
      {
        icon: "Bell",
        title: "Notifications",
        body: "Backups, achievements, downloads and account alerts land in a single place.",
      },
    ],
  },
  sync: {
    eyebrow: "Cloud and backup",
    title: "Your saves stay yours",
    body: "GhostBox is local first: your organization lives on your machine. Turn the cloud on and saves and profile get a copy off the PC.",
    points: [
      {
        title: "Automatic save backup",
        body: "Restore points created in the background, with history so you can go back to an earlier version.",
      },
      {
        title: "Profile sync",
        body: "Favorites, collections and settings follow your account to another machine.",
      },
      {
        title: "You choose what leaves",
        body: "Nothing leaves your computer until you turn sync on.",
      },
    ],
  },
  premium: {
    eyebrow: "Premium",
    title: "Cloud backup for less than a coffee",
    lead: "GhostBox works for free. Premium unlocks automatic backup, sync and profile customization.",
    plans: [
      {
        id: "monthly",
        name: "Monthly",
        cadence: "per month",
        perMonth: "",
        benefits: [
          "Automatic save backup",
          "Profile and collection sync",
          "Custom cover and avatar",
          "Cancel anytime",
        ],
      },
      {
        id: "quarterly",
        name: "Quarterly",
        cadence: "every 3 months",
        perMonth: "{price} per month",
        highlight: "Best value",
        benefits: [
          "Everything in Monthly",
          "Around 28% cheaper",
          "One charge every three months",
          "Cancel anytime",
        ],
      },
    ],
    cta: "Subscribe in the app",
    ctaNote: "Subscriptions are handled inside GhostBox, under the Subscription tab in Settings.",
  },
  install: {
    eyebrow: "Install",
    title: "Three steps to first launch",
    steps: [
      {
        title: "Download the installer",
        body: "The latest file lives on the GitHub releases page.",
      },
      {
        title: "Run the installer",
        body: "Windows may ask for confirmation because the app is new. Allow it and continue.",
      },
      {
        title: "Connect your Steam account",
        body: "On first launch, link your account in Settings and the library fills itself in.",
      },
    ],
    cta: "Download for Windows",
    requirements: "Windows 10 or 11, 64-bit.",
  },
  faq: {
    eyebrow: "FAQ",
    title: "What people usually ask",
    items: [
      {
        question: "Does GhostBox replace Steam?",
        answer:
          "No. It organizes and complements your Steam library. Steam still runs and validates the games.",
      },
      {
        question: "Do I have to pay to use it?",
        answer:
          "No. Library, catalogue, collections, achievements, downloads and notifications are free. Premium covers cloud backup, sync and profile customization.",
      },
      {
        question: "Does my data leave my computer?",
        answer:
          "Only if you want it to. GhostBox is local first: your organization stays on your PC and the cloud only steps in once you turn sync on.",
      },
      {
        question: "Can I use more than one Steam account?",
        answer:
          "Yes. Connect several accounts and GhostBox merges them into a single library, without duplicating titles.",
      },
      {
        question: "How do I cancel Premium?",
        answer:
          "From the Subscription tab inside the app. Canceling stops future charges and access runs until the end of the paid period.",
      },
      {
        question: "Does it work on macOS or Linux?",
        answer: "Not yet. For now GhostBox is a Windows 10 and 11 application.",
      },
    ],
  },
  footer: {
    tagline: "GhostBox — your Steam library, your way.",
    legal: [
      { label: "Terms of service", href: POLICY_PATHS.terms },
      { label: "Privacy", href: POLICY_PATHS.privacy },
      { label: "Refunds", href: POLICY_PATHS.refund },
    ],
    social: [{ label: "Join the GhostBox Discord", href: DISCORD_URL, icon: "discord" }],
    rights: "GhostBox does not sell, distribute or modify games.",
  },
  policies: {
    terms: {
      slug: "terms",
      eyebrow: "GhostBox",
      title: "Terms of Service",
      paragraphs: [
        "GhostBox is a game library and progress management tool for games and applications that the user is authorized to run. GhostBox does not sell, distribute, provide access to, or modify games.",
        "GhostBox Premium is a subscription that provides optional features such as automatic save backups, restore points, and cloud sync. Access to Premium features may require an active subscription.",
        "Users are responsible for using GhostBox only with software and content they are legally allowed to access. Misuse of GhostBox or attempts to bypass third-party terms are not permitted.",
        "GhostBox may change, suspend, or discontinue features as the product evolves. Subscription terms are shown during Stripe Checkout before payment is completed.",
      ],
      back: "Back to GhostBox",
    },
    privacy: {
      slug: "privacy",
      eyebrow: "GhostBox",
      title: "Privacy Policy",
      paragraphs: [
        "GhostBox is designed as a local-first game management tool. Library organization data, local game entries, and local backups are handled on the user's device unless the user chooses to use cloud sync features.",
        "Payments are processed by Stripe. GhostBox does not store full card numbers or payment credentials. Stripe may process payment, billing, tax, and fraud prevention information according to Stripe's own policies.",
        "For Premium features, GhostBox may process account, subscription, and sync-related data needed to provide cloud backup and sync functionality.",
        "GhostBox does not sell personal data. Privacy-related questions can be handled through the support contact provided with the product.",
      ],
      back: "Back to GhostBox",
    },
    refund: {
      slug: "refund",
      eyebrow: "GhostBox Premium",
      title: "Refund Policy",
      paragraphs: [
        "GhostBox Premium is billed per period. Users may cancel their subscription to stop future renewals.",
        "Refund requests are reviewed case by case. If a technical issue prevents access to paid Premium features and cannot be resolved, a refund may be issued for the affected billing period.",
        "Refunds are processed through Stripe and may take several business days to appear depending on the payment method and bank.",
        "Because GhostBox Premium is a digital service, partial-period refunds are not guaranteed unless required by applicable law.",
      ],
      back: "Back to GhostBox",
    },
  },
};

// GERADO por GhostBoxSite/scripts/sync-games.mjs — não editar à mão.
// Fonte: https://piratebox-catalogue.hella.workers.dev/home (catálogo real do GhostBox).
// Gerado em 2026-08-27.

export interface SiteGame {
  appId: string;
  title: string;
  developer: string;
  genres: string[];
  tags: string[];
  release: string;
  /** Nota de 0 a 5 derivada da proporção de reviews positivas na Steam. */
  rating: string;
  /** Capa 460x215 (header.jpg da Steam), já convertida para webp. */
  header: string;
  /** Capa retrato 600x900 usada na Biblioteca. */
  portrait: string;
  /** library_hero.jpg — só o jogo do banner tem. */
  hero?: string;
  /** Descrição curta da Steam — só o jogo do banner tem. */
  description?: string;
  /** Capturas 16:9 — só o jogo da coluna de prévia tem. */
  screenshots?: string[];
}

export const games: SiteGame[] = [
  {
    "appId": "1086940",
    "title": "Baldur's Gate 3",
    "developer": "Larian Studios",
    "genres": [
      "Adventure",
      "RPG"
    ],
    "tags": [
      "RPG",
      "Character Customization",
      "Choices Matter"
    ],
    "release": "Aug 3, 2023",
    "rating": "4.8",
    "header": "/games/1086940-header.webp",
    "portrait": "/games/1086940-portrait.webp",
    "hero": "/games/1086940-hero.webp",
    "description": "Baldur’s Gate 3 is a story-rich, party-based RPG set in the universe of Dungeons & Dragons, where your choices shape a tale of fellowship and betrayal, survival and sacrifice, and the lure of absolute power."
  },
  {
    "appId": "292030",
    "title": "The Witcher 3: Wild Hunt",
    "developer": "CD PROJEKT RED",
    "genres": [
      "RPG"
    ],
    "tags": [
      "Open World",
      "RPG",
      "Story Rich"
    ],
    "release": "May 18, 2015",
    "rating": "4.8",
    "header": "/games/292030-header.webp",
    "portrait": "/games/292030-portrait.webp",
    "screenshots": [
      "/games/292030-shot1.webp",
      "/games/292030-shot2.webp"
    ]
  },
  {
    "appId": "1145360",
    "title": "Hades",
    "developer": "Supergiant Games",
    "genres": [
      "Action",
      "Indie"
    ],
    "tags": [
      "Action Roguelike",
      "Rogue-lite",
      "Hack and Slash"
    ],
    "release": "Sep 17, 2020",
    "rating": "4.9",
    "header": "/games/1145360-header.webp",
    "portrait": "/games/1145360-portrait.webp"
  },
  {
    "appId": "367520",
    "title": "Hollow Knight",
    "developer": "Team Cherry",
    "genres": [
      "Action",
      "Adventure"
    ],
    "tags": [
      "Metroidvania",
      "Souls-like",
      "Platformer"
    ],
    "release": "Feb 24, 2017",
    "rating": "4.9",
    "header": "/games/367520-header.webp",
    "portrait": "/games/367520-portrait.webp"
  },
  {
    "appId": "413150",
    "title": "Stardew Valley",
    "developer": "ConcernedApe",
    "genres": [
      "Indie",
      "RPG"
    ],
    "tags": [
      "Farming Sim",
      "Pixel Graphics",
      "Multiplayer"
    ],
    "release": "Feb 26, 2016",
    "rating": "4.9",
    "header": "/games/413150-header.webp",
    "portrait": "/games/413150-portrait.webp"
  },
  {
    "appId": "2050650",
    "title": "Resident Evil 4",
    "developer": "CAPCOM Co., Ltd.",
    "genres": [
      "Action",
      "Adventure"
    ],
    "tags": [
      "Horror",
      "Action",
      "Survival Horror"
    ],
    "release": "Mar 23, 2023",
    "rating": "4.9",
    "header": "/games/2050650-header.webp",
    "portrait": "/games/2050650-portrait.webp"
  },
  {
    "appId": "105600",
    "title": "Terraria",
    "developer": "Re-Logic",
    "genres": [
      "Action",
      "Adventure"
    ],
    "tags": [
      "Open World Survival Craft",
      "Sandbox",
      "Survival"
    ],
    "release": "May 16, 2011",
    "rating": "4.9",
    "header": "/games/105600-header.webp",
    "portrait": "/games/105600-portrait.webp"
  },
  {
    "appId": "264710",
    "title": "Subnautica",
    "developer": "Unknown Worlds Entertainment",
    "genres": [
      "Adventure",
      "Indie"
    ],
    "tags": [
      "Open World Survival Craft",
      "Survival",
      "Horror"
    ],
    "release": "Jan 23, 2018",
    "rating": "4.9",
    "header": "/games/264710-header.webp",
    "portrait": "/games/264710-portrait.webp"
  },
  {
    "appId": "294100",
    "title": "RimWorld",
    "developer": "Ludeon Studios",
    "genres": [
      "Indie",
      "Simulation"
    ],
    "tags": [
      "Colony Sim",
      "Base-Building",
      "Survival"
    ],
    "release": "Oct 17, 2018",
    "rating": "4.9",
    "header": "/games/294100-header.webp",
    "portrait": "/games/294100-portrait.webp"
  },
  {
    "appId": "588650",
    "title": "Dead Cells",
    "developer": "Motion Twin",
    "genres": [
      "Action",
      "Adventure"
    ],
    "tags": [
      "Adventure",
      "Action Roguelike",
      "Metroidvania"
    ],
    "release": "Aug 6, 2018",
    "rating": "4.9",
    "header": "/games/588650-header.webp",
    "portrait": "/games/588650-portrait.webp"
  },
  {
    "appId": "2379780",
    "title": "Balatro",
    "developer": "LocalThunk",
    "genres": [
      "Casual",
      "Indie"
    ],
    "tags": [
      "Card Game",
      "Roguelike Deckbuilder",
      "Rogue-like"
    ],
    "release": "Feb 20, 2024",
    "rating": "4.9",
    "header": "/games/2379780-header.webp",
    "portrait": "/games/2379780-portrait.webp"
  },
  {
    "appId": "526870",
    "title": "Satisfactory",
    "developer": "Coffee Stain Studios",
    "genres": [
      "Adventure",
      "Indie"
    ],
    "tags": [
      "Base-Building",
      "Automation",
      "Open World"
    ],
    "release": "Sep 10, 2024",
    "rating": "4.9",
    "header": "/games/526870-header.webp",
    "portrait": "/games/526870-portrait.webp"
  },
  {
    "appId": "1794680",
    "title": "Vampire Survivors",
    "developer": "poncle",
    "genres": [
      "Action",
      "Casual"
    ],
    "tags": [
      "Action Roguelike",
      "Bullet Hell",
      "Pixel Graphics"
    ],
    "release": "Oct 20, 2022",
    "rating": "4.9",
    "header": "/games/1794680-header.webp",
    "portrait": "/games/1794680-portrait.webp"
  },
  {
    "appId": "322330",
    "title": "Don't Starve Together",
    "developer": "Klei Entertainment",
    "genres": [
      "Action",
      "Adventure"
    ],
    "tags": [
      "Survival",
      "Open World Survival Craft",
      "Multiplayer"
    ],
    "release": "Apr 21, 2016",
    "rating": "4.8",
    "header": "/games/322330-header.webp",
    "portrait": "/games/322330-portrait.webp"
  },
  {
    "appId": "227300",
    "title": "Euro Truck Simulator 2",
    "developer": "SCS Software",
    "genres": [
      "Indie",
      "Simulation"
    ],
    "tags": [
      "Driving",
      "Transportation",
      "Simulation"
    ],
    "release": "Oct 12, 2012",
    "rating": "4.9",
    "header": "/games/227300-header.webp",
    "portrait": "/games/227300-header.webp"
  },
  {
    "appId": "239140",
    "title": "Dying Light",
    "developer": "Techland",
    "genres": [
      "Action",
      "RPG"
    ],
    "tags": [
      "Zombies",
      "Survival Horror",
      "Horror"
    ],
    "release": "Jan 26, 2015",
    "rating": "4.8",
    "header": "/games/239140-header.webp",
    "portrait": "/games/239140-portrait.webp"
  },
  {
    "appId": "620",
    "title": "Portal 2",
    "developer": "Valve",
    "genres": [
      "Action",
      "Adventure"
    ],
    "tags": [
      "Platformer",
      "Puzzle",
      "First-Person"
    ],
    "release": "Apr 18, 2011",
    "rating": "4.9",
    "header": "/games/620-header.webp",
    "portrait": "/games/620-portrait.webp"
  },
  {
    "appId": "550",
    "title": "Left 4 Dead 2",
    "developer": "Valve",
    "genres": [
      "Action"
    ],
    "tags": [
      "Zombies",
      "Co-op",
      "FPS"
    ],
    "release": "Nov 16, 2009",
    "rating": "4.9",
    "header": "/games/550-header.webp",
    "portrait": "/games/550-portrait.webp"
  }
];

export const bannerGame: SiteGame =
  games.find((game) => game.hero) ?? games[0];

export const previewGame: SiteGame =
  games.find((game) => game.screenshots?.length) ?? games[0];

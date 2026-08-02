# PROTOTYPE — GhostBox horizontal catalogue shelves

Throwaway. Not wired into the app. These options are focused on horizontal
Netflix-style shelves inside the existing Catálogo surface. They use large
16:9 screenshot cards, secondary screenshot bands and lateral shelf controls.

The **Prateleiras** option also ends with the regular Catálogo archive: a
vertical result list on the left and collapsible filters on the right. The
Cinema and Por clima options remain shelf-only. None of the options includes
player ranking or CCU/player-count content. All game media and text bodies are
local skeleton placeholders; the prototype does not fetch or render
`data.json`.

## Run

```text
cd prototypes/catalogue-layouts
python -m http.server 8080
```

Open http://localhost:8080

## Variants

- **01 — Prateleiras**: classic Netflix-style rails organized by discovery
  intent, with a large hero, mostly 16:9 screenshot cards and the archive
  list/filter area at the end.
- **02 — Cinema**: larger feature cards and screenshot bands create a more
  editorial, cinematic browsing rhythm.
- **03 — Por clima**: lightweight intent chips lead to contextual shelves for
  moods and play situations without introducing a result list.

Switch with the bottom bar, arrow keys, or `#rails`, `#cinema`, and `#moods`.
The rational toggle, shelf controls, card clicks and intent chips are local
prototype interactions.

Once one wins, fold the chosen hierarchy into `src/components/catalogue/`;
do not ship this standalone HTML as production.

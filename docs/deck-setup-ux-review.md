# Deck discovery and match setup review — 15 October 2026

Tiny Fish reviewed the signed-in production app read-only:
[review run](https://agent.tinyfish.ai/runs/d0926c12-fd3d-4fe3-9d1e-adb770709416).
It inspected Decks, deck details, My leaders and Arena setup. It made no deck writes, AI calls,
invites or match starts. Desktop was observed; the tool could not resize, so its phone claims
were inferred. Local Chrome emulation supplies separate 390 px evidence, not physical-device proof.

## Confirmed findings and decisions

- Arena deck names and opponent options truncate, including Cooler Armored Squadron Field Loop,
  Universe 2 Maiden Squadron Formation Control, Gogeta Situation Reversal and multiple Vegito lists.
  Show wrapping names and separate leader identities; retire the opponent's unfiltered dropdown.
- The 28-deck library has game and built/virtual filters, but no text/strategy search. Descriptions
  are absent from library cards and Arena even though `listDecks` already returns them.
  Search name, leader name/number and description; offer colour, exact leader and type filters
  before a bounded list. Show saved descriptions and allow reading the complete text.
- Descriptions in a deck's details are hidden inside an edit disclosure. Show a read-only preview
  alongside the heading. Missing descriptions need an explicit fallback, not invented strategy.
- My leaders offers game and colour filtering but lacks text, set and deck-availability filters.
  Search linked deck names/descriptions too and show those descriptions beside linked decks.
- The owner additionally requests a full-screen phone creation wizard: Your deck → Opponent →
  Review and start. Back keeps deck choices. Desktop shows both sides together. Only the final
  phone step can start a match. Keep costs, friend modes, locks and the server action contract.
- Each side gets its own filters. Filtering does not change its selected ID. Show six results
  initially and an explicit more action. Default opponent browsing to ready rules; preserve mirror
  matches. A friend on their own device chooses their own deck after joining.
- Device setup resolves a leader through the pack's definition map (the deck stores a leader ID,
  not an object). It uses local card names/colours and the saved card list. The pack deliberately
  contains no deck descriptions; say so without fetching data or changing the pack format.

## Findings not adopted as diagnosed bugs

Tiny Fish reported mixed Fusion World decks in Arena, but the server explicitly queries `dbs`;
Masters-only is intentional. It suggested adding a subtitle that already existed but was truncated;
wrapping fixes the actual issue. It inferred a two-column phone leader layout, while the code
already stacks below `sm`. Its reportedly blank deck-detail left panel was not independently
reproduced, so it is not treated as a diagnosed rendering failure here. Suggestions to change AI
button prominence, awakened-face controls or archive unfinished decks are outside this issue.

## Delivery

[Milestone 24](https://github.com/uhtred1986-lab/trading-card-management/milestone/24),
[issue #828](https://github.com/uhtred1986-lab/trading-card-management/issues/828).
One branch and draft PR. No dependencies, migrations, rules-engine changes or production writes.

Validation and screenshot evidence are recorded in `docs/deck-setup-validation.md`.

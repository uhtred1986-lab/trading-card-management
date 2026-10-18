# Arena keyword rendering (design reference)

Published: https://claude.ai/artifact/LfeZ5wez4Uysj4s7cSgi5F. `index.html` is the same page (open it in a browser;
it is written without a doctype because the artifact host adds one).

Owner's direction (19 Oct 2026): keywords mean the same thing every time they are printed, so the card reader should
not spend a text row on them. Evolve's reminder belongs behind expand; Double Strike always means the same.

The page sorts all 39 keywords in `src/lib/arena/glossary.ts` into five classes: badge, badge with values, skill row,
condition and deck rule. For each class it says how the reader, board card, hand, desktop inspector and clash panel
show it, with catalog counts (Masters catalog, deckplanet, 18 Oct 2026) for how often each keyword is printed and in
how many wordings. Not built yet: the "What changes in the app" section lists the files a build would touch.

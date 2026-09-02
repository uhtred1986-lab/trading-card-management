# DBS Card Game Companion App — Feature Summary

**Scope:** Dragon Ball Super Card Game — Legacy (BT/TB/EB sets, 2017–2024) + Masters (current, B-series). Fusion World is a separate product line and is explicitly out of scope.

**Stack:** Vercel (hosting/API routes) + Neon (serverless Postgres) for the backend and database.

**UI:** Responsive web app — built and tested for both phone-screen and desktop-screen layouts from the start, not a desktop-only design retrofitted later. Card-heavy views (collection grid, deck builder, mass-add review screen) are the ones most likely to need distinct mobile vs. desktop layouts (e.g. single-column card list with larger tap targets on phone vs. multi-column grid on desktop); scanning/photo-capture flows are naturally phone-first but should still be usable from a desktop file upload.

---

## 1. Collection Management

- **Card catalog**: cached locally from open data sources (see §7), refreshed on a schedule. Not queried live from third parties on every screen load.
- **Owned cards**: per card, track quantity, condition, foil/parallel/print variant, language, date acquired, price paid.
- **Price per card**: each owned card shows its current market value (from cached pricing data) alongside what you paid for it — gain/loss at a glance, per card and rolled up across the whole collection.
- **Collection value**: aggregate dashboard — total spent vs. total current value, biggest movers, breakdown by set/rarity.
- **Card images**: the collection always displays the clean, canonical card image from the catalog — never the user's scan photo. Scan/upload photos exist only transiently, to identify *which* card it is; once matched, the app stores a reference to the catalog's image (CardTrader blueprints expose an `image_url` per blueprint, and the primary card catalog source has images too), not the photo itself. Simplest approach: on first reference to a given card, fetch its canonical image once and cache/host it (e.g. Vercel Blob or any object storage) rather than hotlinking indefinitely or re-fetching per view.

### Mass Add — two paths, for two different physical workflows

**Path A: Batch photo scan.** You lay out a pile, a binder page, or a fan of cards and take one photo; the app detects and identifies every card in the frame in one pass, not one photo per card. This is a meaningfully different (and harder) computer-vision problem than the single-card scan described in §6 — it needs object detection to first find and crop each card in the frame, *then* identify each crop. Three realistic options:

  - **DIY**: a general object-detection model (e.g. YOLO, fine-tuned or even zero-shot on "card-shaped rectangle") to find card boundaries, then your existing single-card OCR/pHash pipeline per crop. Most control, most work, no per-call cost once built.
  - **Ximilar** (Collectibles Recognition API): purpose-built for exactly this — detects and identifies multiple cards in one photo, Dragon Ball Super explicitly supported, confidence-tiered results. Has a free tier to prototype with, though full production use needs a paid Business-tier plan. The strongest option specifically for the multi-card-per-photo case, since it does detection *and* identification in one call.
  - **Claude's vision (via the API tokens you're already using for deck analysis)**: Claude can read a card image directly and identify what's on it — no separate OCR step needed for a *single well-cropped card*. For a photo with several cards in frame, you can ask it to list everything it sees, and it'll often do a reasonable job on a small, well-lit, non-overlapping layout — but it isn't a specialized object detector, doesn't reliably return precise crop coordinates the way Ximilar's detection step does, and accuracy drops as card count, clutter, or overlap increases. It bills as ordinary API image tokens (roughly proportional to image resolution — cost scales with pixel count, and exact current per-model rates are worth checking at platform.claude.com/docs since they change), with no separate account tier required. Good fit for single-card scans and as a fallback identifier when the catalog match comes back low-confidence; less reliable as the primary engine for the binder-page/pile case.

  Realistic split: use Claude's vision for single-card scans (§6) and low-confidence fallback, and prototype Ximilar's free tier specifically for the multi-card batch case before deciding whether it's worth a paid plan. Either way, batch scan should land on a **review screen** — thumbnail of each detected card with its best-guess match — before anything is committed to inventory, since multi-card detection has a higher misread rate than single-card scans (glare, overlap, angled cards). Once confirmed, the record stores the catalog's canonical image, not the scan crop — see "Card images" above.

**Path B: Manual bulk entry form.** For when you've already sorted the physical cards yourself (e.g. by set) and just need a fast keyboard-driven way to log them: a table-style form where each row is a fuzzy-search field against your local catalog (type a few letters of the name or card number, pick from matches) plus quantity/condition/foil, and hitting Enter commits the row and opens a new one. No photos, no CV pipeline — just fast, accurate, keyboard-only data entry for when scanning would be slower than typing.

## 2. Deck Management — Virtual vs. Built

This is the core mechanic that makes your inventory meaningful, so it's worth spelling out precisely:

- **Virtual decks**: unlimited. Any deck you're theorycrafting, testing, or saving as an idea can reference any card in the catalog regardless of what you own. No ownership constraint.
- **Built decks**: a deck flagged "Built" represents a physical, playable stack of cards. The moment a deck is marked Built:
  - Every copy of every card in that deck is treated as **reserved**.
  - A card's total reserved count across all Built decks cannot exceed the quantity you actually own.
  - If you try to mark a second deck as Built and it would push a shared card's reserved count over your owned quantity, the app blocks it and shows exactly which card(s) are the conflict.
- **Allocation view**: for any card, the UI shows *owned* / *reserved across Built decks* / *available*. This is what makes "unlimited virtual, limited physical" work — it's a reservation system layered on top of your existing inventory count, not a separate object.
- **Un-building** a deck releases its reservations immediately, freeing those copies for another Built deck.

## 3. AI Deck Analysis (Claude API)

- **Deck summary, on save or on request**: Claude reads the decklist plus card text/attributes from your catalog and produces a short writeup — the deck's archetype, its game plan, and what it's strong or weak against. No forum scraping involved; it reasons from card data you already control.
- **Deck Improvement Wizard** (separate flow, triggered on request, not automatic):
  1. Claude is given the current decklist, the card pool it's allowed to draw from (optionally scoped to "cards I own" vs. "any legal card"), and any meta notes you maintain.
  2. It returns a list of suggested swaps, each as an explicit **replace X → with Y** pair with a short rationale.
  3. The UI shows each suggestion as a card-for-card replacement — the outgoing card and incoming card side by side — rather than just a bare list of additions, so you can accept/reject swaps individually.
  4. Each suggestion is flagged **owned** or **needs to be acquired**, using your collection data — so the wizard doubles as a soft shopping list.
- **New set review, on request**: feed Claude the new set's card list when it's added to your catalog; it returns standout cards and likely archetype impacts.

## 4. Marketplace & Price Sourcing

A few things worth knowing before you commit to an integration:

| Marketplace | Official API status | Notes for this project |
|---|---|---|
| **TCGplayer** | Closed to new developer applications | Use the community mirror **tcgcsv.com** instead (free, daily-updated, no key) — covers category 27 "Dragon Ball Super: Masters" (legacy + current). |
| **Cardmarket** | Officially closed — "we are not accepting applications for access to the Cardmarket API" | No compliant direct integration available right now for a new app. Don't scrape it directly; see alternatives below. |
| **CardTrader** ⭐ | Open, documented public API (`cardtrader.com/en/docs/api`) | EU-based (Italy), explicitly lists Dragon Ball Super in its supported games, and as an EU marketplace should ship to Austria without the friction of a US-based seller. **Best direct integration candidate — recommend building against this first.** |
| **eBay** | Open, official API | Useful supplementary source; DE/AT-based sellers show up regularly for DBS singles. Ships-to-Austria and seller location are both queryable fields. |
| **TCGRepublic** | No public API found | Japan-based shop, ships internationally including to Austria; good for Japanese-language singles. Would need manual/scraped integration or periodic manual price checks — lower priority. |

### Cardmarket alternatives, ranked

1. **CardTrader (direct)** — your primary recommendation. Open API, official, no waitlist, EU-based, DBS explicitly supported. Build the cart optimizer against this first and treat everything else as supplementary.
2. **eBay (direct)** — official API, filter by item location/ships-to-country. Wider net of individual/casual sellers than CardTrader, noisier data (inconsistent condition/listing quality), but genuinely useful for cards CardTrader doesn't have listed.
3. **A paid multi-marketplace aggregator** (e.g. tcgapis.com) — claims compliant access to Cardmarket and CardTrader listings behind one API, which would close the Cardmarket gap without you scraping anything. Not yet confirmed reliable for this use case — email their support and specifically ask whether **seller shipping-country** is a field on their Cardmarket listings endpoint before subscribing, since that's the one thing this entire feature depends on.
4. **Cardmarket itself, manually** — not an integration at all, but worth keeping in mind as a fallback: since Cardmarket is the dominant TCG exchange in the DACH region, for cards you can't find priced elsewhere the app could simply deep-link out to a pre-filled Cardmarket search rather than trying to pull their data in. Lower-effort, no ToS risk, just less automated.

## 5. On-Demand Pricing & Shopping Cart Optimizer (CardTrader)

Building against CardTrader's actual API (`api.cardtrader.com/api/v2`, Bearer token auth). Confirmed relevant pieces:

- `GET /marketplace/products?blueprint_id=X` returns up to the 25 cheapest live listings for a card — price, quantity, condition, and a `user` object with `country_code`, `can_sell_via_hub` (CardTrader Zero fulfillment), `on_vacation`, and `max_sellable_in24h_quantity`. This is the core data source for both pricing and "most stock."
- Rate limit on that endpoint is **10 requests/second**, 200/10s overall — fine for on-demand, single-card, or single-deck lookups; a full-collection pass needs throttling and should run as a background job with a progress indicator, not a blocking request.
- Blueprints cross-reference `tcg_player_id` and `card_market_ids` — meaning once you match a CardTrader blueprint to a card, you get free deep-link IDs into both TCGplayer and Cardmarket's product pages, even without a Cardmarket API integration (see §4 fallback).
- CardTrader has its **own native "Shop Optimizer"** (cardtrader.com/en/wishlists/new) that solves basically this exact problem — cheapest multi-seller combination for a wishlist — but it's a website feature; the public API only exposes wishlist CRUD (`GET/POST/DELETE /wishlists`), not a documented "optimize" endpoint. So the optimization logic still needs to be built in your app using `/marketplace/products` data, though it's worth linking out to their native optimizer as a manual cross-check.

**On-demand scopes**, all manually triggered — matches what you asked for, nothing runs automatically:

| Trigger | What happens |
|---|---|
| Single card | One `/marketplace/products` call, results shown inline (sellers, price, stock, country). |
| Single deck | One call per unique card in the deck; cheap for a 40–60 card deck, completes in a few seconds. |
| Multiple selected cards | Same as deck, scoped to your selection (e.g. a want-list). |
| Whole collection | Same call, batched across the whole catalog at the 10/sec ceiling — for a few hundred cards this takes tens of seconds to a couple minutes. Run as a background job with progress, not inline; results are cached with a timestamp so you're not forced to redo it next time. |

**The optimizer itself** (deterministic, not AI): given the listings pulled above, "cheapest combination of sellers to cover a multi-card cart, respecting per-seller shipping and stock limits" is a set-cover/bin-packing problem — a small solver (greedy heuristic, or an exact ILP solver like OR-Tools) gets the arithmetic right across dozens of listings; an LLM asked to do this math directly is more likely to silently miscalculate.

**Claude's actual role**: explain the solver's output in plain language ("this 3-seller split saves €4 over the 2-seller one but adds a second shipping fee — here's the breakeven"), apply soft preferences you've stated ("prefer fewer sellers unless it costs more than €2"), and flag cards with no current Austria-shipping listing.

**Shipping-to-Austria specifics**: `GET /shipping_methods?username=X` returns real shipping options and costs from a specific seller to you, but it's a per-seller call — don't call it for every listing in a search result, only for the sellers your optimizer has shortlisted as candidates, to stay well under rate limits.

**Bonus, not in scope yet**: the same API also supports `/cart/add` and `/cart/purchase` — meaning an actual "buy this combo directly" button is technically possible down the line, not just a price comparison. Worth keeping in mind for a later phase, but starting with read-only pricing is the right first step.

## 6. Card Scanning

Two distinct flows, sharing the same downstream matching logic:

- **Single-card scan**: camera capture → crop → identify (either classical OCR, or send the crop straight to Claude's vision and skip a separate OCR step) → fuzzy match against your local catalog → perceptual-hash fallback for foils/glare → one-tap confirm into inventory. On confirm, the crop is discarded and the catalog's canonical image is what gets stored and shown — the scan photo's only job was identification.
- **Batch/mass scan**: see §1 "Mass Add" above — same matching pipeline, but preceded by a detection step that finds multiple card boundaries in one photo first.

Both are only matching against categoryId 27's card pool (legacy + Masters), not also Fusion World, which keeps the matching space smaller and reduces false-positive risk versus a generic card scanner.

## 7. Data Sources Summary

| Purpose | Source | Access |
|---|---|---|
| Card catalog (names, text, sets) | `dragogodev/cgs` GitHub repo — `Dragon Ball Super/cgs.json` | Free, static JSON |
| Card list cross-check / errata | `dbs-cardgame.com/us-en/cardlist` | Official, no API — manual/scrape-lightly for verification only |
| Pricing (primary) | tcgcsv.com, TCGplayer categoryId 27 | Free, daily CSV/JSON, no key |
| Pricing (backup/queryable) | tcgapi.dev | Free tier + paid |
| EU marketplace listings + live pricing | CardTrader API (`GET /marketplace/products`) | Free, official, open signup, 10 req/s |
| EU marketplace listings (Cardmarket) | Pending — confirm via aggregator or direct Cardmarket contact | Not directly available to new apps |
| Single-card & fallback image recognition | Claude vision (Anthropic API) | Pay-per-token, no separate account tier |
| Batch/multi-card photo recognition (optional, buy vs. build) | Ximilar Collectibles Recognition API | Free tier to prototype; Business-tier plan for production |

---

## Open Questions Before Building

1. Confirm with a Cardmarket/aggregator support contact whether shipping-country/seller-location data is actually exposed per listing — this gates any Cardmarket-side cart data (CardTrader itself doesn't have this gap).
2. Decide the "Built deck" conflict UX in more detail: block outright, or allow with a warning and a visible deficit count?
3. Decide how much of the AI deck analysis should be scoped to "cards I own" by default vs. always showing the theoretically-best list.
4. Build a crosswalk between your local card catalog and CardTrader `blueprint_id`s — match on name + collector number + expansion code, or via the `tcg_player_id` field on CardTrader blueprints if it lines up with your tcgcsv.com `productId`s (would make this a clean join instead of fuzzy matching).
5. Decide the exact solver approach for the optimizer (greedy heuristic vs. a proper ILP solver like OR-Tools) once real cart sizes are known — greedy is faster to ship, ILP guarantees the actual cheapest combination.

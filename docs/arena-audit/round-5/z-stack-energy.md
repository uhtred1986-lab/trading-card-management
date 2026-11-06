# R455 — combined-energy Z-Stack condition

BT21-074's exact wording “You and your opponent have a total of 4 or more energy” now uses the existing `count` condition over both Energy Areas. It is an alias of the already-supported “energy between you and your opponent” wording; no runtime, schema, payment or Z-Stack procedure changes were made.

RM 22-47-1 identifies Z-Stack as an Auto keyword; 22-47-2 allows its printed skill cost, 22-47-3 defines its pending arrival, and 22-47-4 permits up to the printed count of qualifying cards from your Z-Deck. The current public area counts use R385's observation semantics. Both Active and Rest energy count; cards in Z-Energy or other areas and energy markers are not cards in those Energy Areas.

BT21-074 has no own-card FAQ. Its official erratum changes the separate Permanent to “this card’s skills can’t be negated”; the fixture uses `correctSkillText`, retaining that correction. The erratum does not change Z-Stack's condition. The sibling departure-replacement line remains unread and is expressly asserted unchanged by the fixture.

Evidence lives under `/workspace/shared/arena-support5/conditions-r455/`. Recovery catalog input is the same 6,597-card input used for R452, SHA256 `d3646487f34749d905a65b2473f21aee7984e4aac640c631bc0deb319e512bfb`; it is not claimed equivalent to the lost older snapshot. The full-record comparison uses `conditions-r452/after-full.json` as its immediate compiler baseline. Exactly one of 13,964 records changes: BT21-074#10, cost only. The printed text, body, all sibling skills and every other record remain identical.

Validation:

- `native.log`: 28 both-seat stored native Z-Battle/Z-Stack cases plus two current-count/reload controls. Totals below/equal/above four, both-side distributions, Rest energy after payment, nonzero energy markers excluded, protected energy counted, wrong areas, wrong color/name/type/side candidates, optional decline, and serialization are covered. Direct language roundtrip and equivalent comparison-word aliases are checked.
- `conditions1.log`: 77 records and 40 VM cases.
- `phrasing2.log`: 52 record cases and 20 both-seat reload cases.
- `battles.log`: existing native battles/Z-Stack regression suite.
- `language.log`, `teach.log`, `rulings.log`: language, Teach and ledger validation.
- `type-final.log`, `lint-final.log`: typecheck and changed-file lint.

No database refresh, build, full gate, dependency installation or paid operation was run. This closes one keyword price condition, not every skill on BT21-074.

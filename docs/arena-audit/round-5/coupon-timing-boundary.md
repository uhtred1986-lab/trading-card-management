# Card-energy coupon scope boundary (R447)

P-524 Q1 explicitly excludes Activate:Main/Battle from its Activate:Main coupon; Q2 explicitly includes a blue Field Extra. EX25-013 has no own FAQ. The existing general card-energy modifier discarded the named skill kind/timing and could discount a Counter or another activation. The compiler now refuses explicit skill-kind card-energy coupons until payment eligibility and use consumption carry that scope. Ordinary card-use/play energy coupons and scoped skill-cost coupons retain their existing behavior.

This is an intentionally temporary refusal. Exact Main eligibility, Field inclusion and actual coupon consumption are the next implementation task. It does not reinterpret Main as Main/Battle.

Offline full-record comparison on the recovered 6,597-card input changes only EX25-13#20 and P-524#10 body operations, unread clauses, pattern and reading. Both coupon clauses remain unread; other operations and costs are unchanged. The comparison baseline contains concurrent R445 descriptor work, so P-524 was readable there; on the parent baseline its price already remains unread. No other record changes, including bare Activate or Main/Battle coupon forms, occurred when broadening the guard to every explicit skill kind.

Evidence: `/workspace/shared/arena-support5/conditions-r447/{after-full.json,full-record-diff.json,own-faq.json}`. The recovered catalog is not claimed byte-identical to the earlier lost snapshot.

Checks: focused printed and synthetic scope tests; cost-reductions-907; audit-effects-2 (82 records, 10 both-seat VM cases); rulings; typecheck; eslint on changed files. No database, full gate, build or dependency installation.

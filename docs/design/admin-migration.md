# Admin and account UI migration

This workstream migrated the assigned server-rendered screens to the shared themed page surfaces while retaining their existing data reads, server actions, form posts, route destinations and authorization checks.

| Route | Status | Preserved behavior |
|---|---|---|
| `/settings` | Migrated | SL-only settings, appearance cookie action, lighting controls, sync actions/history, provider settings, integration status, sign-out and links to locations and access. Appearance, AI and sync anchors remain on this route. |
| `/settings/locations` | Migrated | SL guard, location read and `LocationsAdmin` editing/archive behavior. |
| `/settings/access` | Migrated | SL guard, player/SL roster, join codes, device management, ownership reassignment and legacy-login link. |
| `/settings/users` | Migrated | SL guard and legacy password login management. |
| `/login` | Migrated | Public page; Google, password-login and join links plus existing error messages. |
| `/join` | Migrated | Public page; rate-limited code preview and existing `/api/join` form post. |
| `/me` | Migrated | Signed-in player guard, SL redirect, device list/revoke and sign-out. |
| `/sets/[code]/review` | Migrated | SL guard, set lookup, saved review display and existing AI review action. |
| `/arena/rules` | Migrated | SL guard and existing workbench/query behavior; shared navigation added for existing rules destinations. |
| `/arena/rules/review` | Migrated | SL guard and existing scoped review queue. |
| `/arena/rules/keywords` | Migrated | SL guard and glossary-backed keyword reference. |
| `/arena/rules/language` | Migrated | SL guard and schema-backed language reference. |
| `/arena/rules/game` | Migrated | SL guard and loaded ruleset reference. |
| `/arena/rules/patterns` | Intentionally excluded | Guarded compatibility redirect into the workbench queue; removed from navigation so it does not appear as a duplicate destination. |
| `/arena/rules/all` | Intentionally excluded | Existing redirect into the workbench remains as-is. |
| `/arena/rules/build/[id]` | Migrated frame | The contextual rule editor keeps its focused layout; shared page header added, existing rule read, guard and save capability check preserved. |
| `/arena/rules/build/preview` | Migrated frame | Shared headers/panels added around the synthetic editor and record; SL and development-only guards retained. |
| `/arena/rules/review/preview` | Migrated frame | Shared header/panel added around the synthetic explanation preview; SL and development-only guards retained. |
| `/arena/review` | Migrated | SL and arena-admin guards, seat filtering and development-only fixture preview guard/data behavior. |
| `/arena/testing` | Migrated | SL guard, dashboard filters, evidence data and existing testing portal. |
| `/arena/testing/runs/[id]` | Migrated | SL guard, imported-run detail lookup, fixture/outcome filters, paging, score tables and evidence digest display. |
| `/arena/[id]/debug` | Migrated | SL and arena-admin guards, versus seat restriction and all decision details. |

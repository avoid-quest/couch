# First-use review and fixes

Snapshot inspected 2026-09-14. All six PR heads matched local stack branches. REST issue comments, submitted reviews and inline comments were fetched with per_page=100 and pagination; GraphQL review threads and nested comments were independently paginated. Resolved/outdated threads were included without filtering. At this snapshot all 24 threads were unresolved and current.

The [React assessment](../research/first-use-react-2026-09-14.md) records installed versions, official guidance and the tooling decision. This report continues the [earlier qualification](first-use-2026-09-14.md); its rollout limits still apply.

## Initial heads

| PR | Branch | Head |
| --- | --- | --- |
| [#268](https://github.com/avoid-quest/couch/pull/268) | `fcastrovilli/first-use/design-rule` | `b5b7f70089b2d443d7af949ad49125dacc5f34af` |
| [#269](https://github.com/avoid-quest/couch/pull/269) | `fcastrovilli/first-use/sharing` | `4bb6909785dfc9c8dc234c77c8b55326aaad5d99` |
| [#270](https://github.com/avoid-quest/couch/pull/270) | `fcastrovilli/first-use/radio` | `beb15145f891ff5a350c2c2ea539ac9a0719f432` |
| [#271](https://github.com/avoid-quest/couch/pull/271) | `fcastrovilli/first-use/discovery` | `6f65c081db579037ed8957f4da8d5c1fc759b163` |
| [#272](https://github.com/avoid-quest/couch/pull/272) | `fcastrovilli/first-use/modes` | `0b2293d5f2479175b6206113430cbbe3a94c2829` |
| [#273](https://github.com/avoid-quest/couch/pull/273) | `fcastrovilli/first-use/experience` | `6b7c04806f8a77f2a68a3c708b0840249defa139` |

## Every review item

| PR | Item | Disposition | Evidence and action |
| --- | --- | --- | --- |
| #268 | [comments 5667871940](https://github.com/avoid-quest/couch/pull/268#issuecomment-5667871940) | Non-actionable | Automated review status only; the submitted inline findings are each accounted for below. |
| #268 | [comments 5668218482](https://github.com/avoid-quest/couch/pull/268#issuecomment-5668218482) | Non-actionable | Historical Cloudflare build/deployment status, with no requested code change. This task does not run deployment. |
| #269 | [comments 5668440740](https://github.com/avoid-quest/couch/pull/269#issuecomment-5668440740) | Non-actionable | Automated review status only; the submitted inline findings are each accounted for below. |
| #269 | [comments 5668565917](https://github.com/avoid-quest/couch/pull/269#issuecomment-5668565917) | Non-actionable | Historical Cloudflare build/deployment status, with no requested code change. This task does not run deployment. |
| #269 | [reviews 5201230037](https://github.com/avoid-quest/couch/pull/269#pullrequestreview-5201230037) | Non-actionable | Automated review status only; the submitted inline findings are each accounted for below. |
| #269 | [inlineComments 4008146031](https://github.com/avoid-quest/couch/pull/269#discussion_r4008146031) | Already addressed | App passes the Settings callback, gates the shortcut and PairingDialog on sharing, and mounts LocalSharingPrompt. Combined #273 integration. |
| #269 | [inlineComments 4008146042](https://github.com/avoid-quest/couch/pull/269#discussion_r4008146042) | Non-actionable | Accepted #258 explicitly permits removing the last Administrator and requires subsequent Controllers while any remembered remotes remain. Native local management is the recovery path. Headless/old-POC migration is outside the accepted target. |
| #270 | [comments 5668442293](https://github.com/avoid-quest/couch/pull/270#issuecomment-5668442293) | Non-actionable | Automated review status only; the submitted inline findings are each accounted for below. |
| #270 | [reviews 5201235965](https://github.com/avoid-quest/couch/pull/270#pullrequestreview-5201235965) | Non-actionable | Automated review status only; the submitted inline findings are each accounted for below. |
| #270 | [inlineComments 4008151572](https://github.com/avoid-quest/couch/pull/270#discussion_r4008151572) | Actionable | Page activity is wired in #273, but Home and Radio omit native tv.browsing. Pass actual visible browsing state to stop programme polling while watching. Owner #273; component cleanup coverage in #270. |
| #270 | [inlineComments 4008151583](https://github.com/avoid-quest/couch/pull/270#discussion_r4008151583) | Non-actionable | The premise that refresh is administrator-only is false in the combined stack. Default avoid radio Retry is intentionally available to Controllers in Home/Search under #259/#260; it does not edit custom-source configuration. Keep existing source-management authorization. Unintended repeated refresh and request duration are tracked separately. |
| #270 | [inlineComments 4008151593](https://github.com/avoid-quest/couch/pull/270#discussion_r4008151593) | Actionable | AvoidRadioHome attempt stays nonzero after Retry, forcing every subsequent visibility/reconnect load. Restrict force refresh to the explicit retry event. Owner #270. |
| #270 | [inlineComments 4008151599](https://github.com/avoid-quest/couch/pull/270#discussion_r4008151599) | Actionable | AvoidRadioHome catalog ignores radioVersion; background feed refresh can leave removed stations actionable. Reload cached catalog on invalidation and derive details by station ID. Owner #270. |
| #270 | [inlineComments 4008151602](https://github.com/avoid-quest/couch/pull/270#discussion_r4008151602) | Actionable | avoidProgrammes has up to 17 sequential batches with 10-second metadata timeouts, exceeding the client 45-second timeout. Bound total aggregation, stop scheduling abandoned work, preserve partial results and shared metadata behavior. Owner #270. |
| #270 | [inlineComments 4008151610](https://github.com/avoid-quest/couch/pull/270#discussion_r4008151610) | Already addressed | App renders AvoidRadioHome directly on consolidated Home with onBrowse and enqueue integration in #273. |
| #270 | [inlineComments 4008151617](https://github.com/avoid-quest/couch/pull/270#discussion_r4008151617) | Actionable | addPlaylist counts the built-in playlist against the 30 custom-playlist quota. Exclude the built-in ID and test the boundary. Owner #270. |
| #271 | [comments 5668442896](https://github.com/avoid-quest/couch/pull/271#issuecomment-5668442896) | Non-actionable | Automated review status only; the submitted inline findings are each accounted for below. |
| #271 | [comments 5668565955](https://github.com/avoid-quest/couch/pull/271#issuecomment-5668565955) | Non-actionable | Historical Cloudflare build/deployment status, with no requested code change. This task does not run deployment. |
| #271 | [reviews 5201221208](https://github.com/avoid-quest/couch/pull/271#pullrequestreview-5201221208) | Non-actionable | Automated review status only; the submitted inline findings are each accounted for below. |
| #271 | [inlineComments 4008137795](https://github.com/avoid-quest/couch/pull/271#discussion_r4008137795) | Already addressed | BrowseHome.test.tsx expects Files and the baseline full suite passes. |
| #271 | [inlineComments 4008137807](https://github.com/avoid-quest/couch/pull/271#discussion_r4008137807) | Already addressed | App passes onAddSource and mounts SourceSetupDialog in #273. |
| #271 | [inlineComments 4008137812](https://github.com/avoid-quest/couch/pull/271#discussion_r4008137812) | Already addressed | App onProvider updates selectedProvider/providerRequest and ProviderPanel receives initialProvider in #273. |
| #271 | [inlineComments 4008137824](https://github.com/avoid-quest/couch/pull/271#discussion_r4008137824) | Actionable | Explicitly require connectivity for aggregate no-results. The exact initial offline reproduction is masked by parent summary-reset ordering, but stale completed summaries survive disconnection; disconnected searches must not claim completion. Owner #271; verify transition contract. |
| #271 | [inlineComments 4008137840](https://github.com/avoid-quest/couch/pull/271#discussion_r4008137840) | Already addressed | Current usePageRoute.changeSearch navigates with replace:true; the combined route tests and full suite pass. |
| #271 | [inlineComments 4008137849](https://github.com/avoid-quest/couch/pull/271#discussion_r4008137849) | Actionable | SearchRadioResults stores a station object independently of refreshed results. Store the selected ID and derive current detail, including retained favorites. Owner #271. |
| #271 | [inlineComments 4008137858](https://github.com/avoid-quest/couch/pull/271#discussion_r4008137858) | Actionable | Online and radio details close when inactive but never restore result focus on reactivation. Preserve pending focus restoration, with cleanup and no focus theft from another open dialog. Owner #271. |
| #272 | [comments 5668471431](https://github.com/avoid-quest/couch/pull/272#issuecomment-5668471431) | Non-actionable | Historical Cloudflare build/deployment status, with no requested code change. This task does not run deployment. |
| #272 | [comments 5668508956](https://github.com/avoid-quest/couch/pull/272#issuecomment-5668508956) | Non-actionable | Automated review status only; the submitted inline findings are each accounted for below. |
| #272 | [reviews 5201210741](https://github.com/avoid-quest/couch/pull/272#pullrequestreview-5201210741) | Non-actionable | Automated review status only; the submitted inline findings are each accounted for below. |
| #272 | [inlineComments 4008128137](https://github.com/avoid-quest/couch/pull/272#discussion_r4008128137) | Already addressed | App and CouchRouter use isNativeHost marker classification at the combined head; the external remote takes browser pairing/routing paths. |
| #272 | [inlineComments 4008128143](https://github.com/avoid-quest/couch/pull/272#discussion_r4008128143) | Already addressed | App mounts LocalSharingPrompt for native host credentials in #273. |
| #272 | [inlineComments 4008128149](https://github.com/avoid-quest/couch/pull/272#discussion_r4008128149) | Actionable | Remote window geometry is only snapshotted at creation while the display worker can move/resize main. Follow main window movement, size and scale through supported Tauri window events. Owner #272; Mac build plus X11 geometry runtime checks required. |
| #272 | [inlineComments 4008128156](https://github.com/avoid-quest/couch/pull/272#discussion_r4008128156) | Already addressed | App renders PlaybackDevice in its native header in #273. |
| #273 | [comments 5668444809](https://github.com/avoid-quest/couch/pull/273#issuecomment-5668444809) | Non-actionable | Automated review status only; the submitted inline findings are each accounted for below. |
| #273 | [reviews 5201230028](https://github.com/avoid-quest/couch/pull/273#pullrequestreview-5201230028) | Non-actionable | Automated review status only; the submitted inline findings are each accounted for below. |
| #273 | [inlineComments 4008146024](https://github.com/avoid-quest/couch/pull/273#discussion_r4008146024) | Non-actionable | This concerns credentials issued by the old frontend without an installation ID. Accepted #258/#265 exclude old-POC migration. New app pairings already save token and installation ID together; preserve fail-closed origin/installation checks. |
| #273 | [inlineComments 4008146044](https://github.com/avoid-quest/couch/pull/273#discussion_r4008146044) | Actionable | Idle paired browser lacks a route to RemotePad after SessionBar disappears. Restore a reachable browser remote button using existing controls. Owner #273. |
| #273 | [inlineComments 4008146052](https://github.com/avoid-quest/couch/pull/273#discussion_r4008146052) | Non-actionable | Passing setupStep reinstates the forced four-step modal, contradicting accepted #258/#259 optional setup and immediate browsing. No runtime authorization or playback consumer gates on setupStep; ordinary Settings exposes the same settings independently. |
| #273 | [inlineComments 4008146060](https://github.com/avoid-quest/couch/pull/273#discussion_r4008146060) | Actionable | Consolidated BrowseHome lost existing history ProgressActions. Restore watched/unwatched/clear-resume actions and derive details from current history so updates remain current. Owner #273. |

Snapshot totals: 19 non-actionable, 9 already addressed, 11 actionable. 39 records overall: 24 inline comments, five submitted reviews and ten conversation comments.

## Comments received during verification

A second complete paginated fetch found two additional conversation comments and unchanged PR heads. Both report deployments of the original commits, with no requested code change.

| PR | Item | Disposition | Reason |
| --- | --- | --- | --- |
| #270 | [Comment 5668894896](https://github.com/avoid-quest/couch/pull/270#issuecomment-5668894896) | Non-actionable | Cloudflare status for original commit `beb15145`, updated 18:05 UTC. |
| #273 | [Comment 5669137258](https://github.com/avoid-quest/couch/pull/273#issuecomment-5669137258) | Non-actionable | Cloudflare status for original commit `6b7c0480`, updated 18:24 UTC. |

Current total is 41 records: 24 inline comments, five submitted reviews and 12 conversation comments. Eleven inline findings are fixed below, nine were already addressed, and four conflict with accepted requirements or rely on a false premise. The remaining 17 records are review wrappers or automated statuses. GitHub threads were not marked resolved by this task.

## Independent audit and accepted scope

Accepted requirements were read at [#258](https://github.com/avoid-quest/couch/issues/258#issuecomment-5667095900), [#259](https://github.com/avoid-quest/couch/issues/259#issuecomment-5666511323), [#260](https://github.com/avoid-quest/couch/issues/260#issuecomment-5667781876) and [#267](https://github.com/avoid-quest/couch/issues/267#issuecomment-5667345445), alongside #265 and the current code.

Triage and the cited React assessment were completed before the fresh implementation agents started. Standards and spec audits used the immutable combined head above and traced current consumers. The baseline `bun run check` passed 1,162 tests with nine skips and 9,365 assertions in 96.11 seconds.

| Finding | Evidence and intended behavior | Owner |
| --- | --- | --- |
| Sharing bypasses update admission | Actual hub returned 503 for ordinary settings but 200 and a persisted sharing change while admission was closed. Reject sharing POST before its body and again immediately before writing; retain existing native readiness exceptions. | #269 |
| Radio detail portal survives hidden browsing | A failing component regression leaves the Radix dialog open after active=false. Close it with the view and restore the existing result focus on return. | #270 |
| Copied radio details survive catalog changes | Store a station ID and derive the detail from current catalog/results, so a renamed or removed station cannot stay stale in a portal. Deduplicated with inline catalog/detail findings. | #270, #271 |
| Duplicate query ownership | Route owns the committed query while App and SearchPanel both mirror the immediate draft. Give the controlled draft one owner and remove the child Effect that echoes route values to the parent; keep debounce and route-driven restoration. | #271, integration #273 |
| Source dialog first mounts the previous form | Opening a changed requested source first renders old controlled tab state, then resets it in an Effect. Use the existing Tabs default value inside mounted dialog content, keyed by requested source. | #271 |
| Render-time navigation callback refs | WebSocket events need the latest committed callback without another connection. Use stable useEffectEvent and pass App's callback directly. Keep the connection Effect and its cleanup. | #273 |
| Session metadata and identity lifetimes | Derive displayed installation/player details from the session and public connection response. Storage remains an external synchronization Effect with the correct origin lifetime. Tests also reproduced stale controller identity across origin/installation changes; reset it with the connection lifetime. | #273 |
| Obsolete build response can reload a new connection | A deferred build response finishes JSON parsing after its connection was disposed. Check disposal after parsing, before asset comparison or reload. Regression completed the old response after selecting a replacement. | #273 |
| Debounce must survive parent updates | A new route callback on every playback render can reset a dependency-correct 300 ms timer forever. Use an Effect Event only for the timer callback, preserving reactive draft/query/activity dependencies. Test parent callbacks replaced every 75 ms. | #271 |

No broad Effect deletion, new data store, Suspense cache, router migration, React Compiler, lint dependency or dependency upgrade is accepted for this patch. Those candidates lack a demonstrated benefit or verified project-compatible integration. Ordinary fetching, subscriptions, focus, timers and persistence keep their external synchronization lifetimes. Provider result groups make bounded duplicate favorite reads; changing their shared owner remains a documented future opportunity, not an accepted implementation fix.

## Standards audit

Concrete issues were lifecycle cleanup, copied selected objects and query ownership. Four scratch component regressions failed at the initial head: forced retry after reconnect, inactive radio portal, online focus restoration, and radio focus restoration. Existing shadcn components and narrow state changes address these. No measured expensive pure calculation justified memoization or compiler adoption.

## Spec audit

The native geometry gap, lost idle remote and progress actions, and sharing admission bypass violate retained behavior or the explicit update gate. The last-Administrator, legacy migration and mandatory setup suggestions conflict with accepted requirements and are rejected for the reasons recorded per comment. New-app pairing preservation, target-only recovery, native authority isolation and exact component build checks remain required.

## Verification and final heads

All accepted fixes passed their focused regressions and the integrated checks. The coordinator committed each fix in its owning layer and propagated dependent branches with `gh stack rebase --upstack --no-trunk --remote origin`. Fresh implementation agents used isolated worktrees with separate ownership. No branch needed another rebase at the final code snapshot.

| Layer | Fix commits | Result and regression coverage |
| --- | --- | --- |
| #269 | `c769090ddf91a41d5aaaa85cb5caec3364ef7a22`, `fb819fb49bbd69fc6c25b58a456304157e567d1c` | `hub.ts` checks sharing admission before body reads and persistence. Real hub/SQLite/WebSocket tests cover closed admission, delayed bodies, restart/close and the AppImage status/observe handshake. |
| #270 | `c89fd39da1528b3f7fdcc6af6a1db13f26fcbd9a`, `a724eb1957fea7970c2f8929e7e96cb5d81b2d32` | Radio aggregation has a 30-second overall budget including feed loading, caller cancellation and partial results. Each aggregation schedules at most three metadata consumers at once; shared upstream requests retain their own timeout and survive one caller aborting. The default feed does not consume custom quota. `AvoidRadioHome` scopes state by connection, forces only explicit Retry, reloads on catalog version, derives selected detail, and closes hidden dialogs with safe focus restoration. Tests cover stalled feeds/50 stations, shared cancellation, quota edges, Strict Mode, reverse completions, activity and invalidation. |
| #271 | `ac78273c2e42ec3ac357e7be1020eea577438798` | Search uses one controlled draft owner, a committed-callback debounce, current radio details, connected-only empty results and safe result focus restoration. `SourceSetupDialog` uses existing Tabs mounting/defaults. Tests cover 75 ms parent rerenders, retained drafts, disconnected completed results, renamed/removed stations and source reopening. |
| #272 | `16f0051174884749c6e9e5cf384abff2b4384126` | `operating_mode.rs` and `lib.rs` follow main move/resize/scale events with physical bounds and an 88 logical-pixel recovery header. They do not show, recreate or focus a remote during geometry updates. Rust tests and the actual Linux WebKitGTK runtime checks below passed. |
| #273 | `a6e5f32a4502d4d8f9ce865ff420d3c9c89f546d`, `b81d4109cf7cad3a022fba5698d5129330c26fb7` | App passes native browsing activity and the controlled draft, restores idle RemotePad and existing HistoryPanel progress actions, and passes navigation directly. `useSession` uses an Effect Event, derives current player metadata, resets identity with the connection and guards stale build-response parsing. Tests cover DOM behavior, deferred responses, identities, storage writes, Strict Mode and callbacks from uncommitted renders. |

Final code heads are #268 `b5b7f70089b2d443d7af949ad49125dacc5f34af`, #269 `fb819fb49bbd69fc6c25b58a456304157e567d1c`, #270 `a724eb1957fea7970c2f8929e7e96cb5d81b2d32`, #271 `ac78273c2e42ec3ac357e7be1020eea577438798`, #272 `16f0051174884749c6e9e5cf384abff2b4384126`, and #273 `b81d4109cf7cad3a022fba5698d5129330c26fb7`. The subsequent #273 documentation commit contains this report without changing executable code.

`bun run check` passed TypeScript and 1,218 tests, with nine skips, zero failures and 10,106 assertions across 127 files in 88.44 seconds. The first integrated run exposed an obsolete AppImage fixture expecting sharing writes before admission; #269 now tests the actual handshake. That run also hit the unchanged display-session child-startup timeout. Its focused rerun and the final full run passed. `git diff --check` passed. Both final incremental audits found no new defects, and all five scratch diagnostic tests passed, including the four that failed before implementation.

## Native build and runtime

The documented [Mac build path](mac-build-251.md) used the retained `couch-mac-builder:34172088350.1` Linux compiler on Docker Desktop. A clean clone at `b81d4109cf7cad3a022fba5698d5129330c26fb7` supplied the source. The container was limited to one CPU, 2 GB and one Cargo job. `bun install --frozen-lockfile`, `bun run desktop:build --debug --no-bundle`, and `cargo test --lib --locked` passed. This built both production frontend and compiled Bun sidecar before the native executable. Rust reported 38 passed, zero failed and one explicitly ignored Bluetooth fake-bus test.

| Built file | SHA-256 |
| --- | --- |
| `couch` | `b6836ee0b48441871c3cdf174218b0c0eed8700d2bb1ab8f92af6679d9c3fb8e` |
| `couch-server` | `71f5a273d81ee247299b493f85b586d5922000f1980d257b3770f47ccb0314e1` |

The resulting binaries ran in the retained Linux WebKitGTK/X11/Openbox preview on the Mac, with fresh local state and a separate matching-build loopback target. The browser showed the real native desktop through a loopback-only noVNC connection. Window-manager commands supplied move/resize events and `wmctrl`/`xprop` measured the actual windows.

- Fresh startup offered This computer/Another Couch. Choosing local and Keep private opened Home with the default radio catalog and no required source setup.
- Play on selected the matching target and loaded its unprivileged browser pairing UI. Pairing succeeded. Retry and selector dismissal recreated the target while preserving the paired remote.
- Initial main bounds were `(0,0,1440,1000)` and remote bounds were `(0,88,1440,912)` at scale 1.
- Main `(160,120,1000,700)` produced remote `(160,208,1000,612)`. Main `(210,160,1100,740)` produced remote `(210,248,1100,652)`. The remote's active X11 window ID stayed `0xe00660` across the latter move/resize, with its open TV remote dialog intact.
- Opening the native target selector closed the remote. Moving main again left only main present and focused; geometry events did not recreate the closed remote. Dismissing the selector restored the paired target at the new geometry.
- The idle paired browser's header button opened TV remote controls. Use this computer restored local Home and the private local choice, leaving only the main native window.

Fractional/high-DPI and negative-coordinate geometry are covered by Rust tests, not a physical multimonitor run. This run does not qualify hardware audio, Bluetooth, a Debian dependency set, a signed release or end-to-end AppImage replacement. It adds native window evidence to the earlier qualification without weakening those boundaries. Logs and build artifacts are retained locally in `/tmp/couch-first-use-review-20260914`; the preview was stopped after verification. Its only runtime diagnostic was the expected missing accessibility-bus warning in the isolated image.

## Remaining boundaries

There are no blocked accepted code fixes in this review. [#265](https://github.com/avoid-quest/couch/issues/265) still owns unresolved installation/dependency, address and update rollout work and the acceptance gates documented in the earlier qualification. No code change here treats an unqualified delivery as accepted. React Compiler, Suspense fetching, store extraction and lint adoption remain deferred for the specific compatibility and benefit reasons in the assessment. GitHub Actions stays paused; the T480 was not used to build. This task stops at reviewed, verified stack pushes, before merging, releasing or deploying.

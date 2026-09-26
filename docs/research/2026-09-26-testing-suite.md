# Testing suite simplification — 26 September 2026

Keep `bun test` for TypeScript and `cargo test` for Rust. Prioritize removing CSS selectors and DOM-structure assertions from tests, then replacing repeated React/DOM lifecycle code with the libraries Bun officially supports. Tests should exercise user actions and outcomes. Investigate a standard WebDriver client after the fast suite is consistent. No runner migration is justified by the evidence gathered here.

This note records the research behind the testing changes. Implemented conventions are documented in [Development checks](../ci.md#writing-tests). Documentation was checked on 26 September 2026. The repository and installed Bun both use **1.4.2**; Happy DOM is pinned to **20.14.0**, React to **19.2.8**, and Playwright is already a development dependency. Current documentation can change independently of these pins.

## Repository evidence before implementation

The audit found 156 TypeScript test files containing 23,201 lines, 42 files restoring global property descriptors, and 40 manually creating React roots. There are 150 `sleep`/`setTimeout` sites across 63 test files and 5,626 static `expect` call sites. These are textual counts, not executed assertion counts or proof that each delay is unnecessary.

After `bun install --frozen-lockfile`, the existing `bun run test` passed on this Mac: **1,295 passed, 10 skipped, zero failures, 9,598 executed assertions, approximately 48 seconds**. Core took 41.44 seconds; the separately running clock suite took 47.87 seconds, including one 43.71-second real-media case. Seven skips were LAN environment checks and three were public-provider opt-ins. This is one local run, not a CI benchmark or proof of stability.

The audit found 67 `querySelector`/`querySelectorAll` sites in client tests across 17 files, alongside 201 role/label query sites across 23 files. PlayerPage had 15 selector sites; SavedPlaylists, native-selection, QueuePanel, and SearchPanel had eight each. The implementation below replaces these and reframes class/style tests around chosen settings and observable behavior.

- [`package.json`](../../package.json) starts separate clock/core Bun processes; each requests `--isolate --parallel=4`. [`bunfig.toml`](../../bunfig.toml) currently has no test configuration.
- The former `src/client/testing.ts` provided a lazy `screen` proxy because individual tests installed their own document during `beforeEach`; the shared setup replaces it.
- [`RangeControl.test.tsx`](../../src/client/components/RangeControl.test.tsx), [`BluetoothSettings.test.tsx`](../../src/client/sections/settings/device/BluetoothSettings.test.tsx), and [`MetadataEditor.test.tsx`](../../src/client/components/MetadataEditor.test.tsx) repeat DOM installation, React root management, mock restoration, and DOM teardown. Bluetooth and metadata tests also sleep to await UI changes.
- [`ContinueSection.test.tsx`](../../src/client/sections/home/ContinueSection.test.tsx) contains `expect(document.querySelector(...)).toBeDefined()`. A missing element returns `null`, which passes that assertion. Simplification should improve this check, not merely delete assertions.
- [`tests/linux/ui.ts`](../../tests/linux/ui.ts) is a 411-line mix of W3C transport, input/actionability handling, app navigation, historical Settings compatibility, screenshots, and native pixel capture. Some of that is replaceable library infrastructure; some is product-specific qualification.
- [`scripts/verify.ts`](../../scripts/verify.ts) already exposes native Cargo verification through `--native`; [`tests/linux/run.sh`](../../tests/linux/run.sh) runs Cargo and provisions the real display/audio environment. Keep qualification receipts and native evidence separate from ordinary local iteration.

## Test policy: behavior through accessible controls

Following the user's explicit preference, remove test-owned `querySelector`/`querySelectorAll`, CSS class checks, `data-slot`/wrapper assertions, and DOM-shape snapshots. Do not hide the same selectors behind a custom test helper. Use accessible role/name, label, or visible text to drive the real component, then check the meaningful result. Testing Library prioritizes `getByRole` and `getByLabelText` and discourages class/id queries. [Testing Library query guidance](https://testing-library.com/docs/queries/about/)

| Existing coupling | Replacement |
| --- | --- |
| `querySelector('section[aria-label="Continue"]')` | `screen.getByRole("region", { name: "Continue" })` when the region matters; otherwise directly exercise its named actions |
| Assert `data-nav-row`, wrapper classes, or nested element structure | Use the keyboard, activate the named item, and assert its playback/queue outcome |
| Inspect a dialog's internal classes to prove it closed | Close it, assert the dialog is absent, and assert focus returned to its trigger |
| Sleep, inspect form DOM, and count internal callbacks | Fill labeled fields, click Save, await the saved status, and check the submitted domain change |

Native decoded pixels and audio samples can still prove actual playback output. They are different evidence from CSS or synthetic layout assertions, and should not become broad visual-snapshot coverage.

## 1. Standardize React setup first

Bun officially recommends `@happy-dom/global-registrator` loaded before tests and supports `@testing-library/react` with `@testing-library/jest-dom`. Use this as the first implementation spike, keeping Bun as the runner. Scope DOM setup to UI tests so server tests retain their actual runtime globals. [Bun DOM testing](https://bun.sh/docs/test/dom)

React Testing Library supplies `render`, `rerender`, `unmount`, `cleanup`, queries, and React `act` integration. Replace manual `createRoot` setup with these APIs, and explicitly register cleanup with Bun's hooks. Install the DOM before importing libraries that capture `document`; a stable document per isolated test file permits ordinary `screen` instead of the current proxy. Keep a small provider helper only for Couch's actual providers. [React Testing Library API](https://testing-library.com/docs/react-testing-library/api/)

Create a fresh QueryClient per test, disable query retries where errors are being tested, and clear it during cleanup. Do not build a generic provider/fixture framework. TanStack documents isolated clients and retry control for tests. [TanStack Query testing](https://tanstack.com/query/latest/docs/framework/react/guides/testing)

**Retain the existing cleanup regression knowledge.** The [14 September investigation](ui-test-lifecycle-2026-09-14.md) demonstrated Radix focus cleanup firing against the wrong DOM realm after globals were restored. Happy DOM can only track its own timers; its documentation explicitly discusses this timer-ownership issue. A shared setup must unmount components, stop test-owned polling/query work, allow required unmount callbacks to finish, and then release the DOM. Prove dialogs/listboxes can be left open without cross-test errors, and that a deliberate timer exception still fails the run. Do not blanket-suppress errors or blindly await every timer while active polling remains. [Happy DOM environment setup](https://github.com/capricorn86/happy-dom/wiki/Setup-as-Test-Environment)

## 2. Replace guessed waits and low-value assertions

Use `findByRole`/`findByText` when UI appears asynchronously and `waitFor` for observable non-DOM effects. These await the condition and produce useful DOM diagnostics on failure. A `waitFor` callback must throw to trigger another attempt; returning `false` does not retry. Replace the Bluetooth/metadata `Bun.sleep(20)` patterns first. Retain real elapsed-time sampling where playback freshness is the behavior under test. [Testing Library async methods](https://testing-library.com/docs/dom-testing-library/api-async/)

`user-event` is a good targeted addition for typing, keyboard navigation, focus, and confirmation flows: `userEvent.setup()` models consecutive interactions with shared input state. Prefer it where it removes manually assembled events; retain `fireEvent` for deliberate low-level event cases such as controlled slider geometry. If fake timers are used, supply `advanceTimers` rather than disabling delays to avoid hangs. Validate compatibility with our pinned Happy DOM/Radix versions before bulk conversion. [user-event setup](https://testing-library.com/docs/user-event/setup/), [timer options](https://testing-library.com/docs/user-event/options/)

`jest-dom` makes state assertions clearer: `toBeDisabled`, `toHaveFocus`, `toHaveTextContent`, `toBeChecked`. Its matchers can extend a Jest-compatible `expect`; type integration must also pass our Bun-only TypeScript configuration. Note that `toBeDisabled` does **not** check `aria-disabled`, so preserve explicit ARIA checks when that is the actual contract. [jest-dom documentation](https://github.com/testing-library/jest-dom)

Apply these review rules rather than an assertion quota:

- Keep the user-visible outcome and relevant side effect. A successful confirmation and the correct submitted command can both matter.
- Remove repeated presence checks when a subsequent semantic query/action already requires the same element. Replace nullable-query `toBeDefined()` checks with a semantic query or a meaningful DOM matcher.
- Combine related response fields into one focused `toMatchObject` assertion when that yields a clearer failure. Avoid replacing many checks with a large snapshot.
- Delete CSS/class/wrapper/layout assertions. Remove repeated mock-call counts where the resulting behavior already proves the contract.
- Preserve negative cases: unauthorized requests do not mutate data, canceled operations do not invoke native actions, stale playback acknowledgements do not overwrite newer edits, and delayed frames fail freshness checks.

## 3. Use Bun's existing isolation and timers

Current Bun docs and local `bun test --help` agree: `--parallel=4` already implies file isolation. Each isolated file receives a fresh global and module registry; `--isolate` alone does not create a separate OS process. Within-file tests remain sequential unless concurrency is requested. Keep file isolation for this suite's globals and spies; do not enable `--concurrent` across shared UI fixtures. Remove the redundant flag when editing commands, but benchmark before changing worker count. [Bun parallelism and isolation](https://bun.sh/docs/test/parallel)

The combined-command experiment passed with identical totals: `bun test --parallel=4 --timings=/tmp/couch-testing-timings.json --update-timings --only-failures` ran all 156 files in **59.79 seconds**. That is slower than the current split's 47.87 seconds. Both are single local runs, but they already argue against collapsing the commands merely to save a line. The split starts the long clock case immediately; investigate recorded-duration scheduling only if repeated measurements justify it. Preserve real FFmpeg clock validation and remember isolation does not remove resource contention.

Use documented config for preload, discovery exclusions, and reporting; `isolate`/`parallel` are not listed in the current test configuration reference. Do not assume every CLI flag is also a supported TOML field. Bun already supplies seeded random order and repeated runs for diagnosis, so no retry framework is needed. [Bun configuration](https://bun.sh/docs/test/configuration)

Bun's API reference includes `jest.useFakeTimers`, `advanceTimersByTime`, and `runOnlyPendingTimers`. A local 1.4.2 smoke probe scheduled a one-second timeout and advanced it synchronously; the callback ran exactly once. Prefer these native APIs for debounce, expiry, and polling logic, restoring real timers afterward. `setSystemTime` changes the date clock; it is not a substitute for executing pending callbacks. Combining Bun's fake timers with Happy DOM's timer ownership requires a representative UI spike. [Bun timer API](https://bun.com/reference/bun/test/jest), [date control](https://bun.sh/docs/test/dates-times)

Centralize ordinary spy restoration where fixture lifetime permits. `mock.restore()` already provides this; no extra mocking framework is needed. [Bun mocks](https://bun.sh/docs/test/mocks)

## 4. Keep Cargo; make nextest conditional

`cargo test` already runs unit, integration, and documentation tests. It executes test binaries serially and individual tests within a binary on multiple threads. Expose that existing command consistently; adding a dependency is unnecessary for basic Rust coverage. [Cargo test reference](https://doc.rust-lang.org/cargo/commands/cargo-test.html)

`cargo-nextest` is the strongest optional Rust tool: it schedules each test in its own process and provides per-test results. This can isolate process-global state and improve scheduling, but it still builds the same Rust code and cannot remove Tauri/system-library compile cost. Measure warm execution separately from cold compilation before adopting it. [nextest execution model](https://nexte.st/docs/design/how-it-works/)

If adopted, retain `cargo test --doc`: nextest still does not run doctests on stable Rust. Shared native resources remain shared across processes; display, D-Bus, audio devices, and fixed paths may require serialized test groups. Do not turn retries into the definition of passing. [nextest running tests](https://nexte.st/docs/running/), [test groups](https://nexte.st/docs/configuration/test-groups/)

No Rust benchmark was possible in the research environment because Cargo was unavailable. Existing Linux native qualification remains necessary regardless of runner.

## 5. Simplify browser/native drivers only after a compatibility spike

**Trial outcome:** defer WebdriverIO adoption. A real MiniBrowser trial in the existing Linux test image used Bun 1.4.2, WebdriverIO 9.32.0, and WebKitGTK 2.52.6. At DPI 1, semantic input, dialog, Escape, and cleanup passed only after adding an explicit `waitForEnabled()`: the driver otherwise accepted a click on a disabled button without changing the page. At DPI 1.25, clicks still missed after that wait. These results preserve the need for our enabled-state and fractional-DPI workarounds. The isolated install added 218 packages. A cached Couch binary accepted a native driver session but its revision and current fixture compatibility were unverified, so it did not qualify a current-source journey. This trial does not justify a new dependency in the current stack.

**First candidate: WebdriverIO standalone.** Its `webdriverio` library offers higher-level selectors and interactions without adopting the WDIO test runner, while retaining access to raw protocol commands. Its automatic interaction waits could replace portions of our W3C client. The documentation targets Node.js, so Bun compatibility is an experiment rather than an upstream guarantee. Test one existing journey with Bun 1.4.2, tauri-driver, WebKitGTK, portals, keyboard navigation, fractional DPI, and process cleanup. Adopt only if generic driver code disappears; retain app navigation and native pixel/upgrade qualification. [WebdriverIO setup types](https://webdriver.io/docs/setuptypes/), [auto-waiting](https://webdriver.io/docs/autowait/)

Use accessibility/text selectors such as `aria/Save` rather than moving our CSS strings into WDIO. On Classic WebDriver, WDIO's accessibility-name selector uses an XPath approximation, so validate it against our actual WebKitGTK pages. This is still a useful standard implementation, but not a guarantee of browser-accessibility-tree equivalence. [WebdriverIO selectors](https://webdriver.io/docs/selectors/)

**Current Tauri nuance:** its documentation, updated 29 June 2026, recommends `@wdio/tauri-service`. The default embedded WebDriver plugin supports macOS, Windows, and Linux. Direct upstream `tauri-driver`, which this repository uses, still supports Windows/Linux only. The service adds test-build plugins and a different integration path; treat it as a later cross-platform evaluation, not a prerequisite for cleaning up Bun tests. [Tauri WebDriver documentation](https://v2.tauri.app/develop/tests/webdriver/)

**Playwright remains a browser option.** The existing library provides browser automation and locator actionability waits. Its full fixtures, runner, and automatic test artifacts belong to Playwright Test; using the library under Bun requires us to own lifecycle and assertions. It would not replace the repository's Tauri driver and native playback evidence. Prefer the existing W3C seam for the first experiment rather than introducing two competing browser abstractions at once. [Playwright library versus runner](https://playwright.dev/docs/library), [actionability](https://playwright.dev/docs/actionability/)

## Implementation order and acceptance

| Priority | Scope | Completion evidence |
| --- | --- | --- |
| 1 | Semantic behavior tests with shared UI setup and RTL lifecycle in a representative group | CSS/DOM-shape checks removed; fewer setup/teardown lines; dialogs and polling clean up; tests pass alone, together, and repeatedly; typecheck passes |
| 2 | Condition-based waits and assertion cleanup in the same files | No guessed UI sleeps; false-positive presence check fixed; distinct behavioral and negative guarantees retained |
| 3 | Migrate remaining UI files using the proven setup | One documented pattern; no growing framework of fixture flags; record full-suite duration and skip reasons |
| 4 | Align fast TypeScript, Rust, and native qualification commands | Clear runnable commands and prerequisites; retain split scheduling unless repeated timings justify changing it |
| 5 | Optional WDIO/nextest experiments | Measured reduction in custom code, failures, or execution time before adoption |

Do not add Vitest/Jest, MSW, broad snapshot suites, a coverage quota, or additional task orchestration without a concrete unmet need. Existing Bun spies, semantic queries, Cargo, and native qualification already cover the basic requirements. Any eventual workflow or packaging change must be proved with `act` using `catthehacker/ubuntu:full-latest`, as required by the repository instructions.

## Implementation results

The shared UI setup now uses the standard libraries above; the client suites use it instead of manual roots and global-property maps. All test-owned `querySelector` calls and CSS assertions were removed from client tests, and the lazy semantic-query proxy was deleted. The complete client suite passed randomized execution (`bun test --parallel=4 --randomize --seed=20260926 src/client`): 273 tests, zero failures, 2.68 seconds. Individual migration groups also passed three repeated isolated runs. Targeted probes verified that open-dialog unmount callbacks finish, an unhandled timer exception still fails Bun, and real Bun HTTP responses and cancellation still work with the shared DOM setup.

Four server suites now use native Bun fake timers for timeout and retention behavior. The same 54 tests and 447 assertions took 9.65 seconds versus 26.80 seconds before the change in focused local runs; three repeated isolated runs passed all 162 cases. Real subprocess budgets and media freshness checks retain real time. These local measurements do not establish hosted CI timings. Cargo remains unchanged, and the WebdriverIO trial above did not justify adoption.

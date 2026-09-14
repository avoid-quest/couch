# UI test lifecycle validation, 14 September 2026

Issue [#247](https://github.com/avoid-quest/couch/issues/247). Base `origin/main` was fetched and verified as `f60f3daea2dd9e11c2ed483ce094866ec8d0ce8c`. Checks ran on the Mac with Bun `1.4.2`, Happy DOM `20.14.0`, Radix Focus Scope `1.1.16`, and `bun install --frozen-lockfile`.

## Failing base

Before editing, this command exited **1**:

```sh
bun test ./src/client/SoundSettings.test.tsx ./src/client/MetadataEditor.test.tsx
```

Retained output follows. Only the absolute worktree prefix is normalized.

```text
bun test v1.4.2 (744846f84)

src/client/SoundSettings.test.tsx:
(pass) keeps sound tests in a secondary disclosure [120.54ms]
(pass) test uses explicit output identity and Stop remains available before route confirmation [12.92ms]
(pass) selection uses the stable device name and keeps unconfirmed routing separate [20.56ms]
(pass) offers available HDMI, analog profiles and connected Bluetooth in one select [20.37ms]
(pass) retains a disconnected selection without silently selecting another route [2.87ms]
(pass) hides Bluetooth codec alternatives once the same speaker has a usable output [824.76ms]
(pass) does not mistake the saved output for the currently observed playback route [4.75ms]
(pass) a rejected selection keeps the previous output selected and reports the failure [12.55ms]
(pass) polling leaves open choices in place and appends newly available outputs [2441.33ms]

src/client/MetadataEditor.test.tsx:

# Unhandled error between tests
-------------------------------
101 |      * @param event Event.
102 |      * @returns The return value is false if event is cancelable and at least one of the event handlers which handled this event called Event.preventDefault().
103 |      */
104 |     dispatchEvent(event) {
105 |         if (!(event instanceof Event)) {
106 |             throw new this[PropertySymbol.window].TypeError(`Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'.`);
                                                                                                                                                           ^
TypeError: Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'.
      at dispatchEvent (<worktree>/node_modules/.bun/happy-dom@20.14.0/node_modules/happy-dom/lib/event/EventTarget.js:106:150)
      at <anonymous> (<worktree>/node_modules/.bun/@radix-ui+react-focus-scope@1.1.16+7e9dce1c88b42eaf/node_modules/@radix-ui/react-focus-scope/dist/index.mjs:97:23)
-------------------------------


 9 pass
 0 fail
 1 error
 35 expect() calls
Ran 9 tests across 2 files. [3.56s]
```

## Cause and regression coverage

The tests installed DOM constructors globally but left `setTimeout` and `clearTimeout` on Bun. Radix schedules focus restoration and removal from its focus-scope stack in a zero-delay timeout after unmount. Happy DOM could not track that callback, so restoring globals first allowed it to construct a native `CustomEvent` and dispatch it on an old Happy DOM element.

Both affected files now install their Window's timeout methods, unmount React, await `happyDOM.waitUntilComplete()`, and then abort remaining DOM work and restore global descriptors. This follows Happy DOM's [timer setup guidance](https://github.com/capricorn86/happy-dom/wiki/Setup-as-Test-Environment). Draining the callback also lets Radix remove its old focus scope rather than leaving it in the shared stack. See the [upstream focus cleanup](https://github.com/radix-ui/primitives/blob/main/packages/react/focus-scope/src/focus-scope.tsx).

The existing tests that leave the sound listbox and video details dialog open now assert that each receives exactly one `focusScope.autoFocusOnUnmount` event before its DOM globals are restored. With those assertions added but the timer fix absent, both fail with `Expected number of calls: 1; Received number of calls: 0`, exit 1. With the fix, both pass. All existing behavioral assertions remain.

The two Windows disable Happy DOM's error capturing so timer callback exceptions still reach Bun. No error filters or test skips were added.

A temporary test scheduled `throw new Error("issue-247 deliberate timer failure")` through the installed global timeout and awaited the Window. Bun reported that error, failed the test and exited 1. The probe was removed after this check.

## Local validation

The executable fix is commit `b235a0f689579e6d645dc91f8db86feda00e967b`. GitHub Actions permissions were read back as `enabled: false`; no hosted run was triggered.

| Command | Result | Exit |
| --- | --- | --- |
| `bun install --frozen-lockfile` | Installed the pinned dependencies without lockfile changes | 0 |
| `bun test ./src/client/SoundSettings.test.tsx ./src/client/MetadataEditor.test.tsx` | 18 passed, 93 assertions, zero unhandled errors | 0 |
| `bun test ./src/client/SoundSettings.test.tsx` | 9 passed, 36 assertions, zero unhandled errors | 0 |
| `bun test ./src/client/MetadataEditor.test.tsx` | 9 passed, 57 assertions, zero unhandled errors | 0 |
| `bun run typecheck` | Passed | 0 |
| `bun test ./tests/linux/iptv-clock.test.ts` | 1 passed, 2 skipped, zero unhandled errors | 0 |
| `bun test --path-ignore-patterns 'tests/linux/iptv-clock.test.ts'` | 1,063 passed, 7 skipped, 8,356 assertions, zero unhandled errors, 93.19 seconds | 0 |

The clock check runs in its own process, matching `.github/workflows/check.yml`, because other tests mock the process clock.

The two existing clock skips require ffmpeg, which was unavailable on this Mac:

- Delayed-window readiness follows published HLS when elapsed time gets ahead.
- Real H264 live fixture presents advancing pixel timestamps; a delayed reload fails the same freshness assertion.

The full suite retains seven existing skips:

- Three actual yt-dlp checks for audio-only HTML, HLS quality caps and DASH height limits. yt-dlp was unavailable.
- The real tagged MP3/FLAC/M4A parser fixture, which requires ffmpeg.
- The opt-in Twitch public catalog and offline Sabaku broadcast checks.
- The opt-in RaiPlay catalog/search/episode/replay check.

These are unexecuted provider/media checks, not successful live qualification.

An intermediate full run overlapping another sibling's Mac suite failed three existing `scripts/display-session.test.ts:58` startup-marker deadlines, with 1,060 passes, seven skips, three failures, zero unhandled errors and exit 1. The fixture waits up to 100 attempts of 10 ms for its shell process. The sibling saw matching failures; an earlier full run passed all 1,063 tests. No shell test or deadline was changed for this issue. The final run reported above was coordinated with siblings and passed all 1,063 tests, including these shell checks. #249 also reproduced the shell deadline failure in an isolated fixture using unchanged `origin/main` script bytes, so concurrency is a possible contributor rather than a proven sole cause.

Raw logs remain in `.scratch/issue-247/` in the assigned worktree. The failing output and command results needed to review this fix are retained in this document.

## Acceptance and remaining work

The recorded base failure was reproduced before editing. Both UI files retain their behavioral coverage and now check that their open focus scope finishes cleanup before globals change. TypeScript and the supported split Bun validation run locally during the Actions pause.

No appliance deployment, restart, playback, pairing, power action or physical acceptance is required for this test-only fix. The remaining human action is PR review and merge. Parent issues #1 and #25 are unchanged.

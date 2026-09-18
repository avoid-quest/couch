---
"couch": patch
---

Rework the TV now-playing experience with Big-picture patterns: spatial keyboard/remote navigation on the TV shell, uniform interface scaling steps (the old TV-only multipliers double-scaled text over icons), settings presented as shadcn cards at full width, a single now-playing info surface with clamped programme metadata, a slim icon sidebar, a session bar that stays available on the TV home and returns to the playback view, and no playback-on select in the TV header. Also fix the Linux preview build, which could not resolve the client entry because `vite.config.ts` was missing from the copied sources.

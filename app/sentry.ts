import { app } from "electron";
import * as Sentry from "@sentry/electron/main";
import { sentryDsn, sentryOptions, setReportingEnabled } from "../src/shared/sentry";
import { reportAppErrors } from "./diagnostics";

// Main's handled failures (Core exits, updates, page loads) are otherwise only in its log.
reportAppErrors((component, message) =>
  Sentry.captureMessage(message, { level: "error", tags: { component } }),
);

// Main exits right after Core stops; the report about it leaves first, for at most 2 s.
export const flushReports = () => Sentry.flush(2000);

export function setDesktopReporting(enabled: boolean) {
  setReportingEnabled(Sentry.getClient(), enabled, startDesktopMonitoring);
}

function startDesktopMonitoring() {
  const dsn = process.env.COUCH_SENTRY_DESKTOP_DSN ?? sentryDsn;
  if (!dsn) return;
  Sentry.init({
    ...sentryOptions,
    dsn,
    // A remote Couch supplies its own React client, which reports directly to its client project.
    transport: Sentry.makeElectronTransport,
    ipcMode: Sentry.IPCMode.Classic,
    integrations: (defaults) => [
      ...defaults.filter(
        (i) =>
          ![
            "PreloadInjection",
            "ElectronNet",
            "NodeFetch",
            "SentryMinidump",
            "AdditionalContext",
            "GpuContext",
            "MainProcessSession",
          ].includes(i.name),
      ),
      Sentry.nodeContextIntegration({ device: false, culture: false, cloudResource: false }),
      // A failure that repeats on a timer (the TV's playback report every 5 s) files once.
      Sentry.dedupeIntegration(),
    ],
  });
  if (app.isReady()) return;
  const startup = Sentry.startInactiveSpan({ name: "Couch desktop ready", op: "app.start" });
  app.once("ready", () => {
    startup.end();
    Sentry.logger.info("Couch desktop ready");
  });
}

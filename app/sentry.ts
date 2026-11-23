import { app } from "electron";
import * as Sentry from "@sentry/electron/main";
import { sentryDsn, sentryOptions, setReportingEnabled } from "../src/shared/sentry";

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
    ],
  });
  if (app.isReady()) return;
  const startup = Sentry.startInactiveSpan({ name: "Couch desktop ready", op: "app.start" });
  app.once("ready", () => {
    startup.end();
    Sentry.logger.info("Couch desktop ready");
  });
}

import manifest from "../package.json" with { type: "json" };

// Embed only the public key for the runtime being built. Installed apps have no .env file.
export function sentryDefines(runtime: "desktop" | "core" | "client", environment: string) {
  const channel =
    environment === "production" && /-preview\.\d+$/.test(manifest.version)
      ? "preview"
      : environment;
  return {
    COUCH_SENTRY_DSN: JSON.stringify(
      process.env[`COUCH_SENTRY_${runtime.toUpperCase()}_DSN`] ?? "",
    ),
    COUCH_SENTRY_ENVIRONMENT: JSON.stringify(process.env.SENTRY_ENVIRONMENT || channel),
  };
}

export const uploadSourceMaps = Boolean(process.env.SENTRY_ORG && process.env.SENTRY_AUTH_TOKEN);

export type Channel = "stable" | "preview";
export type PackageFormat = "deb" | "appimage" | "dmg" | "nsis";
export const application = "avoid-quest/couch";
export const cdn = `https://cdn.crabnebula.app`;
export const updaterEndpoint = (format: PackageFormat) => `${cdn}/update/${application}/${releasePlatforms(format).update}/{{current_version}}`;

export function releaseVersion(version: string) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.(?:0|[1-9]\d*))?$/.test(version)) throw new Error("Use X.Y.Z or X.Y.Z-preview.N, without build metadata.");
  return version;
}

export function packageFormat(value: string | undefined): PackageFormat {
  if (value === undefined) return "deb";
  if (value === "deb" || value === "appimage" || value === "dmg" || value === "nsis") return value;
  throw new Error("Choose deb, appimage, dmg or nsis.");
}

export function publicFiles(version: string, format: PackageFormat = "deb") {
  releaseVersion(version);
  if (format === "dmg") return [`Couch_${version}_aarch64.dmg`, "Couch.app.tar.gz"];
  if (format === "nsis") return [`Couch_${version}_x64-setup.exe`, `Couch_${version}_x64-setup.nsis.zip`];
  return [`Couch_${version}_amd64.${format === "deb" ? "deb" : "AppImage"}`];
}

export function releasePlatforms(format: PackageFormat) {
  if (format === "dmg") return { public: "dmg-aarch64", update: "darwin-aarch64" };
  if (format === "nsis") return { public: "nsis-x86_64", update: "windows-x86_64-nsis" };
  return { public: `${format}-x86_64`, update: `linux-x86_64-${format}` };
}

export function assetPlatforms(version: string, format: PackageFormat, name: string) {
  const [installer, updater] = publicFiles(version, format);
  if (name === installer) return { public: releasePlatforms(format).public, update: updater ? null : releasePlatforms(format).update };
  if (name === updater) return { public: null, update: releasePlatforms(format).update };
  throw new Error(`Unexpected ${format} asset: ${name}`);
}

export function channelArgs(channel: Channel) {
  if (channel !== "stable" && channel !== "preview") throw new Error("Choose stable or preview.");
  return channel === "preview" ? ["--channel", "preview"] : [];
}

export function downloadUrl(file: string, channel: Channel) {
  channelArgs(channel);
  return `${cdn}/download/${application}/latest/${file}${channel === "preview" ? "?channel=preview" : ""}`;
}

export function publicKey(value: string | undefined) {
  const key = value?.trim() ?? "";
  const decoded = Buffer.from(key, "base64").toString("utf8");
  if (!/^untrusted comment: [^\n]+\nRW[A-Za-z0-9+/=]+\s*$/.test(decoded)) throw new Error("Supply the enrolled Tauri public key in COUCH_UPDATER_PUBLIC_KEY.");
  return key;
}

// Where the website finds the hosted Couch downloads.
export type Channel = "stable" | "preview";
export type PackageFormat = "deb" | "appimage" | "dmg" | "nsis";
const application = "avoid-quest/couch";
const cdn = `https://cdn.crabnebula.app`;

function releaseVersion(version: string) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.(?:0|[1-9]\d*))?$/.test(version)) throw new Error("Use X.Y.Z or X.Y.Z-preview.N, without build metadata.");
  return version;
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

function channelArgs(channel: Channel) {
  if (channel !== "stable" && channel !== "preview") throw new Error("Choose stable or preview.");
  return channel === "preview" ? ["--channel", "preview"] : [];
}

export function downloadUrl(file: string, channel: Channel) {
  channelArgs(channel);
  return `${cdn}/download/${application}/latest/${file}${channel === "preview" ? "?channel=preview" : ""}`;
}

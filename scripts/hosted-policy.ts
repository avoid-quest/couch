export type Channel = "stable" | "preview";
export const application = "avoid-quest/couch";
export const cdn = `https://cdn.crabnebula.app`;
export const updaterEndpoint = `${cdn}/update/${application}/linux-x86_64-appimage/{{current_version}}`;

export function releaseVersion(version: string) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.[1-9]\d*)?$/.test(version)) throw new Error("Use X.Y.Z or X.Y.Z-preview.N, without build metadata.");
  return version;
}

export function publicFiles(version: string) {
  releaseVersion(version);
  return [`Couch_${version}_amd64.AppImage`, `couch-setup-${version}.tar.gz`, `couch-distribution-material-${version}.tar.gz`].flatMap(file => [file, `${file}.sig`]);
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

import { BrowserWindow, desktopCapturer, dialog, session, systemPreferences, type WebContents, type WebFrameMain } from "electron";
import type { CaptureSelection, CaptureSource } from "../src/shared/capture";

const originOf = (url: string | null) => { try { const { origin } = new URL(url!); return origin === "null" ? null : origin; } catch { return null; } };

// Capture belongs to this app's current Couch page, including in Client mode.
// Preparing a source grants one display request, never a persistent screen permission.
// Another Couch's page (Client mode) gets the microphone only after this computer's owner
// allows it in a native prompt, each time; this computer's own Couch (`localOrigin`) doesn't ask.
export function createCapture(contents: () => WebContents | null, address: () => string | null, localOrigin: string) {
  // A saved address may differ from its window's origin, such as by a trailing slash.
  const origin = () => originOf(address());
  let sources: CaptureSource[] = [];
  let pending: { frame: WebFrameMain; origin: string; selection: CaptureSelection; expires: number; issued: boolean } | null = null;
  let generation = 0;
  let asking: AbortController | null = null;
  const trusted = (requester: WebContents | null, requestingOrigin: string, mainFrame: boolean) => !!origin() && !!requester && requester === contents()
    && mainFrame && originOf(requestingOrigin) === origin() && originOf(requester.mainFrame.url) === origin();
  const owner = () => {
    const current = contents();
    if (!current || !trusted(current, current.mainFrame.url, true)) throw new Error("Start sharing from this computer's Couch window.");
    return current.mainFrame;
  };
  const prepared = () => pending && pending.expires > Date.now() && pending.frame === contents()?.mainFrame
    && originOf(pending.frame.url) === pending.origin && pending.origin === origin() ? pending : null;
  const systemAudio = () => process.platform === "win32" || process.platform === "darwin" && (() => {
    const [major = 0, minor = 0] = process.getSystemVersion().split(".").map(Number);
    return major > 14 || major === 14 && minor >= 2;
  })();
  // Cancelling, replacing, navigating or closing also closes an open microphone prompt.
  const revoke = () => { generation++; pending = null; asking?.abort(); asking = null; };
  const clear = () => { revoke(); sources = []; };

  return {
    clear,
    async sources(): Promise<CaptureSource[]> {
      const frame = owner();
      const request = generation;
      const found = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
      if (request !== generation || frame !== owner()) throw new Error("Couch changed while choosing a source. Choose it again.");
      sources = found.map(({ id, name }) => ({ id, name, kind: id.startsWith("screen:") ? "screen" : "window" }));
      return sources;
    },
    async prepare(selection: unknown): Promise<void> {
      revoke();
      const request = generation;
      const frame = owner();
      if (selection === null) return;
      if (!selection || typeof selection !== "object" || !("kind" in selection) || typeof selection.kind !== "string"
        || !["system-audio", "screen", "microphone"].includes(selection.kind)) throw new Error("Choose what to share.");
      const choice = selection as CaptureSelection;
      if (choice.kind === "system-audio" && !systemAudio()) throw new Error(process.platform === "darwin"
        ? "PC audio sharing requires macOS 14.2 or later. You can still share a screen or an audio input."
        : "PC audio capture is not available on this system. Choose an audio input instead.");
      const requesting = origin()!;
      if (choice.kind === "microphone" && requesting !== localOrigin) {
        asking = new AbortController();
        const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(contents()!)!, {
          type: "question", message: `Allow ${requesting} to use this computer's microphone?`,
          detail: "This window shows that Couch's own page. Allow only if you just chose a microphone or audio input to share there.",
          buttons: ["Don't Allow", "Allow"], defaultId: 0, cancelId: 0, signal: asking.signal,
        });
        if (request !== generation || frame !== owner()) throw new Error("Couch changed while requesting capture. Start sharing again.");
        asking = null;
        if (response !== 1) throw new Error("Microphone sharing wasn't allowed on this computer.");
      }
      if (choice.kind !== "microphone" && !sources.some(source => source.id === choice.sourceId)) throw new Error("Choose a screen or window before sharing.");
      if (choice.kind === "microphone" && process.platform === "darwin" && !await systemPreferences.askForMediaAccess("microphone")) {
        throw new Error("Allow Couch to use the microphone in System Settings → Privacy & Security → Microphone, then restart Couch.");
      }
      if (request !== generation || frame !== owner()) throw new Error("Couch changed while requesting capture. Start sharing again.");
      pending = { frame, origin: requesting, selection: { kind: choice.kind, sourceId: choice.sourceId }, expires: Date.now() + 30_000, issued: false };
    },
    install() {
      session.defaultSession.setPermissionRequestHandler((requester, permission, allow, details) => {
        const local = trusted(requester, details.requestingUrl, details.isMainFrame);
        const grant = prepared();
        const microphone = permission === "media" && grant?.selection.kind === "microphone" && "mediaTypes" in details
          && details.mediaTypes?.length === 1 && details.mediaTypes[0] === "audio";
        // Electron 44 requests display capture as media with no microphone/camera mediaTypes.
        const display = permission === "media" && grant && !grant.issued && grant.selection.kind !== "microphone" && "mediaTypes" in details && details.mediaTypes?.length === 0;
        allow(permission === "fullscreen" || local && (permission === "display-capture" && !!grant && !grant.issued || microphone || !!display));
      });
      session.defaultSession.setPermissionCheckHandler((requester, permission, requestingOrigin, details) => {
        const grant = prepared();
        // Chromium checks an issued display device again while opening it, without a mediaType.
        return permission === "fullscreen" || trusted(requester, requestingOrigin, details.isMainFrame)
          && (permission === "display-capture" && !!grant && !grant.issued
            || permission === "media" && (details.mediaType === "audio" && grant?.selection.kind === "microphone"
              || details.mediaType === undefined && !!grant?.issued && grant.selection.kind !== "microphone"));
      });
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        const grant = prepared();
        const current = contents();
        const source = sources.find(source => source.id === grant?.selection.sourceId);
        if (!grant || grant.issued || !current || request.frame !== grant.frame || !trusted(current, request.securityOrigin, true)
          || !request.userGesture || !request.videoRequested || grant.selection.kind === "microphone" || !source) return callback({});
        grant.issued = true;
        callback({ video: source, ...request.audioRequested && systemAudio() ? { audio: "loopback" as const } : {} });
      });
    },
  };
}

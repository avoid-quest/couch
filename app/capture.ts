import { BrowserWindow, desktopCapturer, dialog, session, shell, systemPreferences, type WebContents, type WebFrameMain } from "electron";
import type { CaptureKind, CaptureSelection, CaptureSource } from "../src/shared/capture";

// The system setting that allows each kind of capture, and what to turn on there. macOS asks
// only the first time Couch captures; after that only System Settings changes its answer.
const settings: Partial<Record<NodeJS.Platform, Partial<Record<"screen" | "microphone", [url: string, action: string]>>>> = {
  darwin: {
    screen: ["x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture", "Turn on Couch in Screen & System Audio Recording, then reopen Couch when macOS asks."],
    microphone: ["x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone", "Turn on Couch in Microphone."],
  },
  win32: { microphone: ["ms-settings:privacy-microphone", "Turn on microphone access for desktop apps."] },
};
// System audio comes with a screen or window's capture.
const media = (kind: unknown) => {
  if (kind !== "system-audio" && kind !== "screen" && kind !== "microphone") throw new Error("Choose what to share.");
  return kind === "microphone" ? "microphone" : "screen";
};

const originOf = (url: string | null) => { try { const { origin } = new URL(url!); return origin === "null" ? null : origin; } catch { return null; } };

// Capture belongs to this app's current Couch page, including in Client mode.
// Preparing a source grants one display request, never a persistent screen permission.
// Another Couch's page (Client mode) gets the microphone, a screen or window, or this computer's
// audio only after this computer's owner allows it in a native prompt, each time; this computer's
// own Couch (`localOrigin`) doesn't ask.
export function createCapture(contents: () => WebContents | null, address: () => string | null, localOrigin: string) {
  // A saved address may differ from its window's origin, such as by a trailing slash.
  const origin = () => originOf(address());
  let sources: CaptureSource[] = [];
  // `issued` is "asking" while the owner decides on a display request, then true once it is granted.
  type Grant = { frame: WebFrameMain; origin: string; selection: { kind: CaptureKind; audio: boolean }; source?: CaptureSource; expires: number; issued: boolean | "asking" };
  let pending: Grant | null = null;
  let delegated: { target: WebContents; frame: WebFrameMain; url: string; grant: Grant; cleanup: () => void } | null = null;
  const clearDelegated = () => { const old = delegated; delegated = null; old?.cleanup(); };
  let generation = 0;
  let asking: AbortController | null = null;
  const trusted = (requester: WebContents | null, requestingOrigin: string, mainFrame: boolean) => !!origin() && !!requester && requester === contents()
    && mainFrame && originOf(requestingOrigin) === origin() && originOf(requester.mainFrame.url) === origin();
  const owner = () => {
    const current = contents();
    if (!current || !trusted(current, current.mainFrame.url, true)) throw new Error("Start sharing from this computer's Couch window.");
    return current.mainFrame;
  };
  const current = (grant: typeof pending) => !!grant && grant === pending && grant.frame === contents()?.mainFrame
    && originOf(grant.frame.url) === grant.origin && grant.origin === origin();
  const prepared = () => pending && pending.expires > Date.now() && current(pending) ? pending : null;
  const systemAudio = () => process.platform === "win32" || process.platform === "darwin" && (() => {
    const [major = 0, minor = 0] = process.getSystemVersion().split(".").map(Number);
    return major > 14 || major === 14 && minor >= 2;
  })();
  // Cancelling, replacing, navigating or closing also closes an open prompt.
  const revoke = () => { clearDelegated(); generation++; pending = null; asking?.abort(); asking = null; };
  const clear = () => { revoke(); sources = []; };
  const ask = async (message: string, detail: string) => {
    const { signal } = asking = new AbortController();
    try {
      const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(contents()!)!, {
        type: "question", message, detail: `This window shows that Couch's own page. ${detail}`,
        buttons: ["Don't Allow", "Allow"], defaultId: 0, cancelId: 0, signal,
      });
      return response === 1;
    } finally { if (asking?.signal === signal) asking = null; }
  };

  const targetedMicrophone = (requester: WebContents | null, url: string, mainFrame: boolean) => {
    const lease = delegated;
    return !!lease && requester === lease.target && mainFrame && !lease.target.isDestroyed()
      && !lease.frame.detached && lease.target.mainFrame === lease.frame && lease.frame.url === lease.url
      && originOf(url) === lease.grant.origin && prepared() === lease.grant;
  };
  return {
    clear,
    // Main delegates only the current owner’s temporary microphone grant to its exact capture frame.
    delegateMicrophone(target: WebContents) {
      const grant = prepared();
      if (!grant || grant.selection.kind !== "microphone" || grant.frame !== owner() || target === contents()
        || target.isDestroyed() || originOf(target.mainFrame.url) !== grant.origin) throw new Error("No current microphone preparation for that helper.");
      clearDelegated();
      const navigation = (_event: unknown, _url: string, _inPlace: boolean, mainFrame: boolean) => { if (mainFrame) clearDelegated(); };
      const destroyed = () => clearDelegated();
      target.on("did-start-navigation", navigation);
      target.once("destroyed", destroyed);
      delegated = { target, frame: target.mainFrame, url: target.mainFrame.url, grant,
        cleanup: () => { target.removeListener("did-start-navigation", navigation); target.removeListener("destroyed", destroyed); } };
    },
    // What the owner still has to allow in the system's settings for this kind; null when nothing.
    access(kind: unknown): string | null {
      owner();
      const type = media(kind);
      const setting = settings[process.platform]?.[type];
      return setting && systemPreferences.getMediaAccessStatus(type) !== "granted" ? setting[1] : null;
    },
    async openSettings(kind: unknown) {
      owner();
      const setting = settings[process.platform]?.[media(kind)];
      if (setting) await shell.openExternal(setting[0]);
    },
    async sources(): Promise<CaptureSource[]> {
      const frame = owner();
      const request = generation;
      // Pictures only for this computer's own Couch: another Couch's page (Client mode) would see a window's
      // content before the owner allows it, so it gets names alone.
      const pictures = origin() === localOrigin;
      const found = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: pictures ? { width: 320, height: 200 } : { width: 0, height: 0 } });
      if (request !== generation || frame !== owner()) throw new Error("Couch changed while choosing a source. Choose it again.");
      sources = found.map(({ id, name }) => ({ id, name, kind: id.startsWith("screen:") ? "screen" : "window" }));
      return found.map(({ thumbnail }, index) => ({ ...sources[index]!, ...pictures && thumbnail && !thumbnail.isEmpty() ? { thumbnail: thumbnail.toDataURL() } : {} }));
    },
    async prepare(selection: unknown): Promise<void> {
      revoke();
      const request = generation;
      const frame = owner();
      if (selection === null) return;
      if (!selection || typeof selection !== "object" || !("kind" in selection) || typeof selection.kind !== "string"
        || !["system-audio", "screen", "microphone"].includes(selection.kind)) throw new Error("Choose what to share.");
      const choice = selection as CaptureSelection;
      // Audio is part of what the owner allows: a screen includes it only when asked; PC audio always does.
      if (choice.audio !== undefined && typeof choice.audio !== "boolean" || choice.kind === "system-audio" && choice.audio === false) {
        throw new Error("Choose what to share.");
      }
      if (choice.kind === "system-audio" && !systemAudio()) throw new Error(process.platform === "darwin"
        ? "PC audio sharing requires macOS 14.2 or later. You can still share a screen or an audio input."
        : "PC audio capture is not available on this system. Choose an audio input instead.");
      const requesting = origin()!;
      if (choice.kind === "microphone" && requesting !== localOrigin) {
        const allowed = await ask(`Allow ${requesting} to use this computer's microphone?`,
          "Allow only if you just chose a microphone or audio input to share there.");
        if (request !== generation || frame !== owner()) throw new Error("Couch changed while requesting capture. Start sharing again.");
        if (!allowed) throw new Error("Microphone sharing wasn't allowed on this computer.");
      }
      // Name the source from this computer's own list, not the page's.
      const source = choice.kind === "microphone" ? undefined : sources.find(source => source.id === choice.sourceId);
      if (choice.kind !== "microphone" && !source) throw new Error("Choose a screen or window before sharing.");
      if (choice.kind === "microphone" && process.platform === "darwin" && !await systemPreferences.askForMediaAccess("microphone")) {
        throw new Error("Allow Couch to use the microphone in System Settings → Privacy & Security → Microphone, then restart Couch.");
      }
      if (request !== generation || frame !== owner()) throw new Error("Couch changed while requesting capture. Start sharing again.");
      pending = { frame, origin: requesting, selection: { kind: choice.kind, audio: choice.kind !== "screen" || choice.audio === true }, source, expires: Date.now() + 30_000, issued: false };
    },
    install() {
      session.defaultSession.setPermissionRequestHandler((requester, permission, allow, details) => {
        const local = trusted(requester, details.requestingUrl, details.isMainFrame);
        const grant = prepared();
        const microphone = permission === "media" && grant?.selection.kind === "microphone" && "mediaTypes" in details
          && details.mediaTypes?.length === 1 && details.mediaTypes[0] === "audio";
        // Electron 44 requests display capture as media with no microphone/camera mediaTypes.
        const display = permission === "media" && grant && !grant.issued && grant.selection.kind !== "microphone" && "mediaTypes" in details && details.mediaTypes?.length === 0;
        allow(permission === "fullscreen" || local && (permission === "display-capture" && !!grant && !grant.issued || microphone || !!display) || microphone && targetedMicrophone(requester, details.requestingUrl, details.isMainFrame));
      });
      session.defaultSession.setPermissionCheckHandler((requester, permission, requestingOrigin, details) => {
        const grant = prepared();
        // Chromium checks an issued display device again while opening it, without a mediaType.
        return permission === "fullscreen" || trusted(requester, requestingOrigin, details.isMainFrame)
          && (permission === "display-capture" && !!grant && !grant.issued
            || permission === "media" && (details.mediaType === "audio" && grant?.selection.kind === "microphone"
              || details.mediaType === undefined && grant?.issued === true && grant.selection.kind !== "microphone"))
          || permission === "media" && details.mediaType === "audio" && targetedMicrophone(requester, requestingOrigin, details.isMainFrame);
      });
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        // Electron denies with null, which its types omit; an empty answer also throws.
        const deny = () => callback(null!);
        const grant = prepared();
        const page = contents();
        const source = grant?.source;
        if (!grant || grant.issued || !page || request.frame !== grant.frame || !trusted(page, request.securityOrigin, true)
          || !request.userGesture || !request.videoRequested || !source || grant.selection.kind === "system-audio" && !request.audioRequested) return deny();
        const streams = { video: source, ...grant.selection.audio && request.audioRequested && systemAudio() ? { audio: "loopback" as const } : {} };
        if (grant.origin === localOrigin) { grant.issued = true; return callback(streams); }
        // Asked here rather than when preparing: the page's click only lasts a few seconds,
        // and Chromium checks it when the page requests the display, not when this answers.
        grant.issued = "asking";
        const asked = generation;
        const picture = `the ${source.kind} “${source.name}”`;
        const prompt = grant.selection.kind === "system-audio"
          ? ask(`Allow ${grant.origin} to hear this computer's audio?`, `Only the sound is shared, but that page also gets the picture of ${picture}. Allow only if you just chose to share this computer's audio there.`)
          : ask(`Allow ${grant.origin} to see ${picture}${streams.audio ? " and hear this computer's audio" : ""}?`, `Allow only if you just chose ${picture} to share there.${streams.audio ? " The sound is everything this computer plays." : ""}`);
        void prompt.catch(() => false).then(allowed => {
          if (asked === generation && current(grant) && allowed) {
            grant.issued = true;
            grant.expires = Date.now() + 30_000;
            return callback(streams);
          }
          if (asked === generation) revoke();
          deny();
        });
      });
    },
  };
}

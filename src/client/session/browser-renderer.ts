import { isAdaptiveSource, loadDashLibrary, manifestTracks, type DashPlayer } from "./browser-dash";
import type { MediaTrack, PlaybackCommand, PlayerState } from "../../shared/protocol";

// One lazy element per authenticated connection; route components never own it.
export function createBrowserRenderer(report: (state: PlayerState) => void, importDash = loadDashLibrary) {
  let media: HTMLVideoElement | null = null;
  let teardown: Promise<unknown> | null = null;
  let fatal = false;
  let dash = false;
  let dashSpeed = 1;
  let adaptive: { player: DashPlayer; tracks: ReturnType<typeof manifestTracks> } | null = null;
  const seekRange = () => {
    const range = adaptive?.player.seekRange();
    return range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start ? range : undefined;
  };
  let applyDashSpeed = () => {};
  let volume = 1;
  try { const saved = Number(localStorage.getItem("couch.browser-volume") ?? 1); if (Number.isFinite(saved)) volume = Math.min(1, Math.max(0, saved)); } catch { /* Storage is optional. */ }
  let requiresGesture = false;
  const audioTracks = () => dash ? undefined : (media as (HTMLVideoElement & { audioTracks?: ArrayLike<{ id: string; label: string; language: string; enabled: boolean }> }) | null)?.audioTracks;
  let load: Extract<PlaybackCommand, { type: "load" }> | null = null;
  let cleanup = () => {};
  let failure: string | null = null;
  let initializing = false;
  let buffering = false;
  let initialSeek = false;
  const snapshot = (): PlayerState & { live?: boolean; seekRange?: { start: number; end: number } } => {
    const range = load?.radio ? undefined : seekRange();
    const live = !!adaptive && (adaptive.player.isLive() || adaptive.player.isInProgress());
    const tracks: MediaTrack[] = media && load ? [
      ...(adaptive?.tracks.read() ?? []),
      ...Array.from(audioTracks() ?? [], (track, index): MediaTrack => ({ id: track.id || `audio-${index}`, index, kind: "audio", label: track.label, language: track.language, selected: track.enabled })),
      ...(media.videoWidth ? [{ id: "default-video", index: 0, kind: "video" as const, label: "Video", language: "", selected: true }] : []),
    ] : [];
    return { playbackId: load?.playbackId ?? null,
      status: !load ? "idle" : fatal || media?.error ? "error" : initializing || media?.seeking || (buffering && !media?.paused) ? "loading" : media?.ended ? "ended" : media?.paused ? "paused" : "playing",
      position: Number.isFinite(media?.currentTime) ? media!.currentTime : 0,
      duration: !live && Number.isFinite(media?.duration) ? media!.duration : null,
      ...(adaptive ? { live, seekRange: range } : {}),
      volume: (media?.volume ?? volume) * 100, seekable: (dash ? !!range : !!media?.seekable.length) && !load?.radio,
      speed: dash ? dashSpeed : media?.playbackRate ?? 1, tracks, audioTracksKnown: !!adaptive || audioTracks() !== undefined, buffering, requiresGesture, error: failure ?? (media?.error ? `This browser cannot play the source (${media.error.message || media.error.code}). Try Couch TV.` : null) };
  };
  const emit = () => report(snapshot());
  const play = () => {
    if (!media || !load || fatal) return;
    const attempt = load;
    failure = null; requiresGesture = false;
    void media.play().then(() => { if (load === attempt) emit(); }).catch(error => {
      if (load !== attempt) return;
      requiresGesture = error instanceof DOMException && error.name === "NotAllowedError";
      failure = requiresGesture ? "Playback needs a click. Press Play here on this browser." : `This browser could not start playback: ${String(error).slice(0, 200)}`;
      emit();
    });
  };
  const element = () => {
    if (media) return media;
    media = document.createElement("video");
    media.id = "couch-browser-video";
    media.playsInline = true;
    media.preload = "auto";
    media.setAttribute("aria-label", "Browser playback");
    media.volume = volume;
    document.body.prepend(media);
    return media;
  };
  const stop = () => {
    cleanup(); cleanup = () => {};
    load = null; fatal = false; failure = null; requiresGesture = false; initializing = false; buffering = false;
    if (media) { media.pause(); if (!teardown) { media.removeAttribute("src"); media.load(); } }
    emit();
  };
  return {
    play,
    report: emit,
    command(command: PlaybackCommand) {
      if (command.type === "stop") { stop(); return; }
      if (command.type === "load") {
        cleanup();
        const video = element();
        video.pause();
        load = command; dash = isAdaptiveSource(command.source); fatal = false; failure = null; requiresGesture = false; initializing = true; initialSeek = false; buffering = false;
        dashSpeed = command.preferences?.speed ?? 1;
        let dashReady = !dash;
        let player: DashPlayer | null = null;
        let setup: Promise<void> | null = null;
        let cancelled = false;
        const current = () => load === command && !cancelled;
        const notify = () => { if (current()) emit(); };
        const ready = () => {
          if (!current() || (dash && !dashReady) || video.readyState < 2 || video.seeking) return;
          if (!initializing) { buffering = false; emit(); return; }
          if (!initialSeek) {
            video.playbackRate = command.preferences?.speed ?? 1;
            initialSeek = true;
            if (command.startPosition && video.seekable.length) { video.currentTime = command.startPosition; return; }
          }
          initializing = false; buffering = false;
          if (!command.paused) play();
          emit();
        };
        const waiting = () => { buffering = true; notify(); };
        const events = ["pause", "playing", "timeupdate", "durationchange", "volumechange", "ratechange", "ended", "error"];
        for (const event of events) video.addEventListener(event, notify);
        video.addEventListener("canplay", ready);
        video.addEventListener("seeked", ready);
        video.addEventListener("waiting", waiting);
        cleanup = () => {
          if (cancelled) return;
          cancelled = true;
          applyDashSpeed = () => {};
          adaptive = null;
          if (setup) {
            const pending = setup.then(async () => { await player?.destroy(); });
            teardown = pending.catch(() => {}).then(() => { if (teardown === settled) teardown = null; });
            const settled = teardown;
          }
          for (const event of events) video.removeEventListener(event, notify); video.removeEventListener("canplay", ready); video.removeEventListener("seeked", ready); video.removeEventListener("waiting", waiting); };
        video.playbackRate = command.preferences?.speed ?? 1;
        const fail = (code: unknown) => {
          if (!current()) return;
          fatal = true; initializing = false; buffering = false;
          failure = `This browser cannot play ${/\.m3u8(?:$|[?#])/i.test(command.source) ? "HLS" : "DASH"} (${typeof code === "number" ? code : "unsupported"}). Try Couch TV.`;
          cleanup();
          video.pause(); emit();
        };
        const begin = () => {
          if (!current()) return;
          if (!dash) { video.src = command.source; video.load(); return; }
          video.removeAttribute("src");
          video.load();
          setup = (async () => {
            const library = await importDash();
            if (!current()) return;
            library.polyfill.installAll();
            if (!library.Player.isBrowserSupported()) { fail("unsupported"); return; }
            player = new library.Player();
            player.addEventListener("error", event => { if (event.detail?.severity === 2) fail(event.detail.code); });
            for (const event of ["trackschanged", "audiotrackschanged", "adaptation", "variantchanged", "textchanged", "manifestupdated"]) player.addEventListener(event, notify);
            player.configure({
              ...(command.preferences?.audioLanguage ? { preferredAudio: [{ language: command.preferences.audioLanguage }] } : {}),
              preferredText: command.preferences?.subtitles === "auto" && command.preferences.subtitleLanguage ? [{ language: command.preferences.subtitleLanguage }] : [],
              accessibility: { handleForcedSubtitlesAutomatically: false },
              ...(command.maxVideoHeight ? { restrictions: { maxHeight: command.maxVideoHeight } } : {}),
            });
            await player.attach(video);
            if (!current()) return;
            initialSeek = true;
            void player.load(command.source, command.goLive || command.radio ? undefined : command.startPosition).then(() => {
              if (!current() || fatal) return;
              adaptive = { player: player!, tracks: manifestTracks(player!) };
              if (command.preferences?.subtitles !== "auto") player!.selectTextTrack(null);
              if (command.eventStart && !command.radio) { const range = seekRange(); if (range) video.currentTime = range.start; }
              applyDashSpeed = () => player!.trickPlay(dashSpeed, false);
              applyDashSpeed();
              dashReady = true; ready();
            }).catch(error => fail(error?.code));
          })().catch(error => fail(error?.code));
        };
        if (teardown) void teardown.then(begin); else begin();
        emit(); return;
      }
      if (command.type === "volume") {
        volume = command.volume / 100;
        if (media) media.volume = volume;
        try { localStorage.setItem("couch.browser-volume", String(volume)); } catch { /* Storage is optional. */ }
        emit(); return;
      }
      if (!media) return;
      if ("playbackId" in command && command.playbackId !== load?.playbackId) return;
      switch (command.type) {
        case "pause": if (command.paused) { media.pause(); emit(); } else play(); break;
        case "seek": {
          if (load?.radio) break;
          const range = seekRange();
          if (dash && !range) break;
          media.currentTime = range ? Math.min(range.end, Math.max(range.start, command.position)) : command.position;
          break;
        }
        case "speed":
          if (dash) { dashSpeed = command.speed; applyDashSpeed(); } else media.playbackRate = command.speed;
          emit(); break;
        case "track": {
          if (adaptive) { adaptive.tracks.select(command.kind, command.index); emit(); break; }
          const tracks = audioTracks();
          if (command.kind === "audio" && tracks?.[command.index]) Array.from(tracks).forEach((track, index) => { track.enabled = index === command.index; });
          emit(); break;
        }
      }
    },
    close() { stop(); media?.remove(); media = null; },
  };
}

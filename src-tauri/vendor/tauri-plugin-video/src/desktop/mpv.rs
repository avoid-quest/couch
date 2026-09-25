use std::{
    collections::BTreeMap,
    mem::ManuallyDrop,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender, TrySendError},
        Arc, Mutex, Weak,
    },
    time::Duration,
};

use libmpv2::{
    events::{mpv_event_id, Event},
    mpv_end_file_reason, Mpv,
};
use tauri::{AppHandle, Runtime};

use crate::{
    Error, MpvChapter, MpvPlaybackState, NativeControlRequest, NativeLayoutRequest,
    NativeNextSource, NativeOpenRequest, NativePlaybackSnapshot, NativePrepareRequest,
    NativeSessionRequest, NativeSubtitle, NativeTrackInfo, Result, TrackKind,
};

#[cfg(target_os = "macos")]
#[path = "mpv/macos.rs"]
mod surface;
#[cfg(windows)]
#[path = "mpv/windows.rs"]
mod surface;
use surface::Surface;

fn audio_device(output: &str) -> String {
    #[cfg(windows)]
    { format!("wasapi/{output}") }
    #[cfg(target_os = "macos")]
    { format!("coreaudio/{output}") }
}

#[cfg(test)]
#[test]
fn explicit_core_audio_device_is_a_writable_mpv_property() {
    let mpv = Mpv::with_initializer(|init| init.set_option("audio-fallback-to-null", "yes")).unwrap();
    mpv.set_property("audio-device", "coreaudio/couch-nonexistent-output").unwrap();
    assert_eq!(mpv.get_property::<String>("audio-device").unwrap(), "coreaudio/couch-nonexistent-output");
}

type Job<R> = Box<dyn FnOnce(&mut Worker<R>) + Send>;

pub struct MpvVideo<R: Runtime> {
    sender: Mutex<Option<Arc<SyncSender<Job<R>>>>>,
    worker: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl<R: Runtime> MpvVideo<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        let (sender, receiver) = mpsc::sync_channel::<Job<R>>(32);
        let sender = Arc::new(sender);
        let wakeup = Arc::downgrade(&sender);
        let worker = std::thread::Builder::new()
            .name("couch-desktop-mpv".into())
            .spawn(move || {
                let mut worker = Worker {
                    app,
                    player: None,
                    wakeup,
                };
                while let Ok(job) = receiver.recv() {
                    job(&mut worker);
                }
                worker.player.take();
            })
            .expect("Cannot start the Desktop playback worker");
        Self { sender: Mutex::new(Some(sender)), worker: Mutex::new(Some(worker)) }
    }

    fn call<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&mut Worker<R>) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let (reply, receiver) = mpsc::sync_channel(1);
        let queued = super::QueuedCall::new();
        let started = queued.clone();
        let sender = self.sender.lock().expect("mpv sender lock poisoned").clone()
            .ok_or_else(|| Error::Pipeline("Desktop playback worker stopped".into()))?;
        sender
            .try_send(Box::new(move |worker| {
                if started.start() {
                    let _ = reply.send(operation(worker));
                }
            }))
            .map_err(|error| match error {
                TrySendError::Full(_) => Error::Pipeline("Desktop playback queue is full".into()),
                TrySendError::Disconnected(_) => {
                    Error::Pipeline("Desktop playback worker stopped".into())
                }
            })?;
        receiver
            .recv_timeout(Duration::from_secs(15))
            .map_err(|error| {
                if queued.expire() {
                    Error::Pipeline(format!("Desktop playback command expired: {error}"))
                } else {
                    Error::DispatcherInFlight
                }
            })?
    }

    pub fn open(&self, request: NativeOpenRequest) -> Result<NativePlaybackSnapshot> {
        self.call(move |worker| worker.open(request))
    }
    pub fn control(&self, request: NativeControlRequest) -> Result<NativePlaybackSnapshot> {
        self.call(move |worker| worker.control(request))
    }
    pub fn prepare(&self, request: NativePrepareRequest) -> Result<NativePlaybackSnapshot> {
        self.call(move |worker| worker.prepare(request))
    }
    pub fn layout(&self, request: NativeLayoutRequest) -> Result<()> {
        self.call(move |worker| worker.layout(request))
    }
    pub fn stats(&self, request: NativeSessionRequest) -> Result<NativePlaybackSnapshot> {
        self.call(move |worker| worker.stats(request))
    }
    pub fn close(&self, request: NativeSessionRequest) -> Result<()> {
        self.call(move |worker| worker.close(request))
    }
    pub fn shutdown(&self) {
        self.sender.lock().expect("mpv sender lock poisoned").take();
        if let Some(worker) = self.worker.lock().expect("mpv worker lock poisoned").take() {
            if worker.join().is_err() { tracing::error!("Desktop mpv worker panicked during shutdown"); }
        }
    }
    pub fn diagnostic_properties(
        &self,
        request: NativeSessionRequest,
    ) -> Result<std::collections::BTreeMap<String, Option<String>>> {
        self.call(move |worker| {
            let player = worker.player(&request.session_key)?;
            Ok([
                "mpv-version",
                "hwdec-current",
                "current-vo",
                "current-ao",
                "audio-device",
                "video-codec",
            ]
            .into_iter()
            .map(|name| {
                (
                    name.to_string(),
                    player
                        .mpv
                        .get_property::<String>(name)
                        .ok()
                        .map(|value| value.chars().take(200).collect()),
                )
            })
            .collect())
        })
    }
}

struct Worker<R: Runtime> {
    app: AppHandle<R>,
    player: Option<Player<R>>,
    wakeup: Weak<SyncSender<Job<R>>>,
}

struct Player<R: Runtime> {
    mpv: ManuallyDrop<Mpv>,
    surface: Surface<R>,
    key: String,
    playback_id: String,
    source_headers: BTreeMap<String, String>,
    next: Option<NativeNextSource>,
    cue: bool,
    can_prepare_next: bool,
    loaded: bool,
    error: Option<String>,
    radio: bool,
    max_video_height: Option<u16>,
    replay_gain: crate::mpv_replaygain::ReplayGain,
    pending_subtitles: Vec<NativeSubtitle>,
    subtitle_error: Option<String>,
}

impl<R: Runtime> Drop for Player<R> {
    fn drop(&mut self) {
        let _ = self.mpv.command("stop", &[]);
        #[cfg(target_os = "macos")]
        if let Err(error) = self.surface.destroy() {
            // The render context still refers to mpv, so keep both until process exit.
            tracing::error!("Could not destroy Mac video view before mpv: {error}");
            return;
        }
        #[cfg(target_os = "macos")]
        unsafe { ManuallyDrop::drop(&mut self.mpv) };
        #[cfg(windows)]
        unsafe { ManuallyDrop::take(&mut self.mpv) }.terminate();
        #[cfg(windows)]
        if let Err(error) = self.surface.destroy() {
            tracing::error!("Could not destroy Windows video HWND after mpv: {error}");
        }
    }
}

fn mpv_error(error: libmpv2::Error) -> Error {
    Error::Pipeline(error.to_string())
}

fn playback_status(mpv: &Mpv, loaded: bool, has_error: bool) -> (bool, bool, bool) {
    let eof = loaded && mpv.get_property::<bool>("eof-reached").unwrap_or(false);
    let buffering = mpv
        .get_property::<bool>("paused-for-cache")
        .unwrap_or(false);
    let playing = loaded
        && !mpv.get_property::<bool>("pause").unwrap_or(true)
        && !buffering
        && !eof
        && !has_error;
    (eof, buffering, playing)
}

fn validate_open(request: &NativeOpenRequest) -> Result<()> {
    if request
        .backend
        .as_deref()
        .is_some_and(|backend| backend != "mpv")
    {
        return Err(Error::InvalidRequest("Desktop playback requires mpv".into()));
    }
    Ok(())
}

fn configure_media(mpv: &Mpv, request: &NativeOpenRequest) -> Result<()> {
    crate::mpv_tracks::reset(mpv, request.max_video_height)?;
    crate::mpv_radio::NetworkDefaults::read(mpv)?.configure(mpv, request.radio)?;
    crate::mpv_iptv::LiveStartDefaults::read(mpv)?.configure(
        mpv,
        request.go_live,
        request.event_start,
    )?;
    mpv.command("change-list", &["audio-files", "clr", ""])
        .map_err(mpv_error)?;
    if let Some(uri) = request.audio_uri.as_deref() {
        mpv.command("change-list", &["audio-files", "append", uri])
            .map_err(mpv_error)?;
    }
    crate::mpv_startup::StartupBuffer::read(mpv)?.configure(
        mpv,
        &request.uri,
        request.audio_uri.as_deref(),
        request.radio || request.go_live,
    )?;
    let mut headers = request.headers.clone();
    if let Some(value) = request.cookies.as_ref().filter(|value| !value.is_empty()) {
        headers.insert("Cookie".into(), value.clone());
    }
    if let Some(value) = request.referrer.as_ref().filter(|value| !value.is_empty()) {
        headers.insert("Referer".into(), value.clone());
    }
    mpv.command("change-list", &["http-header-fields", "clr", ""])
        .map_err(mpv_error)?;
    for (name, value) in headers {
        mpv.command(
            "change-list",
            &["http-header-fields", "append", &format!("{name}: {value}")],
        )
        .map_err(mpv_error)?;
    }
    mpv.set_property(
        "user-agent",
        request
            .user_agent
            .as_deref()
            .unwrap_or("tauri-plugin-video"),
    )
    .map_err(mpv_error)?;
    mpv.set_property("tls-ca-file", request.tls_ca_file.as_deref().unwrap_or(""))
        .map_err(mpv_error)
}

fn configure_start(mpv: &Mpv, position: Option<f64>, cue: bool) -> Result<()> {
    if position.is_some_and(|value| !value.is_finite() || value < 0.0) {
        return Err(Error::InvalidRequest(
            "startPosition must be finite and nonnegative".into(),
        ));
    }
    let start = position.filter(|value| *value > 0.0).map_or_else(
        || "none".to_owned(),
        |value| crate::mpv_cue::timestamp(value, cue).to_string(),
    );
    mpv.set_property("start", start).map_err(mpv_error)
}

fn configure_end(mpv: &Mpv, position: Option<f64>) -> Result<()> {
    if position.is_some_and(|value| !value.is_finite() || value <= 0.0) {
        return Err(Error::InvalidRequest(
            "endPosition must be finite and positive".into(),
        ));
    }
    let end = position.map_or_else(
        || "none".to_owned(),
        |value| crate::mpv_cue::timestamp(value, true).to_string(),
    );
    mpv.set_property("end", end).map_err(mpv_error)
}

fn cancel_playlist(mpv: &Mpv) -> Result<()> {
    mpv.set_property("prefetch-playlist", false)
        .map_err(mpv_error)?;
    mpv.command("playlist-clear", &[]).map_err(mpv_error)
}

fn queue_audio(mpv: &Mpv, uri: &str) -> Result<()> {
    configure_start(mpv, None, false)?;
    configure_end(mpv, None)?;
    mpv.set_property("prefetch-playlist", true)
        .map_err(mpv_error)?;
    if let Err(error) = mpv.command("loadfile", &[uri, "append"]) {
        let _ = mpv.set_property("prefetch-playlist", false);
        return Err(mpv_error(error));
    }
    Ok(())
}

impl<R: Runtime> Worker<R> {
    fn open(&mut self, request: NativeOpenRequest) -> Result<NativePlaybackSnapshot> {
        validate_open(&request)?;
        self.player.take();
        #[cfg(target_os = "macos")]
        if unsafe { libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr()) }.is_null() {
            return Err(Error::Pipeline("mpv requires the C numeric locale".into()));
        }
        let mut surface = Surface::new(&self.app)?;
        let mut mpv = Mpv::with_initializer(|init| {
            surface.configure(&init)?;
            init.set_option("hwdec", "auto-safe")?;
            init.set_option("video-timing-offset", 0.0_f64)?;
            init.set_option("keep-open", "yes")?;
            init.set_option("osc", "no")?;
            init.set_option("ytdl", "no")?;
            init.set_option("audio-display", "no")?;
            init.set_option("audio-fallback-to-null", "yes")?;
            init.set_option("osd-level", "0")?;
            init.set_option("input-default-bindings", "no")?;
            Ok(())
        })
        .map_err(mpv_error)?;
        mpv.disable_deprecated_events().map_err(mpv_error)?;
        mpv.disable_event(mpv_event_id::Tick).map_err(mpv_error)?;
        mpv.hook_add("on_preloaded", 0).map_err(mpv_error)?;
        // The preload hook must run before the host's next snapshot poll.
        let wakeup = self.wakeup.clone();
        let pending = Arc::new(AtomicBool::new(false));
        mpv.set_wakeup_callback(move || {
            if pending.swap(true, Ordering::AcqRel) {
                return;
            }
            if let Some(sender) = wakeup.upgrade() {
                let finished = pending.clone();
                if sender
                    .try_send(Box::new(move |worker: &mut Worker<R>| {
                        finished.store(false, Ordering::Release);
                        if let Some(player) = worker.player.as_mut() {
                            if let Err(error) = player.drain_events() {
                                player.error = Some(error.to_string());
                            }
                        }
                    }))
                    .is_ok()
                {
                    return;
                }
            }
            pending.store(false, Ordering::Release);
        });
        surface.attach(&mpv)?;
        let mut player = Player {
            mpv: ManuallyDrop::new(mpv),
            surface,
            key: request.session_key.clone(),
            playback_id: request.session_key.clone(),
            source_headers: request.headers.clone(),
            next: None,
            cue: request.end_position.is_some(),
            can_prepare_next: request.audio_uri.is_none()
                && request.max_video_height.is_none()
                && !request.radio
                && !request.go_live
                && !request.event_start,
            loaded: false,
            error: None,
            radio: request.radio,
            max_video_height: request.max_video_height,
            replay_gain: crate::mpv_replaygain::ReplayGain::default(),
            pending_subtitles: request.subtitles.clone(),
            subtitle_error: None,
        };
        player.layout(request.x, request.y, request.width, request.height)?;
        crate::mpv_subtitles::reset(&player.mpv, &request.preferences)?;
        player
            .replay_gain
            .reset(&player.mpv, request.preferences.replay_gain)?;
        configure_media(&player.mpv, &request)?;
        player
            .mpv
            .set_property("volume", request.volume * 100.0)
            .map_err(mpv_error)?;
        player
            .mpv
            .set_property("mute", request.muted)
            .map_err(mpv_error)?;
        if let Some(output) = request.audio_output.as_deref() {
            player.mpv.set_property("audio-device", audio_device(output)).map_err(mpv_error)?;
        }
        player
            .mpv
            .set_property("pause", !request.autoplay)
            .map_err(mpv_error)?;
        cancel_playlist(&player.mpv)?;
        configure_start(&player.mpv, request.start_position, player.cue)?;
        configure_end(&player.mpv, request.end_position)?;
        player
            .mpv
            .command("loadfile", &[&request.uri, "replace"])
            .map_err(mpv_error)?;
        let snapshot = player.snapshot()?;
        self.player = Some(player);
        Ok(snapshot)
    }

    fn player(&mut self, key: &str) -> Result<&mut Player<R>> {
        let player = self
            .player
            .as_mut()
            .ok_or_else(|| Error::InvalidRequest("No Desktop playback session".into()))?;
        if player.key != key {
            return Err(Error::InvalidRequest("Stale Desktop playback session".into()));
        }
        Ok(player)
    }

    fn prepare(&mut self, request: NativePrepareRequest) -> Result<NativePlaybackSnapshot> {
        let player = self.player(&request.session_key)?;
        player.drain_events()?;
        player.next = None;
        cancel_playlist(&player.mpv)?;
        if player.playback_id != request.playback_id {
            // Bun canceled a successor that started before its next observation.
            player.mpv.command("stop", &[]).map_err(mpv_error)?;
            player.playback_id = request.playback_id;
            player.error = Some(
                "The queue changed during the track transition. Play a queue item to continue."
                    .into(),
            );
            return player.snapshot();
        }
        if let Some(next) = request.next {
            if !player.loaded
                || player.cue
                || !player.can_prepare_next
                || player.error.is_some()
                || next.headers != player.source_headers
            {
                return Err(Error::InvalidRequest(
                    "This source requires an ordinary queue transition.".into(),
                ));
            }
            queue_audio(&player.mpv, &next.uri)?;
            player.next = Some(next);
        }
        player.snapshot()
    }

    fn control(&mut self, request: NativeControlRequest) -> Result<NativePlaybackSnapshot> {
        let player = self.player(&request.session_key)?;
        player.drain_events()?;
        if request
            .playback_id
            .as_deref()
            .is_some_and(|id| id != player.playback_id)
        {
            return player.snapshot();
        }
        match request.action.as_str() {
            "track" | "deselectTrack" => {
                player.select_track(request.index, request.action == "track")?
            }
            "addSubtitle" => {
                let subtitle = request.subtitle.as_ref().ok_or_else(|| {
                    Error::InvalidRequest("Subtitle attachment is missing".into())
                })?;
                player.subtitle_error = if player.loaded {
                    crate::mpv_subtitles::add(&player.mpv, subtitle, true)
                        .err()
                        .map(|_| crate::mpv_subtitles::LOAD_ERROR.into())
                } else {
                    Some("Wait for playback to load before adding subtitles.".into())
                };
            }
            "replayGain" => player.replay_gain.set_mode(
                &player.mpv,
                request
                    .replay_gain
                    .ok_or_else(|| Error::InvalidRequest("ReplayGain mode is missing".into()))?,
            )?,
            _ => {
                let mpv = &player.mpv;
                match request.action.as_str() {
                    "play" => mpv.set_property("pause", false),
                    "pause" | "audioPause" => mpv.set_property("pause", true),
                    "seek" => mpv.command(
                        "seek",
                        &[
                            &crate::mpv_cue::timestamp(request.value.max(0.0), player.cue)
                                .to_string(),
                            "absolute+exact",
                        ],
                    ),
                    "volume" => mpv.set_property("volume", request.value * 100.0),
                    "audioOutput" => mpv.set_property("audio-device", audio_device(request.audio_output.as_deref().ok_or_else(|| Error::InvalidRequest("Audio output is missing".into()))?)),
                    "speed" => mpv.set_property("speed", request.value),
                    "audioDelay" => mpv.set_property("audio-delay", request.value),
                    "subtitleDelay" => mpv.set_property("sub-delay", request.value),
                    "subtitlesOff" => mpv.set_property("sid", "no"),
                    _ => {
                        return Err(Error::InvalidRequest(format!(
                            "Desktop player does not support {} yet",
                            request.action
                        )))
                    }
                }
                .map_err(mpv_error)?;
            }
        }
        player.snapshot()
    }

    fn layout(&mut self, request: NativeLayoutRequest) -> Result<()> {
        self.player(&request.session_key)?.layout(
            request.x,
            request.y,
            request.width,
            request.height,
        )
    }

    fn stats(&mut self, request: NativeSessionRequest) -> Result<NativePlaybackSnapshot> {
        self.player(&request.session_key)?.snapshot()
    }

    fn close(&mut self, request: NativeSessionRequest) -> Result<()> {
        if self
            .player
            .as_ref()
            .is_some_and(|player| player.key == request.session_key)
        {
            self.player.take();
        }
        Ok(())
    }
}

impl<R: Runtime> Player<R> {
    fn select_track(&self, index: i32, enabled: bool) -> Result<()> {
        select_track(&self.mpv, index, enabled)
    }

    fn layout(&mut self, x: f64, y: f64, width: f64, height: f64) -> Result<()> {
        self.surface.layout(x, y, width, height)
    }

    fn drain_events(&mut self) -> Result<()> {
        while let Some(event) = self.mpv.wait_event(0.0) {
            match event.map_err(mpv_error)? {
                Event::StartFile => {
                    if let Some(next) = self.next.take() {
                        self.playback_id = next.playback_id;
                        self.source_headers = next.headers;
                        self.loaded = false;
                        self.error = None;
                        self.cue = false;
                        self.pending_subtitles.clear();
                        self.subtitle_error = None;
                        crate::mpv_subtitles::reset(&self.mpv, &next.preferences)?;
                        self.replay_gain
                            .reset(&self.mpv, next.preferences.replay_gain)?;
                    }
                }
                Event::FileLoaded => self.loaded = true,
                Event::Hook { id } => {
                    let selection = crate::mpv_tracks::select(&self.mpv, self.max_video_height)
                        .and_then(|()| self.replay_gain.select(&self.mpv, self.radio));
                    if selection.is_ok() {
                        for subtitle in std::mem::take(&mut self.pending_subtitles) {
                            if crate::mpv_subtitles::add(&self.mpv, &subtitle, false).is_err() {
                                self.subtitle_error = Some(crate::mpv_subtitles::LOAD_ERROR.into());
                            }
                        }
                    }
                    unsafe { self.mpv.hook_continue(id) }.map_err(mpv_error)?;
                    selection?;
                }
                Event::EndFile(mpv_end_file_reason::Error) => {
                    self.error = Some("mpv could not play this source".into())
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn snapshot(&mut self) -> Result<NativePlaybackSnapshot> {
        self.drain_events()?;
        let mpv = &self.mpv;
        let tracks = observed_tracks(mpv);
        let position = mpv
            .get_property::<f64>("time-pos")
            .ok()
            .filter(|value| value.is_finite())
            .unwrap_or(0.0);
        let (ended, buffering, playing) = playback_status(mpv, self.loaded, self.error.is_some());
        let chapters = observed_chapters(mpv);
        let (frames, render_error) = self.surface.status(mpv)?;
        if render_error < 0 {
            self.error
                .get_or_insert_with(|| format!("Desktop video rendering failed ({render_error})"));
        }
        Ok(NativePlaybackSnapshot {
            mpv_state: Some(MpvPlaybackState {
                playback_id: Some(self.playback_id.clone()),
                error: self.error.clone(),
                volume: mpv.get_property::<f64>("volume").unwrap_or(80.0) / 100.0,
                seekable: self.loaded && mpv.get_property::<bool>("seekable").unwrap_or(false),
                ended,
                loading: (!self.loaded || buffering) && self.error.is_none(),
                buffering: self.loaded && buffering,
                speed: mpv.get_property::<f64>("speed").unwrap_or(1.0),
                audio_delay: mpv.get_property::<f64>("audio-delay").unwrap_or(0.0),
                subtitle_delay: mpv.get_property::<f64>("sub-delay").unwrap_or(0.0),
                replay_gain: self.replay_gain.observe(mpv)?,
                subtitle_error: self.subtitle_error.clone(),
                now_playing: if self.radio && self.loaded && !ended {
                    crate::mpv_radio::now_playing(mpv)
                } else {
                    None
                },
                chapters,
            }),
            duration_seconds: mpv
                .get_property::<f64>("duration")
                .ok()
                .filter(|value| value.is_finite())
                .unwrap_or(0.0),
            current_time_seconds: position,
            buffered_seconds: 0.0,
            playing,
            video_width: mpv
                .get_property::<i64>("video-params/w")
                .unwrap_or(0)
                .max(0) as u32,
            video_height: mpv
                .get_property::<i64>("video-params/h")
                .unwrap_or(0)
                .max(0) as u32,
            tracks,
            presented_frames: frames,
            dropped_frames: mpv
                .get_property::<i64>("frame-drop-count")
                .unwrap_or(0)
                .max(0) as u64,
            measured_fps: mpv.get_property::<f64>("container-fps").unwrap_or(0.0),
            hardware_backend: format!(
                "{}:{}:{}",
                self.surface.backend(),
                mpv.get_property::<String>("hwdec-current")
                    .unwrap_or_default(),
                mpv.get_property::<String>("current-ao").unwrap_or_default()
            ),
            encoded_bytes_buffered: 0,
            average_frame_processing_us: 0.0,
        })
    }
}

fn select_track(mpv: &Mpv, index: i32, enabled: bool) -> Result<()> {
    let count = mpv
        .get_property::<i64>("track-list/count")
        .map_err(mpv_error)?;
    if index < 0 || i64::from(index) >= count {
        return Err(Error::InvalidRequest(format!(
            "unknown native track index {index}"
        )));
    }
    let prefix = format!("track-list/{index}");
    let property = match mpv
        .get_property::<String>(&format!("{prefix}/type"))
        .map_err(mpv_error)?
        .as_str()
    {
        "video" => "vid",
        "audio" => "aid",
        "sub" => "sid",
        _ => {
            return Err(Error::InvalidRequest(format!(
                "unknown native track index {index}"
            )))
        }
    };
    if enabled {
        mpv.set_property(
            property,
            mpv.get_property::<i64>(&format!("{prefix}/id"))
                .map_err(mpv_error)?,
        )
    } else {
        mpv.set_property(property, "no")
    }
    .map_err(mpv_error)
}

fn observed_tracks(mpv: &Mpv) -> Vec<NativeTrackInfo> {
    let mut tracks = Vec::new();
    for index in 0..mpv.get_property::<i64>("track-list/count").unwrap_or(0) {
        let prefix = format!("track-list/{index}");
        let kind = match mpv
            .get_property::<String>(&format!("{prefix}/type"))
            .unwrap_or_default()
            .as_str()
        {
            "video" => TrackKind::Video,
            "audio" => TrackKind::Audio,
            "sub" => TrackKind::Subtitle,
            _ => continue,
        };
        tracks.push(NativeTrackInfo {
            id: index.to_string(),
            index: index as i32,
            kind,
            language: mpv
                .get_property::<String>(&format!("{prefix}/lang"))
                .unwrap_or_default(),
            label: mpv
                .get_property::<String>(&format!("{prefix}/title"))
                .unwrap_or_default(),
            codec: mpv
                .get_property::<String>(&format!("{prefix}/codec"))
                .unwrap_or_default(),
            selected: mpv
                .get_property::<bool>(&format!("{prefix}/selected"))
                .unwrap_or(false),
        });
    }
    tracks
}

fn observed_chapters(mpv: &Mpv) -> Vec<MpvChapter> {
    (0..mpv.get_property::<i64>("chapter-list/count").unwrap_or(0))
        .filter_map(|index| {
            let position = mpv
                .get_property::<f64>(&format!("chapter-list/{index}/time"))
                .ok()?;
            if !position.is_finite() || position < 0.0 {
                return None;
            }
            let title = mpv
                .get_property::<String>(&format!("chapter-list/{index}/title"))
                .ok()
                .filter(|title| !title.trim().is_empty())
                .unwrap_or_else(|| format!("Chapter {}", index + 1));
            Some(MpvChapter { title, position })
        })
        .collect()
}

#[cfg(all(test, target_os = "macos"))]
#[path = "macos_tests.rs"]
mod tests;

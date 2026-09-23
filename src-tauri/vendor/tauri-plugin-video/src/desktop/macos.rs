use std::{
    ffi::c_void,
    mem::ManuallyDrop,
    sync::mpsc::{self, SyncSender, TrySendError},
    time::Duration,
};

use libmpv2::{events::Event, mpv_end_file_reason, Mpv};
use tauri::{AppHandle, Manager, Runtime};

use crate::{
    Error, MpvPlaybackState, NativeControlRequest, NativeLayoutRequest, NativeOpenRequest,
    NativePlaybackSnapshot, NativeSessionRequest, NativeTrackInfo, Result, TrackKind,
};

unsafe extern "C" {
    fn couch_video_create(webview: *mut c_void, mpv: *mut c_void) -> *mut c_void;
    fn couch_video_layout(view: *mut c_void, x: f64, y: f64, width: f64, height: f64);
    fn couch_video_frames(view: *mut c_void) -> u64;
    fn couch_video_destroy(view: *mut c_void);
}

type Job<R> = Box<dyn FnOnce(&mut Worker<R>) + Send>;

pub struct MacVideo<R: Runtime> {
    sender: SyncSender<Job<R>>,
}

impl<R: Runtime> MacVideo<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        let (sender, receiver) = mpsc::sync_channel::<Job<R>>(32);
        std::thread::Builder::new()
            .name("couch-mac-mpv".into())
            .spawn(move || {
                let mut worker = Worker { app, player: None };
                while let Ok(job) = receiver.recv() { job(&mut worker); }
                worker.player.take();
            })
            .expect("Cannot start the Mac playback worker");
        Self { sender }
    }

    fn call<T: Send + 'static>(&self, operation: impl FnOnce(&mut Worker<R>) -> Result<T> + Send + 'static) -> Result<T> {
        let (reply, receiver) = mpsc::sync_channel(1);
        let queued = super::QueuedCall::new();
        let started = queued.clone();
        self.sender.try_send(Box::new(move |worker| {
            if started.start() { let _ = reply.send(operation(worker)); }
        })).map_err(|error| match error {
            TrySendError::Full(_) => Error::Pipeline("Mac playback queue is full".into()),
            TrySendError::Disconnected(_) => Error::Pipeline("Mac playback worker stopped".into()),
        })?;
        receiver.recv_timeout(Duration::from_secs(15)).map_err(|error| {
            if queued.expire() { Error::Pipeline(format!("Mac playback command expired: {error}")) }
            else { Error::DispatcherInFlight }
        })?
    }

    pub fn open(&self, request: NativeOpenRequest) -> Result<NativePlaybackSnapshot> { self.call(move |worker| worker.open(request)) }
    pub fn control(&self, request: NativeControlRequest) -> Result<NativePlaybackSnapshot> { self.call(move |worker| worker.control(request)) }
    pub fn layout(&self, request: NativeLayoutRequest) -> Result<()> { self.call(move |worker| worker.layout(request)) }
    pub fn stats(&self, request: NativeSessionRequest) -> Result<NativePlaybackSnapshot> { self.call(move |worker| worker.stats(request)) }
    pub fn close(&self, request: NativeSessionRequest) -> Result<()> { self.call(move |worker| worker.close(request)) }
    pub fn diagnostic_properties(&self, request: NativeSessionRequest) -> Result<std::collections::BTreeMap<String, Option<String>>> {
        self.call(move |worker| {
            let player = worker.player(&request.session_key)?;
            Ok(["mpv-version", "hwdec-current", "current-vo", "current-ao", "audio-device", "video-codec"]
                .into_iter().map(|name| (name.to_string(), player.mpv.get_property::<String>(name).ok().map(|value| value.chars().take(200).collect()))).collect())
        })
    }
}

struct Worker<R: Runtime> {
    app: AppHandle<R>,
    player: Option<Player<R>>,
}

struct Player<R: Runtime> {
    app: AppHandle<R>,
    mpv: ManuallyDrop<Mpv>,
    view: usize,
    key: String,
    loaded: bool,
    ended: bool,
    error: Option<String>,
}

impl<R: Runtime> Drop for Player<R> {
    fn drop(&mut self) {
        // The render context owns GL resources and must be freed before mpv.
        let _ = self.mpv.command("stop", &[]);
        let view = self.view;
        match on_main(&self.app, move || unsafe { couch_video_destroy(view as *mut c_void) }) {
            Ok(()) => unsafe { ManuallyDrop::drop(&mut self.mpv) },
            Err(error) => {
                // The renderer still refers to mpv. Let process exit reclaim both.
                tracing::error!("Could not destroy Mac video view before mpv: {error}");
            }
        }
    }
}

fn on_main<R: Runtime, T: Send + 'static>(app: &AppHandle<R>, operation: impl FnOnce() -> T + Send + 'static) -> Result<T> {
    let (sender, receiver) = mpsc::sync_channel(1);
    app.run_on_main_thread(move || { let _ = sender.send(operation()); })
        .map_err(|error| Error::Pipeline(format!("Mac UI dispatcher stopped: {error}")))?;
    receiver.recv().map_err(|error| Error::Pipeline(format!("Mac UI dispatcher stopped: {error}")))
}

fn mpv_error(error: libmpv2::Error) -> Error { Error::Pipeline(error.to_string()) }

fn validate_open(request: &NativeOpenRequest) -> Result<()> {
    if request.audio_uri.is_some() || request.max_video_height.is_some() || request.radio || request.go_live || request.event_start || request.end_position.is_some() {
        return Err(Error::InvalidRequest("This Mac player currently supports ordinary single-source media only".into()));
    }
    if request.backend.as_deref().is_some_and(|backend| backend != "mpv") {
        return Err(Error::InvalidRequest("Mac playback requires mpv".into()));
    }
    Ok(())
}

impl<R: Runtime> Worker<R> {
    fn open(&mut self, request: NativeOpenRequest) -> Result<NativePlaybackSnapshot> {
        validate_open(&request)?;
        self.player.take();
        if unsafe { libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr()) }.is_null() {
            return Err(Error::Pipeline("mpv requires the C numeric locale".into()));
        }
        let mpv = Mpv::with_initializer(|init| {
            init.set_option("vo", "libmpv")?;
            init.set_option("hwdec", "auto-safe")?;
            init.set_option("video-timing-offset", 0.0_f64)?;
            init.set_option("keep-open", "yes")?;
            init.set_option("osc", "no")?;
            init.set_option("ytdl", "no")?;
            init.set_option("audio-display", "no")?;
            init.set_option("osd-level", "0")?;
            init.set_option("input-default-bindings", "no")?;
            Ok(())
        }).map_err(mpv_error)?;
        mpv.disable_deprecated_events().map_err(mpv_error)?;
        let window = self.app.get_webview_window("main")
            .ok_or_else(|| Error::Pipeline("Main window is unavailable".into()))?;
        let handle = mpv.ctx.as_ptr() as usize;
        let (sender, receiver) = mpsc::sync_channel(1);
        window.with_webview(move |web| {
            let view = unsafe { couch_video_create(web.inner(), handle as *mut c_void) };
            let _ = sender.send(view as usize);
        }).map_err(|error| Error::Pipeline(error.to_string()))?;
        let view = receiver.recv().map_err(|error| Error::Pipeline(error.to_string()))?;
        if view == 0 { return Err(Error::Pipeline("Could not create Mac video renderer".into())); }
        let mut player = Player { app: self.app.clone(), mpv: ManuallyDrop::new(mpv), view, key: request.session_key.clone(), loaded: false, ended: false, error: None };
        player.layout(request.x, request.y, request.width, request.height)?;
        player.mpv.set_property("volume", request.volume * 100.0).map_err(mpv_error)?;
        player.mpv.set_property("mute", request.muted).map_err(mpv_error)?;
        player.mpv.set_property("pause", !request.autoplay).map_err(mpv_error)?;
        player.mpv.set_property("start", request.start_position.unwrap_or(0.0).to_string()).map_err(mpv_error)?;
        let headers = request.headers.iter().map(|(key, value)| format!("{key}: {value}")).collect::<Vec<_>>().join(",");
        player.mpv.set_property("http-header-fields", headers).map_err(mpv_error)?;
        player.mpv.command("loadfile", &[&request.uri, "replace"]).map_err(mpv_error)?;
        let snapshot = player.snapshot()?;
        self.player = Some(player);
        Ok(snapshot)
    }

    fn player(&mut self, key: &str) -> Result<&mut Player<R>> {
        let player = self.player.as_mut().ok_or_else(|| Error::InvalidRequest("No Mac playback session".into()))?;
        if player.key != key { return Err(Error::InvalidRequest("Stale Mac playback session".into())); }
        Ok(player)
    }

    fn control(&mut self, request: NativeControlRequest) -> Result<NativePlaybackSnapshot> {
        let player = self.player(&request.session_key)?;
        if request.playback_id.as_deref().is_some_and(|id| id != player.key) {
            return Err(Error::InvalidRequest("Stale Mac playback ID".into()));
        }
        let mpv = &player.mpv;
        match request.action.as_str() {
            "play" => mpv.set_property("pause", false),
            "pause" | "audioPause" => mpv.set_property("pause", true),
            "seek" => mpv.command("seek", &[&request.value.to_string(), "absolute+exact"]),
            "volume" => mpv.set_property("volume", request.value * 100.0),
            "speed" => mpv.set_property("speed", request.value),
            "audioDelay" => mpv.set_property("audio-delay", request.value),
            "subtitleDelay" => mpv.set_property("sub-delay", request.value),
            "subtitlesOff" => mpv.set_property("sid", "no"),
            _ => return Err(Error::InvalidRequest(format!("Mac player does not support {} yet", request.action))),
        }.map_err(mpv_error)?;
        player.snapshot()
    }

    fn layout(&mut self, request: NativeLayoutRequest) -> Result<()> {
        self.player(&request.session_key)?.layout(request.x, request.y, request.width, request.height)
    }

    fn stats(&mut self, request: NativeSessionRequest) -> Result<NativePlaybackSnapshot> {
        self.player(&request.session_key)?.snapshot()
    }

    fn close(&mut self, request: NativeSessionRequest) -> Result<()> {
        if self.player.as_ref().is_some_and(|player| player.key == request.session_key) {
            self.player.take();
        }
        Ok(())
    }
}

impl<R: Runtime> Player<R> {
    fn layout(&mut self, x: f64, y: f64, width: f64, height: f64) -> Result<()> {
        let view = self.view;
        on_main(&self.app, move || unsafe { couch_video_layout(view as *mut c_void, x, y, width, height) })
    }

    fn snapshot(&mut self) -> Result<NativePlaybackSnapshot> {
        while let Some(event) = self.mpv.wait_event(0.0) {
            match event.map_err(mpv_error)? {
                Event::FileLoaded => self.loaded = true,
                Event::EndFile(mpv_end_file_reason::Eof) => self.ended = true,
                Event::EndFile(mpv_end_file_reason::Error) => self.error = Some("mpv could not play this source".into()),
                _ => {}
            }
        }
        let mpv = &self.mpv;
        let mut tracks = Vec::new();
        for index in 0..mpv.get_property::<i64>("track-list/count").unwrap_or(0) {
            let prefix = format!("track-list/{index}");
            let kind = match mpv.get_property::<String>(&format!("{prefix}/type")).unwrap_or_default().as_str() {
                "video" => TrackKind::Video, "audio" => TrackKind::Audio, "sub" => TrackKind::Subtitle, _ => continue,
            };
            tracks.push(NativeTrackInfo {
                id: index.to_string(), index: index as i32, kind,
                language: mpv.get_property::<String>(&format!("{prefix}/lang")).unwrap_or_default(),
                label: mpv.get_property::<String>(&format!("{prefix}/title")).unwrap_or_default(),
                codec: mpv.get_property::<String>(&format!("{prefix}/codec")).unwrap_or_default(),
                selected: mpv.get_property::<bool>(&format!("{prefix}/selected")).unwrap_or(false),
            });
        }
        let position = mpv.get_property::<f64>("time-pos").unwrap_or(0.0);
        let paused = mpv.get_property::<bool>("pause").unwrap_or(true);
        let view = self.view;
        let frames = on_main(&self.app, move || unsafe { couch_video_frames(view as *mut c_void) })?;
        Ok(NativePlaybackSnapshot {
            mpv_state: Some(MpvPlaybackState {
                playback_id: Some(self.key.clone()), error: self.error.clone(),
                volume: mpv.get_property::<f64>("volume").unwrap_or(80.0) / 100.0,
                seekable: mpv.get_property::<bool>("seekable").unwrap_or(false),
                ended: self.ended || mpv.get_property::<bool>("eof-reached").unwrap_or(false),
                loading: !self.loaded && self.error.is_none(),
                speed: mpv.get_property::<f64>("speed").unwrap_or(1.0),
                audio_delay: mpv.get_property::<f64>("audio-delay").unwrap_or(0.0),
                subtitle_delay: mpv.get_property::<f64>("sub-delay").unwrap_or(0.0),
                replay_gain: None, subtitle_error: None, now_playing: None, chapters: vec![],
            }),
            duration_seconds: mpv.get_property::<f64>("duration").unwrap_or(0.0),
            current_time_seconds: position, buffered_seconds: 0.0, playing: self.loaded && !paused && !self.ended,
            video_width: mpv.get_property::<i64>("video-params/w").unwrap_or(0).max(0) as u32,
            video_height: mpv.get_property::<i64>("video-params/h").unwrap_or(0).max(0) as u32,
            tracks, presented_frames: frames,
            dropped_frames: mpv.get_property::<i64>("frame-drop-count").unwrap_or(0).max(0) as u64,
            measured_fps: mpv.get_property::<f64>("container-fps").unwrap_or(0.0),
            hardware_backend: format!("macos-opengl:{}:{}", mpv.get_property::<String>("hwdec-current").unwrap_or_default(), mpv.get_property::<String>("current-ao").unwrap_or_default()),
            encoded_bytes_buffered: 0, average_frame_processing_us: 0.0,
        })
    }
}

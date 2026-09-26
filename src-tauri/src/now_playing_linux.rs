use super::Media;
use gdk_pixbuf::{prelude::PixbufLoaderExt, PixbufLoader};
use mpris_server::{Metadata, PlaybackStatus, Player, Time, TrackId};
use std::{
    cell::RefCell,
    io::Write,
    rc::Rc,
    sync::{Arc, Mutex},
    time::Instant,
};
use tauri::Manager;
use tokio::sync::watch;

#[derive(Clone, Default)]
struct Snapshot {
    media: Option<Media>,
    artwork: Option<Arc<tempfile::NamedTempFile>>,
}

impl Snapshot {
    fn update(&mut self, media: Option<Media>) {
        if self.media.as_ref().map(|media| (&media.id, &media.artwork))
            != media.as_ref().map(|media| (&media.id, &media.artwork))
        {
            self.artwork = None;
        }
        self.media = media;
    }
}

struct NativeMedia {
    sender: Mutex<Option<watch::Sender<Snapshot>>>,
}

pub fn install(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    let (sender, receiver) = watch::channel(Snapshot::default());
    if !app.manage(NativeMedia {
        sender: Mutex::new(Some(sender)),
    }) {
        return Ok(());
    }
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Some(state) = handle.try_state::<NativeMedia>() {
                state
                    .sender
                    .lock()
                    .ok()
                    .and_then(|mut sender| sender.take());
            }
        }
    });
    let handle = app.clone();
    std::thread::Builder::new()
        .name("couch-mpris".into())
        .spawn(move || {
            // mpris-server's Player is local to one thread. Keep one worker for the window's lifetime.
            let result = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|error| error.to_string())
                .and_then(|runtime| {
                    tokio::task::LocalSet::new()
                        .block_on(&runtime, run(handle.clone(), receiver))
                        .map_err(|error| error.to_string())
                });
            if let Err(error) = result {
                log::warn!("System media controls unavailable: {error}");
            }
            if let Some(state) = handle.try_state::<NativeMedia>() {
                state
                    .sender
                    .lock()
                    .ok()
                    .and_then(|mut sender| sender.take());
            }
        })
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn update(app: &tauri::AppHandle, media: Option<Media>) -> Result<(), String> {
    let Some(state) = app.try_state::<NativeMedia>() else {
        return Ok(());
    };
    let sender = state.sender.lock().map_err(|error| error.to_string())?;
    if let Some(sender) = sender.as_ref() {
        sender.send_modify(|snapshot| snapshot.update(media));
    }
    Ok(())
}

pub fn artwork(app: &tauri::AppHandle, id: String, url: String, bytes: Vec<u8>) {
    let Some(bytes) = decode_artwork(&bytes) else {
        return;
    };
    let Some(state) = app.try_state::<NativeMedia>() else {
        return;
    };
    let Ok(sender) = state.sender.lock() else {
        return;
    };
    let Some(sender) = sender.as_ref() else {
        return;
    };
    // Never publish authenticated URLs or tokens on D-Bus. The temporary file is private to this user.
    if artwork_key(sender.borrow().media.as_ref()) != Some((id.as_str(), url.as_str())) {
        return;
    }
    let Ok(file) = artwork_file(&bytes) else {
        return;
    };
    sender.send_modify(|snapshot| snapshot.artwork = Some(Arc::new(file)));
}

fn decode_artwork(bytes: &[u8]) -> Option<Vec<u8>> {
    let loader = PixbufLoader::new();
    let written = loader.write(bytes);
    let closed = loader.close();
    written.ok()?;
    closed.ok()?;
    loader.pixbuf()?.save_to_bufferv("png", &[]).ok()
}

fn artwork_file(bytes: &[u8]) -> std::io::Result<tempfile::NamedTempFile> {
    let mut file = tempfile::NamedTempFile::new()?;
    file.write_all(bytes)?;
    Ok(file)
}

fn artwork_key(media: Option<&Media>) -> Option<(&str, &str)> {
    let media = media?;
    Some((&media.id, &media.artwork.as_ref()?.url))
}

fn track_id(id: &str) -> TrackId {
    let encoded: String = id.bytes().map(|byte| format!("{byte:02x}")).collect();
    TrackId::try_from(format!("/couch/track/t{encoded}"))
        .expect("hex is a valid D-Bus path component")
}

fn time(seconds: f64) -> Time {
    Time::from_micros((seconds.max(0.0) * 1_000_000.0) as i64)
}

fn metadata(snapshot: &Snapshot, fallback: &tempfile::NamedTempFile) -> Metadata {
    let Some(media) = snapshot.media.as_ref() else {
        return Metadata::new();
    };
    let mut metadata = Metadata::builder()
        .trackid(track_id(&media.id))
        .title(&media.title)
        .artist([&media.artist])
        .album(&media.album)
        .build();
    if !media.live {
        metadata.set_length(
            media
                .duration
                .filter(|value| value.is_finite() && *value > 0.0)
                .map(time),
        );
    }
    let artwork = snapshot.artwork.as_deref().unwrap_or(fallback);
    metadata.set_art_url(
        reqwest::Url::from_file_path(artwork.path())
            .ok()
            .map(String::from),
    );
    metadata
}

#[derive(Clone, Copy)]
enum Control<'a> {
    Play,
    Pause,
    Toggle,
    Stop,
    Next,
    Seek(f64),
    SetPosition(&'a TrackId, f64),
}

#[derive(Debug, PartialEq)]
struct Command<'a> {
    id: &'a str,
    command: &'static str,
    position: f64,
}

fn command<'a>(media: &'a Media, control: Control<'_>) -> Option<Command<'a>> {
    let (command, position) = match control {
        Control::Play if !media.playing && media.can_pause => ("play", 0.0),
        Control::Pause if media.playing && media.can_pause => ("pause", 0.0),
        Control::Toggle if media.can_pause => ("toggle", 0.0),
        Control::Stop => ("stop", 0.0),
        Control::Next if media.can_next => ("next", 0.0),
        Control::Seek(offset) if media.can_seek => {
            let position = (media.position + offset).max(0.0);
            if media.duration.is_some_and(|duration| position > duration) {
                return command(media, Control::Next);
            }
            ("seek", position)
        }
        Control::SetPosition(id, position)
            if media.can_seek
                && *id == track_id(&media.id)
                && position >= 0.0
                && media.duration.is_none_or(|duration| position <= duration) =>
        {
            ("seek", position)
        }
        _ => return None,
    };
    Some(Command {
        id: &media.id,
        command,
        position,
    })
}

fn emit(app: &tauri::AppHandle, current: &RefCell<Option<Media>>, control: Control<'_>) {
    if let Some(command) = current
        .borrow()
        .as_ref()
        .and_then(|media| command(media, control))
    {
        super::emit(app, command.id, command.command, command.position);
    }
}

async fn run(
    app: tauri::AppHandle,
    mut receiver: watch::Receiver<Snapshot>,
) -> mpris_server::zbus::Result<()> {
    let player = Player::builder(&format!("quest.avoid.couch.instance{}", std::process::id()))
        .identity("Couch")
        .desktop_entry("Couch")
        .can_control(true)
        .can_raise(true)
        .build()
        .await?;
    let fallback = artwork_file(super::FALLBACK_ARTWORK)?;
    let handle = app.clone();
    player.connect_raise(move |_| {
        crate::desktop_lifecycle::show(&handle);
    });
    let current = Rc::new(RefCell::new(None));
    macro_rules! connect {
        ($method:ident, $control:expr) => {{
            let handle = app.clone();
            let current = current.clone();
            player.$method(move |_| emit(&handle, &current, $control));
        }};
    }
    connect!(connect_play, Control::Play);
    connect!(connect_pause, Control::Pause);
    connect!(connect_play_pause, Control::Toggle);
    connect!(connect_stop, Control::Stop);
    connect!(connect_next, Control::Next);
    let handle = app.clone();
    let state = current.clone();
    player.connect_seek(move |_, offset| {
        emit(
            &handle,
            &state,
            Control::Seek(offset.as_micros() as f64 / 1_000_000.0),
        );
    });
    let state = current.clone();
    player.connect_set_position(move |_, id, position| {
        emit(
            &app,
            &state,
            Control::SetPosition(id, position.as_micros() as f64 / 1_000_000.0),
        );
    });
    tokio::task::spawn_local(player.run());
    let mut previous: Option<(Media, Instant)> = None;
    loop {
        let snapshot = receiver.borrow_and_update().clone();
        let media = snapshot.media.as_ref();
        // MPRIS uses PlaybackStatus for pause; Rate must remain positive even while buffering.
        let rate = media.map_or(1.0, |media| {
            if media.rate > 0.0 {
                media.rate
            } else if previous
                .as_ref()
                .is_some_and(|(last, _)| last.id == media.id)
            {
                player.rate()
            } else {
                1.0
            }
        });
        let position = media.map_or(0.0, |media| media.position);
        let seeked = previous.as_ref().is_some_and(|(previous, at)| {
            media.is_some_and(|media| {
                let expected = previous.position
                    + if previous.playing {
                        at.elapsed().as_secs_f64() * previous.rate
                    } else {
                        0.0
                    };
                previous.id == media.id && (expected - media.position).abs() > 2.0
            })
        });
        *current.borrow_mut() = snapshot.media.clone();
        player.set_metadata(metadata(&snapshot, &fallback)).await?;
        player
            .set_can_play(media.is_some_and(|media| media.can_pause && !media.playing))
            .await?;
        player
            .set_can_pause(media.is_some_and(|media| media.can_pause))
            .await?;
        player
            .set_can_seek(media.is_some_and(|media| media.can_seek))
            .await?;
        player
            .set_can_go_next(media.is_some_and(|media| media.can_next))
            .await?;
        player.set_minimum_rate(rate.min(1.0)).await?;
        player.set_maximum_rate(rate.max(1.0)).await?;
        player.set_rate(rate).await?;
        player.set_position(time(position));
        player
            .set_playback_status(match media {
                Some(media) if media.playing => PlaybackStatus::Playing,
                Some(_) => PlaybackStatus::Paused,
                None => PlaybackStatus::Stopped,
            })
            .await?;
        if seeked {
            player.seeked(time(position)).await?;
        }
        previous = snapshot.media.clone().map(|media| (media, Instant::now()));
        if receiver.changed().await.is_err() {
            return Ok(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn media() -> Media {
        Media {
            id: "https://couch.example/track:一".into(),
            title: "Title".into(),
            artist: "Artist".into(),
            album: "Album".into(),
            playing: true,
            live: false,
            position: 10.0,
            duration: Some(90.0),
            rate: 1.5,
            can_pause: true,
            can_seek: true,
            can_next: true,
            artwork: None,
        }
    }

    #[test]
    fn metadata_clears_on_stop_and_omits_live_duration() {
        let fallback = artwork_file(super::super::FALLBACK_ARTWORK).unwrap();
        let media = media();
        let active = metadata(
            &Snapshot {
                media: Some(media.clone()),
                artwork: None,
            },
            &fallback,
        );
        assert_eq!(active.title(), Some("Title"));
        assert_eq!(active.trackid(), Some(track_id(&media.id)));
        assert_eq!(active.length(), Some(time(90.0)));
        let live = metadata(
            &Snapshot {
                media: Some(Media {
                    live: true,
                    ..media
                }),
                artwork: None,
            },
            &fallback,
        );
        assert_eq!(live.length(), None);
        assert_eq!(metadata(&Snapshot::default(), &fallback), Metadata::new());
    }

    #[test]
    fn transport_obeys_capabilities_and_track_identity() {
        let media = media();
        assert_eq!(command(&media, Control::Play), None);
        assert_eq!(command(&media, Control::Pause).unwrap().command, "pause");
        assert_eq!(
            command(&media, Control::SetPosition(&track_id("old track"), 20.0)),
            None
        );
        assert_eq!(
            command(&media, Control::SetPosition(&track_id(&media.id), 20.0))
                .unwrap()
                .position,
            20.0
        );
        assert_eq!(
            command(&media, Control::SetPosition(&track_id(&media.id), -1.0)),
            None
        );
        assert_eq!(
            command(&media, Control::SetPosition(&track_id(&media.id), 91.0)),
            None
        );
        assert_eq!(command(&media, Control::Seek(-30.0)).unwrap().position, 0.0);
        assert_eq!(
            command(&media, Control::Seek(100.0)).unwrap().command,
            "next"
        );
        let unavailable = Media {
            live: true,
            can_pause: false,
            can_seek: false,
            can_next: false,
            ..media
        };
        for control in [
            Control::Play,
            Control::Pause,
            Control::Toggle,
            Control::Next,
            Control::Seek(1.0),
        ] {
            assert_eq!(command(&unavailable, control), None);
        }
        assert_eq!(
            command(&unavailable, Control::Stop).unwrap().command,
            "stop"
        );
        let timeshift = Media {
            live: true,
            can_seek: true,
            duration: None,
            ..unavailable
        };
        assert_eq!(
            command(&timeshift, Control::Seek(100.0)).unwrap().position,
            110.0
        );
        let paused = Media {
            playing: false,
            can_pause: false,
            ..timeshift
        };
        assert_eq!(command(&paused, Control::Play), None);
        assert_eq!(
            command(
                &Media {
                    can_pause: true,
                    ..paused
                },
                Control::Play
            )
            .unwrap()
            .command,
            "play"
        );
    }
    #[test]
    fn artwork_stays_private_and_is_retained_only_for_its_track() {
        let fallback = artwork_file(super::super::FALLBACK_ARTWORK).unwrap();
        let cover = include_bytes!("../icons/32x32.png");
        let file = artwork_file(cover).unwrap();
        let path = file.path().to_owned();
        let media = Media {
            artwork: Some(super::super::Artwork {
                url: "https://couch.example/private-cover".into(),
                token: Some("secret".into()),
            }),
            ..media()
        };
        let mut snapshot = Snapshot {
            media: Some(media.clone()),
            artwork: Some(Arc::new(file)),
        };
        let art_url = metadata(&snapshot, &fallback).art_url().unwrap();
        assert!(art_url.starts_with("file://"));
        assert!(!art_url.contains("secret"));
        assert_eq!(std::fs::read(&path).unwrap(), cover);
        assert_ne!(
            reqwest::Url::parse(&art_url)
                .unwrap()
                .to_file_path()
                .unwrap(),
            fallback.path()
        );
        snapshot.update(Some(Media {
            position: 11.0,
            ..media.clone()
        }));
        assert!(path.exists());
        assert!(snapshot.artwork.is_some());
        assert_eq!(
            metadata(&snapshot, &fallback).art_url().as_deref(),
            Some(art_url.as_str())
        );
        snapshot.update(Some(Media {
            id: "another session".into(),
            ..media
        }));
        assert!(!path.exists());
        assert_eq!(
            metadata(&snapshot, &fallback).art_url(),
            Some(
                reqwest::Url::from_file_path(fallback.path())
                    .unwrap()
                    .into()
            )
        );
    }
    #[test]
    fn active_metadata_has_couch_artwork_when_a_cover_is_missing_or_unavailable() {
        let fallback = artwork_file(super::super::FALLBACK_ARTWORK).unwrap();
        let mut snapshot = Snapshot {
            media: Some(media()),
            artwork: None,
        };
        let url = metadata(&snapshot, &fallback)
            .art_url()
            .expect("active media needs Couch artwork");
        let path = reqwest::Url::parse(&url).unwrap().to_file_path().unwrap();
        assert_eq!(std::fs::read(path).unwrap(), super::super::FALLBACK_ARTWORK);
        snapshot.update(Some(Media {
            artwork: Some(super::super::Artwork {
                url: "https://couch.example/failed-cover".into(),
                token: None,
            }),
            ..media()
        }));
        assert_eq!(
            metadata(&snapshot, &fallback).art_url().as_deref(),
            Some(url.as_str())
        );
        snapshot.update(None);
        assert_eq!(metadata(&snapshot, &fallback), Metadata::new());
    }
    #[test]
    fn corrupt_artwork_cannot_replace_couch_branding() {
        assert!(decode_artwork(b"not an image").is_none());
        assert!(decode_artwork(b"").is_none());
        assert!(decode_artwork(&super::super::FALLBACK_ARTWORK[..32]).is_none());
        let cover =
            decode_artwork(include_bytes!("../icons/32x32.png")).expect("valid cover decodes");
        let loader = PixbufLoader::new();
        loader.write(&cover).unwrap();
        loader.close().unwrap();
        let pixbuf = loader.pixbuf().unwrap();
        assert_eq!((pixbuf.width(), pixbuf.height()), (32, 32));
    }
}

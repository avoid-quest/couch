use super::Media;
use ::windows::{
    core::{factory, HSTRING},
    Foundation::{TimeSpan, TypedEventHandler},
    Graphics::Imaging::BitmapDecoder,
    Media::{
        MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
        SystemMediaTransportControls, SystemMediaTransportControlsButton,
        SystemMediaTransportControlsButtonPressedEventArgs,
        SystemMediaTransportControlsTimelineProperties,
    },
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference},
    Win32::System::WinRT::{
        ISystemMediaTransportControlsInterop, RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED,
        RO_INIT_SINGLETHREADED, RO_INIT_TYPE,
    },
};
use std::sync::{Mutex, OnceLock};

struct Session {
    controls: SystemMediaTransportControls,
    fallback: RandomAccessStreamReference,
    media: Option<Media>,
    buttons: Option<i64>,
    seek: Option<i64>,
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.controls.SetIsEnabled(false);
        if let Some(token) = self.buttons {
            let _ = self.controls.RemoveButtonPressed(token);
        }
        if let Some(token) = self.seek {
            let _ = self.controls.RemovePlaybackPositionChangeRequested(token);
        }
    }
}

struct Apartment;
impl Apartment {
    fn new(mode: RO_INIT_TYPE) -> Result<Self, String> {
        unsafe { RoInitialize(mode) }.map_err(|error| error.to_string())?;
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            RoUninitialize();
        }
    }
}

static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();

fn send(app: &tauri::AppHandle, command: &str, position: f64) {
    let media = SESSION
        .get()
        .and_then(|session| session.lock().ok()?.as_ref()?.media.clone());
    let Some(media) = media else { return };
    if match command {
        "play" | "pause" => !media.can_pause,
        "seek" => !media.can_seek,
        "next" => !media.can_next,
        _ => false,
    } {
        return;
    }
    super::emit(app, &media.id, command, position);
}

// Bind SMTC to Couch's real window; libmpv remains the only playback engine.
pub fn install(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    let apartment = Apartment::new(RO_INIT_SINGLETHREADED)?;
    let interop: ISystemMediaTransportControlsInterop =
        factory::<SystemMediaTransportControls, _>().map_err(|error| error.to_string())?;
    let controls: SystemMediaTransportControls =
        unsafe { interop.GetForWindow(window.hwnd().map_err(|error| error.to_string())?) }
            .map_err(|error| error.to_string())?;
    controls
        .SetIsEnabled(false)
        .map_err(|error| error.to_string())?;
    let prepared_controls = controls.clone();
    let fallback = std::thread::spawn(move || -> Result<_, String> {
        let _apartment = Apartment::new(RO_INIT_MULTITHREADED)?;
        let image = thumbnail(super::FALLBACK_ARTWORK).map_err(|error| error.to_string())?;
        let updater = prepared_controls
            .DisplayUpdater()
            .map_err(|error| error.to_string())?;
        updater
            .SetThumbnail(&image)
            .map_err(|error| error.to_string())?;
        Ok(image)
    })
    .join()
    .map_err(|_| "Couldn't prepare Couch artwork.".to_string())??;
    let mut session = Session {
        controls,
        fallback,
        media: None,
        buttons: None,
        seek: None,
    };
    let buttons = app.clone();
    session.buttons = Some(
        session
            .controls
            .ButtonPressed(&TypedEventHandler::<
                SystemMediaTransportControls,
                SystemMediaTransportControlsButtonPressedEventArgs,
            >::new(move |_, args| {
                let Some(args) = args.as_ref() else {
                    return Ok(());
                };
                let command = match args.Button()? {
                    SystemMediaTransportControlsButton::Play => "play",
                    SystemMediaTransportControlsButton::Pause => "pause",
                    SystemMediaTransportControlsButton::Stop => "stop",
                    SystemMediaTransportControlsButton::Next => "next",
                    _ => return Ok(()),
                };
                send(&buttons, command, 0.0);
                Ok(())
            }))
            .map_err(|error| error.to_string())?,
    );
    let seek = app.clone();
    session.seek = Some(
        session
            .controls
            .PlaybackPositionChangeRequested(&TypedEventHandler::<
                SystemMediaTransportControls,
                PlaybackPositionChangeRequestedEventArgs,
            >::new(move |_, args| {
                if let Some(args) = args.as_ref() {
                    send(
                        &seek,
                        "seek",
                        args.RequestedPlaybackPosition()?.Duration as f64 / 10_000_000.0,
                    );
                }
                Ok(())
            }))
            .map_err(|error| error.to_string())?,
    );
    SESSION
        .set(Mutex::new(Some(session)))
        .map_err(|_| "System media controls are already installed.".to_string())?;
    window.on_window_event(|event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Some(session) = SESSION
                .get()
                .and_then(|session| session.lock().ok()?.take())
            {
                drop(session);
                unsafe {
                    RoUninitialize();
                }
            }
        }
    });
    // The matching window-destruction callback runs on the same UI thread.
    std::mem::forget(apartment);
    Ok(())
}

fn time(seconds: f64) -> TimeSpan {
    TimeSpan {
        Duration: (seconds.max(0.0) * 10_000_000.0) as i64,
    }
}

fn publish(session: &Session, media: Option<&Media>) -> ::windows::core::Result<()> {
    let controls = &session.controls;
    let updater = controls.DisplayUpdater()?;
    let Some(media) = media else {
        controls.SetIsEnabled(false)?;
        controls.SetPlaybackStatus(MediaPlaybackStatus::Stopped)?;
        updater.ClearAll()?;
        updater.Update()?;
        return Ok(());
    };
    let previous = session.media.as_ref();
    if previous.map(|old| (&old.id, &old.title, &old.artist, &old.album, &old.artwork))
        != Some((
            &media.id,
            &media.title,
            &media.artist,
            &media.album,
            &media.artwork,
        ))
    {
        if previous.map(|old| (&old.id, &old.artwork)) != Some((&media.id, &media.artwork)) {
            updater.ClearAll()?;
            updater.SetThumbnail(&session.fallback)?;
        }
        updater.SetType(MediaPlaybackType::Music)?;
        updater.SetAppMediaId(&HSTRING::from(&media.id))?;
        let music = updater.MusicProperties()?;
        music.SetTitle(&HSTRING::from(&media.title))?;
        music.SetArtist(&HSTRING::from(&media.artist))?;
        music.SetAlbumTitle(&HSTRING::from(&media.album))?;
        updater.Update()?;
    }
    controls.SetIsPlayEnabled(media.can_pause && !media.playing)?;
    controls.SetIsPauseEnabled(media.can_pause && media.playing)?;
    controls.SetIsStopEnabled(true)?;
    controls.SetIsNextEnabled(media.can_next)?;
    controls.SetIsPreviousEnabled(false)?;
    controls.SetPlaybackStatus(if media.playing {
        MediaPlaybackStatus::Playing
    } else {
        MediaPlaybackStatus::Paused
    })?;
    controls.SetPlaybackRate(media.rate)?;
    let position = media.position.max(0.0);
    let duration = media.duration.unwrap_or(position).max(position);
    let timeline = SystemMediaTransportControlsTimelineProperties::new()?;
    timeline.SetStartTime(time(0.0))?;
    timeline.SetEndTime(time(duration))?;
    timeline.SetMinSeekTime(time(if media.can_seek { 0.0 } else { position }))?;
    timeline.SetMaxSeekTime(time(if media.can_seek { duration } else { position }))?;
    timeline.SetPosition(time(position))?;
    controls.UpdateTimelineProperties(&timeline)?;
    controls.SetIsEnabled(true)
}

pub fn update(app: &tauri::AppHandle, media: Option<Media>) -> Result<(), String> {
    app.run_on_main_thread(move || {
        let Some(session) = SESSION.get() else { return };
        let Ok(mut session) = session.lock() else {
            return;
        };
        let Some(session) = session.as_mut() else {
            return;
        };
        match publish(session, media.as_ref()) {
            Ok(()) => session.media = media,
            Err(error) => {
                session.media = None;
                let _ = session.controls.SetIsEnabled(false);
                log::warn!("Couldn't update system media controls: {error}");
            }
        }
    })
    .map_err(|error| error.to_string())
}

fn thumbnail(bytes: &[u8]) -> ::windows::core::Result<RandomAccessStreamReference> {
    let stream = InMemoryRandomAccessStream::new()?;
    let writer = DataWriter::CreateDataWriter(&stream)?;
    writer.WriteBytes(bytes)?;
    writer.StoreAsync()?.get()?;
    writer.DetachStream()?;
    stream.Seek(0)?;
    // A stream can contain arbitrary bytes; decode before replacing the brand fallback.
    let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
    decoder.GetPixelDataAsync()?.get()?;
    stream.Seek(0)?;
    RandomAccessStreamReference::CreateFromStream(&stream)
}

pub fn artwork(_app: &tauri::AppHandle, id: String, url: String, bytes: Vec<u8>) {
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(_apartment) = Apartment::new(RO_INIT_MULTITHREADED) else {
            return;
        };
        let Ok(thumbnail) = thumbnail(&bytes) else {
            return;
        };
        let Some(session) = SESSION.get() else { return };
        let Ok(session) = session.lock() else { return };
        let Some(session) = session.as_ref() else {
            return;
        };
        if !session.media.as_ref().is_some_and(|media| {
            media.id == id
                && media
                    .artwork
                    .as_ref()
                    .is_some_and(|artwork| artwork.url == url)
        }) {
            return;
        }
        // SMTC is agile; publish while this worker's WinRT apartment is alive.
        if let Ok(updater) = session.controls.DisplayUpdater() {
            if updater.SetThumbnail(&thumbnail).is_ok() {
                let _ = updater.Update();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn artwork_requires_a_decodable_image() {
        let _apartment = Apartment::new(RO_INIT_MULTITHREADED).unwrap();
        assert!(thumbnail(super::super::FALLBACK_ARTWORK).is_ok());
        assert!(thumbnail(b"not an image").is_err());
        assert!(thumbnail(&super::super::FALLBACK_ARTWORK[..32]).is_err());
    }
}

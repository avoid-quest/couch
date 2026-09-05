use libmpv2::Mpv;

use crate::{Error, MpvNowPlaying, Result};

pub(crate) struct NetworkDefaults {
    timeout: f64,
    lavf_options: String,
}

impl NetworkDefaults {
    pub(crate) fn read(mpv: &Mpv) -> Result<Self> {
        Ok(Self {
            timeout: mpv.get_property("network-timeout").map_err(network_error)?,
            lavf_options: mpv.get_property("stream-lavf-o").map_err(network_error)?,
        })
    }

    pub(crate) fn configure(&self, mpv: &Mpv, radio: bool) -> Result<()> {
        mpv.set_property("network-timeout", if radio { 8.0 } else { self.timeout })
            .map_err(network_error)?;
        // mpv enables FFmpeg reconnect by default. Bun owns the retry budget.
        mpv.set_property(
            "stream-lavf-o",
            if radio {
                "reconnect=0,reconnect_at_eof=0,reconnect_on_network_error=0,reconnect_streamed=0"
            } else {
                self.lavf_options.as_str()
            },
        )
        .map_err(network_error)
    }
}

fn network_error(_: libmpv2::Error) -> Error {
    Error::Pipeline("Could not configure native network limits".into())
}

pub(crate) fn now_playing(mpv: &Mpv) -> Option<MpvNowPlaying> {
    let tag = |key| {
        mpv.get_property::<String>(key)
            .ok()
            .and_then(|value| clean_text(&value))
    };
    // media-title can fall back to the private URL or filename. Read only tags.
    let title = tag("metadata/by-key/icy-title").or_else(|| tag("metadata/by-key/title"))?;
    Some(MpvNowPlaying {
        title,
        artist: tag("metadata/by-key/artist"),
    })
}

fn clean_text(value: &str) -> Option<String> {
    let text: String = value.chars().filter(|c| !matches!(c,
        '\u{061c}' | '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
    )).map(|c| if c.is_control() || c.is_whitespace() { ' ' } else { c })
        .take(300).collect();
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty()
        || text.contains("://")
        || text.starts_with(['/', '\\'])
        || text
            .as_bytes()
            .get(1..3)
            .is_some_and(|prefix| prefix == b":\\" || prefix == b":/")
    {
        None
    } else {
        Some(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        process::Command,
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc,
        },
        time::{Duration, Instant},
    };

    #[test]
    fn radio_metadata_text_is_bounded_and_does_not_publish_paths() {
        assert_eq!(
            clean_text(" \u{202e}Artist\0\n  - Song\t"),
            Some("Artist - Song".into())
        );
        assert_eq!(
            clean_text("<b>Song & artist</b>"),
            Some("<b>Song & artist</b>".into())
        );
        assert_eq!(clean_text(&"音".repeat(400)).unwrap().chars().count(), 300);
        for value in [
            "\0\t",
            "https://private.test/stream?token=secret",
            "/private/music.mp3",
            "C:\\private\\music.mp3",
            "file:///private/music.mp3",
        ] {
            assert!(clean_text(value).is_none(), "{value:?}");
        }
    }

    #[test]
    fn radio_metadata_reads_real_icy_updates_and_resets_network_options() {
        let generated = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=12",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "128k",
                "-write_xing",
                "0",
                "-id3v2_version",
                "0",
                "-f",
                "mp3",
                "pipe:1",
            ])
            .output()
            .expect("ffmpeg must be installed for the native radio fixture");
        assert!(
            generated.status.success(),
            "{}",
            String::from_utf8_lossy(&generated.stderr)
        );
        let audio = generated.stdout;
        assert!(audio.len() > 8192);
        let untagged = audio.clone();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let changed = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let connections = Arc::new(AtomicUsize::new(0));
        let server_changed = Arc::clone(&changed);
        let server_finished = Arc::clone(&finished);
        let server_connections = Arc::clone(&connections);
        let server = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(20);
            while !server_finished.load(Ordering::Relaxed) && Instant::now() < deadline {
                let Ok((mut stream, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(10));
                    continue;
                };
                server_connections.fetch_add(1, Ordering::Relaxed);
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                let mut request = [0_u8; 4096];
                let mut count = 0;
                while !request[..count].windows(4).any(|end| end == b"\r\n\r\n") {
                    let read = stream.read(&mut request[count..]).unwrap();
                    assert!(read > 0, "incomplete native HTTP request");
                    count += read;
                }
                assert!(String::from_utf8_lossy(&request[..count])
                    .to_lowercase()
                    .contains("icy-metadata: 1"));
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: audio/mpeg\r\nicy-metaint: 4096\r\nicy-name: Private station header\r\nicy-url: https://private.test/token\r\nConnection: close\r\n\r\n").unwrap();
                let mut offset = 0;
                while !server_finished.load(Ordering::Relaxed) && Instant::now() < deadline {
                    let block: Vec<_> = (0..4096)
                        .map(|index| audio[(offset + index) % audio.len()])
                        .collect();
                    offset = (offset + 4096) % audio.len();
                    let title = if server_changed.load(Ordering::Relaxed) {
                        "Second artist - Evening signal"
                    } else {
                        "First artist - Morning signal"
                    };
                    let mut metadata = format!("StreamTitle='{title}';").into_bytes();
                    let units = metadata.len().div_ceil(16);
                    metadata.resize(units * 16, 0);
                    if stream
                        .write_all(&block)
                        .and_then(|_| stream.write_all(&[units as u8]))
                        .and_then(|_| stream.write_all(&metadata))
                        .is_err()
                    {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
        });
        let mut mpv = Mpv::with_initializer(|init| {
            init.set_option("vo", "null")?;
            init.set_option("ao", "null")?;
            init.set_option("keep-open", "yes")?;
            init.set_option("cache", "yes")?;
            init.set_option("cache-secs", 1.0_f64)?;
            Ok(())
        })
        .unwrap();
        let defaults = NetworkDefaults::read(&mpv).unwrap();
        defaults.configure(&mpv, true).unwrap();
        assert_eq!(mpv.get_property::<f64>("network-timeout").unwrap(), 8.0);
        let options = mpv.get_property::<String>("stream-lavf-o").unwrap();
        assert!(options.contains("reconnect=0"), "{options}");
        mpv.command(
            "loadfile",
            &[&format!("http://{address}/private-stream.mp3"), "replace"],
        )
        .unwrap();
        wait_title(&mut mpv, "First artist - Morning signal");
        changed.store(true, Ordering::Relaxed);
        wait_title(&mut mpv, "Second artist - Evening signal");
        assert_eq!(now_playing(&mpv).unwrap().artist, None);
        mpv.command("stop", &[]).unwrap();
        finished.store(true, Ordering::Relaxed);
        server.join().unwrap();
        assert_eq!(connections.load(Ordering::Relaxed), 1);
        assert!(now_playing(&mpv).is_none());
        defaults.configure(&mpv, false).unwrap();
        assert_eq!(
            mpv.get_property::<f64>("network-timeout").unwrap(),
            defaults.timeout
        );
        assert_eq!(
            mpv.get_property::<String>("stream-lavf-o").unwrap(),
            defaults.lavf_options
        );
        let path =
            std::env::temp_dir().join(format!("couch-radio-{}.mp3", std::process::id()));
        let generated = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=3",
                "-c:a",
                "libmp3lame",
                "-metadata",
                "title=Recorded song",
                "-metadata",
                "artist=Recorded artist",
            ])
            .arg(&path)
            .output()
            .unwrap();
        assert!(
            generated.status.success(),
            "{}",
            String::from_utf8_lossy(&generated.stderr)
        );
        mpv.command("loadfile", &[path.to_str().unwrap(), "replace"])
            .unwrap();
        wait_title(&mut mpv, "Recorded song");
        assert_eq!(
            now_playing(&mpv).unwrap().artist.as_deref(),
            Some("Recorded artist")
        );
        mpv.command("stop", &[]).unwrap();
        while mpv.wait_event(0.0).is_some() {}
        std::fs::write(&path, untagged).unwrap();
        mpv.command("loadfile", &[path.to_str().unwrap(), "replace"])
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            assert!(Instant::now() < deadline, "untagged audio did not load");
            if matches!(
                mpv.wait_event(0.05),
                Some(Ok(libmpv2::events::Event::FileLoaded))
            ) {
                break;
            }
        }
        assert!(mpv.get_property::<String>("media-title").is_ok());
        assert!(
            now_playing(&mpv).is_none(),
            "filename fallback must remain private"
        );
        mpv.command("stop", &[]).unwrap();
        std::fs::remove_file(path).unwrap();
    }

    fn wait_title(mpv: &mut Mpv, title: &str) {
        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            if let Some(Err(error)) = mpv.wait_event(0.05) {
                panic!("native radio load failed: {error}");
            }
            if now_playing(mpv).is_some_and(|track| track.title == title) {
                return;
            }
        }
        panic!(
            "did not observe {title:?}, latest metadata was {:?}",
            now_playing(mpv)
        );
    }
}

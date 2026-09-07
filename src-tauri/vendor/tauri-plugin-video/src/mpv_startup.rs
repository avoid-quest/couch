use crate::Result;
use libmpv2::Mpv;

pub(crate) struct StartupBuffer {
    initial: bool,
    wait: f64,
}

impl StartupBuffer {
    pub(crate) fn read(mpv: &Mpv) -> Result<Self> {
        Ok(Self {
            initial: mpv.get_property("cache-pause-initial").map_err(|_| {
                crate::Error::Pipeline("Could not read startup buffer defaults".into())
            })?,
            wait: mpv.get_property("cache-pause-wait").map_err(|_| {
                crate::Error::Pipeline("Could not read startup buffer defaults".into())
            })?,
        })
    }

    pub(crate) fn configure(
        &self,
        mpv: &Mpv,
        uri: &str,
        audio_uri: Option<&str>,
        live: bool,
    ) -> Result<()> {
        let network = |uri: &str| uri.starts_with("https://") || uri.starts_with("http://");
        let split_network_video = !live && network(uri) && audio_uri.is_some_and(network);
        // Let split streams build a reserve before the first frame and after seeks.
        // Restore defaults on replacement so local files and live inputs keep their latency.
        mpv.set_property(
            "cache-pause-initial",
            if split_network_video {
                true
            } else {
                self.initial
            },
        )
        .map_err(|_| crate::Error::Pipeline("Could not configure startup buffering".into()))?;
        mpv.set_property(
            "cache-pause-wait",
            if split_network_video { 3.0 } else { self.wait },
        )
        .map_err(|_| crate::Error::Pipeline("Could not configure startup buffering".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        process::Command,
        time::{Duration, Instant},
    };

    #[test]
    fn startup_buffer_prevents_early_network_underrun_and_resets() {
        let audio = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=duration=12",
                "-c:a",
                "pcm_s16le",
                "-ar",
                "8000",
                "-f",
                "s16le",
                "pipe:1",
            ])
            .output()
            .unwrap();
        assert!(audio.status.success());
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let server = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        std::thread::sleep(Duration::from_millis(10))
                    }
                    Err(error) => panic!("fixture connection failed: {error}"),
                }
            };
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            socket
                .set_write_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = [0; 4096];
            socket.read(&mut request).unwrap();
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n", audio.stdout.len()).unwrap();
            // Two seconds arrive immediately, then delivery stalls before catching up.
            socket.write_all(&audio.stdout[..32_000]).unwrap();
            std::thread::sleep(Duration::from_secs(4));
            let _ = socket.write_all(&audio.stdout[32_000..]);
        });
        let mut mpv = Mpv::with_initializer(|init| {
            init.set_option("vo", "null")?;
            init.set_option("ao", "null")?;
            init.set_option("cache", "yes")?;
            init.set_option("stream-buffer-size", 4096_i64)?;
            init.set_option("demuxer", "rawaudio")?;
            init.set_option("demuxer-rawaudio-rate", 8000_i64)?;
            init.set_option("demuxer-rawaudio-channels", "mono")?;
            init.set_option("demuxer-rawaudio-format", "s16le")?;
            Ok(())
        })
        .unwrap();
        let defaults = StartupBuffer::read(&mpv).unwrap();
        defaults
            .configure(
                &mpv,
                "https://example.test/video",
                Some("https://example.test/audio"),
                false,
            )
            .unwrap();
        mpv.command(
            "loadfile",
            &[&format!("http://{address}/slow.pcm"), "replace"],
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(12);
        let mut started = false;
        let mut stalled = false;
        let mut reached = false;
        while Instant::now() < deadline {
            let _ = mpv.wait_event(0.01);
            let position = mpv.get_property::<f64>("time-pos").unwrap_or(0.0);
            if position > 0.2 {
                started = true;
            }
            if started
                && mpv
                    .get_property::<bool>("paused-for-cache")
                    .unwrap_or(false)
            {
                stalled = true;
            }
            if position >= 5.0 {
                reached = true;
                break;
            }
        }
        mpv.command("stop", &[]).unwrap();
        server.join().unwrap();
        assert!(reached, "fixture must play at least five seconds");
        assert!(
            !stalled,
            "playback advanced then froze to refill its startup buffer"
        );
        for (uri, audio, live) in [
            ("https://example.test/video", None, false),
            ("/local/video", Some("/local/audio"), false),
            (
                "https://example.test/live",
                Some("https://example.test/audio"),
                true,
            ),
            ("https://example.test/video", Some("/local/audio"), false),
        ] {
            defaults
                .configure(
                    &mpv,
                    "https://example.test/video",
                    Some("https://example.test/audio"),
                    false,
                )
                .unwrap();
            defaults.configure(&mpv, uri, audio, live).unwrap();
            assert_eq!(
                mpv.get_property::<bool>("cache-pause-initial").unwrap(),
                defaults.initial
            );
            assert_eq!(
                mpv.get_property::<f64>("cache-pause-wait").unwrap(),
                defaults.wait
            );
        }
    }
}

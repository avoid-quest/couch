use libmpv2::Mpv;

use crate::{Error, Result};

pub(crate) struct LiveStartDefaults(String);

impl LiveStartDefaults {
    pub(crate) fn read(mpv: &Mpv) -> Result<Self> {
        mpv.get_property("demuxer-lavf-o").map(Self).map_err(option_error)
    }

    pub(crate) fn configure(&self, mpv: &Mpv, go_live: bool) -> Result<()> {
        // Restore before every load, including after a failed or canceled live return.
        mpv.set_property("demuxer-lavf-o", self.0.as_str()).map_err(option_error)?;
        if go_live {
            // Explicit live return trades the normal three-segment buffering margin
            // for the newest complete segment. The host revalidates eligibility.
            mpv.command("change-list", &["demuxer-lavf-o", "append", "live_start_index=-1"])
                .map_err(option_error)?;
        }
        Ok(())
    }
}

fn option_error(_: libmpv2::Error) -> Error {
    Error::Pipeline("Could not configure native live playback".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use libmpv2::events::Event;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        process::Command,
        sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}},
        time::{Duration, Instant},
    };

    #[test]
    fn iptv_live_start_selects_newest_segment_and_restores_ordinary_loads() {
        let generated = Command::new("ffmpeg").args([
            "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=25",
            "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1", "-f", "mpegts", "pipe:1",
        ]).output().expect("ffmpeg is required for native live-start verification");
        assert!(generated.status.success(), "{}", String::from_utf8_lossy(&generated.stderr));
        let local = std::env::temp_dir().join(format!("couch-iptv-live-{}.ts", std::process::id()));
        std::fs::write(&local, &generated.stdout).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let requested = Arc::new(Mutex::new(Vec::<String>::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let log = requested.clone();
        let stopped = stop.clone();
        let server = std::thread::spawn(move || {
            while !stopped.load(Ordering::SeqCst) {
                let Ok((mut socket, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(5));
                    continue;
                };
                socket.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
                socket.set_write_timeout(Some(Duration::from_secs(1))).unwrap();
                let mut bytes = [0; 4096];
                let Ok(count) = socket.read(&mut bytes) else { continue };
                let request = String::from_utf8_lossy(&bytes[..count]);
                let path = request.split_whitespace().nth(1).unwrap_or("").to_owned();
                log.lock().unwrap().push(path.clone());
                let manifest = format!("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n{}",
                    (0..6).map(|index| format!("#EXTINF:2,\n{index}.ts\n")).collect::<String>());
                let body = if path.ends_with(".m3u8") { manifest.as_bytes() } else { &generated.stdout };
                let header = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = socket.write_all(header.as_bytes()).and_then(|()| socket.write_all(body));
            }
        });
        let mut mpv = Mpv::with_initializer(|init| {
            init.set_option("vo", "null")?;
            init.set_option("ao", "null")?;
            init.set_option("pause", "yes")?;
            Ok(())
        }).unwrap();
        let defaults = LiveStartDefaults::read(&mpv).unwrap();
        for (go_live, expected) in [(false, "/3.ts"), (true, "/5.ts"), (false, "/3.ts")] {
            mpv.command("stop", &[]).unwrap();
            while mpv.wait_event(0.0).is_some() {}
            requested.lock().unwrap().clear();
            defaults.configure(&mpv, go_live).unwrap();
            if !go_live { assert_eq!(mpv.get_property::<String>("demuxer-lavf-o").unwrap(), defaults.0); }
            mpv.command("loadfile", &[&format!("{origin}/live.m3u8"), "replace"]).unwrap();
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                assert!(Instant::now() < deadline, "live HLS did not load: {:?}", requested.lock().unwrap());
                if matches!(mpv.wait_event(0.1), Some(Ok(Event::FileLoaded))) { break; }
            }
            assert_eq!(requested.lock().unwrap().iter().find(|path| path.ends_with(".ts")).unwrap(), expected);
        }
        mpv.command("stop", &[]).unwrap();
        stop.store(true, Ordering::SeqCst);
        server.join().unwrap();
        // Preserve unrelated AVOptions and a caller's original start override too.
        mpv.set_property("demuxer-lavf-o", "probesize=500000,live_start_index=-2").unwrap();
        let configured = LiveStartDefaults::read(&mpv).unwrap();
        configured.configure(&mpv, true).unwrap();
        assert_eq!(mpv.get_property::<String>("demuxer-lavf-o").unwrap(), "probesize=500000,live_start_index=-1");
        mpv.command("loadfile", &[local.to_str().unwrap(), "replace"]).unwrap();
        // Cancel this load before resetting, as replacement and Stop do in the player.
        mpv.command("stop", &[]).unwrap();
        while mpv.wait_event(0.0).is_some() {}
        configured.configure(&mpv, false).unwrap();
        mpv.command("loadfile", &[local.to_str().unwrap(), "replace"]).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            assert!(Instant::now() < deadline, "ordinary file did not load after live cancellation");
            if matches!(mpv.wait_event(0.1), Some(Ok(Event::FileLoaded))) { break; }
        }
        assert_eq!(mpv.get_property::<String>("demuxer-lavf-o").unwrap(), configured.0);
        mpv.command("stop", &[]).unwrap();
        std::fs::remove_file(local).unwrap();
    }
}

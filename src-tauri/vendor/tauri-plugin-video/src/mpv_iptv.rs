use libmpv2::Mpv;

use crate::{Error, Result};

pub(crate) struct LiveStartDefaults(String);

impl LiveStartDefaults {
    pub(crate) fn read(mpv: &Mpv) -> Result<Self> {
        mpv.get_property("demuxer-lavf-o").map(Self).map_err(option_error)
    }

    pub(crate) fn configure(&self, mpv: &Mpv, go_live: bool, event_start: bool) -> Result<()> {
        // Restore before every load, including after a failed or canceled live return.
        mpv.set_property("demuxer-lavf-o", self.0.as_str()).map_err(option_error)?;
        if go_live || event_start {
            // EVENT starts anchor the timeline at the first segment; explicit live
            // return selects the newest complete segment. The host verifies both.
            let start = if go_live { "live_start_index=-1" } else { "live_start_index=0" };
            mpv.command("change-list", &["demuxer-lavf-o", "append", start])
                .map_err(option_error)?;
        }
        if event_start {
            // Allow a late EVENT segment to arrive before FFmpeg makes EOF final.
            mpv.command("change-list", &["demuxer-lavf-o", "append", "max_reload=30"])
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
                let playlist_type = if path.starts_with("/case-1/") || path.starts_with("/case-2/") { "#EXT-X-PLAYLIST-TYPE:EVENT\n" } else { "" };
                let manifest = format!("#EXTM3U\n{playlist_type}#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n{}",
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
        for (case, (go_live, event_start, expected)) in [(false, false, "/3.ts"), (false, true, "/0.ts"), (true, true, "/5.ts"), (true, false, "/5.ts"), (false, false, "/3.ts")].into_iter().enumerate() {
            mpv.command("stop", &[]).unwrap();
            while mpv.wait_event(0.0).is_some() {}
            defaults.configure(&mpv, go_live, event_start).unwrap();
            assert_eq!(mpv.get_property::<String>("demuxer-lavf-o").unwrap().split(',').any(|option| option == "max_reload=30"), event_start);
            if !go_live && !event_start { assert_eq!(mpv.get_property::<String>("demuxer-lavf-o").unwrap(), defaults.0); }
            let prefix = format!("/case-{case}");
            mpv.command("loadfile", &[&format!("{origin}{prefix}/live.m3u8"), "replace"]).unwrap();
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                assert!(Instant::now() < deadline, "live HLS did not load: {:?}", requested.lock().unwrap());
                if matches!(mpv.wait_event(0.1), Some(Ok(Event::FileLoaded))) { break; }
            }
            assert_eq!(requested.lock().unwrap().iter().find(|path| path.starts_with(&format!("{prefix}/")) && path.ends_with(".ts")).unwrap(), &format!("{prefix}{expected}"));
        }
        mpv.command("stop", &[]).unwrap();
        stop.store(true, Ordering::SeqCst);
        server.join().unwrap();
        // Preserve unrelated AVOptions and a caller's original start override too.
        mpv.set_property("demuxer-lavf-o", "probesize=500000,live_start_index=-2,max_reload=7").unwrap();
        let configured = LiveStartDefaults::read(&mpv).unwrap();
        let options = |value: String| {
            let mut entries: Vec<_> = value.split(',').map(str::to_owned).collect();
            entries.sort();
            entries
        };
        configured.configure(&mpv, true, false).unwrap();
        assert_eq!(options(mpv.get_property::<String>("demuxer-lavf-o").unwrap()), options("probesize=500000,live_start_index=-1,max_reload=7".into()));
        configured.configure(&mpv, true, true).unwrap();
        assert_eq!(options(mpv.get_property::<String>("demuxer-lavf-o").unwrap()), options("probesize=500000,live_start_index=-1,max_reload=30".into()));
        mpv.command("loadfile", &[local.to_str().unwrap(), "replace"]).unwrap();
        // Cancel this load before resetting, as replacement and Stop do in the player.
        mpv.command("stop", &[]).unwrap();
        while mpv.wait_event(0.0).is_some() {}
        configured.configure(&mpv, false, false).unwrap();
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

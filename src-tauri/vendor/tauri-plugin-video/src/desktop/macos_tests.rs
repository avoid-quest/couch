use super::*;
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Mutex,
    },
    thread,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

struct Fixture(PathBuf);
impl Fixture {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "couch-mac-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn decode(path: &Path, args: &[&str]) -> Vec<u8> {
    let output = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(path)
        .args(args)
        .args(["-f", "s16le", "-acodec", "pcm_s16le", "-"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

fn lossless_part(source: &Path, target: &Path, first: usize, last: usize) {
    let output = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-i"])
        .arg(source)
        .args([
            "-af",
            &format!("atrim=start_sample={first}:end_sample={last}"),
            "-c:a",
            "flac",
        ])
        .arg(target)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

struct HttpSource {
    base: String,
    requests: Arc<Mutex<Vec<(String, bool)>>>,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}

impl HttpSource {
    fn new(first: Vec<u8>, second: Vec<u8>, mode: &str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let seen = requests.clone();
        let stopping = stop.clone();
        let mode = mode.to_owned();
        let thread = thread::spawn(move || {
            while !stopping.load(Ordering::Relaxed) {
                let Ok((mut stream, _)) = listener.accept() else {
                    thread::sleep(Duration::from_millis(5));
                    continue;
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut chunk = [0; 4096];
                while !bytes.ends_with(b"\r\n\r\n") && bytes.len() < 32_768 {
                    match stream.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(size) => bytes.extend_from_slice(&chunk[..size]),
                    }
                }
                let request = String::from_utf8_lossy(&bytes);
                let path = request.split_whitespace().nth(1).unwrap_or("").to_owned();
                let authorized = request.lines().any(|line| {
                    line.trim()
                        .eq_ignore_ascii_case("Authorization: MediaBrowser Token=test-token")
                });
                seen.lock().unwrap().push((path.clone(), authorized));
                let second_request = path.contains("/second/");
                if second_request && mode == "slow" {
                    thread::sleep(Duration::from_secs(4));
                }
                if second_request && mode == "failed" {
                    let _ = stream.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    continue;
                }
                let body = if second_request { &second } else { &first };
                let range = request
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        if name.eq_ignore_ascii_case("range") {
                            value
                                .trim()
                                .strip_prefix("bytes=")?
                                .split('-')
                                .next()?
                                .parse::<usize>()
                                .ok()
                        } else {
                            None
                        }
                    })
                    .unwrap_or(0)
                    .min(body.len());
                let status = if range > 0 {
                    "206 Partial Content"
                } else {
                    "200 OK"
                };
                let headers = format!("HTTP/1.1 {status}\r\nContent-Type: audio/flac\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n", body.len() - range, range, body.len().saturating_sub(1), body.len());
                let _ = stream.write_all(headers.as_bytes());
                if !request.starts_with("HEAD ") {
                    let _ = stream.write_all(&body[range..]);
                }
            }
        });
        Self {
            base,
            requests,
            stop,
            thread: Some(thread),
        }
    }
}

impl Drop for HttpSource {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            thread.join().unwrap();
        }
    }
}

#[test]
fn live_load_has_no_implicit_seek_overriding_the_probed_start() {
    for (event_start, go_live, expected) in [
        (true, false, "live_start_index=0"),
        (false, true, "live_start_index=-1"),
    ] {
        let mpv = Mpv::with_initializer(|init| {
            init.set_option("vo", "null")?;
            init.set_option("ao", "null")?;
            Ok(())
        })
        .unwrap();
        let request = NativeOpenRequest {
            uri: "https://example.test/live.m3u8".into(),
            event_start,
            go_live,
            ..Default::default()
        };
        configure_media(&mpv, &request).unwrap();
        configure_start(&mpv, request.start_position, false).unwrap();
        assert_eq!(mpv.get_property::<String>("start").unwrap(), "none");
        assert!(mpv
            .get_property::<String>("demuxer-lavf-o")
            .unwrap()
            .contains(expected));
    }
}

#[test]
fn split_network_video_loads_both_tracks_with_required_headers() {
    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    let fixture = Fixture(std::env::temp_dir().join(format!(
        "couch-mac-split-{}-{}", std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
    )));
    fs::create_dir(&fixture.0).unwrap();
    let video = fixture.0.join("video.mp4");
    let audio = fixture.0.join("audio.m4a");
    for (source, codec, output) in [
        ("color=c=blue:s=640x360:r=25", "libx264", &video),
        ("sine=frequency=440:sample_rate=48000", "aac", &audio),
    ] {
        let kind = if codec == "aac" { "a" } else { "v" };
        let result = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                source,
                "-t",
                "4",
                &format!("-c:{kind}"),
                codec,
                "-threads",
                "1",
                "-y",
            ])
            .arg(output)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
    let video = fs::read(video).unwrap();
    let audio = fs::read(audio).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let stop = Arc::new(AtomicBool::new(false));
    let served = Arc::new(AtomicUsize::new(0));
    let server_stop = Arc::clone(&stop);
    let server_served = Arc::clone(&served);
    let server = std::thread::spawn(move || {
        while !server_stop.load(Ordering::Relaxed) {
            let Ok((mut socket, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            };
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") && request.len() < 8192 {
                let mut chunk = [0; 1024];
                let Ok(count) = socket.read(&mut chunk) else {
                    break;
                };
                if count == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..count]);
            }
            let text = String::from_utf8_lossy(&request);
            let authorized = text
                .to_ascii_lowercase()
                .contains("authorization: token,part2");
            let (body, content_type) = if text.starts_with("GET /video.mp4 ") {
                (&video, "video/mp4")
            } else if text.starts_with("GET /audio.m4a ") {
                (&audio, "audio/mp4")
            } else {
                continue;
            };
            if authorized {
                server_served.fetch_add(1, Ordering::Relaxed);
            }
            let status = if authorized {
                "200 OK"
            } else {
                "403 Forbidden"
            };
            let size = if authorized { body.len() } else { 0 };
            let _ = write!(socket, "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {size}\r\nConnection: close\r\n\r\n");
            if authorized {
                let _ = socket.write_all(body);
            }
        }
    });
    let mut mpv = Mpv::with_initializer(|init| {
        init.set_option("vo", "null")?;
        init.set_option("ao", "null")?;
        init.set_option("ytdl", "no")?;
        Ok(())
    })
    .unwrap();
    mpv.hook_add("on_preloaded", 0).unwrap();
    let request = NativeOpenRequest {
        session_key: "split".into(),
        uri: format!("{origin}/video.mp4"),
        audio_uri: Some(format!("{origin}/audio.m4a")),
        headers: [("Authorization".into(), "token,part2".into())].into(),
        max_video_height: Some(720),
        width: 640.0,
        height: 360.0,
        ..Default::default()
    };
    validate_open(&request).unwrap();
    configure_media(&mpv, &request).unwrap();
    configure_start(&mpv, request.start_position, false).unwrap();
    mpv.command("loadfile", &[&request.uri, "replace"]).unwrap();
    let deadline = Instant::now() + Duration::from_secs(12);
    let mut loaded = false;
    while Instant::now() < deadline {
        match mpv.wait_event(0.05).transpose().unwrap() {
            Some(Event::Hook { id }) => {
                let result = crate::mpv_tracks::select(&mpv, request.max_video_height);
                unsafe { mpv.hook_continue(id) }.unwrap();
                result.unwrap();
            }
            Some(Event::FileLoaded) => {
                loaded = true;
                break;
            }
            Some(Event::EndFile(mpv_end_file_reason::Error)) => {
                panic!("split media failed to load")
            }
            _ => {}
        }
    }
    let kinds: Vec<_> = (0..mpv.get_property::<i64>("track-list/count").unwrap_or(0))
        .filter_map(|index| {
            mpv.get_property::<String>(&format!("track-list/{index}/type"))
                .ok()
        })
        .collect();
    mpv.command("stop", &[]).unwrap();
    stop.store(true, Ordering::Relaxed);
    server.join().unwrap();
    assert!(loaded, "split media did not load before the deadline");
    assert!(kinds.iter().any(|kind| kind == "video"), "{kinds:?}");
    assert!(kinds.iter().any(|kind| kind == "audio"), "{kinds:?}");
    assert!(
        served.load(Ordering::Relaxed) >= 2,
        "both URLs must require the header"
    );
}

#[test]
fn cue_audio_stops_at_each_bound_and_ordinary_replacement_resets_it() {
    let fixture = Fixture::new("cue");
    let source =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/cue/album.flac");
    let capture = fixture.0.join("capture.wav");
    let mut mpv = Mpv::with_initializer(|init| {
        init.set_option("vo", "null")?;
        init.set_option("ao", "pcm")?;
        init.set_option("ao-pcm-file", capture.to_str().unwrap())?;
        init.set_option("audio-format", "s16")?;
        init.set_option("audio-channels", "mono")?;
        init.set_option("audio-samplerate", 44100_i64)?;
        init.set_option("gapless-audio", "no")?;
        init.set_option("audio-display", "no")?;
        Ok(())
    })
    .unwrap();
    for (start, end) in [
        (Some(400.0 / 75.0), Some(875.0 / 75.0)),
        (Some(400.0 / 75.0 + 2.0), Some(875.0 / 75.0)),
        (Some(875.0 / 75.0), Some(18.0)),
        (None, None),
    ] {
        mpv.command("stop", &[]).unwrap();
        while mpv.wait_event(0.0).is_some() {}
        configure_start(&mpv, start, end.is_some()).unwrap();
        configure_end(&mpv, end).unwrap();
        mpv.command("loadfile", &[source.to_str().unwrap(), "replace"])
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            assert!(Instant::now() < deadline, "cue decode did not finish");
            match mpv.wait_event(0.05) {
                Some(Ok(Event::EndFile(mpv_end_file_reason::Eof))) => break,
                Some(Err(error)) => panic!("cue decode: {error}"),
                _ => {}
            }
        }
        let decoded = decode(&capture, &[]);
        let first = (start.unwrap_or(0.0) * 44100.0).round() as usize;
        let last = (end.unwrap_or(18.0) * 44100.0).round() as usize;
        let reference = decode(
            &source,
            &[
                "-af",
                &format!("atrim=start_sample={first}:end_sample={last}"),
            ],
        );
        assert_eq!(
            decoded, reference,
            "cue segment {start:?}..{end:?} leaked or lost samples"
        );
    }
}

#[test]
fn replaygain_modes_change_decoded_mac_output_and_untagged_audio_stays_level() {
    let fixture = Fixture::new("gain");
    let generated = Command::new("bun")
        .arg(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../tests/linux/replaygain-fixtures.ts"),
        )
        .arg(&fixture.0)
        .output()
        .unwrap();
    assert!(
        generated.status.success(),
        "{}",
        String::from_utf8_lossy(&generated.stderr)
    );
    let mut levels = Vec::new();
    for (name, mode) in [
        ("tagged", crate::NativeReplayGain::Off),
        ("tagged", crate::NativeReplayGain::Track),
        ("tagged", crate::NativeReplayGain::Album),
        ("untagged", crate::NativeReplayGain::Album),
        ("boost", crate::NativeReplayGain::Track),
        ("clipping", crate::NativeReplayGain::Off),
        ("clipping", crate::NativeReplayGain::Track),
    ] {
        let capture = fixture.0.join(format!("{name}-{mode:?}.wav"));
        let mut mpv = Mpv::with_initializer(|init| {
            init.set_option("vo", "null")?;
            init.set_option("ao", "pcm")?;
            init.set_option("ao-pcm-file", capture.to_str().unwrap())?;
            init.set_option("audio-format", "s16")?;
            init.set_option("audio-channels", "mono")?;
            init.set_option("audio-samplerate", 48000_i64)?;
            init.set_option("audio-display", "no")?;
            Ok(())
        })
        .unwrap();
        mpv.hook_add("on_preloaded", 0).unwrap();
        mpv.set_property("volume", 100.0_f64).unwrap();
        let mut gain = crate::mpv_replaygain::ReplayGain::default();
        gain.reset(&mpv, mode).unwrap();
        let source = fixture.0.join(format!("{name}.flac"));
        mpv.command("loadfile", &[source.to_str().unwrap(), "replace"])
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            assert!(Instant::now() < deadline, "gain capture did not finish");
            match mpv.wait_event(0.05) {
                Some(Ok(Event::Hook { id })) => {
                    gain.select(&mpv, false).unwrap();
                    unsafe { mpv.hook_continue(id) }.unwrap();
                }
                Some(Ok(Event::EndFile(mpv_end_file_reason::Eof))) => break,
                Some(Err(error)) => panic!("gain capture: {error}"),
                _ => {}
            }
        }
        assert_eq!(gain.observe(&mpv).unwrap(), Some(mode));
        let pcm = decode(&capture, &[]);
        assert!(!pcm.is_empty());
        let samples: Vec<_> = pcm
            .chunks_exact(2)
            .map(|sample| i16::from_le_bytes([sample[0], sample[1]]))
            .collect();
        let energy: f64 = samples
            .iter()
            .map(|sample| f64::from(*sample).powi(2))
            .sum();
        levels.push((
            (energy / samples.len() as f64).sqrt(),
            samples
                .iter()
                .filter(|sample| i32::from(**sample).abs() >= 32766)
                .count(),
        ));
    }
    for (index, expected_db) in [(1, -6.0_f64), (2, -3.0), (3, 0.0), (4, 6.0)] {
        let observed_db = 20.0 * (levels[index].0 / levels[0].0).log10();
        assert!(
            (observed_db - expected_db).abs() < 0.3,
            "ReplayGain mode {index} measured {observed_db:.2} dB, expected {expected_db:.2} dB"
        );
    }
    assert!(levels[5].1 < 10, "unamplified loud reference clipped");
    assert!(
        levels[6].1 > 1000,
        "the existing no-clip-limit policy did not reach the PCM output"
    );
}

#[test]
fn prepared_local_pair_and_reorder_or_cancel_capture_expected_audio() {
    let fixture = Fixture::new("continuity");
    let album =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/cue/album.flac");
    let parts: Vec<_> = (0..3)
        .map(|index| {
            let path = fixture.0.join(format!("part-{index}.flac"));
            lossless_part(&album, &path, index * 132_300, (index + 1) * 132_300);
            path
        })
        .collect();
    for (case, replacement) in [
        ("prepared", Some(1)),
        ("reordered", Some(2)),
        ("canceled", None),
    ] {
        let capture = fixture.0.join(format!("{case}.wav"));
        let mut mpv = Mpv::with_initializer(|init| {
            init.set_option("vo", "null")?;
            init.set_option("ao", "pcm")?;
            init.set_option("ao-pcm-file", capture.to_str().unwrap())?;
            init.set_option("audio-format", "s16")?;
            init.set_option("audio-channels", "mono")?;
            init.set_option("audio-samplerate", 44100_i64)?;
            init.set_option("gapless-audio", "weak")?;
            init.set_option("keep-open", "yes")?;
            init.set_option("audio-display", "no")?;
            Ok(())
        })
        .unwrap();
        mpv.set_property("pause", true).unwrap();
        mpv.command("loadfile", &[parts[0].to_str().unwrap(), "replace"])
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            assert!(
                Instant::now() < deadline,
                "first prepared source did not load"
            );
            match mpv.wait_event(0.05) {
                Some(Ok(Event::FileLoaded)) => break,
                Some(Err(error)) => panic!("prepared source: {error}"),
                _ => {}
            }
        }
        queue_audio(&mpv, parts[1].to_str().unwrap()).unwrap();
        if replacement != Some(1) {
            cancel_playlist(&mpv).unwrap();
            if let Some(index) = replacement {
                queue_audio(&mpv, parts[index].to_str().unwrap()).unwrap();
            }
        }
        mpv.set_property("pause", false).unwrap();
        let mut second_loaded = replacement.is_none();
        while !second_loaded
            || mpv.get_property::<i64>("playlist-pos").unwrap_or(-1)
                != i64::from(replacement.is_some())
            || !mpv.get_property::<bool>("eof-reached").unwrap_or(false)
        {
            assert!(
                Instant::now() < deadline,
                "prepared audio did not finish in {case}"
            );
            match mpv.wait_event(0.05) {
                Some(Ok(Event::FileLoaded)) => second_loaded = true,
                Some(Err(error)) => panic!("prepared audio: {error}"),
                _ => {}
            }
        }
        drop(mpv);
        let actual = decode(&capture, &[]);
        let mut expected = decode(&parts[0], &[]);
        if let Some(index) = replacement {
            expected.extend(decode(&parts[index], &[]));
        }
        let first_difference = actual
            .chunks_exact(2)
            .zip(expected.chunks_exact(2))
            .position(|(a, b)| a != b);
        assert!(actual == expected, "{case} transition changed captured audio: actual_samples={} expected_samples={} first_difference={first_difference:?}", actual.len() / 2, expected.len() / 2);
    }
}

#[test]
fn authenticated_http_pair_and_slow_or_failed_successor_keep_the_current_audio() {
    let fixture = Fixture::new("http-continuity");
    let album =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/cue/album.flac");
    let first = fixture.0.join("first.flac");
    let second = fixture.0.join("second.flac");
    lossless_part(&album, &first, 0, 132_300);
    lossless_part(&album, &second, 132_300, 264_600);
    for mode in ["normal", "slow", "failed"] {
        let server = HttpSource::new(fs::read(&first).unwrap(), fs::read(&second).unwrap(), mode);
        let capture = fixture.0.join(format!("{mode}.wav"));
        let mut mpv = Mpv::with_initializer(|init| {
            init.set_option("vo", "null")?;
            init.set_option("ao", "pcm")?;
            init.set_option("ao-pcm-file", capture.to_str().unwrap())?;
            init.set_option("audio-format", "s16")?;
            init.set_option("audio-channels", "mono")?;
            init.set_option("audio-samplerate", 44100_i64)?;
            init.set_option("gapless-audio", "weak")?;
            init.set_option("keep-open", "yes")?;
            init.set_option("audio-display", "no")?;
            init.set_option("ytdl", "no")?;
            Ok(())
        })
        .unwrap();
        mpv.command(
            "change-list",
            &[
                "http-header-fields",
                "append",
                "Authorization: MediaBrowser Token=test-token",
            ],
        )
        .unwrap();
        mpv.set_property("pause", true).unwrap();
        let first_url = format!("{}/Audio/first/stream", server.base);
        let second_url = format!("{}/Audio/second/stream", server.base);
        mpv.command("loadfile", &[&first_url, "replace"]).unwrap();
        let deadline = Instant::now() + Duration::from_secs(12);
        loop {
            assert!(
                Instant::now() < deadline,
                "{mode} first HTTP source did not load"
            );
            match mpv.wait_event(0.05) {
                Some(Ok(Event::FileLoaded)) => break,
                Some(Err(error)) => panic!("{mode} first HTTP source: {error}"),
                _ => {}
            }
        }
        queue_audio(&mpv, &second_url).unwrap();
        let started = Instant::now();
        mpv.set_property("pause", false).unwrap();
        let mut second_loaded = false;
        let mut failed = false;
        loop {
            assert!(
                Instant::now() < deadline,
                "{mode} HTTP successor did not finish"
            );
            match mpv.wait_event(0.05) {
                Some(Ok(Event::FileLoaded)) => second_loaded = true,
                Some(Ok(Event::EndFile(mpv_end_file_reason::Error))) | Some(Err(_))
                    if mode == "failed" =>
                {
                    failed = true;
                    break;
                }
                Some(Err(error)) => panic!("{mode} HTTP successor: {error}"),
                _ => {}
            }
            if second_loaded && mpv.get_property::<bool>("eof-reached").unwrap_or(false) {
                break;
            }
        }
        if mode == "slow" {
            assert!(
                started.elapsed() >= Duration::from_secs(3),
                "slow HTTP source did not delay the transition"
            );
        }
        assert_eq!(failed, mode == "failed");
        drop(mpv);
        let actual = decode(&capture, &[]);
        let mut expected = decode(&first, &[]);
        if !failed {
            expected.extend(decode(&second, &[]));
        }
        let first_difference = actual
            .chunks_exact(2)
            .zip(expected.chunks_exact(2))
            .position(|(a, b)| a != b);
        assert!(actual == expected, "{mode} HTTP capture changed samples: actual={} expected={} first_difference={first_difference:?}", actual.len() / 2, expected.len() / 2);
        let requests = server.requests.lock().unwrap();
        assert!(requests.iter().any(|(path, _)| path.contains("/first/")));
        assert!(requests.iter().any(|(path, _)| path.contains("/second/")));
        assert!(
            requests.iter().all(|(_, authorized)| *authorized),
            "{mode} HTTP open lost its private authorization header: {requests:?}"
        );
    }
}

#[test]
fn replay_after_eof_reports_playing_again() {
    let mut mpv = Mpv::with_initializer(|init| {
        init.set_option("vo", "null")?;
        init.set_option("ao", "null")?;
        init.set_option("keep-open", "yes")?;
        init.set_option("speed", 0.25_f64)?;
        Ok(())
    })
    .unwrap();
    let media = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/cue/short.wav");
    mpv.command("loadfile", &[media.to_str().unwrap(), "replace"])
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut loaded = false;
    while !mpv.get_property::<bool>("eof-reached").unwrap_or(false) {
        assert!(Instant::now() < deadline, "fixture did not reach EOF");
        match mpv.wait_event(0.05).transpose().unwrap() {
            Some(Event::FileLoaded) => loaded = true,
            Some(Event::EndFile(mpv_end_file_reason::Error)) => {
                panic!("fixture could not load")
            }
            _ => {}
        }
    }
    assert!(loaded);
    assert!(playback_status(&mpv, loaded, false).0);

    mpv.command("seek", &["0", "absolute+exact"]).unwrap();
    mpv.set_property("pause", false).unwrap();
    loop {
        assert!(
            Instant::now() < deadline,
            "fixture did not restart after seek"
        );
        let _ = mpv.wait_event(0.01);
        if !mpv.get_property::<bool>("eof-reached").unwrap_or(true)
            && mpv.get_property::<f64>("time-pos").unwrap_or(0.0) > 0.0
        {
            let (reported_ended, _, playing) = playback_status(&mpv, loaded, false);
            assert!(
                !reported_ended,
                "replayed media must no longer report ended"
            );
            assert!(playing, "replayed media must report playing");
            break;
        }
    }
}

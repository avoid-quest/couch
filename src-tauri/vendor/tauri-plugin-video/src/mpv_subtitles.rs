use libmpv2::Mpv;

use crate::{Error, NativePlaybackPreferences, NativeSubtitle, NativeSubtitlePreference, Result};

pub(crate) const LOAD_ERROR: &str =
    "Could not load the subtitle. Try another SRT, VTT or ASS file.";

// The coordinator supplies all language and device policy for each source.
pub(crate) fn reset(mpv: &Mpv, preferences: &NativePlaybackPreferences) -> Result<()> {
    if !preferences.speed.is_finite()
        || !(0.25..=4.0).contains(&preferences.speed)
        || !preferences.audio_delay.is_finite()
        || preferences.audio_delay.abs() > 60.0
    {
        return Err(Error::InvalidRequest("Invalid playback preferences".into()));
    }
    mpv.command("change-list", &["sub-files", "clr", ""])
        .map_err(error)?;
    // Only host-approved paths or provider URLs may become external tracks.
    mpv.set_property("sub-auto", "no".to_owned())
        .map_err(error)?;
    mpv.set_property("aid", "auto".to_owned()).map_err(error)?;
    mpv.set_property(
        "sid",
        if preferences.subtitles == NativeSubtitlePreference::Off {
            "no".to_owned()
        } else {
            "auto".to_owned()
        },
    )
    .map_err(error)?;
    for (property, language) in [
        ("alang", &preferences.audio_language),
        ("slang", &preferences.subtitle_language),
    ] {
        mpv.command("change-list", &[property, "clr", ""])
            .map_err(error)?;
        if !language.is_empty() {
            mpv.command("change-list", &[property, "append", language])
                .map_err(error)?;
        }
    }
    mpv.set_property("speed", preferences.speed)
        .map_err(error)?;
    mpv.set_property("audio-delay", preferences.audio_delay)
        .map_err(error)?;
    mpv.set_property("sub-delay", 0.0_f64).map_err(error)
}

pub(crate) fn add(mpv: &Mpv, subtitle: &NativeSubtitle, select: bool) -> Result<()> {
    // An explicit title prevents mpv from publishing its path/URL fallback.
    let title = safe_title(&subtitle.title);
    mpv.command(
        "sub-add",
        &[
            &subtitle.source,
            if select { "select" } else { "auto" },
            &title,
            subtitle.language.as_deref().unwrap_or("und"),
        ],
    )
    .map_err(|_| Error::Pipeline(LOAD_ERROR.into()))
}

pub(crate) fn safe_title(title: &str) -> String {
    let title: String = title
        .chars()
        .filter(|character| !character.is_control())
        .take(160)
        .collect();
    let title = title.trim();
    if title.is_empty() || title.contains('/') || title.contains('\\') {
        "External subtitles".into()
    } else {
        title.to_owned()
    }
}

fn error(_: libmpv2::Error) -> Error {
    Error::Pipeline("Could not apply playback preferences".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use libmpv2::events::Event;
    use std::{
        fs,
        io::{Read, Write},
        net::TcpListener,
        path::{Path, PathBuf},
        process::Command,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn load(
        mpv: &mut Mpv,
        media: &Path,
        preferences: &NativePlaybackPreferences,
        subtitles: &[NativeSubtitle],
    ) {
        mpv.command("stop", &[]).unwrap();
        while let Some(event) = mpv.wait_event(0.0) {
            if let Ok(Event::Hook { id }) = event {
                unsafe { mpv.hook_continue(id) }.unwrap();
            }
        }
        crate::mpv_tracks::reset(mpv, None).unwrap();
        reset(mpv, preferences).unwrap();
        mpv.command("loadfile", &[media.to_str().unwrap(), "replace"])
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut hook_seen = false;
        loop {
            assert!(Instant::now() < deadline, "subtitle load did not finish");
            match mpv.wait_event(0.1) {
                Some(Ok(Event::Hook { id })) => {
                    crate::mpv_tracks::select(mpv, None).unwrap();
                    for subtitle in subtitles {
                        add(mpv, subtitle, false).unwrap();
                    }
                    unsafe { mpv.hook_continue(id) }.unwrap();
                    hook_seen = true;
                }
                Some(Ok(Event::FileLoaded)) => assert!(hook_seen),
                Some(Ok(Event::PlaybackRestart)) if hook_seen => return,
                Some(Err(error)) => panic!("subtitle fixture load: {error}"),
                _ => {}
            }
        }
    }

    fn selected_language(mpv: &Mpv, kind: &str) -> Option<String> {
        let count = mpv.get_property::<i64>("track-list/count").unwrap();
        (0..count).find_map(|index| {
            let prefix = format!("track-list/{index}");
            (mpv.get_property::<String>(&format!("{prefix}/type"))
                .unwrap()
                == kind
                && mpv
                    .get_property::<bool>(&format!("{prefix}/selected"))
                    .unwrap())
            .then(|| {
                mpv.get_property::<String>(&format!("{prefix}/lang"))
                    .unwrap()
            })
        })
    }

    #[test]
    fn external_subtitles_select_real_samples_and_reset_between_sources() {
        let fixture = Fixture(std::env::temp_dir().join(format!(
                "couch-subtitles-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            )));
        fs::create_dir(&fixture.0).unwrap();
        let srt = fixture.0.join("private-secret,english.srt");
        fs::write(
            &srt,
            "1\n00:00:00,000 --> 00:00:05,000\nEnglish subtitle sample\n",
        )
        .unwrap();
        let ass = fixture.0.join("private-secret,italian.ass");
        fs::write(&ass, "[Script Info]\nScriptType: v4.00+\nPlayResX: 640\nPlayResY: 360\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,32,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,20,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Sottotitolo italiano\n").unwrap();
        let media = fixture.0.join("video.mkv");
        let generated = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=blue:size=160x90:rate=24",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=660:sample_rate=48000",
                "-map",
                "0:v",
                "-map",
                "1:a",
                "-map",
                "2:a",
                "-t",
                "5",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-threads",
                "1",
                "-c:a",
                "aac",
                "-metadata:s:a:0",
                "language=eng",
                "-metadata:s:a:1",
                "language=ita",
                "-disposition:a:0",
                "default",
                "-disposition:a:1",
                "0",
            ])
            .arg(&media)
            .output()
            .expect("ffmpeg is required for native subtitle verification");
        assert!(
            generated.status.success(),
            "{}",
            String::from_utf8_lossy(&generated.stderr)
        );
        // Implicit discovery must not load an unapproved adjacent subtitle.
        fs::copy(&srt, fixture.0.join("video.srt")).unwrap();
        let subtitles = [
            NativeSubtitle {
                source: srt.to_str().unwrap().into(),
                title: "English sample".into(),
                language: Some("eng".into()),
            },
            NativeSubtitle {
                source: ass.to_str().unwrap().into(),
                title: "Italian ASS sample".into(),
                language: Some("ita".into()),
            },
        ];
        let mut mpv = Mpv::with_initializer(|init| {
            init.set_option("vo", "null")?;
            init.set_option("ao", "null")?;
            init.set_option("pause", "yes")?;
            init.set_option("keep-open", "yes")?;
            Ok(())
        })
        .unwrap();
        mpv.hook_add("on_preloaded", 0).unwrap();
        let preferences = NativePlaybackPreferences {
            audio_language: "ita".into(),
            subtitle_language: "ita".into(),
            speed: 1.5,
            audio_delay: -0.2,
            ..Default::default()
        };
        load(&mut mpv, &media, &preferences, &subtitles);
        assert_eq!(selected_language(&mpv, "audio").as_deref(), Some("ita"));
        assert_eq!(selected_language(&mpv, "sub").as_deref(), Some("ita"));
        assert_eq!(mpv.get_property::<f64>("speed").unwrap(), 1.5);
        assert!((mpv.get_property::<f64>("audio-delay").unwrap() + 0.2).abs() < 0.000_001);
        assert_eq!(mpv.get_property::<i64>("track-list/count").unwrap(), 5);
        let track_list = mpv.get_property::<String>("track-list/3/title").unwrap();
        assert_eq!(track_list, "English sample");
        mpv.set_property("sub-delay", 1.25_f64).unwrap();
        let missing = NativeSubtitle {
            source: fixture
                .0
                .join("missing-private.srt")
                .to_str()
                .unwrap()
                .into(),
            ..subtitles[0].clone()
        };
        let failure = add(&mpv, &missing, true).unwrap_err().to_string();
        assert!(!failure.contains("private"));
        assert_eq!(selected_language(&mpv, "sub").as_deref(), Some("ita"));
        assert_eq!(mpv.get_property::<f64>("duration").unwrap().round(), 5.0);
        // User attachment selects its observed track even when policy was off.
        let off = NativePlaybackPreferences {
            subtitles: NativeSubtitlePreference::Off,
            ..preferences.clone()
        };
        load(&mut mpv, &media, &off, &subtitles);
        assert_eq!(selected_language(&mpv, "sub"), None);
        add(&mpv, &subtitles[0], true).unwrap();
        assert_eq!(selected_language(&mpv, "sub").as_deref(), Some("eng"));
        assert_eq!(mpv.get_property::<f64>("sub-delay").unwrap(), 0.0);
        // Measure whether a stalled upstream request blocks this native call.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let body = fs::read(&srt).unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = [0_u8; 4096];
            stream.read(&mut request).unwrap();
            std::thread::sleep(Duration::from_millis(1000));
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/x-subrip\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
            stream.write_all(&body).unwrap();
        });
        let slow = NativeSubtitle {
            source: format!("http://{address}/subtitle.srt"),
            ..subtitles[0].clone()
        };
        let started = Instant::now();
        add(&mpv, &slow, true).unwrap();
        eprintln!(
            "sub-add HTTP probe: 1000 ms delayed response blocked native command for {} ms",
            started.elapsed().as_millis()
        );
        server.join().unwrap();
        mpv.set_property("aid", 2_i64).unwrap();
        load(&mut mpv, &media, &NativePlaybackPreferences::default(), &[]);
        assert_eq!(mpv.get_property::<i64>("track-list/count").unwrap(), 3);
        assert_eq!(selected_language(&mpv, "sub"), None);
        assert_eq!(selected_language(&mpv, "audio").as_deref(), Some("eng"));
        assert_eq!(mpv.get_property::<String>("options/aid").unwrap(), "auto");
        assert_eq!(mpv.get_property::<String>("options/sid").unwrap(), "auto");
        assert_eq!(mpv.get_property::<f64>("speed").unwrap(), 1.0);
        assert_eq!(mpv.get_property::<f64>("audio-delay").unwrap(), 0.0);
        assert_eq!(mpv.get_property::<f64>("sub-delay").unwrap(), 0.0);
        assert_eq!(safe_title(&subtitles[0].source), "External subtitles");
        assert_eq!(safe_title("\0\u{7f}"), "External subtitles");
    }
}

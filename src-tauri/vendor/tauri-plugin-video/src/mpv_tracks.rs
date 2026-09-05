use libmpv2::Mpv;

use crate::{Error, Result};

pub(crate) fn reset(mpv: &Mpv, max_height: Option<u16>) -> Result<()> {
    if max_height.is_some_and(|height| !matches!(height, 480 | 720 | 1080)) {
        return Err(Error::InvalidRequest(
            "Unsupported DASH quality limit".into(),
        ));
    }
    mpv.set_property("vid", "auto".to_owned()).map_err(error)
}

// Called from on_preloaded, before mpv selects tracks or creates decoders.
pub(crate) fn select(mpv: &Mpv, max_height: Option<u16>) -> Result<()> {
    let Some(max_height) = max_height else {
        return Ok(());
    };
    let count = mpv.get_property::<i64>("track-list/count").map_err(error)?;
    let mut selected = None;
    for track in 0..count.clamp(0, 2048) {
        let prefix = format!("track-list/{track}");
        if mpv
            .get_property::<String>(&format!("{prefix}/type"))
            .ok()
            .as_deref()
            != Some("video")
            || mpv
                .get_property::<bool>(&format!("{prefix}/external"))
                .unwrap_or(false)
        {
            continue;
        }
        let height = mpv
            .get_property::<i64>(&format!("{prefix}/demux-h"))
            .unwrap_or(0);
        if height > 0
            && height <= i64::from(max_height)
            && selected.is_none_or(|(best, _)| height > best)
        {
            let id = mpv
                .get_property::<i64>(&format!("{prefix}/id"))
                .map_err(error)?;
            selected = Some((height, id));
        }
    }
    match selected {
        Some((_, id)) => mpv.set_property("vid", id).map_err(error),
        None => Err(Error::Pipeline(format!(
            "No DASH video track fits the {max_height}p limit. Choose another quality."
        ))),
    }
}

fn error(error: libmpv2::Error) -> Error {
    Error::Pipeline(format!("mpv video selection: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use libmpv2::events::Event;
    use std::{
        fs,
        process::Command,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn dash_selection_applies_height_caps_before_decoding_and_resets() {
        let directory = std::env::temp_dir().join(format!(
            "couch-dash-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&directory).unwrap();
        struct Fixture(std::path::PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let fixture = Fixture(directory);
        let manifest = fixture.0.join("manifest.mpd");
        let generated = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000",
                "-f",
                "lavfi",
                "-i",
                "color=red:size=640x360:rate=24",
                "-f",
                "lavfi",
                "-i",
                "color=blue:size=1280x720:rate=24",
                "-map",
                "0:a",
                "-map",
                "1:v",
                "-map",
                "2:v",
                "-t",
                "3",
                "-c:a",
                "aac",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-threads",
                "1",
                "-b:v:0",
                "150k",
                "-b:v:1",
                "500k",
                "-g",
                "24",
                "-seg_duration",
                "1",
                "-adaptation_sets",
                "id=0,streams=a id=1,streams=v",
                "-f",
                "dash",
            ])
            .arg(&manifest)
            .output()
            .expect("ffmpeg is required for native DASH verification");
        assert!(
            generated.status.success(),
            "{}",
            String::from_utf8_lossy(&generated.stderr)
        );

        let mut mpv = Mpv::with_initializer(|init| {
            init.set_option("vo", "null")?;
            init.set_option("ao", "null")?;
            init.set_option("pause", "yes")?;
            init.set_option("keep-open", "yes")?;
            Ok(())
        })
        .unwrap();
        mpv.hook_add("on_preloaded", 0).unwrap();
        let source = manifest.to_str().unwrap();

        let load = |mpv: &mut Mpv, index| {
            mpv.command("stop", &[]).unwrap();
            while let Some(event) = mpv.wait_event(0.0) {
                if let Ok(Event::Hook { id }) = event {
                    unsafe { mpv.hook_continue(id) }.unwrap();
                }
            }
            reset(mpv, index).unwrap();
            mpv.command("loadfile", &[source, "replace"]).unwrap();
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut hook_seen = false;
            loop {
                assert!(Instant::now() < deadline, "DASH load did not finish");
                match mpv.wait_event(0.1) {
                    Some(Ok(Event::Hook { id })) => {
                        hook_seen = true;
                        let selected = select(mpv, index);
                        unsafe { mpv.hook_continue(id) }.unwrap();
                        selected?;
                    }
                    Some(Ok(Event::FileLoaded)) => {
                        assert!(hook_seen, "selection must precede FileLoaded");
                        return Ok::<_, Error>(mpv.get_property::<i64>("vid").unwrap());
                    }
                    Some(Err(error)) => panic!("DASH load: {error}"),
                    _ => {}
                }
            }
        };
        assert_eq!(load(&mut mpv, Some(480)).unwrap(), 1);
        assert_eq!(
            mpv.get_property::<i64>("track-list/0/demux-h").unwrap(),
            360
        );
        assert!(mpv.get_property::<bool>("track-list/0/selected").unwrap());
        assert_eq!(load(&mut mpv, Some(720)).unwrap(), 2);
        assert!(mpv.get_property::<bool>("track-list/1/selected").unwrap());
        assert_eq!(
            mpv.get_property::<i64>("track-list/1/demux-h").unwrap(),
            720
        );
        // Keep only the 720p representation, leaving no video that fits 480p.
        let original = fs::read_to_string(&manifest).unwrap();
        let start = original.find("<Representation id=\"1\"").unwrap();
        let end = start
            + original[start..].find("</Representation>").unwrap()
            + "</Representation>".len();
        fs::write(
            &manifest,
            format!("{}{}", &original[..start], &original[end..]),
        )
        .unwrap();
        assert!(load(&mut mpv, Some(480))
            .unwrap_err()
            .to_string()
            .contains("No DASH video track fits the 480p limit"));
        fs::write(&manifest, original).unwrap();
        let automatic = load(&mut mpv, None).unwrap();
        assert_eq!(
            automatic, 2,
            "Best must select the highest 720p representation"
        );
        assert!(mpv.get_property::<bool>("track-list/1/selected").unwrap());
        assert_eq!(
            mpv.get_property::<String>("options/vid").unwrap(),
            "auto",
            "ordinary loads must not inherit a previous video ID"
        );
        assert!(reset(&mpv, Some(0)).is_err());

        // Stop an old load while its hook holds playback, then replace it.
        mpv.command("stop", &[]).unwrap();
        mpv.command("loadfile", &[source, "replace"]).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            assert!(Instant::now() < deadline, "pending hook was not emitted");
            if let Some(Ok(Event::Hook { id })) = mpv.wait_event(0.1) {
                mpv.command("stop", &[]).unwrap();
                unsafe { mpv.hook_continue(id) }.unwrap();
                break;
            }
        }
        assert_eq!(load(&mut mpv, Some(480)).unwrap(), 1);
    }
}

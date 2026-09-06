use libmpv2::Mpv;

use crate::{Error, NativeReplayGain, Result};

#[derive(Default)]
pub(crate) struct ReplayGain {
    mode: NativeReplayGain,
    available: bool,
}

impl ReplayGain {
    pub(crate) fn reset(&mut self, mpv: &Mpv, mode: NativeReplayGain) -> Result<()> {
        // Reset before loadfile so a replacement cannot inherit the old gain.
        mpv.set_property("replaygain", "no".to_owned())
            .map_err(error)?;
        mpv.set_property("replaygain-preamp", 0.0_f64)
            .map_err(error)?;
        mpv.set_property("replaygain-fallback", 0.0_f64)
            .map_err(error)?;
        mpv.set_property("replaygain-clip", false).map_err(error)?;
        self.mode = mode;
        self.available = false;
        Ok(())
    }

    // on_preloaded has demuxed tracks, before any audio reaches the output.
    pub(crate) fn select(&mut self, mpv: &Mpv, radio: bool) -> Result<()> {
        let count = mpv.get_property::<i64>("track-list/count").map_err(error)?;
        let mut audio = false;
        let mut video = false;
        let mut safe = true;
        for index in 0..count.clamp(0, 2048) {
            let prefix = format!("track-list/{index}");
            match mpv
                .get_property::<String>(&format!("{prefix}/type"))
                .map_err(error)?
                .as_str()
            {
                "audio" => {
                    audio = true;
                    for mode in ["track", "album"] {
                        let gain = mpv
                            .get_property::<f64>(&format!("{prefix}/replaygain-{mode}-gain"))
                            .ok();
                        let peak = mpv
                            .get_property::<f64>(&format!("{prefix}/replaygain-{mode}-peak"))
                            .ok();
                        // libmpv's R128 text path accepts finite gains whose
                        // conversion can overflow its float mixer coefficient.
                        safe &= gain.is_none_or(|gain| {
                            gain.is_finite() && (10.0_f64.powf(gain / 20.0) as f32).is_finite()
                        }) && peak.is_none_or(|peak| peak.is_finite() && peak >= 0.0);
                    }
                }
                "video" => {
                    video |= !mpv
                        .get_property::<bool>(&format!("{prefix}/albumart"))
                        .unwrap_or(false)
                }
                _ => {}
            }
        }
        self.available = !radio && audio && !video && safe && count <= 2048;
        self.set_mode(mpv, self.mode)
    }

    pub(crate) fn set_mode(&mut self, mpv: &Mpv, mode: NativeReplayGain) -> Result<()> {
        let value = match (self.available, mode) {
            (true, NativeReplayGain::Track) => "track",
            (true, NativeReplayGain::Album) => "album",
            _ => "no",
        };
        mpv.set_property("replaygain", value.to_owned())
            .map_err(error)?;
        // A command received during preload must survive track discovery.
        self.mode = mode;
        Ok(())
    }

    pub(crate) fn observe(&self, mpv: &Mpv) -> Result<Option<NativeReplayGain>> {
        if !self.available {
            return Ok(None);
        }
        match mpv
            .get_property::<String>("replaygain")
            .map_err(error)?
            .as_str()
        {
            "no" => Ok(Some(NativeReplayGain::Off)),
            "track" => Ok(Some(NativeReplayGain::Track)),
            "album" => Ok(Some(NativeReplayGain::Album)),
            _ => Err(Error::Pipeline(
                "The player reported an unsupported ReplayGain mode".into(),
            )),
        }
    }
}

fn error(_: libmpv2::Error) -> Error {
    Error::Pipeline("Could not apply music ReplayGain".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use libmpv2::events::Event;
    use std::{
        fs,
        path::Path,
        process::Command,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    fn load(
        mpv: &mut Mpv,
        gain: &mut ReplayGain,
        path: &Path,
        mode: NativeReplayGain,
        radio: bool,
        pending: Option<NativeReplayGain>,
    ) {
        mpv.command("stop", &[]).unwrap();
        while let Some(event) = mpv.wait_event(0.0) {
            if let Ok(Event::Hook { id }) = event {
                unsafe { mpv.hook_continue(id) }.unwrap();
            }
        }
        gain.reset(mpv, mode).unwrap();
        assert_eq!(mpv.get_property::<String>("replaygain").unwrap(), "no");
        assert_eq!(gain.observe(mpv).unwrap(), None);
        mpv.command("loadfile", &[path.to_str().unwrap(), "replace"])
            .unwrap();
        if let Some(mode) = pending {
            gain.set_mode(mpv, mode).unwrap();
        }
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut selected = false;
        loop {
            assert!(Instant::now() < deadline, "ReplayGain fixture did not load");
            match mpv.wait_event(0.1) {
                Some(Ok(Event::Hook { id })) => {
                    gain.select(mpv, radio).unwrap();
                    selected = true;
                    unsafe { mpv.hook_continue(id) }.unwrap();
                }
                Some(Ok(Event::FileLoaded)) if selected => break,
                Some(Err(error)) => panic!("Native ReplayGain fixture: {error}"),
                _ => {}
            }
        }
    }

    #[test]
    fn replaygain_native_policy_resets_and_applies_before_audio() {
        let directory = std::env::temp_dir().join(format!(
            "couch-replaygain-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        struct Fixture(std::path::PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let fixture = Fixture(directory);
        let generated = Command::new("bun")
            .arg(
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../../../tests/linux/replaygain-fixtures.ts"),
            )
            .arg(&fixture.0)
            .output()
            .expect("Bun and ffmpeg are required for ReplayGain fixtures");
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
            init.set_option("audio-display", "no")?;
            Ok(())
        })
        .unwrap();
        mpv.hook_add("on_preloaded", 0).unwrap();
        mpv.set_property("volume", 37.0_f64).unwrap();
        mpv.set_property("audio-delay", 0.25_f64).unwrap();
        let mut gain = ReplayGain::default();
        load(
            &mut mpv,
            &mut gain,
            &fixture.0.join("tagged.flac"),
            NativeReplayGain::Track,
            false,
            None,
        );
        assert_eq!(gain.observe(&mpv).unwrap(), Some(NativeReplayGain::Track));
        assert_eq!(
            mpv.get_property::<f64>("current-tracks/audio/replaygain-track-gain")
                .unwrap(),
            -6.0
        );
        assert_eq!(
            mpv.get_property::<f64>("current-tracks/audio/replaygain-album-gain")
                .unwrap(),
            -3.0
        );
        for mode in [
            NativeReplayGain::Album,
            NativeReplayGain::Off,
            NativeReplayGain::Track,
        ] {
            gain.set_mode(&mpv, mode).unwrap();
            assert_eq!(gain.observe(&mpv).unwrap(), Some(mode));
            assert_eq!(mpv.get_property::<f64>("volume").unwrap(), 37.0);
            assert_eq!(mpv.get_property::<f64>("audio-delay").unwrap(), 0.25);
            assert!(mpv.get_property::<bool>("pause").unwrap());
        }
        let ubuntu_mpv = mpv
            .get_property::<String>("mpv-version")
            .unwrap()
            .contains("0.37.");
        for (name, peak, expected_gain) in [
            ("boost.flac", 0.125, 6.0),
            ("missing-peak.flac", 1.0, if ubuntu_mpv { 0.0 } else { 6.0 }),
            (
                "missing-peak-attenuation.flac",
                1.0,
                if ubuntu_mpv { 0.0 } else { -6.0 },
            ),
            ("r128-missing-peak.flac", 0.0, 6.0),
        ] {
            load(
                &mut mpv,
                &mut gain,
                &fixture.0.join(name),
                NativeReplayGain::Album,
                false,
                None,
            );
            assert_eq!(
                mpv.get_property::<f64>("current-tracks/audio/replaygain-track-peak")
                    .unwrap(),
                peak
            );
            assert_eq!(
                mpv.get_property::<f64>("current-tracks/audio/replaygain-album-peak")
                    .unwrap(),
                peak
            );
            assert_eq!(
                mpv.get_property::<f64>("current-tracks/audio/replaygain-album-gain")
                    .unwrap(),
                expected_gain
            );
        }
        for (name, radio, expected) in [
            ("cover-art.flac", false, Some(NativeReplayGain::Album)),
            ("tagged.flac", true, None),
            ("video.mkv", false, None),
            ("r128-overflow.flac", false, None),
            ("r128-nonfinite.flac", false, Some(NativeReplayGain::Album)),
            ("untagged.flac", false, Some(NativeReplayGain::Album)),
        ] {
            load(
                &mut mpv,
                &mut gain,
                &fixture.0.join(name),
                NativeReplayGain::Album,
                radio,
                None,
            );
            assert_eq!(
                gain.observe(&mpv).unwrap(),
                expected,
                "{name}, radio={radio}"
            );
            if expected.is_none() {
                gain.set_mode(&mpv, NativeReplayGain::Track).unwrap();
                assert_eq!(mpv.get_property::<String>("replaygain").unwrap(), "no");
            }
            assert!(!mpv.get_property::<bool>("replaygain-clip").unwrap());
            assert_eq!(mpv.get_property::<f64>("replaygain-preamp").unwrap(), 0.0);
            assert_eq!(mpv.get_property::<f64>("replaygain-fallback").unwrap(), 0.0);
        }
        // A current command before on_preloaded supersedes the starting mode.
        load(
            &mut mpv,
            &mut gain,
            &fixture.0.join("tagged.flac"),
            NativeReplayGain::Track,
            false,
            Some(NativeReplayGain::Off),
        );
        assert_eq!(gain.observe(&mpv).unwrap(), Some(NativeReplayGain::Off));
        load(
            &mut mpv,
            &mut gain,
            &fixture.0.join("tagged.flac"),
            NativeReplayGain::Album,
            false,
            Some(NativeReplayGain::Track),
        );
        assert_eq!(gain.observe(&mpv).unwrap(), Some(NativeReplayGain::Track));
        mpv.command("stop", &[]).unwrap();
        gain.reset(&mpv, NativeReplayGain::Off).unwrap();
        assert_eq!(gain.observe(&mpv).unwrap(), None);
        assert_eq!(mpv.get_property::<String>("replaygain").unwrap(), "no");
    }
}

// mpv truncates (boundary - frame_pts) * sample_rate to an integer. Move cue
// timestamps one representable value up at the native handoff, so the observed
// 44.1 kHz fixture's fractional CD markers do not round below their sample.
// Canonical cue bounds, relative progress and ordinary files stay unchanged.
pub(crate) fn timestamp(position: f64, cue: bool) -> f64 {
    if cue && position > 0.0 && position < f64::MAX { f64::from_bits(position.to_bits() + 1) } else { position }
}

#[cfg(test)]
mod tests {
    use super::timestamp;

    #[test]
    fn cue_boundaries_and_relative_resume_survive_mpv_sample_truncation() {
        // The fixture's FLAC frames have 4,608 samples. These are the actual
        // start/end markers and their two-second relative seek/resume points.
        for (position, frame, expected) in [
            (400.0 / 75.0, 235_008, 192),
            (875.0 / 75.0, 511_488, 3_012),
            (400.0 / 75.0 + 2.0, 322_560, 840),
            (875.0 / 75.0 + 2.0, 599_040, 3_660),
        ] {
            let samples = |value| ((value - frame as f64 / 44_100.0) * 44_100.0) as usize;
            assert_eq!(samples(position), expected - 1, "Reproduce the native truncation defect");
            assert_eq!(samples(timestamp(position, true)), expected);
            assert_eq!(timestamp(position, true).to_bits(), position.to_bits() + 1);
        }
    }

    #[test]
    fn cue_conversion_resets_for_ordinary_files_and_preserves_zero() {
        for position in [0.0, 400.0 / 75.0, 875.0 / 75.0, 18.0, f64::MAX] {
            assert_eq!(timestamp(position, false).to_bits(), position.to_bits());
            assert!(timestamp(position, true).is_finite());
        }
        for position in [0.0, -0.0, -1.0, f64::INFINITY, f64::NEG_INFINITY, f64::NAN] {
            assert_eq!(timestamp(position, true).to_bits(), position.to_bits());
        }
    }
}

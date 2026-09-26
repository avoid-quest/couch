use std::io::Write;
use std::path::Path;

pub(crate) fn write_atomic(path: &Path, bytes: &[u8], description: &str) -> Result<(), String> {
    let name = path.file_name().ok_or("Choose a file destination.")?;
    let temporary = path.with_file_name(format!(
        ".{}.{}.partial",
        name.to_string_lossy(),
        uuid::Uuid::new_v4()
    ));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|error| {
        format!("Couldn't save the {description}: {error}. No complete file was saved.")
    })
}

#[cfg(test)]
mod tests {
    use super::write_atomic;

    #[test]
    fn failed_save_preserves_destination_and_cleans_partial_file() {
        let directory = std::env::temp_dir().join(format!("couch-export-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let destination = directory.join("couch-diagnostics.json");
        std::fs::create_dir(&destination).unwrap();
        assert!(write_atomic(&destination, b"report", "diagnostics report").is_err());
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        std::fs::remove_dir(&destination).unwrap();
        write_atomic(&destination, b"report", "diagnostics report").unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), b"report");
        std::fs::remove_dir_all(directory).unwrap();
    }
}

use std::io::Write;
use std::path::Path;

use tauri_plugin_dialog::DialogExt;

fn write_archive(path: &Path, archive: &[u8]) -> Result<(), String> {
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
        file.write_all(archive)?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|error| {
        format!("Could not save the metadata archive: {error}. No complete file was saved.")
    })
}

#[tauri::command]
pub async fn save_metadata_export(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<bool, String> {
    let id = request
        .headers()
        .get("X-Couch-Item-Id")
        .and_then(|value| value.to_str().ok())
        .ok_or("Missing metadata item ID.")?;
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("Invalid metadata item ID.".into());
    }
    let tauri::ipc::InvokeBody::Raw(archive) = request.body() else {
        return Err("Invalid metadata archive data.".into());
    };
    if archive.is_empty() {
        return Err("Metadata archive is empty.".into());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Save Couch metadata archive")
        .set_file_name(format!(
            "couch-metadata-{id}-{}.tar",
            time::OffsetDateTime::now_utc().unix_timestamp()
        ))
        .save_file(move |path| {
            let _ = sender.send(path);
        });
    let Some(path) = receiver
        .await
        .map_err(|_| "Save dialog closed unexpectedly.".to_string())?
    else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|error| error.to_string())?;
    write_archive(&path, archive)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::write_archive;

    #[test]
    fn failed_save_preserves_destination_and_cleans_partial_file() {
        let directory = std::env::temp_dir().join(format!("couch-export-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let destination = directory.join("couch-metadata-test.tar");
        std::fs::create_dir(&destination).unwrap();
        assert!(write_archive(&destination, b"archive").is_err());
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        std::fs::remove_dir(&destination).unwrap();
        write_archive(&destination, b"archive").unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), b"archive");
        std::fs::remove_dir_all(directory).unwrap();
    }
}

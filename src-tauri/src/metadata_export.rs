use tauri_plugin_dialog::DialogExt;

use crate::file_export::write_atomic;

#[tauri::command]
pub async fn save_metadata_export(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<bool, String> {
    crate::operating_mode::local_authority(&window)?;
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
    write_atomic(&path, archive, "metadata archive")?;
    Ok(true)
}

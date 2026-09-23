use tauri_plugin_dialog::DialogExt;

use crate::file_export::write_atomic;

#[tauri::command]
pub async fn save_diagnostics_export(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<bool, String> {
    crate::operating_mode::trusted(&window)?;
    let tauri::ipc::InvokeBody::Raw(report) = request.body() else {
        return Err("Invalid diagnostics report data.".into());
    };
    if report.is_empty()
        || report.len() > 128 * 1024
        || serde_json::from_slice::<serde_json::Value>(report).is_err()
    {
        return Err("Invalid diagnostics report data.".into());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Save Couch diagnostics")
        .set_file_name(format!(
            "couch-diagnostics-{}.json",
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
    write_atomic(&path, report, "diagnostics report")?;
    Ok(true)
}

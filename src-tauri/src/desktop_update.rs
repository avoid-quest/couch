//! Desktop replacement through Tauri. Update admission and work checks stay in
//! the same Bun maintenance path used by the supervised Linux TV installation.
use crate::appimage_update::{
    build, candidate, current_identity, enrollment, error, journal, now, read_transaction, save,
    verify, Action, Candidate, Channel, Enrollment, Request, MAX_ARCHIVE,
};
use serde::Deserialize;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux", test))]
use std::io::Read;
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
#[cfg(not(target_os = "linux"))]
use tauri::utils::config::BundleType;
use tauri::Manager;
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u64,
    version: String,
    revision: String,
    target: String,
    data_format: u64,
    readable_data_formats: Vec<u64>,
    packaged: bool,
}

fn target() -> Option<(&'static str, &'static str)> {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Some(("linux-x86_64-appimage", "x86_64-unknown-linux-gnu"));
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Some(("darwin-aarch64", "aarch64-apple-darwin"));
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Some(("windows-x86_64-nsis", "x86_64-pc-windows-msvc"));
    }
    #[allow(unreachable_code)]
    None
}

pub fn running(app: &tauri::AppHandle) -> bool {
    if cfg!(dev) || build()["packaged"] != true || target().is_none() {
        return false;
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::MetadataExt;
        let Some(path) = app.env().appimage.as_ref().map(PathBuf::from) else {
            return false;
        };
        let Some(parent) = path.parent() else {
            return false;
        };
        if !path.is_absolute() || path == Path::new("/var/lib/couch/application/Couch.AppImage") {
            return false;
        }
        return fs::symlink_metadata(&path).is_ok_and(|entry| {
            entry.is_file()
                && !entry.file_type().is_symlink()
                && entry.uid() == unsafe { libc::geteuid() }
                && entry.mode() & 0o200 != 0
        }) && fs::symlink_metadata(parent).is_ok_and(|entry| {
            entry.is_dir()
                && !entry.file_type().is_symlink()
                && entry.uid() == unsafe { libc::geteuid() }
                && entry.mode() & 0o300 == 0o300
        });
    }
    #[cfg(not(target_os = "linux"))]
    match tauri::utils::platform::bundle_type() {
        #[cfg(target_os = "macos")]
        Some(BundleType::App | BundleType::Dmg) => {
            std::env::current_exe().is_ok_and(|path| !path.starts_with("/Volumes"))
        }
        #[cfg(target_os = "windows")]
        Some(BundleType::Nsis) => true,
        _ => {
            let _ = app;
            false
        }
    }
}

pub fn directory(data: &Path) -> PathBuf {
    // An existing Linux desktop AppImage may relaunch into a legacy trial.
    #[cfg(target_os = "linux")]
    return data.join("updates/appimage");
    #[cfg(not(target_os = "linux"))]
    data.join("updates/desktop")
}

fn endpoint(current: &str, channel: Channel) -> Result<reqwest::Url, String> {
    semver::Version::parse(current).map_err(error)?;
    let (platform, _) = target().ok_or("This desktop target has no updater.")?;
    let mut url = reqwest::Url::parse(&format!(
        "https://cdn.crabnebula.app/update/avoid-quest/couch/{platform}/{current}"
    ))
    .map_err(error)?;
    if matches!(channel, Channel::Preview) {
        url.set_query(Some("channel=preview"));
    }
    Ok(url)
}

async fn check(
    app: &tauri::AppHandle,
    trust: &Enrollment,
    channel: Channel,
) -> Result<Option<(Update, Candidate)>, String> {
    let (platform, _) = target().ok_or("This desktop target has no updater.")?;
    let update = app
        .updater_builder()
        .pubkey(&trust.pubkey)
        .target(platform)
        .endpoints(vec![endpoint(
            &app.package_info().version.to_string(),
            channel,
        )?])
        .map_err(error)?
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(error)?
        .check()
        .await
        .map_err(error)?;
    update
        .map(|value| candidate(&value).map(|summary| (value, summary)))
        .transpose()
}

fn validate(manifest: &Manifest, version: &str, current_data_format: u64) -> Result<(), String> {
    let (_, expected) = target().ok_or("This desktop target has no updater.")?;
    if manifest.schema_version != 1
        || manifest.version != version
        || manifest.target != expected
        || manifest.revision.len() != 40
        || !manifest.revision.bytes().all(|b| b.is_ascii_hexdigit())
        || !manifest.packaged
        || manifest.data_format == 0
        || !manifest
            .readable_data_formats
            .contains(&current_data_format)
    {
        return Err("The signed update is for another platform, version or data format. Check for a compatible release.".into());
    }
    Ok(())
}

fn trial_failure(
    transaction: &serde_json::Value,
    current: &serde_json::Value,
    error: Option<&str>,
) -> Option<String> {
    let wrong_identity = transaction["version"] != current["version"]
        || transaction["revision"] != current["revision"]
        || transaction["dataFormat"]
            .as_u64()
            .is_some_and(|format| current["dataFormat"] != format);
    error.map(str::to_owned).or_else(|| {
        wrong_identity.then(|| "The running app does not match the installed update. Retry or reinstall a verified compatible release without removing Couch data.".into())
    })
}

#[cfg(any(target_os = "macos", test))]
fn mac_manifest(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let decoder = flate2::read::GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(decoder);
    let mut manifest = None;
    let mut executable = false;
    for entry in archive.entries().map_err(error)? {
        let mut entry = entry.map_err(error)?;
        let path = entry.path().map_err(error)?;
        let name = path.to_string_lossy();
        if name.trim_start_matches("./") == "Couch.app/Contents/MacOS/couch"
            && entry.header().entry_type().is_file()
        {
            let mut header = [0; 8];
            entry.read_exact(&mut header).map_err(error)?;
            if executable || header != [0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1] {
                return Err("The signed app bundle has no Apple Silicon Couch executable.".into());
            }
            executable = true;
        } else if name.trim_start_matches("./") == "Couch.app/Contents/Resources/release.json"
            && entry.header().entry_type().is_file()
        {
            if entry.size() > 64 * 1024 || manifest.is_some() {
                return Err("The signed release manifest is invalid.".into());
            }
            let mut content = Vec::new();
            entry.read_to_end(&mut content).map_err(error)?;
            manifest = Some(content);
        }
    }
    let mut decoder = archive.into_inner();
    std::io::copy(&mut decoder, &mut std::io::sink()).map_err(error)?;
    if !executable {
        return Err("The signed app bundle has no Apple Silicon Couch executable.".into());
    }
    manifest.ok_or_else(|| "The signed app bundle has no release manifest.".into())
}

#[cfg(any(target_os = "windows", test))]
fn pe_x64(bytes: &mut impl Read) -> Result<bool, String> {
    let mut header = Vec::new();
    bytes
        .take(1024 * 1024)
        .read_to_end(&mut header)
        .map_err(error)?;
    if header.len() < 64 || &header[..2] != b"MZ" {
        return Ok(false);
    }
    let offset = u32::from_le_bytes(header[60..64].try_into().unwrap()) as usize;
    Ok(header
        .get(offset..offset + 6)
        .is_some_and(|pe| pe == b"PE\0\0\x64\x86"))
}

#[cfg(any(target_os = "windows", test))]
fn windows_manifest(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(error)?;
    let mut manifest = None;
    let mut installer = false;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(error)?;
        if file.name() == "release.json" {
            if file.size() > 64 * 1024 || manifest.is_some() {
                return Err("The signed release manifest is invalid.".into());
            }
            let mut content = Vec::new();
            file.read_to_end(&mut content).map_err(error)?;
            manifest = Some(content);
        } else if file.name().ends_with(".exe") && !file.name().contains('/') {
            if installer || !pe_x64(&mut file)? {
                return Err("The signed update is not one x64 NSIS installer.".into());
            }
            installer = true;
        } else if file.name().ends_with(".msi") {
            return Err("The signed update uses an MSI installer, not NSIS.".into());
        }
    }
    if !installer {
        return Err("The signed update has no x64 NSIS installer.".into());
    }
    manifest.ok_or_else(|| "The signed installer archive has no release manifest.".into())
}

#[cfg(target_os = "linux")]
fn appimage_offset(bytes: &[u8]) -> Result<usize, String> {
    let invalid = || "The signed update is not an x64 type 2 AppImage.".to_string();
    let header = bytes.get(..64).ok_or_else(invalid)?;
    if &header[..4] != b"\x7fELF"
        || header[4] != 2
        || header[5] != 1
        || &header[8..11] != b"AI\x02"
        || &header[18..20] != b"\x3e\0"
    {
        return Err(invalid());
    }
    let offset = u64::from_le_bytes(header[40..48].try_into().unwrap());
    let width = u16::from_le_bytes(header[58..60].try_into().unwrap()) as u64;
    let count = u16::from_le_bytes(header[60..62].try_into().unwrap()) as u64;
    if width < 64 || count == 0 {
        return Err(invalid());
    }
    let table_size = width.checked_mul(count).ok_or_else(invalid)?;
    let table_end = offset.checked_add(table_size).ok_or_else(invalid)?;
    let last = table_end.checked_sub(width).ok_or_else(invalid)?;
    let section_end = last.checked_add(64).ok_or_else(invalid)?;
    let section = bytes
        .get(usize::try_from(last).map_err(error)?..usize::try_from(section_end).map_err(error)?)
        .ok_or_else(invalid)?;
    let section_start = u64::from_le_bytes(section[24..32].try_into().unwrap());
    let section_size = u64::from_le_bytes(section[32..40].try_into().unwrap());
    let image_offset = table_end.max(section_start.checked_add(section_size).ok_or_else(invalid)?);
    let image_offset = usize::try_from(image_offset).map_err(error)?;
    if bytes.get(image_offset..image_offset.saturating_add(4)) != Some(b"hsqs") {
        return Err(invalid());
    }
    Ok(image_offset)
}

#[cfg(target_os = "linux")]
fn linux_manifest(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let offset = appimage_offset(bytes)?;
    let archive = squashfs_reader::FileSystem::from_read(std::io::Cursor::new(&bytes[offset..]))
        .map_err(error)?;
    let mut file = archive.open("usr/lib/Couch/release.json").map_err(error)?;
    let mut manifest = Vec::new();
    file.by_ref()
        .take(64 * 1024 + 1)
        .read_to_end(&mut manifest)
        .map_err(error)?;
    if manifest.len() > 64 * 1024 {
        return Err("The signed release manifest is too large.".into());
    }
    Ok(manifest)
}

fn inspect(bytes: &[u8], version: &str) -> Result<Manifest, String> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_ARCHIVE {
        return Err("The staged update has an invalid size.".into());
    }
    #[cfg(target_os = "macos")]
    let manifest = mac_manifest(bytes)?;
    #[cfg(target_os = "windows")]
    let manifest = windows_manifest(bytes)?;
    #[cfg(target_os = "linux")]
    let manifest = linux_manifest(bytes)?;
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let manifest: Vec<u8> = return Err("This desktop target has no updater.".into());
    let manifest: Manifest = serde_json::from_slice(&manifest).map_err(error)?;
    validate(
        &manifest,
        version,
        build()["dataFormat"]
            .as_u64()
            .ok_or("Missing current data format")?,
    )?;
    Ok(manifest)
}

fn read_staged(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() && meta.len() > 0 && meta.len() <= MAX_ARCHIVE => {
            let bytes = fs::read(path).map_err(error)?;
            Ok((bytes.len() as u64 == meta.len()).then_some(bytes))
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(error(e)),
        _ => Ok(None),
    }
}

fn staged(path: &Path, update: &Update, trust: &Enrollment) -> Result<Option<(Manifest, u64)>, String> {
    let Some(bytes) = read_staged(path)? else {
        return Ok(None);
    };
    if verify(&bytes, &update.signature, &trust.pubkey).is_err() {
        return Ok(None);
    }
    let manifest = inspect(&bytes, &update.version)?;
    Ok(Some((manifest, bytes.len() as u64)))
}

pub fn status(
    app: &tauri::AppHandle,
    saved_id: Option<&str>,
    request_id: &str,
) -> serde_json::Value {
    let result = app
        .path()
        .app_data_dir()
        .map_err(error)
        .and_then(|fallback| {
            let data = std::env::var_os("COUCH_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(fallback);
            read_transaction(&directory(&data), saved_id)
        });
    match result {
        Ok(transaction) => {
            serde_json::json!({"type":"appimageUpdate","requestId":request_id,"ok":true,"transaction":transaction,"current":current_identity(),"repairCurrent":false,"installationAvailable":running(app) && enrollment(app).is_ok()})
        }
        Err(message) => {
            serde_json::json!({"type":"appimageUpdate","requestId":request_id,"error":message})
        }
    }
}

async fn stop_coordinator(app: &tauri::AppHandle) {
    let host = app.state::<crate::Host>();
    host.shutting_down
        .store(true, std::sync::atomic::Ordering::Relaxed);
    let mut exited = host.child_exited.subscribe();
    if let Some(child) = host.child.lock().expect("sidecar lock poisoned").as_mut() {
        let _ = child.write(b"{\"type\":\"shutdown\"}\n");
    }
    if host.child.lock().expect("sidecar lock poisoned").is_some() {
        let _ = tokio::time::timeout(Duration::from_secs(10), exited.wait_for(|done| *done)).await;
    }
    if let Some(child) = host.child.lock().expect("sidecar lock poisoned").take() {
        let _ = child.kill();
    };
}

pub async fn run(
    app: tauri::AppHandle,
    directory: PathBuf,
    mut requests: tokio::sync::mpsc::Receiver<Request>,
) {
    let recovery = read_transaction(&directory, None).and_then(|mut transaction| {
        if !transaction.is_null()
            && !matches!(
                transaction["phase"].as_str(),
                Some("succeeded" | "failed" | "operator-required" | "trial")
            )
        {
            journal(&directory, &mut transaction, "operator-required", Some("The update stopped during replacement. Retry or reinstall a verified compatible release without removing Couch data.".into()))?;
        }
        Ok(())
    });
    if let Err(message) = recovery {
        log::error!("Cannot recover the desktop update transaction: {message}");
        app.exit(1);
        return;
    }
    let mut selected: Option<(Channel, Update, Candidate)> = None;
    while let Some(request) = requests.recv().await {
        let report = |value: serde_json::Value| {
            let mut value = value;
            value["type"] = "appimageUpdate".into();
            value["requestId"] = request.id.clone().into();
            app.state::<crate::Host>().report_message(value);
        };
        let mut disrupted = false;
        let operation = async {
            if !running(&app) {
                return Err::<serde_json::Value, String>(
                    "Signed desktop updates require an installed Couch app.".into(),
                );
            }
            if let Action::Status { ref request_id } = request.action {
                return Ok(
                    serde_json::json!({"ok":true,"transaction":read_transaction(&directory, request_id.as_deref())?,"current":current_identity(),"repairCurrent":false,"installationAvailable":enrollment(&app).is_ok()}),
                );
            }
            if let Action::Complete { ref error } = request.action {
                let mut transaction = read_transaction(&directory, None)?;
                if transaction["phase"] == "trial" {
                    let current = build();
                    let failure = trial_failure(&transaction, &current, error.as_deref());
                    if let Err(storage) = journal(
                        &directory,
                        &mut transaction,
                        if failure.is_none() {
                            "succeeded"
                        } else {
                            "operator-required"
                        },
                        failure,
                    ) {
                        app.exit(1);
                        return Err(storage);
                    }
                }
                return Ok(serde_json::json!({"ok":true}));
            }
            if let Action::Restart { confirm_interrupt } = request.action {
                if !confirm_interrupt {
                    return Err("Confirm interruption before restarting Couch.".into());
                }
                let nonce = uuid::Uuid::new_v4().to_string();
                let (sender, receiver) = tokio::sync::oneshot::channel();
                *app.state::<crate::Host>()
                    .update_checkpoint
                    .lock()
                    .expect("checkpoint lock poisoned") = Some((nonce.clone(), sender));
                app.state::<crate::Host>().report_message(serde_json::json!({"type":"appimageQuiesce","nonce":nonce,"restart":true,"confirmInterrupt":true,"whenIdle":false}));
                let (closed, result) = tokio::time::timeout(Duration::from_secs(30), receiver)
                    .await
                    .map_err(|_| "The restart checkpoint timed out.")?
                    .map_err(error)?;
                result?;
                if !closed {
                    return Err("The restart checkpoint did not close control admission.".into());
                }
                report(serde_json::json!({"ok":true,"accepted":true}));
                tokio::time::sleep(Duration::from_millis(750)).await;
                stop_coordinator(&app).await;
                app.request_restart();
                return Ok(serde_json::json!({"ok":true}));
            }
            let trust = enrollment(&app)?;
            let path = directory.join("candidate.update");
            match request.action {
                Action::Check { channel } => {
                    selected = None;
                    match check(&app, &trust, channel).await? {
                        Some((update, mut summary)) => {
                            let staged = staged(&path, &update, &trust)?;
                            if let Some((manifest, bytes)) = staged.as_ref() {
                                summary.revision = manifest.revision.clone();
                                summary.bytes = *bytes;
                            }
                            selected = Some((channel, update, summary.clone()));
                            Ok(
                                serde_json::json!({"candidate":{"summary":summary,"staged":staged.is_some()}}),
                            )
                        }
                        None => Ok(serde_json::json!({"candidate":null})),
                    }
                }
                Action::CheckRepair {} => {
                    Err("Reinstall a verified compatible app while retaining Couch data.".into())
                }
                Action::Stage { ref candidate_id } => {
                    let (channel, _, summary) = selected
                        .as_ref()
                        .filter(|(_, _, c)| &c.id == candidate_id)
                        .ok_or("This candidate is no longer current. Use Check now.")?;
                    let (mut update, mut current) = check(&app, &trust, *channel)
                        .await?
                        .filter(|(_, c)| c.id == summary.id)
                        .ok_or("The candidate changed. Use Check now before downloading.")?;
                    if staged(&path, &update, &trust)?.is_none() {
                        update.timeout = Some(Duration::from_secs(30 * 60));
                        let (limit, mut exceeded) = tokio::sync::watch::channel(false);
                        let mut received = 0u64;
                        let mut reported = std::time::Instant::now();
                        let download = update.download(|size, total| {
                            received += size as u64;
                            if received > MAX_ARCHIVE || total.is_some_and(|size| size > MAX_ARCHIVE) { let _ = limit.send(true); }
                            if reported.elapsed() >= Duration::from_millis(250) {
                                report(serde_json::json!({"progress":{"received":received,"total":total.unwrap_or(0)}}));
                                reported = std::time::Instant::now();
                            }
                        }, || {});
                        let bytes = tokio::select! {
                            result = download => result.map_err(error)?,
                            _ = exceeded.changed() => return Err("The download exceeds the supported desktop update size.".into()),
                        };
                        if bytes.is_empty() || bytes.len() as u64 > MAX_ARCHIVE {
                            return Err("The desktop download has an invalid size.".into());
                        }
                        save(&path, &bytes)?;
                        if let Err(message) = inspect(&bytes, &current.version) {
                            let _ = fs::remove_file(&path);
                            return Err(message);
                        }
                    }
                    let (manifest, size) = staged(&path, &update, &trust)?
                        .ok_or("The staged download failed verification. Download it again.")?;
                    current.revision = manifest.revision;
                    current.bytes = size;
                    selected = Some((*channel, update, current.clone()));
                    Ok(serde_json::json!({"staged":true,"summary":current}))
                }
                Action::Install {
                    ref candidate_id,
                    ref request_id,
                    confirm_interrupt,
                    when_idle,
                    repair,
                    repair_runtime,
                } => {
                    if repair || repair_runtime {
                        return Err(
                            "Reinstall a verified compatible app while retaining Couch data."
                                .into(),
                        );
                    }
                    let previous = read_transaction(&directory, Some(request_id))?;
                    if !previous.is_null() {
                        return Ok(serde_json::json!({"ok":true,"transaction":previous}));
                    }
                    let (_, update, summary) = selected
                        .as_ref()
                        .filter(|(_, _, c)| &c.id == candidate_id)
                        .ok_or("Use a current verified download.")?;
                    let bytes = read_staged(&path)?
                        .ok_or("The staged update has an invalid size. Download it again.")?;
                    verify(&bytes, &update.signature, &trust.pubkey).map_err(|_| {
                        "The staged update failed verification. Download it again.".to_string()
                    })?;
                    let manifest = inspect(&bytes, &summary.version)?;
                    if summary.revision != manifest.revision || summary.bytes != bytes.len() as u64
                    {
                        return Err("The staged update changed after selection. Check and download it again.".into());
                    }
                    let mut transaction = serde_json::json!({"updateId":request_id,"requestId":request_id,"candidateId":candidate_id,"version":summary.version,"revision":manifest.revision,"dataFormat":manifest.data_format,"createdAt":now(),"repairRuntime":false,"intent":"install"});
                    journal(&directory, &mut transaction, "accepted", None)?;
                    report(
                        serde_json::json!({"ok":true,"accepted":true,"transaction":transaction}),
                    );
                    let installation = async {
                        journal(&directory, &mut transaction, "quiescing", None)?;
                        let nonce = uuid::Uuid::new_v4().to_string();
                        let (sender, receiver) = tokio::sync::oneshot::channel();
                        *app.state::<crate::Host>().update_checkpoint.lock().expect("checkpoint lock poisoned") = Some((nonce.clone(), sender));
                        app.state::<crate::Host>().report_message(serde_json::json!({"type":"appimageQuiesce","nonce":nonce,"confirmInterrupt":confirm_interrupt,"whenIdle":when_idle}));
                        disrupted = true;
                        let (closed, result) = tokio::time::timeout(Duration::from_secs(30), receiver).await.map_err(|_| "The stopped-writer checkpoint timed out.")?.map_err(error)?;
                        disrupted = closed;
                        if when_idle && !closed { transaction["idleDeferred"] = true.into(); }
                        result?;
                        if !closed { return Err("The data writers did not stop.".into()); }
                        journal(&directory, &mut transaction, "installing", None)?;
                        #[cfg(target_os = "windows")]
                        {
                            // Tauri launches NSIS and exits the process inside install().
                            journal(&directory, &mut transaction, "trial", None)?;
                            stop_coordinator(&app).await;
                        }
                        update.install(&bytes).map_err(error)?;
                        #[cfg(not(target_os = "windows"))]
                        journal(&directory, &mut transaction, "trial", None)?;
                        Ok::<(), String>(())
                    }.await;
                    if let Err(message) = installation {
                        let phase = if disrupted {
                            "operator-required"
                        } else {
                            "failed"
                        };
                        if let Err(storage) = journal(&directory, &mut transaction, phase, Some(format!("{message} Retry or reinstall a verified compatible release without removing Couch data."))) {
                            app.exit(1);
                            return Err(format!("Cannot save the update failure: {storage}"));
                        }
                    }
                    if disrupted {
                        #[cfg(not(target_os = "windows"))]
                        stop_coordinator(&app).await;
                        app.request_restart();
                    }
                    Ok(serde_json::json!({"ok":true,"transaction":transaction}))
                }
                _ => unreachable!(),
            }
        };
        match tokio::time::timeout(Duration::from_secs(31 * 60), operation).await {
            Ok(Ok(value)) => report(value),
            Ok(Err(message)) => report(serde_json::json!({"error":message})),
            Err(_) => {
                let message =
                    "The desktop update timed out. Check its saved transaction before retrying.";
                if matches!(request.action, Action::Install { .. }) {
                    let saved = read_transaction(&directory, None).and_then(|mut transaction| {
                        if transaction.is_null() {
                            return Ok(());
                        }
                        journal(
                            &directory,
                            &mut transaction,
                            if disrupted {
                                "operator-required"
                            } else {
                                "failed"
                            },
                            Some(message.into()),
                        )
                    });
                    if let Err(storage) = saved {
                        log::error!("Cannot save the timed-out desktop update: {storage}");
                        app.exit(1);
                        continue;
                    }
                }
                if disrupted {
                    app.request_restart();
                }
                report(serde_json::json!({"error":message}));
            }
        }
        app.state::<crate::Host>()
            .update_busy
            .store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_linux_trial_keeps_its_directory_and_completes_without_a_data_format_field() {
        #[cfg(target_os = "linux")]
        assert_eq!(directory(Path::new("/tmp/couch")), Path::new("/tmp/couch/updates/appimage"));
        let current = serde_json::json!({"version":"0.2.0","revision":"a","dataFormat":2});
        let mut trial = serde_json::json!({"phase":"trial","version":"0.2.0","revision":"a"});
        assert!(trial_failure(&trial, &current, None).is_none());
        trial["dataFormat"] = 3.into();
        assert!(trial_failure(&trial, &current, None).is_some());
        assert!(trial_failure(&trial, &current, Some("The database check failed.")).is_some());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn appimage_manifest_is_read_from_the_squashfs_without_running_the_candidate() {
        let squashfs = include_bytes!("../tests/fixtures/update/release.squashfs");
        let mut appimage = vec![0; 128];
        appimage[..4].copy_from_slice(b"\x7fELF");
        appimage[4] = 2;
        appimage[5] = 1;
        appimage[8..11].copy_from_slice(b"AI\x02");
        appimage[18..20].copy_from_slice(b"\x3e\0");
        appimage[40..48].copy_from_slice(&64u64.to_le_bytes());
        appimage[58..60].copy_from_slice(&64u16.to_le_bytes());
        appimage[60..62].copy_from_slice(&1u16.to_le_bytes());
        appimage[64 + 24..64 + 32].copy_from_slice(&64u64.to_le_bytes());
        appimage[64 + 32..64 + 40].copy_from_slice(&64u64.to_le_bytes());
        appimage.extend_from_slice(squashfs);
        let manifest: Manifest = serde_json::from_slice(&linux_manifest(&appimage).unwrap()).unwrap();
        assert!(validate(&manifest, "0.2.0", 1).is_ok());
        appimage[18] = 0xb7;
        assert!(linux_manifest(&appimage).is_err());
        appimage[18] = 0x3e;
        appimage[40..48].copy_from_slice(&u64::MAX.to_le_bytes());
        assert!(linux_manifest(&appimage).is_err());
    }

    #[test]
    fn manifest_rejects_wrong_target_stale_version_and_data() {
        let Some((_, expected)) = target() else {
            return;
        };
        let mut manifest = Manifest {
            schema_version: 1,
            version: "0.2.0".into(),
            revision: "a".repeat(40),
            target: expected.into(),
            data_format: 2,
            readable_data_formats: vec![1],
            packaged: true,
        };
        assert!(validate(&manifest, "0.2.0", 1).is_ok());
        manifest.target = "unsupported-target".into();
        assert!(validate(&manifest, "0.2.0", 1).is_err());
        manifest.target = expected.into();
        assert!(validate(&manifest, "0.1.0", 1).is_err());
        assert!(validate(&manifest, "0.2.0", 3).is_err());
    }
    #[test]
    fn staged_bytes_reject_tampering_and_truncation() {
        let key = include_str!("../tests/fixtures/update/public.key");
        let signature = include_str!("../tests/fixtures/update/archive.sig");
        let bytes = include_bytes!("../tests/fixtures/update/archive");
        verify(bytes, signature, key).unwrap();
        assert!(verify(&bytes[..bytes.len() - 1], signature, key).is_err());
        let mut changed = bytes.to_vec();
        changed[0] ^= 1;
        assert!(verify(&changed, signature, key).is_err());
    }
    #[test]
    fn windows_installer_requires_an_x64_pe() {
        let mut pe = vec![0; 128];
        pe[..2].copy_from_slice(b"MZ");
        pe[60..64].copy_from_slice(&(80u32).to_le_bytes());
        pe[80..86].copy_from_slice(b"PE\0\0\x64\x86");
        assert!(pe_x64(&mut pe.as_slice()).unwrap());
        pe[84] = 0x4c;
        assert!(!pe_x64(&mut pe.as_slice()).unwrap());
    }

    #[test]
    fn mac_archive_requires_a_complete_embedded_manifest() {
        let manifest = br#"{"version":"0.2.0"}"#;
        let archive = |machine: &[u8]| {
            let mut archive = tar::Builder::new(flate2::write::GzEncoder::new(
                Vec::new(),
                flate2::Compression::default(),
            ));
            for (name, contents) in [
                ("Couch.app/Contents/MacOS/couch", machine),
                ("Couch.app/Contents/Resources/release.json", &manifest[..]),
            ] {
                let mut header = tar::Header::new_gnu();
                header.set_size(contents.len() as u64);
                header.set_mode(0o755);
                header.set_cksum();
                archive.append_data(&mut header, name, contents).unwrap();
            }
            archive.into_inner().unwrap().finish().unwrap()
        };
        let bytes = archive(&[0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1]);
        assert_eq!(mac_manifest(&bytes).unwrap(), manifest);
        assert!(mac_manifest(&bytes[..bytes.len() - 1]).is_err());
        assert!(mac_manifest(&archive(&[0xcf, 0xfa, 0xed, 0xfe, 0x07, 0, 0, 1])).is_err());
        assert!(windows_manifest(&bytes).is_err());
    }

    #[test]
    fn windows_archive_requires_manifest_and_matching_installer() {
        let mut pe = vec![0; 128];
        pe[..2].copy_from_slice(b"MZ");
        pe[60..64].copy_from_slice(&(80u32).to_le_bytes());
        pe[80..86].copy_from_slice(b"PE\0\0\x64\x86");
        let archive = |installer: &[u8], include_manifest: bool| {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("Couch_0.2.0_x64-setup.exe", options)
                .unwrap();
            std::io::Write::write_all(&mut zip, installer).unwrap();
            if include_manifest {
                zip.start_file("release.json", options).unwrap();
                std::io::Write::write_all(&mut zip, br#"{"version":"0.2.0"}"#).unwrap();
            }
            zip.finish().unwrap().into_inner()
        };
        let good = archive(&pe, true);
        assert!(windows_manifest(&good).is_ok());
        assert!(windows_manifest(&good[..good.len() - 1]).is_err());
        assert!(windows_manifest(&archive(&pe, false)).is_err());
        pe[84] = 0x4c;
        assert!(windows_manifest(&archive(&pe, true)).is_err());
        assert!(mac_manifest(&good).is_err());
    }
}

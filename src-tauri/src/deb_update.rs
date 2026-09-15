use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::appimage_update::{
    build, current_identity, enrollment, error, journal, now, read_transaction, save, verify,
    Candidate, Enrollment, MAX_ARCHIVE,
};

// The private contract mirrors appimage_update::Action without its AppImage-only
// recovery actions. The root broker owns the real install boundary.
#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Action {
    Restart {
        confirm_interrupt: bool,
    },
    Status {
        request_id: Option<String>,
    },
    Complete {
        error: Option<String>,
    },
    Install {
        candidate_id: String,
        request_id: String,
        confirm_interrupt: bool,
        when_idle: bool,
        repair: bool,
        repair_runtime: bool,
    },
    Check {
        channel: Channel,
    },
    Stage {
        candidate_id: String,
    },
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Stable,
    Preview,
}
pub struct Request {
    pub id: String,
    pub action: Action,
}

const ENDPOINT: &str = "https://cdn.crabnebula.app/update/avoid-quest/couch/linux-x86_64-deb/";
const BROKER: &str = "/usr/lib/couch/package-update";
const APPLICATION: &str = "/usr/bin/couch";
const RECEIPT_CEILING: Duration = Duration::from_secs(600);
// A just-published release takes minutes to reach every CDN region; the release
// scripts ride out the same staleness with bounded rechecks.
const CHECK_RETRIES: u32 = 3;
const CHECK_RETRY_WAIT: Duration = Duration::from_secs(20);

pub fn packaged() -> bool {
    build()["packaged"].as_bool() == Some(true)
}

pub fn running(app: &tauri::AppHandle) -> bool {
    #[cfg(target_os = "linux")]
    {
        !crate::appimage_update::running(app) && packaged() && Path::new(BROKER).is_file()
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        false
    }
}

fn inbox(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // The broker resolves this exact location from the account database, never XDG.
    Ok(app
        .path()
        .home_dir()
        .map_err(error)?
        .join(".local/share/couch/updates"))
}

fn update_url(current: &str, channel: Channel) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(&format!("{ENDPOINT}{current}")).map_err(error)?;
    if matches!(channel, Channel::Preview) {
        url.set_query(Some("channel=preview"));
    }
    Ok(url)
}

/// Native debs carry final X.Y.Z versions only, strictly newer than the running
/// version. Debian and SemVer order prerelease suffixes in opposite directions,
/// so a `-preview.N` package would block the later stable upgrade.
fn policy(release: &str, running_version: &str) -> Result<(), String> {
    let release = semver::Version::parse(release).map_err(error)?;
    let running_version = semver::Version::parse(running_version).map_err(error)?;
    if !release.pre.is_empty() || !release.build.is_empty() {
        return Err("Native package updates carry final X.Y.Z versions only.".into());
    }
    if release <= running_version {
        return Err("The hosted package is not newer than the running version.".into());
    }
    Ok(())
}

fn summary(update: &Update) -> Result<Candidate, String> {
    if update.download_url.scheme() != "https" {
        return Err("The hosted package must be served over HTTPS.".into());
    }
    policy(&update.version, &update.current_version)?;
    let identity = serde_json::to_vec(&(&update.version, &update.signature)).map_err(error)?;
    Ok(Candidate {
        id: format!("{:x}", Sha256::digest(identity)),
        release_id: update.version.clone(),
        version: update.version.clone(),
        revision: String::new(),
        notes: update.body.clone().unwrap_or_default(),
        bytes: 0,
        published_at: update
            .date
            .map(|date| date.unix_timestamp() * 1000)
            .unwrap_or(0),
    })
}

fn transient(message: &str) -> bool {
    // The updater reports stale 400/404 feeds as "Could not fetch a valid release
    // JSON from the remote"; treat that as retryable CDN propagation.
    message.contains("Could not fetch a valid release JSON")
}

async fn check(
    app: &tauri::AppHandle,
    trust: &Enrollment,
    channel: Channel,
) -> Result<Option<(Update, Candidate)>, String> {
    let current = app.package_info().version.to_string();
    let mut attempt = 0;
    loop {
        let result = app
            .updater_builder()
            .pubkey(&trust.pubkey)
            .endpoints(vec![update_url(&current, channel)?])
            .map_err(error)?
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(error)?
            .check()
            .await;
        match result {
            Ok(update) => {
                return update
                    .map(|update| summary(&update).map(|candidate| (update, candidate)))
                    .transpose()
            }
            Err(e) if attempt < CHECK_RETRIES && transient(&error(&e)) => {
                attempt += 1;
                tokio::time::sleep(CHECK_RETRY_WAIT).await;
            }
            Err(e) => return Err(error(e)),
        }
    }
}

fn signature_file(update: &Update) -> Result<Vec<u8>, String> {
    // The feed signature is base64 over the minisign signature file the broker
    // consumes with `minisign -V -x`.
    STANDARD.decode(update.signature.trim()).map_err(error)
}

fn retained(inbox: &Path, update: &Update, trust: &Enrollment) -> bool {
    let bytes = fs::read(inbox.join("couch.deb")).unwrap_or_default();
    if bytes.is_empty() || bytes.len() > MAX_ARCHIVE as usize {
        return false;
    }
    let Ok(signature) = signature_file(update) else {
        return false;
    };
    fs::read(inbox.join("couch.deb.sig"))
        .is_ok_and(|saved| saved == signature && verify(&bytes, &update.signature, &trust.pubkey).is_ok())
}

fn package_digest(inbox: &Path) -> Result<String, String> {
    let mut file = fs::File::open(inbox.join("couch.deb")).map_err(error)?;
    if file.metadata().map_err(error)?.len() > MAX_ARCHIVE {
        return Err("The staged package exceeds its size limit.".into());
    }
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let size = file.read(&mut buffer).map_err(error)?;
        if size == 0 {
            break;
        }
        hash.update(&buffer[..size]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Outcome {
    Installed,
    Failed,
}
#[derive(Debug, PartialEq)]
struct Receipt {
    outcome: Option<Outcome>,
    version: Option<String>,
    sha256: Option<String>,
    error: Option<String>,
}

/// The broker receipt is key=value lines under /var/lib/couch-package-update.
fn receipt(bytes: &[u8]) -> Result<Receipt, String> {
    if bytes.len() > 4096 {
        return Err("The package update receipt exceeds its size limit.".into());
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|_| "The package update receipt is not valid UTF-8.".to_string())?;
    let mut receipt = Receipt {
        outcome: None,
        version: None,
        sha256: None,
        error: None,
    };
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else {
            return Err("The package update receipt is not key=value lines.".into());
        };
        match key {
            "outcome" => {
                receipt.outcome = Some(match value {
                    "installed" => Outcome::Installed,
                    "failed" => Outcome::Failed,
                    _ => return Err("The package update receipt outcome is unknown.".into()),
                });
            }
            "version" => {
                let parsed = semver::Version::parse(value)
                    .map_err(|_| "The package update receipt version is invalid.".to_string())?;
                if !parsed.pre.is_empty() || !parsed.build.is_empty() {
                    return Err("The package update receipt version is not a final release.".into());
                }
                receipt.version = Some(value.to_owned());
            }
            "sha256" => {
                if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err("The package update receipt digest is invalid.".into());
                }
                receipt.sha256 = Some(value.to_owned());
            }
            "error" => receipt.error = Some(value.to_owned()),
            _ => return Err("The package update receipt has an unknown key.".into()),
        }
    }
    if receipt.outcome.is_none() {
        return Err("The package update receipt has no outcome.".into());
    }
    Ok(receipt)
}

/// The broker deletes the receipt when it starts and holds a global lock, so a
/// receipt that appears after the start belongs to this run. `systemctl start`
/// returns only after the oneshot exits; poll alongside it so a hung broker
/// still surfaces as a real timeout.
async fn trigger(user: &str, receipt_path: &Path, errors: &Path) -> Result<Receipt, String> {
    // A receipt left by an earlier run must disappear first: the broker deletes
    // it when it starts, and only then can a receipt belong to this run.
    let mut stale = fs::metadata(receipt_path).is_ok();
    let stderr = fs::File::create(errors).map_err(error)?;
    let mut systemctl = tokio::process::Command::new("/usr/bin/systemctl")
        .arg("start")
        .arg(format!("couch-package-update@{user}.service"))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(stderr)
        .kill_on_drop(true)
        .spawn()
        .map_err(error)?;
    let started = std::time::Instant::now();
    loop {
        tokio::time::sleep(Duration::from_secs(1)).await;
        if !stale && fs::metadata(receipt_path).is_ok() {
            return receipt(&fs::read(receipt_path).map_err(error)?);
        }
        if fs::metadata(receipt_path).is_err() {
            stale = false;
        }
        if systemctl.try_wait().map_err(error)?.is_some() {
            // The trap writes the receipt before the broker exits; read once more.
            if !stale && fs::metadata(receipt_path).is_ok() {
                return receipt(&fs::read(receipt_path).map_err(error)?);
            }
            return Err(format!(
                "The package update service failed without a receipt. Check {} and journalctl.",
                errors.display()
            ));
        }
        if started.elapsed() >= RECEIPT_CEILING {
            return Err(
                "The package update timed out after ten minutes. Check journalctl before retrying."
                    .into(),
            );
        }
    }
}

fn account() -> Result<String, String> {
    #[cfg(unix)]
    unsafe {
        let entry = libc::getpwuid(libc::geteuid());
        if entry.is_null() {
            return Err("Cannot resolve the running account for the package update.".into());
        }
        return Ok(std::ffi::CStr::from_ptr((*entry).pw_name)
            .to_string_lossy()
            .into_owned());
    }
    #[cfg(not(unix))]
    Err("Unsupported installation".into())
}

/// The TV runtime account runs under couch-tv.service with Restart=always, so a
/// plain exit makes systemd start the replaced package. A desktop session must
/// spawn the installed launcher itself: after APT replaces the package file,
/// /proc/self/exe points at the deleted old binary, so Tauri's own restart is
/// unusable on a deb install.
async fn supervised() -> bool {
    fs::read_to_string("/proc/self/cgroup")
        .map(|cgroup| {
            cgroup.lines().any(|line| {
                line.splitn(3, ':')
                    .nth(2)
                    .is_some_and(|group| group.ends_with("/couch-tv.service"))
            })
        })
        .unwrap_or(false)
}

async fn relaunch(app: &tauri::AppHandle) {
    if supervised().await {
        app.exit(0);
        return;
    }
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
    }
    if let Err(e) = std::process::Command::new(APPLICATION).spawn() {
        log::error!("Cannot relaunch Couch after the package update: {e}");
    }
    app.exit(0);
}

pub async fn run(
    app: tauri::AppHandle,
    directory: PathBuf,
    mut requests: tokio::sync::mpsc::Receiver<Request>,
) {
    let mut selected: Option<(Channel, Update, Candidate)> = None;
    while let Some(request) = requests.recv().await {
        let report = |value: serde_json::Value| {
            let mut value = value;
            value["type"] = "debUpdate".into();
            value["requestId"] = request.id.clone().into();
            app.state::<crate::Host>().report_message(value);
        };
        let disrupted_request = std::sync::atomic::AtomicBool::new(false);
        let operation = async {
            if !running(&app) {
                return Err::<serde_json::Value, String>(
                    "Signed package updates require the installed native Couch package.".into(),
                );
            }
            if let Action::Status { ref request_id } = request.action {
                return Ok(serde_json::json!({"ok":true,"transaction":read_transaction(&directory, request_id.as_deref())?,"current":current_identity(),"repairCurrent":false,"installationAvailable":true}));
            }
            if let Action::Complete { ref error } = request.action {
                let mut transaction = read_transaction(&directory, None)?;
                if transaction["phase"] == "trial" {
                    let failure = error.clone().or_else(|| {
                        (transaction["version"] != build()["version"]).then(|| {
                            "The running build does not match the requested update. Recover through SSH."
                                .into()
                        })
                    });
                    journal(
                        &directory,
                        &mut transaction,
                        if failure.is_none() {
                            "succeeded"
                        } else {
                            "operator-required"
                        },
                        failure,
                    )?;
                }
                return Ok(serde_json::json!({"ok":true}));
            }
            if let Action::Restart { confirm_interrupt } = request.action {
                if !confirm_interrupt {
                    return Err("Confirm interruption before restarting Couch.".into());
                }
                report(serde_json::json!({"ok":true,"accepted":true}));
                // Keep HTTP alive long enough for the authenticated result.
                tokio::time::sleep(Duration::from_millis(750)).await;
                relaunch(&app).await;
                return Ok(serde_json::json!({"ok":true}));
            }
            let trust = enrollment(&app)?;
            let inbox = inbox(&app)?;
            match request.action {
                Action::Restart { .. } | Action::Status { .. } | Action::Complete { .. } => {
                    unreachable!()
                }
                Action::Check { channel } => {
                    selected = None;
                    match check(&app, &trust, channel).await? {
                        Some((update, mut summary)) => {
                            let staged = retained(&inbox, &update, &trust);
                            if staged {
                                summary.bytes =
                                    fs::metadata(inbox.join("couch.deb")).map_err(error)?.len();
                            }
                            let result =
                                serde_json::json!({"candidate":{"summary":summary,"staged":staged}});
                            selected = Some((channel, update, summary));
                            Ok(result)
                        }
                        None => Ok(serde_json::json!({"candidate":null})),
                    }
                }
                Action::Install {
                    ref candidate_id,
                    ref request_id,
                    confirm_interrupt,
                    when_idle,
                    repair,
                    repair_runtime,
                } => {
                    if repair_runtime {
                        return Err("Debian host maintenance requires the machine administrator. App updates cannot change host packages.".into());
                    }
                    if repair {
                        return Err("The package broker installs only newer Couch releases. Reinstall this version with signed setup to repair it.".into());
                    }
                    let previous = read_transaction(&directory, Some(request_id))?;
                    if !previous.is_null() {
                        return Ok(serde_json::json!({"ok":true,"transaction":previous}));
                    }
                    if when_idle && app.get_webview_window("remote").is_some() {
                        return Err(
                            "Waiting for remote control to close before automatic installation."
                                .into(),
                        );
                    }
                    let (_, update, summary) = selected
                        .as_ref()
                        .filter(|(_, _, c)| &c.id == candidate_id)
                        .ok_or("Use a current verified download.")?;
                    if !retained(&inbox, update, &trust) {
                        return Err("The staged package failed verification. Download it again.".into());
                    }
                    let digest = package_digest(&inbox)?;
                    let mut transaction = serde_json::json!({"updateId":request_id,"requestId":request_id,"candidateId":candidate_id,"version":summary.version,"revision":"","createdAt":now(),"repairRuntime":false,"intent":"install"});
                    journal(&directory, &mut transaction, "accepted", None)?;
                    report(serde_json::json!({"ok":true,"accepted":true,"transaction":transaction}));
                    let mut disrupted = false;
                    let installation = async {
                        let nonce = uuid::Uuid::new_v4().to_string();
                        let (sender, receiver) = tokio::sync::oneshot::channel();
                        *app.state::<crate::Host>()
                            .update_checkpoint
                            .lock()
                            .expect("checkpoint lock poisoned") = Some((nonce.clone(), sender));
                        app.state::<crate::Host>().report_message(serde_json::json!({"type":"appimageQuiesce","nonce":nonce,"confirmInterrupt":confirm_interrupt,"whenIdle":when_idle}));
                        disrupted = true;
                        disrupted_request.store(true, std::sync::atomic::Ordering::Relaxed);
                        let (closed, result) =
                            tokio::time::timeout(Duration::from_secs(30), receiver)
                                .await
                                .map_err(|_| "The stopped-writer checkpoint timed out.")?
                                .map_err(error)?;
                        disrupted = closed;
                        disrupted_request.store(closed, std::sync::atomic::Ordering::Relaxed);
                        if when_idle && !closed {
                            transaction["idleDeferred"] = true.into();
                        }
                        result?;
                        if !closed {
                            return Err("The data writers did not stop.".into());
                        }
                        journal(&directory, &mut transaction, "installing", None)?;
                        let user = account()?;
                        let receipt_path =
                            PathBuf::from(format!("/var/lib/couch-package-update/{user}/receipt"));
                        let errors = directory.join("package-update.err");
                        let outcome = trigger(&user, &receipt_path, &errors).await?;
                        if outcome.outcome != Some(Outcome::Installed) {
                            let message = outcome
                                .error
                                .unwrap_or_else(|| "The package update failed. Check journalctl.".into());
                            journal(&directory, &mut transaction, "failed", Some(message.clone()))?;
                            return Err(message);
                        }
                        if outcome.sha256.as_deref() != Some(digest.as_str()) {
                            return Err("The installed package digest does not match the staged package.".into());
                        }
                        if outcome.version.as_deref() != Some(summary.version.as_str()) {
                            return Err("The installed version does not match the requested update.".into());
                        }
                        journal(&directory, &mut transaction, "trial", None)?;
                        Ok::<(), String>(())
                    }
                    .await;
                    if let Err(message) = installation {
                        if let Err(storage) = journal(
                            &directory,
                            &mut transaction,
                            if disrupted {
                                "operator-required"
                            } else {
                                "failed"
                            },
                            Some(message),
                        ) {
                            if disrupted {
                                app.exit(1);
                            }
                            return Err(storage);
                        }
                    }
                    if disrupted {
                        relaunch(&app).await;
                    }
                    Ok(serde_json::json!({"ok":true,"transaction":transaction}))
                }
                Action::Stage { ref candidate_id } => {
                    let (channel, current) = selected
                        .as_ref()
                        .filter(|(_, _, c)| &c.id == candidate_id)
                        .map(|(channel, _, c)| (*channel, c.clone()))
                        .ok_or("This candidate is no longer current. Use Check now.")?;
                    let (update, mut current) = check(&app, &trust, channel)
                        .await?
                        .filter(|(_, c)| c.id == current.id)
                        .ok_or("The candidate changed. Use Check now before downloading.")?;
                    if !retained(&inbox, &update, &trust) {
                        let (limit, mut exceeded) = tokio::sync::watch::channel(false);
                        let mut received = 0u64;
                        let mut reported = std::time::Instant::now();
                        let download = update.download(|size, total| {
                            received += size as u64;
                            if received > MAX_ARCHIVE
                                || total.is_some_and(|size| size > MAX_ARCHIVE)
                            {
                                let _ = limit.send(true);
                            }
                            if reported.elapsed() >= Duration::from_millis(250) {
                                report(serde_json::json!(
                                    {"progress":{"received":received,"total":total.unwrap_or(0)}}
                                ));
                                reported = std::time::Instant::now();
                            }
                        }, || {});
                        let bytes = tokio::select! {
                            result = download => result.map_err(error)?,
                            _ = exceeded.changed() => return Err("The download exceeds the supported package size.".into()),
                        };
                        if bytes.is_empty() || bytes.len() as u64 > MAX_ARCHIVE {
                            return Err("The package download has an invalid size.".into());
                        }
                        // download() returns only after Tauri signature verification succeeds.
                        save(&inbox.join("couch.deb"), &bytes)?;
                        save(&inbox.join("couch.deb.sig"), &signature_file(&update)?)?;
                    }
                    current.bytes = fs::metadata(inbox.join("couch.deb")).map_err(error)?.len();
                    let result = serde_json::json!({"staged":true,"summary":current});
                    selected = Some((channel, update, current));
                    Ok(result)
                }
            }
        };
        match tokio::time::timeout(Duration::from_secs(35 * 60), operation).await {
            Ok(Ok(value)) => report(value),
            Ok(Err(message)) => report(serde_json::json!({"error":message})),
            Err(_) => {
                let message =
                    "The package update timed out. Check journalctl before retrying.";
                if matches!(request.action, Action::Install { .. }) {
                    if let Ok(mut transaction) = read_transaction(&directory, None) {
                        let _ = journal(
                            &directory,
                            &mut transaction,
                            if disrupted_request.load(std::sync::atomic::Ordering::Relaxed) {
                                "operator-required"
                            } else {
                                "failed"
                            },
                            Some(message.into()),
                        );
                    }
                }
                report(serde_json::json!({"error":message}));
            }
        }
        if !disrupted_request.load(std::sync::atomic::Ordering::Relaxed) {
            app.state::<crate::Host>()
                .deb_busy
                .store(false, std::sync::atomic::Ordering::SeqCst);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn final_versions_must_be_strictly_newer() {
        assert!(policy("0.2.0", "0.1.2").is_ok());
        for (release, running) in [
            ("0.1.2", "0.1.2"),
            ("0.1.1", "0.1.2"),
            ("0.1.2-preview.1", "0.1.2"),
            ("0.1.3-preview.1", "0.1.2"),
            ("0.1.2+build.5", "0.1.2"),
        ] {
            assert!(policy(release, running).is_err(), "{release}");
        }
    }

    #[test]
    fn receipts_parse_bounded_key_value_lines() {
        let mut installed = b"outcome=installed\nversion=0.2.0\nsha256=".to_vec();
        installed.extend_from_slice(&[b'a'; 64]);
        installed.push(b'\n');
        let installed_receipt = receipt(&installed).unwrap();
        assert_eq!(installed_receipt.outcome, Some(Outcome::Installed));
        assert_eq!(installed_receipt.version.as_deref(), Some("0.2.0"));
        assert_eq!(installed_receipt.sha256.unwrap().len(), 64);
        let failed = receipt(b"outcome=failed\nerror=apt failed: broken deps\n").unwrap();
        assert_eq!(failed.outcome, Some(Outcome::Failed));
        assert_eq!(failed.error.as_deref(), Some("apt failed: broken deps"));
        let mut oversized = b"outcome=installed\n".to_vec();
        oversized.extend_from_slice(&[b'x'; 4097]);
        for bad in [
            &b""[..],
            b"outcome=cancelled\n",
            b"outcome",
            b"outcome=installed\nsurprise=1\n",
            b"outcome=installed\nsha256=short\n",
            b"outcome=installed\nversion=0.1.2-preview.1\n",
            &oversized,
            b"\xff\xfe\n",
        ] {
            assert!(receipt(bad).is_err(), "{}", String::from_utf8_lossy(bad));
        }
    }

    #[test]
    fn private_contract_rejects_urls_paths_and_supplied_trust() {
        for action in [
            r#"{"type":"check","channel":"nightly"}"#,
            r#"{"type":"check","channel":"stable","pubkey":"evil"}"#,
            r#"{"type":"stage","candidateId":"a","path":"/tmp/x"}"#,
            r#"{"type":"checkRepair"}"#,
        ] {
            assert!(serde_json::from_str::<Action>(action).is_err(), "{action}");
        }
    }
}

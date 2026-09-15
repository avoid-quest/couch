//! Native Debian package integration. Tauri still owns discovery and signed downloads.
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};

const STATE: &str = "/var/lib/couch-updater";
const MANIFEST: &str = "./usr/lib/Couch/release.json";

pub fn running() -> bool {
    cfg!(target_os = "linux")
        && tauri::utils::platform::bundle_type() == Some(tauri::utils::config::BundleType::Deb)
}

fn error(value: impl std::fmt::Display) -> String {
    value.to_string()
}

#[cfg(unix)]
fn account() -> Result<(String, PathBuf), String> {
    let mut entry = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut result = std::ptr::null_mut();
    let mut buffer = vec![0u8; 65536];
    let status = unsafe {
        libc::getpwuid_r(
            libc::geteuid(),
            entry.as_mut_ptr(),
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() {
        return Err("The Couch account is not in the system account database.".into());
    }
    let entry = unsafe { entry.assume_init() };
    let name = unsafe { std::ffi::CStr::from_ptr(entry.pw_name) }
        .to_str()
        .map_err(error)?
        .to_owned();
    let home = unsafe { std::ffi::CStr::from_ptr(entry.pw_dir) }
        .to_str()
        .map_err(error)?
        .to_owned();
    if name.is_empty()
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        || !home.starts_with('/')
        || entry.pw_uid == 0
    {
        return Err(
            "Couch needs an ordinary system account with an absolute home directory.".into(),
        );
    }
    Ok((name, PathBuf::from(home)))
}

#[cfg(not(unix))]
fn account() -> Result<(String, PathBuf), String> {
    Err("Native Debian updates require Linux.".into())
}

pub fn directory() -> Result<PathBuf, String> {
    Ok(account()?
        .1
        .join(".local/state/quest.avoid.couch/native-update"))
}

pub fn tv() -> bool {
    running() && account().is_ok_and(|(name, _)| name == "couch-tv")
}

fn installed() -> Result<String, String> {
    let output = std::process::Command::new("/usr/bin/dpkg-query")
        .args(["-W", "-f=${db:Status-Status}\n${Version}\n", "couch"])
        .output()
        .map_err(error)?;
    let text = String::from_utf8(output.stdout).map_err(error)?;
    let mut lines = text.lines();
    if !output.status.success() || lines.next() != Some("installed") {
        return Err("The Couch Debian package is not fully configured. An OS administrator must finish package recovery before Couch can start.".into());
    }
    lines
        .next()
        .map(str::to_owned)
        .ok_or("The installed Couch version is missing.".into())
}

fn root_json(path: &Path) -> Result<Option<serde_json::Value>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(error(e)),
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if !metadata.is_file()
            || metadata.uid() != 0
            || metadata.mode() & 0o022 != 0
            || metadata.len() > 65536
        {
            return Err(
                "The native package operation receipt is not root-owned regular data.".into(),
            );
        }
    }
    Ok(Some(
        serde_json::from_slice(&fs::read(path).map_err(error)?).map_err(error)?,
    ))
}

/// Hold a shared package lock from before any data/UI initialization until quiesce.
pub fn startup() -> Result<Option<fs::File>, String> {
    if !running() {
        return Ok(None);
    }
    #[cfg(unix)]
    {
        use std::os::{
            fd::AsRawFd,
            unix::{
                fs::{MetadataExt, OpenOptionsExt},
                process::CommandExt,
            },
        };
        let file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(format!("{STATE}/lock"))
            .map_err(|_| {
                "Native update setup is incomplete. Reinstall the Couch Debian package.".to_owned()
            })?;
        let metadata = file.metadata().map_err(error)?;
        if !metadata.is_file() || metadata.uid() != 0 || metadata.mode() & 0o022 != 0 {
            return Err("The native package lock must be owned and writable only by root.".into());
        }
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_SH) } != 0 {
            return Err(error(std::io::Error::last_os_error()));
        }
        if root_json(Path::new(&format!("{STATE}/active.json")))?
            .is_some_and(|active| active["phase"] == "installing")
        {
            return Err("A native package installation was interrupted. An OS administrator must inspect the retained package transaction before starting Couch.".into());
        }
        let version = installed()?;
        let current: serde_json::Value =
            serde_json::from_str(option_env!("COUCH_BUILD_INFO").unwrap_or("{}")).map_err(error)?;
        let disk: serde_json::Value =
            serde_json::from_slice(&fs::read("/usr/lib/Couch/release.json").map_err(error)?)
                .map_err(error)?;
        if current["version"] != version
            || current["revision"] != disk["revision"]
            || disk["version"] != version
        {
            // The loader may have opened the previous executable before waiting on APT.
            let loaded = fs::metadata("/proc/self/exe").map_err(error)?;
            let replacement = fs::metadata("/usr/bin/couch").map_err(error)?;
            if loaded.dev() != replacement.dev() || loaded.ino() != replacement.ino() {
                return Err(error(
                    std::process::Command::new("/usr/bin/couch")
                        .args(std::env::args_os().skip(1))
                        .exec(),
                ));
            }
            return Err("The native executable and installed package identity differ. Reinstall the matching Couch package before starting it.".into());
        }
        Ok(Some(file))
    }
    #[cfg(not(unix))]
    {
        Err("Native Debian updates require Linux.".into())
    }
}

/// Only called after the whole archive has passed the enrolled signature check.
pub async fn manifest(path: &Path, version: &str) -> Result<Vec<u8>, String> {
    let source = path.to_owned();
    let expected = version.to_owned();
    tokio::task::spawn_blocking(move || {
        use std::process::{Command, Stdio};
        let version = semver::Version::parse(&expected).map_err(error)?;
        if !version.pre.is_empty() || !version.build.is_empty() {
            return Err(
                "Native Debian releases require a final version, including in Preview.".into(),
            );
        }
        let control = Command::new("/usr/bin/timeout")
            .args([
                "--kill-after=5",
                "30",
                "/usr/bin/dpkg-deb",
                "--show",
                "--showformat=${Package}\\n${Version}\\n${Architecture}\\n",
            ])
            .arg(&source)
            .output()
            .map_err(error)?;
        if !control.status.success()
            || control.stdout != format!("couch\n{expected}\namd64\n").as_bytes()
        {
            return Err("The signed download is not the expected Couch Debian package.".into());
        }
        let mut unpack = Command::new("/usr/bin/timeout")
            .args(["--kill-after=5", "30", "/usr/bin/dpkg-deb", "--fsys-tarfile"])
            .arg(&source)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(error)?;
        let mut read = match Command::new("/usr/bin/timeout")
            .args(["--kill-after=5", "30", "/usr/bin/tar", "-xOf", "-", MANIFEST])
            .stdin(unpack.stdout.take().unwrap())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                let _ = unpack.kill();
                let _ = unpack.wait();
                return Err(error(e));
            }
        };
        let mut bytes = Vec::new();
        let result = read
            .stdout
            .take()
            .unwrap()
            .take(65537)
            .read_to_end(&mut bytes)
            .map_err(error);
        if result.is_err() || bytes.len() > 65536 {
            let _ = read.kill();
            let _ = unpack.kill();
        }
        let read_status = read.wait().map_err(error)?;
        let unpack_status = unpack.wait().map_err(error)?;
        result?;
        if bytes.is_empty()
            || bytes.len() > 65536
            || !read_status.success()
            || !unpack_status.success()
        {
            return Err(
                "The signed Debian package is missing valid bounded release metadata.".into(),
            );
        }
        Ok(bytes)
    })
    .await
    .map_err(error)?
}

pub async fn preflight(application: &Path, data: &Path, candidate: &Path) -> Result<(), String> {
    let sizes =
        crate::appimage_update::sizes("/usr/bin/du", &["-sb", "--"], &[candidate, data]).await?;
    let free = crate::appimage_update::sizes(
        "/usr/bin/df",
        &["-B1", "--output=avail", "--"],
        &[application, Path::new("/usr"), Path::new("/var")],
    )
    .await?;
    let installed = tokio::time::timeout(
        Duration::from_secs(30),
        tokio::process::Command::new("/usr/bin/dpkg-deb")
            .args(["--field"])
            .arg(candidate)
            .arg("Installed-Size")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Reading native package storage requirements timed out.")?
    .map_err(error)?;
    let unpacked = String::from_utf8(installed.stdout)
        .map_err(error)?
        .trim()
        .parse::<u64>()
        .map_err(error)?
        .checked_mul(1024)
        .ok_or("Package size exceeds supported storage.")?;
    let reserve = 256 * 1024 * 1024;
    let required = sizes.iter().try_fold(
        unpacked
            .checked_add(reserve)
            .ok_or("Package size exceeds supported storage.")?,
        |sum: u64, bytes| {
            sum.checked_add(*bytes)
                .ok_or("Backup size exceeds supported storage.")
        },
    )?;
    if !installed.status.success()
        || sizes.len() != 2
        || free.len() != 3
        || free[0] < required
        || free[1] < required
        || free[2] < required
    {
        return Err("Not enough storage for the native package, data backup and Debian installation. Free space before updating.".into());
    }
    Ok(())
}

pub async fn backup(
    application: &Path,
    data: &Path,
    request_id: &str,
    pubkey: &str,
    build: &serde_json::Value,
) -> Result<(), String> {
    let destination = application.join("backups").join(request_id);
    crate::prepare_data_dir(destination.parent().unwrap()).map_err(error)?;
    fs::create_dir(&destination).map_err(error)?;
    crate::prepare_data_dir(&destination).map_err(error)?;
    // Previous successful native download is useful recovery material. A first
    // manually installed package is not assumed to remain in Downloads or APT cache.
    let package = application.join("candidate.deb");
    let signature = application.join("candidate.sig");
    let mut retained = false;
    let previous = fs::metadata(&package).is_ok_and(|m| m.is_file() && m.len() <= 2 * 1024 * 1024 * 1024) && fs::metadata(&signature).is_ok_and(|m| m.is_file() && m.len() <= 65536);
    if let (true, Ok(bytes), Ok(signature)) = (previous, if previous { fs::read(&package) } else { Ok(Vec::new()) }, if previous { fs::read_to_string(&signature) } else { Ok(String::new()) }) {
        if crate::appimage_update::verify(&bytes, &signature, pubkey).is_ok() {
            if let Some(version) = build["version"].as_str() {
                if let Ok(bytes) = manifest(&package, version).await {
                    let previous: serde_json::Value =
                        serde_json::from_slice(&bytes).map_err(error)?;
                    if previous["revision"] == build["revision"] {
                        crate::appimage_update::copy(&package, &destination.join("Couch.deb"))
                            .await?;
                        crate::appimage_update::save(
                            &destination.join("Couch.deb.sig"),
                            signature.as_bytes(),
                        )?;
                        retained = true;
                    }
                }
            }
        }
    }
    crate::appimage_update::copy(data, &destination.join("data")).await?;
    crate::appimage_update::save(
        &destination.join("build.json"),
        &serde_json::to_vec(build).map_err(error)?,
    )?;
    crate::appimage_update::save(
        &destination.join("README.txt"),
        if retained {
            b"A signed previously running Debian package is retained here. OS administrator recovery must stop Couch, verify this package and its data compatibility, then reinstall with apt. Preserve current data; never restore an older database automatically.\n"
        } else {
            b"Current application data is backed up here. The initial downloaded Debian package was not retained automatically. Recovery needs an administrator-held compatible package or a forward release; preserve current data.\n"
        },
    )?;
    let status = tokio::process::Command::new("/usr/bin/sync")
        .arg("-f")
        .arg(&destination)
        .status()
        .await
        .map_err(error)?;
    if !status.success() {
        return Err("Could not flush the native recovery backup.".into());
    }
    Ok(())
}

#[derive(Deserialize)]
struct Receipt {
    #[serde(rename = "requestId")]
    request_id: String,
    digest: String,
    version: Option<String>,
    phase: String,
    error: Option<String>,
}

/// Reconcile a caller that died after handing ownership to systemd. Startup has
/// already waited for the global lock and checked the installed package identity.
pub fn reconcile(
    transaction: &serde_json::Value,
    current: &serde_json::Value,
) -> Result<bool, String> {
    let (name, _) = account()?;
    let Some(value) = root_json(Path::new(&format!("{STATE}/results/{name}.json")))? else {
        return Ok(false);
    };
    completed(
        &serde_json::from_value(value).map_err(error)?,
        transaction,
        current,
    )
}

fn completed(
    receipt: &Receipt,
    transaction: &serde_json::Value,
    current: &serde_json::Value,
) -> Result<bool, String> {
    if (transaction["phase"] != "installing" && transaction["nativePending"] != true)
        || transaction["requestId"] != receipt.request_id
        || transaction["digest"] != receipt.digest
    {
        return Ok(false);
    }
    match receipt.phase.as_str() {
        "succeeded" if receipt.version.as_deref() == transaction["version"].as_str() && current["version"] == transaction["version"] && current["revision"] == transaction["revision"] => Ok(true),
        "failed" => Err(receipt.error.clone().unwrap_or_else(|| "The native package transaction failed. An OS administrator must inspect its retained log.".into())),
        _ => Ok(false),
    }
}

pub async fn install(
    bytes: &[u8],
    signature: &str,
    request_id: &str,
    version: &str,
) -> Result<(), String> {
    let inbox = directory()?;
    crate::prepare_data_dir(&inbox).map_err(error)?;
    let digest = format!("{:x}", Sha256::digest(bytes));
    crate::appimage_update::save(&inbox.join("candidate.deb"), bytes)?;
    crate::appimage_update::save(&inbox.join("candidate.sig"), signature.as_bytes())?;
    crate::appimage_update::save(
        &inbox.join("request.json"),
        &serde_json::to_vec(&serde_json::json!({"requestId":request_id,"digest":digest}))
            .map_err(error)?,
    )?;
    let (name, _) = account()?;
    let unit = format!("couch-package-update@{name}.service");
    let output = tokio::time::timeout(
        Duration::from_secs(10),
        tokio::process::Command::new("/usr/bin/systemctl")
            .args(["--no-ask-password", "start", "--no-block", &unit])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| {
        "Starting the native package service timed out. Inspect its transaction before retrying."
    })?
    .map_err(error)?;
    if !output.status.success() {
        return Err("The OS refused the Couch package update service. Reinstall its package integration or inspect the system journal.".into());
    }
    let receipt = PathBuf::from(format!("{STATE}/results/{name}.json"));
    let started = std::time::Instant::now();
    loop {
        if started.elapsed() > Duration::from_secs(30 * 60) {
            return Err("The native package installation timed out. Inspect the retained package transaction before retrying.".into());
        }
        if let Some(value) = root_json(&receipt)? {
            let result: Receipt = serde_json::from_value(value).map_err(error)?;
            if result.request_id == request_id && result.digest == digest {
                match result.phase.as_str() {
                    "succeeded" if result.version.as_deref() == Some(version) => return Ok(()),
                    "succeeded" => return Err("The OS installed a different package identity. Inspect the native update receipt.".into()),
                    "failed" => return Err(result.error.unwrap_or_else(|| "The Debian package operation failed. Inspect the retained package transaction.".into())),
                    _ => {}
                }
            }
        }
        if started.elapsed() > Duration::from_secs(3) {
            let output = tokio::time::timeout(Duration::from_secs(5), tokio::process::Command::new("/usr/bin/systemctl")
                .args(["show", "--property=ActiveState", "--value", &unit]).kill_on_drop(true).output())
                .await.map_err(|_| "Cannot inspect the native package service; inspect its transaction before retrying.")?.map_err(error)?;
            if !output.status.success()
                || matches!(
                    String::from_utf8_lossy(&output.stdout).trim(),
                    "failed" | "inactive"
                )
            {
                // Read the receipt once more after observing terminal service state.
                if let Some(value) = root_json(&receipt)? {
                    let result: Receipt = serde_json::from_value(value).map_err(error)?;
                    if result.request_id == request_id
                        && result.digest == digest
                        && result.phase == "succeeded"
                        && result.version.as_deref() == Some(version)
                    {
                        return Ok(());
                    }
                    if result.request_id == request_id
                        && result.digest == digest
                        && result.phase == "failed"
                    {
                        return Err(result
                            .error
                            .unwrap_or_else(|| "The native package service failed.".into()));
                    }
                }
                return Err("The Couch package service stopped without confirming this request. Inspect its system journal and retry after resolving the error.".into());
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

pub fn release_guard(app: &tauri::AppHandle) {
    use tauri::Manager;
    app.state::<crate::Host>()
        .package_guard
        .lock()
        .expect("package lock poisoned")
        .take();
}

/// Only the backend spawn inherits the bridge descriptor. Its own read lock is
/// established before it closes this bridge or touches application data.
pub fn inherit_guard(app: &tauri::AppHandle, inherit: bool) -> Result<Option<i32>, String> {
    use tauri::Manager;
    #[cfg(unix)] {
        use std::os::fd::AsRawFd;
        let host = app.state::<crate::Host>();
        let guard = host.package_guard.lock().expect("package lock poisoned");
        if let Some(file) = guard.as_ref() {
            let fd = file.as_raw_fd();
            if unsafe { libc::fcntl(fd, libc::F_SETFD, if inherit { 0 } else { libc::FD_CLOEXEC }) } < 0 { return Err(error(std::io::Error::last_os_error())); }
            return Ok(Some(fd));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::completed;

    fn pending_transaction() -> serde_json::Value {
        serde_json::json!({
            "phase": "installing", "nativePending": true,
            "requestId": "a".repeat(32), "digest": "b".repeat(64), "version": "0.2.0",
            "revision": "c".repeat(40)
        })
    }

    fn receipt(phase: &str) -> super::Receipt {
        super::Receipt {
            request_id: "a".repeat(32),
            digest: "b".repeat(64),
            version: Some("0.2.0".into()),
            phase: phase.into(),
            error: None,
        }
    }

    #[test]
    fn native_pending_times_out_unless_its_own_terminal_receipt_arrives() {
        let transaction = pending_transaction();
        let current = serde_json::json!({"version": "0.2.0", "revision": "c".repeat(40)});
        // The broker confirmed this exact request: startup clears the pending flag.
        assert!(completed(&receipt("succeeded"), &transaction, &current).unwrap());
        // A terminal failure is an operator message, never a silent completion.
        assert!(completed(&receipt("failed"), &transaction, &current).is_err());
        // A broker still running keeps the install pending until the timeout,
        // and a receipt from any other request never completes this one.
        assert!(!completed(&receipt("installing"), &transaction, &current).unwrap());
        let other = super::Receipt { request_id: "d".repeat(32), ..receipt("succeeded") };
        assert!(!completed(&other, &transaction, &current).unwrap());
        // Without the pending flag or an installing phase the transaction is not
        // reconciled at all.
        let mut idle = transaction.clone();
        idle["nativePending"] = false.into();
        assert!(!completed(&receipt("installing"), &idle, &current).unwrap());
    }
}

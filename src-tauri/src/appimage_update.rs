use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_updater::{Update, UpdaterExt};

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
    CheckRepair {},
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
#[derive(Deserialize)]
struct Enrollment {
    pubkey: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    id: String,
    release_id: String,
    version: String,
    revision: String,
    notes: String,
    bytes: u64,
    published_at: i64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Requirements {
    schema_version: u64,
    version: String,
    revision: String,
    target: String,
    data_format: u64,
    readable_data_formats: Vec<u64>,
    packaged: bool,
    host: HostRequirements,
}
#[derive(Clone, Deserialize, Serialize)]
struct HostRequirements {
    os: String,
    version: String,
    architecture: String,
    session: String,
    packages: Vec<String>,
}
const MAX_ARCHIVE: u64 = 2 * 1024 * 1024 * 1024;
const ENDPOINT: &str = "https://cdn.crabnebula.app/update/avoid-quest/couch/linux-x86_64-appimage/";
fn error(value: impl std::fmt::Display) -> String {
    value.to_string()
}
fn now() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp() * 1000
}

pub fn running(app: &tauri::AppHandle) -> bool {
    #[cfg(target_os = "linux")]
    {
        app.env().appimage.is_some()
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        false
    }
}
fn enrollment(app: &tauri::AppHandle) -> Result<Enrollment, String> {
    let trust: Enrollment = serde_json::from_value(
        app.config()
            .plugins
            .0
            .get("updater")
            .cloned()
            .unwrap_or_default(),
    )
    .map_err(error)?;
    let decoded =
        String::from_utf8(STANDARD.decode(trust.pubkey.trim()).map_err(error)?).map_err(error)?;
    PublicKey::decode(&decoded).map_err(|_| "This build has no enrolled updater key.")?;
    Ok(trust)
}
fn verify(bytes: &[u8], signature: &str, pubkey: &str) -> Result<(), String> {
    let decode = |value: &str| {
        String::from_utf8(STANDARD.decode(value.trim()).map_err(error)?).map_err(error)
    };
    PublicKey::decode(&decode(pubkey)?)
        .map_err(error)?
        .verify(
            bytes,
            &Signature::decode(&decode(signature)?).map_err(error)?,
            true,
        )
        .map_err(|_| {
            "Release signature verification failed. Ask the publisher to repair the feed.".into()
        })
}
fn update_url(current: &str, channel: Channel) -> Result<reqwest::Url, String> {
    semver::Version::parse(current).map_err(error)?;
    let mut url = reqwest::Url::parse(&format!("{ENDPOINT}{current}")).map_err(error)?;
    if matches!(channel, Channel::Preview) {
        url.set_query(Some("channel=preview"));
    }
    Ok(url)
}
fn candidate(update: &Update) -> Result<Candidate, String> {
    let version = semver::Version::parse(&update.version).map_err(error)?;
    if !version.build.is_empty() || update.download_url.scheme() != "https" {
        return Err(
            "The hosted release must use HTTPS and a version without build metadata.".into(),
        );
    }
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
async fn check(
    app: &tauri::AppHandle,
    trust: &Enrollment,
    channel: Channel,
) -> Result<Option<(Update, Candidate)>, String> {
    let update = app
        .updater_builder()
        .pubkey(&trust.pubkey)
        .endpoints(vec![update_url(
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
        .map(|update| candidate(&update).map(|summary| (update, summary)))
        .transpose()
}
fn retained(path: &Path, update: &Update, trust: &Enrollment) -> bool {
    fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() > 0 && m.len() <= MAX_ARCHIVE)
        && fs::read(path)
            .is_ok_and(|bytes| verify(&bytes, &update.signature, &trust.pubkey).is_ok())
}
fn validate_requirements(
    requirements: &Requirements,
    version: &str,
    current_data_format: u64,
) -> Result<(), String> {
    if requirements.schema_version != 1
        || requirements.version != version
        || requirements.revision.len() != 40
        || !requirements.revision.bytes().all(|b| b.is_ascii_hexdigit())
        || requirements.target != "x86_64-unknown-linux-gnu"
        || !requirements.packaged
        || requirements.data_format == 0
        || !requirements
            .readable_data_formats
            .contains(&current_data_format)
        || requirements.host.os != "debian"
        || requirements.host.version != "13"
        || requirements.host.architecture != "amd64"
        || requirements.host.session != "x11"
        || requirements.host.packages.is_empty()
        || requirements.host.packages.iter().any(|p| {
            !p.as_bytes()
                .first()
                .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
                || !p
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"+.-".contains(&b))
        })
    {
        return Err("The signed app cannot read this installation's data or does not support its host. Obtain a compatible forward release.".into());
    }
    Ok(())
}
async fn inspect(path: &Path, version: &str, directory: &Path) -> Result<Requirements, String> {
    let inspection = directory.join(format!("inspect-{}", uuid::Uuid::new_v4()));
    crate::prepare_data_dir(&inspection).map_err(error)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(error)?;
    }
    let result = async {
        let mut extract = std::process::Command::new(path);
        extract
            .current_dir(&inspection)
            .args(["--appimage-extract", "usr/lib/Couch/release.json"]);
        command(
            extract,
            30,
            "Cannot extract requirements from the verified AppImage.",
        )
        .await?;
        let manifest = inspection.join("squashfs-root/usr/lib/Couch/release.json");
        let bytes = fs::read(&manifest).map_err(error)?;
        if bytes.len() > 64 * 1024 {
            return Err("The signed requirements exceed their size limit.".into());
        }
        let requirements: Requirements = serde_json::from_slice(&bytes).map_err(error)?;
        validate_requirements(
            &requirements,
            version,
            build()["dataFormat"]
                .as_u64()
                .ok_or("Missing current data format")?,
        )?;
        Ok(requirements)
    }
    .await;
    let _ = fs::remove_dir_all(&inspection);
    result
}
async fn host_ready(requirements: &Requirements) -> Result<(), String> {
    let os = fs::read_to_string("/etc/os-release").map_err(error)?;
    let values: std::collections::HashMap<_, _> = os
        .lines()
        .filter_map(|line| line.split_once('='))
        .map(|(k, v)| (k, v.trim_matches('"')))
        .collect();
    if values.get("ID") != Some(&requirements.host.os.as_str())
        || values.get("VERSION_ID") != Some(&requirements.host.version.as_str())
        || !cfg!(all(target_os = "linux", target_arch = "x86_64"))
        || std::env::var("XDG_SESSION_TYPE").is_ok_and(|session| session != "x11")
    {
        return Err("Updates require the supported Debian 13 amd64 X11 host.".into());
    }
    let mut packages = tokio::process::Command::new("/usr/bin/dpkg-query");
    let output = tokio::time::timeout(
        Duration::from_secs(10),
        packages
            .args(["-W", "-f=${db:Status-Status}\n"])
            .args(&requirements.host.packages)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Host package check timed out.")?
    .map_err(error)?;
    let states = String::from_utf8(output.stdout).map_err(error)?;
    if !output.status.success()
        || states.lines().count() != requirements.host.packages.len()
        || states.lines().any(|state| state != "installed")
    {
        return Err("Required Debian host packages are missing or unconfigured. Ask the machine administrator to rerun signed setup before updating.".into());
    }
    fs::OpenOptions::new().read(true).write(true).open("/dev/fuse").map_err(|_| "The runtime account cannot access /dev/fuse. Repair Debian host permissions before updating.")?;
    Ok(())
}
fn save(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let directory = path.parent().unwrap();
    crate::prepare_data_dir(directory).map_err(error)?;
    let temporary = path.with_extension("partial");
    let result = (|| {
        let mut file = fs::File::create(&temporary).map_err(error)?;
        file.write_all(bytes).map_err(error)?;
        file.sync_all().map_err(error)?;
        fs::rename(&temporary, path).map_err(error)?;
        fs::File::open(directory)
            .and_then(|file| file.sync_all())
            .map_err(error)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
const TV_APPLICATION: &str = "/var/lib/couch/application";
fn application(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "linux")]
    {
        let image = app
            .env()
            .appimage
            .clone()
            .map(PathBuf::from)
            .ok_or("Run the installed AppImage.")?;
        let home = app.path().home_dir().map_err(error)?;
        let desktop = home.join(".local/lib/couch/Couch.AppImage");
        let tv = Path::new(TV_APPLICATION).join("Couch.AppImage");
        if image != desktop && image != tv {
            return Err("Run Couch from its installed desktop or TV path before updating.".into());
        }
        let directory = image.parent().unwrap();
        if fs::symlink_metadata(directory)
            .map_err(error)?
            .file_type()
            .is_symlink()
            || fs::symlink_metadata(&image)
                .map_err(error)?
                .file_type()
                .is_symlink()
        {
            return Err(
                "The installed app path is a symbolic link. Inspect it before updating.".into(),
            );
        }
        return Ok(directory.to_owned());
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        Err("Installed updates require the supported Debian AppImage.".into())
    }
}
async fn restart_ready(application: &Path) -> Result<(), String> {
    if application == Path::new(TV_APPLICATION) {
        supervised_restart().await?;
    }
    Ok(())
}
async fn relaunch(app: &tauri::AppHandle, application: &Path) {
    if application == Path::new(TV_APPLICATION) {
        app.exit(0);
    } else {
        // Tauri's restart event cannot be prevented. Drain our writer before requesting it.
        let host = app.state::<crate::Host>();
        host.shutting_down
            .store(true, std::sync::atomic::Ordering::Relaxed);
        let mut exited = host.child_exited.subscribe();
        if let Some(child) = host.child.lock().expect("sidecar lock poisoned").as_mut() {
            let _ = child.write(b"{\"type\":\"shutdown\"}\n");
        }
        if host.child.lock().expect("sidecar lock poisoned").is_some() {
            let _ =
                tokio::time::timeout(Duration::from_secs(10), exited.wait_for(|done| *done)).await;
        }
        if let Some(child) = host.child.lock().expect("sidecar lock poisoned").take() {
            let _ = child.kill();
        }
        app.request_restart();
    }
}
fn installation_lock(application: &Path) -> Result<fs::File, String> {
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        let path = if application == Path::new(TV_APPLICATION) {
            PathBuf::from("/var/lib/couch-install-locks/tv.lock")
        } else {
            PathBuf::from(format!(
                "/var/lib/couch-install-locks/desktop-{}.lock",
                unsafe { libc::geteuid() }
            ))
        };
        let file = fs::File::open(path)
            .map_err(|_| "Run signed setup before updating this installation.")?;
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err("Another installation or recovery is running.".into());
        }
        Ok(file)
    }
    #[cfg(not(unix))]
    {
        let _ = application;
        Err("Unsupported installation".into())
    }
}
fn build() -> serde_json::Value {
    serde_json::from_str(option_env!("COUCH_BUILD_INFO").unwrap_or("{}")).unwrap_or_default()
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
            read_transaction(&data.join("updates/appimage"), saved_id)
        });
    match result {
        Ok(transaction) => {
            serde_json::json!({"type":"appimageUpdate","requestId":request_id,"ok":true,"transaction":transaction,"current":current_identity(),"repairCurrent":false,"installationAvailable":running(app) && enrollment(app).is_ok() && application(app).is_ok()})
        }
        Err(message) => {
            serde_json::json!({"type":"appimageUpdate","requestId":request_id,"error":message})
        }
    }
}
fn current_identity() -> serde_json::Value {
    let build = build();
    serde_json::json!({"candidateId":format!("{:x}", Sha256::digest(format!("{}:{}", build["version"], build["revision"]))),"version":build["version"],"revision":build["revision"]})
}
fn read_transaction(
    directory: &Path,
    request_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    if request_id.is_some_and(|id| id.len() != 32 || !id.bytes().all(|c| c.is_ascii_hexdigit())) {
        return Err("Invalid saved update request identity.".into());
    }
    let path = request_id.map_or_else(
        || directory.join("transaction.json"),
        |id| directory.join("requests").join(format!("{id}.json")),
    );
    match fs::read(path) {
        Ok(bytes) if bytes.len() <= 64 * 1024 => serde_json::from_slice(&bytes).map_err(error),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Value::Null),
        _ => Err("Cannot read the durable update request. Check storage through SSH.".into()),
    }
}
fn journal(
    directory: &Path,
    transaction: &mut serde_json::Value,
    phase: &str,
    message: Option<String>,
) -> Result<(), String> {
    transaction["phase"] = phase.into();
    transaction["error"] = message.into();
    transaction["updatedAt"] = now().into();
    let bytes = serde_json::to_vec(transaction).map_err(error)?;
    save(
        &directory.join("requests").join(format!(
            "{}.json",
            transaction["requestId"]
                .as_str()
                .ok_or("Missing request identity")?
        )),
        &bytes,
    )?;
    save(&directory.join("transaction.json"), &bytes)
}
async fn command(
    mut command: std::process::Command,
    seconds: u64,
    failure: &str,
) -> Result<(), String> {
    let mut child = command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(error)?;
    let deadline = std::time::Instant::now() + Duration::from_secs(seconds);
    loop {
        if let Some(status) = child.try_wait().map_err(error)? {
            return if status.success() {
                Ok(())
            } else {
                Err(failure.into())
            };
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{failure} The operation timed out."));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}
async fn copy(source: &Path, destination: &Path) -> Result<(), String> {
    let mut cp = std::process::Command::new("/usr/bin/cp");
    cp.arg("-a").arg("--").arg(source).arg(destination);
    command(
        cp,
        120,
        "The recovery backup failed. Check storage and permissions through SSH.",
    )
    .await
}
async fn sizes(program: &str, arguments: &[&str], paths: &[&Path]) -> Result<Vec<u64>, String> {
    let mut command = tokio::process::Command::new(program);
    command
        .args(arguments)
        .env("LC_ALL", "C")
        .args(paths)
        .kill_on_drop(true)
        .stderr(std::process::Stdio::null());
    let output = tokio::time::timeout(Duration::from_secs(30), command.output())
        .await
        .map_err(|_| "The storage preflight timed out.")?
        .map_err(error)?;
    if !output.status.success() {
        return Err("Cannot inspect storage before installation.".into());
    }
    String::from_utf8(output.stdout)
        .map_err(error)?
        .lines()
        .filter(|line| !line.trim_start().starts_with("Avail"))
        .map(|line| {
            line.split_whitespace()
                .next()
                .ok_or("Missing storage size")?
                .parse::<u64>()
                .map_err(error)
        })
        .collect()
}
fn archive_hash(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(error)?;
    if file.metadata().map_err(error)?.len() > 2 * 1024 * 1024 * 1024 {
        return Err("The retained application exceeds its size limit.".into());
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
fn known_good(application: &Path, trust: &Enrollment) -> Result<serde_json::Value, String> {
    let metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(application.join("build.json")).map_err(error)?)
            .map_err(error)?;
    if metadata["version"] != build()["version"]
        || metadata["revision"] != build()["revision"]
        || metadata["archiveSha256"] != archive_hash(&application.join("Couch.AppImage"))?
    {
        return Err("The retained application differs from its installed receipt. Repair the exact current release before updating.".into());
    }
    verify(
        &fs::read(application.join("Couch.AppImage")).map_err(error)?,
        &fs::read_to_string(application.join("Couch.AppImage.sig")).map_err(error)?,
        &trust.pubkey,
    )?;
    Ok(metadata)
}
async fn preflight(application: &Path, directory: &Path, bytes: u64) -> Result<(), String> {
    let data = directory
        .parent()
        .and_then(Path::parent)
        .ok_or("Invalid data directory")?;
    let actual_data = fs::canonicalize(data).map_err(error)?;
    let actual_application = fs::canonicalize(application).map_err(error)?;
    if actual_data.starts_with(&actual_application) || actual_application.starts_with(&actual_data)
    {
        return Err(
            "Application and data directories must not overlap for a consistent backup.".into(),
        );
    }
    let sizes = sizes(
        "/usr/bin/du",
        &["-sb", "--"],
        &[&application.join("Couch.AppImage"), data],
    )
    .await?;
    let free = sizes_available(application, data).await?;
    storage_ready(bytes, &sizes, &free)
}
fn storage_ready(bytes: u64, sizes: &[u64], free: &[u64]) -> Result<(), String> {
    let required = sizes
        .iter()
        .copied()
        .try_fold(bytes + 256 * 1024 * 1024, |sum, value| {
            sum.checked_add(value)
                .ok_or("Backup size exceeds supported storage")
        })?;
    if sizes.len() != 2 || free.len() != 2 || free[0] < required || free[1] < 256 * 1024 * 1024 {
        return Err("Not enough free storage for the application, consistent data backup and replacement reserve. Free space through SSH before retrying.".into());
    }
    Ok(())
}
async fn sizes_available(application: &Path, data: &Path) -> Result<Vec<u64>, String> {
    sizes(
        "/usr/bin/df",
        &["-B1", "--output=avail", "--"],
        &[application, data],
    )
    .await
}

async fn backup(
    application: &Path,
    trust: &Enrollment,
    directory: &Path,
    request_id: &str,
) -> Result<(), String> {
    let destination = application.join("backups").join(request_id);
    fs::create_dir_all(destination.parent().unwrap()).map_err(error)?;
    fs::create_dir(&destination).map_err(error)?;
    crate::prepare_data_dir(&destination).map_err(error)?;
    let archive = destination.join("Couch.AppImage");
    let metadata = known_good(application, trust)?;
    copy(&application.join("Couch.AppImage"), &archive).await?;
    if metadata["archiveSha256"] != archive_hash(&archive)? {
        return Err("The retained application changed during backup.".into());
    }
    copy(
        &application.join("Couch.AppImage.sig"),
        &destination.join("Couch.AppImage.sig"),
    )
    .await?;
    copy(
        directory
            .parent()
            .and_then(Path::parent)
            .ok_or("Invalid data directory")?,
        &destination.join("data"),
    )
    .await?;
    save(
        &destination.join("build.json"),
        &serde_json::to_vec(&build()).map_err(error)?,
    )?;
    let archive = archive_hash(&destination.join("Couch.AppImage"))?;
    save(
        &destination.join("SHA256SUMS"),
        format!("{archive}  Couch.AppImage\n").as_bytes(),
    )?;
    // cp has completed; flush the filesystem before replacement can begin.
    let mut sync = std::process::Command::new("/usr/bin/sync");
    sync.arg("-f").arg(&destination);
    command(sync, 120, "Could not flush the recovery backup.").await?;
    Ok(())
}

fn verify_supervisor(properties: &str, cgroup: &str, pid: u32) -> Result<(), String> {
    let values: std::collections::HashMap<_, _> = properties
        .lines()
        .filter_map(|line| line.split_once('='))
        .collect();
    let owner = pid.to_string();
    let group = values.get("ControlGroup").copied().unwrap_or("");
    if values.get("MainPID") != Some(&owner.as_str())
        || group.is_empty()
        || !cgroup
            .lines()
            .any(|line| line.splitn(3, ':').nth(2) == Some(group))
        || values.get("ActiveState") != Some(&"active")
        || values.get("Restart") != Some(&"always")
        || values.get("KillMode") != Some(&"control-group")
        || values
            .get("RestartPreventExitStatus")
            .is_none_or(|value| !value.is_empty())
    {
        return Err("Couch must be the active systemd service owner with its supported restart policy. Inspect couch-tv.service through SSH.".into());
    }
    Ok(())
}
async fn supervised_restart() -> Result<(), String> {
    let output = tokio::time::timeout(Duration::from_secs(5), tokio::process::Command::new("/usr/bin/systemctl")
        .args(["--user", "show", "couch-tv.service", "--property=MainPID,ControlGroup,ActiveState,Restart,KillMode,RestartPreventExitStatus"])
        .kill_on_drop(true).output()).await.map_err(|_| "The systemd service inspection timed out.")?.map_err(error)?;
    if !output.status.success() {
        return Err(
            "The installed systemd service is unavailable. Inspect Couch through SSH.".into(),
        );
    }
    verify_supervisor(
        &String::from_utf8(output.stdout).map_err(error)?,
        &fs::read_to_string("/proc/self/cgroup").map_err(error)?,
        std::process::id(),
    )
}

pub async fn run(
    app: tauri::AppHandle,
    directory: PathBuf,
    mut requests: tokio::sync::mpsc::Receiver<Request>,
) {
    if let Ok(mut transaction) = read_transaction(&directory, None) {
        if !transaction.is_null()
            && !matches!(
                transaction["phase"].as_str(),
                Some("succeeded" | "failed" | "operator-required" | "restored" | "trial")
            )
        {
            let _ = journal(&directory, &mut transaction, "operator-required", Some("The update was interrupted. Inspect the retained application and data through SSH.".into()));
        }
    }
    let mut selected: Option<(Channel, Update, Candidate)> = None;
    while let Some(request) = requests.recv().await {
        let report = |value: serde_json::Value| {
            let mut value = value;
            value["type"] = "appimageUpdate".into();
            value["requestId"] = request.id.clone().into();
            app.state::<crate::Host>().report_message(value);
        };
        let disrupted_request = std::sync::atomic::AtomicBool::new(false);
        let operation = async {
            if !running(&app) {
                return Err::<serde_json::Value, String>(
                    "Signed AppImage updates require the running AppImage installation.".into(),
                );
            }
            if let Action::Status { ref request_id } = request.action {
                return Ok(
                    serde_json::json!({"ok":true,"transaction":read_transaction(&directory, request_id.as_deref())?,"current":current_identity(),"repairCurrent":false,"installationAvailable":enrollment(&app).is_ok() && application(&app).is_ok()}),
                );
            }
            if let Action::Complete { ref error } = request.action {
                let mut transaction = read_transaction(&directory, None)?;
                if transaction["phase"] == "trial" {
                    let current = build();
                    let failure = error.clone().or_else(|| (transaction["version"] != current["version"] || transaction["revision"] != current["revision"]).then(|| "The running build does not match the requested update. Recover through SSH.".into()));
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
                let application = application(&app)?;
                restart_ready(&application).await?;
                let nonce = uuid::Uuid::new_v4().to_string();
                let (sender, receiver) = tokio::sync::oneshot::channel();
                *app.state::<crate::Host>()
                    .update_checkpoint
                    .lock()
                    .expect("checkpoint lock poisoned") = Some((nonce.clone(), sender));
                disrupted_request.store(true, std::sync::atomic::Ordering::Relaxed);
                app.state::<crate::Host>().report_message(serde_json::json!({"type":"appimageQuiesce","nonce":nonce,"restart":true,"confirmInterrupt":true,"whenIdle":false}));
                let (closed, result) = tokio::time::timeout(Duration::from_secs(30), receiver)
                    .await
                    .map_err(|_| "The restart checkpoint timed out. Inspect Couch through SSH.")?
                    .map_err(error)?;
                disrupted_request.store(closed, std::sync::atomic::Ordering::Relaxed);
                result?;
                if !closed {
                    return Err("The restart checkpoint did not close control admission.".into());
                }
                report(serde_json::json!({"ok":true,"accepted":true}));
                // Keep HTTP alive long enough for the authenticated result. The
                // ordinary host exit drains the coordinator; systemd replaces both.
                tokio::time::sleep(Duration::from_millis(750)).await;
                relaunch(&app, &application).await;
                return Ok(serde_json::json!({"ok":true}));
            }
            let trust = enrollment(&app)?;
            let path = directory.join("candidate.AppImage");
            match request.action {
                Action::Restart { .. } | Action::Status { .. } | Action::Complete { .. } => {
                    unreachable!()
                }
                Action::CheckRepair {} => Err(
                    "Use retained local recovery when an older hosted download is unavailable."
                        .into(),
                ),
                Action::Check { channel } => {
                    selected = None;
                    match check(&app, &trust, channel).await? {
                        Some((update, mut summary)) => {
                            let staged = retained(&path, &update, &trust);
                            if staged {
                                let requirements =
                                    inspect(&path, &summary.version, &directory).await?;
                                summary.revision = requirements.revision;
                                summary.bytes = fs::metadata(&path).map_err(error)?.len();
                            }
                            let result = serde_json::json!({"candidate":{"summary":summary,"staged":staged}});
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
                        return Err("Debian host maintenance requires the machine administrator. Rerun the verified installer; app updates cannot change host packages.".into());
                    }
                    let previous = read_transaction(&directory, Some(request_id))?;
                    if !previous.is_null() {
                        return Ok(serde_json::json!({"ok":true,"transaction":previous}));
                    }
                    if repair {
                        return Err("Recover the retained verified app with couch-recover. Hosted downloads may expire.".into());
                    }
                    if when_idle && app.get_webview_window("remote").is_some() {
                        return Err(
                            "Waiting for remote control to close before automatic installation."
                                .into(),
                        );
                    }
                    let application = application(&app)?;
                    let _lock = installation_lock(&application)?;
                    restart_ready(&application).await?;
                    let (_, update, summary) = selected
                        .as_ref()
                        .filter(|(_, _, c)| &c.id == candidate_id)
                        .ok_or("Use a current verified download.")?;
                    if !retained(&path, update, &trust) {
                        return Err(
                            "The saved download failed verification. Download it again.".into()
                        );
                    }
                    let requirements = inspect(&path, &summary.version, &directory).await?;
                    host_ready(&requirements).await?;
                    let mut transaction = serde_json::json!({"updateId":request_id,"requestId":request_id,"candidateId":candidate_id,"version":summary.version,"revision":requirements.revision,"createdAt":now(),"repairRuntime":false,"intent":"install"});
                    journal(&directory, &mut transaction, "accepted", None)?;
                    report(
                        serde_json::json!({"ok":true,"accepted":true,"transaction":transaction}),
                    );
                    let mut disrupted = false;
                    let installation = async {
                        let bytes = fs::read(&path).map_err(error)?;
                        if bytes.is_empty() || bytes.len() as u64 > MAX_ARCHIVE { return Err("The saved AppImage size is invalid.".into()); }
                        verify(&bytes, &update.signature, &trust.pubkey)?;
                        known_good(&application, &trust)?;
                        preflight(&application, &directory, bytes.len() as u64).await?;
                        journal(&directory, &mut transaction, "quiescing", None)?;
                        let nonce = uuid::Uuid::new_v4().to_string();
                        let (sender, receiver) = tokio::sync::oneshot::channel();
                        *app.state::<crate::Host>().update_checkpoint.lock().expect("checkpoint lock poisoned") = Some((nonce.clone(), sender));
                        app.state::<crate::Host>().report_message(serde_json::json!({"type":"appimageQuiesce","nonce":nonce,"confirmInterrupt":confirm_interrupt,"whenIdle":when_idle}));
                        disrupted = true;
                        disrupted_request.store(true, std::sync::atomic::Ordering::Relaxed);
                        let (closed, result) = tokio::time::timeout(Duration::from_secs(30), receiver).await.map_err(|_| "The stopped-writer checkpoint timed out.")?.map_err(error)?;
                        disrupted = closed;
                        disrupted_request.store(closed, std::sync::atomic::Ordering::Relaxed);
                        if when_idle && !closed { transaction["idleDeferred"] = true.into(); }
                        result?;
                        if !closed { return Err("The data writers did not stop.".into()); }
                        backup(&application, &trust, &directory, request_id).await?;
                        journal(&directory, &mut transaction, "installing", None)?;
                        update.install(&bytes).map_err(error)?;
                        save(&application.join("build.json"), &serde_json::to_vec(&serde_json::json!({"version":summary.version,"revision":requirements.revision,"dataFormat":requirements.data_format,"readableDataFormats":requirements.readable_data_formats,"archiveSha256":format!("{:x}", Sha256::digest(&bytes))})).map_err(error)?)?;
                        save(&application.join("Couch.AppImage.sig"), update.signature.as_bytes())?;
                        journal(&directory, &mut transaction, "trial", None)?;
                        Ok::<(), String>(())
                    }.await;
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
                        relaunch(&app, &application).await;
                    }
                    Ok(serde_json::json!({"ok":true,"transaction":transaction}))
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
                    if !retained(&path, &update, &trust) {
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
                            _ = exceeded.changed() => return Err("The download exceeds the supported AppImage size.".into()),
                        };
                        if bytes.is_empty() || bytes.len() as u64 > MAX_ARCHIVE {
                            return Err("The AppImage download has an invalid size.".into());
                        }
                        // download() returns only after Tauri signature verification succeeds.
                        save(&path, &bytes)?;
                    }
                    let requirements = inspect(&path, &current.version, &directory).await?;
                    host_ready(&requirements).await?;
                    current.revision = requirements.revision;
                    current.bytes = fs::metadata(&path).map_err(error)?.len();
                    let result = serde_json::json!({"staged":true,"summary":current});
                    selected = Some((*channel, update, current));
                    Ok(result)
                }
            }
        };
        match tokio::time::timeout(Duration::from_secs(31 * 60), operation).await {
            Ok(Ok(value)) => report(value),
            Ok(Err(message)) => report(serde_json::json!({"error":message})),
            Err(_) => {
                let message = "The AppImage update timed out. Inspect the durable request through SSH before retrying.";
                let disrupted = disrupted_request.load(std::sync::atomic::Ordering::Relaxed);
                if matches!(request.action, Action::Install { .. }) {
                    if let Ok(mut transaction) = read_transaction(&directory, None) {
                        let _ = journal(
                            &directory,
                            &mut transaction,
                            if disrupted {
                                "operator-required"
                            } else {
                                "failed"
                            },
                            Some(message.into()),
                        );
                    }
                }
                if disrupted {
                    app.exit(1);
                }
                report(serde_json::json!({"error":message}));
            }
        }
        if !disrupted_request.load(std::sync::atomic::Ordering::Relaxed) {
            app.state::<crate::Host>()
                .update_busy
                .store(false, std::sync::atomic::Ordering::SeqCst);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hosted_channels_keep_tauri_ordering_and_skipped_release_support() {
        let version = |v| semver::Version::parse(v).unwrap();
        assert!(version("0.2.0-preview.1") > version("0.1.0-preview.1"));
        assert!(version("0.2.0") > version("0.2.0-preview.3"));
        assert!(version("0.2.0-preview.3") > version("0.1.9"));
        assert_eq!(version("0.2.0"), version("0.2.0"));
        assert!(version("0.5.0") > version("0.1.0"));
        assert_eq!(
            update_url("0.2.0", Channel::Stable).unwrap().as_str(),
            format!("{ENDPOINT}0.2.0")
        );
        assert_eq!(
            update_url("0.2.0", Channel::Preview).unwrap().query(),
            Some("channel=preview")
        );
    }
    #[test]
    fn signed_requirements_reject_incompatible_data_and_host_before_interruption() {
        let requirements = Requirements {
            schema_version: 1,
            version: "0.3.0".into(),
            revision: "a".repeat(40),
            target: "x86_64-unknown-linux-gnu".into(),
            data_format: 2,
            readable_data_formats: vec![1, 2],
            packaged: true,
            host: HostRequirements {
                os: "debian".into(),
                version: "13".into(),
                architecture: "amd64".into(),
                session: "x11".into(),
                packages: vec!["fuse3".into()],
            },
        };
        assert!(validate_requirements(&requirements, "0.3.0", 1).is_ok());
        assert!(validate_requirements(&requirements, "0.3.0", 2).is_ok());
        assert!(validate_requirements(&requirements, "0.3.0", 3).is_err());
        assert!(validate_requirements(&requirements, "0.2.0", 1).is_err());
        let mut wrong = requirements.clone();
        wrong.host.version = "12".into();
        assert!(validate_requirements(&wrong, "0.3.0", 1).is_err());
        wrong = requirements.clone();
        wrong.host.packages = vec!["--help".into()];
        assert!(validate_requirements(&wrong, "0.3.0", 1).is_err());
        wrong = requirements;
        wrong.revision = "unknown".into();
        assert!(validate_requirements(&wrong, "0.3.0", 1).is_err());
    }
    #[test]
    fn restart_requires_current_supervised_owner_and_clean_exit_policy() {
        let valid = "MainPID=42\nControlGroup=/user.slice/couch-tv.service\nActiveState=active\nRestart=always\nKillMode=control-group\nRestartPreventExitStatus=";
        let group = "0::/user.slice/couch-tv.service\n";
        assert!(verify_supervisor(valid, group, 42).is_ok());
        for invalid in [
            valid.replace("MainPID=42", "MainPID=41"),
            valid.replace("Restart=always", "Restart=on-failure"),
            valid.replace("KillMode=control-group", "KillMode=process"),
            valid.replace("ActiveState=active", "ActiveState=failed"),
            valid.replace("RestartPreventExitStatus=", "RestartPreventExitStatus=0"),
        ] {
            assert!(verify_supervisor(&invalid, group, 42).is_err());
        }
        assert!(verify_supervisor(valid, "0::/unrelated.service", 42).is_err());
        // NRestarts does not expose systemd's current rate-limit counter.
        assert!(verify_supervisor(&format!("{valid}\nNRestarts=999"), group, 42).is_ok());
    }
    const KEY: &str = include_str!("../tests/fixtures/update/public.key");
    const SIGNATURE: &str = include_str!("../tests/fixtures/update/archive.sig");
    const ARCHIVE: &[u8] = include_bytes!("../tests/fixtures/update/archive");
    #[test]
    fn official_signer_bytes_verify_and_tampering_is_rejected() {
        verify(ARCHIVE, SIGNATURE, KEY).unwrap();
        assert!(verify(b"interrupted", SIGNATURE, KEY).is_err());
        let mut changed = ARCHIVE.to_vec();
        changed[0] ^= 1;
        assert!(verify(&changed, SIGNATURE, KEY).is_err());
        assert!(verify(ARCHIVE, "invalid", KEY).is_err());
        assert!(verify(ARCHIVE, SIGNATURE, "invalid").is_err());
    }
    #[test]
    fn saved_bytes_are_durable_and_partial_files_are_never_read_as_ready() {
        let directory = std::env::temp_dir().join(format!("couch-update-{}", uuid::Uuid::new_v4()));
        let path = directory.join("candidate.AppImage");
        save(&path, ARCHIVE).unwrap();
        verify(&fs::read(&path).unwrap(), SIGNATURE, KEY).unwrap();
        fs::write(path.with_extension("partial"), b"partial next download").unwrap();
        verify(&fs::read(&path).unwrap(), SIGNATURE, KEY).unwrap();
        fs::write(&path, b"corrupted after restart").unwrap();
        assert!(verify(&fs::read(&path).unwrap(), SIGNATURE, KEY).is_err());
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn durable_requests_survive_replacement_and_keep_older_phone_receipts() {
        let directory =
            std::env::temp_dir().join(format!("couch-journal-{}", uuid::Uuid::new_v4()));
        let first = "a".repeat(32);
        let mut transaction =
            serde_json::json!({"requestId":first,"version":"1","revision":"a".repeat(40)});
        journal(&directory, &mut transaction, "accepted", None).unwrap();
        journal(&directory, &mut transaction, "succeeded", None).unwrap();
        transaction["requestId"] = "b".repeat(32).into();
        journal(&directory, &mut transaction, "trial", None).unwrap();
        assert_eq!(
            read_transaction(&directory, Some(&first)).unwrap()["phase"],
            "succeeded"
        );
        assert_eq!(
            read_transaction(&directory, None).unwrap()["phase"],
            "trial"
        );
        assert!(read_transaction(&directory, Some("../escape")).is_err());
        fs::write(directory.join("transaction.json"), b"interrupted").unwrap();
        assert!(read_transaction(&directory, None).is_err());
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn storage_failure_never_records_a_successful_transaction() {
        let path = std::env::temp_dir().join(format!("couch-full-{}", uuid::Uuid::new_v4()));
        fs::write(&path, b"not a directory").unwrap();
        let mut transaction = serde_json::json!({"requestId":"a".repeat(32)});
        assert!(journal(&path, &mut transaction, "accepted", None).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"not a directory");
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn storage_preflight_reserves_backup_and_replacement_before_interruption() {
        let reserve = 256 * 1024 * 1024;
        assert!(storage_ready(10, &[20, 30], &[reserve + 60, reserve]).is_ok());
        assert!(storage_ready(10, &[20, 30], &[reserve + 59, reserve]).is_err());
        assert!(storage_ready(10, &[20, 30], &[u64::MAX, reserve - 1]).is_err());
        assert!(storage_ready(10, &[u64::MAX, 30], &[u64::MAX, u64::MAX]).is_err());
        assert!(storage_ready(10, &[], &[u64::MAX, u64::MAX]).is_err());
    }
    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn debian_storage_commands_parse_sizes_and_child_timeout_terminates() {
        let free = sizes_available(Path::new("/tmp"), Path::new("/tmp"))
            .await
            .unwrap();
        assert_eq!(free.len(), 2);
        assert!(free.iter().all(|value| *value > 0));
        let mut sleep = std::process::Command::new("/usr/bin/sleep");
        sleep.arg("10");
        let start = std::time::Instant::now();
        assert!(command(sleep, 0, "deadline")
            .await
            .unwrap_err()
            .contains("timed out"));
        assert!(start.elapsed() < Duration::from_secs(2));
    }
    #[test]
    fn private_contract_rejects_urls_paths_and_supplied_trust() {
        for action in [
            r#"{"type":"check","channel":"nightly"}"#,
            r#"{"type":"checkRepair","version":"old"}"#,
            r#"{"type":"stage","candidateId":"a","path":"/tmp/x"}"#,
            r#"{"type":"check","channel":"stable","pubkey":"evil"}"#,
        ] {
            assert!(serde_json::from_str::<Action>(action).is_err(), "{action}");
        }
    }
}

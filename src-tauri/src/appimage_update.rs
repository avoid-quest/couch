use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
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
    Check { channel: Channel },
    CheckRepair {},
    Stage { candidate_id: String },
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
#[serde(deny_unknown_fields)]
struct Enrollment {
    endpoint: String,
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
    expires_at: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Metadata {
    version: String,
    release_id: String,
    revision: String,
    bytes: u64,
    expires_at: i64,
}
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
fn enrollment() -> Result<Enrollment, String> {
    let path = Path::new("/etc/couch/appimage-update.json");
    let info = fs::symlink_metadata(path)
        .map_err(|_| "Enroll the AppImage feed and public key through the Ubuntu installer.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if !info.is_file() || info.uid() != 0 || info.mode() & 0o022 != 0 {
            return Err("AppImage trust must be a root-owned file writable only by root.".into());
        }
    }
    let trust: Enrollment =
        serde_json::from_slice(&fs::read(path).map_err(error)?).map_err(error)?;
    let url = reqwest::Url::parse(&trust.endpoint).map_err(error)?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().ends_with('/')
    {
        return Err(
            "The enrolled AppImage endpoint must be an HTTP(S) base URL ending in /.".into(),
        );
    }
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
async fn metadata_bytes(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let mut response = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(error)?
        .get(url)
        .send()
        .await
        .map_err(error)?
        .error_for_status()
        .map_err(error)?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(error)? {
        if bytes.len() + chunk.len() > limit {
            return Err("The update metadata exceeds its size limit.".into());
        }
        bytes.extend(chunk);
    }
    Ok(bytes)
}
fn release_id(version: &str) -> Result<&str, String> {
    let parsed = semver::Version::parse(version).map_err(error)?;
    let id = version
        .split_once("+build.")
        .map(|(_, id)| id)
        .ok_or("The release is missing its build identity.")?;
    let parts: Vec<_> = id.split('.').collect();
    if !parsed.pre.is_empty()
        || parts.len() != 2
        || parts
            .iter()
            .any(|p| p.starts_with('0') || p.parse::<u64>().is_err())
    {
        return Err("The release has an invalid build identity.".into());
    }
    Ok(id)
}
fn candidate(
    update: &Update,
    repair: bool,
    running_revision: Option<&str>,
) -> Result<Candidate, String> {
    let metadata: Metadata = serde_json::from_value(update.raw_json.clone()).map_err(error)?;
    let published_at = update
        .date
        .ok_or("The release publication date is missing.")?
        .unix_timestamp()
        * 1000;
    validate_metadata(
        &metadata,
        published_at,
        &update.version,
        &update.current_version,
        repair,
        running_revision,
        now(),
    )?;
    let identity = serde_json::to_vec(&(&metadata.version, &metadata.revision, &update.signature))
        .map_err(error)?;
    Ok(Candidate {
        id: format!("{:x}", Sha256::digest(identity)),
        release_id: metadata.release_id,
        version: metadata.version,
        revision: metadata.revision,
        notes: update.body.clone().unwrap_or_default(),
        bytes: metadata.bytes,
        published_at,
        expires_at: metadata.expires_at,
    })
}
fn validate_metadata(
    metadata: &Metadata,
    published_at: i64,
    version: &str,
    current: &str,
    repair: bool,
    running_revision: Option<&str>,
    at: i64,
) -> Result<(), String> {
    if metadata.version != version
        || release_id(&metadata.version)? != metadata.release_id
        || metadata.revision.len() != 40
        || !metadata.revision.bytes().all(|b| b.is_ascii_hexdigit())
        || metadata.bytes == 0
        || metadata.bytes > 2 * 1024 * 1024 * 1024
        || published_at > at + 60_000
        || metadata.expires_at <= at
        || metadata.expires_at <= published_at
        || metadata.expires_at - published_at > 7 * 24 * 60 * 60 * 1000
        || repair && (version != current || Some(metadata.revision.as_str()) != running_revision)
    {
        return Err("The signed release identity or validity period is invalid. Use Check now after the publisher refreshes it.".into());
    }
    Ok(())
}
async fn check(
    app: &tauri::AppHandle,
    trust: &Enrollment,
    channel: Option<Channel>,
) -> Result<Option<(Update, Candidate)>, String> {
    let current = app.package_info().version.to_string();
    let path = match channel {
        Some(Channel::Stable) => "stable.json".into(),
        Some(Channel::Preview) => "preview.json".into(),
        None => format!("releases/{}/release.json", release_id(&current)?),
    };
    let url = reqwest::Url::parse(&trust.endpoint)
        .map_err(error)?
        .join(&path)
        .map_err(error)?;
    let bytes = metadata_bytes(url.as_str(), 64 * 1024).await?;
    let signature = metadata_bytes(&format!("{url}.sig"), 4096).await?;
    verify(
        &bytes,
        std::str::from_utf8(&signature).map_err(error)?,
        &trust.pubkey,
    )?;
    let signed_json: serde_json::Value = serde_json::from_slice(&bytes).map_err(error)?;
    // Check equal versions too so repair can recover the exact currently running archive.
    let update = app
        .updater_builder()
        .pubkey(&trust.pubkey)
        .endpoints(vec![url])
        .map_err(error)?
        .version_comparator(|_, _| true)
        .timeout(Duration::from_secs(30))
        .configure_client(|client| client.redirect(reqwest::redirect::Policy::none()))
        .build()
        .map_err(error)?
        .check()
        .await
        .map_err(error)?
        .ok_or("The publisher did not return release metadata.")?;
    if update.raw_json != signed_json {
        return Err("The feed changed during verification. Use Check now again.".into());
    }
    let build: serde_json::Value =
        serde_json::from_str(option_env!("COUCH_BUILD_INFO").unwrap_or("{}")).map_err(error)?;
    let summary = candidate(&update, channel.is_none(), build["revision"].as_str())?;
    if channel.is_some()
        && semver::Version::parse(&update.version).map_err(error)? <= app.package_info().version
    {
        return Ok(None);
    }
    Ok(Some((update, summary)))
}
fn retained(path: &Path, update: &Update, summary: &Candidate, trust: &Enrollment) -> bool {
    fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() == summary.bytes)
        && fs::read(path)
            .is_ok_and(|bytes| verify(&bytes, &update.signature, &trust.pubkey).is_ok())
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
pub async fn run(
    app: tauri::AppHandle,
    directory: PathBuf,
    mut requests: tokio::sync::mpsc::Receiver<Request>,
) {
    let mut selected: Option<(Option<Channel>, Update, Candidate)> = None;
    while let Some(request) = requests.recv().await {
        let report = |value: serde_json::Value| {
            let mut value = value;
            value["type"] = "appimageUpdate".into();
            value["requestId"] = request.id.clone().into();
            app.state::<crate::Host>().report_message(value);
        };
        let operation = async {
            if !running(&app) {
                return Err::<serde_json::Value, String>(
                    "Signed AppImage updates require the running AppImage installation.".into(),
                );
            }
            let trust = enrollment()?;
            let path = directory.join("candidate.AppImage");
            match request.action {
                Action::Check { .. } | Action::CheckRepair {} => {
                    let channel = match request.action {
                        Action::Check { channel } => Some(channel),
                        _ => None,
                    };
                    selected = None;
                    match check(&app, &trust, channel).await? {
                        Some((update, summary)) => {
                            let staged = retained(&path, &update, &summary, &trust);
                            let result = serde_json::json!({"candidate":{"summary":summary,"staged":staged}});
                            selected = Some((channel, update, summary));
                            Ok(result)
                        }
                        None => Ok(serde_json::json!({"candidate":null})),
                    }
                }
                Action::Stage { ref candidate_id } => {
                    let (channel, _, summary) = selected
                        .as_ref()
                        .filter(|(_, _, c)| &c.id == candidate_id)
                        .ok_or("This candidate is no longer current. Use Check now.")?;
                    let (mut update, current) = check(&app, &trust, *channel)
                        .await?
                        .filter(|(_, c)| c.id == summary.id)
                        .ok_or("The candidate changed. Use Check now before downloading.")?;
                    if !retained(&path, &update, &current, &trust) {
                        update.timeout = Some(Duration::from_secs(30 * 60));
                        let (limit, mut exceeded) = tokio::sync::watch::channel(false);
                        let mut received = 0;
                        let mut reported = std::time::Instant::now();
                        let download = update.download(|size, total| {
                            received += size as u64;
                            if received > current.bytes || total.is_some_and(|size| size != current.bytes) { let _ = limit.send(true); }
                            if reported.elapsed() >= Duration::from_millis(250) || received == current.bytes {
                                report(serde_json::json!({"progress":{"received":received,"total":current.bytes}}));
                                reported = std::time::Instant::now();
                            }
                        }, || {});
                        let bytes = tokio::select! {
                            result = download => result.map_err(error)?,
                            _ = exceeded.changed() => return Err("The download exceeds its signed size.".into()),
                        };
                        if bytes.len() as u64 != current.bytes || current.expires_at <= now() {
                            return Err(
                                "The download size or signed expiry changed. Use Check now.".into(),
                            );
                        }
                        save(&path, &bytes)?;
                    }
                    Ok(serde_json::json!({"staged":true}))
                }
            }
        };
        match tokio::time::timeout(Duration::from_secs(31 * 60), operation).await {
            Ok(Ok(value)) => report(value),
            Ok(Err(message)) => report(serde_json::json!({"error":message})),
            Err(_) => report(
                serde_json::json!({"error":"The AppImage update timed out. Retry when the feed is available."}),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const KEY: &str = include_str!("../tests/fixtures/update/public.key");
    const SIGNATURE: &str = include_str!("../tests/fixtures/update/archive.sig");
    const ARCHIVE: &[u8] = include_bytes!("../tests/fixtures/update/archive");
    #[test]
    fn metadata_rejects_expiry_relabeling_and_non_exact_repair() {
        let mut metadata = Metadata {
            version: "0.1.0+build.2.1".into(),
            release_id: "2.1".into(),
            revision: "a".repeat(40),
            bytes: 50,
            expires_at: 200_000,
        };
        let valid = |value: &Metadata, current: &str, repair| {
            validate_metadata(
                value,
                100_000,
                "0.1.0+build.2.1",
                current,
                repair,
                Some(&"a".repeat(40)),
                150_000,
            )
        };
        valid(&metadata, "0.1.0+build.2.1", true).unwrap();
        assert!(valid(&metadata, "0.1.0+build.1.1", true).is_err());
        metadata.revision = "b".repeat(40);
        assert!(valid(&metadata, "0.1.0+build.2.1", true).is_err());
        metadata.expires_at = 150_000;
        assert!(valid(&metadata, "0.1.0+build.1.1", false).is_err());
        metadata.expires_at = 200_000;
        metadata.release_id = "1.1".into();
        assert!(valid(&metadata, "0.1.0+build.1.1", false).is_err());
        metadata.release_id = "2.1".into();
        metadata.bytes = 2 * 1024 * 1024 * 1024 + 1;
        assert!(valid(&metadata, "0.1.0+build.1.1", false).is_err());
    }
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
    fn build_versions_order_numerically_and_exact_repair_includes_build_metadata() {
        let versions: Vec<semver::Version> = [
            "0.1.0+build.9.1",
            "0.1.0+build.10.1",
            "0.1.0+build.10.2",
            "0.1.0+build.10.10",
            "0.2.0+build.1.1",
        ]
        .iter()
        .map(|v| v.parse().unwrap())
        .collect();
        for pair in versions.windows(2) {
            assert!(pair[1] > pair[0]);
            assert_ne!(pair[1], pair[0]);
        }
        assert_eq!(
            release_id("0.1.0+build.34144679881.1").unwrap(),
            "34144679881.1"
        );
        for version in [
            "0.1.0",
            "0.1.0+build.01.1",
            "0.1.0+build.1.0",
            "0.1.0-beta+build.1.1",
            "0.1.0+build.1.1.extra",
        ] {
            assert!(release_id(version).is_err());
        }
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

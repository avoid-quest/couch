//! The privileged boundary accepts a fixed inbox, never caller-supplied commands or paths.
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(target_os = "linux")]
mod linux;

type Result<T> = std::result::Result<T, String>;
const MAX_ARCHIVE: u64 = 2 * 1024 * 1024 * 1024;
const MAX_METADATA: u64 = 64 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    request_id: String,
    digest: String,
}

impl Request {
    fn parse(bytes: &[u8]) -> Result<Self> {
        let request: Self = serde_json::from_slice(bytes).map_err(|_| "Invalid update request")?;
        if !hex(&request.request_id, 32) || !hex(&request.digest, 64) {
            return Err("Invalid request identity or SHA-256 digest".into());
        }
        Ok(request)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    request_id: String,
    digest: String,
    version: String,
    phase: String,
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Release {
    schema_version: u64,
    version: String,
    revision: String,
    target: String,
    data_format: u64,
    readable_data_formats: Vec<u64>,
    packaged: bool,
    dirty: bool,
    host: Host,
}

#[derive(Deserialize)]
struct Host {
    os: String,
    version: String,
    architecture: String,
    session: String,
}

fn hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn account_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphabetic()
                || byte == b'_'
                || index > 0 && (byte.is_ascii_digit() || byte == b'-')
        })
}

fn decode(value: &str) -> Result<String> {
    String::from_utf8(
        STANDARD
            .decode(value.trim())
            .map_err(|_| "Invalid signature encoding")?,
    )
    .map_err(|_| "Invalid signature encoding".into())
}

fn verify(bytes: &[u8], signature: &str, public_key: &str, digest: &str) -> Result<()> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_ARCHIVE {
        return Err("Invalid package size".into());
    }
    if format!("{:x}", Sha256::digest(bytes)) != digest {
        return Err("Package digest does not match the request".into());
    }
    PublicKey::decode(&decode(public_key)?)
        .map_err(|_| "Invalid enrolled updater key")?
        .verify(
            bytes,
            &Signature::decode(&decode(signature)?).map_err(|_| "Invalid release signature")?,
            true,
        )
        .map_err(|_| "Package signature verification failed".into())
}

fn release(bytes: &[u8]) -> Result<Release> {
    let value: Release =
        serde_json::from_slice(bytes).map_err(|_| "Invalid signed release metadata")?;
    final_version(&value.version)?;
    if value.schema_version != 1
        || !value.packaged
        || value.dirty
        || value.target != "x86_64-unknown-linux-gnu"
        || !hex(&value.revision, 40)
        || value.data_format == 0
        || !value.readable_data_formats.contains(&value.data_format)
        || value.host.os != "debian"
        || value.host.version != "13"
        || value.host.architecture != "amd64"
        || value.host.session != "x11"
    {
        return Err("Unsupported signed release metadata".into());
    }
    Ok(value)
}

fn final_version(value: &str) -> Result<semver::Version> {
    let version = semver::Version::parse(value).map_err(|_| "Invalid native release version")?;
    if !version.pre.is_empty() || !version.build.is_empty() {
        return Err("Native updates require a final release version".into());
    }
    Ok(version)
}

fn validate_candidate(candidate: &Release, current: &Release, control: &str) -> Result<()> {
    let fields: Vec<_> = control.lines().collect();
    if fields != ["couch", candidate.version.as_str(), "amd64"] {
        return Err("Package control identity does not match its signed release metadata".into());
    }
    if final_version(&candidate.version)? <= final_version(&current.version)? {
        return Err("The package must be newer than the installed Couch version".into());
    }
    if !candidate
        .readable_data_formats
        .contains(&current.data_format)
    {
        return Err("The package cannot read the installed Couch data format".into());
    }
    Ok(())
}

pub fn run() -> Result<()> {
    #[cfg(target_os = "linux")]
    return linux::run();
    #[cfg(not(target_os = "linux"))]
    Err("Native package updates require Debian 13 amd64".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(version: &str, format: u64, readable: &[u64]) -> Release {
        release(serde_json::json!({
            "schemaVersion": 1, "version": version, "revision": "a".repeat(40),
            "target": "x86_64-unknown-linux-gnu", "dataFormat": format,
            "readableDataFormats": readable, "packaged": true, "dirty": false,
            "host": { "os": "debian", "version": "13", "architecture": "amd64", "session": "x11" }
        }).to_string().as_bytes()).unwrap()
    }

    #[test]
    fn authenticates_exact_requested_bytes_with_enrolled_key() {
        let bytes = include_bytes!("../../tests/fixtures/update/archive");
        let signature = include_str!("../../tests/fixtures/update/archive.sig");
        let key = include_str!("../../tests/fixtures/update/public.key");
        let digest = format!("{:x}", Sha256::digest(bytes));
        verify(bytes, signature, key, &digest).unwrap();
        assert!(verify(b"corrupt", signature, key, &digest).is_err());
        assert!(verify(
            b"corrupt",
            signature,
            key,
            &format!("{:x}", Sha256::digest(b"corrupt"))
        )
        .is_err());
        assert!(verify(bytes, signature, "invalid-key", &digest).is_err());
    }

    #[test]
    fn forbids_alternate_paths_and_ambiguous_request_ids() {
        let valid = serde_json::json!({"requestId": "a".repeat(32), "digest": "b".repeat(64)});
        Request::parse(valid.to_string().as_bytes()).unwrap();
        let mut extra = valid.clone();
        extra["path"] = "/tmp/alternate.deb".into();
        assert!(Request::parse(extra.to_string().as_bytes()).is_err());
        for id in [
            "../other",
            "",
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "12345678-1234-1234-1234-123456789abc",
        ] {
            let mut bad = valid.clone();
            bad["requestId"] = id.into();
            assert!(Request::parse(bad.to_string().as_bytes()).is_err());
        }
        for account in ["", "../root", "root.service", "a\\x2db", "a b", "-root"] {
            assert!(!account_name(account));
        }
        assert!(account_name("couch-tv"));
    }

    #[test]
    fn requires_couch_identity_forward_version_and_current_data_readability() {
        let current = manifest("0.1.0", 1, &[1]);
        let candidate = manifest("0.2.0", 2, &[1, 2]);
        validate_candidate(&candidate, &current, "couch\n0.2.0\namd64\n").unwrap();
        for control in [
            "other\n0.2.0\namd64\n",
            "couch\n0.3.0\namd64\n",
            "couch\n0.2.0\narm64\n",
        ] {
            assert!(validate_candidate(&candidate, &current, control).is_err());
        }
        assert!(validate_candidate(&current, &current, "couch\n0.1.0\namd64\n").is_err());
        assert!(validate_candidate(
            &manifest("0.2.0", 2, &[2]),
            &current,
            "couch\n0.2.0\namd64\n"
        )
        .is_err());
        for value in ["0.2.0-rc.1", "0.2.0+build.1", "1:0.2.0", "00.2.0"] {
            assert!(final_version(value).is_err());
        }
    }
}

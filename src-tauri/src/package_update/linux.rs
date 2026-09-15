use super::*;
use std::{
    ffi::{CStr, CString},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd, RawFd},
        unix::{
            ffi::OsStrExt,
            fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
        },
    },
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

const STATE: &str = "/var/lib/couch-updater";
const KEY: &str = "/usr/share/couch/updater.pub";
const INSTALLED_RELEASE: &str = "/usr/lib/Couch/release.json";

fn error(value: impl std::fmt::Display) -> String {
    value.to_string()
}

// Open each untrusted component relative to an already opened directory. A rename
// cannot redirect later opens, and openat2 rejects both ordinary and procfs links.
fn open_at(directory: RawFd, path: &Path, flags: i32) -> Result<File> {
    #[repr(C)]
    struct OpenHow {
        flags: u64,
        mode: u64,
        resolve: u64,
    }
    let path = CString::new(path.as_os_str().as_bytes()).map_err(error)?;
    let how = OpenHow {
        flags: (flags | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK) as u64,
        mode: 0,
        resolve: 0x04 | if directory != libc::AT_FDCWD { 0x08 } else { 0 },
    };
    let fd = unsafe {
        libc::syscall(
            libc::SYS_openat2,
            directory,
            path.as_ptr(),
            &how,
            std::mem::size_of::<OpenHow>(),
        )
    };
    if fd < 0 {
        return Err(format!(
            "Cannot safely open update input: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(unsafe { File::from_raw_fd(fd as RawFd) })
}

fn check_file(file: &File, owner: u32, maximum: u64, private: bool) -> Result<()> {
    let meta = file.metadata().map_err(error)?;
    if !meta.is_file()
        || meta.uid() != owner
        || meta.nlink() != 1
        || meta.mode() & if private { 0o077 } else { 0o022 } != 0
        || meta.len() == 0
        || meta.len() > maximum
    {
        return Err("Update file has unsafe ownership, permissions, type, links or size".into());
    }
    Ok(())
}

fn directory(parent: RawFd, path: &Path, owner: u32, private: bool) -> Result<File> {
    let file = open_at(parent, path, libc::O_RDONLY | libc::O_DIRECTORY)?;
    let meta = file.metadata().map_err(error)?;
    if !meta.is_dir()
        || meta.uid() != owner
        || meta.mode() & if private { 0o077 } else { 0o022 } != 0
    {
        return Err("Update directory has unsafe ownership or permissions".into());
    }
    Ok(file)
}

fn bounded_read(mut file: File, maximum: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    (&mut file)
        .take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(error)?;
    if bytes.len() as u64 > maximum {
        return Err("Update input exceeds its size limit".into());
    }
    Ok(bytes)
}

fn trusted_read(path: &Path, maximum: u64) -> Result<Vec<u8>> {
    let file = open_at(libc::AT_FDCWD, path, libc::O_RDONLY)?;
    check_file(&file, 0, maximum, false)?;
    bounded_read(file, maximum)
}

fn account(name: &str) -> Result<(u32, PathBuf)> {
    if !account_name(name) {
        return Err("Invalid requesting account".into());
    }
    let name = CString::new(name).map_err(error)?;
    let mut record = unsafe { std::mem::zeroed::<libc::passwd>() };
    let mut buffer = vec![0u8; 64 * 1024];
    let mut found = std::ptr::null_mut();
    let status = unsafe {
        libc::getpwnam_r(
            name.as_ptr(),
            &mut record,
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            &mut found,
        )
    };
    if status != 0 || found.is_null() || record.pw_uid == 0 {
        return Err("Requesting account is unavailable".into());
    }
    let home = unsafe { CStr::from_ptr(record.pw_dir) }
        .to_str()
        .map_err(error)?;
    if !Path::new(home).is_absolute() {
        return Err("Account has no absolute home directory".into());
    }
    Ok((record.pw_uid, PathBuf::from(home)))
}

fn inbox(home: &Path, uid: u32) -> Result<File> {
    let mut dir = directory(libc::AT_FDCWD, home, uid, false)?;
    for name in [".local", "state", "quest.avoid.couch", "native-update"] {
        // Existing XDG parent directories may be readable by other accounts.
        dir = directory(
            dir.as_raw_fd(),
            Path::new(name),
            uid,
            name == "native-update",
        )?;
    }
    Ok(dir)
}

fn input(inbox: &File, name: &str, uid: u32, maximum: u64) -> Result<File> {
    let file = open_at(inbox.as_raw_fd(), Path::new(name), libc::O_RDONLY)?;
    check_file(&file, uid, maximum, true)?;
    Ok(file)
}

fn snapshot(inbox: &File, name: &str, uid: u32, destination: &Path, maximum: u64) -> Result<()> {
    let source = input(inbox, name, uid, maximum)?;
    let before = source.metadata().map_err(error)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(destination)
        .map_err(error)?;
    let copied = std::io::copy(&mut (&source).take(maximum + 1), &mut output).map_err(error)?;
    let after = source.metadata().map_err(error)?;
    if copied > maximum
        || copied != before.len()
        || before.len() != after.len()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.mtime() != after.mtime()
        || before.ctime_nsec() != after.ctime_nsec()
        || before.ctime() != after.ctime()
    {
        return Err("Update input changed during the root snapshot".into());
    }
    output.sync_all().map_err(error)
}

fn atomic_json(path: &Path, value: &Receipt) -> Result<()> {
    let parent = path.parent().ok_or("Invalid receipt location")?;
    let temporary = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4().simple()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o644)
        .open(&temporary)
        .map_err(error)?;
    let result = (|| {
        file.write_all(&serde_json::to_vec(value).map_err(error)?)
            .map_err(error)?;
        file.set_permissions(fs::Permissions::from_mode(0o644))
            .map_err(error)?;
        file.sync_all().map_err(error)?;
        fs::rename(&temporary, path).map_err(error)?;
        File::open(parent).map_err(error)?.sync_all().map_err(error)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn command(executable: &str) -> Command {
    let mut command = Command::new(executable);
    command
        .env_clear()
        .env("PATH", "/usr/sbin:/usr/bin:/sbin:/bin")
        .env("HOME", "/root")
        .env("LANG", "C")
        .env("LC_ALL", "C")
        .env("DEBIAN_FRONTEND", "noninteractive")
        .current_dir("/")
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    command
}

fn collect(mut child: Child, maximum: u64) -> Result<Vec<u8>> {
    let stdout = child
        .stdout
        .take()
        .ok_or("Missing package inspector output")?;
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout
            .take(maximum + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes);
        let _ = send.send(result);
    });
    let bytes = match receive.recv_timeout(Duration::from_secs(30)) {
        Ok(Ok(bytes)) if bytes.len() as u64 <= maximum => bytes,
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Package inspection exceeded its output or time limit".into());
        }
    };
    if wait(&mut child)? {
        Ok(bytes)
    } else {
        Err("Package inspection failed".into())
    }
}

fn wait(child: &mut Child) -> Result<bool> {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(status) = child.try_wait().map_err(error)? {
            return Ok(status.success());
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Package inspection timed out".into());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn output(command: &mut Command, maximum: u64) -> Result<String> {
    String::from_utf8(collect(
        command.stdout(Stdio::piped()).spawn().map_err(error)?,
        maximum,
    )?)
    .map_err(error)
}

fn inspect(archive: &Path) -> Result<(Release, String)> {
    let mut control = String::new();
    for field in ["Package", "Version", "Architecture"] {
        control.push_str(
            output(
                command("/usr/bin/dpkg-deb")
                    .arg("--field")
                    .arg(archive)
                    .arg(field),
                MAX_METADATA,
            )?
            .trim(),
        );
        control.push('\n');
    }
    let mut unpack = command("/usr/bin/dpkg-deb")
        .arg("--fsys-tarfile")
        .arg(archive)
        .stdout(Stdio::piped())
        .spawn()
        .map_err(error)?;
    let stream = unpack
        .stdout
        .take()
        .ok_or("Missing package archive stream")?;
    let extracted = command("/usr/bin/tar")
        .args(["-xOf", "-", "--wildcards", "usr/lib/Couch/release.json"])
        .stdin(Stdio::from(stream))
        .stdout(Stdio::piped())
        .spawn();
    let result = match extracted {
        Ok(child) => collect(child, MAX_METADATA),
        Err(_) => Err("Cannot inspect signed package manifest".into()),
    };
    if result.is_err() {
        let _ = unpack.kill();
    }
    let success = wait(&mut unpack)?;
    let bytes = result?;
    if !success {
        return Err("Cannot read signed package archive".into());
    }
    Ok((release(&bytes)?, control))
}

fn configured(version: &str) -> Result<()> {
    let installed = output(
        command("/usr/bin/dpkg-query").args([
            "--show",
            "--showformat=${db:Status-Status}\n${Version}\n${Architecture}\n",
            "couch",
        ]),
        MAX_METADATA,
    )?;
    if installed != format!("installed\n{version}\namd64\n") {
        return Err("Installed Couch package is unconfigured or has an unexpected identity; administrator repair is required".into());
    }
    Ok(())
}

fn authenticate(archive: &Path, signature: &str, key: &str, digest: &str) -> Result<()> {
    let file = File::open(archive).map_err(error)?;
    let length = file.metadata().map_err(error)?.len() as usize;
    if length == 0 || length as u64 > MAX_ARCHIVE {
        return Err("Invalid snapshot size".into());
    }
    // The root-owned immutable snapshot permits legacy Tauri signatures without
    // allocating another multi-gigabyte copy of the package in memory.
    let mapping = unsafe {
        libc::mmap(
            std::ptr::null_mut(),
            length,
            libc::PROT_READ,
            libc::MAP_PRIVATE,
            file.as_raw_fd(),
            0,
        )
    };
    if mapping == libc::MAP_FAILED {
        return Err("Cannot map the signed package snapshot".into());
    }
    let verified = verify(
        unsafe { std::slice::from_raw_parts(mapping.cast::<u8>(), length) },
        signature,
        key,
        digest,
    );
    unsafe {
        libc::munmap(mapping, length);
    }
    verified
}

fn install(
    archive: &Path,
    receipt: &mut Receipt,
    result_path: &Path,
    staging: &Path,
) -> Result<()> {
    let candidate = inspect(archive)?;
    let current = release(&trusted_read(Path::new(INSTALLED_RELEASE), MAX_METADATA)?)?;
    validate_candidate(&candidate.0, &current, &candidate.1)?;
    configured(&current.version)?;
    receipt.version = candidate.0.version.clone();
    let newer = command("/usr/bin/dpkg")
        .args([
            "--compare-versions",
            &candidate.0.version,
            "gt",
            &current.version,
        ])
        .status()
        .map_err(error)?;
    if !newer.success() {
        return Err("Debian package version must increase".into());
    }

    let log_path = Path::new(STATE)
        .join("logs")
        .join(format!("{}.log", receipt.request_id));
    let log = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(log_path)
        .map_err(error)?;
    receipt.phase = "installing".into();
    atomic_json(&Path::new(STATE).join("active.json"), receipt)?;
    atomic_json(result_path, receipt)?;
    File::open(staging)
        .map_err(error)?
        .sync_all()
        .map_err(error)?;
    let status = command("/usr/bin/apt-get")
        .args(["--yes", "--no-remove", "--no-install-recommends", "install"])
        .arg(archive)
        .stdout(Stdio::from(log.try_clone().map_err(error)?))
        .stderr(Stdio::from(log))
        .status()
        .map_err(|_| "Cannot start the package manager")?;
    if !status.success() {
        return Err("APT could not complete the Couch installation. The administrator can inspect the Couch updater log and repair packages.".into());
    }
    configured(&candidate.0.version)?;
    let installed = release(&trusted_read(Path::new(INSTALLED_RELEASE), MAX_METADATA)?)?;
    if installed.version != candidate.0.version || installed.revision != candidate.0.revision {
        return Err("Installed release metadata does not match the signed candidate".into());
    }
    Ok(())
}

pub(super) fn run() -> Result<()> {
    if unsafe { libc::geteuid() } != 0 || std::env::consts::ARCH != "x86_64" {
        return Err("The package broker requires root on Debian 13 amd64".into());
    }
    let args: Vec<_> = std::env::args().collect();
    let (repair, name) = match args.as_slice() {
        [_, name] => (false, name.clone()),
        [_, flag, name] if flag == "--repair" => (true, name.clone()),
        _ => return Err("The package broker accepts one account name, or --repair with one".into()),
    };
    let (uid, home) = account(&name)?;
    let os = fs::read_to_string("/etc/os-release").map_err(error)?;
    if !os.lines().any(|line| line == "ID=debian")
        || !os
            .lines()
            .any(|line| line == "VERSION_ID=\"13\"" || line == "VERSION_ID=13")
    {
        return Err("Native updates require Debian 13".into());
    }
    unsafe {
        libc::umask(0o077);
    }
    let root = directory(libc::AT_FDCWD, Path::new(STATE), 0, false)?;
    for name in ["results", "staging", "logs", "retained"] {
        directory(root.as_raw_fd(), Path::new(name), 0, name != "results")?;
    }
    if repair {
        // Clear only a marker that parses as a genuine interrupted installation.
        let active = Path::new(STATE).join("active.json");
        let marker: Receipt = serde_json::from_slice(&trusted_read(&active, MAX_METADATA)?)
            .map_err(|_| String::from("The retained marker is not a readable receipt; inspect it manually"))?;
        if marker.phase != "installing"
            || !hex(&marker.request_id, 32)
            || !hex(&marker.digest, 64)
            || final_version(&marker.version).is_err()
        {
            return Err("The retained marker is not a verified interrupted installation; inspect it manually".into());
        }
        fs::remove_file(&active).map_err(error)?;
        File::open(STATE).map_err(error)?.sync_all().map_err(error)?;
        let mut log = OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o600)
            .open(Path::new(STATE).join("logs").join("repair.log"))
            .map_err(error)?;
        writeln!(
            log,
            "{} cleared interrupted request {} for {name}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(error)?
                .as_secs(),
            marker.request_id
        )
        .map_err(error)?;
        return Ok(());
    }
    let inbox = inbox(&home, uid)?;
    let request = Request::parse(&bounded_read(
        input(&inbox, "request.json", uid, MAX_METADATA)?,
        MAX_METADATA,
    )?)?;
    let result_path = Path::new(STATE)
        .join("results")
        .join(format!("{name}.json"));
    let mut receipt = Receipt {
        request_id: request.request_id,
        digest: request.digest,
        version: String::new(),
        phase: "verifying".into(),
        error: None,
    };
    let lock = open_at(root.as_raw_fd(), Path::new("lock"), libc::O_RDONLY)?;
    let lock_meta = lock.metadata().map_err(error)?;
    if !lock_meta.is_file()
        || lock_meta.uid() != 0
        || lock_meta.nlink() != 1
        || lock_meta.mode() & 0o022 != 0
    {
        return Err("Unsafe package update lock".into());
    }
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        receipt.phase = "failed".into();
        receipt.error = Some("Close other Couch sessions before updating".into());
        atomic_json(&result_path, &receipt)?;
        return Err(receipt.error.unwrap());
    }
    let active = Path::new(STATE).join("active.json");
    if active.exists() {
        let previous: Receipt =
            serde_json::from_slice(&trusted_read(&active, MAX_METADATA)?).map_err(error)?;
        if previous.phase != "failed" {
            return Err(
                "A package operation was interrupted; administrator repair is required".into(),
            );
        }
    }
    if result_path.exists() {
        let previous: Receipt =
            serde_json::from_slice(&trusted_read(&result_path, MAX_METADATA)?).map_err(error)?;
        if previous.request_id == receipt.request_id {
            return Err("This update request was already handled; read its saved result".into());
        }
    }
    atomic_json(&result_path, &receipt)?;
    let staging = Path::new(STATE)
        .join("staging")
        .join(uuid::Uuid::new_v4().simple().to_string());
    fs::create_dir(&staging).map_err(error)?;
    let archive = staging.join("candidate.deb");
    let result = (|| {
        snapshot(&inbox, "candidate.deb", uid, &archive, MAX_ARCHIVE)?;
        snapshot(
            &inbox,
            "candidate.sig",
            uid,
            &staging.join("candidate.sig"),
            MAX_METADATA,
        )?;
        let signature = String::from_utf8(fs::read(staging.join("candidate.sig")).map_err(error)?)
            .map_err(error)?;
        let key = String::from_utf8(trusted_read(Path::new(KEY), MAX_METADATA)?).map_err(error)?;
        authenticate(&archive, &signature, &key, &receipt.digest)?;
        install(&archive, &mut receipt, &result_path, &staging)
    })();
    let attempted = receipt.phase == "installing";
    receipt.phase = if result.is_ok() {
        "succeeded"
    } else {
        "failed"
    }
    .into();
    receipt.error = result.as_ref().err().cloned();
    // Persist the terminal receipt before unblocking app startup. Never erase an
    // interrupted operation marker when the helper dies before this point.
    atomic_json(&result_path, &receipt)?;
    if attempted {
        if result.is_ok() {
            fs::remove_file(&active).map_err(error)?;
            File::open(STATE)
                .map_err(error)?
                .sync_all()
                .map_err(error)?;
        } else {
            atomic_json(&active, &receipt)?;
        }
    }
    if attempted && result.is_err() {
        // Keep one authenticated failed candidate per account for administrator
        // recovery, rather than growing an archive for every retried request.
        let retained = Path::new(STATE).join("retained").join(name);
        if retained.exists() {
            fs::remove_dir_all(&retained).map_err(error)?;
        }
        fs::rename(&staging, &retained).map_err(error)?;
        File::open(retained.parent().unwrap())
            .map_err(error)?
            .sync_all()
            .map_err(error)?;
    } else {
        fs::remove_dir_all(&staging).map_err(error)?;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn inspects_real_debian_archive_without_executing_package_scripts() {
        let path = std::env::temp_dir().join(format!("couch-package-{}", uuid::Uuid::new_v4()));
        let package = path.join("package");
        fs::create_dir_all(package.join("DEBIAN")).unwrap();
        fs::create_dir_all(package.join("usr/lib/Couch")).unwrap();
        fs::write(package.join("DEBIAN/control"), "Package: couch\nVersion: 0.2.0\nArchitecture: amd64\nMaintainer: Couch\nDescription: Broker test package\n").unwrap();
        let marker = path.join("executed");
        fs::write(
            package.join("DEBIAN/postinst"),
            format!("#!/bin/sh\ntouch {}\n", marker.display()),
        )
        .unwrap();
        fs::set_permissions(
            package.join("DEBIAN/postinst"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        let manifest = package.join("usr/lib/Couch/release.json");
        fs::write(
            &manifest,
            serde_json::json!({
                "schemaVersion": 1, "version": "0.2.0", "revision": "a".repeat(40),
                "target": "x86_64-unknown-linux-gnu", "dataFormat": 1,
                "readableDataFormats": [1], "packaged": true, "dirty": false,
                "host": {"os": "debian", "version": "13", "architecture": "amd64", "session": "x11"}
            })
            .to_string(),
        )
        .unwrap();
        let archive = path.join("candidate.deb");
        let build = || {
            assert!(command("/usr/bin/dpkg-deb")
                .arg("--build")
                .arg(&package)
                .arg(&archive)
                .stdout(Stdio::null())
                .status()
                .unwrap()
                .success());
        };
        build();
        let (candidate, control) = inspect(&archive).unwrap();
        assert_eq!(candidate.version, "0.2.0");
        assert_eq!(control, "couch\n0.2.0\namd64\n");
        assert!(!marker.exists());
        fs::write(&manifest, vec![b' '; MAX_METADATA as usize + 1]).unwrap();
        build();
        assert!(inspect(&archive).is_err());
        fs::remove_file(manifest).unwrap();
        build();
        assert!(inspect(&archive).is_err());
        assert!(!marker.exists());
        fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn descriptor_reads_reject_links_and_special_or_public_files() {
        let path = std::env::temp_dir().join(format!("couch-input-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        let uid = unsafe { libc::geteuid() };
        let dir = directory(libc::AT_FDCWD, &path, uid, true).unwrap();
        let file = path.join("good");
        fs::write(&file, b"signed package").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        input(&dir, "good", uid, 100).unwrap();
        assert!(input(&dir, "good", uid, 1).is_err());
        assert!(input(&dir, "good", uid + 1, 100).is_err());
        symlink("good", path.join("link")).unwrap();
        assert!(input(&dir, "link", uid, 100).is_err());
        fs::hard_link(&file, path.join("hard")).unwrap();
        assert!(input(&dir, "good", uid, 100).is_err());
        fs::remove_file(path.join("hard")).unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(input(&dir, "good", uid, 100).is_err());
        let fifo = CString::new(path.join("fifo").as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
        assert!(input(&dir, "fifo", uid, 100).is_err());
        symlink(&path, path.join("parent")).unwrap();
        assert!(directory(libc::AT_FDCWD, &path.join("parent"), uid, true).is_err());
        fs::remove_dir_all(&path).unwrap();
    }

    #[test]
    fn renamed_parent_cannot_redirect_open_inbox_or_root_snapshot() {
        let path = std::env::temp_dir().join(format!("couch-snapshot-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        fs::create_dir(path.join("inbox")).unwrap();
        fs::set_permissions(path.join("inbox"), fs::Permissions::from_mode(0o700)).unwrap();
        let uid = unsafe { libc::geteuid() };
        let dir = directory(libc::AT_FDCWD, &path.join("inbox"), uid, false).unwrap();
        fs::write(path.join("inbox/candidate"), b"original").unwrap();
        fs::set_permissions(
            path.join("inbox/candidate"),
            fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        fs::rename(path.join("inbox"), path.join("renamed")).unwrap();
        fs::create_dir(path.join("inbox")).unwrap();
        fs::write(path.join("inbox/candidate"), b"replacement").unwrap();
        snapshot(&dir, "candidate", uid, &path.join("snapshot"), 100).unwrap();
        fs::write(path.join("renamed/candidate"), b"changed afterward").unwrap();
        assert_eq!(fs::read(path.join("snapshot")).unwrap(), b"original");
        fs::remove_dir_all(path).unwrap();
    }
}

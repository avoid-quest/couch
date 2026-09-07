"""Read-only Ubuntu package facts and the single supported ffprobe repair target."""
import json
from pathlib import Path
import sys


def ubuntu(version):
    return any(origin.origin == "Ubuntu" and origin.trusted for origin in version.origins)


def inspect(runtime=False):
    import apt
    cache = apt.Cache()
    if runtime:
        package = cache["ffmpeg"]
        version = package.installed or package.candidate
        if not version:
            raise ValueError("Ubuntu's ffmpeg package is unavailable in the local package indexes.")
        available = next((value for value in package.versions if value.version == version.version and value.downloadable and ubuntu(value)), None)
        if not available:
            raise ValueError("The exact Ubuntu ffmpeg archive is unavailable. Refresh Ubuntu package indexes through the system administrator before retrying.")
        return {"version": available.version, "installed": package.installed.version if package.installed else None}
    packages = [package for package in cache if package.is_installed and package.is_upgradable and package.candidate and ubuntu(package.candidate)]
    security = sum(any(origin.origin == "Ubuntu" and origin.trusted and origin.archive.endswith("-security") for origin in package.candidate.origins) for package in packages)
    stamp = Path("/var/lib/apt/periodic/update-stamp")
    return {"available": len(packages), "security": security, "indexUpdatedAt": int(stamp.stat().st_mtime * 1000) if stamp.exists() else None, "broken": cache.broken_count}


if __name__ == "__main__":
    try:
        print(json.dumps({"ok": True, **inspect(sys.argv[1:] == ["runtime"])}))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error) if isinstance(error, ValueError) else "Ubuntu package status is unavailable. Its python3-apt runtime or package indexes need system administration."}))

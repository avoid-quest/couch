# Tauri releases

Use [hosted releases](hosted-releases.md) for Debian and AppImage packaging and
the [four-platform Preview guide](multiplatform-preview.md) for the coordinated
Mac and Windows packages. GitHub Actions builds, signs, qualifies and uploads
each package using the existing `couch-release` environment. The enrolled
updater private key remains only on GitHub.

Local Mac and Docker work may run headless or unsigned checks. The T480 only
installs and runs Couch; it never builds or hosts release files. The published
downloads and updater feeds are served by CrabNebula.

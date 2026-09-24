# Couch 0.2.0-preview.12 release receipts

The [Preview release](https://github.com/avoid-quest/couch/releases/tag/v0.2.0-preview.12) was built from `89c041c4d3c5c4b8ad0d0391aeb9a6a98b839a7a` and published to CrabNebula as `01M38A38PR5GFDQXRQS4D1YJ1Q`.

| Format | Successful build run | Assets |
| --- | --- | --- |
| Debian | [35934475283.1](https://github.com/avoid-quest/couch/actions/runs/35934475283) | 1 |
| AppImage | [35935411905.1](https://github.com/avoid-quest/couch/actions/runs/35935411905) | 1 |
| Mac DMG and updater | [35935986542.1](https://github.com/avoid-quest/couch/actions/runs/35935986542) | 2 |
| Windows NSIS and updater | [35936257574.1](https://github.com/avoid-quest/couch/actions/runs/35936257574) | 2 |

[Publication run 35936983868.1](https://github.com/avoid-quest/couch/actions/runs/35936983868) verified the four signed source receipts and six Cloud assets, published them, checked the public download hashes and four updater feeds, then created the GitHub prerelease mirror.

Each format directory retains its signed `manifest.json` and `qualified.json`, plus the Cloud upload receipt. The Debian directory also retains the draft identity. The manifests record filenames, byte counts, SHA-256 hashes, updater signatures, source revision and build run. These small receipts contain no private key or package binary. They are kept here because GitHub Actions artifact storage was over quota; the release workflows recovered the signed receipts from their logs, which expire.

Installed and physical acceptance remains in the open desktop qualification issues. Windows is Client-only in this Preview.

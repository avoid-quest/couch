import { strict as assert } from "node:assert";
import { join } from "node:path";
import { channelArgs, type Channel } from "./hosted-policy";
import { verifyFiles, verifyPublic, type Manifest } from "./hosted-release";

// Prepare local site files only after independently rechecking hosted readiness.
// Deployment is a separate owner-authorized operation.
const [directory, channelInput] = process.argv.slice(2);
assert.ok(directory, "Supply the retained hosted-ready artifact directory and channel.");
const channel = channelInput as Channel;
channelArgs(channel);
const manifest: Manifest = await Bun.file(join(directory, "manifest.json")).json();
await verifyFiles(directory, manifest);
const qualified = await Bun.file(join(directory, "qualified.json")).json();
assert.equal(qualified.revision, manifest.revision);
assert.deepEqual(qualified.files, manifest.files);
const retained = await Bun.file(join(directory, `readiness-${channel}.json`)).json();
assert.equal(retained.revision, manifest.revision);
assert.deepEqual(retained.files, manifest.files);
const receipt = await verifyPublic(manifest, channel);
const keyFile = Bun.file("apps/web/public/couch-updater.pub");
if (await keyFile.exists()) assert.equal((await keyFile.text()).trim(), manifest.publicKey, "Do not silently replace the enrolled key.");
const releases = await Bun.file("apps/web/src/releases.json").json();
releases[channel] = { version: manifest.version, checkedAt: receipt.checkedAt };
await Bun.write(keyFile, manifest.publicKey + "\n");
await Bun.write("apps/web/src/releases.json", JSON.stringify(releases, null, 2) + "\n");
console.log(`Prepared ${channel} ${manifest.version}. Review and commit the site files before separately authorized deployment.`);

import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isIPv4 } from "node:net";
import { join } from "node:path";

// DER (X.690) for the few types an X.509 certificate needs.
const der = (tag: number, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const size = body.length < 0x80 ? Buffer.from([body.length]) : Buffer.from(body.length.toString(16).padStart(body.length > 0xff ? 4 : 2, "0"), "hex");
  return Buffer.concat([Buffer.from(body.length < 0x80 ? [tag] : [tag, 0x80 | size.length]), size, body]);
};
const sequence = (...parts: Buffer[]) => der(0x30, ...parts);
const oid = (hex: string) => der(0x06, Buffer.from(hex, "hex"));
const time = (date: Date) => der(0x17, Buffer.from(date.toISOString().replace(/^\d\d|[-:T]|\.\d+/g, "")));
const extension = (id: string, critical: boolean, value: Buffer) => sequence(oid(id), ...critical ? [der(0x01, Buffer.from([0xff]))] : [], der(0x04, value));
const ecdsaSha256 = sequence(oid("2a8648ce3d040302"));
const name = sequence(der(0x31, sequence(oid("550403"), der(0x0c, Buffer.from("Couch")))));
const day = 86_400_000;

// Core's self-signed certificate (#644 HTTPS). The key is made once and kept, so the app's pin
// (the key's SHA-256) survives a certificate reissued for new names or before it expires.
// iPhones apply Apple's rules to every TLS server: names in subjectAltName, serverAuth, and
// at most 825 days (https://support.apple.com/en-us/103769). The LAN listener is IPv4-only,
// so the names are DNS names and IPv4 addresses.
export async function certificate(dir: string, names: string[]) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const keyPath = join(dir, "key.pem"), certPath = join(dir, "cert.pem");
  let key = await readFile(keyPath, "utf8").catch(() => "");
  if (!key) await writeFile(keyPath, key = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string, { mode: 0o600 });
  const publicKey = createPublicKey(key);
  const wanted = names.filter(value => isIPv4(value) || /^[a-z0-9.-]+$/.test(value));
  const saved = await readFile(certPath, "utf8").catch(() => "");
  const current = saved ? new X509Certificate(saved) : null;
  if (current?.publicKey.equals(publicKey) && Date.parse(current.validTo) - Date.now() > 90 * day
    && wanted.every(value => isIPv4(value) ? current.checkIP(value) : current.checkHost(value))) return { key, cert: saved };
  const serial = randomBytes(16);
  serial[0] = (serial[0]! & 0x7f) | 0x40;
  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, serial), ecdsaSha256, name,
    sequence(time(new Date(Date.now() - day)), time(new Date(Date.now() + 824 * day))), name,
    publicKey.export({ type: "spki", format: "der" }),
    der(0xa3, sequence(
      extension("551d13", true, sequence()),
      extension("551d0f", true, der(0x03, Buffer.from([0x07, 0x80]))),
      extension("551d25", false, sequence(oid("2b06010505070301"))),
      extension("551d11", false, sequence(...wanted.map(value => isIPv4(value) ? der(0x87, Buffer.from(value.split(".").map(Number))) : der(0x82, Buffer.from(value))))),
    )),
  );
  const body = sequence(tbs, ecdsaSha256, der(0x03, Buffer.from([0]), sign("sha256", tbs, createPrivateKey(key))));
  const cert = `-----BEGIN CERTIFICATE-----\n${body.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;
  await writeFile(certPath, cert);
  return { key, cert };
}

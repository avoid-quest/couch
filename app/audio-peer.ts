import { createHash, X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { connect, type ConnectionOptions } from "node:tls";

export const certificatePin = (certificate: X509Certificate) => createHash("sha256")
  .update(certificate.publicKey.export({ type: "spki", format: "der" })).digest("base64");

/** Probe without application credentials, then authenticate the media socket with the saved key. */
export async function audioPeerTls(origin: string, pin: string | undefined, signal: AbortSignal): Promise<ConnectionOptions> {
  const url = new URL(origin);
  if (url.protocol !== "https:" || !pin) throw new Error("Choose and trust this Couch before using native audio.");
  signal.throwIfAborted();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ca = await new Promise<string>((resolve, reject) => {
    const socket = connect({ host, port: Number(url.port || 443), ...(isIP(host) ? {} : { servername: host }), rejectUnauthorized: false }, () => {
      try {
        const certificate = socket.getPeerX509Certificate();
        if (!certificate || certificatePin(certificate) !== pin) throw new Error("This Couch's certificate changed. Choose it again before using native audio.");
        resolve(certificate.toString());
      } catch (error) { reject(error); }
      finally { socket.destroy(); }
    });
    const abort = () => socket.destroy(new Error("Native audio connection canceled."));
    const timeout = setTimeout(() => socket.destroy(new Error("Finding this Couch timed out.")), 4000);
    signal.addEventListener("abort", abort, { once: true });
    socket.once("error", reject);
    socket.once("close", () => { clearTimeout(timeout); signal.removeEventListener("abort", abort); });
    if (signal.aborted) abort();
  });
  signal.throwIfAborted();
  return {
    // Couch serves a CA-signed leaf; trust that verified key without requiring
    // its private CA to be installed in Node's system trust store.
    ca, allowPartialTrustChain: true, rejectUnauthorized: true,
    // Match Electron's existing SPKI trust, including a certificate for a LAN IP.
    checkServerIdentity: (_host, certificate) => certificatePin(new X509Certificate(certificate.raw)) === pin
      ? undefined : new Error("This Couch's certificate changed."),
  };
}

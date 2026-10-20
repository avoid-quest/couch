// One independent Electron process/profile per output; production Couch assets.
import { app, BrowserWindow, session } from "electron";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { X509Certificate } from "node:crypto";

const config = (() => {
  try { return JSON.parse(readFileSync(process.argv.at(-1)!, "utf8")); }
  catch (error) { console.error("Invalid audio worker config", error); process.exit(1); }
})();
app.setPath("userData", config.profile);
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
if (config.audioBufferFrames !== null && config.audioBufferFrames !== undefined) {
  if (![128, 256, 512, 1024].includes(config.audioBufferFrames)) throw new Error("Invalid lab audio buffer size");
  app.commandLine.appendSwitch("audio-buffer-size", String(config.audioBufferFrames));
}
// Electron must finish evaluating the main ESM before it emits ready.
void app.whenReady().then(async () => {
if (config.certificatePin) session.defaultSession.setCertificateVerifyProc(({ hostname, certificate }, callback) => {
  const matches = hostname === config.certificatePin.hostname
    && new X509Certificate(certificate.data).fingerprint256 === config.certificatePin.fingerprint256;
  callback(hostname === config.certificatePin.hostname ? (matches ? 0 : -2) : -3);
});
session.defaultSession.setPermissionRequestHandler((_contents, permission, allow) => allow(permission === "media"));
session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === "media");
const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true } });
win.webContents.on("console-message", details => {
  if (details.message.startsWith("Sendspin:")) process.stderr.write(details.message + "\n");
});
await win.loadURL(config.origin);
await win.webContents.executeJavaScript(`(() => {
  const config = ${JSON.stringify(config)};
  localStorage.setItem('sendspin-identity-sk', config.key);
  localStorage.setItem('couch.remote-token', config.token);
  localStorage.setItem('couch.remote-installation-id', config.installationId);
  localStorage.setItem('couch.device-name', config.name);
  localStorage.setItem('couch.device-sharing', JSON.stringify({ audio: true, video: false }));
})()`);
await win.loadURL(config.origin);
await win.webContents.executeJavaScript(`(() => {
  // Existing native tests use this same production context seam. Playback,
  // capture, admission, decoding and output remain the actual application code.
  window.__labSession = () => {
    const root = document.getElementById('root');
    const container = root?.[Object.keys(root).find(key => key.startsWith('__reactContainer'))];
    const nodes = [container?.stateNode.current];
    while (nodes.length) {
      const node = nodes.pop(), value = node?.memoizedProps?.value;
      if (value?.startLive && value?.queryClient) return value;
      if (node?.child) nodes.push(node.child);
      if (node?.sibling) nodes.push(node.sibling);
    }
  };
  window.__labPeers = [];
  const Peer = RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer { constructor(...args) { super(...args); window.__labPeers.push(this); } };
  window.__labRTCStats = async () => Promise.all(window.__labPeers.map(async peer => {
    const report = await peer.getStats(), stats = [...report.values()];
    const selectedIds = stats.filter(item => item.type === 'transport').map(item => item.selectedCandidatePairId).filter(Boolean);
    const pairs = stats.filter(item => item.type === 'candidate-pair' && (selectedIds.includes(item.id) || (!selectedIds.length && item.nominated && item.state === 'succeeded')));
    const pick = (item, names) => item ? Object.fromEntries(names.filter(name => item[name] !== undefined).map(name => [name, item[name]])) : null;
    const candidate = id => pick(report.get(id), ['id', 'address', 'port', 'protocol', 'candidateType', 'relayProtocol', 'networkType']);
    return {
      connectionState: peer.connectionState, iceConnectionState: peer.iceConnectionState,
      selectedPairs: pairs.map(pair => ({ ...pick(pair, ['id', 'state', 'nominated', 'bytesSent', 'bytesReceived', 'currentRoundTripTime']),
        selectedBy: selectedIds.includes(pair.id) ? 'transport.selectedCandidatePairId' : 'nominated-succeeded',
        local: candidate(pair.localCandidateId), remote: candidate(pair.remoteCandidateId) })),
      codecs: stats.filter(item => item.type === 'codec').map(item => pick(item, ['id', 'mimeType', 'clockRate', 'channels', 'sdpFmtpLine'])),
      media: stats.filter(item => item.type === 'inbound-rtp' || item.type === 'outbound-rtp').map(item => pick(item,
        ['id', 'type', 'kind', 'codecId', 'bytesReceived', 'bytesSent', 'packetsReceived', 'packetsSent', 'packetsLost', 'jitter',
         'totalSamplesReceived', 'concealedSamples', 'silentConcealedSamples', 'concealmentEvents', 'jitterBufferDelay', 'jitterBufferEmittedCount', 'totalAudioEnergy'])),
    };
  }));
})()`);
const reply = (value: unknown) => process.stdout.write(`COUCH_LAB ${JSON.stringify(value)}\n`);
reply({ ready: true, versions: process.versions, context: await win.webContents.executeJavaScript("({ origin: location.origin, isSecureContext, cryptoSubtle: !!globalThis.crypto?.subtle })") });
win.webContents.on("render-process-gone", (_event, details) => { console.error("Renderer exited", details); app.exit(1); });
win.webContents.on("unresponsive", () => { console.error("Renderer unresponsive"); app.exit(1); });
createInterface({ input: process.stdin }).on("line", async line => {
  let request: { id: number; code?: string; gesture?: boolean; close?: boolean } | undefined;
  try {
    request = JSON.parse(line);
    if (request!.close) { win.destroy(); app.quit(); return; }
    const value = await win.webContents.executeJavaScript(request!.code!, request!.gesture ?? false);
    reply({ id: request!.id, value: value ?? null });
  } catch (error) { reply({ id: request?.id, error: String(error) }); }
});
process.stdin.on("end", () => app.quit());
process.stdin.on("error", error => { console.error(error); app.exit(1); });
}).catch(error => { console.error(error); app.exit(1); });

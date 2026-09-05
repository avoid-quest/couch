import { QRCodeSVG } from "qrcode.react";

export function SetupQr({ url }: { url: string }) {
  return <QRCodeSVG value={url} size={160} marginSize={4} level="M" title={`Open Couch at ${url}`} className="h-40 w-40 shrink-0 rounded-md" />;
}

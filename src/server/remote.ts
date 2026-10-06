import { isRemoteField, remoteFields, type RemoteTextField } from "../shared/remote";
import type { ServerMessage } from "../shared/protocol";

// Focus belongs to the newest TV connection, never to the controller that sends text.
export function createTvRemote<Socket>({ current, send, changed }: {
  current: (socket: Socket) => boolean;
  send: (socket: Socket, message: ServerMessage) => void;
  changed: () => void;
}) {
  const fields = new Map<Socket, RemoteTextField>();
  const requests = new Map<string, { socket: Socket; finish: (error?: string) => void }>();
  const field = (socket: Socket | undefined) => socket && current(socket) ? fields.get(socket) ?? null : null;
  return {
    field,
    receive(socket: Socket, message: string) {
      let value;
      try { value = JSON.parse(message); } catch { return false; }
      if (value?.type === "textFocus") {
        if (!current(socket)) return true;
        const focus = value.field;
        const kind: unknown = focus?.kind;
        const valid = focus && isRemoteField(kind) && typeof focus.token === "string" && /^[\w-]{1,80}$/.test(focus.token)
          && typeof focus.value === "string" && focus.value.length <= remoteFields[kind as keyof typeof remoteFields].maxLength && !/[\u0000-\u001f\u007f]/.test(focus.value);
        if (valid) fields.set(socket, { kind: focus.kind, token: focus.token, value: focus.value, ...remoteFields[kind as keyof typeof remoteFields] });
        else fields.delete(socket);
        changed();
        return true;
      }
      if (value?.type === "textResult") {
        const request = requests.get(value.requestId);
        if (request?.socket === socket) request.finish(current(socket) && value.ok === true ? undefined : "The TV field changed. Select a field on the TV again.");
        return true;
      }
      return false;
    },
    text(socket: Socket, token: string, text: string, submit: boolean) {
      const focused = field(socket);
      if (!focused || token !== focused.token) return Promise.reject(new Error("The TV field changed. Select a field on the TV again."));
      if (text.length > focused.maxLength || submit && !focused.submit) return Promise.reject(new Error(`Use at most ${focused.maxLength} characters for ${focused.label}.`));
      return new Promise<void>((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const finish = (error?: string) => { clearTimeout(timer); requests.delete(requestId); if (error) reject(new Error(error)); else resolve(); };
        const timer = setTimeout(() => finish("No reply from the TV. Check its field before retrying."), 3000);
        requests.set(requestId, { socket, finish });
        try { send(socket, { type: "text", requestId, token, text, submit }); } catch { finish("The TV disconnected. Try again when it reconnects."); }
      });
    },
    close(socket?: Socket) {
      if (socket) fields.delete(socket); else fields.clear();
      for (const request of [...requests.values()]) if (!socket || request.socket === socket) request.finish("The TV disconnected. Select its field again after reconnecting.");
      changed();
    },
  };
}

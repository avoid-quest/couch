import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type ApiCredentials } from "@/api/client";
import { Button } from "@/components/ui/button";
import type { DisplayState } from "../../../../shared/display";

export function DisplaySettings({ credentials, connected }: { credentials: ApiCredentials; connected: boolean }) {
  const queryClient = useQueryClient();
  const queryKey = ["display", credentials.origin, credentials.token];
  const display = useQuery({
    queryKey,
    enabled: connected,
    queryFn: ({ signal }) => apiFetch(credentials, "/api/display", { signal }).then(response => response.json() as Promise<DisplayState>),
    refetchInterval: 1_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const changeMutation = useMutation({
    mutationFn: ({ op, body }: { op: string; body: unknown }) => apiFetch(credentials, `/api/display/${op}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(response => response.json() as Promise<DisplayState>),
    onSuccess: result => {
      queryClient.setQueryData(queryKey, result);
    },
  });
  const state = display.data;
  const pending = changeMutation.isPending;
  const error = changeMutation.error instanceof Error ? changeMutation.error.message : changeMutation.error ? "Display change failed." : null;
  const [now, setNow] = useState(Date.now());
  const readError = display.error instanceof Error ? display.error.message : display.error ? "Cannot read displays." : null;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  function change(op: string, body: unknown) {
    if (!connected || pending) return;
    changeMutation.mutate({ op, body });
  }
  return <section className="space-y-4">
    <h3>TV screen</h3>
    <p>Move Couch to a connected physical screen. Confirm the picture within 20 seconds or the TV restores the previous usable screen.</p>
    {(error || readError) && <p role="alert">{error || readError}</p>}
    {!connected && <p>Reconnect to read the TV's displays.</p>}
    {state?.notice && <p role="status">{state.notice}</p>}
    {state?.preview && <div role="status" className="space-y-2"><p>Confirm the picture: {Math.max(0, Math.ceil((state.preview.expiresAt - now) / 1_000))} seconds remaining.</p><Button disabled={pending || !connected} onClick={() => change("confirm", { token: state.preview!.token })}>Keep this screen</Button> <Button disabled={pending || !connected} onClick={() => change("cancel", { token: state.preview!.token })}>Restore previous screen</Button></div>}
    {state?.outputs.map(output => <div key={output.id} className="space-y-2"><p>{output.name} {state.current === output.id ? "· Couch is here" : ""} {state.saved === output.id ? "· Saved" : ""}</p><p>{!output.connected ? "Disconnected" : !output.width ? "Connected, disabled by the desktop session" : `${output.width} × ${output.height} · ${output.refresh === null ? "Refresh rate unavailable" : `${output.refresh} Hz`}`}</p><Button disabled={!connected || pending || !!state.preview || !output.connected || !output.width} onClick={() => change("preview", { output: output.id })}>Preview on {output.name}</Button></div>)}
    <p>The laptop panel stays available for recovery. If the saved screen disappears, Couch uses the panel or the first enabled output and retains the saved choice. This does not change resolution, refresh rate or desktop primary output.</p>
  </section>;
}

import { playbackStatus } from "@/playback-status";
import { MediaContext } from "@/components/MediaContext";
import { ContentLink } from "@/components/ContentLink";
import { queueItemLocation } from "@/detail-navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { devicesQuery } from "@/api/devices";
import { knownTvs } from "@/known-tvs";
import { Link } from "@tanstack/react-router";
import { useSessionGate } from "@/session/session-context";
import { useShell } from "@/sections/shell/AppShell";
import { RemotePad } from "@/components/RemotePad";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { PlaybackTimeline, PlaybackTransport, PlaybackVolume } from "@/components/PlaybackTransport";
import type { Action } from "../../../shared/protocol";
import type { RemoteTextField } from "../../../shared/remote";

export function RemotePage() {
  const { state, connected, tvPresentation, credentials, run, error, setError } = useSessionGate();
  const shell = useShell();
  const known = knownTvs(state?.devices);
  const tvs = state?.devices?.filter(device => known.has(device.id)) ?? [];
  // With every TV off, the one seen last.
  const seen = useQuery({ ...devicesQuery(credentials ?? { origin: "", token: "" }), enabled: connected && !!credentials && tvs.length > 1 && !tvs.some(tv => tv.online) });
  const lastSeen = (id: string) => seen.data?.find(device => device.id === id)?.lastSeenAt ?? 0;
  const [chosen, setChosen] = useState<string | null>(null);
  const targetId = chosen ?? tvs.find(tv => tv.id === state?.controlling)?.id ?? tvs.find(tv => tv.online)?.id ?? [...tvs].sort((a, b) => lastSeen(b.id) - lastSeen(a.id))[0]?.id;
  const target = tvs.find(tv => tv.id === targetId);
  const allowed = !!target && (target.sharing?.audio === true || target.sharing?.video === true);
  const [binding, setBinding] = useState<string | null>(null);
  useEffect(() => {
    if (!targetId || !connected || !target?.online || !allowed || tvPresentation) { setBinding(null); return; }
    let current = true;
    setBinding(null);
    void run({ type: "control", deviceId: targetId }).then(ok => { if (current && ok) { setChosen(targetId); setBinding(targetId); } });
    return () => { current = false; };
  }, [targetId, connected, target?.online, allowed, credentials?.origin, credentials?.token, tvPresentation, run]);
  useEffect(() => () => setError(null), [setError]);
  const ready = connected && allowed && !!target?.online && binding === targetId && state?.controlling === targetId;
  const send = (action: Action) => ready && targetId ? run(action, targetId) : Promise.resolve(false);
  const current = ready ? state?.queue.find(entry => entry.id === state.currentEntryId) : undefined;
  const status = playbackStatus(state, ready);
  const volumeState = state && target ? { ...state, outputs: [{ deviceId: target.id, sound: true, picture: false }], systemAudio: undefined, player: { ...state.player, volume: target.volume } } : null;
  if (tvPresentation) return <><PageHeader title="Remote" hidden /><p>Open Remote on a paired phone or computer to control this TV.</p></>;
  // Laid out like the remote it stands in for: the TV, the pad, what plays, then text.
  return <div data-remote-page className="mx-auto grid w-full max-w-sm gap-8">
    {/* The current tab names the page, as Home's and Discover's do. */}
    <PageHeader title="Remote" hidden />
    <div className="grid gap-1">
      {tvs.length > 1 ? <Select value={targetId} onValueChange={value => { setBinding(null); setError(null); setChosen(value); }} disabled={!connected}>
        <SelectTrigger aria-label="TV to control" className="min-h-11 w-full"><SelectValue placeholder="Choose a TV" /></SelectTrigger>
        <SelectContent>{tvs.map(tv => <SelectItem key={tv.id} value={tv.id} className="min-h-11" disabled={!tv.online || !(tv.sharing?.audio || tv.sharing?.video)}>{tv.name}{!tv.online ? " · Off" : !(tv.sharing?.audio || tv.sharing?.video) ? " · Private" : ""}</SelectItem>)}</SelectContent>
      </Select> : <p className="min-w-0 break-words text-lg font-medium">{target?.name ?? "No TV connected"}</p>}
      <p className="text-sm text-muted-foreground" role="status">{!target ? "Pair a TV with this Couch to use Remote." : !connected ? "Reconnecting to Couch…" : !target.online ? `${target.name} is off.` : !allowed ? `${target.name} is private. Enable its sharing to control it.` : !ready ? "Selecting TV…" : "Connected"}</p>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
    {target && <>
      <RemotePad connected={ready} onNavigate={key => send({ type: "navigate", deviceId: target.id, key })} />
      <section className="grid gap-4 border-t pt-6 [&_[data-slot=slider]]:min-h-11" aria-label={`Playback on ${target.name}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><h2 className="truncate text-base font-medium">{current ? <ContentLink href={queueItemLocation(current)} className="no-underline hover:underline">{current.title}</ContentLink> : ready ? "Nothing playing" : `Playback on ${target.name}`}</h2>{current && !status.quiet && <p className="text-sm text-muted-foreground">{status.label}</p>}</div>
          <Button variant="ghost" className="-mr-2.5 min-h-11" aria-label="Up next" disabled={!ready || !state?.queue.length} onClick={() => shell.openPlayer("queue", targetId)}>Up next</Button>
        </div>
        {current && <MediaContext creator={current.creator} collection={current.collection} radio={current.source.startsWith("radio:") ? {id: current.source.slice(6), title: current.title} : undefined} />}
        {state && credentials && <>
          <PlaybackTransport state={state} connected={ready} run={send} />
          {current && <PlaybackTimeline state={state} connected={ready} run={send} />}
        </>}
        {volumeState && <PlaybackVolume state={volumeState} connected={ready && target.sharing?.audio === true} run={action => send(action.type === "volume" || action.type === "mute" ? { ...action, deviceId: target.id } : action)} />}
      </section>
      <RemoteText key={target.id} field={ready ? state?.textField ?? null : null} connected={ready} send={(token, text, submit) => send({ type: "text", deviceId: target.id, token, text, submit })} />
    </>}
    {!target && <Button variant="outline" className="justify-self-start" asChild><Link to="/settings/couch/devices">Open Devices</Link></Button>}
  </div>;
}

function RemoteText({ field, connected, send }: { field: RemoteTextField | null; connected: boolean; send: (token: string, text: string, submit: boolean) => Promise<boolean> }) {
  const [draft, setDraft] = useState("");
  const [seen, setSeen] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [dirty, setDirty] = useState(false);
  const lastField = useRef(field);
  const reconnectingDraft = useRef(false);
  const currentToken = useRef(field?.token);
  currentToken.current = field?.token;
  if (!connected && lastField.current) reconnectingDraft.current = true;
  if (field && seen !== field.token) {
    setSeen(field.token);
    if (!(reconnectingDraft.current && dirty && lastField.current?.kind === field.kind)) { setDraft(field.value); setDirty(false); }
    reconnectingDraft.current = false;
    setSent(false);
  }
  if (field) lastField.current = field;
  const submit = async (enter: boolean, text = draft) => {
    if (!connected || !field || pending) return;
    const token = field.token;
    setPending(true); setSent(false);
    try { if (await send(token, text, enter) && currentToken.current === token) { setDraft(text); setDirty(false); setSent(true); } }
    finally { setPending(false); }
  };
  const disabled = !connected || !field || pending;
  return <section className="grid gap-2 border-t pt-6" aria-label="Type on TV">
    <label htmlFor="remote-text" className="text-base font-medium">{field ? `Type in ${field.label}` : "Type on TV"}</label>
    <InputGroup className="min-h-11">
      <InputGroupInput id="remote-text" value={draft} maxLength={field?.maxLength ?? 4096} disabled={disabled} onChange={event => { setDraft(event.target.value); setDirty(true); setSent(false); }} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(false); } }} autoComplete="off" />
      <InputGroupAddon align="inline-end"><InputGroupButton className="min-h-11 min-w-11" disabled={disabled} onClick={() => void submit(false)}>Send</InputGroupButton></InputGroupAddon>
    </InputGroup>
    <div className="flex gap-2"><Button variant="ghost" className="min-h-11" disabled={disabled || !draft} onClick={() => void submit(false, "")}>Clear</Button><Button variant="outline" className="min-h-11" disabled={disabled || !field?.submit} onClick={() => void submit(true)}>Enter on TV</Button></div>
    <p className="text-sm text-muted-foreground" role="status">{!field ? "Select a field on the TV first. Search and Device name accept text." : field.kind === "device-name" ? "Send replaces the name. Choose Save on the TV or Enter on TV to save it." : "Send replaces the field. Enter on TV searches or opens the link."}{field && sent && " Sent."}</p>
  </section>;
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, CircleDot, Play } from "lucide-react";
import type { GuideChannel, GuideProgram } from "../../../shared/iptv";
import type { Action } from "../../../shared/protocol";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Credentials } from "../../session/session";
import { apiFetch } from "../../api/client";

const time = (value: number) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const range = (program: GuideProgram) => `${time(program.start)} – ${time(program.end)}`;

type Recordings = { page: { configured: boolean; revision?: number } | null; request: (path: string, init?: RequestInit) => Promise<Response>; reload: () => void };

// The dialog owns one selected channel's schedule and recording action.
export function GuideProgramDialog({ credentials, connected, canPlay, channel, recordings, onEnqueue, onClose, returnFocus }: {
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  channel: GuideChannel;
  recordings: Recordings;
  onEnqueue: (channel: GuideChannel, playNow: boolean) => Promise<boolean>;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const queryClient = useQueryClient();
  const [day, setDay] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + day);
  const start = date.getTime(), end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  const { data, isPending: loading, error } = useQuery({
    queryKey: ["iptv", "programs", channel.id, start, end],
    enabled: connected,
    queryFn: () => apiFetch(credentials, `/api/iptv/channels/${channel.id}/programs?start=${start}&end=${end}`).then(r => r.json() as Promise<{ programs: GuideProgram[]; truncated: boolean }>),
  });
  useEffect(() => () => setNotice(""), []);

  const record = async (program: GuideProgram) => {
    setPending(program.id); setNotice("");
    try {
      const response = await recordings.request("schedule", { method: "POST", body: JSON.stringify({ revision: recordings.page?.revision, programId: program.id, start: program.start, end: program.end, title: program.title }) });
      const value = await response.json();
      setNotice(value.existing ? `${value.job.title} already has a recording job. Open Recordings to see its state.` : `${value.job.title} was submitted. Open Recordings to follow its backend state.`);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Could not schedule this programme."); }
    finally { setPending(null); void queryClient.invalidateQueries({ queryKey: ["recordings"] }); }
  };

  const programs = data?.programs ?? [];
  return <Dialog open onOpenChange={open => { if (!open) { onClose(); returnFocus(); } }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{channel.name} programs</DialogTitle><DialogDescription>Times in {Intl.DateTimeFormat().resolvedOptions().timeZone}. Play starts the live channel. Record schedules a future programme on the configured recording backend.</DialogDescription></DialogHeader>
      <div className="guide-day flex items-center justify-between gap-2">
        <Button variant="outline" size="icon" aria-label="Previous day" disabled={day <= -1} onClick={() => setDay(value => value - 1)}><ChevronLeft /></Button>
        <h3 className="font-medium">{date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</h3>
        <Button variant="outline" size="icon" aria-label="Next day" disabled={day >= 6} onClick={() => setDay(value => value + 1)}><ChevronRight /></Button>
      </div>
      <Button disabled={!connected || !canPlay} onClick={() => void onEnqueue(channel, true)}><Play />Play {channel.name} live</Button>
      {error && <Alert variant="destructive"><AlertDescription>{error instanceof Error ? error.message : "Could not load programs."}</AlertDescription></Alert>}
      <ol className="guide-program-list grid">
        {programs.map(program => <li key={program.id} className="grid gap-1.5 border-b py-3.5 [overflow-wrap:anywhere]" data-program-id={program.id}>
          <time className="text-sm text-muted-foreground">{range(program)}</time>
          <h3 className="flex flex-wrap items-center gap-2 font-medium">{program.title}{program.start <= Date.now() && program.end > Date.now() && <Badge variant="secondary">Now</Badge>}</h3>
          {program.description && <p className="text-sm text-muted-foreground">{program.description}</p>}
          {program.start > Date.now() && <Button variant="outline" disabled={!connected || !!pending || !recordings.page?.configured} onClick={() => void record(program)}><CircleDot aria-hidden="true" />{pending === program.id ? "Submitting…" : "Record programme"}</Button>}
        </li>)}
      </ol>
      {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
      {!loading && !programs.length && <p className="text-sm text-muted-foreground">No cached programs for this day.</p>}
      {data?.truncated && <p className="text-sm text-muted-foreground">Showing the first 500 programs for this day.</p>}
    </DialogContent>
  </Dialog>;
}

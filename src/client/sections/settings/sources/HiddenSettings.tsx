import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addHidden, hiddenQuery, removeHidden } from "@/api/hidden";
import { providerNames, type ProviderId } from "../../../../shared/providers";
import type { HiddenRule } from "../../../../shared/hidden";
import type { SourceSettingsProps } from "@/components/sourceTypes";

const kindOf = (rule: HiddenRule) => rule.kind === "word" ? "Word" : providerNames[rule.value.split(":", 1)[0] as ProviderId] ?? "Item";

/** What the Couch keeps out of Search and source pages: items hidden from their menus, and words added here. */
export function HiddenSettings({ credentials, connected }: Pick<SourceSettingsProps, "credentials" | "connected">) {
  const client = useQueryClient();
  const available = connected && !!credentials;
  const query = hiddenQuery(credentials ?? { origin: "", token: "" });
  const rules = useQuery({ ...query, enabled: available });
  const [word, setWord] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: query.queryKey });
  const add = useMutation({ mutationFn: (value: string) => addHidden(credentials!, { kind: "word", value, label: value }), onSuccess: () => { setWord(""); return refresh(); } });
  const remove = useMutation({ mutationFn: (id: string) => removeHidden(credentials!, id), onSettled: refresh });
  const pending = add.isPending || remove.isPending;
  const error = add.error?.message || remove.error?.message || (rules.error ? "Couldn't load what's hidden." : "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (available && word.trim() && !pending) add.mutate(word.trim());
  }

  return <SettingsSection title="Hidden" description="Kept out of Search and source pages on every device. Hide an item from its menu, or a word in titles here.">
    <SettingsRow label="Hide a word" htmlFor="hidden-word">
      <form className="flex w-full flex-wrap items-center gap-2" onSubmit={submit}>
        <Input id="hidden-word" className="min-w-0 flex-1" placeholder="Fiorello" autoComplete="off" maxLength={100} value={word} onChange={event => setWord(event.target.value)} disabled={!available || pending} />
        <Button type="submit" variant="outline" disabled={!available || pending || !word.trim()}>Add</Button>
      </form>
    </SettingsRow>
    {rules.data?.rules.map(rule => <SettingsRow key={rule.id} label={rule.label} description={kindOf(rule)}>
      <Button variant="ghost" aria-label={`Remove ${rule.label}`} disabled={!available || pending} onClick={() => remove.mutate(rule.id)}>Remove</Button>
    </SettingsRow>)}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription>{rules.error && <AlertAction><Button variant="outline" size="sm" disabled={!available} onClick={() => void rules.refetch()}>Try again</Button></AlertAction>}</Alert>}
  </SettingsSection>;
}

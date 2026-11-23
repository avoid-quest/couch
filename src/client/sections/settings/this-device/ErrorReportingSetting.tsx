import { useMutation } from "@tanstack/react-query";
import { SettingsRow } from "@/components/SettingsRow";
import { Switch } from "@/components/ui/switch";
import { canSetReporting, saveReporting, useErrorReporting } from "@/error-reporting";

export function ErrorReportingSetting() {
  const enabled = useErrorReporting();
  const saving = useMutation({ mutationFn: saveReporting });
  if (!canSetReporting) return null;
  return (
    <SettingsRow
      label="Send error reports"
      htmlFor="error-reporting"
      description="Share error messages, stack traces, Couch version, system details, performance timings and startup logs with Sentry in Germany. Error text can contain private details. Sentry sees the sending IP address."
    >
      <Switch
        id="error-reporting"
        checked={enabled}
        onCheckedChange={(value) => saving.mutate(value)}
        disabled={saving.isPending}
      />
      {saving.error && <span role="alert">{saving.error.message}</span>}
    </SettingsRow>
  );
}

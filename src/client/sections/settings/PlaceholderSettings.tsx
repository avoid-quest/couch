export function PlaceholderSettings({ page }: { page: string }) {
  return (
    <section aria-label={`${page} settings`} className="rounded-lg border border-dashed p-6 text-muted-foreground">
      <p>Coming soon.</p>
    </section>
  );
}

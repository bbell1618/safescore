export default function PortalComplianceLoading() {
  return (
    <div
      aria-label="Loading compliance workspace"
      className="space-y-6 motion-safe:animate-pulse"
      role="status"
    >
      <header className="space-y-2">
        <div className="h-3 w-36 rounded bg-sand" />
        <div className="h-9 w-48 rounded bg-sand" />
        <div className="h-4 w-full max-w-md rounded bg-sand" />
      </header>
      <section className="rounded-xl border border-sand bg-warm-white px-6 py-12 text-center shadow-sm">
        <div className="mx-auto h-11 w-11 rounded-full bg-sand" />
        <div className="mx-auto mt-4 h-6 w-80 max-w-full rounded bg-sand" />
        <div className="mx-auto mt-3 h-4 w-full max-w-lg rounded bg-cream" />
        <div className="mx-auto mt-2 h-4 w-4/5 max-w-md rounded bg-cream" />
      </section>
      <span className="sr-only">Loading compliance workspace…</span>
    </div>
  );
}

function Bone({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-sand ${className}`} />;
}

export default function SentReportPrintLoading() {
  return (
    <main
      className="min-h-screen bg-cream px-4 py-6"
      role="status"
      aria-label="Loading sent report"
    >
      <div className="mx-auto mb-4 flex max-w-4xl items-center justify-between gap-4">
        <Bone className="h-5 w-40" />
        <Bone className="h-10 w-44" />
      </div>
      <article className="mx-auto min-h-screen max-w-4xl bg-warm-white p-10 shadow-sm sm:p-12">
        <header className="mb-8 flex items-start justify-between gap-6 border-b-2 border-sand pb-5">
          <div className="space-y-2">
            <Bone className="h-3 w-36" />
            <Bone className="h-4 w-48" />
            <Bone className="h-3 w-28" />
          </div>
          <div className="space-y-2">
            <Bone className="ml-auto h-3 w-24" />
            <Bone className="h-3 w-32" />
          </div>
        </header>
        <div className="space-y-6">
          <Bone className="h-9 w-3/5" />
          <Bone className="h-4 w-44" />
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="space-y-2">
              <Bone className="h-4 w-full" />
              <Bone className="h-4 w-5/6" />
            </div>
          ))}
        </div>
      </article>
      <span className="sr-only">Loading sent report…</span>
    </main>
  );
}

type Shape = "today" | "table" | "profile" | "work" | "plan" | "account" | "form" | "case" | "report";
function Line({ className = "w-2/3" }: { className?: string }) {
  return <div className={`h-4 rounded bg-sand motion-safe:animate-pulse ${className}`} />;
}
function Rows({ count = 5 }: { count?: number }) {
  return <div className="divide-y divide-sand rounded-xl border border-sand bg-warm-white">{Array.from({ length: count }, (_, i) => <div key={i} className="flex items-center gap-5 p-5"><Line className="w-5" /><Line className="w-1/2" /><Line className="ml-auto w-20" /></div>)}</div>;
}
function Cards() {
  return <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map(i => <div key={i} className="space-y-6 rounded-xl border border-sand bg-warm-white p-6"><Line className="w-32" /><Line /><Line className="w-1/2" /></div>)}</div>;
}
export function ConsolePageSkeleton({ shape = "table" }: { shape?: Shape }) {
  return <div role="status" aria-label="Loading page" className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
    {shape === "today" ? <div className="portal-navy-texture rounded-2xl p-8"><div className="h-4 w-56 rounded bg-warm-white/20" /><div className="mt-4 h-14 w-40 rounded bg-warm-white/20" /><div className="mt-6 flex gap-3">{[0, 1, 2].map(i => <div key={i} className="h-14 w-40 rounded-lg bg-amber/20" />)}</div></div> : <div className="space-y-3 py-3"><Line className="h-8 w-56" /><Line className="w-80 max-w-full" /></div>}
    {shape === "today" ? <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]"><div className="space-y-8"><Rows /><Rows count={3} /><Rows count={2} /></div><div className="space-y-6"><Cards /><Rows count={8} /></div></div> :
      shape === "form" ? <div className="space-y-5 rounded-xl border border-sand bg-cream p-5"><Line /><div className="h-11 rounded border border-sand bg-warm-white" /></div> :
      shape === "account" || shape === "profile" ? <><Cards /><Rows count={4} /><Cards /></> :
      shape === "work" || shape === "plan" ? <><Rows /><Rows count={3} /><Cards /></> :
      shape === "case" || shape === "report" ? <><Cards /><div className="h-80 rounded-xl border border-sand bg-warm-white" /><Rows count={3} /></> : <><Cards /><Rows count={7} /></>}
    <span className="sr-only">Loading SafeScore…</span>
  </div>;
}

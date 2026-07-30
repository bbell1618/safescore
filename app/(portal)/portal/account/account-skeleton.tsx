import {
  PortalFooterBand,
  PortalHeroBand,
  PortalPageBody,
  PortalSectionDivider,
} from "@/components/portal/brand";
import { GoldenEraTruckLoader } from "@/components/portal/truck-loader";

function Bone({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-md bg-sand motion-safe:animate-pulse ${className}`}
    />
  );
}

function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <section className="rounded-xl border border-sand bg-warm-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <Bone className="h-10 w-10 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Bone className="h-6 w-40" />
          <Bone className="h-4 w-full max-w-sm" />
        </div>
      </div>
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        {Array.from({ length: rows }, (_, index) => (
          <div className="space-y-2" key={index}>
            <Bone className="h-3 w-24" />
            <Bone className="h-5 w-full max-w-48" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function AccountCardsSkeleton() {
  return (
    <div
      aria-label="Loading account details"
      className="space-y-8"
      role="status"
    >
      <GoldenEraTruckLoader compact className="mx-auto" />
      <div className="grid gap-6 lg:grid-cols-2">
        <CardSkeleton rows={5} />
        <CardSkeleton rows={4} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <CardSkeleton rows={4} />
        <CardSkeleton rows={2} />
      </div>
      <span className="sr-only">Loading account details…</span>
    </div>
  );
}

export function PortalAccountSkeleton() {
  return (
    <div
      aria-label="Loading account"
      className="overflow-hidden"
      role="status"
    >
      <PortalHeroBand
        eyebrow={
          <span
            aria-hidden="true"
            className="block h-3 w-24 rounded bg-gold/30"
          />
        }
        title={
          <span
            aria-hidden="true"
            className="block h-12 w-full max-w-lg rounded bg-warm-white/15"
          />
        }
        description={
          <span
            aria-hidden="true"
            className="block h-4 w-full max-w-2xl rounded bg-warm-white/10"
          />
        }
        contentClassName="max-w-5xl"
      >
        <GoldenEraTruckLoader className="mt-6" />
      </PortalHeroBand>
      <PortalSectionDivider transition="navy-to-warm" />
      <PortalPageBody contentClassName="max-w-5xl">
        <AccountCardsSkeleton />
      </PortalPageBody>
      <PortalSectionDivider transition="warm-to-navy" />
      <PortalFooterBand contentClassName="max-w-5xl">
        <div className="space-y-2">
          <span
            aria-hidden="true"
            className="block h-5 w-48 rounded bg-warm-white/15"
          />
          <span
            aria-hidden="true"
            className="block h-3 w-56 rounded bg-warm-white/10"
          />
        </div>
        <span
          aria-hidden="true"
          className="block h-4 w-52 rounded bg-warm-white/10"
        />
      </PortalFooterBand>
      <span className="sr-only">Loading account…</span>
    </div>
  );
}

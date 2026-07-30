import { PortalSectionDivider } from "@/components/portal/brand";
import { GoldenEraTruckLoader } from "@/components/portal/truck-loader";
import { cn } from "@/lib/utils";
import type { CSSProperties, ReactNode } from "react";

type PortalSkeletonVariant =
  | "home"
  | "playbook"
  | "activity"
  | "documents"
  | "account"
  | "list"
  | "onboarding";

function Bone({
  className,
  style,
  dark = false,
}: {
  className?: string;
  style?: CSSProperties;
  dark?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-md motion-safe:animate-pulse",
        dark ? "bg-warm-white/15" : "bg-sand",
        className
      )}
      style={style}
    />
  );
}

function Surface({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-sand bg-warm-white p-5 shadow-sm",
        className
      )}
    >
      {children}
    </section>
  );
}

function HeadingHeroSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className={cn("space-y-3", wide ? "max-w-3xl" : "max-w-2xl")}>
      <Bone dark className="h-3 w-28" />
      <Bone dark className={cn("h-11", wide ? "w-80" : "w-56")} />
      <Bone dark className="h-4 w-full" />
      <Bone dark className="h-4 w-4/5" />
    </div>
  );
}

function FooterSkeleton() {
  return (
    <footer className="portal-navy-texture">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-6">
        <div className="space-y-2">
          <Bone dark className="h-5 w-52" />
          <Bone dark className="h-3 w-36" />
        </div>
        <Bone dark className="h-7 w-28 rounded-full" />
      </div>
    </footer>
  );
}

function BrandFrame({
  hero,
  children,
  narrow = false,
  bodyClassName,
}: {
  hero: ReactNode;
  children: ReactNode;
  narrow?: boolean;
  bodyClassName?: string;
}) {
  return (
    <div className="portal-warm-texture min-h-[calc(100vh-4rem)] overflow-hidden">
      <section className="portal-navy-texture shadow-[var(--shadow-md)]">
        <div
          className={cn(
            "mx-auto w-full px-4 py-12 sm:px-6 sm:py-14 lg:py-16",
            narrow ? "max-w-5xl" : "max-w-7xl"
          )}
        >
          <GoldenEraTruckLoader className="mb-6" />
          {hero}
        </div>
      </section>
      <PortalSectionDivider transition="navy-to-warm" />
      <div
        className={cn(
          "mx-auto w-full space-y-6 px-4 py-8 sm:px-6 lg:py-10",
          narrow ? "max-w-5xl" : "max-w-7xl",
          bodyClassName
        )}
      >
        {children}
      </div>
      <PortalSectionDivider transition="warm-to-navy" />
      <FooterSkeleton />
    </div>
  );
}

function HomeSkeleton() {
  return (
    <BrandFrame
      bodyClassName="pt-8 pb-10 sm:pt-10 lg:pb-12"
      hero={
        <div className="grid min-h-56 gap-8 lg:grid-cols-2">
          <div className="space-y-5">
            <Bone dark className="h-3 w-28" />
            <Bone dark className="h-20 w-40 rounded-lg" />
            <Bone dark className="h-7 w-44 rounded-full" />
            <div className="space-y-2">
              <Bone dark className="h-4 w-full max-w-xl" />
              <Bone dark className="h-4 w-5/6 max-w-lg" />
            </div>
          </div>
          <div className="flex min-h-44 items-end gap-2 rounded-lg border border-warm-white/10 bg-warm-white/5 p-5">
            {[40, 55, 48, 68, 58, 72, 64, 82].map((height, index) => (
              <Bone
                dark
                key={`${height}-${index}`}
                className="min-w-0 flex-1 bg-amber/25"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>
      }
    >
      <Surface className="space-y-5">
        <div className="flex items-center justify-between">
          <Bone className="h-6 w-52" />
          <Bone className="h-4 w-32" />
        </div>
        <div className="space-y-4">
          {[72, 60, 48, 42, 34, 28, 20].map((width, index) => (
            <div
              key={`${width}-${index}`}
              className="grid grid-cols-[7rem_1fr_4rem] items-center gap-4"
            >
              <Bone className="h-4 w-full" />
              <div className="h-2.5 overflow-hidden rounded-full bg-cream">
                <div
                  className="h-full rounded-full bg-sand"
                  style={{ width: `${width}%` }}
                />
              </div>
              <Bone className="h-4 w-full" />
            </div>
          ))}
        </div>
      </Surface>
      <div className="grid gap-6 lg:grid-cols-2">
        <Surface className="space-y-4">
          <Bone className="h-6 w-52" />
          {[0, 1, 2].map((row) => (
            <Bone className="h-16 w-full" key={row} />
          ))}
        </Surface>
        <Surface className="space-y-4">
          <Bone className="h-6 w-44" />
          <Bone className="h-4 w-full" />
          <Bone className="h-4 w-11/12" />
          <Bone className="h-4 w-4/5" />
        </Surface>
      </div>
    </BrandFrame>
  );
}

function ActivitySkeleton() {
  return (
    <BrandFrame
      bodyClassName="py-12 sm:py-16 lg:py-16"
      hero={<HeadingHeroSkeleton />}
    >
      <Surface className="space-y-5">
        <div className="flex items-center justify-between">
          <Bone className="h-6 w-40" />
          <Bone className="h-4 w-28" />
        </div>
        <Bone className="h-60 w-full rounded-lg" />
      </Surface>
      {[0, 1].map((section) => (
        <Surface className="space-y-4" key={section}>
          <Bone className="h-6 w-36" />
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-4 border-t border-sand pt-4 first:border-0 first:pt-0"
            >
              <div className="flex-1 space-y-2">
                <Bone className="h-4 w-3/5" />
                <Bone className="h-3 w-2/5" />
              </div>
              <Bone className="h-6 w-24 rounded-full" />
            </div>
          ))}
        </Surface>
      ))}
    </BrandFrame>
  );
}

function PlaybookSkeleton() {
  return (
    <BrandFrame
      bodyClassName="py-12 sm:py-16 lg:py-16"
      hero={<HeadingHeroSkeleton wide />}
    >
      <Surface className="space-y-4">
        <Bone className="h-6 w-52" />
        <Bone className="h-4 w-full" />
        <Bone className="h-4 w-5/6" />
      </Surface>
      {[0, 1].map((card) => (
        <Surface key={card} className="overflow-hidden p-0">
          <div className="border-b border-sand bg-cream p-6">
            <div className="flex flex-col justify-between gap-5 xl:flex-row">
              <div className="space-y-3">
                <Bone className="h-3 w-20" />
                <Bone className="h-7 w-48" />
                <Bone className="h-4 w-full max-w-2xl" />
              </div>
              <div className="grid shrink-0 grid-cols-3 gap-3">
                {[0, 1, 2].map((metric) => (
                  <Bone className="h-16 w-20" key={metric} />
                ))}
              </div>
            </div>
          </div>
          <div className="grid gap-6 p-6 lg:grid-cols-2">
            {[0, 1].map((column) => (
              <div className="space-y-3" key={column}>
                <Bone className="h-5 w-36" />
                <Bone className="h-4 w-full" />
                <Bone className="h-4 w-5/6" />
                <Bone className="h-24 w-full" />
              </div>
            ))}
          </div>
        </Surface>
      ))}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <Surface key={card} className="space-y-4">
            <Bone className="h-10 w-10" />
            <Bone className="h-5 w-36" />
            <Bone className="h-4 w-full" />
            <Bone className="h-4 w-4/5" />
          </Surface>
        ))}
      </div>
    </BrandFrame>
  );
}

function DocumentsSkeleton() {
  return (
    <BrandFrame
      bodyClassName="py-10 lg:py-12"
      hero={<HeadingHeroSkeleton />}
    >
      {[0, 1, 2].map((section) => (
        <Surface key={section} className="space-y-4">
          <div className="space-y-2">
            <Bone className="h-6 w-48" />
            <Bone className="h-4 w-full max-w-lg" />
          </div>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex items-center gap-4 rounded-lg border border-sand bg-cream p-4"
            >
              <Bone className="h-10 w-10 shrink-0" />
              <div className="flex-1 space-y-2">
                <Bone className="h-4 w-2/5" />
                <Bone className="h-3 w-1/4" />
              </div>
              <Bone className="h-8 w-24" />
            </div>
          ))}
        </Surface>
      ))}
    </BrandFrame>
  );
}

function AccountSkeleton() {
  return (
    <BrandFrame hero={<HeadingHeroSkeleton wide />} narrow>
      {[0, 1, 2, 3].map((card) => (
        <Surface key={card} className="space-y-4">
          <Bone className="h-6 w-44" />
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((column) => (
              <div className="space-y-2" key={column}>
                <Bone className="h-3 w-24" />
                <Bone className="h-5 w-40" />
              </div>
            ))}
          </div>
        </Surface>
      ))}
    </BrandFrame>
  );
}

function ListSkeleton() {
  return (
    <BrandFrame hero={<HeadingHeroSkeleton />}>
      <Surface className="space-y-4">
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="flex items-center justify-between gap-4 border-t border-sand pt-4 first:border-0 first:pt-0"
          >
            <div className="flex-1 space-y-2">
              <Bone className="h-4 w-1/2" />
              <Bone className="h-3 w-3/4" />
            </div>
            <Bone className="h-7 w-24 rounded-full" />
          </div>
        ))}
      </Surface>
    </BrandFrame>
  );
}

function OnboardingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <Surface className="space-y-6 p-6 sm:p-8">
        <div className="space-y-3 text-center">
          <Bone className="mx-auto h-10 w-10 rounded-full" />
          <Bone className="mx-auto h-7 w-56" />
          <Bone className="mx-auto h-4 w-full max-w-md" />
        </div>
        <div className="space-y-4">
          {[0, 1, 2].map((row) => (
            <Bone className="h-12 w-full" key={row} />
          ))}
        </div>
        <Bone className="h-10 w-full" />
      </Surface>
    </div>
  );
}

export function PortalRouteSkeleton({
  variant = "list",
}: {
  variant?: PortalSkeletonVariant;
}) {
  return (
    <div
      role="status"
      aria-label="Loading portal content"
    >
      {variant === "home" ? <HomeSkeleton /> : null}
      {variant === "playbook" ? <PlaybookSkeleton /> : null}
      {variant === "activity" ? <ActivitySkeleton /> : null}
      {variant === "documents" ? <DocumentsSkeleton /> : null}
      {variant === "account" ? <AccountSkeleton /> : null}
      {variant === "list" ? <ListSkeleton /> : null}
      {variant === "onboarding" ? <OnboardingSkeleton /> : null}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

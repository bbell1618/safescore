import { PortalLoadingScreen } from "@/components/portal/loading-screen";

/** Shown before the account layout loads: the menu bar's place, then the truck. */
export default function PortalGroupLoading() {
  return (
    <div className="portal-brand-root portal-warm-texture min-h-screen">
      <div aria-hidden="true" className="flex h-16 items-center border-b border-white/10 bg-[#0F1B2D] px-4 sm:px-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand file */}
        <img src="/brand/lockup-nav.webp" alt="" width={785} height={176} className="h-9 w-auto lg:h-10" />
      </div>
      <PortalLoadingScreen />
    </div>
  );
}

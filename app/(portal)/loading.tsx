import { PortalRouteSkeleton } from "@/components/portal/route-skeleton";

export default function PortalGroupLoading() {
  return (
    <div className="portal-brand-root portal-warm-texture min-h-screen">
      <div
        aria-hidden="true"
        className="portal-navy-texture h-16 border-b border-gold/15"
      />
      <PortalRouteSkeleton variant="list" />
    </div>
  );
}

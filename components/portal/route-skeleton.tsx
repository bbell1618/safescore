import { PortalLoadingScreen } from "@/components/portal/loading-screen";

type PortalSkeletonVariant =
  | "home"
  | "playbook"
  | "activity"
  | "documents"
  | "account"
  | "list"
  | "onboarding";

/** QF-225: every page in the carrier's account loads with the same truck screen. */
export function PortalRouteSkeleton({ variant = "list" }: { variant?: PortalSkeletonVariant }) {
  void variant;
  return <PortalLoadingScreen />;
}

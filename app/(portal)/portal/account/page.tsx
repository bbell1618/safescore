import {
  Building2,
  CalendarDays,
  CreditCard,
  Mail,
  MapPin,
  Truck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Suspense } from "react";
import {
  PortalFooterBand,
  PortalHeroBand,
  PortalPageBody,
  PortalSectionDivider,
} from "@/components/portal/brand";
import {
  AccountSourceInfo,
  CopyableAccountValue,
} from "@/components/portal/account-interactions";
import { PortalMotionSection } from "@/components/portal/motion";
import { getPortalClientPageContext } from "@/lib/portal/access";
import {
  fleetSourceLines,
  resolveAccountAddress,
} from "@/lib/portal/account";
import { loadPortalAccountData } from "@/lib/portal/account-server";
import { AccountCardsSkeleton } from "./account-skeleton";
import { isClientTier, tierDisplayLabel } from "@/lib/tiers";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value
  );
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10) return value;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function displayStatus(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function Surface({
  children,
  className,
  labelledBy,
}: {
  children: React.ReactNode;
  className?: string;
  labelledBy: string;
}) {
  return (
    <PortalMotionSection
      ariaLabelledBy={labelledBy}
      interactive
      className={cn(
        "rounded-xl border border-sand bg-warm-white p-6 shadow-sm transition-colors hover:border-amber/30",
        className
      )}
    >
      {children}
    </PortalMotionSection>
  );
}

function CardHeading({
  id,
  icon,
  title,
  description,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-subtle text-amber-dark">
        {icon}
      </span>
      <div>
        <h2
          className="text-xl font-semibold tracking-tight text-warm-dark"
          id={id}
        >
          {title}
        </h2>
        <p className="mt-1 text-sm leading-6 text-warm-mid">{description}</p>
      </div>
    </div>
  );
}

function Fact({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="mono-label text-warm-gray">{label}</dt>
      <dd
        className={cn(
          "mt-1.5 break-words text-sm font-medium text-warm-dark",
          mono && "font-mono"
        )}
      >
        {children}
      </dd>
    </div>
  );
}

function SubscriptionStatus({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const classes =
    normalized === "active" || normalized === "trialing"
      ? "bg-success-light text-success"
      : normalized === "past_due" || normalized === "canceled"
        ? "bg-error-light text-error"
        : "bg-amber-subtle text-amber-dark";

  return (
    <span
      className={cn(
        "inline-flex rounded-full px-3 py-1 font-mono text-[11px] font-semibold",
        classes
      )}
    >
      {displayStatus(status)}
    </span>
  );
}

async function AccountCards({
  accountPromise,
  context,
}: {
  accountPromise: ReturnType<typeof loadPortalAccountData>;
  context: {
    clientName: string;
    dotNumber: string;
    mcNumber: string | null;
    tier: Awaited<ReturnType<typeof getPortalClientPageContext>>["tier"];
    userId: string;
  };
}) {
  const account = await accountPromise;
  const address = resolveAccountAddress(
    {
      address: account.company.address,
      city: account.company.city,
      state: account.company.state,
      zip: account.company.zip,
    },
    account.safer
      ? {
          address: account.safer.address,
          physical_address: account.safer.physicalAddress,
          safer_as_of: account.safer.saferAsOf,
          fetched_at: account.safer.fetchedAt,
        }
      : null
  );
  const fleet = fleetSourceLines({
    powerUnits: account.safer?.powerUnits ?? null,
    fmcsaDrivers: account.safer?.drivers ?? null,
    servicePlanDrivers: account.company.servicePlanDrivers,
  });
  const sourceAsOf = formatDate(address.source?.asOf ?? null);
  const subscription = account.subscription;
  const subscriptionTier =
    subscription && isClientTier(subscription.tier)
      ? subscription.tier
      : null;
  const subscriptionNeedsReview =
    subscription !== null &&
    (subscriptionTier === null || subscriptionTier !== context.tier);
  const mcNumber = context.mcNumber?.replace(/^MC-?/i, "") ?? null;

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <Surface labelledBy="account-company-heading">
          <CardHeading
            id="account-company-heading"
            icon={<Building2 className="h-5 w-5" aria-hidden="true" />}
            title="Company information"
            description="The carrier identity connected to this SafeScore account."
          />

          <dl className="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <Fact label="Company">{context.clientName}</Fact>
            <Fact label="USDOT" mono>
              <CopyableAccountValue
                label="USDOT number"
                value={context.dotNumber}
                mono
              />
            </Fact>
            <Fact label="MC number" mono>
              {mcNumber ? (
                <CopyableAccountValue
                  label="MC number"
                  value={mcNumber}
                  mono
                />
              ) : (
                "Not recorded"
              )}
            </Fact>
            <Fact label="Phone">
              {account.company.phone ? (
                <CopyableAccountValue
                  label="phone number"
                  value={account.company.phone}
                >
                  {formatPhone(account.company.phone)}
                </CopyableAccountValue>
              ) : (
                "Not recorded"
              )}
            </Fact>
            <Fact label="Email">
              {account.company.email ? (
                <CopyableAccountValue
                  label="email address"
                  value={account.company.email}
                >
                  {account.company.email}
                </CopyableAccountValue>
              ) : (
                "Not recorded"
              )}
            </Fact>
          </dl>

          <div className="mt-6 border-t border-sand pt-5">
            <div className="flex items-start gap-3">
              <MapPin
                className="mt-0.5 h-4 w-4 shrink-0 text-warm-gray"
                aria-hidden="true"
              />
              <div>
                <p className="mono-label text-warm-gray">Address</p>
                <p className="mt-1.5 text-sm font-medium leading-6 text-warm-dark">
                  {address.value ?? "No company address is available yet."}
                </p>
                {address.source ? (
                  <AccountSourceInfo
                    className="mt-1"
                    label={`${address.source.label}${sourceAsOf ? ` · as of ${sourceAsOf}` : ""}`}
                    explanation="FMCSA SAFER is the public carrier snapshot used when your SafeScore company record does not include an address."
                  />
                ) : null}
              </div>
            </div>
          </div>
        </Surface>

        <Surface labelledBy="account-fleet-heading">
          <CardHeading
            id="account-fleet-heading"
            icon={<Truck className="h-5 w-5" aria-hidden="true" />}
            title="Fleet"
            description="Two sources are shown separately so the numbers never imply the same thing."
          />

          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-sand bg-cream p-5 shadow-sm transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-amber/30 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none">
              <p className="mono-label text-warm-gray">Public census</p>
              <p className="mt-2 font-mono text-lg font-medium leading-7 text-warm-dark">
                {fleet.fmcsa}
              </p>
              {account.safer ? (
                <AccountSourceInfo
                  className="mt-2"
                  label={`FMCSA SAFER${formatDate(account.safer.saferAsOf) ? ` · as of ${formatDate(account.safer.saferAsOf)}` : ""}`}
                  explanation="FMCSA SAFER is the public company snapshot used for power-unit and driver census figures."
                />
              ) : null}
            </div>

            <div className="rounded-lg border border-amber/25 bg-amber-subtle p-5 shadow-sm transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-amber/50 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none">
              <p className="mono-label text-amber-dark">Service plan</p>
              <p className="mt-2 font-mono text-lg font-medium leading-7 text-warm-dark">
                {fleet.servicePlan}
              </p>
            </div>
          </div>

          <p className="mt-5 border-t border-sand pt-5 text-sm leading-6 text-warm-mid">
            FMCSA census figures describe the fleet on public record. Your
            service plan uses the driver count your company gave GEIA for
            service and billing.
          </p>
        </Surface>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Surface labelledBy="account-subscription-heading">
          <CardHeading
            id="account-subscription-heading"
            icon={<CreditCard className="h-5 w-5" aria-hidden="true" />}
            title="Subscription"
            description="Your current SafeScore service and billing status."
          />

          <dl className="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <Fact label="Service plan">{tierDisplayLabel(context.tier)}</Fact>
            <Fact label="Billing status">
              {subscription ? (
                <SubscriptionStatus status={subscription.status} />
              ) : (
                "No billing record is available."
              )}
            </Fact>
            <Fact label="Billing cycle">
              {subscription?.billingCycle
                ? displayStatus(subscription.billingCycle)
                : "Not recorded"}
            </Fact>
            <Fact label="Current period ends">
              {formatDate(subscription?.currentPeriodEnd ?? null) ??
                "Not recorded"}
            </Fact>
          </dl>

          {subscriptionNeedsReview ? (
            <div className="mt-6 rounded-lg border border-error/25 bg-error-light p-4">
              <p className="text-sm font-semibold text-error">
                Your service and billing records need review
              </p>
              <p className="mt-1 text-xs leading-5 text-warm-mid">
                The two records do not show the same plan. Contact GEIA before
                relying on the billing record.
              </p>
            </div>
          ) : null}
        </Surface>

        <Surface labelledBy="account-users-heading">
          <CardHeading
            id="account-users-heading"
            icon={<UsersRound className="h-5 w-5" aria-hidden="true" />}
            title="Portal users"
            description="People who can sign in to this company’s SafeScore portal."
          />

          {account.portalUsers.length > 0 ? (
            <ul className="mt-6 divide-y divide-sand rounded-lg border border-sand bg-cream">
              {account.portalUsers.map((portalUser) => {
                const isCurrentUser = portalUser.id === context.userId;
                return (
                  <li
                    className="flex items-start gap-3 px-4 py-4 transition-colors hover:bg-warm-white focus-within:bg-warm-white"
                    key={portalUser.id}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warm-white text-warm-gray shadow-sm">
                      <UserRound className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-all text-sm font-semibold text-warm-dark">
                          {portalUser.email}
                        </p>
                        {isCurrentUser ? (
                          <span className="rounded-full bg-info-light px-2 py-0.5 font-mono text-[10px] font-semibold text-info">
                            You
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-warm-gray">
                        <CalendarDays
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        Access since {formatDate(portalUser.createdAt)}
                      </p>
                    </div>
                    <Mail
                      className="mt-1 h-4 w-4 shrink-0 text-warm-gray"
                      aria-hidden="true"
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-6 rounded-lg border border-dashed border-sand bg-cream px-5 py-8 text-center">
              <p className="font-heading text-base font-semibold text-warm-dark">
                No portal users are linked
              </p>
              <p className="mt-1 text-sm leading-6 text-warm-mid">
                Contact GEIA if someone at your company needs portal access.
              </p>
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
}

export default async function PortalAccountPage() {
  const context = await getPortalClientPageContext();
  const accountPromise = loadPortalAccountData({ clientId: context.clientId });

  return (
    <div className="overflow-hidden">
      <PortalHeroBand
        eyebrow="Your account"
        title="Company and service details"
        description="See the company facts, FMCSA fleet record, service plan, and people who can access your SafeScore portal."
        contentClassName="max-w-5xl"
      />
      <PortalSectionDivider transition="navy-to-warm" />

      <PortalPageBody contentClassName="max-w-5xl">
        <Suspense fallback={<AccountCardsSkeleton />}>
          <AccountCards
            accountPromise={accountPromise}
            context={{
              clientName: context.clientName,
              dotNumber: context.dotNumber,
              mcNumber: context.mcNumber,
              tier: context.tier,
              userId: context.userId,
            }}
          />
        </Suspense>
      </PortalPageBody>

      <PortalSectionDivider transition="warm-to-navy" />
      <PortalFooterBand contentClassName="max-w-5xl">
        <div>
          <p className="font-heading text-xl font-semibold tracking-tight text-warm-white">
            {context.clientName}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-warm-white/75">
          <span>USDOT {context.dotNumber}</span>
          <span>
            {context.mcNumber
              ? `MC ${context.mcNumber.replace(/^MC-?/i, "")}`
              : "MC not recorded"}
          </span>
        </div>
      </PortalFooterBand>
    </div>
  );
}

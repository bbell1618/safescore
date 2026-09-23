import Link from "next/link";
import { GET } from "@/app/api/operator/email-safety/route";

export const dynamic = "force-dynamic";

export default async function EmailSafetyPage() {
  const response = await GET();
  const result = await response.json();

  return (
    <section className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Email safety check</h1>
      {response.ok ? (
        <>
          <p>Production EMAIL_DRY_RUN is exactly &quot;true&quot;:</p>
          <p className="text-xl font-semibold">
            {result.emailDryRunExactlyTrue === true ? "true" : "false"}
          </p>
          <p>This read-only check does not send email or change settings.</p>
        </>
      ) : (
        <p role="alert">Email safety check failed: {result.error}</p>
      )}
      <Link className="underline" href="/console">Back to Today</Link>
    </section>
  );
}

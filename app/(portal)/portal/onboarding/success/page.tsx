import { redirect } from "next/navigation";

export default async function SuccessRedirect({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const params = await searchParams;
  const qs = params.session_id ? `?session_id=${params.session_id}` : "";
  redirect(`/onboarding/success${qs}`);
}

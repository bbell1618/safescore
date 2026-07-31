"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type IntakeAnswer = "yes" | "no";

type AnswerResponse = {
  error?: string;
  followupRequestId?: string | null;
};

export function RequestAnswer({
  requestId,
  question,
}: {
  requestId: string;
  question: string;
}) {
  const router = useRouter();
  const [busyAnswer, setBusyAnswer] = useState<IntakeAnswer | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);

  async function answer(value: IntakeAnswer) {
    setBusyAnswer(value);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/portal/requests/${requestId}/answer`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer: value }),
        }
      );
      const body = (await response.json().catch(() => ({}))) as AnswerResponse;
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to save your answer");
      }

      setAnswered(true);
      setMessage(
        value === "yes"
          ? "Thanks. We added the certified court disposition to your document requests."
          : "Thanks. No court disposition is needed right now."
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save your answer"
      );
    } finally {
      setBusyAnswer(null);
    }
  }

  return (
    <fieldset className="mt-4" disabled={busyAnswer !== null || answered}>
      <legend className="sr-only">{question}</legend>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary min-h-10 min-w-20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transform-none"
          onClick={() => void answer("yes")}
        >
          {busyAnswer === "yes" ? "Saving…" : "Yes"}
        </button>
        <button
          type="button"
          className="btn-secondary min-h-10 min-w-20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transform-none"
          onClick={() => void answer("no")}
        >
          {busyAnswer === "no" ? "Saving…" : "No"}
        </button>
      </div>
      {message ? (
        <p
          className="mt-2 text-xs leading-5 text-warm-mid"
          role={answered ? "status" : "alert"}
        >
          {message}
        </p>
      ) : null}
    </fieldset>
  );
}

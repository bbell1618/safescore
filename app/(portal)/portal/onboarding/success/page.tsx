import Link from "next/link";
import { CheckCircle } from "lucide-react";

export default function OnboardingSuccessPage() {
  return (
    <div className="min-h-screen bg-[#F8F8F8] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl border border-[#E5E5E5] shadow-sm p-10 text-center">
          <div className="flex justify-center mb-5">
            <CheckCircle className="w-16 h-16 text-green-500" />
          </div>

          <h1
            className="text-2xl font-bold text-[#1A1A1A] mb-3"
          >
            You're all set!
          </h1>

          <p className="text-gray-600 leading-relaxed mb-8">
            Your SafeScore account is now active. Your first safety assessment
            is being prepared and will be ready within 24 hours.
          </p>

          <Link
            href="/portal"
            className="inline-block w-full py-3 bg-[#DC362E] text-white font-semibold rounded-xl hover:bg-[#b52a23] transition-colors text-center"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

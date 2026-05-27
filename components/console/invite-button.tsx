"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { InviteClientModal } from "./invite-client-modal";

interface InviteButtonProps {
  clientId: string;
  clientName: string;
  contactEmail?: string;
}

export function InviteButton({ clientId, clientName, contactEmail }: InviteButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#F0E8DA] rounded-lg hover:border-[#DAA520] hover:text-[#DAA520] transition-colors"
      >
        <UserPlus className="w-3.5 h-3.5" />
        Invite client
      </button>

      {open && (
        <InviteClientModal
          clientId={clientId}
          clientName={clientName}
          contactEmail={contactEmail}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

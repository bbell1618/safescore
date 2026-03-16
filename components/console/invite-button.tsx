"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { InviteClientModal } from "./invite-client-modal";

interface InviteButtonProps {
  clientId: string;
  clientName: string;
}

export function InviteButton({ clientId, clientName }: InviteButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#E5E5E5] rounded-lg hover:border-[#C5A059] hover:text-[#C5A059] transition-colors"
      >
        <UserPlus className="w-3.5 h-3.5" />
        Invite client
      </button>

      {open && (
        <InviteClientModal
          clientId={clientId}
          clientName={clientName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

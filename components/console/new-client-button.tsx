"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { NewClientModal } from "./new-client-modal";

export function NewClientButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-[#DC362E] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#c42d26] transition-colors"
      >
        <Plus className="w-4 h-4" />
        New client
      </button>

      {open && <NewClientModal onClose={() => setOpen(false)} />}
    </>
  );
}

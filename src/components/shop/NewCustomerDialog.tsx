"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useShop } from "@/lib/shop/ShopContext";
import { errorText } from "@/lib/shop/format";
import type { Customer } from "@/lib/shop/types";
import { normalizePhone } from "@/lib/validate";
import {
  CustomerForm,
  customerPayload,
  customerProblem,
  type CustomerDraft,
} from "@/components/shop/CustomerForm";
import { Modal, ghostButtonClass, goldButtonClass } from "@/components/shop/ui";

const blank: CustomerDraft = {
  full_name: "",
  phone: "",
  email: "",
  address: "",
  id_type: "",
  id_number: "",
  licence_number: "",
  licence_expiry: "",
  notes: "",
};

// what was typed in the search box: only digits and phone punctuation is a phone number, anything else is a name
function fromSearch(text: string): CustomerDraft {
  const typed = text.trim();
  if (!typed) return blank;
  return /^[\d\s+\-()]+$/.test(typed)
    ? { ...blank, phone: typed }
    : { ...blank, full_name: typed };
}

// A small popup to add a customer without leaving the page: opens with whatever was typed in the search filled in, saves
// the customer the same way the Customers page does, then hands the saved customer back so it is chosen at once.
export function NewCustomerDialog({
  open,
  prefill,
  onClose,
  onCreated,
}: {
  open: boolean;
  prefill: string;
  onClose: () => void;
  onCreated: (customer: Customer) => void;
}): React.JSX.Element {
  const { shop } = useShop();
  const [draft, setDraft] = useState<CustomerDraft>(blank);
  const [busy, setBusy] = useState(false);
  // the number is already saved for someone: say so, and offer that person instead of a second record
  const [same, setSame] = useState<Customer | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(fromSearch(prefill));
    setSame(null);
    setBusy(false);
  }, [open, prefill]);

  async function create(): Promise<void> {
    if (busy) return;
    const bad = customerProblem(draft);
    if (bad) {
      toast.error(bad);
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: found } = await supabase
        .from("customers")
        .select("*")
        .eq("phone", normalizePhone(draft.phone))
        .limit(1)
        .maybeSingle();
      if (found) {
        setSame(found as Customer);
        return;
      }
      const { data, error } = await supabase
        .from("customers")
        .insert({ shop_id: shop.id, ...customerPayload(draft) })
        .select("*")
        .single();
      if (error) {
        toast.error(errorText(error));
        return;
      }
      toast.success("Customer added");
      onCreated(data as Customer);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="New customer"
      description="Saved to your customers and added to this booking."
      footer={
        <>
          <button type="button" className={ghostButtonClass} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={goldButtonClass}
            disabled={busy}
            onClick={() => void create()}
          >
            {busy ? "Saving…" : "Create customer"}
          </button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        {same ? (
          <div
            role="alert"
            className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm"
          >
            <span>
              This number is already saved for <strong>{same.full_name}</strong>.
              Use them instead of adding a second record.
            </span>
            <button
              type="button"
              className="min-h-9 rounded-md bg-gold px-3 text-xs font-semibold text-white"
              onClick={() => onCreated(same)}
            >
              Use {same.full_name.split(" ")[0]}
            </button>
          </div>
        ) : null}
        <CustomerForm value={draft} onChange={setDraft} />
        <button type="submit" className="sr-only" tabIndex={-1}>
          Create customer
        </button>
      </form>
    </Modal>
  );
}

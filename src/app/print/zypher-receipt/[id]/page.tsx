"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Receipt {
  receipt_no: string; kind: string; amount: number; paid_on: string; period_to: string | null; method: string; note: string | null;
  shops: { name: string; address: string | null; phone: string | null; gstin: string | null; plan: string } | null;
}
interface Platform { company_name: string; address: string | null; gstin: string | null; phone: string | null; email: string | null }

const METHODS: Record<string, string> = { bank_transfer: "Bank transfer", upi: "UPI", cash: "Cash", cheque: "Cheque" };
const day = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

// Zypher's receipt for a shop's payment. Readable by Zypher and by the paying shop's owner.
export default function ZypherReceipt() {
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<Receipt | null>(null);
  const [z, setZ] = useState<Platform | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void Promise.all([
      supabase.from("shop_payments").select("receipt_no, kind, amount, paid_on, period_to, method, note, shops(name, address, phone, gstin, plan)").eq("id", id).maybeSingle(),
      supabase.from("platform_settings").select("company_name, address, gstin, phone, email").maybeSingle(),
    ]).then(([p, s]) => {
      if (!p.data) setMissing(true);
      setR((p.data as unknown as Receipt) ?? null);
      setZ((s.data as Platform) ?? null);
    });
  }, [id]);

  if (missing) return <p className="p-8 text-sm">Receipt not found.</p>;
  if (!r) return <p className="p-8 text-sm">Loading...</p>;

  return (
    <div className="min-h-screen bg-white text-[13px] text-black">
      <style>{`@media print { .no-print { display: none !important; } @page { size: A4; margin: 16mm; } }`}</style>
      <div className="no-print flex justify-between border-b bg-gray-50 px-6 py-3">
        <button onClick={() => history.back()} className="rounded border px-3 py-1.5 text-sm">Back</button>
        <button onClick={() => window.print()} className="rounded bg-black px-4 py-1.5 text-sm font-semibold text-white">Print or save as PDF</button>
      </div>
      <div className="mx-auto max-w-[720px] p-8">
        <header className="flex justify-between gap-6 border-b pb-4">
          <div>
            <h1 className="text-xl font-bold">{z?.company_name ?? "Zypher"}</h1>
            {z?.address ? <p className="whitespace-pre-line">{z.address}</p> : null}
            <p>{[z?.phone, z?.email].filter(Boolean).join(" · ")}</p>
            {z?.gstin ? <p>GSTIN: {z.gstin}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold uppercase">Payment receipt</p>
            <p>No. <span className="font-mono font-semibold">{r.receipt_no}</span></p>
            <p>Date: {day(r.paid_on)}</p>
          </div>
        </header>
        <section className="border-b py-4">
          <p className="text-[11px] uppercase text-gray-500">Received from</p>
          <p className="font-semibold">{r.shops?.name}</p>
          {r.shops?.address ? <p>{r.shops.address}</p> : null}
          {r.shops?.phone ? <p>{r.shops.phone}</p> : null}
          {r.shops?.gstin ? <p>GSTIN: {r.shops.gstin}</p> : null}
        </section>
        <table className="mt-4 w-full">
          <tbody>
            <tr className="border-b">
              <td className="py-2">
                {r.kind === "installation" ? "Overbooked: one-time installation and setup"
                  : r.kind === "subscription" ? `Overbooked subscription (${r.shops?.plan ?? ""} plan)${r.period_to ? `, up to ${day(r.period_to)}` : ""}`
                  : "Overbooked"}
                {r.note ? <span className="block text-gray-600">{r.note}</span> : null}
              </td>
              <td className="py-2 text-right font-semibold">{inr(r.amount)}</td>
            </tr>
            <tr><td className="py-2 font-bold">Total received</td><td className="py-2 text-right font-bold">{inr(r.amount)}</td></tr>
          </tbody>
        </table>
        <p className="mt-2">Paid by {METHODS[r.method] ?? r.method}. Thank you.</p>
        <p className="mt-10 text-center text-[10px] text-gray-400">This is a computer-generated receipt.</p>
      </div>
    </div>
  );
}

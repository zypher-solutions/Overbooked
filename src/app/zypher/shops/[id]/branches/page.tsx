"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Field, StatusBadge, goldButtonClass, ghostButtonClass, inputClass } from "@/components/overbooked/primitives";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader, tableWrap, theadClass } from "@/components/zypher/kit";

interface BranchRow {
  id: string; name: string; address: string | null; phone: string | null; email: string | null; is_active: boolean;
  people: number; pieces: number; available: number; maintenance: number; lost: number;
}

const EMPTY = { name: "", phone: "", email: "", address: "" };

// A shop's branches and where its pieces are kept: one list, because they are the same places.
// Counts only; Zypher never sees which bookings or customers are behind them.
export default function ShopBranches() {
  const { id } = useParams<{ id: string }>();
  const [rows, setRows] = useState<BranchRow[] | null>(null);
  const [shopName, setShopName] = useState("");
  const [edit, setEdit] = useState<{ branch: BranchRow | null; form: typeof EMPTY } | null>(null);
  const [deleting, setDeleting] = useState<BranchRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [res, shop] = await Promise.all([
      supabase.rpc("setup_branches", { p_shop_id: id }),
      supabase.from("shops").select("name").eq("id", id).maybeSingle(),
    ]);
    if (res.error) return void toast.error("Could not load the branches: " + res.error.message);
    setRows(res.data as unknown as BranchRow[]);
    setShopName(shop.data?.name ?? "");
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const run = async (call: PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true);
    const { error } = await call;
    setBusy(false);
    if (error) { toast.error(error.message); return false; }
    toast.success(ok);
    await load();
    return true;
  };

  const save = async () => {
    if (!edit) return;
    const f = edit.form;
    if (!f.name.trim()) return toast.error("The branch needs a name.");
    const p = { name: f.name, phone: f.phone, email: f.email, address: f.address };
    const done = await run(createClient().rpc("setup_save_branch", { p_shop_id: id, p_branch_id: edit.branch?.id ?? null, p }),
      edit.branch ? "Branch saved" : "Branch added");
    if (done) setEdit(null);
  };

  const toggle = (b: BranchRow) =>
    void run(createClient().rpc("setup_save_branch", { p_shop_id: id, p_branch_id: b.id, p: { is_active: !b.is_active } }),
      b.is_active ? `${b.name} closed` : `${b.name} reopened`);

  const totalPieces = rows?.reduce((n, b) => n + Number(b.pieces), 0) ?? 0;

  return (
    <>
      <PageHeader title="Branches and stock" subtitle={`${shopName ? shopName + ": " : ""}where the shop works and keeps its pieces (counts only)`}
        actions={<button className={goldButtonClass} onClick={() => setEdit({ branch: null, form: EMPTY })}><Plus className="h-4 w-4" /> Add branch</button>} />

      {rows === null ? <p className="py-10 text-center text-muted-foreground">Loading branches...</p> : (
        <div className={tableWrap}>
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className={theadClass}>
              <tr>
                <th className="px-4 py-3">Branch</th><th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3 text-right">Pieces</th><th className="px-4 py-3 text-right">Free</th>
                <th className="px-4 py-3 text-right">In service</th><th className="px-4 py-3 text-right">Lost</th>
                <th className="px-4 py-3 text-right">People</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2.5 font-medium">{b.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {b.phone ? <span className="block font-mono text-foreground">{b.phone}</span> : null}
                    {b.email ? <span className="block">{b.email}</span> : null}
                    {b.address ? <span className="block max-w-[14rem] truncate" title={b.address}>{b.address}</span> : null}
                    {!b.phone && !b.email && !b.address ? "—" : null}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{b.pieces}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald">{b.available || ""}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{b.maintenance || ""}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-rust">{b.lost || ""}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{b.people}</td>
                  <td className="px-4 py-2.5">
                    <button type="button" disabled={busy} onClick={() => toggle(b)} aria-label={(b.is_active ? "Close " : "Reopen ") + b.name}
                      title={b.is_active ? "Click to close this branch" : "Click to reopen this branch"}>
                      <StatusBadge tone={b.is_active ? "emerald" : "rust"}>{b.is_active ? "Active" : "Closed"}</StatusBadge>
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button className="rounded-md p-2 text-muted-foreground hover:bg-black/5 hover:text-foreground" aria-label={"Edit " + b.name}
                        onClick={() => setEdit({ branch: b, form: { name: b.name, phone: b.phone ?? "", email: b.email ?? "", address: b.address ?? "" } })}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button className="rounded-md p-2 text-muted-foreground hover:bg-black/5 hover:text-rust" aria-label={"Delete " + b.name}
                        onClick={() => setDeleting(b)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No branches yet. Add the first one.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {rows ? `${totalPieces} pieces in all. ` : ""}Pieces are added by the shop in its own catalog. A branch with pieces or bookings can be closed but not deleted.
      </p>

      <AlertDialog open={edit !== null} onOpenChange={(o) => { if (!o) setEdit(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{edit?.branch ? `Edit ${edit.branch.name}` : "Add a branch"}</AlertDialogTitle>
            <AlertDialogDescription>These details print on receipts and show to the shop's staff.</AlertDialogDescription>
          </AlertDialogHeader>
          {edit ? (
            <div className="grid gap-3">
              <Field label="Branch name"><input className={inputClass} autoFocus value={edit.form.name} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, name: e.target.value } })} /></Field>
              <Field label="Phone"><input className={inputClass} value={edit.form.phone} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, phone: e.target.value } })} /></Field>
              <Field label="Email"><input className={inputClass} type="email" value={edit.form.email} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, email: e.target.value } })} /></Field>
              <Field label="Address"><textarea className={inputClass} rows={2} value={edit.form.address} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, address: e.target.value } })} /></Field>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void save(); }}>
              {busy ? "Saving..." : edit?.branch ? "Save" : "Add branch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Only a branch with no people, pieces or bookings can be deleted. Otherwise close it, which keeps its history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => {
              e.preventDefault();
              if (!deleting) return;
              void run(createClient().rpc("setup_delete_branch", { p_shop_id: id, p_branch_id: deleting.id }), `${deleting.name} deleted`)
                .then(() => setDeleting(null));
            }}>Delete branch</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

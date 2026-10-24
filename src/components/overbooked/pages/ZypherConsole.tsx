import { useEffect, useState } from "react";
import { Store, Plus, LogIn, Wallet, Settings2, UserPlus, Copy, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth, type Shop } from "@/lib/overbooked/AuthContext";
import { createShopWithOwner, inviteShopOwner } from "@/app/actions/staff";
import { cn } from "@/lib/utils";
import { fmtDate, inr, todayISO } from "@/lib/overbooked/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Plan = Shop["plan"];
interface ShopPayment { id: string; shop_id: string; amount: number; paid_on: string; period_to: string; method: string; note: string | null }

const PLANS: Plan[] = ["starter", "pro", "business"];
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none";
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const emptyNew = { name: "", slug: "", tokenPrefix: "", plan: "starter" as Plan, branchName: "", phone: "", ownerName: "", ownerEmail: "" };

// Zypher staff only: every shop, its plan and billing, and the way into it.
export function ZypherConsole() {
  const { profile, shop: currentShop, switchShop } = useAuth();
  const supabase = createClient();
  const [shops, setShops] = useState<Shop[]>([]);
  const [payments, setPayments] = useState<ShopPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newShop, setNewShop] = useState(emptyNew);
  const [showNew, setShowNew] = useState(false);
  const [planFor, setPlanFor] = useState<{ shop: Shop; plan: Plan; status: Shop["status"] } | null>(null);
  const [payFor, setPayFor] = useState<{ shop: Shop; amount: string; paidOn: string; periodTo: string; method: string; note: string } | null>(null);
  const [ownerFor, setOwnerFor] = useState<{ shop: Shop; name: string; email: string } | null>(null);
  const [shareLink, setShareLink] = useState<{ name: string; link: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const [shopsRes, payRes] = await Promise.all([
      supabase.from("shops").select("*").order("name"),
      supabase.from("shop_payments").select("*").order("paid_on", { ascending: false }),
    ]);
    if (shopsRes.error) toast.error("Could not load shops: " + shopsRes.error.message);
    setShops((shopsRes.data as Shop[]) || []);
    setPayments((payRes.data as ShopPayment[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (profile?.role === "super_admin") load();
  }, [profile]);

  if (profile?.role !== "super_admin") {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-center">
        <ShieldAlert className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-foreground">Access Denied</h2>
        <p className="text-muted-foreground mt-2">Only Zypher staff can open the console.</p>
      </div>
    );
  }

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e: any) {
      toast.error(e.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const createShop = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = await createShopWithOwner(newShop);
      toast.success(`${newShop.name} created`);
      if (res.link) setShareLink({ name: newShop.ownerName, link: res.link });
      else toast.error(res.inviteError || "Shop created, but the owner invite failed. Use Invite owner.");
      setNewShop(emptyNew);
      setShowNew(false);
      await load();
    });
  };

  const savePlan = () => planFor && run(async () => {
    const { error } = await supabase.rpc("set_shop_plan", { p_shop_id: planFor.shop.id, p_plan: planFor.plan, p_status: planFor.status });
    if (error) throw error;
    toast.success("Plan saved");
    setPlanFor(null);
    await load();
  });

  const savePayment = () => payFor && run(async () => {
    const amount = Number(payFor.amount);
    if (!(amount > 0)) throw new Error("Enter the amount received.");
    if (!payFor.periodTo) throw new Error("Enter the date this payment covers until.");
    const { error } = await supabase.rpc("record_shop_payment", {
      p_shop_id: payFor.shop.id, p_amount: amount, p_paid_on: payFor.paidOn, p_period_to: payFor.periodTo,
      p_method: payFor.method, p_note: payFor.note || null,
    });
    if (error) throw error;
    toast.success("Payment recorded");
    setPayFor(null);
    await load();
  });

  const sendOwnerInvite = () => ownerFor && run(async () => {
    const { link } = await inviteShopOwner({ shopId: ownerFor.shop.id, ownerName: ownerFor.name, ownerEmail: ownerFor.email });
    setOwnerFor(null);
    setShareLink({ name: ownerFor.name, link });
  });

  const today = todayISO();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-display font-semibold text-foreground">Zypher Console</h2>
          <p className="text-sm text-muted-foreground">
            {currentShop ? <>Working inside <span className="text-foreground font-medium">{currentShop.name}</span>.</> : "Not inside any shop."}
          </p>
        </div>
        <button onClick={() => setShowNew((v) => !v)} className="inline-flex items-center gap-2 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-white hover:bg-gold/90">
          <Plus className="h-4 w-4" /> New shop
        </button>
      </div>

      {showNew && (
        <form onSubmit={createShop} className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm md:grid-cols-4">
          <input className={field} required placeholder="Shop name" aria-label="Shop name" value={newShop.name}
            onChange={(e) => setNewShop({ ...newShop, name: e.target.value, slug: slugify(e.target.value) })} />
          <input className={field} required placeholder="Short web name (e.g. trendz)" aria-label="Slug" value={newShop.slug}
            onChange={(e) => setNewShop({ ...newShop, slug: slugify(e.target.value) })} />
          <input className={field} required placeholder="Token prefix (2–6 letters)" aria-label="Token prefix" maxLength={6} value={newShop.tokenPrefix}
            onChange={(e) => setNewShop({ ...newShop, tokenPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} />
          <select className={field} aria-label="Plan" value={newShop.plan} onChange={(e) => setNewShop({ ...newShop, plan: e.target.value as Plan })}>
            {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input className={field} required placeholder="First branch name" aria-label="First branch" value={newShop.branchName}
            onChange={(e) => setNewShop({ ...newShop, branchName: e.target.value })} />
          <input className={field} placeholder="Shop phone" aria-label="Shop phone" value={newShop.phone}
            onChange={(e) => setNewShop({ ...newShop, phone: e.target.value })} />
          <input className={field} required placeholder="Owner name" aria-label="Owner name" value={newShop.ownerName}
            onChange={(e) => setNewShop({ ...newShop, ownerName: e.target.value })} />
          <input className={field} required type="email" placeholder="Owner email" aria-label="Owner email" value={newShop.ownerEmail}
            onChange={(e) => setNewShop({ ...newShop, ownerEmail: e.target.value })} />
          <div className="md:col-span-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShowNew(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={busy} className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Creating..." : "Create shop and owner invite"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="py-10 text-center text-muted-foreground">Loading shops...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-muted/70 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Shop</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Paid until</th>
                <th className="px-4 py-3">Last payment</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shops.map((s) => {
                const last = payments.find((p) => p.shop_id === s.id);
                const overdue = !s.paid_until || s.paid_until < today;
                return (
                  <tr key={s.id} className={cn(currentShop?.id === s.id && "bg-gold/5")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Store className="h-4 w-4 text-gold" />
                        <div>
                          <div className="font-medium text-foreground">{s.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{s.slug} · {s.token_prefix}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 uppercase tracking-widest text-xs">{s.plan}</td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                        s.status === "active" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500" : "border-red-500/20 bg-red-500/10 text-red-500")}>
                        {s.status}
                      </span>
                    </td>
                    <td className={cn("px-4 py-3", overdue && "text-rust font-medium")}>{s.paid_until ? fmtDate(s.paid_until) : "Never paid"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{last ? `${inr(last.amount)} on ${fmtDate(last.paid_on)}` : "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button title="Open shop" aria-label={"Open " + s.name} disabled={busy || currentShop?.id === s.id}
                          onClick={() => run(() => switchShop(s.id))}
                          className="rounded-md border border-border p-2 hover:bg-muted disabled:opacity-40"><LogIn className="h-4 w-4" /></button>
                        <button title="Record payment" aria-label={"Record payment for " + s.name}
                          onClick={() => setPayFor({ shop: s, amount: "", paidOn: today, periodTo: "", method: "bank_transfer", note: "" })}
                          className="rounded-md border border-border p-2 hover:bg-muted"><Wallet className="h-4 w-4" /></button>
                        <button title="Plan and status" aria-label={"Plan and status of " + s.name}
                          onClick={() => setPlanFor({ shop: s, plan: s.plan, status: s.status })}
                          className="rounded-md border border-border p-2 hover:bg-muted"><Settings2 className="h-4 w-4" /></button>
                        <button title="Invite owner" aria-label={"Invite owner of " + s.name}
                          onClick={() => setOwnerFor({ shop: s, name: "", email: "" })}
                          className="rounded-md border border-border p-2 hover:bg-muted"><UserPlus className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {shops.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No shops yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={planFor !== null} onOpenChange={(o) => { if (!o) setPlanFor(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Plan for {planFor?.shop.name}</AlertDialogTitle>
            <AlertDialogDescription>Starter: 1 branch, 3 logins. Pro: 3 branches. Business: no limits. Paused shops cannot sign in.</AlertDialogDescription>
          </AlertDialogHeader>
          {planFor && (
            <div className="grid grid-cols-2 gap-2">
              <select className={field} aria-label="Plan" value={planFor.plan} onChange={(e) => setPlanFor({ ...planFor, plan: e.target.value as Plan })}>
                {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className={field} aria-label="Status" value={planFor.status} onChange={(e) => setPlanFor({ ...planFor, status: e.target.value as Shop["status"] })}>
                <option value="active">active</option>
                <option value="suspended">paused (suspended)</option>
              </select>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void savePlan(); }}>Save</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={payFor !== null} onOpenChange={(o) => { if (!o) setPayFor(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Payment from {payFor?.shop.name}</AlertDialogTitle>
            <AlertDialogDescription>Record money received by bank transfer or other means. "Paid until" moves to the end of the period.</AlertDialogDescription>
          </AlertDialogHeader>
          {payFor && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground">Amount (₹)
                <input className={field} inputMode="decimal" value={payFor.amount} onChange={(e) => setPayFor({ ...payFor, amount: e.target.value })} />
              </label>
              <label className="text-xs text-muted-foreground">Method
                <select className={field} value={payFor.method} onChange={(e) => setPayFor({ ...payFor, method: e.target.value })}>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                </select>
              </label>
              <label className="text-xs text-muted-foreground">Received on
                <input type="date" className={field} value={payFor.paidOn} onChange={(e) => setPayFor({ ...payFor, paidOn: e.target.value })} />
              </label>
              <label className="text-xs text-muted-foreground">Covers until
                <input type="date" className={field} value={payFor.periodTo} onChange={(e) => setPayFor({ ...payFor, periodTo: e.target.value })} />
              </label>
              <label className="col-span-2 text-xs text-muted-foreground">Note
                <input className={field} value={payFor.note} onChange={(e) => setPayFor({ ...payFor, note: e.target.value })} />
              </label>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void savePayment(); }}>Record payment</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={ownerFor !== null} onOpenChange={(o) => { if (!o) setOwnerFor(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invite an owner for {ownerFor?.shop.name}</AlertDialogTitle>
            <AlertDialogDescription>You get a one-hour link to send them.</AlertDialogDescription>
          </AlertDialogHeader>
          {ownerFor && (
            <div className="grid grid-cols-1 gap-2">
              <input className={field} placeholder="Owner name" aria-label="Owner name" value={ownerFor.name} onChange={(e) => setOwnerFor({ ...ownerFor, name: e.target.value })} />
              <input className={field} type="email" placeholder="Owner email" aria-label="Owner email" value={ownerFor.email} onChange={(e) => setOwnerFor({ ...ownerFor, email: e.target.value })} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void sendOwnerInvite(); }}>Create invite link</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={shareLink !== null} onOpenChange={(o) => { if (!o) setShareLink(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invite link for {shareLink?.name}</AlertDialogTitle>
            <AlertDialogDescription>Send this link to them. It works once and expires in one hour.</AlertDialogDescription>
          </AlertDialogHeader>
          <textarea readOnly value={shareLink?.link ?? ""} aria-label="Invite link" rows={3}
            className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground" />
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => {
              e.preventDefault();
              navigator.clipboard.writeText(shareLink?.link ?? "").then(() => toast.success("Link copied"), () => toast.error("Could not copy"));
            }}>
              <Copy className="mr-1 h-4 w-4" /> Copy link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

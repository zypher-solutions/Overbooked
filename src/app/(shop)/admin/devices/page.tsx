"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { call } from "@/lib/shop/api";
import { errorText, fmtDateTime } from "@/lib/shop/format";
import { useShop } from "@/lib/shop/ShopContext";
import { deviceKey } from "@/lib/overbooked/device";
import { PasswordField } from "@/components/overbooked/PasswordField";
import { Switch } from "@/components/ui/switch";
import { Empty, Modal, PageHeader, Panel, goldButtonClass, inputClass, tableWrap, theadClass } from "@/components/shop/ui";

// Admin > Devices: every browser each person signed in from (migration 20261101000046). The owner can block one;
// switching needs the shop's master password. Only the owner sees this page.

interface Device {
  id: string;
  device_key: string;
  device_name: string;
  is_active: boolean;
  first_seen: string;
  last_seen: string;
  user_id: string;
  profiles: { full_name: string; role: string } | null;
}

export default function DevicesPage() {
  const { isOwner, isSupport } = useShop();
  const [rows, setRows] = useState<Device[] | null>(null);
  const [hasMaster, setHasMaster] = useState(true);
  const [q, setQ] = useState("");
  const [flip, setFlip] = useState<Device | null>(null);
  const [master, setMaster] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = typeof window === "undefined" ? "" : deviceKey();

  const load = useCallback(async () => {
    const supabase = createClient();
    const [d, m] = await Promise.all([
      supabase.from("login_devices")
        .select("id, device_key, device_name, is_active, first_seen, last_seen, user_id, profiles!login_devices_user_id_fkey(full_name, role)")
        .order("last_seen", { ascending: false }),
      supabase.rpc("has_master_password"),
    ]);
    if (d.error) toast.error(errorText(d.error));
    setRows((d.data ?? []) as unknown as Device[]);
    setHasMaster(m.data !== false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!isOwner || isSupport) return <Panel><p className="text-sm text-muted-foreground">Only the owner can see the devices.</p></Panel>;

  const term = q.trim().toLowerCase();
  const visible = (rows ?? []).filter((r) => !term || `${r.device_name} ${r.profiles?.full_name ?? ""}`.toLowerCase().includes(term));

  const save = async () => {
    if (!flip) return;
    setBusy(true);
    try {
      await call("set_device_active", { p_id: flip.id, p_active: !flip.is_active, p_master: master });
      toast.success(flip.is_active ? "Device blocked. It is signed out the next time it is used." : "Device allowed");
      setFlip(null);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Devices" subtitle="Every phone and computer your people signed in from. Block one to sign it out." />
      <Panel>
        {!hasMaster ? (
          <p className="mb-4 rounded-lg border border-gold/40 bg-gold/5 px-4 py-3 text-sm">
            Set a master password in <Link href="/settings" className="underline">Settings</Link> before you block or allow a device.
          </p>
        ) : null}
        <div className="relative mb-4 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputClass, "pl-9")} placeholder="Search device or person" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search devices" />
        </div>
        {rows === null ? <p className="text-sm text-muted-foreground">Loading...</p> : !visible.length ? (
          <Empty>{term ? `No device matches "${q}".` : "No devices yet. They appear when people sign in."}</Empty>
        ) : (
          <div className={tableWrap}>
            <table className="w-full text-sm">
              <thead className={theadClass}>
                <tr>
                  <th className="px-4 py-2 text-left">Device</th>
                  <th className="px-4 py-2 text-left">Person</th>
                  <th className="px-4 py-2 text-left">Last used</th>
                  <th className="px-4 py-2 text-left">First used</th>
                  <th className="px-4 py-2 text-center">Allowed</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const here = r.device_key === mine;
                  return (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-4 py-3">
                        {r.device_name}
                        {here ? <span className="ml-2 text-xs text-gold">this device</span> : null}
                      </td>
                      <td className="px-4 py-3">{r.profiles?.full_name ?? "Removed person"}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{fmtDateTime(r.last_seen)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{fmtDateTime(r.first_seen)}</td>
                      <td className="px-4 py-3 text-center">
                        {/* blocking the device in your hand would sign you out mid-change */}
                        <Switch checked={r.is_active} disabled={here || !hasMaster}
                          aria-label={`${r.is_active ? "Block" : "Allow"} ${r.device_name} of ${r.profiles?.full_name ?? "removed person"}`}
                          onCheckedChange={() => { setMaster(""); setFlip(r); }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal open={!!flip} onClose={() => setFlip(null)}
        title={flip?.is_active ? "Block this device" : "Allow this device"}
        description={flip ? `${flip.device_name} of ${flip.profiles?.full_name ?? "a removed person"}` : undefined}
        footer={<button className={goldButtonClass} disabled={busy || !master} onClick={() => void save()}>{busy ? "Saving..." : flip?.is_active ? "Block" : "Allow"}</button>}>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <PasswordField id="device-master" label="Master password" value={master} onChange={setMaster} autoComplete="off" />
        </form>
      </Modal>
    </>
  );
}

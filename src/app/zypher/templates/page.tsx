"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge } from "@/components/overbooked/primitives";
import { FEATURE_LABELS, PageHeader, Panel, RATE_LABELS, fmtInterval, rupees, type Template } from "@/components/zypher/kit";

const KIND: Record<Template["kind"], string> = {
  wearable: "Counted by day",
  vehicle: "Counted by hour or day, with km",
  room: "Counted by night, with guests",
};
const CHECK_LABELS: Record<string, string> = {
  condition: "Condition", notes: "Notes", photos: "Photos", odometer: "Odometer", fuel_level: "Fuel level", licence: "Licence and ID",
};
const BASIS: Record<string, string> = {
  per_rental: "once", per_day: "per day", per_unit_day: "per unit per day", per_person_night: "per person per night",
};

// Read-only: the business types are part of the product. Changing one is a database migration.
export default function Templates() {
  const [templates, setTemplates] = useState<Template[] | null>(null);

  useEffect(() => {
    void createClient().from("business_templates").select("*").order("sort").then(({ data, error }) => {
      if (error) toast.error("Could not load business types: " + error.message);
      setTemplates((data as Template[]) ?? []);
    });
  }, []);

  return (
    <>
      <PageHeader title="Business types"
        subtitle="What each type of client gets: wording, fields, prices, checks and optional features. A new type is added by Zypher's developers." />
      {templates === null ? <p className="text-muted-foreground">Loading...</p> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {templates.map((t) => (
            <Panel key={t.key} title={t.name} actions={<StatusBadge tone="indigo">{KIND[t.kind]}</StatusBadge>}>
              <dl className="grid gap-3 text-sm">
                <Item label="Wording">
                  {t.labels.items} · each one is a {t.labels.unit?.toLowerCase()} · {t.labels.start} / {t.labels.end}
                </Item>
                <Item label="Fields">
                  {[...t.variation_fields.map((f) => f.label), ...t.unit_fields.map((f) => f.label + (f.required ? " (required)" : ""))].join(", ") || "—"}
                </Item>
                <Item label="Prices">{t.rate_types.map((r) => RATE_LABELS[r] ?? r).join(", ")}</Item>
                <Item label={t.labels.turnaround ?? "Turnaround"}>{fmtInterval(t.turnaround)} after each rental, before the next one</Item>
                <Item label="At pickup">{(t.checks.pickup ?? []).map((c) => CHECK_LABELS[c] ?? c).join(", ") || "—"}</Item>
                <Item label="At return">{(t.checks.return ?? []).map((c) => CHECK_LABELS[c] ?? c).join(", ") || "—"}</Item>
                <Item label="Optional features">
                  {Object.entries(t.features).map(([k, on]) => (
                    <span key={k} className="mr-1.5 inline-block"><StatusBadge tone={on ? "emerald" : "muted"}>{FEATURE_LABELS[k] ?? k}: {on ? "on" : "off"}</StatusBadge></span>
                  ))}
                  {Object.keys(t.features).length === 0 ? "—" : null}
                </Item>
                <Item label="Extras for new shops">
                  {t.default_add_ons.map((a) => `${a.name} (${BASIS[a.basis] ?? a.basis}${a.amount ? ", " + rupees(a.amount) : ""})`).join(", ") || "—"}
                </Item>
              </dl>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  );
}

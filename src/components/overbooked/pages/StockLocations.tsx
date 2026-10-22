import { useState } from "react";
import { EyeOff, MapPin } from "lucide-react";
import { useOverbooked } from "@/lib/overbooked/store";
import { inputClass, labelClass, StatusBadge } from "../primitives";
import type { StockLocation } from "@/lib/overbooked/types";
import { Skeleton, TableSkeleton } from "../Skeleton";

export function StockLocations() {
  const { locations, products, createLocation, isLoading } = useOverbooked();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    createLocation({
      name: name.trim(),
      slug: slug.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      email,
      phone,
      address,
      enabled: true,
    } as any);

    setName("");
    setSlug("");
    setEmail("");
    setPhone("");
    setAddress("");
  };

  const getProductCount = (locName: string) => {
    return products.filter(p => {
      return (p.variations || []).some(v => (v.stock[locName] ?? 0) > 0);
    }).length;
  };

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold">Location</h1>
      </header>

      {isLoading ? (
        <div className="flex flex-col gap-8 lg:flex-row">
          <div className="w-full lg:w-1/3 space-y-4">
            <Skeleton className="h-6 w-1/3 mb-4" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-24 mt-6" />
          </div>
          <div className="flex-1 space-y-4">
            <Skeleton className="h-6 w-1/3 mb-4" />
            <TableSkeleton rows={4} columns={5} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-8 lg:flex-row">
          {/* Left Column - Form */}
          <div className="w-full lg:w-1/3">
          <h2 className="mb-4 font-display text-lg font-medium">Add New Item</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelClass}>Name</label>
              <input 
                type="text" 
                required
                className={inputClass} 
                value={name}
                onChange={e => setName(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">The name is how it appears on your site.</p>
            </div>

            <div>
              <label className={labelClass}>Slug</label>
              <input 
                type="text" 
                className={inputClass} 
                value={slug}
                onChange={e => setSlug(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">The "slug" is the URL-friendly version of the name. It is usually all lowercase and contains only letters, numbers, and hyphens.</p>
            </div>

            <div>
              <label className={labelClass}>Location Email</label>
              <input 
                type="email" 
                className={inputClass} 
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">Email address for the branch.</p>
            </div>

            <div>
              <label className={labelClass}>Location Phone Number</label>
              <input 
                type="tel" 
                className={inputClass} 
                value={phone}
                onChange={e => setPhone(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">Contact number for the branch.</p>
            </div>

            <div>
              <label className={labelClass}>Location Address</label>
              <textarea 
                rows={3}
                className={inputClass} 
                value={address}
                onChange={e => setAddress(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">Physical address of the branch.</p>
            </div>

            <div className="pt-2">
              <button 
                type="submit"
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                Add New Item
              </button>
            </div>
          </form>
        </div>

        {/* Right Column - Table */}
        <div className="flex-1">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input type="text" className={inputClass + " w-48 h-9"} />
              <button className="rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-white/[0.05] transition-colors">Search Items</button>
            </div>

            <div className="flex items-center gap-2">
            </div>
          </div>

          <div className="flex items-center justify-end mb-2 text-sm text-muted-foreground">
            {locations.length} items
          </div>

          {/* Desktop Table */}
          <div className="glass overflow-x-auto rounded-lg hidden xl:block">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-white/[0.02]">
                  <th className="w-12 px-4 py-3 text-center"><input type="checkbox" className="rounded border-border bg-transparent focus:ring-gold" /></th>
                  <th className="px-4 py-3 font-medium text-gold hover:text-gold/80 cursor-pointer">Name</th>
                  <th className="px-4 py-3 font-medium text-gold hover:text-gold/80 cursor-pointer">Slug</th>
                  <th className="px-4 py-3 font-medium text-gold hover:text-gold/80 cursor-pointer">Email</th>
                  <th className="px-4 py-3 font-medium text-gold hover:text-gold/80 cursor-pointer">Phone</th>
                  <th className="px-4 py-3 font-medium text-gold hover:text-gold/80 cursor-pointer">Address</th>
                  <th className="px-4 py-3 font-medium text-gold hover:text-gold/80 cursor-pointer">Count</th>
                  <th className="px-4 py-3 font-medium">Enabled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {locations.map((loc) => (
                  <tr key={loc.id} className="group transition-colors hover:bg-white/[0.02] bg-white/[0.01]">
                    <td className="px-4 py-3 text-center">
                      <input type="checkbox" className="rounded border-border bg-transparent focus:ring-gold" />
                    </td>
                    <td className="px-4 py-3 font-medium text-gold hover:underline cursor-pointer">
                      {loc.name}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {loc.slug}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {loc.email || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {loc.phone || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]" title={loc.address}>
                      {loc.address || "—"}
                    </td>
                    <td className="px-4 py-3 text-blue-400 hover:underline cursor-pointer">
                      {getProductCount(loc.name)}
                    </td>
                    <td className="px-4 py-3">
                      {loc.enabled ? <span className="text-emerald">Yes</span> : <span className="text-rust">No</span>}
                    </td>
                  </tr>
                ))}
                
                {locations.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      No locations found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card Layout */}
          <div className="xl:hidden space-y-4">
            {locations.length === 0 ? (
              <div className="glass p-6 text-center text-sm text-muted-foreground rounded-lg">
                No locations found.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {locations.map((loc) => (
                  <div key={loc.id} className="glass rounded-xl p-4 flex flex-col transition-colors hover:bg-white/[0.02]">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-semibold text-gold text-base leading-tight">{loc.name}</h3>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">{loc.slug}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">{getProductCount(loc.name)} items</span>
                        {loc.enabled ? <span className="text-[10px] uppercase font-bold text-emerald border border-emerald/30 bg-emerald/10 px-1.5 py-0.5 rounded">Active</span> : <span className="text-[10px] uppercase font-bold text-rust border border-rust/30 bg-rust/10 px-1.5 py-0.5 rounded">Inactive</span>}
                      </div>
                    </div>
                    
                    <div className="bg-white/[0.02] rounded-lg p-3 border border-border mt-2 space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{loc.address || "—"}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 truncate">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-0.5">Email</span>
                          <span className="text-foreground">{loc.email || "—"}</span>
                        </div>
                        <div className="flex-1 truncate">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-0.5">Phone</span>
                          <span className="text-foreground">{loc.phone || "—"}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

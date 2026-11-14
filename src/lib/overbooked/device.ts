"use client";

import { createClient } from "@/lib/supabase/client";

// This browser's device for Admin > Devices (migration 20261101000046). The key stays across sign-outs.
const KEY = "overbooked-device";

export function deviceKey(): string {
  try {
    let k = localStorage.getItem(KEY);
    if (!k) { k = crypto.randomUUID(); localStorage.setItem(KEY, k); }
    return k;
  } catch {
    return "no-storage-device"; // private mode without storage: one shared entry per person
  }
}

// "Windows Chrome, desktop" from the user agent; brand checks go most specific first (Edge says Chrome too)
export function deviceName(ua = navigator.userAgent): string {
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "Unknown";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "browser";
  const kind = /iPad|Tablet/.test(ua) ? "tablet" : /Mobi|Android|iPhone/.test(ua) ? "phone" : "desktop";
  return `${os} ${browser}, ${kind}`;
}

/** records this device for the signed-in person; false = the owner blocked it. A network error counts as allowed. */
export async function deviceAllowed(): Promise<boolean> {
  const { data, error } = await createClient().rpc("register_device", { p_key: deviceKey(), p_name: deviceName() });
  return error ? true : data !== false;
}

export const BLOCKED_MESSAGE = "This device is blocked by your shop owner. Ask them to allow it in Admin > Devices.";

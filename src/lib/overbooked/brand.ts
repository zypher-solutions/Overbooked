// The signed-in shop's name, for text built outside React (WhatsApp messages, PDFs).
// Set by AuthContext once the shop is loaded; "Overbooked" until then.
let shopName = "Overbooked";

export function setShopBrand(name: string | null | undefined) {
  shopName = name?.trim() || "Overbooked";
}

export function shopBrand() {
  return shopName;
}

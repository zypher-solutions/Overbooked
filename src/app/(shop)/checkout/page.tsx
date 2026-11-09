"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageSkeleton } from "@/components/shop/ui";
import {
  useBookingForm,
  type BookedRental,
} from "@/components/shop/useBookingForm";
import { useShop } from "@/lib/shop/ShopContext";
import { useCart } from "@/modules/clothing/cart";
import {
  BookingConfirmation,
  BookingForm,
} from "@/modules/clothing/screens/BookingForm";

export default function CheckoutPage(): React.JSX.Element {
  const router = useRouter();
  const { loading, businessModule, tz } = useShop();
  const cart = useCart();
  const [booked, setBooked] = useState<BookedRental | null>(null);
  const open = useRef(false);

  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  function showConfirmation(booking: BookedRental): void {
    if (open.current) setBooked(booking);
    else
      toast.success(`Booking confirmed · ${booking.token}`, {
        action: {
          label: "View booking",
          onClick: () => router.push(`/rentals/${booking.rentalId}`),
        },
      });
  }

  if (loading || !cart.ready || businessModule !== "clothing")
    return <PageSkeleton columns={false} />;
  if (booked)
    return (
      <BookingConfirmation
        booked={booked}
        tz={tz}
        onDone={() => router.replace("/bookings")}
      />
    );

  return (
    <Suspense fallback={<PageSkeleton columns={false} />}>
      <ActiveCheckout key={cart.id} onBooked={showConfirmation} />
    </Suspense>
  );
}

function ActiveCheckout({
  onBooked,
}: {
  onBooked: (booking: BookedRental) => void;
}): React.JSX.Element {
  const form = useBookingForm(onBooked);
  if (form.editId && !form.editing) return <PageSkeleton columns={false} />;
  return <BookingForm f={form} />;
}

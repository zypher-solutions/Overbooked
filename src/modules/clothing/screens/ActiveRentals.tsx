"use client";

import { RentalPage } from "./Bookings";

// Active rentals: everything out with customers, for taking returns
export default function ActiveRentals() {
  return <RentalPage view="active" />;
}

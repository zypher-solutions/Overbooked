import { PageSkeleton } from "@/components/shop/ui";

// shown at once while a shop screen is being fetched, so a click never lands on a blank page
export default function Loading() {
  return <PageSkeleton />;
}

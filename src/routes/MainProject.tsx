import { createFileRoute } from "@tanstack/react-router";
import { CoffeeZoneLandingPage } from "@/components/coffee-zone-landing";

export const Route = createFileRoute("/MainProject")({
  head: () => ({
    meta: [
      { title: "Coffee Zone — Sales & Inventory Management" },
      {
        name: "description",
        content:
          "All-in-one sales and inventory platform for modern coffee shops. Track stock, run the register, manage staff and grow with insights.",
      },
      { property: "og:title", content: "Coffee Zone — Sales & Inventory Management" },
      {
        property: "og:description",
        content:
          "Run your coffee shop with confidence: real-time inventory, fast POS, reports and team management.",
      },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: LandingPage,
});

function LandingPage() {
  return <CoffeeZoneLandingPage />;
}

import { createFileRoute } from "@tanstack/react-router";
import { CoffeeZoneLandingPage } from "@/components/coffee-zone-landing";

export const Route = createFileRoute("/landingpage")({
  head: () => ({
    meta: [
      { title: "Coffee Zone — Sales & Inventory Management" },
      {
        name: "description",
        content:
          "All-in-one sales and inventory platform for modern coffee shops. Track stock, run the register, manage staff and grow with insights.",
      },
    ],
  }),
  component: CoffeeZoneLandingPage,
});

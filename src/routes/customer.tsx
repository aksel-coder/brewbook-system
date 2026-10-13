import { createFileRoute } from "@tanstack/react-router";
import { CustomerPage } from "@/components/customer-page";

export const Route = createFileRoute("/customer")({
  head: () => ({
    meta: [
      { title: "Coffee Zone Menu" },
      {
        name: "description",
        content: "Browse the Coffee Zone menu and explore available drinks and treats.",
      },
    ],
  }),
  component: CustomerPage,
});

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Coffee Zone Menu" },
      {
        name: "description",
        content: "Browse the Coffee Zone menu and explore available drinks and treats.",
      },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/customer", replace: true });
  },
});

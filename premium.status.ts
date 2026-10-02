import { createFileRoute } from "@tanstack/react-router";
import { checkApiSecret, getPremiumState } from "@/lib/kingmor";

export const Route = createFileRoute("/api/premium/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!checkApiSecret(request)) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        const userId = new URL(request.url).searchParams.get("userId");
        if (!userId) return Response.json({ error: "userId required" }, { status: 400 });
        const state = await getPremiumState(userId);
        return Response.json({
          premium: state.active,
          expiry: state.expiry,
          since: state.since,
        });
      },
    },
  },
});

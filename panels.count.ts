import { createFileRoute } from "@tanstack/react-router";
import { checkApiSecret, countPanels, getPremiumState, panelLimit } from "@/lib/kingmor";

export const Route = createFileRoute("/api/panels/count")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!checkApiSecret(request)) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        const ownerId = new URL(request.url).searchParams.get("ownerId");
        if (!ownerId) return Response.json({ error: "ownerId required" }, { status: 400 });
        const count = await countPanels(ownerId);
        const premium = await getPremiumState(ownerId);
        const max = panelLimit(premium.active);
        return Response.json({
          count,
          max,
          premium: premium.active,
          remaining: Math.max(0, max - count),
          canCreate: count < max,
        });
      },
    },
  },
});

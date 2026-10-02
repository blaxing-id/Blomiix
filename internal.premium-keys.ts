import { createFileRoute } from "@tanstack/react-router";
import { checkApiSecret, issuePremiumKeys } from "@/lib/kingmor";

export const Route = createFileRoute("/api/internal/premium-keys")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!checkApiSecret(request)) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        const body = (await request.json()) as {
          duration?: string;
          amount?: number;
          createdBy?: string;
        };
        if (!body.duration || !body.createdBy) {
          return Response.json({ error: "duration and createdBy required" }, { status: 400 });
        }
        try {
          const result = await issuePremiumKeys({
            duration: body.duration,
            amount: Math.min(Math.max(body.amount ?? 1, 1), 20),
            createdBy: String(body.createdBy),
          });
          return Response.json({ success: true, ...result });
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed" },
            { status: 400 },
          );
        }
      },
    },
  },
});

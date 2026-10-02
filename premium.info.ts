import { createFileRoute } from "@tanstack/react-router";
import { DISCORD_INVITE, PREMIUM_PRICE_IDR, PREMIUM_PRICE_USD } from "@/lib/constants";

export const Route = createFileRoute("/api/premium/info")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          priceIDR: PREMIUM_PRICE_IDR,
          priceUSD: PREMIUM_PRICE_USD,
          discord: DISCORD_INVITE,
        }),
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { bindHwid, findScriptKey, loadScriptById } from "@/lib/kingmor";

export const Route = createFileRoute("/api/hwid/check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const scriptId = url.searchParams.get("scriptId") || "";
        const key = (url.searchParams.get("key") || "").toLowerCase().trim();
        const hwid = url.searchParams.get("hwid") || "";

        if (!scriptId || !hwid) {
          return Response.json({ valid: false, reason: "Missing params" });
        }

        const script = await loadScriptById(scriptId);
        if (!script) return Response.json({ valid: false, reason: "Script not found" });
        if (script.free_mode) return Response.json({ valid: true, freeMode: true });
        if (!key) return Response.json({ valid: false, reason: "No Key Provided" });

        const keyData = await findScriptKey(scriptId, key);
        if (!keyData) return Response.json({ valid: false, reason: "Invalid Key" });
        if (keyData.expiry && new Date(keyData.expiry) < new Date()) {
          return Response.json({ valid: false, reason: "Key Expired" });
        }
        if (!keyData.hwid) {
          await bindHwid(scriptId, key, hwid);
          return Response.json({ valid: true, bound: true });
        }
        if (keyData.hwid !== hwid) {
          return Response.json({ valid: false, reason: "HWID Mismatch - Contact Admin" });
        }
        return Response.json({ valid: true });
      },
    },
  },
});

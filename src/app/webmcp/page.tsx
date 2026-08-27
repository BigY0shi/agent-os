import WebmcpView from "@/components/v2/webmcp/WebmcpView";

// WebMCP Engine (SPEC-C D3) — build / test / version / deploy MCP tool
// packages over /api/v2/webmcp/*. Published tools land on the internal hub
// as <slug>/<tool> where Jarvis and MCP clients discover them.
export default function WebmcpRoute() {
  return (
    <div className="min-h-[calc(100vh-220px)]">
      <WebmcpView />
    </div>
  );
}

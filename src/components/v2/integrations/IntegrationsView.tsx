"use client";

// ── IntegrationsView (SPEC-D G1 §6.1) — the /integrations page shell ─────────
// Header (master sync chip · gear) → ConnectorGrid (card per registry entry:
// status, Connect, account chips) → ConnectDialog / AccountDetail overlays.
// V2 idiom: fetch-on-mount + usePollWhileVisible, dark palette, ConfigMenu
// gear (rule 16), useJarvisPageContext descriptor.

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plug, Power } from "lucide-react";
import ConfigMenu, { useSettings } from "@/components/ConfigMenu";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { useJarvisPageContext } from "@/lib/v2/jarvis/pageContext";
import {
  INTEGRATIONS_ACCENT,
  EmptyState,
  StatusChip,
  connectorIcon,
  fmtAgo,
  panelStyle,
  type AccountInfo,
  type ConnectorInfo,
} from "./shared";
import ConnectDialog from "./ConnectDialog";
import AccountDetail from "./AccountDetail";
import IntegrationsSettings from "./IntegrationsSettings";

export default function IntegrationsView() {
  const [connectors, setConnectors] = useState<ConnectorInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [connectSlug, setConnectSlug] = useState<string | null>(null);
  const [openAccount, setOpenAccount] = useState<{ account: AccountInfo; connectorName: string } | null>(null);
  const { settings, save } = useSettings();
  const searchParams = useSearchParams();
  const oauthError = searchParams?.get("error") ?? null;
  const oauthConnected = searchParams?.get("connected") ?? null;

  const integrationsSettings = (settings?.integrations ?? {}) as { syncEnabled?: boolean };
  const syncEnabled = integrationsSettings.syncEnabled !== false;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v2/integrations", { cache: "no-store" });
      const j = await res.json();
      if (Array.isArray(j?.connectors)) {
        setConnectors(j.connectors as ConnectorInfo[]);
        setFailed(false);
      }
    } catch {
      setFailed(true);
    }
  }, []);

  usePollWhileVisible(refresh, 10000, []);

  const connectedCount = useMemo(
    () => (connectors ?? []).reduce((n, c) => n + c.accounts.filter((a) => a.isActive).length, 0),
    [connectors],
  );

  useJarvisPageContext({
    route: "/integrations",
    title: "Integrations",
    summary: `Integrations — ${connectors?.length ?? 0} connector(s), ${connectedCount} account(s) connected.`,
  });

  const connectDialog = (connectors ?? []).find((c) => c.slug === connectSlug) ?? null;

  return (
    <div className="mt-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div
            className="grid h-9 w-9 place-items-center rounded-xl"
            style={{ background: `${INTEGRATIONS_ACCENT}14`, border: `1px solid ${INTEGRATIONS_ACCENT}44` }}
          >
            <Plug size={17} style={{ color: INTEGRATIONS_ACCENT }} />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight leading-tight" style={{ color: "var(--fg, #e8e2f0)" }}>
              Integrations
            </h1>
            <div className="font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              {failed && !connectors
                ? "feed unreachable"
                : connectors
                  ? `${connectors.length} connectors · ${connectedCount} account${connectedCount === 1 ? "" : "s"} connected`
                  : "loading…"}
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => save({ integrations: { ...integrationsSettings, syncEnabled: !syncEnabled } })}
            title="Master switch for scheduled syncs (manual sync always runs)"
            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[11.5px] font-medium transition"
            style={{
              border: `1px solid ${syncEnabled ? `${INTEGRATIONS_ACCENT}66` : "var(--panel-border, #2a2436)"}`,
              color: syncEnabled ? INTEGRATIONS_ACCENT : "var(--fg-dimmer, #6b6478)",
              background: syncEnabled ? `${INTEGRATIONS_ACCENT}0f` : "transparent",
            }}
          >
            <Power size={12} /> sync {syncEnabled ? "on" : "off"}
          </button>
          <ConfigMenu title="Integrations Settings" accent={INTEGRATIONS_ACCENT}>
            <IntegrationsSettings connectors={connectors ?? []} />
          </ConfigMenu>
        </div>
      </div>

      {oauthError && (
        <div className="mb-3 rounded-lg px-3 py-2 text-[11.5px]" style={{ border: "1px solid #f8717155", color: "#f87171" }}>
          OAuth failed: {oauthError}
        </div>
      )}
      {oauthConnected && (
        <div className="mb-3 rounded-lg px-3 py-2 text-[11.5px]" style={{ border: `1px solid ${INTEGRATIONS_ACCENT}55`, color: INTEGRATIONS_ACCENT }}>
          {oauthConnected} connected ✓
        </div>
      )}

      {/* connector grid */}
      {!connectors ? (
        <EmptyState icon={<Plug size={22} />} title="Loading connectors…" />
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {connectors.map((c) => (
            <ConnectorCard
              key={c.slug}
              connector={c}
              onConnect={() => setConnectSlug(c.slug)}
              onOpenAccount={(account) => setOpenAccount({ account, connectorName: c.name })}
            />
          ))}
        </div>
      )}

      {connectDialog && (
        <ConnectDialog connector={connectDialog} onClose={() => setConnectSlug(null)} onConnected={refresh} />
      )}
      {openAccount && (
        <AccountDetail
          account={openAccount.account}
          connectorName={openAccount.connectorName}
          onClose={() => setOpenAccount(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function ConnectorCard({
  connector,
  onConnect,
  onOpenAccount,
}: {
  connector: ConnectorInfo;
  onConnect: () => void;
  onOpenAccount: (account: AccountInfo) => void;
}) {
  const active = connector.accounts.filter((a) => a.isActive);
  const syncError = active.find((a) => a.lastSync && !a.lastSync.ok);
  const needsConfig = connector.auth === "oauth2" && !connector.configured && !connector.hasApiKey;

  return (
    <div className="rounded-xl p-3.5 flex flex-col gap-2.5" style={panelStyle}>
      <div className="flex items-center gap-2.5">
        <div
          className="grid h-8 w-8 place-items-center rounded-lg shrink-0"
          style={{ background: `${INTEGRATIONS_ACCENT}10`, border: "1px solid var(--panel-border, #2a2436)", color: INTEGRATIONS_ACCENT }}
        >
          {connectorIcon(connector.icon, 15)}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold truncate" style={{ color: "var(--fg, #e8e2f0)" }}>{connector.name}</div>
          {connector.category && (
            <span className="font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              {connector.category}
            </span>
          )}
        </div>
        <div className="ml-auto shrink-0">
          {syncError ? (
            <StatusChip color="#f87171">sync error</StatusChip>
          ) : active.length > 0 ? (
            <StatusChip color="#34d399">{active.length} account{active.length === 1 ? "" : "s"}</StatusChip>
          ) : needsConfig ? (
            <StatusChip color="#9ca3af">not configured</StatusChip>
          ) : (
            <StatusChip color="#60a5fa">ready</StatusChip>
          )}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: "var(--fg-dim, #9aa)" }}>
        {connector.description}
      </p>

      {connector.accounts.length > 0 && (
        <div className="flex flex-col gap-1">
          {connector.accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => onOpenAccount(a)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[rgba(255,255,255,0.03)]"
              style={{ border: "1px solid var(--panel-border, #2a2436)" }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: !a.isActive ? "#9ca3af" : a.lastSync && !a.lastSync.ok ? "#f87171" : "#34d399" }}
              />
              <span className="text-[11.5px] truncate" style={{ color: a.isActive ? "var(--fg, #e8e2f0)" : "var(--fg-dimmer, #6b6478)" }}>
                {a.displayName ?? a.accountId}
              </span>
              <span className="ml-auto font-mono text-[9px] shrink-0" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                {a.lastSync ? fmtAgo(a.lastSync.at) : "no sync"}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-auto">
        <button
          onClick={onConnect}
          className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11.5px] font-medium transition"
          style={{ border: `1px solid ${INTEGRATIONS_ACCENT}55`, color: INTEGRATIONS_ACCENT }}
        >
          <Plug size={11} /> Connect
        </button>
      </div>
    </div>
  );
}

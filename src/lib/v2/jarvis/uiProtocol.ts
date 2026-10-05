/** Serializable active-tab protocol, shared by browser and server. */
export interface UiCommand {
  action: "inspect" | "click" | "fill" | "select" | "navigate";
  target?: string;
  value?: string;
  route?: string;
  offset?: number;
  controlsOffset?: number;
}
export interface UiResult { ok: boolean; error?: string; [key: string]: unknown }
export interface UiRequestEvent { type: "ui_request"; id: string; token: string; expiresAt: number; command: UiCommand }
export function safeAppRoute(route: string): boolean {
  return /^\/(?!\/)/.test(route) && !/[\\\s\u0000-\u001f]/.test(route)
    && !/%(?:2f|5c|0[0-9a-f]|1[0-9a-f])/i.test(route)
    && !/^\/(?:api|login|logout)(?:[/?#]|$)/i.test(route);
}

/**
 * Integration constants that BOTH the server and the client need.
 *
 * Deliberately free of imports — settings.ts and oauth.ts reach the filesystem
 * and the db, so a client component cannot pull the default from there. It was
 * copied instead, into three files, and then drifted: the value said port 3000
 * while every install of Agent OS runs on 3737, so the redirect URI the UI told
 * you to register with Google could never receive the callback.
 */

/**
 * Origin the OAuth callback comes back to. Must match what is registered with
 * the provider EXACTLY — scheme, host and port.
 *
 * 3737 is the port the launchers actually use (`agentos-restart.ps1` passes
 * `-p 3737`; `Start Agent OS.bat` sets PORT=3737). Override it in the
 * /integrations gear when connecting from another machine on the LAN, and
 * register that origin with the provider instead.
 */
export const DEFAULT_CALLBACK_ORIGIN = "http://localhost:3737";

/** The path half of the redirect URI — the route that receives the code. */
export const OAUTH_CALLBACK_PATH = "/api/v2/integrations/oauth/callback";

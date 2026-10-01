; ─────────────────────────────────────────────────────────────────────────────
; Agent OS — Jarvis OS-global hotkey helper (AutoHotkey v2)  ·  SPEC-C C2 + S38
;
; HOLD the configured key ANYWHERE in Windows → Agent OS opens the Jarvis orb
; chat (if closed), fronts the page and starts the mic; RELEASE it → the mic
; stops and, when "Send on release" is on in the Jarvis gear, the transcript is
; sent and the reply is read aloud. That is push-to-talk ("hold to talk" mode).
; In "press to open" mode a press only opens the chat, as before S38.
;
; THE KEY AND THE MODE ARE NOT SET HERE. The script asks Agent OS for them
; (GET /api/jarvis/hotkey/config, secret-gated) at start and every 30 s, so
; the Jarvis gear (orb chat → gear → Hotkey) is the one place to change them.
; The lines below are only the fallback until the server answers.
;
; INSTALL (no UAC needed):
;   1. Install AutoHotkey v2  →  https://www.autohotkey.com
;   2. Get the secret written: open Agent OS and visit /api/jarvis/hotkey/setup
;      (it writes %USERPROFILE%\.agentic-os\jarvis-hotkey.secret).
;   3. Double-click this file to run it now.
;   4. Auto-start one-liner (copies a shortcut into shell:startup):
;      powershell -c "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\jarvis-hotkey.lnk');$s.TargetPath='%CD%\jarvis-hotkey.ahk';$s.Save()"
;      (run from this script's folder — or just Win+R → shell:startup → paste a shortcut)
; ─────────────────────────────────────────────────────────────────────────────

#Requires AutoHotkey v2.0
#SingleInstance Force

; ── Config ───────────────────────────────────────────────────────────────────
AppUrl     := "http://127.0.0.1:3737"  ; where Agent OS is served (the launchers use 3737)
JarvisKey  := "F13"                    ; FALLBACK only — the gear's Key wins (F13–F24 work great from macro pads)
JarvisMode := "hold"                   ; FALLBACK only — "hold" = push-to-talk, "open" = press opens the chat
ConfigEveryMs := 30000                 ; how often the gear is re-read
; No F13 key? Type CapsLock (or F9, etc.) into the gear's Key field; when the
; key is CapsLock this script also parks the caps state so it stops toggling.
; ─────────────────────────────────────────────────────────────────────────────

SecretPath := A_UserProfile "\.agentic-os\jarvis-hotkey.secret"
JarvisSecret := ""
BoundKey := ""      ; the key currently registered with Hotkey (so it can be unbound)
Held := false       ; push-to-talk state (also swallows Windows key autorepeat)

ReadSecret()
if (JarvisSecret = "")
    TrayTip "Secret missing — open Agent OS and visit /api/jarvis/hotkey/setup, then reload this script.", "Jarvis hotkey"

SetTitleMatchMode 2  ; substring window-title match

; Fallback binding first (works even if the server is down), then the gear's.
BindKey(JarvisKey, JarvisMode)
LoadConfig()
SetTimer LoadConfig, ConfigEveryMs

ReadSecret() {
    global SecretPath, JarvisSecret
    try JarvisSecret := Trim(FileRead(SecretPath), " `t`r`n")
}

; One HTTP call via WinHttpRequest COM — AHK v2's Download() CANNOT POST and
; cannot send headers (CONVENTIONS §10). Returns {Status, Text}; Status 0 = unreachable.
Http(method, path, body := "") {
    global AppUrl, JarvisSecret
    out := {Status: 0, Text: ""}
    try {
        req := ComObject("WinHttp.WinHttpRequest.5.1")
        req.SetTimeouts(2000, 2000, 2000, 4000)
        req.Open(method, AppUrl path, false)
        req.SetRequestHeader("Content-Type", "application/json")
        req.SetRequestHeader("x-agentos-hotkey-secret", JarvisSecret)
        if (body != "")
            req.Send(body)
        else
            req.Send()
        out.Status := req.Status
        out.Text := req.ResponseText
    } catch as e {
        out.Text := e.Message
    }
    return out
}

; Ask the gear for {key, mode}; rebind when they changed. Unreachable = keep
; the current binding quietly (the next press will TrayTip if it fails too).
LoadConfig() {
    global JarvisSecret
    if (JarvisSecret = "")
        ReadSecret()
    r := Http("GET", "/api/jarvis/hotkey/config")
    if (r.Status = 200) {
        key := "", mode := ""
        if RegExMatch(r.Text, '"key"\s*:\s*"([^"]+)"', &m)
            key := m[1]
        if RegExMatch(r.Text, '"mode"\s*:\s*"(hold|open)"', &m2)
            mode := m2[1]
        if (key != "" && mode != "")
            BindKey(key, mode)
    } else if (r.Status = 401) {
        TrayTip "Config GET refused (401) — is the secret current? (re-run /api/jarvis/hotkey/setup)", "Jarvis hotkey"
    } else if (r.Status = 503) {
        TrayTip "Agent OS has no hotkey secret yet — visit /api/jarvis/hotkey/setup.", "Jarvis hotkey"
    }
}

; Register key (down) and key up; unbind the previous key first.
BindKey(key, mode) {
    global BoundKey, JarvisKey, JarvisMode, Held
    if (key = BoundKey && mode = JarvisMode)
        return
    try {
        if (BoundKey != "") {
            Hotkey BoundKey, "Off"
            Hotkey BoundKey " up", "Off"
        }
        Hotkey key, OnKeyDown, "On"
        Hotkey key " up", OnKeyUp, "On"
    } catch as e {
        TrayTip "Cannot bind key '" key "' (" e.Message ") — fix the Key field in the Jarvis gear.", "Jarvis hotkey"
        return
    }
    if (key = "CapsLock")
        SetCapsLockState "AlwaysOff"
    BoundKey := key
    JarvisKey := key
    JarvisMode := mode
    Held := false
    TrayTip "Jarvis key: " key " · " (mode = "hold" ? "hold to talk" : "press to open"), "Jarvis hotkey"
}

OnKeyDown(*) {
    global JarvisMode, Held
    if (JarvisMode = "open") {
        FireJarvis("press")
        return
    }
    if Held            ; Windows autorepeat while the key is held — one "down" only
        return
    Held := true
    FireJarvis("down")
}

OnKeyUp(*) {
    global JarvisMode, Held
    if (JarvisMode = "open" || !Held)
        return
    Held := false
    FireJarvis("up")
}

; POST the event. Non-200 → loud TrayTip, never a silent mystery. On "down" /
; "press" with nobody listening, open a tab (?jarvis=1 opens the orb chat); the
; "up" of that same hold is lost — the page was not connected yet — so hold again.
FireJarvis(action) {
    global AppUrl, JarvisKey
    subscribers := -1  ; unknown until the POST answers
    r := Http("POST", "/api/jarvis/hotkey", '{"key":"' JarvisKey '","action":"' action '"}')
    if (r.Status = 200) {
        if RegExMatch(r.Text, '"subscribers"\s*:\s*(\d+)', &m)
            subscribers := Integer(m[1])
    } else if (r.Status = 0) {
        TrayTip "Agent OS unreachable at " AppUrl " — " r.Text, "Jarvis hotkey"
    } else {
        TrayTip "Hotkey POST failed: HTTP " r.Status " — is the secret current? (re-run /api/jarvis/hotkey/setup)", "Jarvis hotkey"
    }
    if (action = "up")
        return
    if (subscribers = 0) {
        ; Zero SSE subscribers → no Agent OS page is connected anywhere.
        ; Open a tab; ?jarvis=1 makes JarvisOmnipresence open the overlay on load.
        Run AppUrl "/?jarvis=1"
    } else if (subscribers > 0) {
        ; Best-effort fronting only — on a miss the SSE-connected page fronts
        ; itself (window.focus + title flash), so failure here is fine.
        try WinActivate "Agent OS"
        catch {
            try WinActivate "Agentic OS"   ; current document.title spelling
        }
    }
}

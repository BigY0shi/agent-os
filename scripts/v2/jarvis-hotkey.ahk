; ─────────────────────────────────────────────────────────────────────────────
; Agent OS — Jarvis OS-global hotkey helper (AutoHotkey v2)  ·  SPEC-C C2/C1.4
;
; Press the configured key ANYWHERE in Windows → Agent OS opens the Jarvis
; chatbox (the page fronts itself via its SSE connection; a new browser tab is
; opened only when no page is connected).
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
AppUrl    := "http://127.0.0.1:3033"   ; where Agent OS is served
JarvisKey := "F13"                     ; the OS-global key (F13–F24 work great from macro pads)
; No F13 key? Remap CapsLock instead — swap the JarvisKey line for:
;   JarvisKey := "CapsLock"
; and uncomment the next line so CapsLock stops toggling caps:
;   SetCapsLockState "AlwaysOff"
; ─────────────────────────────────────────────────────────────────────────────

SecretPath := A_UserProfile "\.agentic-os\jarvis-hotkey.secret"
JarvisSecret := ""
try JarvisSecret := Trim(FileRead(SecretPath), " `t`r`n")
if (JarvisSecret = "")
    TrayTip "Secret missing — open Agent OS and visit /api/jarvis/hotkey/setup, then reload this script.", "Jarvis hotkey"

SetTitleMatchMode 2  ; substring window-title match

Hotkey JarvisKey, FireJarvis

FireJarvis(*) {
    global AppUrl, JarvisKey, JarvisSecret
    subscribers := -1  ; unknown until the POST answers

    ; POST via WinHttpRequest COM — AHK v2's Download() CANNOT POST
    ; (CONVENTIONS §10). Non-200 → loud TrayTip, never a silent mystery.
    try {
        req := ComObject("WinHttp.WinHttpRequest.5.1")
        req.Open("POST", AppUrl "/api/jarvis/hotkey", false)
        req.SetRequestHeader("Content-Type", "application/json")
        req.SetRequestHeader("x-agentos-hotkey-secret", JarvisSecret)
        req.Send('{"key":"' JarvisKey '"}')
        if (req.Status = 200) {
            if RegExMatch(req.ResponseText, '"subscribers"\s*:\s*(\d+)', &m)
                subscribers := Integer(m[1])
        } else {
            TrayTip "Hotkey POST failed: HTTP " req.Status " — is the secret current? (re-run /api/jarvis/hotkey/setup)", "Jarvis hotkey"
        }
    } catch as e {
        TrayTip "Agent OS unreachable at " AppUrl " — " e.Message, "Jarvis hotkey"
    }

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

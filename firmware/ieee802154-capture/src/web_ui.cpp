#include "web_ui.h"
#include "config.h"
#include "capture154.h"
#include "uplink.h"

#include <WiFi.h>
#include <WebServer.h>

namespace {

WebServer g_server(80);
char      g_ip[20] = "0.0.0.0";
char      g_ssid[33] = "";

// Single-page dashboard. Polls /api/status once a second and renders three
// cards (802.15.4 local, WiFi/BLE from Board A, sub-GHz from Board B).
const char PAGE[] PROGMEM = R"HTML(<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RF Capture Rig</title>
<style>
:root{--bg:#0b0f14;--card:#141b24;--fg:#e6edf3;--mut:#8b98a5;--acc:#3fb950;--warn:#d29922}
*{box-sizing:border-box}body{margin:0;font:15px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header{padding:16px 20px;border-bottom:1px solid #222c37;display:flex;justify-content:space-between;align-items:center}
h1{font-size:18px;margin:0}.sub{color:var(--mut);font-size:13px}
main{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));padding:20px}
.card{background:var(--card);border:1px solid #222c37;border-radius:12px;padding:16px}
.card h2{font-size:14px;margin:0 0 12px;color:var(--acc);text-transform:uppercase;letter-spacing:.05em}
.kv{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #1c2530}
.kv span:first-child{color:var(--mut)}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
th,td{text-align:left;padding:4px 6px;border-bottom:1px solid #1c2530}
th{color:var(--mut);font-weight:600}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.up{background:var(--acc)}.down{background:#6e7681}.stale{background:var(--warn)}
.leak{color:var(--warn)}
footer{color:var(--mut);font-size:12px;padding:0 20px 20px}
</style></head><body>
<header><div><h1>RF Capture Rig</h1><div class="sub" id="sub">passive · receive-only</div></div>
<div class="sub" id="clock"></div></header>
<main>
<div class="card"><h2>802.15.4 (this board)</h2><div id="z"></div>
<table id="pans"><thead><tr><th>PAN</th><th>Ch</th><th>RSSI</th><th>LQI</th><th>Frames</th></tr></thead><tbody></tbody></table></div>
<div class="card"><h2>WiFi / BLE (Board A)</h2><div id="w"></div></div>
<div class="card"><h2>Sub-GHz (Board B)</h2><div id="s"></div></div>
</main>
<footer>Lab use only. Everything shown is passively received broadcast metadata.</footer>
<script>
const kv=(k,v)=>`<div class="kv"><span>${k}</span><span>${v}</span></div>`;
const dot=(s)=>`<span class="dot ${s}"></span>`;
async function tick(){
 try{
  const r=await fetch('/api/status');const d=await r.json();
  const z=d.ieee154;
  document.getElementById('z').innerHTML=
    kv('Channel',`${z.channel} ${z.autohop?'(hopping)':'(locked)'}`)+
    kv('Frames',z.total)+kv('Beacons',z.beacons)+kv('Data',z.data)+
    kv('Acks',z.acks)+kv('Commands',z.cmds)+kv('PANs seen',z.pans.length);
  const tb=document.querySelector('#pans tbody');tb.innerHTML='';
  z.pans.forEach(p=>{tb.innerHTML+=`<tr><td>${p.pan}</td><td>${p.channel}</td><td>${p.rssi}</td><td>${p.lqi}</td><td>${p.frames}</td></tr>`});
  const w=d.wifi;const ws=w.seen?(w.ageMs<8000?'up':'stale'):'down';
  document.getElementById('w').innerHTML=
    kv('Link',`${dot(ws)}${w.seen?(w.ageMs<8000?'up':'stale'):'not connected'}`)+
    kv('WiFi channel',w.channel)+kv('Access points',w.aps)+kv('Stations',w.stations)+
    kv('BLE devices',w.ble)+kv('Probe requests',w.probes)+
    `<div class="kv"><span>Privacy leaks</span><span class="leak">${w.leaks}</span></div>`;
  const s=d.subghz;const ss=(w.seen&&s.alive)?'up':(w.seen?'stale':'down');
  document.getElementById('s').innerHTML=
    kv('Link',`${dot(ss)}${w.seen?(s.alive?'up':'idle'):'not connected'}`)+
    kv('Energy peak',s.peakKhz?`${(s.peakKhz/1000).toFixed(2)} MHz`:'-')+
    kv('Peak RSSI',s.peakKhz?`${s.peakRssi} dBm`:'-')+kv('OOK bursts',s.ookBursts);
  document.getElementById('clock').textContent=new Date().toLocaleTimeString();
 }catch(e){document.getElementById('sub').textContent='reconnecting...'}
}
setInterval(tick,1000);tick();
</script></body></html>)HTML";

void handleRoot() {
  g_server.send_P(200, "text/html", PAGE);
}

void appendJsonPans(String& j) {
  j += "\"pans\":[";
  uint16_t n = ieee154PanCount();
  for (uint16_t i = 0; i < n; i++) {
    const Pan154* p = ieee154PanAt(i);
    if (!p) break;
    char item[96];
    snprintf(item, sizeof(item),
             "%s{\"pan\":\"0x%04X\",\"channel\":%u,\"rssi\":%d,\"lqi\":%u,\"frames\":%lu}",
             i ? "," : "", p->panId, p->channel, p->rssi, p->lqi,
             (unsigned long)p->frames);
    j += item;
  }
  j += "]";
}

void handleStatus() {
  Stats154 st = ieee154Stats();
  UpstreamState up = uplinkState();
  uint32_t ageMs = up.seen ? (millis() - up.lastMs) : 0xFFFFFFFF;

  String j;
  j.reserve(1024);
  char head[256];
  snprintf(head, sizeof(head),
           "{\"ieee154\":{\"channel\":%u,\"autohop\":%s,\"total\":%lu,"
           "\"beacons\":%lu,\"data\":%lu,\"acks\":%lu,\"cmds\":%lu,",
           ieee154Channel(), ieee154AutoHop() ? "true" : "false",
           (unsigned long)st.total, (unsigned long)st.beacons,
           (unsigned long)st.data, (unsigned long)st.acks,
           (unsigned long)st.cmds);
  j += head;
  appendJsonPans(j);
  j += "},";

  char tail[384];
  snprintf(tail, sizeof(tail),
           "\"wifi\":{\"seen\":%s,\"ageMs\":%lu,\"channel\":%u,\"aps\":%u,"
           "\"stations\":%u,\"ble\":%u,\"probes\":%lu,\"leaks\":%lu},"
           "\"subghz\":{\"alive\":%s,\"peakKhz\":%ld,\"peakRssi\":%d,\"ookBursts\":%lu}}",
           up.seen ? "true" : "false", (unsigned long)ageMs, up.wifiChannel,
           up.aps, up.stations, up.ble, (unsigned long)up.probes,
           (unsigned long)up.leaks,
           up.subghzAlive ? "true" : "false", up.subghzPeakKhz,
           up.subghzPeakRssi, (unsigned long)up.subghzOokBursts);
  j += tail;

  g_server.send(200, "application/json", j);
}

}  // namespace

void webBegin() {
#if WIFI_USE_STA
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASSWORD);
  strncpy(g_ssid, WIFI_STA_SSID, sizeof(g_ssid) - 1);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 8000) delay(100);
  strncpy(g_ip, WiFi.localIP().toString().c_str(), sizeof(g_ip) - 1);
#else
  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASSWORD);
  strncpy(g_ssid, WIFI_AP_SSID, sizeof(g_ssid) - 1);
  strncpy(g_ip, WiFi.softAPIP().toString().c_str(), sizeof(g_ip) - 1);
#endif

  g_server.on("/", handleRoot);
  g_server.on("/api/status", handleStatus);
  g_server.begin();
}

void webPump() { g_server.handleClient(); }
const char* webIp() { return g_ip; }
const char* webSsid() { return g_ssid; }

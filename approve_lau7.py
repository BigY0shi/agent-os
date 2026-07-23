import http.client, json, os

COMPANY_ID = "5fa016fc-29df-4e8d-b278-efe0d3682488"
ISSUE_ID   = "08b66130-68af-40e7-9c54-e9f95813f62e"

payload = json.dumps({
    "status": "done",
    "comment": "Approved by Alpha (CEO) on behalf of the principal. The CTO subagent roster and draft SOUL.md documents in the LAU-7 plan are accepted. Implementation may proceed — the 10 specialist worker agents can now be created in the Paperclip registry as follow-up child issues."
})

conn = http.client.HTTPConnection("127.0.0.1", 3100, timeout=15)
headers = {
    "Authorization": "Bearer " + os.environ["PAPERCLIP_API_KEY"],
    "X-Paperclip-Run-Id": os.environ["PAPERCLIP_RUN_ID"],
    "Content-Type": "application/json"
}

conn.request("PATCH", "/api/companies/" + COMPANY_ID + "/issues/" + ISSUE_ID, body=payload, headers=headers)
resp = conn.getresponse()
print("Status:", resp.status)
print(resp.read().decode("utf-8"))

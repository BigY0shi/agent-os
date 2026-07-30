#!/usr/bin/env python3
"""Idea Engine — Google Trends adapter (pytrends). Called by the dashboard with
seed terms as argv; prints ONE JSON object to stdout:
  {"ok": true, "terms": {"<term>": {"growth_pct": 34.2, "latest": 71, "rising": ["q1", ...]}}}
Growth = last-90-day mean vs prior-90-day mean of weekly interest. Rising =
pytrends related_queries "rising" strings. Any per-term failure is recorded
under "errors" — one bad term never kills the scan.
"""
import json
import sys
import time


def main() -> int:
    terms = [t.strip() for t in sys.argv[1:] if t.strip()][:10]
    if not terms:
        print(json.dumps({"ok": False, "error": "no seed terms"}))
        return 1
    try:
        from pytrends.request import TrendReq
    except ImportError:
        print(json.dumps({"ok": False, "error": "pytrends not installed"}))
        return 1

    out = {"ok": True, "terms": {}, "errors": {}}
    try:
        py = TrendReq(hl="en-US", tz=0, timeout=(10, 25))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"TrendReq init: {e}"}))
        return 1

    for term in terms:
        try:
            py.build_payload([term], timeframe="today 12-m")
            df = py.interest_over_time()
            if df is None or df.empty:
                out["errors"][term] = "no data"
                continue
            series = df[term].tolist()
            half = max(1, len(series) // 4)  # ~90d windows on weekly data
            recent = series[-half:]
            prior = series[-2 * half:-half] or [0]
            r_mean = sum(recent) / len(recent)
            p_mean = sum(prior) / len(prior)
            growth = ((r_mean - p_mean) / p_mean * 100.0) if p_mean > 0 else (100.0 if r_mean > 0 else 0.0)
            rising = []
            try:
                rq = py.related_queries()
                rdf = (rq.get(term) or {}).get("rising")
                if rdf is not None and not rdf.empty:
                    rising = rdf["query"].head(8).tolist()
            except Exception:  # noqa: BLE001
                pass
            out["terms"][term] = {
                "growth_pct": round(growth, 1),
                "latest": int(series[-1]) if series else 0,
                "rising": rising,
            }
            time.sleep(1.2)  # politeness — Trends 429s fast
        except Exception as e:  # noqa: BLE001
            out["errors"][term] = str(e)[:120]

    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())

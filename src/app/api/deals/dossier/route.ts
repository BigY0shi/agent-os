import { getDeal, setDossier } from "@/lib/upworkDesk";
import { generateDossier, dossierInputs } from "@/lib/dealDossier";
import { dossierInputHash, dossierIsStale } from "@/lib/dealDeskControl";
import { startModuleRun } from "@/lib/moduleRuns";
import { HttpError, runErrorResponse } from "@/lib/runRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET ?id=... → the card's dossier and whether it still matches its inputs.
//
// Staleness is answered here rather than in the browser because the hash is computed
// from the same helper the writer uses; two implementations of "is this current?" is
// exactly how a stale account gets used without anyone noticing.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  const deal = await getDeal(id);
  if (!deal) return Response.json({ ok: false, error: "deal not found" }, { status: 404 });
  const hash = dossierInputHash(dossierInputs(deal));
  return Response.json({
    ok: true,
    dossier: deal.dossier ?? null,
    stale: dossierIsStale(deal.dossier, hash),
  });
}

// POST { id, force? } → build the dossier for this card.
//
// The proposal route builds one on demand anyway; this exists so the owner can read and
// correct the account BEFORE a proposal is written, which is the whole point of keeping
// it as data rather than as an agent's private context.
export async function POST(req: Request) {
  const { id, force } = (await req.json().catch(() => ({}))) as { id?: string; force?: boolean };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const deal = await getDeal(id);
  if (!deal) return Response.json({ ok: false, error: "deal not found" }, { status: 404 });

  const hash = dossierInputHash(dossierInputs(deal));
  if (!force && deal.dossier && !dossierIsStale(deal.dossier, hash)) {
    return Response.json({ ok: true, dossier: deal.dossier, stale: false, rebuilt: false });
  }

  const moduleRun = startModuleRun(
    { module: "deals", label: `Dossier: ${deal.title}`, href: "/deals" },
    async (ctx) => {
      ctx.log("reading the listing, the notes and the Q&A");
      const dossier = await generateDossier(deal, ctx.signal);
      // Nothing is persisted on failure: a card with no dossier is a card the proposal
      // path knows to build one for, whereas an empty one would read as "this listing
      // asks for nothing" and quietly license a draft that answers no questions.
      if (!dossier) throw new HttpError(502, "the dossier pass returned nothing usable");
      if (ctx.signal.aborted) throw new Error("stopped before the dossier was saved");
      await setDossier(id, dossier);
      ctx.log(`${dossier.asks.length} asks, ${dossier.gaps.length} gaps${dossier.openWith ? `, must open with "${dossier.openWith}"` : ""}`);
      return dossier;
    },
    { summarize: (d) => ({ id, asks: d.asks.length, gaps: d.gaps.length, openWith: !!d.openWith }) },
  );

  try {
    const dossier = await moduleRun.promise;
    return Response.json({ ok: true, dossier, stale: false, rebuilt: true, runId: moduleRun.id });
  } catch (e) {
    return runErrorResponse(e, moduleRun.id);
  }
}

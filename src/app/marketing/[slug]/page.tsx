import CampaignDetail from "@/components/v2/marketing/CampaignDetail";

// SPEC-F J1.1 — the campaign detail page. Tabs land here from the hub cards.
export default async function CampaignRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div className="pb-6">
      <CampaignDetail slug={slug} />
    </div>
  );
}

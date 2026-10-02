import RabbitView from "@/components/v2/rabbit/RabbitView";

// /rabbit — the Rabbit R1 bridge module: what the handheld is asking right
// now (live turns), every past session with its transcript, archive/restore,
// and the gear that holds the connection details + every bridge knob.

export const metadata = { title: "Rabbit R1 · Agentic OS" };

export default function RabbitRoute() {
  return (
    <div className="min-h-[calc(100vh-220px)]">
      <RabbitView />
    </div>
  );
}

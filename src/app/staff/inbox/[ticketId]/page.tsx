import { TicketPanel } from "@/staff-ui/ticket-panel";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  return <TicketPanel ticketId={ticketId} />;
}

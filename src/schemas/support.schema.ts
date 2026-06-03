import { z } from "zod";

export const createTicketSchema = z.object({
  subject: z.string().min(1),
  message: z.string().min(1),
});

export const replyTicketSchema = z.object({
  ticketId: z.string().uuid(),
  message: z.string().min(1),
});

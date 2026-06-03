import { z } from "zod";

export const openTradeSchema = z.object({
  accountId: z.string().uuid(),
  symbol: z.string().min(2),
  direction: z.enum(["LONG", "SHORT", "BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT", "STOP"]),
  size: z.number().positive(),
  triggerPrice: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  leverage: z.number().positive().optional(),
});

export const closeTradeSchema = z.object({
  tradeId: z.string().uuid(),
});

export const cancelPendingOrderSchema = z.object({
  tradeId: z.string().uuid(),
});

export const requestUserPayoutSchema = z.object({
  accountId: z.string().uuid(),
  amount: z.number().positive(),
  method: z.string(),
  details: z.string(),
});

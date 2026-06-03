import { z } from "zod";

export const purchaseChallengeSchema = z.object({
  userId: z.string().uuid(),
  challengeRuleId: z.string().uuid(),
  gateway: z.enum(["OXAPAY", "RAZORPAY", "CRYPTO"]), // Added crypto as fallback enum
  couponCode: z.string().optional(),
});

export const oxapayWebhookSchema = z.object({
  trackId: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  amount: z.union([z.number(), z.string()]).transform(Number),
}).passthrough();

export const razorpayWebhookSchema = z.object({
  event: z.string(),
  payload: z.any(),
}).passthrough();

export const verifyRazorpaySchema = z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
}).passthrough();

export const validateCouponSchema = z.object({
  code: z.string(),
  challengeRuleId: z.string().uuid(),
});

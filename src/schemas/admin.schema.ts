import { z } from "zod";

export const toggleGateSchema = z.object({
  isOpen: z.boolean(),
});

export const updateSystemConfigSchema = z.object({
  maxLeverage: z.number().positive().optional(),
  marginCallPercent: z.number().positive().optional(),
  stopOutPercent: z.number().positive().optional(),
});

export const updateEmailTemplateSchema = z.object({
  key: z.string(),
  subject: z.string(),
  htmlPayload: z.string(),
});

export const toggleUserAdminStatusSchema = z.object({
  userId: z.string().uuid(),
  isAdmin: z.boolean(),
});

export const assignChallengePlanSchema = z.object({
  userId: z.string().uuid(),
  challengeRuleId: z.string().uuid(),
});

export const updateUserProfileSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().optional(),
  email: z.string().email().optional(),
  kycStatus: z.string().optional(),
});

export const suspendUserAccountSchema = z.object({
  userId: z.string().uuid(),
  suspend: z.boolean(),
  reason: z.string().optional(),
});

export const suspendChallengePlanSchema = z.object({
  accountId: z.string().uuid(),
});

export const liftChallengePlanBreachSchema = z.object({
  accountId: z.string().uuid(),
});

export const impersonateUserSessionSchema = z.object({
  userId: z.string().uuid(),
});

export const createChallengeRuleSchema = z.object({
  type: z.enum(["INSTANT", "ONE_STEP", "TWO_STEP", "FUNDED"]),
  tierName: z.string(),
  size: z.number().positive(),
  price: z.number().positive(),
  profitTargetPercent: z.number(),
  dailyDrawdownPercent: z.number(),
  maxLossPercent: z.number(),
  minTradingDays: z.number(),
  leverage: z.number().positive().optional(),
});

export const updateChallengeRuleSchema = createChallengeRuleSchema.extend({
  id: z.string().uuid(),
});

export const deleteChallengeRuleSchema = z.object({
  id: z.string().uuid(),
});

export const createMarketSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  logoUrl: z.string().optional(),
});

export const deleteMarketSchema = z.object({
  symbol: z.string(),
});

export const payoutActionSchema = z.object({
  payoutId: z.string().uuid(),
});

export const updateWebConfigSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export const createInfluencerSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  platform: z.string(),
  handle: z.string(),
  affiliateCode: z.string(),
  commissionRate: z.number().min(0).max(100),
});

export const sendBulkEmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export const createCouponSchema = z.object({
  code: z.string(),
  discountType: z.enum(["PERCENT", "FIXED"]),
  discountValue: z.number().positive(),
  maxUses: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
});

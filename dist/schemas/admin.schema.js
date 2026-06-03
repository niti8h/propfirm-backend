"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCouponSchema = exports.sendBulkEmailSchema = exports.createInfluencerSchema = exports.updateWebConfigSchema = exports.payoutActionSchema = exports.deleteMarketSchema = exports.createMarketSchema = exports.deleteChallengeRuleSchema = exports.updateChallengeRuleSchema = exports.createChallengeRuleSchema = exports.impersonateUserSessionSchema = exports.liftChallengePlanBreachSchema = exports.suspendChallengePlanSchema = exports.suspendUserAccountSchema = exports.updateUserProfileSchema = exports.assignChallengePlanSchema = exports.toggleUserAdminStatusSchema = exports.updateEmailTemplateSchema = exports.updateSystemConfigSchema = exports.toggleGateSchema = void 0;
const zod_1 = require("zod");
exports.toggleGateSchema = zod_1.z.object({
    isOpen: zod_1.z.boolean(),
});
exports.updateSystemConfigSchema = zod_1.z.object({
    maxLeverage: zod_1.z.number().positive().optional(),
    marginCallPercent: zod_1.z.number().positive().optional(),
    stopOutPercent: zod_1.z.number().positive().optional(),
});
exports.updateEmailTemplateSchema = zod_1.z.object({
    key: zod_1.z.string(),
    subject: zod_1.z.string(),
    htmlPayload: zod_1.z.string(),
});
exports.toggleUserAdminStatusSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    isAdmin: zod_1.z.boolean(),
});
exports.assignChallengePlanSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    challengeRuleId: zod_1.z.string().uuid(),
});
exports.updateUserProfileSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    fullName: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional(),
    kycStatus: zod_1.z.string().optional(),
});
exports.suspendUserAccountSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    suspend: zod_1.z.boolean(),
    reason: zod_1.z.string().optional(),
});
exports.suspendChallengePlanSchema = zod_1.z.object({
    accountId: zod_1.z.string().uuid(),
});
exports.liftChallengePlanBreachSchema = zod_1.z.object({
    accountId: zod_1.z.string().uuid(),
});
exports.impersonateUserSessionSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
});
exports.createChallengeRuleSchema = zod_1.z.object({
    type: zod_1.z.enum(["INSTANT", "ONE_STEP", "TWO_STEP", "FUNDED"]),
    tierName: zod_1.z.string(),
    size: zod_1.z.number().positive(),
    price: zod_1.z.number().positive(),
    profitTargetPercent: zod_1.z.number(),
    dailyDrawdownPercent: zod_1.z.number(),
    maxLossPercent: zod_1.z.number(),
    minTradingDays: zod_1.z.number(),
    leverage: zod_1.z.number().positive().optional(),
});
exports.updateChallengeRuleSchema = exports.createChallengeRuleSchema.extend({
    id: zod_1.z.string().uuid(),
});
exports.deleteChallengeRuleSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
});
exports.createMarketSchema = zod_1.z.object({
    symbol: zod_1.z.string(),
    name: zod_1.z.string(),
    logoUrl: zod_1.z.string().optional(),
});
exports.deleteMarketSchema = zod_1.z.object({
    symbol: zod_1.z.string(),
});
exports.payoutActionSchema = zod_1.z.object({
    payoutId: zod_1.z.string().uuid(),
});
exports.updateWebConfigSchema = zod_1.z.object({
    key: zod_1.z.string(),
    value: zod_1.z.string(),
});
exports.createInfluencerSchema = zod_1.z.object({
    name: zod_1.z.string(),
    email: zod_1.z.string().email(),
    platform: zod_1.z.string(),
    handle: zod_1.z.string(),
    affiliateCode: zod_1.z.string(),
    commissionRate: zod_1.z.number().min(0).max(100),
});
exports.sendBulkEmailSchema = zod_1.z.object({
    subject: zod_1.z.string(),
    body: zod_1.z.string(),
});
exports.createCouponSchema = zod_1.z.object({
    code: zod_1.z.string(),
    discountType: zod_1.z.enum(["PERCENT", "FIXED"]),
    discountValue: zod_1.z.number().positive(),
    maxUses: zod_1.z.number().int().positive().optional(),
    expiresAt: zod_1.z.string().datetime().optional(),
});

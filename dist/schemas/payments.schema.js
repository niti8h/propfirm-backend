"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCouponSchema = exports.verifyRazorpaySchema = exports.razorpayWebhookSchema = exports.oxapayWebhookSchema = exports.purchaseChallengeSchema = void 0;
const zod_1 = require("zod");
exports.purchaseChallengeSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    challengeRuleId: zod_1.z.string().uuid(),
    gateway: zod_1.z.enum(["OXAPAY", "RAZORPAY", "CRYPTO"]), // Added crypto as fallback enum
    couponCode: zod_1.z.string().optional(),
});
exports.oxapayWebhookSchema = zod_1.z.object({
    trackId: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).transform(String),
    status: zod_1.z.string(),
    amount: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]).transform(Number),
}).passthrough();
exports.razorpayWebhookSchema = zod_1.z.object({
    event: zod_1.z.string(),
    payload: zod_1.z.any(),
}).passthrough();
exports.verifyRazorpaySchema = zod_1.z.object({
    razorpay_order_id: zod_1.z.string(),
    razorpay_payment_id: zod_1.z.string(),
    razorpay_signature: zod_1.z.string(),
}).passthrough();
exports.validateCouponSchema = zod_1.z.object({
    code: zod_1.z.string(),
    challengeRuleId: zod_1.z.string().uuid(),
});

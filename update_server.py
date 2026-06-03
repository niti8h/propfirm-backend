import re

with open('src/server.ts', 'r') as f:
    content = f.read()

# Add imports
imports = """
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { validate } from "./middlewares/validate";
import { signupSchema, loginSchema } from "./schemas/auth.schema";
import { purchaseChallengeSchema, oxapayWebhookSchema, razorpayWebhookSchema, verifyRazorpaySchema, validateCouponSchema } from "./schemas/payments.schema";
import { openTradeSchema, closeTradeSchema, cancelPendingOrderSchema, requestUserPayoutSchema } from "./schemas/trading.schema";
import { createTicketSchema, replyTicketSchema } from "./schemas/support.schema";
import { toggleGateSchema, updateSystemConfigSchema, updateEmailTemplateSchema, toggleUserAdminStatusSchema, assignChallengePlanSchema, updateUserProfileSchema, suspendUserAccountSchema, suspendChallengePlanSchema, liftChallengePlanBreachSchema, impersonateUserSessionSchema, createChallengeRuleSchema, updateChallengeRuleSchema, deleteChallengeRuleSchema, createMarketSchema, deleteMarketSchema, payoutActionSchema, updateWebConfigSchema, createInfluencerSchema, sendBulkEmailSchema, createCouponSchema } from "./schemas/admin.schema";
"""

content = re.sub(r'(import dotenv from "dotenv";)', r'\1\n' + imports, content)

# Add middlewares
middlewares = """
// Security Middlewares
app.use(helmet());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Too many requests from this IP, please try again after 15 minutes" }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many login/signup attempts, please try again after 15 minutes" }
});

app.use(globalLimiter);
"""

content = re.sub(r'(app\.use\(express\.json\(\)\);)', r'\1\n' + middlewares, content)

# Replace Auth
content = content.replace('app.post("/api/auth/signup", signup);', 'app.post("/api/auth/signup", authLimiter, validate(signupSchema), signup);')
content = content.replace('app.post("/api/auth/login", login);', 'app.post("/api/auth/login", authLimiter, validate(loginSchema), login);')

# Replace Payments
content = content.replace('app.post("/api/webhooks/oxapay", express.json(), handleOxapayCallback);', 'app.post("/api/webhooks/oxapay", express.json(), validate(oxapayWebhookSchema), handleOxapayCallback);')
content = content.replace('app.post("/api/payments/verify-razorpay", authenticateToken, verifyRazorpay);', 'app.post("/api/payments/verify-razorpay", authenticateToken, validate(verifyRazorpaySchema), verifyRazorpay);')
content = content.replace('app.post("/api/payments/purchase", authenticateToken, purchaseChallenge);', 'app.post("/api/payments/purchase", authenticateToken, validate(purchaseChallengeSchema), purchaseChallenge);')
content = content.replace('app.post("/api/payments/coupon/validate", authenticateToken, validateCoupon);', 'app.post("/api/payments/coupon/validate", authenticateToken, validate(validateCouponSchema), validateCoupon);')

# Replace Trading
content = content.replace('app.post("/api/trading/open", authenticateToken, openTrade);', 'app.post("/api/trading/open", authenticateToken, validate(openTradeSchema), openTrade);')
content = content.replace('app.post("/api/trading/close", authenticateToken, closeTrade);', 'app.post("/api/trading/close", authenticateToken, validate(closeTradeSchema), closeTrade);')
content = content.replace('app.post("/api/trading/cancel", authenticateToken, cancelPendingOrder);', 'app.post("/api/trading/cancel", authenticateToken, validate(cancelPendingOrderSchema), cancelPendingOrder);')
content = content.replace('app.post("/api/trading/payout/request", authenticateToken, requestUserPayout);', 'app.post("/api/trading/payout/request", authenticateToken, validate(requestUserPayoutSchema), requestUserPayout);')

# Replace Support
content = content.replace('app.post("/api/support/tickets", authenticateToken, userCreateTicket);', 'app.post("/api/support/tickets", authenticateToken, validate(createTicketSchema), userCreateTicket);')
content = content.replace('app.post("/api/support/tickets/reply", authenticateToken, userReplyTicket);', 'app.post("/api/support/tickets/reply", authenticateToken, validate(replyTicketSchema), userReplyTicket);')

# Replace Admin
content = content.replace('app.post("/api/admin/toggle-gate", authenticateToken, toggleMarketGate);', 'app.post("/api/admin/toggle-gate", authenticateToken, validate(toggleGateSchema), toggleMarketGate);')
content = content.replace('app.post("/api/admin/config", authenticateToken, updateSystemConfig);', 'app.post("/api/admin/config", authenticateToken, validate(updateSystemConfigSchema), updateSystemConfig);')
content = content.replace('app.post("/api/admin/template", authenticateToken, updateEmailTemplate);', 'app.post("/api/admin/template", authenticateToken, validate(updateEmailTemplateSchema), updateEmailTemplate);')

content = content.replace('app.post("/api/admin/users/toggle-admin", authenticateToken, toggleUserAdminStatus);', 'app.post("/api/admin/users/toggle-admin", authenticateToken, validate(toggleUserAdminStatusSchema), toggleUserAdminStatus);')
content = content.replace('app.post("/api/admin/users/assign-plan", authenticateToken, assignChallengePlan);', 'app.post("/api/admin/users/assign-plan", authenticateToken, validate(assignChallengePlanSchema), assignChallengePlan);')
content = content.replace('app.post("/api/admin/users/update", authenticateToken, updateUserProfile);', 'app.post("/api/admin/users/update", authenticateToken, validate(updateUserProfileSchema), updateUserProfile);')
content = content.replace('app.post("/api/admin/users/suspend", authenticateToken, suspendUserAccount);', 'app.post("/api/admin/users/suspend", authenticateToken, validate(suspendUserAccountSchema), suspendUserAccount);')
content = content.replace('app.post("/api/admin/accounts/suspend", authenticateToken, suspendChallengePlan);', 'app.post("/api/admin/accounts/suspend", authenticateToken, validate(suspendChallengePlanSchema), suspendChallengePlan);')
content = content.replace('app.post("/api/admin/accounts/lift-breach", authenticateToken, liftChallengePlanBreach);', 'app.post("/api/admin/accounts/lift-breach", authenticateToken, validate(liftChallengePlanBreachSchema), liftChallengePlanBreach);')
content = content.replace('app.post("/api/admin/users/impersonate", authenticateToken, impersonateUserSession);', 'app.post("/api/admin/users/impersonate", authenticateToken, validate(impersonateUserSessionSchema), impersonateUserSession);')

content = content.replace('app.post("/api/admin/challenges/create", authenticateToken, createChallengeRule);', 'app.post("/api/admin/challenges/create", authenticateToken, validate(createChallengeRuleSchema), createChallengeRule);')
content = content.replace('app.post("/api/admin/challenges/update", authenticateToken, updateChallengeRule);', 'app.post("/api/admin/challenges/update", authenticateToken, validate(updateChallengeRuleSchema), updateChallengeRule);')
content = content.replace('app.post("/api/admin/challenges/delete", authenticateToken, deleteChallengeRule);', 'app.post("/api/admin/challenges/delete", authenticateToken, validate(deleteChallengeRuleSchema), deleteChallengeRule);')

content = content.replace('app.post("/api/admin/markets/create", authenticateToken, createMarket);', 'app.post("/api/admin/markets/create", authenticateToken, validate(createMarketSchema), createMarket);')
content = content.replace('app.post("/api/admin/markets/delete", authenticateToken, deleteMarket);', 'app.post("/api/admin/markets/delete", authenticateToken, validate(deleteMarketSchema), deleteMarket);')

content = content.replace('app.post("/api/admin/payouts/approve", authenticateToken, approvePayout);', 'app.post("/api/admin/payouts/approve", authenticateToken, validate(payoutActionSchema), approvePayout);')
content = content.replace('app.post("/api/admin/payouts/reject", authenticateToken, rejectPayout);', 'app.post("/api/admin/payouts/reject", authenticateToken, validate(payoutActionSchema), rejectPayout);')

content = content.replace('app.post("/api/admin/tickets/reply", authenticateToken, adminReplyTicket);', 'app.post("/api/admin/tickets/reply", authenticateToken, validate(replyTicketSchema), adminReplyTicket);')

content = content.replace('app.post("/api/admin/web-config", authenticateToken, updateWebConfig);', 'app.post("/api/admin/web-config", authenticateToken, validate(updateWebConfigSchema), updateWebConfig);')

content = content.replace('app.post("/api/admin/marketing/influencers", authenticateToken, createInfluencer);', 'app.post("/api/admin/marketing/influencers", authenticateToken, validate(createInfluencerSchema), createInfluencer);')
content = content.replace('app.post("/api/admin/marketing/bulk-email", authenticateToken, sendBulkEmail);', 'app.post("/api/admin/marketing/bulk-email", authenticateToken, validate(sendBulkEmailSchema), sendBulkEmail);')

content = content.replace('app.post("/api/admin/coupons", authenticateToken, createCoupon);', 'app.post("/api/admin/coupons", authenticateToken, validate(createCouponSchema), createCoupon);')

with open('src/server.ts', 'w') as f:
    f.write(content)

print("Server updated successfully")

import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";

import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { validate } from "./middlewares/validate";
import { signupSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from "./schemas/auth.schema";
import { purchaseChallengeSchema, oxapayWebhookSchema, razorpayWebhookSchema, verifyRazorpaySchema, validateCouponSchema } from "./schemas/payments.schema";
import { openTradeSchema, closeTradeSchema, cancelPendingOrderSchema, requestUserPayoutSchema } from "./schemas/trading.schema";
import { createTicketSchema, replyTicketSchema } from "./schemas/support.schema";
import { toggleGateSchema, updateSystemConfigSchema, updateEmailTemplateSchema, toggleUserAdminStatusSchema, assignChallengePlanSchema, updateUserProfileSchema, suspendUserAccountSchema, suspendChallengePlanSchema, liftChallengePlanBreachSchema, impersonateUserSessionSchema, createChallengeRuleSchema, updateChallengeRuleSchema, deleteChallengeRuleSchema, createMarketSchema, deleteMarketSchema, payoutActionSchema, updateWebConfigSchema, createInfluencerSchema, sendBulkEmailSchema, createCouponSchema } from "./schemas/admin.schema";

import { prisma } from "./db";
import { startBinanceSync, registerOnTick, matchLimitOrders, priceMap } from "./binanceSync";
import { startRiskGuardianDaemon } from "./riskGuardian";
import { initializeWebSocketServer, broadcastTickerUpdate } from "./websocket";

// Controllers
import { signup, login, authenticateToken, getUserProfile, forgotPassword, resetPassword } from "./controllers/auth";
import {
  purchaseChallenge,
  handleOxapayCallback,
  verifyRazorpay,
} from "./controllers/payments";
import {
  openTrade,
  closeTrade,
  cancelPendingOrder,
  getUserAccounts,
  getMarkets,
} from "./controllers/trading";
import {
  toggleMarketGate,
  updateSystemConfig,
  updateEmailTemplate,
  getAdminDashboardSettings,
  // NEW admin controller exports
  getUsersList,
  getUserDetail,
  toggleUserAdminStatus,
  assignChallengePlan,
  updateUserProfile,
  suspendUserAccount,
  suspendChallengePlan,
  liftChallengePlanBreach,
  impersonateUserSession,
  createChallengeRule,
  updateChallengeRule,
  deleteChallengeRule,
  getChallengePurchases,
  getAllPayments,
  requestUserPayout,
  getAllPayouts,
  approvePayout,
  rejectPayout,
  getAdminTickets,
  adminReplyTicket,
  getUserTickets,
  userCreateTicket,
  userReplyTicket,
  getWebConfigs,
  updateWebConfig,
  getInfluencers,
  createInfluencer,
  sendBulkEmail,
  getCoupons,
  createCoupon,
  createMarket,
  deleteMarket,
  restartBinanceFeed,
  validateCoupon,
} from "./controllers/admin";

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors({ origin: "*" }));
app.use(express.json());

// Security Middlewares
app.use(helmet());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  message: { error: "Too many requests from this IP, please try again after 15 minutes" }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many login/signup attempts, please try again after 15 minutes" }
});

app.use(globalLimiter);


// ==========================================
// PUBLIC ROUTES
// ==========================================

// Auth
app.post("/api/auth/signup", authLimiter, validate(signupSchema), signup);
app.post("/api/auth/login", authLimiter, validate(loginSchema), login);
app.post("/api/auth/forgot-password", authLimiter, validate(forgotPasswordSchema), forgotPassword);
app.post("/api/auth/reset-password", authLimiter, validate(resetPasswordSchema), resetPassword);

// Challenges List (Public frontend pricing grid)
app.get("/api/challenges", async (req, res) => {
  try {
    const challenges = await prisma.challengeRule.findMany({
      where: { active: true },
    });
    return res.json(challenges);
  } catch (error) {
    return res.status(500).json({ error: "Failed to load pricing packages." });
  }
});

// Payment & Webhooks
app.post("/api/webhooks/oxapay", express.json(), validate(oxapayWebhookSchema), handleOxapayCallback);

// Synchronous Razorpay Verification
app.post("/api/payments/verify-razorpay", authenticateToken, validate(verifyRazorpaySchema), verifyRazorpay);

import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

// Public Binance Markets API Proxy (with local websocket fallbacks)
app.get("/api/markets/binance-tickers", async (req, res) => {
  try {
    const { stdout } = await execAsync("curl -s https://api.binance.com/api/v3/ticker/price");
    const tickers = JSON.parse(stdout);
    if (!Array.isArray(tickers)) {
      throw new Error("Binance API returned non-array response");
    }
    const filtered = tickers.filter((t: any) => t.symbol.endsWith("USDT"));
    return res.json(filtered);
  } catch (err: any) {
    console.error("Binance Fetch Error:", err.message || err);
    // If request fails or offline, fallback to in-memory ticks
    const fallback = [
      { symbol: "BTCUSDT", price: priceMap.get("BTCUSDT")?.toString() || "65000.00" },
      { symbol: "ETHUSDT", price: priceMap.get("ETHUSDT")?.toString() || "3400.00" },
      { symbol: "SOLUSDT", price: priceMap.get("SOLUSDT")?.toString() || "160.00" },
    ];
    return res.json(fallback);
  }
});

// ==========================================
// PROTECTED CLIENT ROUTES
// ==========================================
app.post("/api/payments/purchase", authenticateToken, validate(purchaseChallengeSchema), purchaseChallenge);
app.post("/api/payments/coupon/validate", authenticateToken, validate(validateCouponSchema), validateCoupon);
app.post("/api/trading/open", authenticateToken, validate(openTradeSchema), openTrade);
app.post("/api/trading/close", authenticateToken, validate(closeTradeSchema), closeTrade);
app.post("/api/trading/cancel", authenticateToken, validate(cancelPendingOrderSchema), cancelPendingOrder);
app.get("/api/trading/accounts/:userId", authenticateToken, getUserAccounts);
app.get("/api/trading/markets", authenticateToken, getMarkets);
app.get("/api/users/profile", authenticateToken, getUserProfile);

// Payout request (User facing)
app.post("/api/trading/payout/request", authenticateToken, validate(requestUserPayoutSchema), requestUserPayout);

// Support tickets (User facing)
app.get("/api/support/tickets/:userId", authenticateToken, getUserTickets);
app.post("/api/support/tickets", authenticateToken, validate(createTicketSchema), userCreateTicket);
app.post("/api/support/tickets/reply", authenticateToken, validate(replyTicketSchema), userReplyTicket);

// Fetch active positions and history for UI charts
app.get("/api/trading/account/:accountId", authenticateToken, async (req, res) => {
  try {
    const { accountId } = req.params;
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      include: { challengeRule: true },
    });
    if (!account) return res.status(404).json({ error: "Account not found" });

    const openPositions = await prisma.trade.findMany({
      where: { accountId, status: "OPEN" },
      orderBy: { openTime: "desc" },
    });

    const pendingOrders = await prisma.trade.findMany({
      where: { accountId, status: "PENDING" },
      orderBy: { openTime: "desc" },
    });

    const completedHistory = await prisma.trade.findMany({
      where: { accountId, status: { in: ["CLOSED", "CANCELLED"] } },
      orderBy: { openTime: "desc" },
    });

    return res.json({
      account,
      openPositions,
      pendingOrders,
      completedHistory,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to load account ledger details" });
  }
});

// ==========================================
// ADMIN CONTROL COMMANDS
// ==========================================
app.post("/api/admin/toggle-gate", authenticateToken, validate(toggleGateSchema), toggleMarketGate);
app.post("/api/admin/config", authenticateToken, validate(updateSystemConfigSchema), updateSystemConfig);
app.post("/api/admin/template", authenticateToken, validate(updateEmailTemplateSchema), updateEmailTemplate);
app.get("/api/admin/settings", authenticateToken, getAdminDashboardSettings);

// User lists, direct plans assignment and admin overrides
app.get("/api/admin/users", authenticateToken, getUsersList);
app.get("/api/admin/users/:userId", authenticateToken, getUserDetail);
app.post("/api/admin/users/toggle-admin", authenticateToken, validate(toggleUserAdminStatusSchema), toggleUserAdminStatus);
app.post("/api/admin/users/assign-plan", authenticateToken, validate(assignChallengePlanSchema), assignChallengePlan);
app.post("/api/admin/users/update", authenticateToken, validate(updateUserProfileSchema), updateUserProfile);
app.post("/api/admin/users/suspend", authenticateToken, validate(suspendUserAccountSchema), suspendUserAccount);
app.post("/api/admin/accounts/suspend", authenticateToken, validate(suspendChallengePlanSchema), suspendChallengePlan);
app.post("/api/admin/accounts/lift-breach", authenticateToken, validate(liftChallengePlanBreachSchema), liftChallengePlanBreach);
app.post("/api/admin/users/impersonate", authenticateToken, validate(impersonateUserSessionSchema), impersonateUserSession);

// Challenge Rules editor
app.post("/api/admin/challenges/create", authenticateToken, validate(createChallengeRuleSchema), createChallengeRule);
app.post("/api/admin/challenges/update", authenticateToken, validate(updateChallengeRuleSchema), updateChallengeRule);
app.post("/api/admin/challenges/delete", authenticateToken, validate(deleteChallengeRuleSchema), deleteChallengeRule);
app.post("/api/admin/markets/create", authenticateToken, validate(createMarketSchema), createMarket);
app.post("/api/admin/markets/delete", authenticateToken, validate(deleteMarketSchema), deleteMarket);
app.post("/api/admin/markets/sync-restart", authenticateToken, restartBinanceFeed);
app.get("/api/admin/challenges/purchased", authenticateToken, getChallengePurchases);

// Payments & transaction records
app.get("/api/admin/payments", authenticateToken, getAllPayments);

// Payout withdrawals controls
app.get("/api/admin/payouts", authenticateToken, getAllPayouts);
app.post("/api/admin/payouts/approve", authenticateToken, validate(payoutActionSchema), approvePayout);
app.post("/api/admin/payouts/reject", authenticateToken, validate(payoutActionSchema), rejectPayout);

// Support ticket queue overrides
app.get("/api/admin/tickets", authenticateToken, getAdminTickets);
app.post("/api/admin/tickets/reply", authenticateToken, validate(replyTicketSchema), adminReplyTicket);

// Website layout configurations
app.get("/api/admin/web-configs", authenticateToken, getWebConfigs);
app.post("/api/admin/web-config", authenticateToken, validate(updateWebConfigSchema), updateWebConfig);

// Influencer collabs and newsletter campaigns
app.get("/api/admin/marketing/influencers", authenticateToken, getInfluencers);
app.post("/api/admin/marketing/influencers", authenticateToken, validate(createInfluencerSchema), createInfluencer);
app.post("/api/admin/marketing/bulk-email", authenticateToken, validate(sendBulkEmailSchema), sendBulkEmail);

// Markets config
app.post("/api/admin/markets/create", authenticateToken, validate(createMarketSchema), createMarket);

// Coupons manager
app.get("/api/admin/coupons", authenticateToken, getCoupons);
app.post("/api/admin/coupons", authenticateToken, validate(createCouponSchema), createCoupon);

// Seeding endpoint to easily run out-of-the-box
app.post("/api/admin/seed", async (req, res) => {
  try {
    const challengeCount = await prisma.challengeRule.count();
    if (challengeCount === 0) {
      // Seed challenge rules engine matrix
      const defaultRules = [
        // INSTANT
        { type: "INSTANT", tierName: "Starter Instant $5K", size: 5000, price: 49, profitTargetPercent: 0, dailyDrawdownPercent: 3, maxLossPercent: 6, minTradingDays: 0 },
        { type: "INSTANT", tierName: "Pro Instant $25K", size: 25000, price: 199, profitTargetPercent: 0, dailyDrawdownPercent: 3, maxLossPercent: 6, minTradingDays: 0 },
        { type: "INSTANT", tierName: "Master Instant $100K", size: 100000, price: 699, profitTargetPercent: 0, dailyDrawdownPercent: 3, maxLossPercent: 6, minTradingDays: 0 },
        // ONE STEP
        { type: "ONE_STEP", tierName: "Starter 1-Step $10K", size: 10000, price: 79, profitTargetPercent: 10, dailyDrawdownPercent: 3, maxLossPercent: 6, minTradingDays: 3 },
        { type: "ONE_STEP", tierName: "Pro 1-Step $50K", size: 50000, price: 299, profitTargetPercent: 10, dailyDrawdownPercent: 3, maxLossPercent: 6, minTradingDays: 3 },
        { type: "ONE_STEP", tierName: "Master 1-Step $100K", size: 100000, price: 499, profitTargetPercent: 10, dailyDrawdownPercent: 3, maxLossPercent: 6, minTradingDays: 3 },
        // TWO STEP
        { type: "TWO_STEP", tierName: "Starter 2-Step $10K", size: 10000, price: 69, profitTargetPercent: 8, dailyDrawdownPercent: 5, maxLossPercent: 10, minTradingDays: 5 },
        { type: "TWO_STEP", tierName: "Pro 2-Step $50K", size: 50000, price: 249, profitTargetPercent: 8, dailyDrawdownPercent: 5, maxLossPercent: 10, minTradingDays: 5 },
        { type: "TWO_STEP", tierName: "Master 2-Step $100K", size: 100000, price: 429, profitTargetPercent: 8, dailyDrawdownPercent: 5, maxLossPercent: 10, minTradingDays: 5 },
      ];

      for (const rule of defaultRules) {
        await prisma.challengeRule.create({ data: rule });
      }
    }

    // Seed default Email templates
    const templatesCount = await prisma.emailTemplate.count();
    if (templatesCount === 0) {
      const defaultEmailTemplates = [
        {
          key: "CHALLENGE_PURCHASED",
          subject: "Your Prop Firm Account {{AccountID}} is Ready!",
          htmlPayload: `
            <div style="background:#09090b; color:#fafafa; font-family:sans-serif; padding:30px; border-radius:8px;">
              <h2 style="color:#06b6d4;">Welcome to your Prop Firm Challenge, {{Name}}!</h2>
              <p>Your trading simulation account is fully active. Details below:</p>
              <ul>
                <li><strong>Account ID:</strong> {{AccountID}}</li>
                <li><strong>Initial Capital:</strong> {{CurrentEquity}}</li>
                <li><strong>Phase State:</strong> Simulation Active</li>
              </ul>
              <p>Execute orders cleanly, adhere to drawdown floors, and check performance inside your Zen Trading Dashboard.</p>
            </div>
          `,
        },
        {
          key: "DRAWDOWN_BREACH",
          subject: "CRITICAL ALERT: Daily Drawdown Floor Exceeded",
          htmlPayload: `
            <div style="background:#09090b; color:#fafafa; font-family:sans-serif; padding:30px; border-radius:8px; border: 1px solid #ef4444;">
              <h2 style="color:#ef4444;">Account Suspended: Drawdown Rule Violation</h2>
              <p>Dear {{Name}},</p>
              <p>Your account <strong>{{AccountID}}</strong> has exceeded the allowed 2 AM UTC daily drawdown limit threshold.</p>
              <p><strong>Breach Details:</strong> {{Reason}}</p>
              <p>Current Account Equity: {{CurrentEquity}}</p>
              <p>All open positions have been force liquidated. We look forward to seeing you back on your next try.</p>
            </div>
          `,
        },
        {
          key: "MAX_LOSS_BREACH",
          subject: "CRITICAL ALERT: Absolute Max Loss Breached",
          htmlPayload: `
            <div style="background:#09090b; color:#fafafa; font-family:sans-serif; padding:30px; border-radius:8px; border: 1px solid #ef4444;">
              <h2 style="color:#ef4444;">Account Terminated: Max Loss Limit</h2>
              <p>Dear {{Name}},</p>
              <p>Your trading account <strong>{{AccountID}}</strong> has breached the absolute max loss baseline limit rules.</p>
              <p><strong>Reasoning:</strong> {{Reason}}</p>
              <p>Current account equity is {{CurrentEquity}}. All open positions have been liquidated.</p>
            </div>
          `,
        },
        {
          key: "ACCOUNT_PASSED",
          subject: "Congratulations! Prop Firm Verification Passed",
          htmlPayload: `
            <div style="background:#09090b; color:#fafafa; font-family:sans-serif; padding:30px; border-radius:8px; border: 1px solid #10b981;">
              <h2 style="color:#10b981;">Challenge Milestone Passed!</h2>
              <p>Dear {{Name}},</p>
              <p>Congratulations! Your account <strong>{{AccountID}}</strong> has hit the profit target requirement with active trading rules fulfilled.</p>
              <p>Current Equity: {{CurrentEquity}}</p>
              <p>Your account phase is upgraded. Check your client terminal to start the next verification or live funded phase.</p>
            </div>
          `,
        },
      ];

      for (const t of defaultEmailTemplates) {
        await prisma.emailTemplate.create({ data: t });
      }
    }

    // Seed test Admin credentials
    const adminEmail = "admin@propfirm.com";
    const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!existingAdmin) {
      const bcrypt = require("bcryptjs");
      const passwordHash = await bcrypt.hash("AdminSecurePassword123!", 10);
      await prisma.user.create({
        data: {
          fullName: "System Admin",
          email: adminEmail,
          passwordHash,
          isAdmin: true,
          kycStatus: "APPROVED",
        },
      });
    }

    return res.json({ message: "Default data seeded successfully." });
  } catch (error: any) {
    console.error("Seeding error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// TICK & RISK PIPELINE WIRING
// ==========================================
import { matchStopLossTakeProfit } from "./binanceSync";

registerOnTick((symbol, price) => {
  // 1. Process limit order triggers on incoming tick
  matchLimitOrders(symbol, price);

  // 2. Process Stop Loss and Take Profit triggers
  matchStopLossTakeProfit(symbol, price);

  // 3. Broadcast price to active subscriber sockets
  broadcastTickerUpdate(symbol, price);
});

// Start Binance connection and Guardian Daemon
startBinanceSync();
startRiskGuardianDaemon();

// Start WebSocket server mounting
initializeWebSocketServer(server);

server.listen(PORT, () => {
  console.log(`[CORE SERVER] Running on port http://localhost:${PORT}`);
});

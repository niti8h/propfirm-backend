"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const validate_1 = require("./middlewares/validate");
const auth_schema_1 = require("./schemas/auth.schema");
const payments_schema_1 = require("./schemas/payments.schema");
const trading_schema_1 = require("./schemas/trading.schema");
const support_schema_1 = require("./schemas/support.schema");
const admin_schema_1 = require("./schemas/admin.schema");
const db_1 = require("./db");
const binanceSync_1 = require("./binanceSync");
const riskGuardian_1 = require("./riskGuardian");
const websocket_1 = require("./websocket");
// Controllers
const auth_1 = require("./controllers/auth");
const payments_1 = require("./controllers/payments");
const trading_1 = require("./controllers/trading");
const admin_1 = require("./controllers/admin");
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const PORT = process.env.PORT || 3001;
// Middlewares
app.use((0, cors_1.default)({ origin: "*" }));
app.use(express_1.default.json());
// Security Middlewares
app.use((0, helmet_1.default)());
const globalLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    message: { error: "Too many requests from this IP, please try again after 15 minutes" }
});
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: "Too many login/signup attempts, please try again after 15 minutes" }
});
app.use(globalLimiter);
// ==========================================
// PUBLIC ROUTES
// ==========================================
// Auth
app.post("/api/auth/signup", authLimiter, (0, validate_1.validate)(auth_schema_1.signupSchema), auth_1.signup);
app.post("/api/auth/login", authLimiter, (0, validate_1.validate)(auth_schema_1.loginSchema), auth_1.login);
app.post("/api/auth/forgot-password", authLimiter, (0, validate_1.validate)(auth_schema_1.forgotPasswordSchema), auth_1.forgotPassword);
app.post("/api/auth/reset-password", authLimiter, (0, validate_1.validate)(auth_schema_1.resetPasswordSchema), auth_1.resetPassword);
// Challenges List (Public frontend pricing grid)
app.get("/api/challenges", async (req, res) => {
    try {
        const challenges = await db_1.prisma.challengeRule.findMany({
            where: { active: true },
        });
        return res.json(challenges);
    }
    catch (error) {
        return res.status(500).json({ error: "Failed to load pricing packages." });
    }
});
// Payment & Webhooks
app.post("/api/webhooks/oxapay", express_1.default.json(), (0, validate_1.validate)(payments_schema_1.oxapayWebhookSchema), payments_1.handleOxapayCallback);
// Synchronous Razorpay Verification
app.post("/api/payments/verify-razorpay", auth_1.authenticateToken, (0, validate_1.validate)(payments_schema_1.verifyRazorpaySchema), payments_1.verifyRazorpay);
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
// Public Binance Markets API Proxy (with local websocket fallbacks)
app.get("/api/markets/binance-tickers", async (req, res) => {
    try {
        const { stdout } = await execAsync("curl -s https://api.binance.com/api/v3/ticker/price");
        const tickers = JSON.parse(stdout);
        if (!Array.isArray(tickers)) {
            throw new Error("Binance API returned non-array response");
        }
        const filtered = tickers.filter((t) => t.symbol.endsWith("USDT"));
        return res.json(filtered);
    }
    catch (err) {
        console.error("Binance Fetch Error:", err.message || err);
        // If request fails or offline, fallback to in-memory ticks
        const fallback = [
            { symbol: "BTCUSDT", price: binanceSync_1.priceMap.get("BTCUSDT")?.toString() || "65000.00" },
            { symbol: "ETHUSDT", price: binanceSync_1.priceMap.get("ETHUSDT")?.toString() || "3400.00" },
            { symbol: "SOLUSDT", price: binanceSync_1.priceMap.get("SOLUSDT")?.toString() || "160.00" },
        ];
        return res.json(fallback);
    }
});
// ==========================================
// PROTECTED CLIENT ROUTES
// ==========================================
app.post("/api/payments/purchase", auth_1.authenticateToken, (0, validate_1.validate)(payments_schema_1.purchaseChallengeSchema), payments_1.purchaseChallenge);
app.post("/api/payments/coupon/validate", auth_1.authenticateToken, (0, validate_1.validate)(payments_schema_1.validateCouponSchema), admin_1.validateCoupon);
app.post("/api/trading/open", auth_1.authenticateToken, (0, validate_1.validate)(trading_schema_1.openTradeSchema), trading_1.openTrade);
app.post("/api/trading/close", auth_1.authenticateToken, (0, validate_1.validate)(trading_schema_1.closeTradeSchema), trading_1.closeTrade);
app.post("/api/trading/cancel", auth_1.authenticateToken, (0, validate_1.validate)(trading_schema_1.cancelPendingOrderSchema), trading_1.cancelPendingOrder);
app.get("/api/trading/accounts/:userId", auth_1.authenticateToken, trading_1.getUserAccounts);
app.get("/api/trading/markets", auth_1.authenticateToken, trading_1.getMarkets);
app.get("/api/users/profile", auth_1.authenticateToken, auth_1.getUserProfile);
// Payout request (User facing)
app.post("/api/trading/payout/request", auth_1.authenticateToken, (0, validate_1.validate)(trading_schema_1.requestUserPayoutSchema), admin_1.requestUserPayout);
// Support tickets (User facing)
app.get("/api/support/tickets/:userId", auth_1.authenticateToken, admin_1.getUserTickets);
app.post("/api/support/tickets", auth_1.authenticateToken, (0, validate_1.validate)(support_schema_1.createTicketSchema), admin_1.userCreateTicket);
app.post("/api/support/tickets/reply", auth_1.authenticateToken, (0, validate_1.validate)(support_schema_1.replyTicketSchema), admin_1.userReplyTicket);
// Fetch active positions and history for UI charts
app.get("/api/trading/account/:accountId", auth_1.authenticateToken, async (req, res) => {
    try {
        const { accountId } = req.params;
        const account = await db_1.prisma.account.findUnique({
            where: { id: accountId },
            include: { challengeRule: true },
        });
        if (!account)
            return res.status(404).json({ error: "Account not found" });
        const openPositions = await db_1.prisma.trade.findMany({
            where: { accountId, status: "OPEN" },
            orderBy: { openTime: "desc" },
        });
        const pendingOrders = await db_1.prisma.trade.findMany({
            where: { accountId, status: "PENDING" },
            orderBy: { openTime: "desc" },
        });
        const completedHistory = await db_1.prisma.trade.findMany({
            where: { accountId, status: { in: ["CLOSED", "CANCELLED"] } },
            orderBy: { openTime: "desc" },
        });
        return res.json({
            account,
            openPositions,
            pendingOrders,
            completedHistory,
        });
    }
    catch (err) {
        return res.status(500).json({ error: "Failed to load account ledger details" });
    }
});
// ==========================================
// ADMIN CONTROL COMMANDS
// ==========================================
app.post("/api/admin/toggle-gate", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.toggleGateSchema), admin_1.toggleMarketGate);
app.post("/api/admin/config", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.updateSystemConfigSchema), admin_1.updateSystemConfig);
app.post("/api/admin/template", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.updateEmailTemplateSchema), admin_1.updateEmailTemplate);
app.get("/api/admin/settings", auth_1.authenticateToken, admin_1.getAdminDashboardSettings);
// User lists, direct plans assignment and admin overrides
app.get("/api/admin/users", auth_1.authenticateToken, admin_1.getUsersList);
app.get("/api/admin/users/:userId", auth_1.authenticateToken, admin_1.getUserDetail);
app.post("/api/admin/users/toggle-admin", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.toggleUserAdminStatusSchema), admin_1.toggleUserAdminStatus);
app.post("/api/admin/users/assign-plan", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.assignChallengePlanSchema), admin_1.assignChallengePlan);
app.post("/api/admin/users/update", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.updateUserProfileSchema), admin_1.updateUserProfile);
app.post("/api/admin/users/suspend", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.suspendUserAccountSchema), admin_1.suspendUserAccount);
app.post("/api/admin/accounts/suspend", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.suspendChallengePlanSchema), admin_1.suspendChallengePlan);
app.post("/api/admin/accounts/lift-breach", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.liftChallengePlanBreachSchema), admin_1.liftChallengePlanBreach);
app.post("/api/admin/users/impersonate", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.impersonateUserSessionSchema), admin_1.impersonateUserSession);
// Challenge Rules editor
app.post("/api/admin/challenges/create", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.createChallengeRuleSchema), admin_1.createChallengeRule);
app.post("/api/admin/challenges/update", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.updateChallengeRuleSchema), admin_1.updateChallengeRule);
app.post("/api/admin/challenges/delete", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.deleteChallengeRuleSchema), admin_1.deleteChallengeRule);
app.post("/api/admin/markets/create", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.createMarketSchema), admin_1.createMarket);
app.post("/api/admin/markets/delete", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.deleteMarketSchema), admin_1.deleteMarket);
app.post("/api/admin/markets/sync-restart", auth_1.authenticateToken, admin_1.restartBinanceFeed);
app.get("/api/admin/challenges/purchased", auth_1.authenticateToken, admin_1.getChallengePurchases);
// Payments & transaction records
app.get("/api/admin/payments", auth_1.authenticateToken, admin_1.getAllPayments);
// Payout withdrawals controls
app.get("/api/admin/payouts", auth_1.authenticateToken, admin_1.getAllPayouts);
app.post("/api/admin/payouts/approve", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.payoutActionSchema), admin_1.approvePayout);
app.post("/api/admin/payouts/reject", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.payoutActionSchema), admin_1.rejectPayout);
// Support ticket queue overrides
app.get("/api/admin/tickets", auth_1.authenticateToken, admin_1.getAdminTickets);
app.post("/api/admin/tickets/reply", auth_1.authenticateToken, (0, validate_1.validate)(support_schema_1.replyTicketSchema), admin_1.adminReplyTicket);
// Website layout configurations
app.get("/api/admin/web-configs", auth_1.authenticateToken, admin_1.getWebConfigs);
app.post("/api/admin/web-config", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.updateWebConfigSchema), admin_1.updateWebConfig);
// Influencer collabs and newsletter campaigns
app.get("/api/admin/marketing/influencers", auth_1.authenticateToken, admin_1.getInfluencers);
app.post("/api/admin/marketing/influencers", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.createInfluencerSchema), admin_1.createInfluencer);
app.post("/api/admin/marketing/bulk-email", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.sendBulkEmailSchema), admin_1.sendBulkEmail);
// Markets config
app.post("/api/admin/markets/create", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.createMarketSchema), admin_1.createMarket);
// Coupons manager
app.get("/api/admin/coupons", auth_1.authenticateToken, admin_1.getCoupons);
app.post("/api/admin/coupons", auth_1.authenticateToken, (0, validate_1.validate)(admin_schema_1.createCouponSchema), admin_1.createCoupon);
// Seeding endpoint to easily run out-of-the-box
app.post("/api/admin/seed", async (req, res) => {
    try {
        const challengeCount = await db_1.prisma.challengeRule.count();
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
                await db_1.prisma.challengeRule.create({ data: rule });
            }
        }
        // Seed default Email templates
        const templatesCount = await db_1.prisma.emailTemplate.count();
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
                await db_1.prisma.emailTemplate.create({ data: t });
            }
        }
        // Seed test Admin credentials
        const adminEmail = "admin@propfirm.com";
        const existingAdmin = await db_1.prisma.user.findUnique({ where: { email: adminEmail } });
        if (!existingAdmin) {
            const bcrypt = require("bcryptjs");
            const passwordHash = await bcrypt.hash("AdminSecurePassword123!", 10);
            await db_1.prisma.user.create({
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
    }
    catch (error) {
        console.error("Seeding error:", error);
        return res.status(500).json({ error: error.message });
    }
});
// ==========================================
// TICK & RISK PIPELINE WIRING
// ==========================================
const binanceSync_2 = require("./binanceSync");
(0, binanceSync_1.registerOnTick)((symbol, price) => {
    // 1. Process limit order triggers on incoming tick
    (0, binanceSync_1.matchLimitOrders)(symbol, price);
    // 2. Process Stop Loss and Take Profit triggers
    (0, binanceSync_2.matchStopLossTakeProfit)(symbol, price);
    // 3. Broadcast price to active subscriber sockets
    (0, websocket_1.broadcastTickerUpdate)(symbol, price);
});
// Start Binance connection and Guardian Daemon
(0, binanceSync_1.startBinanceSync)();
(0, riskGuardian_1.startRiskGuardianDaemon)();
// Start WebSocket server mounting
(0, websocket_1.initializeWebSocketServer)(server);
server.listen(PORT, () => {
    console.log(`[CORE SERVER] Running on port http://localhost:${PORT}`);
});

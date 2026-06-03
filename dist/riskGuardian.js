"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startRiskGuardianDaemon = startRiskGuardianDaemon;
exports.calculateAccountEquity = calculateAccountEquity;
exports.checkHftSpamRule = checkHftSpamRule;
exports.checkInverseHedging = checkInverseHedging;
exports.performDailySnapshot = performDailySnapshot;
const node_cron_1 = __importDefault(require("node-cron"));
const db_1 = require("./db");
const binanceSync_1 = require("./binanceSync");
const email_1 = require("./services/email");
// Start background risk monitoring loop
function startRiskGuardianDaemon() {
    console.log("[RISK GUARDIAN] Initializing Live Risk Daemon...");
    // Run equity evaluation every 1.5 seconds
    setInterval(async () => {
        try {
            await evaluateAllActiveAccounts();
        }
        catch (error) {
            console.error("[RISK GUARDIAN ERROR] Exception in tick evaluation:", error);
        }
    }, 1500);
    // Cron schedule to run snapshot at exactly 2 AM UTC every day
    // Cron expression for 2:00 AM UTC: "0 2 * * *"
    node_cron_1.default.schedule("0 2 * * *", async () => {
        console.log("[RISK CRON] Running 2 AM UTC snapshot job...");
        try {
            await performDailySnapshot();
        }
        catch (error) {
            console.error("[RISK CRON ERROR] Failed to capture daily snapshots:", error);
        }
    });
}
/**
 * Calculates current equity for an account based on open positions and in-memory price map
 */
function calculateAccountEquity(account, openTrades) {
    let unrealizedPnl = 0;
    for (const trade of openTrades) {
        const currentPrice = binanceSync_1.priceMap.get(trade.symbol) || trade.entryPrice;
        let tradePnl = 0;
        if (trade.direction === "BUY") {
            tradePnl = trade.size * (currentPrice - trade.entryPrice);
        }
        else if (trade.direction === "SELL") {
            tradePnl = trade.size * (trade.entryPrice - currentPrice);
        }
        unrealizedPnl += tradePnl;
    }
    return {
        equity: account.balance + unrealizedPnl,
        unrealizedPnl,
    };
}
/**
 * Checks if account trades violate the High Frequency Trading (HFT) rule
 * Rule: >= 4 orders in the same direction on the same asset within 3 minutes
 */
async function checkHftSpamRule(accountId, symbol, direction) {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
    const recentTradesCount = await db_1.prisma.trade.count({
        where: {
            accountId,
            symbol,
            direction,
            openTime: { gte: threeMinutesAgo },
        },
    });
    return recentTradesCount >= 4;
}
/**
 * Checks for inverse hedging across accounts owned by the same User ID
 */
async function checkInverseHedging(userId) {
    // Get all active accounts for user
    const userAccounts = await db_1.prisma.account.findMany({
        where: {
            userId,
            phase: { in: ["STAGE1", "STAGE2", "FUNDED"] },
        },
    });
    if (userAccounts.length < 2)
        return false;
    const accountIds = userAccounts.map((a) => a.id);
    // Fetch open trades
    const openTrades = await db_1.prisma.trade.findMany({
        where: {
            accountId: { in: accountIds },
            status: "OPEN",
        },
    });
    // Compare open positions for opposing directions on the same symbol
    for (const t1 of openTrades) {
        for (const t2 of openTrades) {
            if (t1.accountId !== t2.accountId && t1.symbol === t2.symbol) {
                if ((t1.direction === "BUY" && t2.direction === "SELL") ||
                    (t1.direction === "SELL" && t2.direction === "BUY")) {
                    // Inverse Hedging Violation found!
                    return true;
                }
            }
        }
    }
    return false;
}
/**
 * Evaluates all active accounts against profit targets, drawdown constraints, absolute floors, and spam checks.
 */
async function evaluateAllActiveAccounts() {
    // Fetch active trading accounts
    const activeAccounts = await db_1.prisma.account.findMany({
        where: {
            phase: { in: ["STAGE1", "STAGE2", "FUNDED"] },
        },
        include: {
            challengeRule: true,
            user: true,
        },
    });
    for (const account of activeAccounts) {
        const openTrades = await db_1.prisma.trade.findMany({
            where: { accountId: account.id, status: "OPEN" },
        });
        const { equity, unrealizedPnl } = calculateAccountEquity(account, openTrades);
        // 1. Update live equity/pnl in DB
        await db_1.prisma.account.update({
            where: { id: account.id },
            data: { equity },
        });
        // Update individual PnL for active positions
        for (const trade of openTrades) {
            const currentPrice = binanceSync_1.priceMap.get(trade.symbol) || trade.entryPrice;
            let tradePnl = 0;
            if (trade.direction === "BUY") {
                tradePnl = trade.size * (currentPrice - trade.entryPrice);
            }
            else {
                tradePnl = trade.size * (trade.entryPrice - currentPrice);
            }
            await db_1.prisma.trade.update({
                where: { id: trade.id },
                data: { grossPnl: tradePnl },
            });
        }
        const initial = account.initialBalance;
        const rule = account.challengeRule;
        // --- RULE CALCULATION BOUNDS ---
        // A. Absolute Max Loss Limit
        // Instant: 6%, One-Step: 6%, Two-Step: 10%
        const absoluteLossFloor = account.absoluteLossFloor; // Computed at setup and phase changes
        if (equity <= absoluteLossFloor) {
            await breachAccount(account, openTrades, `Equity ($${equity.toFixed(2)}) breached absolute max loss floor ($${absoluteLossFloor.toFixed(2)})`, "MAX_LOSS_BREACH");
            continue;
        }
        // B. Daily Drawdown Limit
        // let dailyFloor = 0;
        // if (rule.type === "INSTANT") {
        //   // 3% of daily start balance (2 AM UTC)
        //   dailyFloor = account.dailyStartBalance * (1 - 0.03);
        // } else if (rule.type === "ONE_STEP") {
        //   // 3% of initial balance, measured from 2 AM UTC start equity
        //   dailyFloor = account.dailyStartEquity - initial * 0.03;
        // } else if (rule.type === "TWO_STEP") {
        //   // 5% static value based on initial balance (2 AM UTC snapshot equity - 5% initial balance)
        //   dailyFloor = account.dailyStartEquity - initial * 0.05;
        // }
        let dailyFloor = account.dailyStartEquity - initial * (rule.dailyDrawdownPercent / 100);
        if (equity <= dailyFloor) {
            await breachAccount(account, openTrades, `Equity ($${equity.toFixed(2)}) breached daily drawdown floor ($${dailyFloor.toFixed(2)})`, "DRAWDOWN_BREACH");
            continue;
        }
        // C. Inverse Hedging Violation
        const userInverseHedging = await checkInverseHedging(account.userId);
        if (userInverseHedging) {
            await breachAccount(account, openTrades, `Detected inverse hedging across user accounts`, "MAX_LOSS_BREACH");
            continue;
        }
        // D. Phase Target / Validation Check
        // (Only triggers when all trades are closed)
        if (openTrades.length === 0) {
            const balance = account.balance;
            const profit = balance - initial;
            let targetPercent = 0;
            let requiredDays = 0;
            if (account.phase === "STAGE1") {
                if (rule.type === "TWO_STEP") {
                    targetPercent = rule.stageOneProfitTargetPercent || rule.profitTargetPercent;
                    requiredDays = rule.stageOneMinTradingDays || rule.minTradingDays;
                }
                else {
                    targetPercent = rule.stageOneProfitTargetPercent || rule.profitTargetPercent;
                    requiredDays = rule.stageOneMinTradingDays || rule.minTradingDays;
                }
            }
            else if (account.phase === "STAGE2") {
                targetPercent = rule.stageTwoProfitTargetPercent || rule.profitTargetPercent;
                requiredDays = rule.stageTwoMinTradingDays || rule.minTradingDays;
            }
            if (targetPercent > 0) {
                const requiredProfit = initial * (targetPercent / 100);
                if (profit >= requiredProfit && account.tradingDaysCount >= requiredDays) {
                    // Pass Stage 1/2 or upgrade to Funded
                    await advanceAccountPhase(account);
                }
            }
        }
    }
}
/**
 * Closes all open trades, marks account as breached, and emails user
 */
async function breachAccount(account, openTrades, reason, templateKey) {
    console.log(`[RISK GUARDIAN] BREACH! Account: ${account.id}. Reason: ${reason}`);
    // Force close open positions
    for (const trade of openTrades) {
        const currentPrice = binanceSync_1.priceMap.get(trade.symbol) || trade.entryPrice;
        let finalPnl = 0;
        if (trade.direction === "BUY") {
            finalPnl = trade.size * (currentPrice - trade.entryPrice);
        }
        else {
            finalPnl = trade.size * (trade.entryPrice - currentPrice);
        }
        await db_1.prisma.trade.update({
            where: { id: trade.id },
            data: {
                status: "CLOSED",
                exitPrice: currentPrice,
                closeTime: new Date(),
                grossPnl: finalPnl,
                terminationReason: "FORCE_LIQUIDATED",
            },
        });
    }
    // Set account status to BREACHED
    await db_1.prisma.account.update({
        where: { id: account.id },
        data: {
            phase: "BREACHED",
            breachReason: reason,
        },
    });
    // Notify user
    await (0, email_1.sendTemplateEmail)(account.user.email, templateKey, {
        Name: account.user.fullName,
        AccountID: account.id,
        CurrentEquity: `$${account.equity.toFixed(2)}`,
        Reason: reason,
    });
}
/**
 * Handles account milestones (Stage 1 -> Stage 2, or Stage 2 -> Funded, or One-Step -> Funded)
 */
async function advanceAccountPhase(account) {
    let nextPhase = "FUNDED";
    let emailKey = "ACCOUNT_PASSED";
    if (account.phase === "STAGE1" && account.challengeRule.type === "TWO_STEP") {
        nextPhase = "STAGE2";
    }
    else if (account.phase === "STAGE1" && account.challengeRule.type === "ONE_STEP") {
        nextPhase = "FUNDED";
    }
    else if (account.phase === "STAGE2") {
        nextPhase = "FUNDED";
    }
    console.log(`[RISK GUARDIAN] Account ${account.id} passed phase ${account.phase}. Upgrading to ${nextPhase}`);
    const newInitialBalance = account.balance;
    const maxLossPercent = account.challengeRule.maxLossPercent;
    const newAbsoluteLossFloor = newInitialBalance * (1 - maxLossPercent / 100);
    await db_1.prisma.account.update({
        where: { id: account.id },
        data: {
            phase: nextPhase,
            initialBalance: newInitialBalance,
            dailyStartBalance: newInitialBalance,
            dailyStartEquity: newInitialBalance,
            absoluteLossFloor: newAbsoluteLossFloor,
            tradingDaysCount: 0, // Reset trading days for next step or funded phase
        },
    });
    await (0, email_1.sendTemplateEmail)(account.user.email, emailKey, {
        Name: account.user.fullName,
        AccountID: account.id,
        CurrentEquity: `$${account.equity.toFixed(2)}`,
    });
}
/**
 * Recalculates 2 AM UTC daily starting limits and snapshots daily balances.
 */
async function performDailySnapshot() {
    const accounts = await db_1.prisma.account.findMany({
        where: {
            phase: { in: ["STAGE1", "STAGE2", "FUNDED"] },
        },
        include: {
            trades: { where: { status: "OPEN" } },
        },
    });
    const now = new Date();
    for (const account of accounts) {
        const { equity } = calculateAccountEquity(account, account.trades);
        // Save daily snapshot record
        await db_1.prisma.dailySnapshot.create({
            data: {
                accountId: account.id,
                balance: account.balance,
                equity: equity,
                timestamp: now,
            },
        });
        // Determine if today was a valid trading day (balance fluctuated >= 0.25% compared to yesterday's snapshot balance)
        let isTradingDay = false;
        const yesterdaySnapshot = await db_1.prisma.dailySnapshot.findFirst({
            where: { accountId: account.id },
            orderBy: { timestamp: "desc" },
            skip: 1, // Get the snapshot before the one we just created
        });
        if (yesterdaySnapshot) {
            const diffPercent = Math.abs(account.balance - yesterdaySnapshot.balance) / yesterdaySnapshot.balance;
            if (diffPercent >= 0.0025) {
                isTradingDay = true;
            }
        }
        else {
            // First snapshot, count it if there was any trade today
            const todayTradesCount = await db_1.prisma.trade.count({
                where: {
                    accountId: account.id,
                    openTime: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                },
            });
            if (todayTradesCount > 0) {
                isTradingDay = true;
            }
        }
        // Update daily start bounds for new day
        await db_1.prisma.account.update({
            where: { id: account.id },
            data: {
                dailyStartBalance: account.balance,
                dailyStartEquity: equity,
                lastDailySnapshot: now,
                tradingDaysCount: isTradingDay ? { increment: 1 } : undefined,
            },
        });
        console.log(`[RISK CRON] Snapshot finalized for Account: ${account.id}. Daily Start Balance reset to ${account.balance}, Equity: ${equity}`);
    }
}

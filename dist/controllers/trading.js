"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openTrade = openTrade;
exports.closeTrade = closeTrade;
exports.cancelPendingOrder = cancelPendingOrder;
exports.getUserAccounts = getUserAccounts;
exports.getMarkets = getMarkets;
const db_1 = require("../db");
const binanceSync_1 = require("../binanceSync");
const riskGuardian_1 = require("../riskGuardian");
// Helper to determine asset class leverage
function getLeverageLimit(symbol, rule) {
    const sym = symbol.toUpperCase();
    // Crypto symbols standard (BTCUSDT, ETHUSDT, SOLUSDT, etc.)
    if (sym.endsWith("USDT") || sym.endsWith("BTC") || sym.endsWith("USD")) {
        return rule.leverageCrypto; // 1:2
    }
    // Forex indicators: e.g. EURUSD, GBPUSD
    if (sym.startsWith("EUR") || sym.startsWith("GBP") || sym.startsWith("USD") || sym.length === 6) {
        return rule.leverageForex; // 1:100
    }
    // Commodities (GOLD, OIL, XAUUSD, etc.)
    return rule.leverageCommodities; // 1:30
}
// 1. Open Trade (Simulated Order Entry)
async function openTrade(req, res) {
    try {
        const { accountId, symbol, direction, type, size, triggerPrice, leverage, stopLoss, takeProfit } = req.body;
        if (!accountId || !symbol || !direction || !type || !size) {
            return res.status(400).json({ error: "Missing required order parameters." });
        }
        const normalizedSymbol = symbol.toUpperCase();
        const normalizedDir = direction.toUpperCase(); // BUY or SELL
        const normalizedType = type.toUpperCase(); // MARKET or LIMIT
        // Fetch account details
        const account = await db_1.prisma.account.findUnique({
            where: { id: accountId },
            include: { challengeRule: true },
        });
        if (!account) {
            return res.status(404).json({ error: "Account not found." });
        }
        // Verify account state
        if (account.phase === "PENDING_PAYMENT") {
            return res.status(400).json({ error: "Account is pending payment activation." });
        }
        if (account.phase === "BREACHED") {
            return res.status(400).json({ error: "Account has been suspended/breached." });
        }
        const price = binanceSync_1.priceMap.get(normalizedSymbol);
        if (!price && normalizedType === "MARKET") {
            return res.status(400).json({ error: `No live pricing feed for asset ${normalizedSymbol}.` });
        }
        const executionPrice = normalizedType === "MARKET" ? price : triggerPrice;
        if (!executionPrice || executionPrice <= 0) {
            return res.status(400).json({ error: "Invalid execution or limit trigger price." });
        }
        if (normalizedType === "LIMIT") {
            if (normalizedDir === "BUY" && executionPrice >= price) {
                return res.status(400).json({ error: `Buy Limit price ($${executionPrice}) must be below the current market price ($${price}).` });
            }
            if (normalizedDir === "SELL" && executionPrice <= price) {
                return res.status(400).json({ error: `Sell Limit price ($${executionPrice}) must be above the current market price ($${price}).` });
            }
        }
        const sl = stopLoss ? parseFloat(stopLoss) : null;
        const tp = takeProfit ? parseFloat(takeProfit) : null;
        if (sl) {
            if (normalizedDir === "BUY" && sl >= executionPrice) {
                return res.status(400).json({ error: `Stop Loss ($${sl}) must be below the entry price ($${executionPrice}) for a BUY order.` });
            }
            if (normalizedDir === "SELL" && sl <= executionPrice) {
                return res.status(400).json({ error: `Stop Loss ($${sl}) must be above the entry price ($${executionPrice}) for a SELL order.` });
            }
        }
        if (tp) {
            if (normalizedDir === "BUY" && tp <= executionPrice) {
                return res.status(400).json({ error: `Take Profit ($${tp}) must be above the entry price ($${executionPrice}) for a BUY order.` });
            }
            if (normalizedDir === "SELL" && tp >= executionPrice) {
                return res.status(400).json({ error: `Take Profit ($${tp}) must be below the entry price ($${executionPrice}) for a SELL order.` });
            }
        }
        // A. Leverage and Margin constraints
        const maxLeverage = getLeverageLimit(normalizedSymbol, account.challengeRule);
        const appliedLeverage = leverage ? Math.min(leverage, maxLeverage) : maxLeverage;
        if (leverage && leverage > maxLeverage) {
            return res.status(400).json({ error: `Requested leverage (${leverage}x) exceeds the maximum allowed for this asset class (${maxLeverage}x).` });
        }
        const orderCost = (size * executionPrice) / appliedLeverage;
        // Calculate currently used margin
        const openTrades = await db_1.prisma.trade.findMany({
            where: { accountId, status: "OPEN" },
        });
        let totalUsedMargin = 0;
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
            totalUsedMargin += (trade.size * trade.entryPrice) / (trade.leverage || 1);
        }
        const currentEquity = account.balance + unrealizedPnl;
        const freeMargin = currentEquity - totalUsedMargin;
        if (orderCost > freeMargin) {
            return res.status(400).json({
                error: `Insufficient margin. Required: $${orderCost.toFixed(2)}, Free Margin: $${freeMargin.toFixed(2)} (Leverage 1:${appliedLeverage})`,
            });
        }
        // B. One-Step Funded Phase Risk Cap
        // Max 3% gross risk per trade or aggregate asset position inside a single trading day window
        if (account.challengeRule.type === "ONE_STEP" && account.phase === "FUNDED") {
            const grossRisk = size * executionPrice; // Gross position value
            const maxGrossAllowed = account.initialBalance * 0.03;
            if (grossRisk > maxGrossAllowed) {
                return res.status(400).json({
                    error: `Order rejected. One-Step Funded accounts are restricted to max 3% gross risk ($${maxGrossAllowed.toFixed(2)}) per trade. Your order: $${grossRisk.toFixed(2)}.`,
                });
            }
        }
        // C. HFT Spam Check
        // Max 4 orders in same direction on same asset within 3 minutes
        const isSpamming = await (0, riskGuardian_1.checkHftSpamRule)(accountId, normalizedSymbol, normalizedDir);
        if (isSpamming) {
            // Create warning log and reject
            await db_1.prisma.trade.create({
                data: {
                    accountId,
                    symbol: normalizedSymbol,
                    direction: normalizedDir,
                    type: normalizedType,
                    size,
                    entryPrice: executionPrice,
                    status: "CANCELLED",
                    terminationReason: "REJECTED_HFT_SPAM",
                },
            });
            return res.status(429).json({
                error: "Order rejected. High frequency order spam detected (max 4 orders in same direction on the same asset within 3 minutes).",
            });
        }
        // D. Create Trade record
        const trade = await db_1.prisma.trade.create({
            data: {
                accountId,
                symbol: normalizedSymbol,
                direction: normalizedDir,
                type: normalizedType,
                size,
                leverage: appliedLeverage,
                entryPrice: normalizedType === "MARKET" ? executionPrice : 0,
                triggerPrice: normalizedType === "LIMIT" ? triggerPrice : null,
                stopLoss: sl,
                takeProfit: tp,
                status: normalizedType === "MARKET" ? "OPEN" : "PENDING",
            },
        });
        console.log(`[ORDER] Account ${accountId} placed ${normalizedType} ${normalizedDir} size ${size} on ${normalizedSymbol}`);
        return res.status(201).json({
            message: `Order placed successfully: ${trade.status}`,
            trade,
        });
    }
    catch (error) {
        console.error("Open Trade Error:", error);
        return res.status(500).json({ error: "Failed to open position." });
    }
}
// 2. Close Trade (Simulated Position Exit)
async function closeTrade(req, res) {
    try {
        const { tradeId } = req.body;
        if (!tradeId) {
            return res.status(400).json({ error: "Missing trade ID parameter." });
        }
        const trade = await db_1.prisma.trade.findUnique({
            where: { id: tradeId },
            include: { account: true },
        });
        if (!trade) {
            return res.status(404).json({ error: "Position record not found." });
        }
        if (trade.status !== "OPEN") {
            return res.status(400).json({ error: "Position is not open." });
        }
        const currentPrice = binanceSync_1.priceMap.get(trade.symbol);
        if (!currentPrice) {
            return res.status(400).json({ error: `Cannot close: asset pricing feed is offline.` });
        }
        // Calculate final PnL
        let pnl = 0;
        if (trade.direction === "BUY") {
            pnl = trade.size * (currentPrice - trade.entryPrice);
        }
        else {
            pnl = trade.size * (trade.entryPrice - currentPrice);
        }
        // Update trade record
        await db_1.prisma.trade.update({
            where: { id: tradeId },
            data: {
                status: "CLOSED",
                exitPrice: currentPrice,
                closeTime: new Date(),
                grossPnl: pnl,
                terminationReason: "MANUALLY_CLOSED",
            },
        });
        // Update account balance
        const updatedBalance = trade.account.balance + pnl;
        await db_1.prisma.account.update({
            where: { id: trade.accountId },
            data: {
                balance: updatedBalance,
                equity: updatedBalance, // temp set equity to balance since no other trades
            },
        });
        console.log(`[ORDER CLOSED] Trade ${tradeId} closed. PnL: $${pnl.toFixed(2)}, New Balance: $${updatedBalance.toFixed(2)}`);
        return res.status(200).json({
            message: "Position closed successfully.",
            pnl,
            balance: updatedBalance,
        });
    }
    catch (error) {
        console.error("Close Trade Error:", error);
        return res.status(500).json({ error: "Failed to close position." });
    }
}
// 3. Cancel Pending Limit Order
async function cancelPendingOrder(req, res) {
    try {
        const { tradeId } = req.body;
        if (!tradeId) {
            return res.status(400).json({ error: "Missing trade ID parameter." });
        }
        const trade = await db_1.prisma.trade.findUnique({ where: { id: tradeId } });
        if (!trade) {
            return res.status(404).json({ error: "Order record not found." });
        }
        if (trade.status !== "PENDING") {
            return res.status(400).json({ error: "Order is not in pending state." });
        }
        await db_1.prisma.trade.update({
            where: { id: tradeId },
            data: {
                status: "CANCELLED",
                terminationReason: "MANUALLY_CLOSED",
            },
        });
        return res.status(200).json({ message: "Pending order cancelled." });
    }
    catch (err) {
        console.error("Cancel Order Error:", err);
        return res.status(500).json({ error: "Failed to cancel order." });
    }
}
// 4. Fetch Client Dashboard Accounts list
async function getUserAccounts(req, res) {
    try {
        const { userId } = req.params;
        const accounts = await db_1.prisma.account.findMany({
            where: {
                userId,
                phase: { not: "PENDING_PAYMENT" }
            },
            include: {
                challengeRule: true,
                payments: true,
                payouts: true,
            },
        });
        return res.status(200).json({ accounts });
    }
    catch (error) {
        console.error("Get User Accounts Error:", error);
        return res.status(500).json({ error: "Retrieval failed." });
    }
}
// 5. Fetch available markets
async function getMarkets(req, res) {
    try {
        const markets = await db_1.prisma.market.findMany({ where: { active: true } });
        return res.status(200).json({ markets });
    }
    catch (error) {
        console.error("Get Markets Error:", error);
        return res.status(500).json({ error: "Retrieval failed." });
    }
}

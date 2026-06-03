"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.marketGates = exports.priceMap = void 0;
exports.registerOnTick = registerOnTick;
exports.startBinanceSync = startBinanceSync;
exports.matchLimitOrders = matchLimitOrders;
exports.matchStopLossTakeProfit = matchStopLossTakeProfit;
const ws_1 = __importDefault(require("ws"));
const db_1 = require("./db");
// Global in-memory price map
exports.priceMap = new Map();
// Dynamic market gates (Admin can toggle feed status in-memory or DB)
exports.marketGates = new Map();
let ws = null;
let reconnectTimeout = null;
// Callback hooks for order execution and risk calculations
let onTickCallback = null;
function registerOnTick(callback) {
    onTickCallback = callback;
}
async function startBinanceSync() {
    if (ws) {
        ws.close();
    }
    try {
        let dbMarkets = await db_1.prisma.market.findMany({ where: { active: true } });
        if (dbMarkets.length === 0) {
            // Seed default markets
            await db_1.prisma.market.createMany({
                data: [
                    { symbol: "BTCUSDT", name: "Bitcoin", type: "CRYPTO" },
                    { symbol: "ETHUSDT", name: "Ethereum", type: "CRYPTO" },
                    { symbol: "SOLUSDT", name: "Solana", type: "CRYPTO" }
                ]
            });
            dbMarkets = await db_1.prisma.market.findMany({ where: { active: true } });
        }
        dbMarkets.forEach(m => exports.marketGates.set(m.symbol.toUpperCase(), true));
        const streams = dbMarkets.map(m => `${m.symbol.toLowerCase()}@trade`).join("/");
        const url = `wss://stream.binance.com:9443/ws/${streams}`;
        console.log(`[BINANCE] Connecting to WebSocket stream: ${url}`);
        ws = new ws_1.default(url);
        ws.on("open", () => {
            console.log("[BINANCE] WebSocket Connection Established.");
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }
        });
        ws.on("message", (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.s && message.p) {
                    const symbol = message.s.toUpperCase(); // e.g. BTCUSDT
                    const price = parseFloat(message.p);
                    // Check if market gate is open
                    const isGateOpen = exports.marketGates.get(symbol) ?? true;
                    if (!isGateOpen) {
                        return;
                    }
                    // Update current price
                    exports.priceMap.set(symbol, price);
                    // Execute tick hooks (for limit match and live risk evaluation)
                    if (onTickCallback) {
                        onTickCallback(symbol, price);
                    }
                }
            }
            catch (err) {
                // Slient parse errors
            }
        });
        ws.on("close", () => {
            console.log("[BINANCE] Connection closed. Reconnecting in 5 seconds...");
            triggerReconnect();
        });
        ws.on("error", (error) => {
            console.error("[BINANCE] WebSocket Error:", error.message);
            ws?.close();
        });
    }
    catch (dbErr) {
        console.error("[BINANCE] Failed to fetch markets from DB:", dbErr);
    }
}
function triggerReconnect() {
    if (reconnectTimeout)
        return;
    reconnectTimeout = setTimeout(() => {
        startBinanceSync();
    }, 5000);
}
// Limit Order execution engine
async function matchLimitOrders(symbol, currentPrice) {
    try {
        // Fetch all pending limit orders for the symbol
        const pendingOrders = await db_1.prisma.trade.findMany({
            where: {
                symbol,
                status: "PENDING",
                type: "LIMIT",
                triggerPrice: { not: null },
            },
            include: {
                account: true,
            },
        });
        for (const order of pendingOrders) {
            if (!order.triggerPrice)
                continue;
            let shouldFill = false;
            if (order.direction === "BUY") {
                // Buy limit fills when price drops to or below the trigger
                if (currentPrice <= order.triggerPrice) {
                    shouldFill = true;
                }
            }
            else if (order.direction === "SELL") {
                // Sell limit fills when price rises to or above the trigger
                if (currentPrice >= order.triggerPrice) {
                    shouldFill = true;
                }
            }
            if (shouldFill) {
                // Validate margin before filling
                const account = order.account;
                const openTrades = await db_1.prisma.trade.findMany({
                    where: { accountId: account.id, status: "OPEN" },
                });
                let totalUsedMargin = 0;
                let unrealizedPnl = 0;
                for (const trade of openTrades) {
                    const cPrice = exports.priceMap.get(trade.symbol) || trade.entryPrice;
                    let tradePnl = 0;
                    if (trade.direction === "BUY") {
                        tradePnl = trade.size * (cPrice - trade.entryPrice);
                    }
                    else if (trade.direction === "SELL") {
                        tradePnl = trade.size * (trade.entryPrice - cPrice);
                    }
                    unrealizedPnl += tradePnl;
                    totalUsedMargin += (trade.size * trade.entryPrice) / (trade.leverage || 1);
                }
                const currentEquity = account.balance + unrealizedPnl;
                const freeMargin = currentEquity - totalUsedMargin;
                const orderCost = (order.size * order.triggerPrice) / (order.leverage || 1);
                if (orderCost > freeMargin) {
                    console.log(`[LIMIT CANCELLED] Order ID ${order.id} insufficient margin on trigger. Cost: ${orderCost}, Free: ${freeMargin}`);
                    await db_1.prisma.trade.update({
                        where: { id: order.id },
                        data: {
                            status: "CANCELLED",
                            terminationReason: "MARGIN_CALL",
                        },
                    });
                    continue;
                }
                console.log(`[LIMIT MATCH] Order ID ${order.id} Filled. Symbol: ${symbol}, Trigger: ${order.triggerPrice}, Tick: ${currentPrice}`);
                // Update trade status to OPEN, set entry price to triggerPrice
                await db_1.prisma.trade.update({
                    where: { id: order.id },
                    data: {
                        status: "OPEN",
                        entryPrice: order.triggerPrice,
                        openTime: new Date(),
                    },
                });
            }
        }
    }
    catch (error) {
        console.error(`[LIMIT MATCH ERROR] Error matching orders for ${symbol}:`, error);
    }
}
// Stop Loss and Take Profit execution engine
async function matchStopLossTakeProfit(symbol, currentPrice) {
    try {
        const openTrades = await db_1.prisma.trade.findMany({
            where: {
                symbol,
                status: "OPEN",
                OR: [{ stopLoss: { not: null } }, { takeProfit: { not: null } }],
            },
            include: {
                account: true,
            },
        });
        for (const trade of openTrades) {
            let shouldClose = false;
            let terminationReason = "";
            if (trade.direction === "BUY") {
                if (trade.stopLoss && currentPrice <= trade.stopLoss) {
                    shouldClose = true;
                    terminationReason = "STOP_LOSS";
                }
                else if (trade.takeProfit && currentPrice >= trade.takeProfit) {
                    shouldClose = true;
                    terminationReason = "TAKE_PROFIT";
                }
            }
            else if (trade.direction === "SELL") {
                if (trade.stopLoss && currentPrice >= trade.stopLoss) {
                    shouldClose = true;
                    terminationReason = "STOP_LOSS";
                }
                else if (trade.takeProfit && currentPrice <= trade.takeProfit) {
                    shouldClose = true;
                    terminationReason = "TAKE_PROFIT";
                }
            }
            if (shouldClose) {
                console.log(`[${terminationReason}] Trade ID ${trade.id} Triggered. Symbol: ${symbol}, Price: ${currentPrice}`);
                // Calculate PnL
                let pnl = 0;
                if (trade.direction === "BUY") {
                    pnl = trade.size * (currentPrice - trade.entryPrice);
                }
                else {
                    pnl = trade.size * (trade.entryPrice - currentPrice);
                }
                // Close Trade
                await db_1.prisma.trade.update({
                    where: { id: trade.id },
                    data: {
                        status: "CLOSED",
                        exitPrice: currentPrice,
                        closeTime: new Date(),
                        grossPnl: pnl,
                        terminationReason,
                    },
                });
                // Update Account Balance
                const updatedBalance = trade.account.balance + pnl;
                await db_1.prisma.account.update({
                    where: { id: trade.accountId },
                    data: {
                        balance: updatedBalance,
                        equity: updatedBalance,
                    },
                });
            }
        }
    }
    catch (error) {
        console.error(`[SL/TP MATCH ERROR] Error matching SL/TP for ${symbol}:`, error);
    }
}

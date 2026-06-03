"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeWebSocketServer = initializeWebSocketServer;
exports.broadcastTickerUpdate = broadcastTickerUpdate;
const ws_1 = __importStar(require("ws"));
const url_1 = __importDefault(require("url"));
const db_1 = require("./db");
const binanceSync_1 = require("./binanceSync");
const riskGuardian_1 = require("./riskGuardian");
// Maps accountId -> Array of active WebSocket connections
const accountClients = new Map();
function initializeWebSocketServer(httpServer) {
    const wss = new ws_1.WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (request, socket, head) => {
        const pathname = url_1.default.parse(request.url || "").pathname;
        console.log("[WS UPGRADE] request.url:", request.url, "pathname:", pathname);
        if (pathname === "/ws") {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit("connection", ws, request);
            });
        }
        else {
            socket.destroy();
        }
    });
    wss.on("connection", async (ws, request) => {
        const parameters = url_1.default.parse(request.url || "", true).query;
        const accountId = parameters.accountId;
        if (!accountId) {
            ws.send(JSON.stringify({ type: "ERROR", message: "Missing accountId" }));
            ws.close();
            return;
        }
        // Verify account exists
        const account = await db_1.prisma.account.findUnique({
            where: { id: accountId },
        });
        if (!account) {
            ws.send(JSON.stringify({ type: "ERROR", message: "Invalid accountId" }));
            ws.close();
            return;
        }
        // Add client to registry
        if (!accountClients.has(accountId)) {
            accountClients.set(accountId, new Set());
        }
        accountClients.get(accountId).add(ws);
        console.log(`[WS] Client subscribed to account: ${accountId}`);
        // Send initial configuration and prices
        ws.send(JSON.stringify({
            type: "INIT",
            prices: Object.fromEntries(binanceSync_1.priceMap),
            gates: Object.fromEntries(binanceSync_1.marketGates),
        }));
        // Keep-alive ping loop
        const pingInterval = setInterval(() => {
            if (ws.readyState === ws_1.default.OPEN) {
                ws.ping();
            }
        }, 30000);
        ws.on("close", () => {
            clearInterval(pingInterval);
            const clients = accountClients.get(accountId);
            if (clients) {
                clients.delete(ws);
                if (clients.size === 0) {
                    accountClients.delete(accountId);
                }
            }
            console.log(`[WS] Client unsubscribed from account: ${accountId}`);
        });
        ws.on("error", (err) => {
            console.error(`[WS ERROR] account ${accountId}:`, err);
        });
    });
    // Schedule account state broadcast to subscribed clients
    setInterval(async () => {
        for (const [accountId, clients] of accountClients.entries()) {
            if (clients.size === 0)
                continue;
            try {
                const account = await db_1.prisma.account.findUnique({
                    where: { id: accountId },
                    include: { challengeRule: true },
                });
                if (!account)
                    continue;
                const openTrades = await db_1.prisma.trade.findMany({
                    where: { accountId, status: "OPEN" },
                });
                const pendingOrders = await db_1.prisma.trade.findMany({
                    where: { accountId, status: "PENDING" },
                });
                const completedHistory = await db_1.prisma.trade.findMany({
                    where: { accountId, status: { in: ["CLOSED", "CANCELLED"] } },
                    orderBy: { closeTime: 'desc' },
                    take: 50,
                });
                const { equity, unrealizedPnl } = (0, riskGuardian_1.calculateAccountEquity)(account, openTrades);
                // Daily Drawdown Floor calculations
                const rule = account.challengeRule;
                let dailyFloor = 0;
                if (rule.type === "INSTANT") {
                    dailyFloor = account.dailyStartBalance * (1 - 0.03);
                }
                else if (rule.type === "ONE_STEP") {
                    dailyFloor = account.dailyStartEquity - account.initialBalance * 0.03;
                }
                else if (rule.type === "TWO_STEP") {
                    dailyFloor = account.dailyStartEquity - account.initialBalance * 0.05;
                }
                const payload = JSON.stringify({
                    type: "ACCOUNT_UPDATE",
                    data: {
                        balance: account.balance,
                        equity: equity,
                        unrealizedPnl: unrealizedPnl,
                        dailyFloor: dailyFloor,
                        absoluteLossFloor: account.absoluteLossFloor,
                        phase: account.phase,
                        breachReason: account.breachReason,
                        tradingDaysCount: account.tradingDaysCount,
                        openPositions: openTrades,
                        pendingOrders: pendingOrders,
                        completedHistory: completedHistory,
                    },
                });
                for (const client of clients) {
                    if (client.readyState === ws_1.default.OPEN) {
                        client.send(payload);
                    }
                }
            }
            catch (err) {
                console.error(`[WS BROADCAST ERROR] Error broadcasting to ${accountId}:`, err);
            }
        }
    }, 1000);
}
// Broadcasts price updates to all active subscriptions
function broadcastTickerUpdate(symbol, price) {
    const payload = JSON.stringify({
        type: "TICK",
        data: { symbol, price },
    });
    for (const clients of accountClients.values()) {
        for (const client of clients) {
            if (client.readyState === ws_1.default.OPEN) {
                client.send(payload);
            }
        }
    }
}

import { Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import url from "url";
import { prisma } from "./db";
import { priceMap, marketGates } from "./binanceSync";
import { calculateAccountEquity } from "./riskGuardian";

// Maps accountId -> Array of active WebSocket connections
const accountClients = new Map<string, Set<WebSocket>>();

export function initializeWebSocketServer(httpServer: Server) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = url.parse(request.url || "").pathname;
    console.log("[WS UPGRADE] request.url:", request.url, "pathname:", pathname);

    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", async (ws: WebSocket, request) => {
    const parameters = url.parse(request.url || "", true).query;
    const accountId = parameters.accountId as string;

    if (!accountId) {
      ws.send(JSON.stringify({ type: "ERROR", message: "Missing accountId" }));
      ws.close();
      return;
    }

    // Verify account exists
    const account = await prisma.account.findUnique({
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
    accountClients.get(accountId)!.add(ws);

    console.log(`[WS] Client subscribed to account: ${accountId}`);

    // Send initial configuration and prices
    ws.send(
      JSON.stringify({
        type: "INIT",
        prices: Object.fromEntries(priceMap),
        gates: Object.fromEntries(marketGates),
      })
    );

    // Keep-alive ping loop
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
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
      if (clients.size === 0) continue;

      try {
        const account = await prisma.account.findUnique({
          where: { id: accountId },
          include: { challengeRule: true },
        });

        if (!account) continue;

        const openTrades = await prisma.trade.findMany({
          where: { accountId, status: "OPEN" },
        });

        const pendingOrders = await prisma.trade.findMany({
          where: { accountId, status: "PENDING" },
        });

        const completedHistory = await prisma.trade.findMany({
          where: { accountId, status: { in: ["CLOSED", "CANCELLED"] } },
          orderBy: { closeTime: 'desc' },
          take: 50,
        });

        const { equity, unrealizedPnl } = calculateAccountEquity(account, openTrades);

        // Daily Drawdown Floor calculations
        const rule = account.challengeRule;
        let dailyFloor = 0;
        if (rule.type === "INSTANT") {
          dailyFloor = account.dailyStartBalance * (1 - 0.03);
        } else if (rule.type === "ONE_STEP") {
          dailyFloor = account.dailyStartEquity - account.initialBalance * 0.03;
        } else if (rule.type === "TWO_STEP") {
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
          if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
          }
        }
      } catch (err) {
        console.error(`[WS BROADCAST ERROR] Error broadcasting to ${accountId}:`, err);
      }
    }
  }, 1000);
}

// Broadcasts price updates to all active subscriptions
export function broadcastTickerUpdate(symbol: string, price: number) {
  const payload = JSON.stringify({
    type: "TICK",
    data: { symbol, price },
  });

  for (const clients of accountClients.values()) {
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}

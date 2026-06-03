"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestUserPayoutSchema = exports.cancelPendingOrderSchema = exports.closeTradeSchema = exports.openTradeSchema = void 0;
const zod_1 = require("zod");
exports.openTradeSchema = zod_1.z.object({
    accountId: zod_1.z.string().uuid(),
    symbol: zod_1.z.string().min(2),
    direction: zod_1.z.enum(["LONG", "SHORT", "BUY", "SELL"]),
    type: zod_1.z.enum(["MARKET", "LIMIT", "STOP"]),
    size: zod_1.z.number().positive(),
    triggerPrice: zod_1.z.number().positive().optional(),
    stopLoss: zod_1.z.number().positive().optional(),
    takeProfit: zod_1.z.number().positive().optional(),
    leverage: zod_1.z.number().positive().optional(),
});
exports.closeTradeSchema = zod_1.z.object({
    tradeId: zod_1.z.string().uuid(),
});
exports.cancelPendingOrderSchema = zod_1.z.object({
    tradeId: zod_1.z.string().uuid(),
});
exports.requestUserPayoutSchema = zod_1.z.object({
    accountId: zod_1.z.string().uuid(),
    amount: zod_1.z.number().positive(),
    method: zod_1.z.string(),
    details: zod_1.z.string(),
});

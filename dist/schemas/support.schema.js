"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replyTicketSchema = exports.createTicketSchema = void 0;
const zod_1 = require("zod");
exports.createTicketSchema = zod_1.z.object({
    subject: zod_1.z.string().min(1),
    message: zod_1.z.string().min(1),
});
exports.replyTicketSchema = zod_1.z.object({
    ticketId: zod_1.z.string().uuid(),
    message: zod_1.z.string().min(1),
});

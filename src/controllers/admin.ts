import { Request, Response } from "express";
import { prisma } from "../db";
import { marketGates, priceMap } from "../binanceSync";
import { sendTemplateEmail } from "../services/email";
import jwt from "jsonwebtoken";

// helper to calculate absolute loss floor on activation
function getAbsoluteLossFloor(type: string, size: number): number {
  if (type === "INSTANT" || type === "ONE_STEP") {
    return size * (1 - 0.06); // 6% absolute max loss
  } else if (type === "TWO_STEP") {
    return size * (1 - 0.10); // 10% absolute max loss
  }
  return size * 0.90;
}

// ---------------------------------------------------------
// 1. User Management (assign plans, lists, toggle admin status)
// ---------------------------------------------------------
export async function getUsersList(req: Request, res: Response) {
  try {
    const users = await prisma.user.findMany({
      include: {
        accounts: {
          include: { challengeRule: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json(users);
  } catch (error) {
    return res.status(500).json({ error: "Failed to load users list." });
  }
}

export async function toggleUserAdminStatus(req: Request, res: Response) {
  try {
    const { userId, isAdmin } = req.body;
    if (!userId || typeof isAdmin !== "boolean") {
      return res.status(400).json({ error: "Missing userId or isAdmin status." });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { isAdmin },
    });

    console.log(`[ADMIN] Toggled admin status for User ${userId} to ${isAdmin}`);
    return res.status(200).json({ message: "Admin status toggled successfully.", user: updatedUser });
  } catch (error) {
    return res.status(500).json({ error: "Failed to toggle user admin status." });
  }
}

export async function assignChallengePlan(req: Request, res: Response) {
  try {
    const { userId, challengeRuleId } = req.body;
    if (!userId || !challengeRuleId) {
      return res.status(400).json({ error: "Missing userId or challengeRuleId parameters." });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const rule = await prisma.challengeRule.findUnique({ where: { id: challengeRuleId } });

    if (!user || !rule) {
      return res.status(404).json({ error: "User or challenge rule not found." });
    }

    const initialPhase = rule.type === "INSTANT" ? "FUNDED" : "STAGE1";

    // Direct assignment - bypasses payment Webhooks, sets account active immediately
    const account = await prisma.account.create({
      data: {
        userId: user.id,
        challengeRuleId: rule.id,
        initialBalance: rule.size,
        balance: rule.size,
        equity: rule.size,
        dailyStartBalance: rule.size,
        dailyStartEquity: rule.size,
        absoluteLossFloor: getAbsoluteLossFloor(rule.type, rule.size),
        phase: initialPhase,
      },
    });

    // Create a mock completed payment log for ledger records
    await prisma.payment.create({
      data: {
        accountId: account.id,
        amount: 0.00, // Assigned for free by admin
        currency: "USD",
        gateway: "ADMIN_ASSIGNED",
        gatewayInvoiceId: `ASSIGN-${account.id.substring(0, 8)}-${Date.now().toString().slice(-4)}`,
        status: "COMPLETED",
      },
    });

    console.log(`[ADMIN] Direct Plan Assignment: User ${userId} gets Rule ${challengeRuleId}`);

    // Notify user
    await sendTemplateEmail(user.email, "CHALLENGE_PURCHASED", {
      Name: user.fullName,
      AccountID: account.id,
      CurrentEquity: `$${rule.size.toFixed(2)}`,
    });

    return res.status(201).json({ message: "Plan assigned successfully and account activated.", account });
  } catch (error) {
    console.error("Assign Plan Error:", error);
    return res.status(500).json({ error: "Failed to assign plan." });
  }
}

// ---------------------------------------------------------
// 2. Challenge Rules Creator/Manager
// ---------------------------------------------------------
export async function createChallengeRule(req: Request, res: Response) {
  try {
    const {
      type,
      tierName,
      size,
      price,
      profitTargetPercent,
      stageOneProfitTargetPercent,
      stageOneMinTradingDays,
      stageTwoProfitTargetPercent,
      stageTwoMinTradingDays,
      fundedMinTradingDays,
      minTradeDurationMinutes,
      consistencyPercent,
      tradingPeriod,
      dailyDrawdownPercent,
      maxLossPercent,
      minTradingDays,
      leverageCrypto,
      leverageForex,
      leverageCommodities
    } = req.body;

    if (!type || !tierName || !size || !price) {
      return res.status(400).json({ error: "Missing required challenge fields." });
    }

    const defaultSelfTarget = parseFloat(profitTargetPercent || 0);
    const newRule = await prisma.challengeRule.create({
      data: {
        type,
        tierName,
        size: parseFloat(size),
        price: parseFloat(price),
        profitTargetPercent: defaultSelfTarget,
        stageOneProfitTargetPercent: parseFloat(stageOneProfitTargetPercent || defaultSelfTarget || 0),
        stageOneMinTradingDays: parseInt(stageOneMinTradingDays || minTradingDays || 0),
        stageTwoProfitTargetPercent: parseFloat(stageTwoProfitTargetPercent || (type === "TWO_STEP" ? defaultSelfTarget : 0)),
        stageTwoMinTradingDays: parseInt(stageTwoMinTradingDays || 0),
        fundedMinTradingDays: parseInt(fundedMinTradingDays || 0),
        minTradeDurationMinutes: parseInt(minTradeDurationMinutes || 0),
        consistencyPercent: parseFloat(consistencyPercent || 15),
        tradingPeriod: tradingPeriod || "Unlimited",
        dailyDrawdownPercent: parseFloat(dailyDrawdownPercent || 3),
        maxLossPercent: parseFloat(maxLossPercent || 6),
        minTradingDays: parseInt(minTradingDays || 3),
        leverageCrypto: parseFloat(leverageCrypto || 2),
        leverageForex: parseFloat(leverageForex || 100),
        leverageCommodities: parseFloat(leverageCommodities || 30),
      },
    });

    console.log(`[ADMIN] Created challenge rule plan: ${tierName}`);
    return res.status(201).json({ message: "Challenge rule plan created.", rule: newRule });
  } catch (error) {
    return res.status(500).json({ error: "Failed to create challenge rule plan." });
  }
}

export async function deleteChallengeRule(req: Request, res: Response) {
  try {
    const { ruleId } = req.body;
    if (!ruleId) return res.status(400).json({ error: "Missing rule ID." });

    await prisma.challengeRule.update({
      where: { id: ruleId },
      data: { active: false },
    });

    return res.status(200).json({ message: "Challenge plan archived/deleted successfully." });
  } catch (error) {
    return res.status(500).json({ error: "Failed to archive challenge plan." });
  }
}

export async function getChallengePurchases(req: Request, res: Response) {
  try {
    const accounts = await prisma.account.findMany({
      include: {
        user: true,
        challengeRule: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json(accounts);
  } catch (error) {
    return res.status(500).json({ error: "Failed to retrieve plan purchases." });
  }
}

// ---------------------------------------------------------
// 3. Configurations Manager (SMTP, payment keys, etc)
// ---------------------------------------------------------
export async function toggleMarketGate(req: Request, res: Response) {
  try {
    const { symbol, active } = req.body;
    if (!symbol || typeof active !== "boolean") {
      return res.status(400).json({ error: "Missing symbol or active status flag." });
    }
    const normalizedSymbol = symbol.toUpperCase();
    marketGates.set(normalizedSymbol, active);

    await prisma.systemConfig.upsert({
      where: { key: `GATE_${normalizedSymbol}` },
      update: { value: active ? "ON" : "OFF" },
      create: { key: `GATE_${normalizedSymbol}`, value: active ? "ON" : "OFF" },
    });

    console.log(`[ADMIN] Toggled Market Gate for ${normalizedSymbol}: ${active ? "ENABLED" : "DISABLED"}`);
    return res.status(200).json({ message: `Market gate for ${normalizedSymbol} toggled.`, symbol: normalizedSymbol, active });
  } catch (error) {
    return res.status(500).json({ error: "Failed to toggle market gate." });
  }
}

export async function updateSystemConfig(req: Request, res: Response) {
  try {
    const { key, value } = req.body;
    if (!key || typeof value !== "string") {
      return res.status(400).json({ error: "Invalid configuration key/value payload." });
    }

    const config = await prisma.systemConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });

    console.log(`[ADMIN] SystemConfig updated: ${key}`);
    return res.status(200).json({ message: `System parameter ${key} stored successfully.`, config });
  } catch (error) {
    return res.status(500).json({ error: "Configuration write failed." });
  }
}

export async function updateEmailTemplate(req: Request, res: Response) {
  try {
    const { key, subject, htmlPayload } = req.body;
    if (!key || !subject || !htmlPayload) {
      return res.status(400).json({ error: "Missing email template parameters." });
    }

    const template = await prisma.emailTemplate.upsert({
      where: { key },
      update: { subject, htmlPayload },
      create: { key, subject, htmlPayload },
    });

    console.log(`[ADMIN] Email Template updated: ${key}`);
    return res.status(200).json({ message: `Email template ${key} updated.`, template });
  } catch (error) {
    return res.status(500).json({ error: "Template write failed." });
  }
}

export async function getAdminDashboardSettings(req: Request, res: Response) {
  try {
    const configs = await prisma.systemConfig.findMany();
    const templates = await prisma.emailTemplate.findMany();
    const gates = Object.fromEntries(marketGates);

    return res.status(200).json({ configs, templates, gates });
  } catch (error) {
    return res.status(500).json({ error: "Failed to retrieve configurations." });
  }
}

// ---------------------------------------------------------
// 4. Payments Log
// ---------------------------------------------------------
export async function getAllPayments(req: Request, res: Response) {
  try {
    const payments = await prisma.payment.findMany({
      where: { status: { not: "PENDING" } },
      include: {
        account: {
          include: {
            user: true,
            challengeRule: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json(payments);
  } catch (error) {
    return res.status(500).json({ error: "Failed to load payments ledger." });
  }
}

// ---------------------------------------------------------
// 5. Payouts Core Engine
// ---------------------------------------------------------
export async function requestUserPayout(req: Request, res: Response) {
  try {
    const { accountId, amount, method, details } = req.body;
    if (!accountId || !amount || !method || !details) {
      return res.status(400).json({ error: "Missing required payout parameters." });
    }

      const payoutAmount = parseFloat(amount);
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      include: { challengeRule: true },
    });

    if (!account) {
      return res.status(404).json({ error: "Account portfolio not found." });
    }

    if (account.phase !== "FUNDED") {
      return res.status(400).json({ error: "Payouts are only permitted for funded accounts after challenge completion." });
    }

    const openTrades = await prisma.trade.count({
      where: { accountId, status: "OPEN" },
    });
    if (openTrades > 0) {
      return res.status(400).json({ error: "Please close all open trades before requesting a payout." });
    }

    const requiredMinDays = account.challengeRule.fundedMinTradingDays || account.challengeRule.minTradingDays;
    if (account.tradingDaysCount < requiredMinDays) {
      return res.status(400).json({ error: `Payout request blocked: complete at least ${requiredMinDays} active trading days before requesting payout.` });
    }

    const profit = account.balance - account.initialBalance;
    if (profit <= 0) {
      return res.status(400).json({ error: "No payout is available until your funded account has profit above the starting balance." });
    }

    if (payoutAmount <= 0) {
      return res.status(400).json({ error: "Payout amount must be greater than zero." });
    }

    if (payoutAmount > profit) {
      return res.status(400).json({ error: `Requested payout exceeds available profit ($${profit.toFixed(2)}).` });
    }

    if (account.balance < payoutAmount) {
      return res.status(400).json({ error: "Insufficient balance for payout." });
    }

    // Deduct payout amount from account balance immediately, and lower the loss floor to prevent false breach
    const updatedBalance = account.balance - payoutAmount;
    await prisma.account.update({
      where: { id: accountId },
      data: {
        balance: updatedBalance,
        equity: updatedBalance,
        absoluteLossFloor: Math.max(0, account.absoluteLossFloor - payoutAmount),
        dailyStartBalance: account.dailyStartBalance - payoutAmount,
        dailyStartEquity: account.dailyStartEquity - payoutAmount,
      },
    });

    // Create Payout Request
    const request = await prisma.payoutRequest.create({
      data: {
        accountId,
        amount: parseFloat(amount),
        method,
        details,
        status: "PENDING",
      },
    });

    console.log(`[PAYOUT REQUEST] Account ${accountId} requested withdrawal of $${amount}`);
    return res.status(201).json({ message: "Payout request submitted successfully.", request });
  } catch (err) {
    return res.status(500).json({ error: "Failed to request payout." });
  }
}

export async function getAllPayouts(req: Request, res: Response) {
  try {
    const requests = await prisma.payoutRequest.findMany({
      include: {
        account: {
          include: { user: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json(requests);
  } catch (error) {
    return res.status(500).json({ error: "Failed to load payout list." });
  }
}

export async function approvePayout(req: Request, res: Response) {
  try {
    const { payoutId } = req.body;
    if (!payoutId) return res.status(400).json({ error: "Missing payout ID." });

    const payout = await prisma.payoutRequest.findUnique({
      where: { id: payoutId },
      include: { account: { include: { user: true } } },
    });

    if (!payout) return res.status(404).json({ error: "Payout request not found." });
    if (payout.status !== "PENDING") {
      return res.status(400).json({ error: "Payout already finalized." });
    }

    // Approve request
    await prisma.payoutRequest.update({
      where: { id: payoutId },
      data: { status: "APPROVED" },
    });

    console.log(`[PAYOUT APPROVED] Request ID: ${payoutId}`);

    // Send email alert
    await sendTemplateEmail(payout.account.user.email, "PAYOUT_APPROVED", {
      Name: payout.account.user.fullName,
      AccountID: payout.accountId,
      CurrentEquity: `$${payout.amount.toFixed(2)} Payout Dispatched`,
    });

    return res.status(200).json({ message: "Payout approved successfully." });
  } catch (err) {
    return res.status(500).json({ error: "Failed to approve payout." });
  }
}

export async function rejectPayout(req: Request, res: Response) {
  try {
    const { payoutId } = req.body;
    if (!payoutId) return res.status(400).json({ error: "Missing payout ID." });

    const payout = await prisma.payoutRequest.findUnique({
      where: { id: payoutId },
      include: { account: true },
    });

    if (!payout) return res.status(404).json({ error: "Payout request not found." });
    if (payout.status !== "PENDING") {
      return res.status(400).json({ error: "Payout already finalized." });
    }

    // Return funds to account balance and restore loss floor
    const updatedBalance = payout.account.balance + payout.amount;
    await prisma.account.update({
      where: { id: payout.accountId },
      data: {
        balance: updatedBalance,
        equity: updatedBalance,
        absoluteLossFloor: payout.account.absoluteLossFloor + payout.amount,
        dailyStartBalance: payout.account.dailyStartBalance + payout.amount,
        dailyStartEquity: payout.account.dailyStartEquity + payout.amount,
      },
    });

    // Reject request
    await prisma.payoutRequest.update({
      where: { id: payoutId },
      data: { status: "REJECTED" },
    });

    console.log(`[PAYOUT REJECTED] Request ID: ${payoutId}. Funds returned.`);
    return res.status(200).json({ message: "Payout request rejected, funds returned." });
  } catch (err) {
    return res.status(500).json({ error: "Failed to reject payout." });
  }
}

// ---------------------------------------------------------
// 6. Support Ticketing & simulated Chat
// ---------------------------------------------------------
export async function getAdminTickets(req: Request, res: Response) {
  try {
    const tickets = await prisma.supportTicket.findMany({
      include: {
        user: true,
        messages: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return res.status(200).json(tickets);
  } catch (error) {
    return res.status(500).json({ error: "Failed to retrieve tickets." });
  }
}

export async function adminReplyTicket(req: Request, res: Response) {
  try {
    const { ticketId, message } = req.body;
    if (!ticketId || !message) {
      return res.status(400).json({ error: "Missing ticketId or reply text." });
    }

    const reply = await prisma.supportMessage.create({
      data: {
        ticketId,
        senderId: "ADMIN",
        senderName: "Support Team Admin",
        message,
      },
    });

    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: "IN_PROGRESS" },
    });

    return res.status(201).json({ message: "Admin reply sent.", reply });
  } catch (error) {
    return res.status(500).json({ error: "Failed to send admin reply." });
  }
}

export async function getUserTickets(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const tickets = await prisma.supportTicket.findMany({
      where: { userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json(tickets);
  } catch (error) {
    return res.status(500).json({ error: "Failed to load user support tickets." });
  }
}

export async function userCreateTicket(req: Request, res: Response) {
  try {
    const { userId, subject, category, message } = req.body;
    if (!userId || !subject || !category || !message) {
      return res.status(400).json({ error: "Missing required support parameters." });
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        userId,
        subject,
        category,
        status: "OPEN",
      },
    });

    const msg = await prisma.supportMessage.create({
      data: {
        ticketId: ticket.id,
        senderId: userId,
        senderName: "Client User",
        message,
      },
    });

    return res.status(201).json({ message: "Support ticket created successfully.", ticket, msg });
  } catch (error) {
    return res.status(500).json({ error: "Failed to open support ticket." });
  }
}

export async function userReplyTicket(req: Request, res: Response) {
  try {
    const { ticketId, userId, message } = req.body;
    if (!ticketId || !userId || !message) {
      return res.status(400).json({ error: "Missing required support parameters." });
    }

    const reply = await prisma.supportMessage.create({
      data: {
        ticketId,
        senderId: userId,
        senderName: "Client User",
        message,
      },
    });

    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: "OPEN" },
    });

    return res.status(201).json({ message: "Reply sent successfully.", reply });
  } catch (error) {
    return res.status(500).json({ error: "Failed to send reply." });
  }
}

// ---------------------------------------------------------
// 7. Website Configuration
// ---------------------------------------------------------
export async function getWebConfigs(req: Request, res: Response) {
  try {
    const configs = await prisma.webConfig.findMany();
    return res.status(200).json(configs);
  } catch (error) {
    return res.status(500).json({ error: "Failed to load website configuration meta." });
  }
}

export async function updateWebConfig(req: Request, res: Response) {
  try {
    const { key, value } = req.body;
    if (!key || typeof value !== "string") {
      return res.status(400).json({ error: "Invalid configuration key/value payload." });
    }

    const config = await prisma.webConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });

    return res.status(200).json({ message: `Website setting ${key} updated.`, config });
  } catch (error) {
    return res.status(500).json({ error: "Failed to save website config." });
  }
}

// ---------------------------------------------------------
// 8. Marketing Area & Bulk Emails
// ---------------------------------------------------------
export async function getInfluencers(req: Request, res: Response) {
  try {
    const lists = await prisma.influencerCollab.findMany({
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json(lists);
  } catch (error) {
    return res.status(500).json({ error: "Failed to load influencers list." });
  }
}

export async function createInfluencer(req: Request, res: Response) {
  try {
    const { name, handleInsta, handleYoutube, email, mobile, country, notes } = req.body;
    if (!name || !email || !mobile || !country) {
      return res.status(400).json({ error: "Missing required influencer details." });
    }

    const influencer = await prisma.influencerCollab.create({
      data: { name, handleInsta, handleYoutube, email, mobile, country, notes },
    });

    console.log(`[MARKETING] Added influencer collab: ${name}`);
    return res.status(201).json({ message: "Influencer added successfully.", influencer });
  } catch (error) {
    return res.status(500).json({ error: "Failed to create influencer record." });
  }
}

export async function sendBulkEmail(req: Request, res: Response) {
  try {
    const { subject, body } = req.body;
    if (!subject || !body) {
      return res.status(400).json({ error: "Missing newsletter subject or html body content." });
    }

    const activeUsers = await prisma.user.findMany();
    
    // dispatch bulk simulated newsletter in background log
    for (const u of activeUsers) {
      console.log(`\n========================================`);
      console.log(`[BULK NEWSLETTER] To: ${u.email}`);
      console.log(`[SUBJECT] ${subject}`);
      console.log(`[BODY]\n${body.replace(/{{Name}}/g, u.fullName)}`);
      console.log(`========================================\n`);
    }

    console.log(`[ADMIN] Bulk Email Marketing newsletter sent to ${activeUsers.length} active users.`);
    return res.status(200).json({ message: `Bulk newsletter successfully dispatched to ${activeUsers.length} users.` });
  } catch (error) {
    return res.status(500).json({ error: "Failed to run bulk email campaign." });
  }
}

// ---------------------------------------------------------
// 9. Coupon Management
// ---------------------------------------------------------
export async function getCoupons(req: Request, res: Response) {
  try {
    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json(coupons);
  } catch (error) {
    return res.status(500).json({ error: "Failed to load coupons list." });
  }
}

export async function createCoupon(req: Request, res: Response) {
  try {
    const { code, limitUses, expiryDate, discountType, discountValue, applicablePlanIds } = req.body;
    if (!code || !limitUses || !expiryDate || !discountType || !discountValue) {
      return res.status(400).json({ error: "Missing required coupon parameters." });
    }

    const coupon = await prisma.coupon.create({
      data: {
        code: code.toUpperCase().trim(),
        limitUses: parseInt(limitUses),
        expiryDate: new Date(expiryDate),
        discountType,
        discountValue: parseFloat(discountValue),
        applicablePlanIds: applicablePlanIds || "ALL",
      },
    });

    console.log(`[ADMIN] Coupon created: ${code}`);
    return res.status(201).json({ message: "Coupon created successfully.", coupon });
  } catch (error) {
    return res.status(500).json({ error: "Failed to create coupon." });
  }
}

export async function validateCoupon(req: Request, res: Response) {
  try {
    const { code, planId } = req.body;
    if (!code) return res.status(400).json({ error: "Missing coupon code." });

    const coupon = await prisma.coupon.findUnique({
      where: { code: code.toUpperCase().trim() },
    });

    if (!coupon || !coupon.active) {
      return res.status(400).json({ error: "Invalid or inactive coupon code." });
    }

    // Expiry check
    if (new Date() > new Date(coupon.expiryDate)) {
      return res.status(400).json({ error: "Coupon code has expired." });
    }

    // Usage check
    if (coupon.usedCount >= coupon.limitUses) {
      return res.status(400).json({ error: "Coupon usage limit reached." });
    }

    // Applicable plans check
    if (coupon.applicablePlanIds !== "ALL" && planId) {
      const plansList = JSON.parse(coupon.applicablePlanIds);
      if (Array.isArray(plansList) && !plansList.includes(planId)) {
        return res.status(400).json({ error: "Coupon code not applicable to this challenge plan." });
      }
    }

    return res.status(200).json({
      valid: true,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to validate coupon code." });
  }
}

// ---------------------------------------------------------
// 10. User Portfolio Management & Session Impersonation
// ---------------------------------------------------------

const JWT_SECRET = process.env.JWT_SECRET || "propfirm_secure_jwt_secret_token";

// Helper to liquidate open positions and set account phase to BREACHED
async function forceBreachAccount(accountId: string, reason: string) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    include: { user: true },
  });
  if (!account) return;

  const openTrades = await prisma.trade.findMany({
    where: { accountId: account.id, status: "OPEN" },
  });

  // Force close open positions
  for (const trade of openTrades) {
    const currentPrice = priceMap.get(trade.symbol) || trade.entryPrice;
    let finalPnl = 0;
    if (trade.direction === "BUY") {
      finalPnl = trade.size * (currentPrice - trade.entryPrice);
    } else {
      finalPnl = trade.size * (trade.entryPrice - currentPrice);
    }

    await prisma.trade.update({
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
  await prisma.account.update({
    where: { id: account.id },
    data: {
      phase: "BREACHED",
      breachReason: reason,
    },
  });

  // Notify user via template
  try {
    await sendTemplateEmail(account.user.email, "MAX_LOSS_BREACH", {
      Name: account.user.fullName,
      AccountID: account.id,
      CurrentEquity: `$${account.equity.toFixed(2)}`,
      Reason: reason,
    });
  } catch (err) {
    console.error("Failed to send suspension email notification:", err);
  }
}

export async function updateUserProfile(req: Request, res: Response) {
  try {
    const { userId, fullName, email, mobile, country, customAffPercent, tags } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId parameters." });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        fullName,
        email: email ? email.toLowerCase().trim() : undefined,
        mobile,
        country,
        customAffPercent: customAffPercent !== undefined && customAffPercent !== null && customAffPercent !== "" ? parseFloat(customAffPercent) : null,
        tags: tags || null,
      },
    });

    console.log(`[ADMIN] Updated profile for user ${userId}`);
    return res.status(200).json({ message: "User profile updated successfully.", user: updatedUser });
  } catch (error) {
    console.error("Update User Profile Error:", error);
    return res.status(500).json({ error: "Failed to update user profile." });
  }
}

export async function updateChallengeRule(req: Request, res: Response) {
  try {
    const {
      id,
      type,
      tierName,
      size,
      price,
      profitTargetPercent,
      stageOneProfitTargetPercent,
      stageOneMinTradingDays,
      stageTwoProfitTargetPercent,
      stageTwoMinTradingDays,
      fundedMinTradingDays,
      minTradeDurationMinutes,
      consistencyPercent,
      tradingPeriod,
      dailyDrawdownPercent,
      maxLossPercent,
      minTradingDays,
      leverageCrypto,
      leverageForex,
      leverageCommodities
    } = req.body;

    if (!id || !type || !tierName || !size || !price) {
      return res.status(400).json({ error: "Missing required challenge fields." });
    }

    const defaultSelfTarget = parseFloat(profitTargetPercent || 0);
    const updatedRule = await prisma.challengeRule.update({
      where: { id },
      data: {
        type,
        tierName,
        size: parseFloat(size),
        price: parseFloat(price),
        profitTargetPercent: defaultSelfTarget,
        stageOneProfitTargetPercent: parseFloat(stageOneProfitTargetPercent || defaultSelfTarget || 0),
        stageOneMinTradingDays: parseInt(stageOneMinTradingDays || minTradingDays || 0),
        stageTwoProfitTargetPercent: parseFloat(stageTwoProfitTargetPercent || (type === "TWO_STEP" ? defaultSelfTarget : 0)),
        stageTwoMinTradingDays: parseInt(stageTwoMinTradingDays || 0),
        fundedMinTradingDays: parseInt(fundedMinTradingDays || 0),
        minTradeDurationMinutes: parseInt(minTradeDurationMinutes || 0),
        consistencyPercent: parseFloat(consistencyPercent || 15),
        tradingPeriod: tradingPeriod || "Unlimited",
        dailyDrawdownPercent: parseFloat(dailyDrawdownPercent || 3),
        maxLossPercent: parseFloat(maxLossPercent || 6),
        minTradingDays: parseInt(minTradingDays || 3),
        leverageCrypto: parseFloat(leverageCrypto || 2),
        leverageForex: parseFloat(leverageForex || 100),
        leverageCommodities: parseFloat(leverageCommodities || 30),
      },
    });

    return res.status(200).json({ message: "Challenge Rule updated successfully.", rule: updatedRule });
  } catch (error) {
    console.error("Update Challenge Rule Error:", error);
    return res.status(500).json({ error: "Failed to update challenge rule tier." });
  }
}

export async function suspendUserAccount(req: Request, res: Response) {
  try {
    const { userId, isSuspended, reason } = req.body;
    if (!userId || typeof isSuspended !== "boolean") {
      return res.status(400).json({ error: "Missing userId or isSuspended flag." });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { accounts: true },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        isSuspended,
        suspensionReason: isSuspended ? (reason || "Suspended by Administrator") : null,
      },
    });

    if (isSuspended) {
      console.log(`[ADMIN] Suspending User ${userId}. Accounts are NOT automatically breached.`);
    } else {
      console.log(`[ADMIN] Unsuspended User ${userId}.`);
    }

    return res.status(200).json({
      message: isSuspended ? "User account suspended successfully." : "User account unsuspended successfully.",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Suspend User Account Error:", error);
    return res.status(500).json({ error: "Failed to update user suspension status." });
  }
}

export async function suspendChallengePlan(req: Request, res: Response) {
  try {
    const { accountId, reason } = req.body;
    if (!accountId) {
      return res.status(400).json({ error: "Missing accountId parameter." });
    }

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      return res.status(404).json({ error: "Challenge account not found." });
    }

    console.log(`[ADMIN] Suspending challenge plan account ${accountId}. Liquidating open trades.`);
    await forceBreachAccount(accountId, reason || "Challenge account suspended by Administrator");

    return res.status(200).json({ message: "Challenge plan account suspended and force liquidated." });
  } catch (error) {
    console.error("Suspend Challenge Plan Error:", error);
    return res.status(500).json({ error: "Failed to suspend challenge plan account." });
  }
}

export async function impersonateUserSession(req: Request, res: Response) {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId parameter." });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    // Sign JWT for user, flag as impersonatedByAdmin
    const token = jwt.sign(
      { id: user.id, email: user.email, isAdmin: user.isAdmin, impersonatedByAdmin: true },
      JWT_SECRET,
      { expiresIn: "1h" } // short lived token for security
    );

    console.log(`[ADMIN] Generated impersonation session token for User ${user.email}`);
    return res.status(200).json({
      message: "Impersonation session generated successfully.",
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        isAdmin: user.isAdmin,
      },
    });
  } catch (error) {
    console.error("Impersonate User Session Error:", error);
    return res.status(500).json({ error: "Failed to generate impersonation token." });
  }
}

export async function getUserDetail(req: Request, res: Response) {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        accounts: {
          include: { challengeRule: true },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    return res.status(200).json(user);
  } catch (error) {
    console.error("Get User Detail Error:", error);
    return res.status(500).json({ error: "Failed to load user details." });
  }
}

export async function liftChallengePlanBreach(req: Request, res: Response) {
  try {
    const { accountId, restorePhase } = req.body;
    if (!accountId || !restorePhase) {
      return res.status(400).json({ error: "Missing accountId or restorePhase." });
    }

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      include: { challengeRule: true },
    });

    if (!account) {
      return res.status(404).json({ error: "Account portfolio not found." });
    }

    const rule = account.challengeRule;
    const initialBal = rule.size;
    const absLossFloor = getAbsoluteLossFloor(rule.type, initialBal);

    const updatedAccount = await prisma.account.update({
      where: { id: accountId },
      data: {
        phase: restorePhase,
        balance: initialBal,
        equity: initialBal,
        dailyStartBalance: initialBal,
        dailyStartEquity: initialBal,
        absoluteLossFloor: absLossFloor,
      },
    });

    console.log(`[ADMIN] Lifted breach on Account ${accountId}. Restored to phase: ${restorePhase}`);
    return res.status(200).json({
      message: `Account breach lifted successfully. Restored to ${restorePhase} phase.`,
      account: updatedAccount,
    });
  } catch (error) {
    console.error("Lift Plan Breach Error:", error);
    return res.status(500).json({ error: "Failed to lift account breach." });
  }
}

export async function createMarket(req: Request, res: Response) {
  try {
    const { symbol, name, type, logoUrl } = req.body;
    if (!symbol || !name) {
      return res.status(400).json({ error: "Symbol and Name are required." });
    }

    const market = await prisma.market.create({
      data: {
        symbol: symbol.toUpperCase(),
        name,
        type: type || "CRYPTO",
        logoUrl,
        active: true,
      },
    });

    return res.status(201).json({ message: "Market created successfully.", market });
  } catch (error: any) {
    console.error("Create Market Error:", error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: "Market symbol already exists." });
    }
    return res.status(500).json({ error: "Failed to create market." });
  }
}

import { startBinanceSync } from "../binanceSync";

export async function restartBinanceFeed(req: Request, res: Response) {
  try {
    startBinanceSync();
    return res.status(200).json({ message: "Binance feed re-synchronized with active markets." });
  } catch (error) {
    return res.status(500).json({ error: "Failed to restart feed." });
  }
}

export async function deleteMarket(req: Request, res: Response) {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ error: "Symbol required." });
    
    await prisma.market.delete({
      where: { symbol }
    });
    
    return res.status(200).json({ message: "Market removed." });
  } catch (error) {
    console.error("Delete Market Error:", error);
    return res.status(500).json({ error: "Failed to delete market." });
  }
}

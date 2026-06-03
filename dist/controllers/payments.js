"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.purchaseChallenge = purchaseChallenge;
exports.handleOxapayCallback = handleOxapayCallback;
exports.verifyRazorpay = verifyRazorpay;
exports.validateCoupon = validateCoupon;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const email_1 = require("../services/email");
// Helper to calculate absolute loss floor on activation
function getAbsoluteLossFloor(type, size) {
    if (type === "INSTANT" || type === "ONE_STEP") {
        return size * (1 - 0.06); // 6% absolute max loss
    }
    else if (type === "TWO_STEP") {
        return size * (1 - 0.10); // 10% absolute max loss
    }
    return size * 0.90;
}
// 1. Purchase Challenge / Initiate Invoice
async function purchaseChallenge(req, res) {
    try {
        const { userId, challengeRuleId, gateway, couponCode } = req.body;
        const currency = gateway === "RAZORPAY" ? "INR" : "USD";
        if (!userId || !challengeRuleId || !gateway) {
            return res.status(400).json({ error: "Missing required booking details." });
        }
        const user = await db_1.prisma.user.findUnique({ where: { id: userId } });
        const rule = await db_1.prisma.challengeRule.findUnique({ where: { id: challengeRuleId } });
        if (!user || !rule) {
            return res.status(404).json({ error: "User or Challenge Rule not found." });
        }
        let discountAmount = 0;
        if (couponCode) {
            const coupon = await db_1.prisma.coupon.findUnique({ where: { code: couponCode.toUpperCase() } });
            if (coupon && coupon.active && coupon.usedCount < coupon.limitUses && new Date() <= new Date(coupon.expiryDate)) {
                if (coupon.discountType === "PERCENT") {
                    discountAmount = rule.price * (coupon.discountValue / 100);
                }
                else {
                    discountAmount = coupon.discountValue;
                }
                if (discountAmount > rule.price)
                    discountAmount = rule.price;
            }
        }
        const finalAmount = rule.price - discountAmount;
        if (gateway === "RAZORPAY") {
            const inrAmount = Math.round(finalAmount * 95);
            const secretConfig = await db_1.prisma.systemConfig.findUnique({ where: { key: "RAZORPAY_KEY_SECRET" } });
            const idConfig = await db_1.prisma.systemConfig.findUnique({ where: { key: "RAZORPAY_KEY_ID" } });
            try {
                const authHeader = 'Basic ' + Buffer.from(`${idConfig?.value || ""}:${secretConfig?.value || ""}`).toString('base64');
                const rzpResponse = await fetch('https://api.razorpay.com/v1/orders', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': authHeader,
                        'Origin': 'https://indiacoders.in'
                    },
                    body: JSON.stringify({
                        amount: inrAmount * 100, // paise
                        currency: "INR",
                        notes: {
                            userId: user.id,
                            challengeRuleId: rule.id,
                            couponCode: couponCode || ""
                        }
                    })
                });
                if (!rzpResponse.ok) {
                    throw new Error(await rzpResponse.text());
                }
                const order = await rzpResponse.json();
                const proxyConfig = await db_1.prisma.systemConfig.findUnique({ where: { key: "RAZORPAY_PROXY_URL" } });
                return res.status(201).json({
                    message: "Razorpay order created.",
                    orderId: order.id,
                    razorpayKeyId: idConfig?.value,
                    amount: finalAmount,
                    inrAmount,
                    proxyUrl: proxyConfig?.value || "http://localhost/propfirm2/php-razorpay/course-payment.php"
                });
            }
            catch (e) {
                console.error("Razorpay order creation failed:", e);
                return res.status(500).json({ error: "Razorpay order creation failed. Please check your API keys." });
            }
        }
        // OXAPAY Flow (Requires pending database records because it is asynchronous)
        const account = await db_1.prisma.account.create({
            data: {
                userId: user.id,
                challengeRuleId: rule.id,
                initialBalance: rule.size,
                balance: rule.size,
                equity: rule.size,
                dailyStartBalance: rule.size,
                dailyStartEquity: rule.size,
                absoluteLossFloor: getAbsoluteLossFloor(rule.type, rule.size),
                phase: "PENDING_PAYMENT",
            },
        });
        let gatewayInvoiceId = `INV-${account.id.substring(0, 8)}-${Date.now().toString().slice(-6)}`;
        let paymentUrl = `https://oxapay.com/checkout?invoice=${gatewayInvoiceId}`;
        const oxapayKey = await db_1.prisma.systemConfig.findUnique({ where: { key: "OXAPAY_API_KEY" } });
        const merchantKey = oxapayKey?.value || "63DV7L-RAGDKN-EBLMX3-WSNPRE";
        const https = require("https");
        try {
            const payload = JSON.stringify({
                merchant: merchantKey,
                amount: finalAmount,
                currency: "USD",
                lifeTime: 60,
                orderId: gatewayInvoiceId
            });
            const options = {
                hostname: "api.oxapay.com",
                path: "/merchants/request",
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(payload)
                }
            };
            const oxaData = await new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    let data = "";
                    res.on("data", (chunk) => data += chunk);
                    res.on("end", () => {
                        try {
                            resolve(JSON.parse(data));
                        }
                        catch (e) {
                            reject(e);
                        }
                    });
                });
                req.on("error", reject);
                req.write(payload);
                req.end();
            });
            if (oxaData.result === 100) {
                gatewayInvoiceId = oxaData.trackId.toString(); // Oxapay webhook returns this as trackId
                paymentUrl = oxaData.payLink;
            }
            else {
                console.error("Oxapay error:", oxaData);
                return res.status(400).json({ error: `Oxapay error: ${oxaData.message}` });
            }
        }
        catch (apiErr) {
            console.error("Oxapay API call failed:", apiErr);
            return res.status(500).json({ error: `Failed to contact Oxapay API: ${apiErr.message || apiErr}` });
        }
        const payment = await db_1.prisma.payment.create({
            data: {
                accountId: account.id,
                amount: finalAmount,
                currency,
                gateway,
                gatewayInvoiceId,
                status: "PENDING",
            },
        });
        return res.status(201).json({
            message: "Challenge purchased, pending payment.",
            accountId: account.id,
            paymentId: payment.id,
            paymentUrl,
            amount: finalAmount,
        });
    }
    catch (error) {
        console.error("Purchase Challenge Error:", error);
        return res.status(500).json({ error: "Internal server error." });
    }
}
// 2. Oxapay Webhook Callback
async function handleOxapayCallback(req, res) {
    try {
        const { trackId, status, amount } = req.body;
        // Fetch config for Oxapay security key check (simulate verification)
        const apiKeyConfig = await db_1.prisma.systemConfig.findUnique({
            where: { key: "OXAPAY_API_KEY" },
        });
        // In production, verify HMAC signature or trackId matching
        console.log(`[OXAPAY WEBHOOK] Callback received for invoice trackId: ${trackId}, Status: ${status}`);
        if (status === "Paid" || status === "confirming" || status === "success") {
            const payment = await db_1.prisma.payment.findFirst({
                where: { gatewayInvoiceId: trackId, gateway: "OXAPAY" },
                include: { account: { include: { challengeRule: true, user: true } } },
            });
            if (!payment) {
                return res.status(404).json({ error: "Payment record matching trackId not found." });
            }
            if (payment.status === "COMPLETED") {
                return res.status(200).json({ message: "Already processed." });
            }
            // Mark payment complete
            await db_1.prisma.payment.update({
                where: { id: payment.id },
                data: { status: "COMPLETED" },
            });
            // Activate Account based on challenge rules
            await activateTradingAccount(payment.account);
            return res.status(200).json({ message: "Payment verified, account activated." });
        }
        return res.status(200).json({ message: "Callback processed without status update." });
    }
    catch (err) {
        console.error("Oxapay Callback Error:", err);
        return res.status(500).json({ error: "Webhook process failed." });
    }
}
// 3. Synchronous Razorpay Verification
async function verifyRazorpay(req, res) {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ error: "Missing Razorpay verification payload." });
        }
        const secretConfig = await db_1.prisma.systemConfig.findUnique({
            where: { key: "RAZORPAY_KEY_SECRET" },
        });
        const idConfig = await db_1.prisma.systemConfig.findUnique({
            where: { key: "RAZORPAY_KEY_ID" },
        });
        const secret = secretConfig?.value;
        if (!secret)
            return res.status(500).json({ error: "Razorpay secret not configured." });
        // Verify Signature
        const expectedSignature = crypto_1.default
            .createHmac("sha256", secret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest("hex");
        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ error: "Invalid payment signature." });
        }
        // Fetch Order details from Razorpay to get the Notes we passed earlier
        const authHeader = 'Basic ' + Buffer.from(`${idConfig?.value || ""}:${secret}`).toString('base64');
        const rzpResponse = await fetch(`https://api.razorpay.com/v1/orders/${razorpay_order_id}`, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Origin': 'https://indiacoders.in'
            }
        });
        if (!rzpResponse.ok) {
            throw new Error(await rzpResponse.text());
        }
        const order = await rzpResponse.json();
        const { userId, challengeRuleId, couponCode } = order.notes;
        if (!userId || !challengeRuleId) {
            return res.status(400).json({ error: "Missing order metadata in Razorpay." });
        }
        const user = await db_1.prisma.user.findUnique({ where: { id: userId } });
        const rule = await db_1.prisma.challengeRule.findUnique({ where: { id: challengeRuleId } });
        if (!user || !rule) {
            return res.status(404).json({ error: "User or Rule not found during verification." });
        }
        // Calculate final amount exactly like purchaseChallenge did
        let discountAmount = 0;
        if (couponCode) {
            const coupon = await db_1.prisma.coupon.findUnique({ where: { code: couponCode } });
            if (coupon && coupon.active) {
                if (coupon.discountType === "PERCENT")
                    discountAmount = rule.price * (coupon.discountValue / 100);
                else
                    discountAmount = coupon.discountValue;
                if (discountAmount > rule.price)
                    discountAmount = rule.price;
                // Increment coupon usage
                await db_1.prisma.coupon.update({
                    where: { id: coupon.id },
                    data: { usedCount: { increment: 1 } }
                });
            }
        }
        const finalAmount = rule.price - discountAmount;
        // Verify order amount matches expected inrAmount
        const expectedInrAmount = Math.round(finalAmount * 95);
        if (Number(order.amount) !== expectedInrAmount * 100) {
            return res.status(400).json({ error: "Order amount mismatch." });
        }
        // Create Account DIRECTLY as FUNDED / STAGE1 (skip PENDING)
        const initialPhase = rule.type === "INSTANT" ? "FUNDED" : "STAGE1";
        const account = await db_1.prisma.account.create({
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
            }
        });
        // Create COMPLETED Payment log
        await db_1.prisma.payment.create({
            data: {
                accountId: account.id,
                amount: finalAmount,
                currency: "INR",
                gateway: "RAZORPAY",
                gatewayInvoiceId: razorpay_order_id,
                status: "COMPLETED",
            }
        });
        console.log(`[RAZORPAY SYNC] Payment Verified! Account ${account.id} activated.`);
        // Send onboarding email notification
        await (0, email_1.sendTemplateEmail)(user.email, "CHALLENGE_PURCHASED", {
            Name: user.fullName,
            AccountID: account.id,
            CurrentEquity: `$${rule.size.toFixed(2)}`,
        });
        return res.status(200).json({ message: "Payment verified successfully", accountId: account.id });
    }
    catch (err) {
        console.error("Razorpay Verification Error:", err);
        return res.status(500).json({ error: "Payment verification failed." });
    }
}
/**
 * Transition account from PENDING_PAYMENT to active trading stage
 */
async function activateTradingAccount(account) {
    const rule = account.challengeRule;
    // Instant Account bypasses validation steps and goes directly to FUNDED
    const initialPhase = rule.type === "INSTANT" ? "FUNDED" : "STAGE1";
    await db_1.prisma.account.update({
        where: { id: account.id },
        data: {
            phase: initialPhase,
            balance: rule.size,
            equity: rule.size,
            dailyStartBalance: rule.size,
            dailyStartEquity: rule.size,
            absoluteLossFloor: getAbsoluteLossFloor(rule.type, rule.size),
        },
    });
    console.log(`[PAYMENT SUCCESS] Account ${account.id} activated. Initial Phase: ${initialPhase}`);
    // Send onboarding email notification
    await (0, email_1.sendTemplateEmail)(account.user.email, "CHALLENGE_PURCHASED", {
        Name: account.user.fullName,
        AccountID: account.id,
        CurrentEquity: `$${rule.size.toFixed(2)}`,
    });
}
// 4. Validate Coupon
async function validateCoupon(req, res) {
    try {
        const { code, challengeRuleId } = req.body;
        if (!code || !challengeRuleId) {
            return res.status(400).json({ error: "Coupon code and plan ID required." });
        }
        const coupon = await db_1.prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
        if (!coupon || !coupon.active) {
            return res.status(400).json({ error: "Invalid or inactive coupon code." });
        }
        if (new Date() > new Date(coupon.expiryDate)) {
            return res.status(400).json({ error: "This coupon has expired." });
        }
        if (coupon.usedCount >= coupon.limitUses) {
            return res.status(400).json({ error: "Coupon usage limit reached." });
        }
        const rule = await db_1.prisma.challengeRule.findUnique({ where: { id: challengeRuleId } });
        if (!rule)
            return res.status(404).json({ error: "Challenge not found." });
        if (coupon.applicablePlanIds !== "ALL") {
            try {
                const allowedIds = JSON.parse(coupon.applicablePlanIds);
                if (!allowedIds.includes(challengeRuleId)) {
                    return res.status(400).json({ error: "Coupon not applicable for this challenge." });
                }
            }
            catch (e) {
                if (coupon.applicablePlanIds !== challengeRuleId) {
                    return res.status(400).json({ error: "Coupon not applicable for this challenge." });
                }
            }
        }
        let discountAmount = 0;
        if (coupon.discountType === "PERCENT") {
            discountAmount = rule.price * (coupon.discountValue / 100);
        }
        else {
            discountAmount = coupon.discountValue;
        }
        if (discountAmount > rule.price)
            discountAmount = rule.price;
        return res.status(200).json({ discountAmount, finalPrice: rule.price - discountAmount });
    }
    catch (error) {
        console.error("Validate Coupon Error:", error);
        return res.status(500).json({ error: "Failed to validate coupon." });
    }
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTemplateEmail = sendTemplateEmail;
const db_1 = require("../db");
async function sendTemplateEmail(userEmail, templateKey, variables) {
    try {
        // 1. Fetch template from DB
        let template = await db_1.prisma.emailTemplate.findUnique({
            where: { key: templateKey },
        });
        // 2. Default fallbacks if database templates are not seeded yet
        if (!template) {
            const defaultTemplates = {
                CHALLENGE_PURCHASED: {
                    subject: "Welcome to your Prop Firm Challenge!",
                    html: "<h1>Welcome {{Name}}</h1><p>Your trading account <strong>{{AccountID}}</strong> is active. Current Equity: {{CurrentEquity}}</p>",
                },
                DRAWDOWN_BREACH: {
                    subject: "ALERT: Daily Drawdown Exceeded",
                    html: "<h1>Rule Breach Detected</h1><p>Dear {{Name}}, your account {{AccountID}} breached daily drawdown limits. Current Equity: {{CurrentEquity}}. Reason: {{Reason}}</p>",
                },
                MAX_LOSS_BREACH: {
                    subject: "ALERT: Absolute Max Loss Breached",
                    html: "<h1>Account Terminated</h1><p>Dear {{Name}}, your account {{AccountID}} has breached the absolute max loss limit. Current Equity: {{CurrentEquity}}. Reason: {{Reason}}</p>",
                },
                ACCOUNT_PASSED: {
                    subject: "Congratulations! Challenge Passed",
                    html: "<h1>Verification Milestone Achieved!</h1><p>Dear {{Name}}, your account {{AccountID}} has successfully passed the criteria. Current Equity: {{CurrentEquity}}</p>",
                },
                PAYOUT_APPROVED: {
                    subject: "Payout Approved!",
                    html: "<h1>Payout Sent</h1><p>Dear {{Name}}, your payout for account {{AccountID}} has been processed. Current Equity: {{CurrentEquity}}</p>",
                },
            };
            const fallback = defaultTemplates[templateKey] || {
                subject: "Prop Firm Notification",
                html: "<p>Dear {{Name}}, account {{AccountID}} status updated to {{CurrentEquity}}</p>",
            };
            template = await db_1.prisma.emailTemplate.create({
                data: {
                    key: templateKey,
                    subject: fallback.subject,
                    htmlPayload: fallback.html,
                },
            });
        }
        // 3. Compile variables
        let compiledHtml = template.htmlPayload;
        let compiledSubject = template.subject;
        for (const key of Object.keys(variables)) {
            const placeholder = new RegExp(`{{${key}}}`, "g");
            const val = variables[key] || "";
            compiledHtml = compiledHtml.replace(placeholder, val);
            compiledSubject = compiledSubject.replace(placeholder, val);
        }
        // 4. Log/send mock email
        console.log(`\n========================================`);
        console.log(`[EMAIL DISPATCH] To: ${userEmail}`);
        console.log(`[SUBJECT] ${compiledSubject}`);
        console.log(`[BODY]\n${compiledHtml}`);
        console.log(`========================================\n`);
    }
    catch (error) {
        console.error("Failed to compile or dispatch email template:", error);
    }
}

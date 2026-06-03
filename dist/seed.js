"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Seeding database...');
    // Create Admin User
    const adminPassword = await bcryptjs_1.default.hash('admin123', 10);
    const adminUser = await prisma.user.upsert({
        where: { email: 'admin@propfirm.com' },
        update: {},
        create: {
            fullName: 'Super Admin',
            email: 'admin@propfirm.com',
            passwordHash: adminPassword,
            kycStatus: 'APPROVED',
            isAdmin: true,
        },
    });
    console.log(`Admin user created: ${adminUser.email}`);
    // Challenge Rules
    const challenges = [
        {
            "id": "dd818826-6460-402d-aa2c-70be301ff552",
            "type": "INSTANT",
            "tierName": "Starter Instant $5K",
            "size": 5000,
            "price": 49,
            "profitTargetPercent": 0,
            "stageOneProfitTargetPercent": 0,
            "stageOneMinTradingDays": 0,
            "stageTwoProfitTargetPercent": 0,
            "stageTwoMinTradingDays": 0,
            "fundedMinTradingDays": 0,
            "consistencyPercent": 15,
            "tradingPeriod": "Unlimited",
            "dailyDrawdownPercent": 3,
            "maxLossPercent": 6,
            "minTradingDays": 0,
            "minTradeDurationMinutes": 0,
            "leverageCrypto": 100,
            "leverageForex": 100,
            "leverageCommodities": 30,
            "active": true
        },
        {
            "id": "77acfbc5-df3c-4d15-a332-d45b72f4d2b1",
            "type": "INSTANT",
            "tierName": "Pro Instant $25K",
            "size": 25000,
            "price": 199,
            "profitTargetPercent": 0,
            "stageOneProfitTargetPercent": 0,
            "stageOneMinTradingDays": 0,
            "stageTwoProfitTargetPercent": 0,
            "stageTwoMinTradingDays": 0,
            "fundedMinTradingDays": 0,
            "consistencyPercent": 15,
            "tradingPeriod": "Unlimited",
            "dailyDrawdownPercent": 3,
            "maxLossPercent": 6,
            "minTradingDays": 0,
            "minTradeDurationMinutes": 0,
            "leverageCrypto": 2,
            "leverageForex": 100,
            "leverageCommodities": 30,
            "active": true
        },
        {
            "id": "e64200ce-5a88-42ac-84d8-6945510f66e7",
            "type": "INSTANT",
            "tierName": "Master Instant $100K",
            "size": 100000,
            "price": 699,
            "profitTargetPercent": 0,
            "stageOneProfitTargetPercent": 0,
            "stageOneMinTradingDays": 0,
            "stageTwoProfitTargetPercent": 0,
            "stageTwoMinTradingDays": 0,
            "fundedMinTradingDays": 0,
            "consistencyPercent": 15,
            "tradingPeriod": "Unlimited",
            "dailyDrawdownPercent": 3,
            "maxLossPercent": 6,
            "minTradingDays": 0,
            "minTradeDurationMinutes": 0,
            "leverageCrypto": 2,
            "leverageForex": 100,
            "leverageCommodities": 30,
            "active": true
        },
        {
            "id": "e331e991-dadd-4947-9044-34619765c89a",
            "type": "ONE_STEP",
            "tierName": "Starter 1-Step $10K",
            "size": 10000,
            "price": 79,
            "profitTargetPercent": 10,
            "stageOneProfitTargetPercent": 0,
            "stageOneMinTradingDays": 0,
            "stageTwoProfitTargetPercent": 0,
            "stageTwoMinTradingDays": 0,
            "fundedMinTradingDays": 0,
            "consistencyPercent": 15,
            "tradingPeriod": "Unlimited",
            "dailyDrawdownPercent": 3,
            "maxLossPercent": 6,
            "minTradingDays": 3,
            "minTradeDurationMinutes": 0,
            "leverageCrypto": 2,
            "leverageForex": 100,
            "leverageCommodities": 30,
            "active": true
        },
        {
            "id": "2acd71ee-3e58-45e2-9082-3304ce270ac6",
            "type": "ONE_STEP",
            "tierName": "Pro 1-Step $50K",
            "size": 50000,
            "price": 299,
            "profitTargetPercent": 10,
            "stageOneProfitTargetPercent": 10,
            "stageOneMinTradingDays": 3,
            "stageTwoProfitTargetPercent": 0,
            "stageTwoMinTradingDays": 0,
            "fundedMinTradingDays": 0,
            "consistencyPercent": 15,
            "tradingPeriod": "Unlimited",
            "dailyDrawdownPercent": 3,
            "maxLossPercent": 6,
            "minTradingDays": 3,
            "minTradeDurationMinutes": 0,
            "leverageCrypto": 100,
            "leverageForex": 100,
            "leverageCommodities": 30,
            "active": true
        },
        {
            "id": "0eb212a3-2b98-4144-8867-1caa227d3368",
            "type": "ONE_STEP",
            "tierName": "Master 1-Step $100K",
            "size": 100000,
            "price": 499,
            "profitTargetPercent": 10,
            "stageOneProfitTargetPercent": 0,
            "stageOneMinTradingDays": 0,
            "stageTwoProfitTargetPercent": 0,
            "stageTwoMinTradingDays": 0,
            "fundedMinTradingDays": 0,
            "consistencyPercent": 15,
            "tradingPeriod": "Unlimited",
            "dailyDrawdownPercent": 3,
            "maxLossPercent": 6,
            "minTradingDays": 3,
            "minTradeDurationMinutes": 0,
            "leverageCrypto": 2,
            "leverageForex": 100,
            "leverageCommodities": 30,
            "active": true
        },
        {
            "id": "0dbea5b1-dd4f-404d-b28e-b6f41d2f82b9",
            "type": "TWO_STEP",
            "tierName": "Starter 2-Step $10K",
            "size": 10000,
            "price": 69,
            "profitTargetPercent": 8,
            "stageOneProfitTargetPercent": 8,
            "stageOneMinTradingDays": 5,
            "stageTwoProfitTargetPercent": 8,
            "stageTwoMinTradingDays": 0,
            "fundedMinTradingDays": 0,
            "consistencyPercent": 15,
            "tradingPeriod": "Unlimited",
            "dailyDrawdownPercent": 5,
            "maxLossPercent": 10,
            "minTradingDays": 5,
            "minTradeDurationMinutes": 0,
            "leverageCrypto": 100,
            "leverageForex": 100,
            "leverageCommodities": 30,
            "active": true
        },
        {
            "id": "e23daa40-a302-4e16-80eb-137f797ea321",
            "type": "TWO_STEP",
            "tierName": "Pro 2-Step $50K",
            "size": 50000,
            "price": 249,
            "profitTargetPercent": 8,
            "stageOneProfitTargetPercent": 0,
            "stageOneMinTradingDays": 0,
            "stageTwoProfitTargetPercent": 0,
            "stageTwoMinTradingDays": 0,
            "fundedMinTradingDays": 0,
            "consistencyPercent": 15,
            "tradingPeriod": "Unlimited",
            "dailyDrawdownPercent": 5,
            "maxLossPercent": 10,
            "minTradingDays": 5,
            "minTradeDurationMinutes": 0,
            "leverageCrypto": 2,
            "leverageForex": 100,
            "leverageCommodities": 30,
            "active": true
        },
        {
            "id": "41ff6cb2-50b6-4101-b178-59dce0175406",
            "type": "TWO_STEP",
            "tierName": "Master 2-Step $100K",
            "size": 100000,
            "price": 429,
            "profitTargetPercent": 8,
            "stageOneProfitTargetPercent": 0,
            "stageOneMinTradingDays": 0,
            "stageTwoProfitTargetPercent": 0,
            "stageTwoMinTradingDays": 0,
            "fundedMinTradingDays": 0,
            "consistencyPercent": 15,
            "tradingPeriod": "Unlimited",
            "dailyDrawdownPercent": 5,
            "maxLossPercent": 10,
            "minTradingDays": 5,
            "minTradeDurationMinutes": 0,
            "leverageCrypto": 2,
            "leverageForex": 100,
            "leverageCommodities": 30,
            "active": true
        }
    ];
    for (const challenge of challenges) {
        await prisma.challengeRule.upsert({
            where: { id: challenge.id },
            update: {},
            create: challenge,
        });
    }
    console.log(`Seeded ${challenges.length} challenge rules.`);
    // Core configuration defaults
    const configs = [
        { key: "SITE_NAME", value: "FundedDEX" },
        { key: "PROXY_URL", value: "http://localhost:80/propfirm2/php-razorpay/course-payment.php" }
    ];
    for (const config of configs) {
        await prisma.systemConfig.upsert({
            where: { key: config.key },
            update: {},
            create: config,
        });
    }
    console.log(`Seeded core configuration settings.`);
    // Essential Markets
    const markets = [
        { symbol: "BTCUSDT", name: "Bitcoin", type: "CRYPTO", active: true },
        { symbol: "ETHUSDT", name: "Ethereum", type: "CRYPTO", active: true },
        { symbol: "SOLUSDT", name: "Solana", type: "CRYPTO", active: true },
    ];
    for (const market of markets) {
        await prisma.market.upsert({
            where: { symbol: market.symbol },
            update: {},
            create: market,
        });
    }
    console.log(`Seeded default markets.`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});

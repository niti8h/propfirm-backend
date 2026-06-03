"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signup = signup;
exports.login = login;
exports.authenticateToken = authenticateToken;
exports.getUserProfile = getUserProfile;
exports.forgotPassword = forgotPassword;
exports.resetPassword = resetPassword;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../db");
const JWT_SECRET = process.env.JWT_SECRET || "propfirm_secure_jwt_secret_token";
// 1. Signup / Register
async function signup(req, res) {
    try {
        const { fullName, email, password, mobile, country } = req.body;
        if (!fullName || !email || !password) {
            return res.status(400).json({ error: "Missing fullName, email, or password." });
        }
        const normalizedEmail = email.toLowerCase().trim();
        // Check if user already exists
        const existingUser = await db_1.prisma.user.findUnique({
            where: { email: normalizedEmail },
        });
        if (existingUser) {
            return res.status(400).json({ error: "Email already registered." });
        }
        // Hash password
        const salt = await bcryptjs_1.default.genSalt(10);
        const passwordHash = await bcryptjs_1.default.hash(password, salt);
        // Default admin checks (let's make first user or specific emails admin)
        const isAdmin = normalizedEmail.includes("admin@") || normalizedEmail === "admin@propfirm.com";
        // Create User
        const user = await db_1.prisma.user.create({
            data: {
                fullName,
                email: normalizedEmail,
                passwordHash,
                mobile,
                country,
                isAdmin,
                kycStatus: "APPROVED", // Auto-approved for simulation simplicity
            },
        });
        // Sign JWT
        const token = jsonwebtoken_1.default.sign({ id: user.id, email: user.email, isAdmin: user.isAdmin }, JWT_SECRET, {
            expiresIn: "7d",
        });
        return res.status(201).json({
            message: "Registration completed.",
            token,
            user: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                isAdmin: user.isAdmin,
            },
        });
    }
    catch (err) {
        console.error("Signup error:", err);
        return res.status(500).json({ error: "Registration process failed." });
    }
}
// 2. Login
async function login(req, res) {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Missing email or password." });
        }
        const normalizedEmail = email.toLowerCase().trim();
        const user = await db_1.prisma.user.findUnique({
            where: { email: normalizedEmail },
        });
        if (!user) {
            return res.status(401).json({ error: "Invalid credentials." });
        }
        // Check if suspended
        if (user.isSuspended) {
            return res.status(403).json({
                error: `Your account is suspended. Reason: ${user.suspensionReason || "No reason specified"}`
            });
        }
        // Verify password
        const isMatch = await bcryptjs_1.default.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid credentials." });
        }
        // Sign JWT
        const token = jsonwebtoken_1.default.sign({ id: user.id, email: user.email, isAdmin: user.isAdmin }, JWT_SECRET, {
            expiresIn: "7d",
        });
        return res.status(200).json({
            message: "Login successful.",
            token,
            user: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                isAdmin: user.isAdmin,
            },
        });
    }
    catch (err) {
        console.error("Login error:", err);
        return res.status(500).json({ error: "Login authentication failed." });
    }
}
// 3. Middleware to authenticate requests
function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) {
        return res.status(401).json({ error: "Access token missing." });
    }
    jsonwebtoken_1.default.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: "Access token invalid or expired." });
        }
        try {
            if (decoded && decoded.id) {
                const userRecord = await db_1.prisma.user.findUnique({
                    where: { id: decoded.id },
                    select: { isSuspended: true, suspensionReason: true },
                });
                if (userRecord?.isSuspended && !decoded.impersonatedByAdmin) {
                    return res.status(403).json({
                        error: `Your account is suspended. Reason: ${userRecord.suspensionReason || "No reason specified"}`
                    });
                }
            }
        }
        catch (dbErr) {
            console.error("Database error during suspension check:", dbErr);
        }
        req.user = decoded;
        next();
    });
}
async function getUserProfile(req, res) {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: "Unauthorized" });
        const userRecord = await db_1.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                fullName: true,
                email: true,
                mobile: true,
                country: true,
                kycStatus: true,
                isAdmin: true,
                isSuspended: true,
                suspensionReason: true,
                customAffPercent: true,
                tags: true,
                createdAt: true,
            },
        });
        return res.status(200).json(userRecord);
    }
    catch (error) {
        return res.status(500).json({ error: "Failed to fetch profile." });
    }
}
const crypto_1 = __importDefault(require("crypto"));
async function forgotPassword(req, res) {
    try {
        const { email } = req.body;
        if (!email)
            return res.status(400).json({ error: "Email is required." });
        const user = await db_1.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
        if (!user) {
            // Always return success to prevent email enumeration
            return res.status(200).json({ message: "If an account exists, a reset link has been generated." });
        }
        const resetToken = crypto_1.default.randomBytes(32).toString('hex');
        const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour
        await db_1.prisma.user.update({
            where: { id: user.id },
            data: {
                resetToken,
                resetTokenExpiry,
            },
        });
        const resetLink = `http://localhost:3000/reset-password?token=${resetToken}`;
        console.log(`\n\n=== PASSWORD RESET LINK ===\nUser: ${user.email}\nLink: ${resetLink}\n===========================\n\n`);
        return res.status(200).json({ message: "If an account exists, a reset link has been generated." });
    }
    catch (error) {
        console.error("Forgot password error:", error);
        return res.status(500).json({ error: "Failed to process request." });
    }
}
async function resetPassword(req, res) {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword)
            return res.status(400).json({ error: "Token and new password are required." });
        const user = await db_1.prisma.user.findFirst({
            where: {
                resetToken: token,
                resetTokenExpiry: { gte: new Date() },
            },
        });
        if (!user) {
            return res.status(400).json({ error: "Invalid or expired reset token." });
        }
        const salt = await bcryptjs_1.default.genSalt(10);
        const passwordHash = await bcryptjs_1.default.hash(newPassword, salt);
        await db_1.prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash,
                resetToken: null,
                resetTokenExpiry: null,
            },
        });
        return res.status(200).json({ message: "Password has been successfully reset." });
    }
    catch (error) {
        console.error("Reset password error:", error);
        return res.status(500).json({ error: "Failed to reset password." });
    }
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = void 0;
const zod_1 = require("zod");
const validate = (schema) => {
    return (req, res, next) => {
        try {
            // We assume most schemas validate the body. 
            // If we need to validate query or params, we can pass an object schema containing body, query, params
            schema.parse(req.body);
            next();
        }
        catch (error) {
            if (error instanceof zod_1.ZodError || error.issues || error.errors) {
                const issues = error.issues || error.errors || [];
                const errors = issues.map((err) => ({
                    path: err.path?.join('.') || '',
                    message: err.message || ''
                }));
                return res.status(400).json({ error: "Validation failed", details: errors });
            }
            console.error("Validation error:", error);
            return res.status(500).json({ error: "Internal Server Error during validation" });
        }
    };
};
exports.validate = validate;

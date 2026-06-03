import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

export const validate = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // We assume most schemas validate the body. 
      // If we need to validate query or params, we can pass an object schema containing body, query, params
      schema.parse(req.body);
      next();
    } catch (error: any) {
      if (error instanceof ZodError || error.issues || error.errors) {
        const issues = error.issues || error.errors || [];
        const errors = issues.map((err: any) => ({
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

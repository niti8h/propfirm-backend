import { z } from "zod";

export const signupSchema = z.object({
  fullName: z.string().min(2, "Full name is too short"),
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  mobile: z.string().optional(),
  country: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

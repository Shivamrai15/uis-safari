import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { JWT_SECRET } from "../lib/config.js";

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) throw new Error("No token provided");
    const decoded = jwt.verify(token, JWT_SECRET!);
    if (!decoded || typeof decoded === "string" || typeof decoded.userId !== "string") {
      throw new Error("Invalid token");
    }
    req.user = decoded as { userId: string; email: string };
    next();
  } catch (error) {
    // console.error("AUTH MIDDLEWARE ERROR:", error);
    res.status(401).json({
      status: false,
      message: "Unauthorized access",
      data: {},
    });
  }
}

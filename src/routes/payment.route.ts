import { Router } from "express";
import { createPaymentSheet } from "../controllers/payment.controller.js";

export const paymentRouter = Router();

paymentRouter.post("/payment-sheet", createPaymentSheet);

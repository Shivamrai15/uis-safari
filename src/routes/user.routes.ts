import { Router } from "express";
import {
  deleteHistory,
  getUserHistory,
  setUserHistory,
} from "../controllers/history.controller.js";
import {
  getAccountDetails,
  getUserOrderHistory,
  updateAccountSettings,
} from "../controllers/account.controller.js";
import {
  registerDevice,
  unregisterDevice,
} from "../controllers/device.controller.js";

export const userRouter = Router();

userRouter.get("/history", getUserHistory);
userRouter.post("/history", setUserHistory);
userRouter.delete("/history", deleteHistory);
userRouter.get("/account", getAccountDetails);
userRouter.post("/account", updateAccountSettings);
userRouter.get("/payments/order-history", getUserOrderHistory);
userRouter.post("/devices", registerDevice);
userRouter.delete("/devices", unregisterDevice);

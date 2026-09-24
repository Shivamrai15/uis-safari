import { Router } from "express";
import { inviteToJam } from "../controllers/jam.controller.js";

export const jamRouter = Router();

jamRouter.post("/invite", inviteToJam);

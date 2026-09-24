import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./config.js";

const PURPOSE = "playlist-join";
const SHARE_TOKEN_TTL = "7d";
const shareSecret = () => `${JWT_SECRET}:${PURPOSE}`;

export const createPlaylistShareToken = (playlistId: string) =>
    jwt.sign({ playlistId, purpose: PURPOSE }, shareSecret(), { expiresIn: SHARE_TOKEN_TTL });

export const readPlaylistShareToken = (token: string): string | null => {
    try {
        const decoded = jwt.verify(token, shareSecret()) as { playlistId?: unknown; purpose?: unknown };
        if (decoded.purpose !== PURPOSE || typeof decoded.playlistId !== "string") return null;
        return decoded.playlistId;
    } catch {
        return null;
    }
};

export const playlistShareLink = (token: string) => `safarimusic://playlist-join?token=${encodeURIComponent(token)}`;

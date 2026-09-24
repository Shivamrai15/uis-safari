import { createClient } from 'redis';

const [redisHost, redisPortText] = (process.env.REDIS_URL || 'localhost').split(':');
const redisPort = Number(redisPortText) || Number(process.env.REDIS_PORT) || 16296;

export const redis = createClient({
    username: 'default',
    password: process.env.REDIS_PASSWORD || '',
    socket: {
        host: redisHost,
        port: redisPort
    }
});

redis.on("connect", () => console.log("Redis Client Connected"));
redis.on("error", (err) => console.error("Redis Client Error", err));

export async function connectRedis() {
    try {
        await redis.connect();
        console.log("Redis connection established");
    } catch (error) {
        console.error("Failed to connect to Redis:", error);
        throw error;
    }
}

export async function disconnectRedis() {
    try {
        await redis.quit();
        console.log("Redis connection closed");
    } catch (error) {
        console.error("Error disconnecting from Redis:", error);
    }
}
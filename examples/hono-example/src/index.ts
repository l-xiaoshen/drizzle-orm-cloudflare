import { drizzle } from "@drizzle-orm-cloudflare/node-postgres";
import { Hono } from "hono";
import * as schema from "./schema";
import { count } from "drizzle-orm";




const db = drizzle.withContext({ schema });

const app = new Hono<{
    Bindings: Cloudflare.Env;
}>();

// database middleware
app.use((c, next) => {
    return db.run(c.env.DB.connectionString, next);
});

app.get("/", async (c) => {
    const users = await db.select({ count: count() }).from(schema.users);
    return c.json(users);
});

export default app;
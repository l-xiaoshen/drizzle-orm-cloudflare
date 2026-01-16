# Hono example

Use middleware to establish the database context for all routes:

```typescript
import { drizzle } from "@drizzle-orm-cloudflare/node-postgres";
import { Hono } from "hono";
import * as schema from "./schema";

const db = drizzle.withContext({ schema });

const app = new Hono<{ Bindings: Cloudflare.Env }>();

app.use((c, next) => {
  return db.run(c.env.DB.connectionString, next);
});

app.get("/", async (c) => {
  const users = await db.select().from(schema.users);
  return c.json(users);
});

export default app;
```

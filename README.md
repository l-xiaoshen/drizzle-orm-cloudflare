# drizzle-orm-cloudflare

Cloudflare Workers adapters for Drizzle ORM with AsyncLocalStorage support.

> **Note:** This package requires the release candidate version of `drizzle-orm`. Install it with:
> ```bash
> bun add drizzle-orm@1.0.0-rc.4
> ```

## Packages

- [@drizzle-orm-cloudflare/node-postgres](./pkgs/node-postgres/) — PostgreSQL adapter

## Quick start

```bash
bun add @drizzle-orm-cloudflare/node-postgres drizzle-orm@1.0.0-rc.4
```

```typescript
import { drizzle } from "@drizzle-orm-cloudflare/node-postgres";
import * as schema from "./schema";

const db = drizzle.withContext();

export default {
  async fetch(request: Request, env: Env) {
    return db.run(env.DATABASE_URL, async () => {
      const users = await db.select().from(schema.users);
      return Response.json(users);
    });
  },
};
```

## Examples

- [Hono example](./examples/hono-example/)

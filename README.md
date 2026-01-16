# drizzle-orm-cloudflare

Cloudflare Workers adapters for Drizzle ORM with AsyncLocalStorage support.

> **Note:** This package requires the **beta version** of `drizzle-orm`. Install it with:
> ```bash
> bun add drizzle-orm@beta
> ```

## Packages

- [@drizzle-orm-cloudflare/node-postgres](./pkgs/node-postgres/) — PostgreSQL adapter

## Quick start

```bash
bun add @drizzle-orm-cloudflare/node-postgres drizzle-orm
```

```typescript
import { drizzle } from "@drizzle-orm-cloudflare/node-postgres";
import * as schema from "./schema";

const db = drizzle.withContext({ schema });

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

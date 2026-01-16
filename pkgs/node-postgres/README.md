# drizzle-orm-cloudflare/node-postgres

Drizzle ORM adapter for PostgreSQL with **AsyncLocalStorage** support for Cloudflare Workers.

## Installation

```bash
bun add drizzle-orm-cloudflare/node-postgres
```

## Usage

Use `drizzle.withContext()` to create a request-scoped database instance:

```typescript
import { drizzle } from 'drizzle-orm-cloudflare/node-postgres';
import * as schema from './schema';

const db = drizzle.withContext({ schema });

export default {
  async fetch(request: Request, env: Env) {
    return db.run(env.DB_CLIENT, async () => {
      const users = await db.select().from(schema.users);
      return Response.json(users);
    });
  }
};
```

### Connection string

Pass a connection string directly to create a `pg.Pool` automatically:

```typescript
db.run(env.DATABASE_URL, async () => {
  const users = await db.select().from(schema.users);
  return Response.json(users);
});
```

### Lazy client creation

Pass a factory function to create the client only when needed:

```typescript
db.run(
  () => new Pool({ connectionString: env.DATABASE_URL }),
  async () => {
    const users = await db.select().from(schema.users);
    return Response.json(users);
  }
);
```

## API

### `drizzle.withContext(config?)`

Creates a context-aware database instance. Accepts standard Drizzle config options (`schema`, `logger`, `casing`).

### `db.run(clientOrFactory, callback)`

Runs a callback within a request-scoped context.

- `clientOrFactory` — A connection string, `NodePgClient`, or `() => NodePgClient` factory
- `callback` — Function to execute

## Requirements

- Cloudflare Workers with `nodejs_compat` flag enabled

import type { Cache } from 'drizzle-orm/cache/core/cache';
import { entityKind } from 'drizzle-orm/entity';
import type { Logger } from 'drizzle-orm/logger';
import { DefaultLogger } from 'drizzle-orm/logger';
import type { NodePgClient, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { NodePgSession } from 'drizzle-orm/node-postgres';
import { nodePgCodecs } from 'drizzle-orm/node-postgres/codecs';
import { PgAsyncDatabase } from 'drizzle-orm/pg-core/async/db';
import { PgDialect } from 'drizzle-orm/pg-core/dialect';
import type { DrizzlePgConfig } from 'drizzle-orm/pg-core/utils';
import type { AnyRelations, EmptyRelations } from 'drizzle-orm/relations';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

export interface PgDriverOptions {
    logger?: Logger;
    cache?: Cache;
}

/** Context stored in AsyncLocalStorage for request-scoped database connections */
export interface DrizzleContext {
    client?: NodePgClient;
    factory?: () => NodePgClient;
}

const asyncLocalStorage = new AsyncLocalStorage<DrizzleContext>();

function getClientFromContext(): NodePgClient {
    const context = asyncLocalStorage.getStore();
    if (!context) {
        throw new Error(
            'No database context found. Make sure to call db.run() to establish a request context.',
        );
    }

    if (context.client) {
        return context.client;
    }

    if (context.factory) {
        context.client = context.factory();
        return context.client;
    }

    throw new Error(
        'No client or factory found in context. This should not happen.',
    );
}

export class NodePgDatabase<
    TRelations extends AnyRelations = EmptyRelations,
> extends PgAsyncDatabase<NodePgQueryResultHKT, TRelations> {
    static override readonly [entityKind]: string = 'NodePgDatabase';
}

/** Database instance with AsyncLocalStorage context support for Cloudflare Workers */
export class NodePgDatabaseWithContext<
    TRelations extends AnyRelations = EmptyRelations,
> extends NodePgDatabase<TRelations> {
    /**
     * Run a callback with a request-scoped database client.
     * The client can be provided directly or via a factory function for lazy creation.
     *
     * @param clientOrFactory - Either a NodePgClient instance or a factory function that creates one
     * @param callback - The async callback to run within the database context
     * @returns The result of the callback
     *
     * @example
     * // With existing client
     * await db.run(pool, async () => {
     *   return await db.select().from(users);
     * });
     *
     * @example
     * // With lazy factory (client created only when first query runs)
     * await db.run(() => new Pool({ connectionString }), async () => {
     *   return await db.select().from(users);
     * });
     */
    async run<T>(
        clientOrFactory: NodePgClient | (() => NodePgClient) | string,
        callback: () => Promise<T>,
    ): Promise<T> {
        let context: DrizzleContext;
        if (typeof clientOrFactory === 'string') {
            const instance = new pg.Pool({
                connectionString: clientOrFactory,
            });
            context = { client: instance };
        } else if (typeof clientOrFactory === 'function') {
            context = { factory: clientOrFactory };
        } else {
            context = { client: clientOrFactory };
        }

        return asyncLocalStorage.run(context, callback);
    }
}

function constructWithContext<
    TRelations extends AnyRelations = EmptyRelations,
>(
    config: DrizzlePgConfig<TRelations> = {},
): NodePgDatabaseWithContext<TRelations> {
    const dialect = new PgDialect({
        useJitMappers: config.jit,
        codecs: config.codecs ?? nodePgCodecs,
    });
    let logger: Logger | undefined;
    if (config.logger === true) {
        logger = new DefaultLogger();
    } else if (config.logger !== false) {
        logger = config.logger;
    }

    const relations = config.relations ?? {} as TRelations;

    const session = new NodePgSession(undefined as unknown as NodePgClient, dialect, relations, {
        logger,
        cache: config.cache,
    });

    Object.defineProperty(session, 'client', {
        get: () => getClientFromContext(),
    });

    const db = new NodePgDatabaseWithContext<TRelations>(
        dialect,
        session,
        relations,
    );

    (<any>db).$cache = config.cache;
    if ((<any>db).$cache) {
        (<any>db).$cache['invalidate'] = config.cache?.onMutate;
    }

    return db;
}

export namespace drizzle {
    /**
     * Creates a context-aware database instance for use in Cloudflare Workers.
     * Uses AsyncLocalStorage to maintain request-scoped database connections.
     *
     * @param config - Drizzle configuration (relations, logger, cache, jit, codecs)
     * @returns A database instance with a `run()` method for request-scoped execution
     *
     * @example
     * // Setup (module level)
     * const db = drizzle.withContext({ relations });
     *
     * // Usage in Cloudflare Worker fetch handler
     * export default {
     *   async fetch(request, env) {
     *     return db.run(env.DB, async () => {
     *       const users = await db.select().from(usersTable);
     *       return Response.json(users);
     *     });
     *   }
     * };
     *
     * @example
     * // With lazy client creation
     * export default {
     *   async fetch(request, env) {
     *     return db.run(() => new Pool({ connectionString: env.DATABASE_URL }), async () => {
     *       const users = await db.select().from(usersTable);
     *       return Response.json(users);
     *     });
     *   }
     * };
     */
    export function withContext<
        TRelations extends AnyRelations = EmptyRelations,
    >(
        config?: DrizzlePgConfig<TRelations>,
    ): NodePgDatabaseWithContext<TRelations> {
        return constructWithContext(config);
    }
}

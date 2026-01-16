import { AsyncLocalStorage } from 'node:async_hooks';
import pg, { type Pool, type PoolConfig } from 'pg';
import * as V1 from 'drizzle-orm/_relations';
import type { Cache } from 'drizzle-orm/cache/core/cache';
import { entityKind } from 'drizzle-orm/entity';
import type { Logger } from 'drizzle-orm/logger';
import { DefaultLogger } from 'drizzle-orm/logger';
import { PgAsyncDatabase } from 'drizzle-orm/pg-core/async/db';
import { PgDialect } from 'drizzle-orm/pg-core/dialect';
import type { AnyRelations, EmptyRelations } from 'drizzle-orm/relations';
import type { DrizzleConfig } from 'drizzle-orm/utils';
import type { NodePgClient, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { NodePgSession } from 'drizzle-orm/node-postgres';

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
    TSchema extends Record<string, unknown> = Record<string, never>,
    TRelations extends AnyRelations = EmptyRelations,
> extends PgAsyncDatabase<NodePgQueryResultHKT, TSchema, TRelations> {
    static override readonly [entityKind]: string = 'NodePgDatabase';
}

function construct<
    TSchema extends Record<string, unknown> = Record<string, never>,
    TRelations extends AnyRelations = EmptyRelations,
    TClient extends NodePgClient = NodePgClient,
>(
    client: TClient,
    config: DrizzleConfig<TSchema, TRelations> = {},
): NodePgDatabase<TSchema, TRelations> & {
    $client: NodePgClient extends TClient ? Pool : TClient;
} {
    const dialect = new PgDialect({ casing: config.casing });
    let logger;
    if (config.logger === true) {
        logger = new DefaultLogger();
    } else if (config.logger !== false) {
        logger = config.logger;
    }

    let schema: V1.RelationalSchemaConfig<V1.TablesRelationalConfig> | undefined;
    if (config.schema) {
        const tablesConfig = V1.extractTablesRelationalConfig(
            config.schema,
            V1.createTableRelationsHelpers,
        );
        schema = {
            fullSchema: config.schema,
            schema: tablesConfig.tables,
            tableNamesMap: tablesConfig.tableNamesMap,
        };
    }

    const relations = config.relations ?? {};
    const session = new NodePgSession(client, dialect, relations, schema, {
        logger,
        cache: config.cache,
    });

    const db = new NodePgDatabase(
        dialect,
        session,
        relations,
        schema as V1.RelationalSchemaConfig<any>,
    ) as NodePgDatabase<TSchema>;
    (<any>db).$client = client;
    (<any>db).$cache = config.cache;
    if ((<any>db).$cache) {
        (<any>db).$cache['invalidate'] = config.cache?.onMutate;
    }

    return db as any;
}

export function drizzle<
    TSchema extends Record<string, unknown> = Record<string, never>,
    TRelations extends AnyRelations = EmptyRelations,
    TClient extends NodePgClient = Pool,
>(
    ...params:
        | [
            string,
        ]
        | [
            string,
            DrizzleConfig<TSchema, TRelations>,
        ]
        | [
            & DrizzleConfig<TSchema, TRelations>
            & ({
                client: TClient;
            } | {
                connection: string | PoolConfig;
            }),
        ]
): NodePgDatabase<TSchema, TRelations> & {
    $client: NodePgClient extends TClient ? Pool : TClient;
} {
    if (typeof params[0] === 'string') {
        const instance = new pg.Pool({
            connectionString: params[0],
        });

        return construct(instance, params[1] as DrizzleConfig<TSchema, TRelations> | undefined) as any;
    }

    const { connection, client, ...drizzleConfig } = params[0] as (
        & ({ connection?: PoolConfig | string; client?: TClient })
        & DrizzleConfig<TSchema, TRelations>
    );

    if (client) return construct(client, drizzleConfig);

    const instance = typeof connection === 'string'
        ? new pg.Pool({
            connectionString: connection,
        })
        : new pg.Pool(connection!);

    return construct(instance, drizzleConfig) as any;
}

/** Database instance with AsyncLocalStorage context support for Cloudflare Workers */
export interface NodePgDatabaseWithContext<
    TSchema extends Record<string, unknown> = Record<string, never>,
    TRelations extends AnyRelations = EmptyRelations,
> extends NodePgDatabase<TSchema, TRelations> {
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
    run<T>(
        clientOrFactory: NodePgClient | (() => NodePgClient),
        callback: () => Promise<T>,
    ): Promise<T>;

    /**
     * Run a callback with a request-scoped database client created from a connection string.
     *
     * @param connectionString - A PostgreSQL connection string
     * @param callback - The async callback to run within the database context
     * @returns The result of the callback
     *
     * @example
     * await db.run(env.DATABASE_URL, async () => {
     *   return await db.select().from(users);
     * });
     */
    run<T>(
        connectionString: string,
        callback: () => Promise<T>,
    ): Promise<T>;
}

function constructWithContext<
    TSchema extends Record<string, unknown> = Record<string, never>,
    TRelations extends AnyRelations = EmptyRelations,
>(
    config: DrizzleConfig<TSchema, TRelations> = {},
): NodePgDatabaseWithContext<TSchema, TRelations> {
    const dialect = new PgDialect({ casing: config.casing });
    let logger: Logger | undefined;
    if (config.logger === true) {
        logger = new DefaultLogger();
    } else if (config.logger !== false) {
        logger = config.logger;
    }

    let schema: V1.RelationalSchemaConfig<V1.TablesRelationalConfig> | undefined;
    if (config.schema) {
        const tablesConfig = V1.extractTablesRelationalConfig(
            config.schema,
            V1.createTableRelationsHelpers,
        );
        schema = {
            fullSchema: config.schema,
            schema: tablesConfig.tables,
            tableNamesMap: tablesConfig.tableNamesMap,
        };
    }

    const relations = config.relations ?? {};

    const proxyClient = {
        query: (queryTextOrConfig: any, values?: any) => {
            const client = getClientFromContext();
            return client.query(queryTextOrConfig, values);
        },
    } as NodePgClient;

    const session = new NodePgSession(proxyClient, dialect, relations, schema, {
        logger,
        cache: config.cache,
    });

    const db = new NodePgDatabase(
        dialect,
        session,
        relations,
        schema as V1.RelationalSchemaConfig<any>,
    ) as NodePgDatabaseWithContext<TSchema, TRelations>;

    (<any>db).$cache = config.cache;
    if ((<any>db).$cache) {
        (<any>db).$cache['invalidate'] = config.cache?.onMutate;
    }

    db.run = async function <T>(
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
    };

    return db;
}

export namespace drizzle {
    export function mock<
        TSchema extends Record<string, unknown> = Record<string, never>,
        TRelations extends AnyRelations = EmptyRelations,
    >(
        config?: DrizzleConfig<TSchema, TRelations>,
    ): NodePgDatabase<TSchema, TRelations> & {
        $client: '$client is not available on drizzle.mock()';
    } {
        return construct({} as any, config) as any;
    }

    /**
     * Creates a context-aware database instance for use in Cloudflare Workers.
     * Uses AsyncLocalStorage to maintain request-scoped database connections.
     *
     * @param config - Drizzle configuration (schema, relations, logger, cache, casing)
     * @returns A database instance with a `run()` method for request-scoped execution
     *
     * @example
     * // Setup (module level)
     * const db = drizzle.withContext({ schema });
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
        TSchema extends Record<string, unknown> = Record<string, never>,
        TRelations extends AnyRelations = EmptyRelations,
    >(
        config?: DrizzleConfig<TSchema, TRelations>,
    ): NodePgDatabaseWithContext<TSchema, TRelations> {
        return constructWithContext(config);
    }
}
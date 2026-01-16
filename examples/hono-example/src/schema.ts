import { bigint, boolean, pgTable, timestamp, uuid } from "drizzle-orm/pg-core"

export const users = pgTable("users", {
	user_id: uuid("user_id").primaryKey(),

})

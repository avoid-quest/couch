import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

// node:sqlite plus the two conveniences Couch's queries rely on: cached
// statements whose get() returns null when no row matches, and transactions
// that nest as savepoints.
export class Database extends DatabaseSync {
  #statements = new Map<string, StatementSync>();

  query<Row = Record<string, unknown>, P extends SQLInputValue[] = SQLInputValue[]>(sql: string) {
    let statement = this.#statements.get(sql);
    if (!statement) this.#statements.set(sql, statement = this.prepare(sql));
    const prepared = statement;
    return {
      all: (...params: P) => prepared.all(...params) as Row[],
      get: (...params: P) => (prepared.get(...params) ?? null) as Row | null,
      run: (...params: P) => prepared.run(...params),
      iterate: (...params: P) => prepared.iterate(...params) as IterableIterator<Row>,
    };
  }

  transaction<A extends unknown[], R>(body: (...args: A) => R) {
    const run = (begin: string) => (...args: A): R => {
      const nested = this.isTransaction;
      this.exec(nested ? "SAVEPOINT nested" : begin);
      try {
        const result = body(...args);
        this.exec(nested ? "RELEASE nested" : "COMMIT");
        return result;
      } catch (error) {
        this.exec(nested ? "ROLLBACK TO nested; RELEASE nested" : "ROLLBACK");
        throw error;
      }
    };
    return Object.assign(run("BEGIN"), { immediate: run("BEGIN IMMEDIATE") });
  }
}

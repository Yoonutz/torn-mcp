// @license MIT
// Durable Object backing the OAuth token store: one instance per token record,
// named "<kind>:<id>". It holds only the encrypted key (see oauth.ts) and
// deletes itself when the record expires.
import { DurableObject } from "cloudflare:workers";
import type { StoredRecord, TokenStore } from "./oauth.js";

export class OAuthRecord extends DurableObject {
  async put(record: StoredRecord): Promise<void> {
    await this.ctx.storage.put("r", record);
    await this.ctx.storage.setAlarm(record.exp);
  }

  async read(): Promise<StoredRecord | null> {
    return (await this.ctx.storage.get<StoredRecord>("r")) ?? null;
  }

  async take(): Promise<StoredRecord | null> {
    const record = await this.read();
    if (record) await this.remove();
    return record;
  }

  async remove(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

export function durableTokenStore(ns: DurableObjectNamespace<OAuthRecord>): TokenStore {
  const stub = (name: string) => ns.get(ns.idFromName(name));
  return {
    put: async (name, record) => stub(name).put(record),
    get: async (name) => stub(name).read(),
    take: async (name) => stub(name).take(),
    delete: async (name) => stub(name).remove(),
  };
}

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { WikiDoc, WikiNote } from "../types";

interface Row {
  [key: string]: unknown;
}

let dbInstances = new Map<string, LanceDBClient>();

export class LanceDBClient {
  private dbPath: string;
  private locks: Map<string, Promise<void>> = new Map();

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async connect(): Promise<void> {
    if (!existsSync(this.dbPath)) mkdirSync(this.dbPath, { recursive: true });
  }

  private async withLock(table: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.locks.get(table) || Promise.resolve();
    const next = prev.then(() => fn());
    next.finally(() => { if (this.locks.get(table) === next) this.locks.delete(table); });
    this.locks.set(table, next);
    return next;
  }

  async indexDoc(doc: WikiDoc): Promise<void> {
    return this.withLock("docs", async () => {
    const table = this.tablePath("docs");
    const rows = this.readTable("docs");

    // Remove existing entry for this service
    const filtered = rows.filter(r => r.id !== doc.id);

    const row: Row = {
      id: doc.id,
      service_name: doc.serviceName,
      service_path: doc.servicePath,
      language: doc.language,
      content: doc.content,
      sections: JSON.stringify(doc.sections),
      indexed_at: doc.indexedAt,
      vector: [],
    };

    filtered.push(row);
    writeFileSync(table, JSON.stringify(filtered), "utf-8");
    });
  }

  async searchDocs(query: string): Promise<WikiDoc[]> {
    const rows = this.readTable("docs");
    const q = query.toLowerCase();

    const matches = rows.filter(r =>
      (r.service_name as string)?.toLowerCase().includes(q) ||
      (r.content as string)?.toLowerCase().includes(q)
    );

    return matches.slice(0, 10).map(r => this.rowToDoc(r));
  }

  async getDoc(serviceName: string): Promise<WikiDoc | null> {
    const rows = this.readTable("docs");
    const row = rows.find(r => r.service_name === serviceName);
    return row ? this.rowToDoc(row) : null;
  }

  async listServices(): Promise<{ name: string; path: string; size: number }[]> {
    const rows = this.readTable("docs");
    return rows.map(r => ({
      name: r.service_name as string,
      path: r.service_path as string,
      size: ((r.content as string)?.length || 0),
    }));
  }

  async deleteDoc(serviceName: string): Promise<boolean> {
    let deleted = false;
    await this.withLock("docs", async () => {
    const rows = this.readTable("docs");
    const filtered = rows.filter(r => r.service_name !== serviceName);
    if (filtered.length === rows.length) return;
    deleted = true;
    writeFileSync(this.tablePath("docs"), JSON.stringify(filtered), "utf-8");
    });
    return deleted;
  }

  async stats(): Promise<{ services: number; totalChars: number; notes: number }> {
    const docs = this.readTable("docs");
    const notes = this.readTable("notes");
    return {
      services: docs.length,
      totalChars: docs.reduce((sum, r) => sum + ((r.content as string)?.length || 0), 0),
      notes: notes.length,
    };
  }

  async addNote(note: WikiNote): Promise<void> {
    return this.withLock("notes", async () => {
    const table = this.tablePath("notes");
    const notes = this.readTable("notes");
    notes.push({
      id: note.id,
      type: note.type,
      topic: note.topic,
      content: note.content,
      context: note.context,
      tags: JSON.stringify(note.tags),
      authored_by: note.authoredBy,
      authored_at: note.authoredAt,
    });
    writeFileSync(table, JSON.stringify(notes), "utf-8");
    });
  }

  async searchNotes(query: string): Promise<WikiNote[]> {
    const rows = this.readTable("notes");
    const q = query.toLowerCase();
    const matches = rows.filter(r =>
      (r.topic as string)?.toLowerCase().includes(q) ||
      (r.content as string)?.toLowerCase().includes(q) ||
      ((r.tags as string) || "").toLowerCase().includes(q) ||
      (r.context as string)?.toLowerCase().includes(q)
    );
    return matches.slice(0, 10).map(r => ({
      id: r.id as string,
      type: (r.type as WikiNote["type"]) || "tip",
      topic: r.topic as string,
      content: r.content as string,
      context: r.context as string,
      tags: JSON.parse((r.tags as string) || "[]"),
      authoredBy: r.authored_by as string,
      authoredAt: r.authored_at as number,
    }));
  }

  async listNotes(type?: string): Promise<WikiNote[]> {
    const rows = this.readTable("notes");
    const filtered = type ? rows.filter(r => r.type === type) : rows;
    return filtered.map(r => ({
      id: r.id as string,
      type: (r.type as WikiNote["type"]) || "tip",
      topic: r.topic as string,
      content: r.content as string,
      context: r.context as string,
      tags: JSON.parse((r.tags as string) || "[]"),
      authoredBy: r.authored_by as string,
      authoredAt: r.authored_at as number,
    }));
  }

  private tablePath(name: string): string {
    return join(this.dbPath, `${name}.json`);
  }

  private readTable(name: string): Row[] {
    const p = this.tablePath(name);
    if (!existsSync(p)) return [];
    try {
      return JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      return [];
    }
  }

  private rowToDoc(r: Row): WikiDoc {
    let sections: Record<string, string> = {};
    try {
      sections = JSON.parse(r.sections as string);
    } catch { /* ignore */ }

    return {
      id: r.id as string,
      serviceName: r.service_name as string,
      servicePath: r.service_path as string,
      language: r.language as string,
      sections,
      content: r.content as string,
      indexedAt: r.indexed_at as number,
    };
  }
}

export function getClient(dbPath: string): LanceDBClient {
  let client = dbInstances.get(dbPath);
  if (!client) {
    client = new LanceDBClient(dbPath);
    dbInstances.set(dbPath, client);
  }
  return client;
}

export function resetClient(dbPath?: string): void {
  if (dbPath) dbInstances.delete(dbPath);
  else dbInstances.clear();
}

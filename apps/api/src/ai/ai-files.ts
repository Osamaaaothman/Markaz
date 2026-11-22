import type { StagedFile } from "@erp/core";
import type { PrismaClient } from "@erp/db";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

// A file the user attaches to a chat message (an invoice, a receipt). Its bytes live in the attachments file store
// (staged, not yet attached to a record); the conversation keeps only a reference. The model gets the bytes of the
// latest file only — older files become a one-line note, so a long conversation does not resend every upload.

export interface ChatFileRef extends StagedFile {
  readonly id: string;
}

interface FilePart {
  type: "file" | "image";
  source_type: "base64";
  mime_type: string;
  data: string;
  metadata: { erpFile: ChatFileRef };
}

export const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024;

function isFilePart(part: unknown): part is FilePart {
  return typeof part === "object" && part !== null && typeof (part as { metadata?: { erpFile?: unknown } }).metadata?.erpFile === "object";
}

function fileParts(m: BaseMessage): FilePart[] {
  return m.getType() === "human" && Array.isArray(m.content) ? (m.content as unknown[]).filter(isFilePart) : [];
}

function note(f: ChatFileRef): string {
  return `[Attached file ${f.id}: "${f.originalName}" (${f.contentType}, ${f.sizeBytes} bytes). To attach it to a record you create, pass sourceFileId "${f.id}".]`;
}

// The message as it is saved: the reference without the bytes.
export function humanWithFile(text: string, file: ChatFileRef, bytes?: Uint8Array): HumanMessage {
  const part: FilePart = {
    type: file.contentType === "application/pdf" ? "file" : "image",
    source_type: "base64",
    mime_type: file.contentType,
    data: bytes ? Buffer.from(bytes).toString("base64") : "",
    metadata: { erpFile: file },
  };
  return new HumanMessage({ content: [{ type: "text", text: `${text}\n\n${note(file)}` }, part] as never });
}

// What the model sees: the newest file with its bytes, older ones as a note. `read` returns null when a file
// can no longer be read; the model is then told so instead of failing the whole turn.
export async function prepareFiles(messages: readonly BaseMessage[], read: ((f: ChatFileRef) => Promise<Uint8Array | null>) | null): Promise<BaseMessage[]> {
  let latest = -1;
  messages.forEach((m, i) => { if (fileParts(m).length) latest = i; });
  if (latest < 0) return [...messages];
  const out: BaseMessage[] = [];
  for (const [i, m] of messages.entries()) {
    const parts = fileParts(m);
    if (parts.length === 0) { out.push(m); continue; }
    const content: unknown[] = [];
    for (const p of m.content as unknown[]) {
      if (!isFilePart(p)) { content.push(p); continue; }
      const bytes = i === latest && read ? await read(p.metadata.erpFile) : null;
      content.push(bytes
        ? { ...p, data: Buffer.from(bytes).toString("base64") }
        : { type: "text", text: i === latest && read ? "(The attached file could not be read.)" : "(The file above was shown earlier; its content is no longer included.)" });
    }
    out.push(new HumanMessage({ content: content as never, ...(m.id ? { id: m.id } : {}) }));
  }
  return out;
}

// Finds a file uploaded in this conversation. Only files the server itself recorded can be found, so the model
// cannot point the tool at another company's or another conversation's file.
export async function findChatFile(prisma: PrismaClient, companyId: string, conversationId: string, fileId: string): Promise<ChatFileRef | null> {
  const rows = await prisma.aiMessage.findMany({ where: { companyId, conversationId, role: "human" }, select: { payload: true } });
  for (const r of rows) {
    const content = (r.payload as { data?: { content?: unknown } }).data?.content;
    if (!Array.isArray(content)) continue;
    for (const p of content) if (isFilePart(p) && p.metadata.erpFile.id === fileId) return p.metadata.erpFile;
  }
  return null;
}

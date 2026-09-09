import type { ReqId } from "pino-http";

// pino-http's ReqId is `number | string | object` — a bare object could stringify
// as the meaningless "[object Object]", so each case is handled explicitly instead
// of a blind String(reqId).
export function reqIdToString(reqId: ReqId): string {
  if (typeof reqId === "string") {
    return reqId;
  }
  if (typeof reqId === "number") {
    return String(reqId);
  }
  return JSON.stringify(reqId);
}

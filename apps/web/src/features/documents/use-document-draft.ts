import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { newId } from "@erp/shared";
import { apiClient } from "../../shared/api/client";
import { useFeedbackStore } from "../../shared/lib/feedback-store";
import { reviveDraftPayload } from "./draft-payload";
import { useAuthStore } from "../../shared/auth/auth-store";
import { tokenPrincipal } from "../../shared/auth/token-principal";
import { queryClient } from "../../shared/api/query-client";

type DraftStatus = "loading" | "idle" | "saving" | "saved" | "error" | "conflict" | "completed";
interface DraftResponse {
  id: string;
  kind: string;
  version: number;
  payload: Record<string, unknown>;
}

export function useDocumentDraft<T extends object>(
  kind: string,
  value: T,
  restore: (value: T) => void,
  enabled = true,
) {
  const [params, setParams] = useSearchParams();
  const [id] = useState(() => params.get("draft") ?? newId());
  const initialId = useRef(params.get("draft"));
  const owner = useRef(tokenPrincipal(useAuthStore.getState().accessToken));
  const [status, setStatus] = useState<DraftStatus>(initialId.current ? "loading" : "idle");
  const ready = useRef(!initialId.current),
    version = useRef(0),
    lastSaved = useRef("");
  const latest = useRef(JSON.stringify(value)),
    restoreRef = useRef(restore),
    statusRef = useRef(status);
  const active = useRef(true),
    finished = useRef(false),
    pending = useRef<Promise<boolean> | null>(null);
  latest.current = JSON.stringify(value);
  restoreRef.current = restore;
  statusRef.current = status;
  const update = useCallback((next: DraftStatus) => {
    statusRef.current = next;
    if (active.current) setStatus(next);
  }, []);
  useEffect(() => {
    active.current = true;
    if (initialId.current) {
      let cancelled = false;
      void apiClient
        .get<DraftResponse>(`/v1/document-drafts/${id}`)
        .then(({ data }) => {
          if (cancelled) return;
          if (data.kind !== kind) {
            update("conflict");
            return;
          }
          version.current = data.version;
          lastSaved.current = JSON.stringify(data.payload);
          restoreRef.current(reviveDraftPayload<T>(data.payload));
          ready.current = true;
          update("saved");
        })
        .catch(() => {
          if (!cancelled) update("conflict");
        });
      return () => {
        cancelled = true;
        active.current = false;
      };
    }
    return () => {
      active.current = false;
    };
  }, [id, kind, update]);
  const save = useCallback(async (): Promise<boolean> => {
    if (!owner.current || owner.current !== tokenPrincipal(useAuthStore.getState().accessToken))
      return false;
    if (finished.current || !ready.current || statusRef.current === "conflict") return false;
    if (pending.current) {
      const ok = await pending.current;
      return ok ? save() : false;
    }
    if (latest.current === lastSaved.current) return true;
    const snapshot = latest.current;
    update("saving");
    pending.current = (async () => {
      try {
        const { data } = await apiClient.put<DraftResponse>(`/v1/document-drafts/${id}`, {
          kind,
          version: version.current,
          payload: JSON.parse(snapshot) as object,
        });
        version.current = data.version;
        lastSaved.current = snapshot;
        void queryClient.invalidateQueries({ queryKey: ["documentDrafts"] });
        if (active.current)
          setParams(
            (previous) => {
              const next = new URLSearchParams(previous);
              next.set("draft", id);
              return next;
            },
            { replace: true },
          );
        update("saved");
        return true;
      } catch (error) {
        // The server may have accepted a first save whose response was lost.
        // Keep the draft address recoverable when retrying discovers that version.
        if ((error as { response?: { status?: number } }).response?.status === 409 && active.current)
          setParams((previous) => {
            const next = new URLSearchParams(previous);
            next.set("draft", id);
            return next;
          }, { replace: true });
        update(
          (error as { response?: { status?: number } }).response?.status === 409
            ? "conflict"
            : "error",
        );
        return false;
      } finally {
        pending.current = null;
      }
    })();
    return pending.current;
  }, [id, kind, setParams, update]);
  const snapshot = JSON.stringify(value);
  // Clearing the last field is still an edit to an existing draft.
  const shouldSave = enabled || version.current > 0;
  const saveOnLeave = useRef(save),
    enabledRef = useRef(enabled);
  saveOnLeave.current = save;
  enabledRef.current = shouldSave;
  useEffect(
    () => () => {
      if (
        !finished.current &&
        ready.current &&
        enabledRef.current &&
        latest.current !== lastSaved.current
      ) {
        void saveOnLeave.current().then((ok) => {
          if (!ok) useFeedbackStore.getState().notify({ severity: "error", key: "drafts.error" });
        });
      }
    },
    [],
  );
  useEffect(() => {
    if (
      !shouldSave ||
      !ready.current ||
      finished.current ||
      status === "conflict" ||
      status === "error" ||
      snapshot === lastSaved.current
    )
      return;
    const timer = window.setTimeout(() => {
      void save();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [snapshot, shouldSave, save, status]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (!finished.current && shouldSave && latest.current !== lastSaved.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [shouldSave]);
  const complete = async (): Promise<void> => {
    finished.current = true;
    if (pending.current) await pending.current;
    try {
      if (version.current)
        await apiClient.delete(`/v1/document-drafts/${id}`, { data: { version: version.current } });
      void queryClient.invalidateQueries({ queryKey: ["documentDrafts"] });
      update("completed");
    } catch {
      update("error");
    }
  };
  return {
    id,
    status,
    save,
    complete,
    ready: ready.current && status !== "conflict",
    dirty: shouldSave && snapshot !== lastSaved.current,
  };
}

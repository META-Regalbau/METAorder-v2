export type CommercialDraftKind = "offer" | "order";

export type CommercialUnifiedUploadResult = {
  draft: unknown;
  draftKind: CommercialDraftKind;
  timings?: Record<string, number>;
  commercialIntent: string;
  commercialIntentConfidence: number;
  commercialIntentRationale: string | null;
  intentRoutedAsOfferDueToPermission?: boolean;
};

const VALID_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "application/vnd.ms-outlook",
  "message/rfc822",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

const VALID_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".msg",
  ".eml",
  ".txt",
  ".docx",
  ".doc",
];

export function getCommercialUploadCsrfHeaders(): Record<string, string> {
  const csrfMatch = document.cookie.match(/csrf_token=([^;]+)/);
  const csrfToken = csrfMatch ? csrfMatch[1] : null;
  const headers: Record<string, string> = {};
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  return headers;
}

export type CommercialUploadOptions = {
  subject?: string;
  body?: string;
};

/**
 * Stable Marker-Code für die UI, damit der Dialog bei diesem speziellen
 * Fehler die File-Auswahl zurücksetzen und den User um Re-Selektion bitten
 * kann (statt nur eine kryptische OS-Meldung „The I/O read operation
 * failed." anzuzeigen).
 */
export const COMMERCIAL_UPLOAD_FILE_HANDLE_STALE = "FILE_HANDLE_STALE";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * Heuristik: Hat der Fehler aus dem File-System-Read das typische
 * OneDrive-/Cloud-Sync-Muster? Dann kann die UI dem User einen
 * passenden Hinweis geben.
 */
function looksLikeCloudOnDemandError(reason: string): boolean {
  const r = reason.toLowerCase();
  return (
    r.includes("i/o read") ||
    r.includes("i/o-lese") ||
    r.includes("not found") ||
    r.includes("notfounderror") ||
    r.includes("notreadable") ||
    r.includes("nicht gefunden") ||
    r.includes("operation failed") ||
    r.includes("network error")
  );
}

/**
 * Liest das `File` defensiv in einen frischen In-Memory-Blob. Hintergrund:
 *
 *   - Safari/WebKit markiert ein `File` nach einem fehlgeschlagenen Upload
 *     intern als „stream already consumed" → zweiter Versuch scheitert mit
 *     „Request body stream exhausted". Frische Bytes lösen das.
 *   - OneDrive / iCloud Drive halten Dateien oft nur als „On-Demand"-Stub
 *     im Finder. Der Read schlägt dann mit „The I/O read operation failed."
 *     fehl. Ein erster Probe-Read über `slice(0, 1)` triggert OneDrive,
 *     die Datei real in den lokalen Cache zu laden; danach klappt der
 *     volle Read meist beim zweiten Anlauf.
 *
 *   Schlägt es trotz Retry endgültig fehl, werfen wir einen markierten
 *   Fehler, den die UI in eine handlungsanleitende Toast-Meldung übersetzt.
 */
async function cloneFileForUpload(file: File): Promise<Blob> {
  const readOnce = async (): Promise<Blob> => {
    // Probe-Read: zwingt OneDrive/iCloud, den Stub-File aus der Cloud zu materialisieren.
    await file.slice(0, 1).arrayBuffer();
    const buf = await file.arrayBuffer();
    return new Blob([buf], { type: file.type || "application/octet-stream" });
  };

  try {
    return await readOnce();
  } catch (firstErr) {
    const firstReason = firstErr instanceof Error ? firstErr.message : String(firstErr);
    if (!looksLikeCloudOnDemandError(firstReason)) {
      const stale = new Error(
        `Die ausgewählte Datei kann nicht mehr gelesen werden (${firstReason}). Bitte erneut auswählen.`
      );
      (stale as Error & { code?: string; cloud?: boolean }).code =
        COMMERCIAL_UPLOAD_FILE_HANDLE_STALE;
      throw stale;
    }

    // Cloud-Stub: kurzer Sync-Cushion und ein zweiter Anlauf.
    await sleep(800);
    try {
      return await readOnce();
    } catch (secondErr) {
      const reason = secondErr instanceof Error ? secondErr.message : String(secondErr);
      const stale = new Error(
        `Die Datei „${file.name}" liegt vermutlich noch in der Cloud (OneDrive/iCloud) und konnte ` +
          `nicht heruntergeladen werden (${reason}). ` +
          `Bitte im Finder mit Rechtsklick „Immer auf diesem Gerät behalten" wählen ` +
          `und Upload neu starten.`
      );
      const e = stale as Error & { code?: string; cloud?: boolean };
      e.code = COMMERCIAL_UPLOAD_FILE_HANDLE_STALE;
      e.cloud = true;
      throw stale;
    }
  }
}

export function isStaleFileHandleError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === COMMERCIAL_UPLOAD_FILE_HANDLE_STALE
  );
}

/**
 * Bewusst minimal: `fetch` + FormData, mit `credentials: "include"` damit das
 * Session-Cookie auch in Safari sauber mitkommt, und CSRF-Header als Object
 * an `headers` übergeben (keine eigene Header-Manipulation am Body).
 *
 * Wichtig: KEIN AbortController hier — der hatte in der letzten Iteration
 * zu „Request-Body-Stream ausgelastet"-Aborts geführt.
 */
export async function postCommercialUnifiedDraft(
  file: File,
  opts?: CommercialUploadOptions
): Promise<CommercialUnifiedUploadResult> {
  const safeBlob = await cloneFileForUpload(file);

  const formData = new FormData();
  formData.append("file", safeBlob, file.name);
  if (opts?.subject?.trim()) formData.append("subject", opts.subject.trim());
  if (opts?.body?.trim()) formData.append("body", opts.body.trim());

  const response = await fetch("/api/commercial-drafts/upload", {
    method: "POST",
    body: formData,
    credentials: "include",
    headers: getCommercialUploadCsrfHeaders(),
  });

  if (!response.ok) {
    let errorMessage = `Upload failed (${response.status})`;
    try {
      const errorBody = (await response.json()) as { error?: string };
      if (errorBody?.error) errorMessage = errorBody.error;
    } catch {
      // Body war kein JSON — Standardmeldung beibehalten.
    }
    throw new Error(errorMessage);
  }

  return (await response.json()) as CommercialUnifiedUploadResult;
}

export type CommercialDraftFileValidation = { ok: true } | { ok: false; reason: "type" | "size" };

export function validateCommercialDraftFile(file: File): CommercialDraftFileValidation {
  const fileExtension = file.name.toLowerCase().match(/\.[^.]*$/)?.[0] || "";
  if (!VALID_MIME_TYPES.includes(file.type) && !VALID_EXTENSIONS.includes(fileExtension)) {
    return { ok: false, reason: "type" };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, reason: "size" };
  }
  return { ok: true };
}

export const COMMERCIAL_DRAFT_FILE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.msg,.eml,.txt,.docx,.doc";

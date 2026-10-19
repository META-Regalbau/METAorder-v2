/**
 * Größengrenze für POST /api/commercial-drafts/upload — je Aufrufer:
 * - n8n-E-Mail-Eingang (Integrations-Schlüssel): ganze Mail als .eml, inkl. Anhänge in Base64.
 *   36 MB = Standard-Empfangsgrenze von Exchange Online (MaxReceiveSize); die gilt für die
 *   kodierte Mail, also genau das, was Graph als $value liefert.
 * - Browser-Upload: 10 MB wie bisher (prüft auch die Oberfläche vor dem Hochladen).
 * Zu groß → 413 mit Code statt eines unbehandelten MulterError (500): n8n meldet dann sofort
 * ein Problem-Ticket, statt dreimal nachzuversuchen.
 */
import multer from "multer";
import type { Request, RequestHandler } from "express";

export const EMAIL_INTAKE_MAX_UPLOAD_BYTES = 36 * 1024 * 1024;
export const MANUAL_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function isIntegrationKeyRequest(req: Request): boolean {
  return (req as { integrationKeyAuth?: boolean }).integrationKeyAuth === true;
}

/** Ein Datei-Feld, Grenze je Aufrufer; LIMIT_FILE_SIZE → 413 (multer löscht die Teildatei selbst) */
export function commercialDraftSingleUpload(
  options: Omit<multer.Options, "limits">,
  field: string,
): RequestHandler {
  const intakeUpload = multer({ ...options, limits: { fileSize: EMAIL_INTAKE_MAX_UPLOAD_BYTES } }).single(field);
  const manualUpload = multer({ ...options, limits: { fileSize: MANUAL_MAX_UPLOAD_BYTES } }).single(field);
  return (req, res, next) => {
    const intake = isIntegrationKeyRequest(req);
    (intake ? intakeUpload : manualUpload)(req, res, (err?: unknown) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        if (intake) {
          return res.status(413).json({
            error:
              "Die Mail ist größer als 36 MB und kann nicht automatisch verarbeitet werden. Bitte die Mail im Postfach öffnen und die Anhänge einzeln hochladen.",
            code: "email_intake_mail_too_large",
            maxBytes: EMAIL_INTAKE_MAX_UPLOAD_BYTES,
          });
        }
        return res.status(413).json({
          error: "Die Datei ist größer als 10 MB.",
          code: "upload_file_too_large",
          maxBytes: MANUAL_MAX_UPLOAD_BYTES,
        });
      }
      next(err as Error | undefined);
    });
  };
}

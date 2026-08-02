import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    tenantId?: string | null;
    /** Nur gesetzt von requireCpqHandoffToken — verifizierte Identität des öffentlichen Shop-Konfigurators. */
    cpqHandoff?: {
      customerId: string | null;
      salesChannelId: string | null;
      productId: string | null;
    };
  }
}

export const E2E_ENV = {
  baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000",
  username: process.env.E2E_USERNAME ?? "admin",
  password: process.env.E2E_PASSWORD ?? "admin123",
  tenantName: process.env.E2E_TENANT_NAME ?? "Dev",
};

export function requireE2EEnv(): void {
  if (!E2E_ENV.username || !E2E_ENV.password) {
    throw new Error("E2E_USERNAME/E2E_PASSWORD sind leer. Bitte Test-Credentials setzen.");
  }
}

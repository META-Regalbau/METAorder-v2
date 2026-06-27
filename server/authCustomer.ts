import jwt from "jsonwebtoken";

export type CustomerJWTPayload = {
  customerId?: string;
  email?: string;
  name?: string;
};

export type CustomerRequest = {
  customer?: CustomerJWTPayload;
};

const CUSTOMER_JWT_SECRET =
  process.env.CUSTOMER_JWT_SECRET ||
  process.env.SESSION_SECRET ||
  "dev-customer-jwt-secret-change-in-production";

const CUSTOMER_JWT_ISSUER = process.env.CUSTOMER_JWT_ISSUER;
const CUSTOMER_JWT_AUDIENCE = process.env.CUSTOMER_JWT_AUDIENCE;

export function requireCustomerAuth(req: any, res: any, next: any) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Customer not authenticated" });
    }

    const payload = jwt.verify(token, CUSTOMER_JWT_SECRET, {
      issuer: CUSTOMER_JWT_ISSUER,
      audience: CUSTOMER_JWT_AUDIENCE,
    }) as CustomerJWTPayload;

    if (!payload?.customerId && !payload?.email) {
      return res.status(401).json({ error: "Customer token missing identifier" });
    }

    req.customer = payload;
    next();
  } catch (error) {
    console.error("[requireCustomerAuth] Error:", error);
    res.status(401).json({ error: "Customer authentication failed" });
  }
}

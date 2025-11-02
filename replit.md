# METAorder

## Overview

METAorder is an internal order management system designed to streamline the processing and tracking of e-commerce orders originating from Shopware. Its primary purpose is to provide a centralized, efficient interface for employees and administrators to manage orders, update shipping information, handle document numbers, and monitor order statuses. The system aims to enhance operational efficiency through an information-dense, Material Design-inspired UI, capable of handling data-heavy workflows and supporting multi-language operations. Key capabilities include comprehensive order viewing, detailed product information display, management of cross-selling (both manual and automated), robust user and role management with granular permissions, full internationalization support, and comprehensive security features including cookie-based authentication, CSRF protection, and encryption-at-rest for API credentials.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is a **React SPA** developed with **TypeScript** and **Vite**. It employs **Tailwind CSS** with **shadcn/ui** for a Material Design-inspired interface, **Wouter** for routing, and **TanStack Query** for server state management. Form handling is facilitated by **React Hook Form** with **Zod** validation. The application supports internationalization via **i18next** (German as default, English, Spanish) and uses Euro (€) as the primary currency.

### Backend Architecture

The backend is a **REST API** built with **Node.js**, **Express.js**, and **TypeScript**. It features JWT-based authentication for session management and utilizes a storage abstraction layer (`IStorage`) that supports swappable data persistence, currently implemented with **PostgreSQL** via Drizzle ORM. The backend serves both API endpoints and the built frontend assets.

### Database Design

The system uses **PostgreSQL** with **Drizzle ORM** for schema definition and **Drizzle Kit** for migrations. The schema includes tables for Users, Roles, Settings, Cross-Selling Rules, and the complete Ticketing System (Tickets, Ticket Comments, Ticket Attachments), with JSONB fields for flexible data storage.

### Authentication & Authorization

The system implements **Role-Based Access Control (RBAC)** with granular, permission-based authorization. Authentication is **JWT-based with httpOnly cookies**, with tokens issued upon login (stored in secure, httpOnly cookies) and validated for all protected routes. The system features comprehensive security measures:
- **Cookie-Based Auth**: JWT tokens in httpOnly cookies (XSS-safe, sameSite='lax')
- **CSRF Protection**: Double-Submit Cookie Pattern with Origin/Referer validation
- **Rate Limiting**: Login endpoint limited to 5 attempts per 15 minutes (IP-based)
- **Encryption-at-Rest**: Shopware API credentials encrypted with AES-256-GCM
- **Security Headers**: X-Frame-Options, X-Content-Type-Options, CSP, Referrer-Policy
- **Session Timeout**: Configurable via SESSION_TIMEOUT env var (default: 24 hours)
- User passwords are hashed using bcryptjs.

### Design Patterns

Key architectural patterns include the **Repository Pattern** for data storage abstraction, an **API Client Pattern** for centralized request handling, **Component Composition** for UI development, and **Schema-driven validation** with Zod.

### UI/UX Decisions

The UI adheres to **Material Design principles** and **Roboto typography**, prioritizing information density. Features include pagination, sorting, sales channel filtering, multi-document support, ERP document number display, server-side product search, and responsive product cards. Cross-selling management offers CRUD operations and a rule engine for automated suggestions. The UI integrates interactive **DatePicker** components for improved date selection.

### Key Features

-   **Order Management**: View, track, and update order details, including shipping information which automatically updates Shopware. Displays dual status badges for order processing and payment status.
-   **Ticketing System**: Fully integrated ticketing system with permission-based access (viewTickets, manageTickets). Features include ticket creation (with optional order linking), status and priority management, user assignment with assignee filtering, "My Tickets" personal view for assigned tickets, internal/public comments, comprehensive filtering (status, priority, category, assignee, tags), search, pagination, email import (.msg/.eml with PDF/photo filtering), activity logging, due dates with SLA warnings, CSV/Excel export with comprehensive filtering, and automatic ticket assignment (round-robin and rule-based). Tickets can be created directly from OrderDetailModal or from email drag & drop. Auto-assignment can be configured via the Ticket Rules settings page (accessible to manageTickets users) with priority-based rule evaluation and round-robin fallback. **Note**: Email notifications require external email service setup (Resend/SendGrid integration pending - credentials: EMAIL_API_KEY, EMAIL_FROM_ADDRESS).
-   **User & Role Management**: Comprehensive CRUD operations for users and roles with permission-based access control.
-   **Order Export**: Role-based export functionality (CSV, Excel, JSON) with customizable columns, date range filtering, and sales channel restrictions.
-   **Analytics Dashboard**: Admin-only comprehensive analytics dashboard with real-time KPIs, interactive charts (Recharts), date range filtering (7/30/90 days, custom), and export functionality. Displays order/payment status distribution, product overview, category sales, best/worst sellers, and sales trends.
-   **Internationalization**: Full i18n support across the application for order statuses, filter panels, analytics, ticketing system, and general UI elements in German, English, and Spanish.

## External Dependencies

### Third-Party Services

-   **Shopware API**: Utilized for fetching e-commerce order data, product information, and updating order statuses and shipping details via OAuth 2.0 client credentials.

### Database

-   **PostgreSQL**: Configured with `@neondatabase/serverless` and **Drizzle ORM** for persistent data storage.

### UI Component Libraries

-   **shadcn/ui**: Accessible, customizable React components built on Radix UI and Tailwind CSS.
-   **Radix UI**: Primitives for accessibility and behavior.
-   **Tailwind CSS**: Utility-first CSS framework.
-   **CVA (Class Variance Authority)**: For managing component variants.

### API & Data Fetching

-   **TanStack Query**: For server state management, caching, and optimistic updates.
-   **Fetch API**: Native browser API for HTTP requests.

### Utilities

-   **date-fns**: Date manipulation.
-   **clsx + tailwind-merge**: Conditional CSS class composition.
-   **nanoid**: Unique ID generation.
-   **zod**: Runtime type validation and schema definition.
-   **i18next + react-i18next**: Internationalization.
-   **jsonwebtoken**: For JWT token generation and verification.
-   **xlsx**: Library for generating Excel (XLSX) files for data export.
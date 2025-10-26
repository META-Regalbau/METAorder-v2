# METAorder

## Overview

METAorder is an internal order management system for processing and tracking e-commerce orders from Shopware. It provides a centralized interface for employees and administrators to view orders, update shipping information, manage document numbers, and track order status. The system emphasizes efficiency and information density with a Material Design-inspired UI, optimized for data-heavy workflows and supporting multi-language operations. Its core capabilities include order viewing, detailed product information, manual and automated cross-selling management, user and role management with granular permissions, and robust internationalization features.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is a **React SPA** built with **TypeScript** and **Vite**. It utilizes **Tailwind CSS** with **shadcn/ui** for a Material Design-inspired interface, **Wouter** for routing, and **TanStack Query** for server state management. Form handling is managed by **React Hook Form** with **Zod** validation. The application supports internationalization via **i18next** (German as default, English, Spanish) and uses Euro (€) as the primary currency.

### Backend Architecture

The backend is a **REST API** powered by **Node.js** with **Express.js** and **TypeScript**. It supports session management and implements a storage abstraction layer (`IStorage`) designed for swappable data persistence (currently in-memory, with an intention for database integration). The backend serves both API endpoints and the built frontend.

### Database Design

The system is designed for **PostgreSQL** using **Drizzle ORM** for schema-first design and **Drizzle Kit** for migrations. While the schema is defined (Users, Orders, Settings), the application currently uses in-memory storage for prototyping, with plans to integrate with PostgreSQL.

### Authentication & Authorization

The system implements **Role-Based Access Control (RBAC)** with "employee" and "admin" roles and granular permissions (e.g., viewOrders, editOrders, manageUsers). Authentication is session-based, utilizing Passport.js with a local strategy for username/password and bcryptjs for password hashing.

### Design Patterns

Key patterns include the **Repository Pattern** for data storage abstraction, an **API Client Pattern** for centralized request handling, **Component Composition** for UI, and **Schema-driven validation** with Zod.

### UI/UX Decisions

The UI adheres to **Material Design principles** with **Roboto typography** and aims for information density. It includes features like pagination, sorting, sales channel filtering, multi-document support, and ERP document number display. Product management includes server-side search and responsive product cards. Cross-selling management offers comprehensive CRUD operations for groups and products, alongside a rule engine for automated suggestions.

## External Dependencies

### Third-Party Services

-   **Shopware API**: Used for e-commerce order data, configured via OAuth 2.0 client credentials flow, with a custom `ShopwareClient` for token handling and API interaction (order listing, details, product cross-selling).

### Database

-   **PostgreSQL**: Configured with `@neondatabase/serverless` and Drizzle ORM, though currently not actively used (in-memory storage in place).

### UI Component Libraries

-   **shadcn/ui**: Accessible, customizable React components built on Radix UI and Tailwind CSS.
-   **Radix UI**: Primitives for accessibility and behavior.
-   **Tailwind CSS**: Utility-first CSS framework for styling.
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
## Latest Changes - October 26, 2025 (Continued)

### User & Role Management Integration
- **Complete Backend Integration**: Extended IStorage with User and Role CRUD operations
- **Comprehensive API Routes**: Created full REST APIs for Users and Roles (GET, POST, PATCH, DELETE)
- **Permission-Based Authorization**: Revolutionary upgrade from role-based to permission-based auth
  - Created `requirePermission(permission)` factory function for fine-grained access control
  - Convenience middleware: requireManageUsers, requireManageRoles, requireManageSettings, etc.
  - deserializeUser enriches session with roleDetails (full role + permissions)
  - Fallback mechanism for legacy users without roleId (auto-upgrades on first request)
  - Custom roles with specific permissions can now access corresponding APIs

- **Frontend Integration**: UsersPage and RolesPage now use real API data via TanStack Query
  - Full CRUD functionality with mutations
  - Loading states and error handling
  - Optimistic updates and cache invalidation
  - No more mock data!

- **Seed Data Enhancement**: Creates 3 default roles first, then users properly linked via roleId
- **Security**: Password hashing, session fixation protection, permission-based access control

### PostgreSQL Database Migration - October 26, 2025
- **Complete Migration from MemStorage to PostgreSQL**: All data now persists across server restarts
- **Database Schema**:
  - `roles` table: Stores roles with JSONB permissions field
  - `users` table: Stores users with foreign key to roles table
  - `settings` table: Stores application settings (Shopware configuration) as JSONB
  - `cross_selling_rules` table: Stores cross-selling rules with JSON conditions
- **DbStorage Implementation**: Complete Drizzle ORM-based storage with SQL queries for all CRUD operations
- **Drizzle Configuration**: Uses Neon PostgreSQL with WebSocket support
- **Data Persistence Verified**: 
  - User and Role data survives server restarts
  - Shopware settings persist in database
  - Cross-selling rules stored permanently
- **Migration Process**: Used `npm run db:push` for schema synchronization (no manual SQL migrations)

### Automatic Order Status Updates - October 26, 2025
- **Shopware Integration Enhancement**: Entering shipping information now automatically updates order status in Shopware
- **Implementation**:
  - Extended `ShopwareClient` with `updateOrderShipping()` method that:
    1. Fetches order to obtain delivery ID
    2. Updates tracking codes via PATCH /api/order-delivery/{deliveryId}
    3. Transitions delivery state to "shipped" via Shopware state machine API
  - Created backend endpoint: PATCH /api/orders/:orderId/shipping (protected with requireAuth)
  - Frontend mutation in OrdersPage uses TanStack Query for shipping updates
  - Shows success toast with status confirmation message
  - Automatically invalidates orders cache to refresh UI
- **User Experience**: When shipping information is entered in OrderDetailModal, the order status is immediately updated to "shipped" in Shopware, eliminating manual status updates
- **Translations**: Added "shippingSuccessWithStatus" messages in German and English
- **Error Handling**: Proper error messages displayed via toast notifications if Shopware API calls fail

### Payment Status Display - October 26, 2025
- **Feature**: Orders table now displays payment status alongside order status with dual badges
- **Implementation**:
  - **Schema Extension**: Added `PaymentStatus` type (open, paid, partially_paid, refunded, cancelled, reminded, failed) and `paymentStatus` field to Order schema
  - **Shopware API**: Extended `fetchOrders()` to include transactions association with limit=10 and sort by createdAt DESC
  - **Payment Status Mapping**: Created `mapPaymentStatus()` with comprehensive Shopware state coverage (open, in_progress, paid, paid_partially, refunded, refunded_partially, cancelled, reminded, failed)
  - **Frontend Components**: 
    - Created `PaymentStatusBadge` component with i18n support and unique test IDs per order
    - Updated `OrdersTable` to display both badges horizontally (side-by-side)
  - **Translations**: Added paymentStatus translations in all three languages (de, en, es)
  - **Defensive Handling**: Added logging for missing transactions to detect API data issues
- **User Experience**: Each order now shows both order processing status and payment status at a glance
- **Badge Variants**: Payment status badges use different colors (paid=green, open=gray, cancelled/failed=red) for quick visual identification

### Complete i18n Implementation - October 26, 2025
- **Order Status Translation**: Updated `StatusBadge` component to use i18n instead of hardcoded English labels
- **Filter Panel Translation**: Implemented full i18n support in `OrderFilters` component
  - Filter title, status label, date labels, clear button, and active filter count all translated
  - Status dropdown options use translated labels from status.* keys
  - Fixed duplicate "filters" sections in locale JSON files that were preventing translations from loading
- **All Languages Updated**: Added filter translations to German, English, and Spanish locales
- **Verified**: End-to-end testing confirms all UI elements display correctly in German (default language)


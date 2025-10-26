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
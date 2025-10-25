# METAorder

## Overview

METAorder is an internal order management system designed for processing and tracking e-commerce orders from Shopware. The application provides a centralized interface for employees and administrators to view orders, update shipping information, manage document numbers, and track order status. It emphasizes efficiency and information density with a Material Design-inspired interface optimized for data-heavy workflows.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The application uses a **React SPA (Single Page Application)** architecture with the following design decisions:

- **UI Framework**: React with TypeScript for type safety
- **Styling**: Tailwind CSS with shadcn/ui component library for consistent Material Design-inspired UI
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query (React Query) for server state management with optimistic updates
- **Form Handling**: React Hook Form with Zod for validation
- **Design System**: Material Design principles with custom Roboto typography and information-dense layouts
- **Internationalization**: i18next and react-i18next for multi-language support (German as default, English, Spanish)
- **Currency**: Euro (€) as the primary currency for all monetary displays
- **Default Language**: German (de)

The frontend is built with Vite for fast development and optimized production builds. Components follow a strict separation between presentational components (in `components/`) and page-level components (in `pages/`).

### Backend Architecture

The backend uses a **REST API architecture** built with:

- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ESM modules
- **API Design**: RESTful endpoints under `/api/*` namespace
- **Session Management**: In-memory session storage (can be extended with connect-pg-simple for PostgreSQL sessions)
- **Data Access**: Storage abstraction layer with `IStorage` interface allowing swappable implementations (currently MemStorage, designed to support database persistence)

The backend serves both API endpoints and the built frontend in production, with Vite middleware in development for hot module replacement.

### Database Design

The application is **prepared for PostgreSQL** with Drizzle ORM:

- **ORM**: Drizzle with schema-first design
- **Schema Location**: `shared/schema.ts` for shared type definitions
- **Migration Strategy**: Drizzle Kit for schema migrations
- **Current State**: Schema defined but database not yet connected (using in-memory storage for prototyping)

Core data models:
- **Users**: Authentication and role-based access control
- **Orders**: Fetched from Shopware API, not stored locally
- **Settings**: Shopware API configuration

### Authentication & Authorization

- **Role-Based Access Control (RBAC)**: Two primary roles - "employee" and "admin"
- **Permission Model**: Granular permissions including viewOrders, editOrders, exportData, viewAnalytics, manageUsers, manageRoles, manageSettings
- **Current Implementation**: Mock authentication (hardcoded user role in App.tsx)
- **Planned Enhancement**: Proper session-based authentication with password hashing

### Design Patterns

- **Repository Pattern**: Storage abstraction (`IStorage` interface) allows switching between in-memory and database implementations
- **API Client Pattern**: Centralized API request handling in `lib/queryClient.ts`
- **Component Composition**: Atomic design with reusable UI components
- **Form Validation**: Schema-driven validation with Zod for consistent data validation across client and server

## External Dependencies

### Third-Party Services

**Shopware API Integration**
- Purpose: E-commerce platform providing order data
- Integration: REST API with OAuth 2.0 client credentials flow
- Configuration: Stored in settings (URL, API key, API secret)
- Client: Custom `ShopwareClient` class with token caching and automatic renewal
- Endpoints Used: OAuth token generation, order listing, order details

### Database

**PostgreSQL** (via Neon Database)
- Driver: `@neondatabase/serverless` for serverless PostgreSQL connections
- ORM: Drizzle ORM for type-safe database queries
- Current Status: Configured but not yet actively used (application uses in-memory storage)
- Schema Management: Drizzle Kit for migrations

### UI Component Libraries

**shadcn/ui** - Complete set of accessible, customizable React components built on:
- Radix UI primitives for accessibility and behavior
- Tailwind CSS for styling
- CVA (Class Variance Authority) for variant management

**Key Component Dependencies**:
- Form components: Labels, inputs, selects, checkboxes
- Feedback: Toasts, dialogs, alert dialogs
- Navigation: Sidebar, tabs, dropdowns
- Data display: Tables, cards, badges

### Development Tools

**Replit Integrations**:
- `@replit/vite-plugin-runtime-error-modal` - Development error overlay
- `@replit/vite-plugin-cartographer` - Development tooling
- `@replit/vite-plugin-dev-banner` - Development environment banner

### API & Data Fetching

- **TanStack Query**: Server state management with caching, refetching, and optimistic updates
- **Fetch API**: Native browser fetch for HTTP requests

### Utilities

- **date-fns**: Date formatting and manipulation
- **clsx + tailwind-merge**: Conditional className composition
- **nanoid**: Unique ID generation
- **zod**: Runtime type validation and schema definition
- **i18next + react-i18next**: Internationalization library for multi-language support

## Recent Changes

### October 25, 2025
- **Pagination & Sorting**: Implemented proper pagination with page controls (First, Previous, Next, Last) and configurable items per page (10, 25, 50, 100). Orders are now sorted by date with newest orders displayed first.
- **Currency**: Changed all currency displays from USD ($) to EUR (€) throughout the application.
- **Multi-language Support**: Added internationalization support with i18next. Available languages:
  - German (de) - Deutsch (Default)
  - English (en)
  - Spanish (es) - Español
  - Language switcher component added to the top navigation bar
  - All UI text, navigation items, and messages are now translatable
  - User language preference stored in localStorage
- **Sales Channel Filtering**: Implemented role-based sales channel filtering for orders:
  - Admin users can see and filter orders from all sales channels
  - Employee users are restricted to their assigned sales channels (e.g., Austria, Poland, Germany)
  - New SalesChannelSelector component allows filtering orders by one or more sales channels
  - Backend API fetches sales channels from Shopware and filters orders by channel ID
  - Schema updated to include salesChannelId on orders and salesChannelIds array on users
  - Fully translated UI for sales channel filtering in German, English, and Spanish
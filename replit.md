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
  - Production sales channel IDs configured for Austria, Poland, and Germany
- **User Management with Sales Channel Assignment**: Enhanced user management to allow sales channel assignment directly in the UI:
  - New SalesChannelMultiSelect component for selecting multiple sales channels
  - AddUserDialog and EditUserDialog now include sales channel selection
  - UsersPage displays assigned sales channels for each user in the table
  - Users with no assigned channels have access to all channels (Admin only)
  - Full multi-language support for all user management UI elements
  - Mock data includes example users with different sales channel assignments
- **Role Management with Sales Channel Assignment**: Extended role management to support sales channel assignment at the role level:
  - Role schema updated to include optional salesChannelIds field
  - AddRoleDialog and EditRoleDialog now include SalesChannelMultiSelect component
  - RolesPage displays assigned sales channels for each role in the table with visual badges
  - Roles with no assigned channels have access to all channels (displayed as "All Channels")
  - Translation keys added for role sales channel features in German, English, and Spanish
  - Mock data updated with example roles having different sales channel assignments (e.g., Warehouse Manager assigned to Austria and Poland)
- **Multi-Document Support with Download Functionality**: Implemented comprehensive document management for orders:
  - Backend fetches all document types (invoices, delivery notes, credit notes, cancellations) from Shopware API
  - Documents displayed in OrderDetailModal with individual download buttons
  - Download functionality uses Shopware's deepLinkCode for secure PDF downloads
  - Documents extracted from `doc.attributes.deepLinkCode` and `doc.attributes.documentNumber`
  - Document types automatically detected from technicalName or number prefixes (RE-, LS-, GS-, ST-)
  - Localized error handling with user-friendly messages (no raw backend errors)
  - Loading, empty, and error states properly handled
  - All UI elements fully translated in German, English, and Spanish
- **ERP Document Numbers from Custom Fields**: Display ERP-generated document numbers in order details:
  - Custom fields extracted from Shopware orders: `custom_order_numbers_order`, `custom_order_numbers_deliveryNo`, `custom_order_numbers_invoice`
  - Mapped to `erpNumber`, `deliveryNoteNumber`, and `invoiceNumber` fields in Order schema
  - New "ERP-Dokumentennummern" card in OrderDetailModal displays all three numbers
  - Numbers displayed in monospace font for better readability
  - Shows "-" when numbers are not available
  - Fully translated in German, English, and Spanish
- **Product Management with Server-Side Search**: Implemented comprehensive product browsing and search functionality:
  - New Product schema with fields for CPQ implementation: price tiers, variants, categories, stock, custom fields
  - Backend `fetchProducts` method in ShopwareClient with pagination and Shopware API search integration
  - API endpoint `/api/products` with query parameters for pagination (page, limit) and search
  - ProductsPage with responsive grid view displaying product cards with images, names, numbers, prices
  - Server-side search using Shopware's term search - searches across all pages, not just current page
  - Debounced search input (300ms) to prevent excessive API calls
  - Search automatically resets pagination to page 1
  - Pagination controls for navigating through products
  - Product availability badges and graduated pricing indicators
  - Full multi-language support in German, English, and Spanish
  - Products accessible to both employee and admin roles via sidebar navigation
- **Cross-Selling Management (Manual)**: Implemented comprehensive manual cross-selling functionality:
  - **Schema Extensions**: Added CrossSellingGroup, CrossSellingProduct, and CrossSellingRule types in shared/schema.ts
  - **Backend API Integration**: 
    - ShopwareClient methods: fetchProductCrossSelling, createProductCrossSelling, assignProductsToCrossSelling, removeProductsFromCrossSelling, deleteProductCrossSelling
    - Fixed header preservation in makeAuthenticatedRequest to ensure JSON content-type persists during authentication
    - Robust response parsing handling both `data.id` and `data.data.id` formats from Shopware
  - **API Routes with Validation**:
    - GET `/api/products/:productId/cross-selling` - Fetch cross-selling groups with products
    - POST `/api/products/:productId/cross-selling` - Create new group with Zod validation
    - PUT `/api/products/:productId/cross-selling/:crossSellingId` - Update product assignments with Zod validation
    - DELETE `/api/products/:productId/cross-selling/:crossSellingId` - Delete group
  - **Frontend Components**:
    - ProductDetailModal: Displays product details, dimensions, and cross-selling groups with "Manage Cross-Selling" button
    - CrossSellingManager: Full CRUD interface for managing cross-selling groups and product assignments
    - Product selection dialog with search functionality and visual product cards
  - **User Workflow**: Users can view product details → see linked cross-selling products → create new groups → add/remove products → delete groups
  - Full multi-language support in German, English, and Spanish
  - **Status**: Manual cross-selling management fully functional (architect-reviewed)
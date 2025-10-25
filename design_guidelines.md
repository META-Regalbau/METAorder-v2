# METAorder Design Guidelines

## Design Approach

**Selected Approach**: Design System - Material Design with Enterprise Data Focus

**Justification**: METAorder is a utility-focused, information-dense productivity tool for internal order management. Material Design's robust data table patterns, clear information hierarchy, and enterprise-ready components align perfectly with the need for efficient data processing and role-based workflows.

**Key Design Principles**:
- Efficiency First: Minimize clicks, maximize information density
- Scannable Data: Quick visual parsing of order information
- Action-Oriented: Clear pathways for shipping updates and document uploads
- Performance Transparency: Visible loading states and progress indicators

---

## Core Design Elements

### A. Typography

**Font Family**: 
- Primary: Roboto (via Google Fonts CDN)
- Monospace: Roboto Mono (for order numbers, IDs, timestamps)

**Hierarchy**:
- Page Headers: font-size 2xl (24px), font-weight 600
- Section Headers: font-size xl (20px), font-weight 500
- Data Labels: font-size sm (14px), font-weight 500, uppercase tracking-wide
- Body Text: font-size base (16px), font-weight 400
- Table Data: font-size sm (14px), font-weight 400
- Metadata/Timestamps: font-size xs (12px), font-weight 400
- Monospace Data (IDs, Numbers): Roboto Mono, font-size sm

### B. Layout System

**Spacing Primitives**: Use Tailwind units of 2, 4, 6, 8, 12, 16
- Component padding: p-4, p-6
- Section spacing: mb-6, mb-8
- Grid gaps: gap-4, gap-6
- Card spacing: p-6
- Form fields: space-y-4
- Button padding: px-4 py-2, px-6 py-3

**Container Strategy**:
- App shell: Full width with max-w-screen-2xl centered
- Sidebar (if used): Fixed w-64
- Main content: flex-1 with p-6 to p-8
- Cards: Contained with shadow-sm and rounded-lg borders

---

## Component Library

### Navigation & Shell

**Top Bar**:
- Height: h-16
- Contains: Logo, global search, user profile/role indicator, notifications
- Fixed positioning with shadow-sm
- Role badge clearly visible (Employee/Admin distinction)

**Sidebar** (Optional):
- Width: w-64
- Navigation items with icon + text
- Active state with subtle background treatment
- Sections: Orders, Reports, Settings (admin only)

### Core UI Elements

**Data Tables**:
- Striped rows for readability (alternate row subtle background)
- Fixed header on scroll
- Column headers: Sortable with arrow indicators, font-weight 500
- Row height: Comfortable spacing (py-3)
- Hover state on rows
- Checkbox selection for bulk actions (left column)
- Action column (right): Icon buttons for quick actions
- Sticky first column for order numbers when horizontal scrolling

**Key Table Columns**:
- Order Number (monospace, bold)
- Customer Name
- Order Date (with time)
- Status Badge
- Total Amount (right-aligned)
- Quick Actions (icons)

**Status Badges**:
- Pill-shaped with rounded-full
- Consistent sizing: px-3 py-1
- Font: text-xs font-medium uppercase tracking-wide
- States: Pending, Processing, Shipped, Completed, Cancelled

**Cards**:
- Background with subtle border
- Padding: p-6
- Shadow: shadow-sm
- Rounded: rounded-lg
- Order detail view uses cards for different sections (Customer Info, Items, Shipping, Documents)

### Forms & Inputs

**Input Fields**:
- Height: h-10 for text inputs
- Padding: px-3
- Border: border with focus ring
- Rounded: rounded-md
- Labels: Above input, font-weight 500, mb-2
- Required indicator: Asterisk or "(required)" text
- Helper text: text-sm below input

**Buttons**:
- Primary Action: px-6 py-2.5, rounded-md, font-medium
- Secondary Action: Outlined variant with border
- Icon Buttons: p-2, rounded-md (for table actions)
- Sizes: Small (py-1.5 px-3), Medium (py-2 px-4), Large (py-3 px-6)

**File Upload** (Admin):
- Dropzone area with dashed border
- Icon + text: "Drop files here or click to upload"
- File list with remove option
- Upload progress bar

### Search & Filters

**Global Search**:
- Prominent position in top bar
- Width: w-96
- Placeholder: "Search orders, customers..."
- Icon: Search magnifying glass (left side)
- Debounced input for performance

**Filter Panel**:
- Collapsible section or sidebar overlay
- Filter groups: Date Range, Status, Customer, Amount Range
- Date picker component
- Multi-select for statuses
- Clear all filters button
- Active filter count badge

### Data Display

**Order Detail Tabs**:
- Tab navigation: border-b with active underline indicator
- Tabs: Overview, Items, Shipping Info, Documents, Activity Log
- Content area: pt-6

**Loading States**:
- Skeleton loaders for table rows (matching table structure)
- Spinner for full-page loads
- Progress bar for file uploads
- Shimmer effect on skeleton components

**Pagination**:
- Bottom of table
- Items per page selector: 25, 50, 100, 200
- Page numbers with ellipsis for large datasets
- Previous/Next buttons
- "Showing X-Y of Z results" text

**Empty States**:
- Centered content with icon
- Helpful message
- Suggested action (e.g., "Clear filters" or "Create first order")

### Bulk Actions

**Action Bar** (appears when rows selected):
- Fixed to top of table or floating above it
- Shows: "X orders selected"
- Bulk actions: Update shipping status, Export selected, Clear selection
- Background with shadow for prominence

### Role-Based Components

**Employee View**:
- Read-only order details
- Shipping information form (editable)
- Export button

**Admin View** (Additional):
- Invoice number input
- Delivery note number input
- ERP number input
- Document upload sections
- Advanced export options with column selection

### Overlays & Modals

**Modal Dialogs**:
- Max width: max-w-2xl for forms, max-w-4xl for order details
- Backdrop: Semi-transparent overlay
- Header: Title with close button (top-right)
- Footer: Action buttons (right-aligned)
- Content: p-6

**Toast Notifications**:
- Position: top-right, fixed
- Auto-dismiss after 5 seconds (with progress indicator)
- Types: Success, Error, Warning, Info
- Close button included

---

## Animations

**Minimal Motion Approach**:
- Fade-in for modal/overlay appearance (duration-200)
- Subtle slide-down for dropdowns (duration-150)
- Loading spinner rotation
- Progress bar fill animation
- No decorative animations - performance-focused interface

**Transitions**:
- Page transitions: None (instant load with skeleton states)
- Hover states: No animation, immediate state change
- Focus states: Immediate ring appearance

---

## Performance Considerations in Design

**Visual Performance Indicators**:
- Skeleton screens match actual data layout
- Progressive loading: Header → Filters → Table
- Lazy load table rows (virtual scrolling for 500+ orders)
- "Loading more..." indicator at table bottom
- Refresh button with loading state
- Last updated timestamp visible

**Responsive Behavior**:
- Desktop-first (primary use case)
- Tablet: Horizontal scroll for tables, maintained functionality
- Mobile: Stacked cards instead of tables, simplified filters
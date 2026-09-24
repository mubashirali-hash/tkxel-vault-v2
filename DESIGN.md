---
version: alpha
name: tkxel Blue Horizon
description: A bold, high-contrast B2B tech system with expansive blue gradients, oversized typography, and crisp white call-to-action moments.
colors:
  primary: "#0755E9"
  primary-dark: "#10347E"
  secondary: "#1B232E"
  tertiary: "#A98CFF"
  neutral: "#FFFFFF"
  surface: "#F4F7FF"
  on-surface: "#1B232E"
  border: "#374151"
  accent-soft: "#D9E8FF"
  gradient-glow: "#6FA3FF"
  error: "#D92D20"
typography:
  headline-display:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "100px"
    fontWeight: 800
    lineHeight: "109.824px"
    letterSpacing: "-5px"
  headline-lg:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "70px"
    fontWeight: 800
    lineHeight: "84px"
    letterSpacing: "0px"
  headline-md:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "49px"
    fontWeight: 800
    lineHeight: "59px"
    letterSpacing: "0px"
  headline-sm:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: "41px"
    letterSpacing: "0px"
  body-lg:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: "36px"
    letterSpacing: "0px"
  body-md:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: "28px"
    letterSpacing: "0px"
  body-sm:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
    letterSpacing: "0px"
  label-lg:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: "28px"
    letterSpacing: "0px"
  label-md:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "24px"
    letterSpacing: "0px"
  label-sm:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
    letterSpacing: "0.12em"
  nav-md:
    fontFamily: "Plus Jakarta Sans"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: "24px"
    letterSpacing: "0px"
rounded:
  none: "0px"
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "18px"
  full: "9999px"
spacing:
  xs: "6px"
  sm: "16px"
  md: "24px"
  lg: "40px"
  xl: "52px"
  gutter: "96px"
components:
  button-primary:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.secondary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.none}"
    padding: "18px 22px"
    height: "54px"
  button-secondary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.none}"
    padding: "18px 22px"
    height: "54px"
  button-tertiary:
    backgroundColor: "transparent"
    textColor: "{colors.neutral}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.none}"
    padding: "0px"
    height: "auto"
  card:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.neutral}"
    rounded: "{rounded.md}"
    padding: "16px"
  input:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.none}"
    padding: "16px"
  chip:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
    padding: "10px 16px"
---

# tkxel Blue Horizon

## Overview
This system feels bold, modern, and enterprise-focused, with a strong AI-forward confidence rather than a playful consumer tone. The visual language is spacious and dramatic: huge headlines, generous blue fields, and minimal chrome keep attention on messaging. It is built for a professional audience that expects clarity, polish, and technical credibility.

## Colors
- **Primary (#0755E9):** A vivid electric blue used for energetic accents, active UI states, and the strongest brand moments.
- **Primary Dark (#10347E):** A deeper navy-blue base that anchors the hero background and larger panels with a more substantial, trustworthy feel.
- **Secondary (#1B232E):** A near-ink neutral used for contrast on white buttons and for dark text treatment when the background allows it.
- **Neutral (#FFFFFF):** Pure white used for headlines, body copy, and button surfaces to maximize contrast against the saturated blue background.
- **Tertiary (#A98CFF):** A soft lavender accent that introduces a lighter AI-inspired highlight without breaking the blue-first palette.
- **Surface (#F4F7FF):** A pale cool surface tone suitable for secondary panels or inset areas when a lighter background is needed.
- **Border (#374151):** A muted slate border color used for subtle separation on cards and outlined elements.
- **Accent Soft (#D9E8FF):** A light sky tint that supports hover fills, glows, and soft emphasis treatments.
- **Gradient Glow (#6FA3FF):** A luminous mid-blue used conceptually for atmospheric highlights and radial light effects.
- **Error (#D92D20):** Reserved for validation and destructive states; it should stay visually separate from the core brand blues.

## Typography
The system uses **Plus Jakarta Sans** across all major text styles, which gives it a clean, contemporary, slightly geometric voice. Headings are heavy and compressed by tight tracking, especially the display headline, which uses 800 weight and very large sizes for strong first-impression impact. Body text is still confident and fairly large, supporting a premium B2B feel rather than a dense editorial one.

Use `headline-display`, `headline-lg`, and `headline-md` for hero and section-level messaging. `headline-sm` works for supporting headlines and content cards. `body-lg` and `body-md` handle marketing copy and navigation labels, while `body-sm` is best for smaller utility text. `label-sm` includes the clearest uppercase-style rhythm through added letter spacing and should be used sparingly for kicker labels, metadata, and section tags. Overall, the typography avoids decorative treatment; clarity comes from scale, weight, and spacing.

## Layout
The composition is intentionally spacious, with a large hero area and strong left-aligned content blocks. The layout behaves like a wide desktop marketing page rather than a tight centered app shell, with generous whitespace and clear vertical separation between navigation, hero, and service tags. Spacing follows a simple rhythm based on 6px, 16px, 24px, 40px, and 52px increments, with larger gaps used to preserve the sense of openness.

Use broad section padding and avoid cramped multi-column stacks unless the content is highly structured. Cards and chip groups should breathe, with even internal padding and clear gutters between items. The system favors a fluid, expansive container over a rigid, compact grid.

## Elevation & Depth
The interface is mostly flat, relying on color contrast and subtle borders rather than shadows to create hierarchy. The hero background uses tonal variation and glowing light effects to create depth, while cards stay restrained with a thin border and minimal visual noise. Shadows are essentially absent, so layer separation should come from hue shifts, spacing, and edge definition instead of elevation.

## Shapes
The overall shape language is sharp and disciplined. Most primary actions use zero radius, which reinforces the crisp, architectural tone of the brand. Secondary containers may use a small 8px radius for quiet softness, but the system should generally feel squared-off rather than rounded or friendly.

## Components
**Buttons:**  
- `button-primary` is the high-emphasis CTA: white background, dark text, square corners, and ample horizontal padding. It should feel substantial and clear rather than pill-shaped or decorative.
- `button-secondary` is the inverse CTA: solid brand blue with white text, used when the action needs to stay visually integrated with the hero background.
- `button-tertiary` is link-like and minimal, with transparent background and no padding structure beyond the text itself.
- Buttons should maintain a consistent 54px height and use 18px text for strong legibility.
- Hover states should preserve the sharp geometry; use color shifts or subtle emphasis, not added shadow or rounding.

**Cards:**  
- Cards should use the dark navy background, white text, a 1px border, and a restrained 8px radius where needed.
- Keep padding around 16px unless the card is content-heavy and needs a broader internal rhythm.
- Cards should feel like bounded information surfaces, not floating containers.

**Inputs:**  
- Inputs should be clean, flat, and high-contrast, typically with a white background, dark text, and square corners.
- Use generous inner padding so fields feel touch-friendly and aligned with the spacious marketing layout.
- Focus states should rely on border or color change rather than shadow.

**Chips / Tags:**  
- Chips should be compact, rounded-full elements with concise labels and strong contrast.
- Use them for service categories, feature tags, and lightweight navigation cues.
- The chip treatment can vary from solid blue to pastel accents, but should remain small and easily scannable.

**Navigation and utility links:**  
- Top navigation should stay lightweight, white, and unobtrusive.
- Keep icons small and text spacing moderate so the header reads as premium and uncluttered.
- Use `label-md` or `nav-md` sizing for nav items; avoid oversized or overly bold treatments.

## Do's and Don'ts
- Do use oversized headings and generous whitespace to maintain the premium, campaign-like feel.
- Do keep primary CTAs square and highly legible.
- Do rely on contrast and spacing for hierarchy instead of shadow-heavy depth.
- Do use Plus Jakarta Sans consistently for a unified, modern voice.
- Don't introduce soft, bubbly, or heavily rounded shapes.
- Don't crowd the hero with too many competing colors or dense UI controls.
- Don't use decorative type treatments, serif pairings, or handwritten accents.
- Don't add strong shadows unless they are absolutely necessary; the system should stay mostly flat.

---

# Application-Specific Design System Patterns (tkxel Vault Admin Web App)

While the marketing brand tokens above define high-level corporate brand identity, the **tkxel Vault Admin Web Application** requires calibrated desktop density, responsive viewport adaptation, and security-segregated interaction patterns.

## 1. Application Architecture & Responsive Viewport Tiers

The web application adapts smoothly across three standard viewport ranges:

### Wide Desktop Tier (≥ 1280px)
- **Root Density:** Root HTML font size set to `14px` for optimal desktop information density matching Linear, Obsidian, and Notion.
- **Top Application Header:** Fixed `46px` height with crisp bottom border (`var(--border-subtle)`), hosting the brand mark, vault selector, primary view tabs, ActionMenu ("Workspace actions"), and user account popover.
- **Navigation Sidebar:** Persistent `240px` left sidebar for document tree, filter search, and quick creation triggers.
- **Editor Stage:** Centered reading column layout (`max-width: 860px`) with outer full-width scrollbar aligned to the far-right viewport edge.
- **Canvas Views:** Edge-to-edge hardware-accelerated canvas with floating or docked toolbars.

### Compact Desktop & Tablet Tier (900px – 1279px)
- **Sidebar Rail:** Collapsible navigation rail toggled via `PanelLeftOpen` / `PanelLeftClose` icon button in the header.
- **Slide-Over Drawers:** Note Inspector and AI Co-Pilot mount as slide-over overlay drawers (`360px` – `420px`) rather than competing for primary horizontal canvas space.
- **Action Menu:** All secondary actions collapse into the header `ActionMenu` overflow trigger.

### Mobile Tier (< 900px)
- **Header:** Simplified header bar showing brand logo, vault selector badge, and account menu.
- **Slide-Out Drawer:** Navigation sidebar transforms into a full-height slide-out drawer with semi-transparent backdrop and strict keyboard focus containment.
- **Fixed Bottom Navigation (`app-mobile-nav`):** Fixed bottom thumb-bar hosting:
  - Open Vaults: `Notes` (`FileText`), `Graph` (`Network`), `Activity` (`History`), and `Browse` (`Menu`).
  - Locked Vaults: `Skills` (`Lock`), `Activity` (`History`), and `Browse` (`Menu`).
- **Touch Targets:** All interactive buttons and touch targets maintain a minimum dimension of `44×44px`.

---

## 2. Component System Primitives & Hierarchy

The application employs a consistent component library (`components/ui/`) with strict visual hierarchy:

### Button Variants & Hierarchy
- **`primary` (`btn btn-primary-blue`):** Solid Electric Blue (`#0755E9`) surface with white text. Reserved for primary affirmative actions (`Publish`, `New note`, `Create protected skill`).
- **`secondary` (`btn btn-secondary-white`):** Crisp white background with subtle border (`1px solid var(--border-subtle)` / `#E2E8F0`) and dark text. Used for secondary workflows (`Save Draft`, `AI Co-Pilot`, filters).
- **`quiet` (`IconButton variant="quiet"`):** Borderless, transparent background with subtle hover fill (`#F1F5F9`). Used for toolbar utilities, zoom controls, and icon buttons.
- **`destructive` (`danger`):** Red accent (`#D92D20`) with hover highlight. Reserved exclusively for irreversible operations (`Delete note`, `Delete skill`, `Revoke access`).

### Standard Control Heights
- **Compact Actions:** `30px` – `32px` (Editor action bar, graph toolbar chips, table row actions).
- **Standard Controls:** `36px` (Form fields, dialog buttons, sidebar inputs).
- **Prominent Triggers:** `40px` – `44px` (Modal confirmation buttons, mobile bottom nav items).

### Shared Primitives
- **`IconButton`:** Accessible button wrapping Lucide SVG icons with mandatory `label` / `aria-label`, tooltip support, and keyboard focus states.
- **`Badge`:** Compact metadata indicators with semantic status colors: `default` (slate), `success` (green), `attention` (amber), and `locked` (burnt orange).
- **`EmptyState`:** Reusable empty-state card with centered icon, bold headline, supportive description, and primary CTA trigger.
- **`Modal` & `Dialog`:** Centered accessible modal overlays with focus trapping, backdrop click dismissal, `Escape` key listeners, and focus restoration to the triggering element.
- **`Drawer`:** Slide-over right or left panel with smooth slide-in CSS transitions and keyboard focus trapping.
- **`ActionMenu`:** Dropdown menu popover providing accessible grouped actions with separators and danger styling.

---

## 3. Navigation & Action Hierarchy

To eliminate visual clutter and prevent horizontal application overflow:
- **Global Header Bar (`AppShell.tsx`):** Exclusively hosts global workspace navigation. Primary view tabs are limited to:
  - Open Vaults: `Notes`, `Graph`, `Activity & Audit`.
  - Locked Vaults: `Skills`, `Activity & Audit` (the `Graph` tab is strictly unmounted).
- **Workspace Actions Menu (`ActionMenu`):** Consolidates all vault-level administrative tools into a single predictable overflow dropdown:
  - `Import notes` (Open Vault Owner/Editor)
  - `Share and access` (Owner only)
  - `Integrations` (MCP connection instructions)
  - `Export vault` (Open Vault Owner only; permanently disabled on Locked Vaults)

---

## 4. Note Authoring & Inspector Patterns

The editing experience uses **TipTap WYSIWYG** with pure inline rendering and front-matter synchronization:

### Editor Typography Scale
- **Document Title:** `1.65rem`, font weight 800, borderless input with dynamic auto-resize.
- **Heading 1 (H1):** `1.45rem`, font weight 700, margin-top `1.2rem`, margin-bottom `0.4rem`.
- **Heading 2 (H2):** `1.20rem`, font weight 700, margin-top `1.0rem`, margin-bottom `0.3rem`.
- **Heading 3 (H3):** `1.05rem`, font weight 600, margin-top `0.8rem`, margin-bottom `0.2rem`.
- **Body Text:** `0.95rem`, line height `1.6`, color `var(--text-primary)`.

### Authoring Controls & Inspector Rail
- **Save State Pill:** Displays real-time status: `"Draft saved"` (green), `"Unsaved draft"` (amber), or `"Offline — changes stay here"`.
- **Note Summary Pill:** Metadata badge strip (`[Category] · [N tags] · [N aliases] · [N backlinks]`) acting as the toggle trigger for the Note Inspector.
- **Caret-Anchored `WikiLinkPicker`:** Dynamically positioned at the text caret when typing `[[`, eliminating offscreen popovers in long documents.
- **Line-Level Syntax Diffing (`DiffViewer.tsx`):** Unified / side-by-side view with green (`+`) and red (`-`) line-by-line syntax diff highlighting and a 1-click `"Revert to published"` action.

---

## 5. Knowledge Graph Visualization Patterns

The 2D Knowledge Graph is rendered via HTML5 Canvas + Cytoscape / D3 force simulation:

### Color Palette for Note Types
- **Decision:** Forest Green (`#059669`)
- **Meeting:** Deep Violet (`#7C3AED`)
- **Project:** Electric Cobalt (`#0755E9`)
- **Client:** Warm Amber (`#D97706`)
- **Person:** Vibrant Berry (`#DB2777`)
- **Note (Default):** Cyan Slate (`#0891B2`)

### Interaction Patterns
- **Scope Segmentation:** Segmented button control in toolbar toggling between `"Local neighborhood"` (2-hop subgraph from active note) and `"Entire vault"`.
- **Freehand Drag & Physics Relaxation:** Clicking and dragging nodes unpins positions with smooth velocity damping.
- **Shift+Drag Linking:** Holding `Shift` and dragging between nodes draws an elastic rubber-band link edge, appending `[[Target Note]]` to markdown upon release.
- **Right-Click Context Menu:** Spawns targeted quick actions (`Link to another note...`, `Open in Editor`, `Copy [[wikilink]]`).

---

## 6. Zero-Read Locked Vault UI Patterns (Invariant 1 Enforcement)

In accordance with tkxel Vault Security Invariant 1:
- **Color Accent:** Primary UI accents shift from Electric Blue (`#0755E9`) to Burnt Orange (`#EA580C`).
- **Navigation Segregation:** The `Graph` tab is completely unmounted. The `Notes` tab is replaced by the dedicated **Protected Skills Catalog**.
- **Security Disclosures:** An informational banner explains zero-read execution, detailing that content is encrypted at rest via AES-256-GCM and decrypted only in ephemeral in-memory sandboxes.
- **Telemetry Indicators:** Three live status cards display:
  - `MCP GATEWAY STATUS`: Streamable HTTP Active (Anthropic 2025-11-25).
  - `ENCRYPTION INVARIANT`: AES-256-GCM Sealed (Zero Raw Disk Exfiltration).
  - `ISOLATION ENGINE`: In-Memory Sandbox (120s Timeout Enforced).
- **Export Prohibition Notice:** The export modal displays an unbypassable security alert permanently prohibiting export of locked vaults.

---

## 7. Accessibility, Focus & Motion Standards

The application adheres strictly to **WCAG 2.2 Level AA**:
- **Focus Ring Token:** High-contrast Electric Blue focus indicator (`outline: 2px solid #0755E9; outline-offset: 2px;`).
- **Focus Containment & Restoration:** All modal dialogs and navigation drawers trap keyboard focus within the dialog and return focus to the trigger upon dismissal.
- **Reduced Motion:** All transitions and force simulations observe `@media (prefers-reduced-motion: reduce)`, disabling non-essential camera pans and physics animations.
- **Screen Reader Landmarks:** Full semantic HTML landmarks (`<header>`, `<nav>`, `<main>`, `<aside>`) with explicit `aria-label`, `aria-expanded`, and `aria-live` attributes.


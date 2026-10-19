/**
 * Design tokens (theme.docx) mirrored as TypeScript for programmatic use.
 * Keep in sync with tailwind.config.ts.
 */
export const theme = {
  colors: {
    background: "#F5F5F7",
    surface: "#FFFFFF",
    pageBg: "#FBFBFD",
    hoverBg: "#F2F2F7",
    primary: "#0071E3",
    primaryHover: "#005BB5",
    primaryLight: "#EAF3FF",
    success: "#34C759",
    successBg: "#E8F8EE",
    successText: "#248A3D",
    warning: "#FF9F0A",
    warningBg: "#FFF4E5",
    warningText: "#C76B00",
    error: "#FF3B30",
    errorBg: "#FDECEC",
    errorText: "#D70015",
    text: "#1D1D1F",
    textNormal: "#424245",
    textSecondary: "#6E6E73",
    textDisabled: "#A1A1A6",
    border: "#D2D2D7",
    divider: "#E5E5EA",
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  radius: { button: 10, card: 16, badge: 999 },
  shadow: { card: "0 8px 24px rgba(0,0,0,0.06)" },
  layout: { sidebarWidth: 260, topNavHeight: 64, tableRowHeight: 56 },
  typography: {
    dashboardTitle: { size: 32, weight: 700, tracking: "-0.02em", color: "#1D1D1F" },
    pageHeading: { size: 24, weight: 600, tracking: "-0.01em", color: "#1D1D1F" },
    sectionTitle: { size: 18, weight: 600, color: "#1D1D1F" },
    cardTitle: { size: 16, weight: 600, color: "#1D1D1F" },
    body: { size: 14, weight: 400, color: "#424245" },
    secondary: { size: 13, weight: 400, color: "#6E6E73" },
  },
} as const;

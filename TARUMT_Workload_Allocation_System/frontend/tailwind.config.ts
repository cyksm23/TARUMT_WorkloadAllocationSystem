import type { Config } from "tailwindcss";

/**
 * TARUMT Teaching Workload System - design tokens (theme.docx).
 * Apple + Linear + Modern SaaS aesthetic.
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        background: "#F5F5F7", // soft gray page bg
        surface: "#FFFFFF", // cards
        pageBg: "#FBFBFD",
        hoverBg: "#F2F2F7",

        primary: "#0071E3",
        primaryHover: "#005BB5",
        primaryActive: "#004A99",
        primaryLight: "#EAF3FF", // active sidebar bg

        success: "#34C759",
        successBg: "#E8F8EE",
        successText: "#248A3D",
        successHover: "#248A3D",

        warning: "#FF9F0A",
        warningBg: "#FFF4E5",
        warningText: "#C76B00",
        warningHover: "#D97E00",

        error: "#FF3B30",
        errorBg: "#FDECEC",
        errorText: "#D70015",
        errorHover: "#D70015",

        text: "#1D1D1F",
        textNormal: "#424245",
        textSecondary: "#6E6E73",
        textPlaceholder: "#A1A1A6",
        textDisabled: "#C7C7CC",

        border: "#D2D2D7",
        divider: "#E5E5EA",
      },
      fontFamily: {
        sans: ["Inter", "Helvetica Neue", "Arial", "sans-serif"],
      },
      spacing: {
        xs: "4px",
        sm: "8px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        xxl: "48px",
      },
      borderRadius: {
        button: "10px",
        input: "10px",
        card: "16px",
        modal: "20px",
        badge: "999px",
      },
      boxShadow: {
        card: "0 8px 24px rgba(0, 0, 0, 0.06)", // Card Design (theme.docx §4)
        dashboard: "0 8px 24px rgba(0, 0, 0, 0.08)", // Dashboard Card Style (theme.docx §7)
      },
    },
  },
  plugins: [],
};

export default config;

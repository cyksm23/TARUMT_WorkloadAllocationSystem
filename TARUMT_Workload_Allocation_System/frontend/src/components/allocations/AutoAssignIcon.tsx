/** Auto Assign by Mohamed Riyaz Ali / Noun Project, CC BY 3.0.
 * See public/icons/README.md. The PNG's alpha mask follows the text colour:
 * white on primary buttons, primary blue on the dialog heading.
 */
export default function AutoAssignIcon({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: "currentColor",
        maskImage: "url('/icons/auto-assign-white.png')",
        WebkitMaskImage: "url('/icons/auto-assign-white.png')",
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskPosition: "center",
        WebkitMaskPosition: "center",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
      }}
    />
  );
}

/** The BackdropAds mark: a lowercase "b" standing on a studio backdrop sweep, on the volt-lime tile. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label="BackdropAds">
      <rect width="512" height="512" rx="116" fill="#BEFF3D" />
      <g fill="none" stroke="#08070F" strokeLinecap="round" strokeLinejoin="round">
        <path d="M158 106V312Q158 406 252 406H356" strokeWidth="58" />
        <circle cx="270" cy="267" r="83" strokeWidth="54" />
      </g>
    </svg>
  );
}

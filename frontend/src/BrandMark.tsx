import { useId } from 'react';

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 40, className = '' }: BrandMarkProps) {
  const uid = useId().replace(/:/g, '');
  const gradientId = `brand-gradient-${uid}`;
  const glowId = `brand-glow-${uid}`;

  return (
    <svg
      className={`brand-mark-art ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="7" y1="5" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1595FF" />
          <stop offset="0.48" stopColor="#1768F2" />
          <stop offset="1" stopColor="#4F46E5" />
        </linearGradient>
        <radialGradient id={glowId} cx="0" cy="0" r="1" gradientTransform="translate(14 10) rotate(48) scale(39)">
          <stop stopColor="white" stopOpacity="0.3" />
          <stop offset="0.72" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="1" y="1" width="46" height="46" rx="14" fill={`url(#${gradientId})`} />
      <rect x="1" y="1" width="46" height="46" rx="14" fill={`url(#${glowId})`} />
      <path d="M9.8 29.5C12.1 38.2 22.1 42.2 30.8 38.5C39.4 34.9 42.4 24.5 37.5 16" stroke="white" strokeOpacity="0.14" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M15 18.5L22.2 22.4M33 16.5L25.8 22.3M33.5 32.5L26 25.7M15.5 34L22.1 25.9" stroke="white" strokeOpacity="0.74" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="14.5" cy="18.2" r="2.7" fill="white" />
      <circle cx="33.4" cy="16.1" r="2.45" fill="#BCE8FF" />
      <circle cx="34" cy="33" r="2.8" fill="white" />
      <circle cx="15.1" cy="34.2" r="2.25" fill="#BCE8FF" />
      <path d="M24 17.6L25.85 22.15L30.4 24L25.85 25.85L24 30.4L22.15 25.85L17.6 24L22.15 22.15L24 17.6Z" fill="white" />
      <circle cx="24" cy="24" r="1.7" fill="#1768F2" />
      <rect x="1.6" y="1.6" width="44.8" height="44.8" rx="13.4" stroke="white" strokeOpacity="0.16" strokeWidth="1.2" />
    </svg>
  );
}

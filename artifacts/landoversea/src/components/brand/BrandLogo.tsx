import { useId } from 'react';

interface BrandLogoProps {
  className?: string;
  monochrome?: boolean;
}

export default function BrandLogo({
  className = '',
  monochrome = false,
}: BrandLogoProps) {
  const gradientId = `brand-gradient-${useId().replace(/:/g, '')}`;
  const clipId = `brand-globe-${useId().replace(/:/g, '')}`;
  const foreground = monochrome ? '#ffffff' : '#f8fafc';

  return (
    <svg
      viewBox="0 0 400 94"
      className={className}
      role="img"
      aria-label="LandOverSEA"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={monochrome ? '#ffffff' : '#ec4899'} />
          <stop offset="100%" stopColor={monochrome ? '#ffffff' : '#22d3ee'} />
        </linearGradient>
        <clipPath id={clipId}>
          <circle cx="50" cy="47" r="33" />
        </clipPath>
      </defs>

      <circle
        cx="50"
        cy="47"
        r="33"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="3"
        opacity="0.9"
      />
      <g clipPath={`url(#${clipId})`} fill="none" stroke={monochrome ? '#ffffff' : '#22d3ee'} strokeWidth="1.5" opacity="0.65">
        <path d="M17 47h66M50 14c-12 10-18 21-18 33s6 23 18 33M50 14c12 10 18 21 18 33s-6 23-18 33M20 34h60M20 60h60" />
      </g>
      <path
        d="M34 43c0-8 11-10 16-3 5-7 16-5 16 3 0 10-16 20-16 20S34 53 34 43Z"
        fill={monochrome ? '#ffffff' : '#ec4899'}
        opacity="0.95"
      />
      <path
        d="M12 63c18 10 38 13 59 4 7-3 12-7 17-12"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="88" cy="55" r="3" fill={monochrome ? '#ffffff' : '#22d3ee'} />

      <text x="105" y="62" fontFamily="Georgia, 'Times New Roman', serif" fontSize="43" fontWeight="700" letterSpacing="-1">
        <tspan fill={monochrome ? '#ffffff' : '#ec4899'}>Land</tspan>
        <tspan fill={monochrome ? '#ffffff' : '#22d3ee'}>Over</tspan>
        <tspan fill={foreground}>SEA</tspan>
      </text>
    </svg>
  );
}
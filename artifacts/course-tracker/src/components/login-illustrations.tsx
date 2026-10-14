/**
 * Flat, decorative SVG artwork for the four sign-in screens. Each is a plain
 * inline SVG (no external assets, no new libraries) sized to fill the pale
 * circle drawn by `.auth-art` in src/index.css. They are purely decorative and
 * are always rendered inside an `aria-hidden` wrapper.
 */
import { useState, type ComponentType, type ReactNode } from 'react';
import { Box, Building2 } from 'lucide-react';
import moduleDefault from '../assets/module-default.png';
import branchDefault from '../assets/branch-default.png';

export type LoginIllustrationProps = {
  /** Names of the modules to draw — only the module desk illustration uses this. */
  moduleNames?: string[];
  /** Index within `moduleNames` of the module this login belongs to. */
  currentIndex?: number;
};

function Gear({ cx, cy, r, fill }: { cx: number; cy: number; r: number; fill: string }) {
  const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <g>
      {teeth.map((deg) => (
        <rect
          key={deg}
          x={cx - r * 0.17}
          y={cy - r * 1.3}
          width={r * 0.34}
          height={r * 0.55}
          rx={r * 0.12}
          fill={fill}
          transform={`rotate(${deg} ${cx} ${cy})`}
        />
      ))}
      <circle cx={cx} cy={cy} r={r} fill={fill} />
      <circle cx={cx} cy={cy} r={r * 0.4} fill="#FFFFFF" />
    </g>
  );
}

export function StudentIllustration(_props: LoginIllustrationProps) {
  return (
    <svg viewBox="0 0 300 300" role="presentation" focusable="false">
      {/* pencil cup */}
      <rect x="200" y="185" width="50" height="60" rx="9" fill="#2E8B6F" />
      <rect x="211" y="156" width="8" height="38" rx="3" fill="#F4C430" />
      <rect x="224" y="148" width="8" height="46" rx="3" fill="#E4572E" />
      <rect x="237" y="158" width="8" height="36" rx="3" fill="#1B5E4B" />
      {/* stack of books */}
      <rect x="45" y="214" width="150" height="26" rx="6" fill="#1B5E4B" />
      <rect x="58" y="188" width="124" height="26" rx="6" fill="#2E8B6F" />
      <rect x="71" y="162" width="98" height="26" rx="6" fill="#6FC3A0" />
      {/* graduation cap */}
      <rect x="100" y="140" width="72" height="24" rx="4" fill="#0F3D31" />
      <polygon points="132,100 200,130 132,160 64,130" fill="#1B5E4B" />
      <path d="M200 130 q10 12 6 34" stroke="#F4C430" strokeWidth="5" fill="none" strokeLinecap="round" />
      <circle cx="206" cy="168" r="6" fill="#F4C430" />
    </svg>
  );
}

export function AdminIllustration(_props: LoginIllustrationProps) {
  return (
    <svg viewBox="0 0 300 300" role="presentation" focusable="false">
      {/* laptop screen with a user profile */}
      <rect x="50" y="92" width="150" height="104" rx="10" fill="#FFFFFF" stroke="#14508F" strokeWidth="5" />
      <circle cx="100" cy="136" r="18" fill="#CFE0F7" />
      <path d="M74 180 q26 -30 52 0" fill="#CFE0F7" />
      <rect x="132" y="124" width="54" height="9" rx="4.5" fill="#9CC1EC" />
      <rect x="132" y="142" width="42" height="9" rx="4.5" fill="#C9DCF3" />
      <rect x="132" y="160" width="48" height="9" rx="4.5" fill="#C9DCF3" />
      {/* laptop base */}
      <polygon points="38,196 212,196 228,210 22,210" fill="#14508F" />
      {/* small bar-chart card */}
      <rect x="200" y="152" width="76" height="64" rx="10" fill="#FFFFFF" stroke="#C9DCF3" strokeWidth="3" />
      <rect x="212" y="188" width="10" height="16" rx="2" fill="#14508F" />
      <rect x="228" y="176" width="10" height="28" rx="2" fill="#4C86C6" />
      <rect x="244" y="166" width="10" height="38" rx="2" fill="#8FB8E8" />
      {/* gear */}
      <Gear cx={232} cy={96} r={22} fill="#14508F" />
    </svg>
  );
}

export function BranchIllustration(_props: LoginIllustrationProps) {
  return (
    <svg viewBox="0 0 300 300" role="presentation" focusable="false">
      {/* location pin */}
      <path d="M150 50 a30 30 0 0 1 30 30 c0 24 -30 52 -30 52 s-30 -28 -30 -52 a30 30 0 0 1 30 -30 z" fill="#A15C16" />
      <circle cx="150" cy="80" r="11" fill="#FDF8EF" />
      {/* roof */}
      <polygon points="150,116 66,152 234,152" fill="#A15C16" />
      {/* building */}
      <rect x="82" y="150" width="136" height="100" rx="8" fill="#F6E3C4" stroke="#A15C16" strokeWidth="4" />
      {/* door */}
      <rect x="136" y="208" width="28" height="42" rx="4" fill="#A15C16" />
      {/* windows */}
      <rect x="96" y="166" width="26" height="24" rx="3" fill="#FFFFFF" />
      <rect x="178" y="166" width="26" height="24" rx="3" fill="#FFFFFF" />
      <rect x="96" y="200" width="26" height="24" rx="3" fill="#FFFFFF" />
      <rect x="178" y="200" width="26" height="24" rx="3" fill="#FFFFFF" />
    </svg>
  );
}

const LAYER_COLORS = ['#8E6FCB', '#B79DE0'];

export function ModuleIllustration({ moduleNames = [], currentIndex = 0 }: LoginIllustrationProps) {
  const shown = (moduleNames.length ? moduleNames : ['Module']).slice(0, 3);
  const layerH = 44;
  const gap = 10;
  const totalH = shown.length * layerH + (shown.length - 1) * gap;
  const startY = 150 - totalH / 2;
  let otherIndex = 0;
  return (
    <svg viewBox="0 0 300 300" role="presentation" focusable="false">
      {shown.map((name, i) => {
        const y = startY + i * (layerH + gap);
        const fill = i === currentIndex ? '#4C2488' : LAYER_COLORS[otherIndex++ % LAYER_COLORS.length];
        const label = name.length > 15 ? `${name.slice(0, 14)}…` : name;
        return (
          <g key={`${name}-${i}`}>
            <rect x="46" y={y} width="180" height={layerH} rx="12" fill={fill} />
            <text x="136" y={y + layerH / 2 + 5} textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="15" fontWeight="600" fill="#FFFFFF">
              {label}
            </text>
          </g>
        );
      })}
      <Gear cx={246} cy={82} r={24} fill="#4C2488" />
    </svg>
  );
}

/**
 * Renders a supplied default PNG for the art area. The picture is placed inside
 * the same `.auth-art` circle the Student screen uses (`.auth-art-module` /
 * `.auth-art-branch` in index.css decide the fitting and any clipping). If the
 * image fails to load we swap in a lucide icon so the art area is never empty.
 */
function DefaultArtImage({ src, fallback }: { src: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return <img src={src} alt="" className="auth-art-img" onError={() => setFailed(true)} />;
}

/** Module desk art — the shared purple default image, for every module. */
export function ModuleDefaultArt(_props: LoginIllustrationProps) {
  return (
    <DefaultArtImage
      src={moduleDefault}
      fallback={<Box size={120} strokeWidth={1.5} style={{ width: 120, height: 120 }} />}
    />
  );
}

/** Branch login art — the shared amber default image, for every branch. */
export function BranchDefaultArt(_props: LoginIllustrationProps) {
  return (
    <DefaultArtImage
      src={branchDefault}
      fallback={<Building2 size={120} strokeWidth={1.5} style={{ width: 120, height: 120 }} />}
    />
  );
}

export const ILLUSTRATIONS: Record<string, ComponentType<LoginIllustrationProps>> = {
  student: StudentIllustration,
  admin: AdminIllustration,
  branch: BranchDefaultArt,
  module: ModuleDefaultArt,
};

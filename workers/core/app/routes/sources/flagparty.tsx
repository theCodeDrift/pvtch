import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { Route } from './+types/flagparty';
import { useNoTheme } from '@/hooks/use-no-theme';
import {
  layoutFlags,
  parseStyle,
  parseTheme,
  splitMessage,
  type FlagStyle,
  type PlacedFlag,
} from '@/lib/flagparty';

const FONT_FAMILY =
  "'Baloo 2', 'Arial Rounded MT Bold', 'Segoe UI Black', 'Helvetica Neue', Arial, sans-serif";

const ANIMATIONS = `
@keyframes fp-drop {
  from { opacity: 0; transform: translateY(-40px) rotate(-12deg); }
  to { opacity: 1; transform: none; }
}
@keyframes fp-sway {
  0%, 100% { transform: rotate(-2.5deg); }
  50% { transform: rotate(2.5deg); }
}
.fp-drop { animation: fp-drop 700ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.fp-sway { animation: fp-sway 3.4s ease-in-out infinite; }
`;

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Flag Party - PVTCH' }];
}

/** One flag drawn with its attachment point at (0, 0), hanging down. */
function FlagShape({
  flag,
  style,
  width,
  height,
}: {
  flag: PlacedFlag;
  style: FlagStyle;
  width: number;
  height: number;
}) {
  const half = width / 2;
  const fontSize = width * 0.56;
  const letter = (cy: number) => (
    <text
      x={0}
      y={cy}
      textAnchor="middle"
      dominantBaseline="central"
      fill={flag.text}
      fontSize={fontSize}
      fontWeight={800}
      fontFamily={FONT_FAMILY}
    >
      {flag.char}
    </text>
  );

  if (style === 'circle') {
    const radius = half;
    const cy = height - radius;
    return (
      <>
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={cy - radius + 2}
          stroke={flag.accent}
          strokeWidth={Math.max(2, width * 0.04)}
          strokeLinecap="round"
        />
        <circle
          cx={0}
          cy={0}
          r={Math.max(3, width * 0.06)}
          fill={flag.accent}
        />
        <circle cx={0} cy={cy} r={radius} fill={flag.fill} />
        {letter(cy)}
      </>
    );
  }

  if (style === 'duo') {
    const band = height * 0.14;
    const notch = height * 0.76;
    return (
      <>
        <polygon
          points={`${-half},0 ${half},0 ${half},${height} 0,${notch} ${-half},${height}`}
          fill={flag.fill}
        />
        <rect x={-half} y={0} width={width} height={band} fill={flag.accent} />
        {letter(band + (notch - band) * 0.55)}
      </>
    );
  }

  const shoulder = height * 0.62;
  return (
    <>
      <polygon
        points={`${-half},0 ${half},0 ${half},${shoulder} 0,${height} ${-half},${shoulder}`}
        fill={flag.fill}
      />
      {letter(height * 0.38)}
    </>
  );
}

/**
 * Flag Party OBS source: `/flagparty?theme=birthday&message=Happy+Birthday`.
 * Stateless; everything comes from the query string.
 */
export default function FlagPartySource() {
  useNoTheme();
  const [params] = useSearchParams();
  const message = params.get('message') ?? '';
  const theme = parseTheme(params.get('theme'));
  const style = parseStyle(params.get('style'));

  const layout = useMemo(
    () => layoutFlags(splitMessage(message), theme, style),
    [message, theme, style]
  );

  if (layout.flags.length === 0) {
    return;
  }

  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width="100%"
      role="img"
      aria-label={message}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <style>{ANIMATIONS}</style>
      <defs>
        <filter id="fp-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow
            dx={0}
            dy={4}
            stdDeviation={4}
            floodColor="#000"
            floodOpacity={0.35}
          />
        </filter>
      </defs>
      {layout.ropes.map((rope) => (
        <path
          key={rope.d}
          d={rope.d}
          fill="none"
          stroke={layout.rope}
          strokeWidth={5}
          strokeLinecap="round"
          filter="url(#fp-shadow)"
        />
      ))}
      {layout.flags.map((flag) => (
        <g
          key={flag.key}
          transform={`translate(${flag.x} ${flag.y}) rotate(${style === 'circle' ? 0 : flag.angle})`}
        >
          <g
            className="fp-drop"
            style={{ animationDelay: `${flag.order * 70}ms` }}
          >
            <g
              className="fp-sway"
              style={{ animationDelay: `${flag.order * -0.53}s` }}
              filter="url(#fp-shadow)"
            >
              <FlagShape
                flag={flag}
                style={style}
                width={layout.flagWidth}
                height={layout.flagHeight}
              />
            </g>
          </g>
        </g>
      ))}
    </svg>
  );
}

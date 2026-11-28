import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { Route } from './+types/flagbanner';
import { useNoTheme } from '@/hooks/use-no-theme';
import {
  layoutFlags,
  parseFont,
  parseStyle,
  parseTheme,
  SPAN_START,
  splitMessage,
  type FlagFont,
  type FlagLayout,
  type FlagStyle,
  type PlacedFlag,
} from '@/lib/flagbanner';

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
  return [{ title: 'Flag Banner - PVTCH' }];
}

type ShapeProps = {
  flag: PlacedFlag;
  style: FlagStyle;
  width: number;
  layout: FlagLayout;
  font: FlagFont;
};

/**
 * One flag drawn with its cord tied to the string at (0, 0), hanging
 * straight down.
 */
function FlagShape({ flag, style, width, layout, font }: ShapeProps) {
  const half = width / 2;
  const cord = layout.cordLength;
  const height = layout.flagHeight;
  const letter = (cy: number) => (
    <text
      x={0}
      y={cy}
      textAnchor="middle"
      dominantBaseline="central"
      fill={layout.text}
      fontSize={width * 0.56}
      fontWeight={font.weight}
      fontFamily={font.family}
    >
      {flag.char}
    </text>
  );

  let body: ReactNode;
  if (style === 'circle') {
    const cy = cord + half;
    body = (
      <>
        <circle cx={0} cy={cy} r={half} fill={flag.fill} />
        {letter(cy)}
      </>
    );
  } else if (style === 'duo') {
    const band = cord + (height - cord) * 0.14;
    const notch = cord + (height - cord) * 0.76;
    body = (
      <>
        <polygon
          points={`${-half},${cord} ${half},${cord} ${half},${height} 0,${notch} ${-half},${height}`}
          fill={flag.fill}
        />
        <rect
          x={-half}
          y={cord}
          width={width}
          height={band - cord}
          fill={flag.accent}
        />
        {letter(band + (notch - band) * 0.55)}
      </>
    );
  } else {
    const shoulder = cord + (height - cord) * 0.62;
    body = (
      <>
        <polygon
          points={`${-half},${cord} ${half},${cord} ${half},${shoulder} 0,${height} ${-half},${shoulder}`}
          fill={flag.fill}
        />
        {letter(cord + (height - cord) * 0.38)}
      </>
    );
  }

  return (
    <>
      <line
        x1={0}
        y1={0}
        x2={0}
        y2={cord + 2}
        stroke={layout.rope}
        strokeWidth={Math.max(2, width * 0.035)}
        strokeLinecap="round"
      />
      <circle cx={0} cy={0} r={Math.max(3, width * 0.045)} fill={layout.rope} />
      {body}
    </>
  );
}

/**
 * Flag Banner OBS source: `/sources/flagbanner?theme=birthday&message=Happy+Birthday`.
 * Stateless; everything comes from the query string.
 */
export default function FlagBannerSource() {
  useNoTheme();
  const [params] = useSearchParams();
  const message = params.get('message') ?? '';
  const theme = parseTheme(params.get('theme'));
  const style = parseStyle(params.get('style'));
  const font = parseFont(params.get('font'), params.get('weight'));

  const layout = useMemo(
    () => layoutFlags(splitMessage(message), theme, style),
    [message, theme, style]
  );

  if (layout.flags.length === 0) {
    return;
  }

  return (
    <>
      {/* Outside the <svg>, where a <link> would be inert. No `precedence`:
          React would block on it, and a weight Google refuses would throw. */}
      {font.hrefs.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
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
          {/* the string fades out toward both edges, so a source narrower
              than the stream doesn't end in a hard cut; it is fully opaque
              by the first place a flag can hang */}
          <linearGradient
            id="fp-rope"
            gradientUnits="userSpaceOnUse"
            x1={0}
            y1={0}
            x2={layout.width}
            y2={0}
          >
            <stop offset={0} stopColor={layout.rope} stopOpacity={0} />
            <stop offset={SPAN_START} stopColor={layout.rope} />
            <stop offset={1 - SPAN_START} stopColor={layout.rope} />
            <stop offset={1} stopColor={layout.rope} stopOpacity={0} />
          </linearGradient>
        </defs>
        {layout.ropes.map((rope) => (
          <path
            key={rope.d}
            d={rope.d}
            fill="none"
            stroke="url(#fp-rope)"
            strokeWidth={5}
            strokeLinecap="round"
            filter="url(#fp-shadow)"
          />
        ))}
        {layout.flags.map((flag) => (
          <g key={flag.key} transform={`translate(${flag.x} ${flag.y})`}>
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
                  layout={layout}
                  font={font}
                />
              </g>
            </g>
          </g>
        ))}
      </svg>
    </>
  );
}

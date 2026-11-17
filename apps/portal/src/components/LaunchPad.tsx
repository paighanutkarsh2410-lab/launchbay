import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

const orbits = [
  { r: 150, duration: 26, dots: [0, 140] },
  { r: 205, duration: 38, dots: [60, 230] },
  { r: 260, duration: 54, dots: [300] },
];

/** The hero illustration: a rocket over a perspective launch grid, circled by orbiting services. */
export function LaunchPad() {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const lift = useTransform(scrollY, [0, 400], [0, -60]);

  return (
    <div aria-hidden className="relative mx-auto aspect-square w-full max-w-[540px]">
      {/* Perspective grid floor */}
      <div className="absolute inset-x-[-20%] bottom-[2%] h-[46%] [perspective:500px]">
        <div
          className="absolute inset-0 origin-bottom [transform:rotateX(62deg)]"
          style={{
            backgroundImage:
              "linear-gradient(rgb(124 92 255 / 0.35) 1px, transparent 1px), linear-gradient(90deg, rgb(124 92 255 / 0.35) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse 60% 70% at 50% 100%, #000 20%, transparent 70%)",
          }}
        >
          {!reduce && (
            <motion.div
              className="absolute inset-0"
              style={{
                backgroundImage: "linear-gradient(rgb(34 211 238 / 0.5) 2px, transparent 2px)",
                backgroundSize: "100% 44px",
              }}
              animate={{ backgroundPositionY: ["0px", "44px"] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
            />
          )}
        </div>
      </div>

      {/* Orbits */}
      <svg viewBox="-300 -300 600 600" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id="core-glow">
            <stop offset="0" stopColor="#7c5cff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#7c5cff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle r="190" fill="url(#core-glow)" />
        {orbits.map((orbit, i) => (
          <g key={i}>
            <circle
              r={orbit.r}
              fill="none"
              stroke="rgb(165 148 255 / 0.22)"
              strokeWidth="1.2"
              strokeDasharray="3 9"
              className="animate-dash"
            />
            <motion.g
              animate={reduce ? undefined : { rotate: i % 2 ? -360 : 360 }}
              transition={{ duration: orbit.duration, repeat: Infinity, ease: "linear" }}
            >
              {orbit.dots.map((deg) => {
                const a = (deg * Math.PI) / 180;
                const color = ["#22d3ee", "#34d399", "#ff7a45"][i];
                return (
                  <g key={deg} transform={`translate(${Math.cos(a) * orbit.r} ${Math.sin(a) * orbit.r})`}>
                    <circle r="14" fill={color} opacity="0.14" />
                    <circle r="5" fill={color} />
                  </g>
                );
              })}
            </motion.g>
          </g>
        ))}
      </svg>

      {/* Rocket */}
      <motion.div className="absolute inset-0 flex items-center justify-center" style={{ y: lift }}>
        <motion.div
          animate={reduce ? undefined : { y: [0, -14, 0], rotate: [0, 1.5, -1, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          className="relative"
        >
          <svg width="150" height="230" viewBox="0 0 150 230">
            <defs>
              <linearGradient id="hull" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="0.55" stopColor="#c9c3ff" />
                <stop offset="1" stopColor="#7c5cff" />
              </linearGradient>
              <linearGradient id="fin" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#22d3ee" />
                <stop offset="1" stopColor="#7c5cff" />
              </linearGradient>
              <radialGradient id="flame" cx="0.5" cy="0" r="1">
                <stop offset="0" stopColor="#fff7d6" />
                <stop offset="0.35" stopColor="#ffb547" />
                <stop offset="1" stopColor="#ff7a45" stopOpacity="0" />
              </radialGradient>
            </defs>
            <motion.ellipse
              cx="75"
              cy="196"
              rx="20"
              ry="34"
              initial={{ ry: 34 }}
              fill="url(#flame)"
              animate={reduce ? undefined : { ry: [30, 40, 28, 38, 30], opacity: [0.9, 1, 0.85, 1, 0.9] }}
              transition={{ duration: 0.5, repeat: Infinity, ease: "easeInOut" }}
            />
            <path d="M44 120 L22 168 L50 156 Z" fill="url(#fin)" />
            <path d="M106 120 L128 168 L100 156 Z" fill="url(#fin)" />
            <path d="M75 8 C104 30 112 70 108 120 L100 168 H50 L42 120 C38 70 46 30 75 8 Z" fill="url(#hull)" />
            <path d="M75 8 C90 20 98 36 102 56 H48 C52 36 60 20 75 8 Z" fill="#7c5cff" opacity="0.9" />
            <circle cx="75" cy="92" r="16" fill="#10131f" />
            <circle cx="75" cy="92" r="11" fill="#22d3ee" opacity="0.85" />
            <circle cx="70" cy="87" r="4" fill="#fff" opacity="0.7" />
            <rect x="60" y="164" width="30" height="10" rx="3" fill="#2c3249" />
          </svg>
        </motion.div>
      </motion.div>
    </div>
  );
}

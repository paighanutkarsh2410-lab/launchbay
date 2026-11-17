import { Box, Globe, Hexagon, Zap, type LucideIcon } from "lucide-react";

const icons: Record<string, LucideIcon> = {
  "python-fastapi": Zap,
  "node-express": Hexagon,
  "static-site": Globe,
};

export function TemplateIcon({ id, accent, size = 44 }: { id: string; accent: string; size?: number }) {
  const Icon = icons[id] ?? Box;
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-2xl"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(145deg, color-mix(in oklab, ${accent} 30%, transparent), color-mix(in oklab, ${accent} 6%, transparent))`,
        boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.12), 0 8px 24px -10px ${accent}`,
      }}
    >
      <Icon size={size * 0.45} color={accent} strokeWidth={2} />
    </span>
  );
}

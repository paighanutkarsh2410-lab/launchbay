import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Boxes, CornerDownLeft, LayoutDashboard, Rocket } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { StatusDot } from "./StatusDot";

const itemClass =
  "flex h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm text-muted data-[selected=true]:bg-white/[0.07] data-[selected=true]:text-fg";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: services = [] } = useQuery({ queryKey: ["services"], queryFn: api.services, enabled: open });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function go(path: string) {
    onClose();
    navigate(path);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="panel relative w-full max-w-xl overflow-hidden shadow-2xl shadow-black/60"
          >
            <Command label="Command palette" loop>
              <Command.Input
                autoFocus
                placeholder="Type a command or search…"
                className="h-14 w-full border-b border-white/[0.07] bg-transparent px-5 text-[15px] text-fg outline-none placeholder:text-faint"
              />
              <Command.List className="max-h-80 overflow-y-auto p-2">
                <Command.Empty className="px-3 py-8 text-center text-sm text-faint">Nothing matches.</Command.Empty>
                <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-faint">
                  <Command.Item className={itemClass} onSelect={() => go("/launch")}>
                    <Rocket size={16} className="text-ember" /> Launch a new service
                    <CornerDownLeft size={14} className="ml-auto opacity-50" />
                  </Command.Item>
                  <Command.Item className={itemClass} onSelect={() => go("/")}>
                    <LayoutDashboard size={16} /> Mission control
                  </Command.Item>
                  <Command.Item className={itemClass} onSelect={() => go("/services")}>
                    <Boxes size={16} /> Service catalog
                  </Command.Item>
                </Command.Group>
                {services.length > 0 && (
                  <Command.Group heading="Services" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-faint">
                    {services.map((service) => (
                      <Command.Item
                        key={service.id}
                        value={`${service.name} ${service.owner}`}
                        className={itemClass}
                        onSelect={() => go(`/services/${service.name}`)}
                      >
                        <StatusDot status={service.status} />
                        <span className="font-mono text-[13px]">{service.name}</span>
                        <span className="ml-auto text-xs text-faint">{service.owner}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

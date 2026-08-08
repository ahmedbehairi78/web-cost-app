/**
 * Odoo 17 CE motion tokens — Framer Motion variants matching the CSS keyframes.
 * Sources: odoo/web/static/src/scss/animation.scss
 */

export const ERP_EASE_OUT    = [0.22, 0.84, 0.42, 1] as const;
export const ERP_EASE_SPRING = [0.34, 1.08, 0.38, 1] as const;
export const ERP_EASE_IN_OUT = [0.45, 0.02, 0.42, 1] as const;

export const ERP_MOTION = {
  duration:      0.26,
  durationFast:  0.15,
  durationSlow:  0.42,
  easeOut:       ERP_EASE_OUT,
  easeSpring:    ERP_EASE_SPRING,
  easeInOut:     ERP_EASE_IN_OUT,
} as const;

// ── Dropdown (nav menu / user menu) ───────────────────────────────────────────
export const erpDropdownMotion = {
  initial:    { opacity: 0, y: -8, scaleY: 0.96 },
  animate:    { opacity: 1, y:  0, scaleY: 1    },
  exit:       { opacity: 0, y: -4, scaleY: 0.97 },
  transition: { duration: ERP_MOTION.durationFast, ease: ERP_EASE_OUT },
} as const;

// ── Modal / dialog ────────────────────────────────────────────────────────────
export const erpModalMotion = {
  initial:    { opacity: 0, scale: 0.96, y: 10 },
  animate:    { opacity: 1, scale: 1,    y:  0 },
  exit:       { opacity: 0, scale: 0.98, y:  5 },
  transition: { duration: ERP_MOTION.duration, ease: ERP_EASE_OUT },
} as const;

// ── Window (ERP workspace panel) ─────────────────────────────────────────────
export const erpWindowMotion = {
  initial:    { opacity: 0, scale: 0.968, y: 12 },
  animate:    { opacity: 1, scale: 1,     y:  0 },
  exit:       { opacity: 0, scale: 0.98,  y:  6 },
  transition: { duration: ERP_MOTION.duration, ease: ERP_EASE_OUT },
} as const;

// ── View / page content enter ─────────────────────────────────────────────────
export const erpPageMotion = {
  initial:    { opacity: 0, x: 20 },
  animate:    { opacity: 1, x:  0 },
  exit:       { opacity: 0, x: -20 },
  transition: { duration: 0.22, ease: ERP_EASE_OUT },
} as const;

// ── Card / panel enter ────────────────────────────────────────────────────────
export const erpCardMotion = {
  initial:    { opacity: 0, y: 8 },
  animate:    { opacity: 1, y: 0 },
  exit:       { opacity: 0, y: 4 },
  transition: { duration: ERP_MOTION.duration, ease: ERP_EASE_OUT },
} as const;

// ── Stat / KPI card — with optional delay index ───────────────────────────────
export function erpStatCardMotion(index = 0) {
  return {
    initial:    { opacity: 0, y: 8 },
    animate:    { opacity: 1, y: 0 },
    transition: { duration: 0.30, ease: ERP_EASE_OUT, delay: index * 0.05 },
  };
}

// ── Toast notification ────────────────────────────────────────────────────────
export const erpToastMotion = {
  initial:    { opacity: 0, x: 60 },
  animate:    { opacity: 1, x:  0 },
  exit:       { opacity: 0, x: 60 },
  transition: { duration: ERP_MOTION.duration, ease: ERP_EASE_OUT },
} as const;

// ── Notification badge pop ────────────────────────────────────────────────────
export const erpBadgeMotion = {
  initial:    { opacity: 0, scale: 0.5 },
  animate:    { opacity: 1, scale: 1   },
  transition: { duration: 0.32, ease: ERP_EASE_SPRING },
} as const;

// ── Sidebar collapse/expand ───────────────────────────────────────────────────
export const erpSidebarMotion = {
  initial:    { opacity: 0, x: -16 },
  animate:    { opacity: 1, x:   0 },
  exit:       { opacity: 0, x: -16 },
  transition: { duration: ERP_MOTION.durationFast, ease: ERP_EASE_OUT },
} as const;

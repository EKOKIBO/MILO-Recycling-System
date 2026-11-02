import {
  Star, Medal, Trophy, Sparkles, Flame, Recycle, Zap, Award, Leaf
} from 'lucide-react';

// Illustrative per-item averages (kg CO2, litres water, kWh energy saved vs virgin
// production). Sources vary widely; keep these as motivational estimates.
export const IMPACT = {
  plastic: { co2: 0.08, water: 0.5, energy: 0.20 },
  glass:   { co2: 0.15, water: 1.2, energy: 0.30 },
  tin:     { co2: 0.20, water: 0.8, energy: 0.95 },
  paper:   { co2: 0.05, water: 2.0, energy: 0.30 },
};

// Default "equals to" rates in human units (admin-tunable via impact_json).
export const DEFAULT_IMPACT_CFG = {
  factors: IMPACT,
  kgCo2PerKm: 0.12,
  lPerShower: 50,
  kwhPerCharge: 0.012,
};

export const impactFrom = (matCounts, factors = IMPACT) => {
  let co2 = 0, water = 0, energy = 0;
  Object.entries(matCounts || {}).forEach(([m, n]) => {
    const f = factors[m];
    if (f) {
      co2 += f.co2 * n;
      water += f.water * n;
      energy += f.energy * n;
    }
  });
  return { co2, water, energy };
};

// ==========================================
// ORG-TYPE DESIGN SYSTEM
// School = playful; Office = professional/dense; City = relaxed/earthy.
// All class strings are literal so Tailwind's compiler can see them.
// ==========================================
export const THEMES = {
  school: {
    card: 'rounded-[2rem]', btnShape: 'rounded-full', chip: 'rounded-full', input: 'rounded-2xl',
    sectionGap: 'space-y-8', cardPad: 'p-6 md:p-8',
    accentBtn: 'bg-violet-600 hover:bg-violet-500 text-white shadow-sm hover:shadow',
    accentText: 'text-violet-600 dark:text-violet-400',
    accentSoft: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    heroGrad: 'bg-gradient-to-br from-violet-500 via-purple-600 to-fuchsia-600',
    confetti: true, mascot: true, dense: false,
  },
  office: {
    card: 'rounded-xl', btnShape: 'rounded-lg', chip: 'rounded-md', input: 'rounded-lg',
    sectionGap: 'space-y-4', cardPad: 'p-4 md:p-5',
    accentBtn: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm',
    accentText: 'text-indigo-600 dark:text-indigo-400',
    accentSoft: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    heroGrad: 'bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900',
    confetti: false, mascot: false, dense: true,
  },
  city: {
    card: 'rounded-3xl', btnShape: 'rounded-2xl', chip: 'rounded-xl', input: 'rounded-2xl',
    sectionGap: 'space-y-6', cardPad: 'p-6',
    accentBtn: 'bg-emerald-700 hover:bg-emerald-600 text-white shadow-sm hover:shadow',
    accentText: 'text-emerald-700 dark:text-emerald-400',
    accentSoft: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200',
    heroGrad: 'bg-gradient-to-br from-stone-600 via-teal-800 to-emerald-800',
    confetti: true, mascot: false, dense: false,
  },
};

export const STATIC_STYLES = `
  :root { --sat: env(safe-area-inset-top); --sab: env(safe-area-inset-bottom); }
  .pb-safe { padding-bottom: calc(0.5rem + var(--sab)); }
  @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
  .animate-shake { animation: shake 0.3s ease-in-out; }
  .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
  .animate-bounce-in { animation: bounceIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
  .animate-slide-up { animation: slideUp 0.3s ease-out forwards; }
  .animate-scale-in { animation: scaleIn 0.2s ease-out forwards; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
  @keyframes bounceIn { 0% { opacity: 0; transform: scale(0.3) translateY(30px); } 50% { opacity: 1; transform: scale(1.05) translateY(0); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
  @keyframes confettiFall { 0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; } 100% { transform: translateY(110vh) rotate(720deg); opacity: 0; } }
  :focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; border-radius: 8px; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      scroll-behavior: auto !important;
    }
  }
`;

export const getAchievementsData = (totalItems, matCounts, t, streak = 0) => [
  { id: 'first', title: t.badgeFirst, desc: t.badgeFirstDesc, icon: Star, req: 1, cur: totalItems, color: 'text-indigo-500', colorClass: 'text-indigo-700 bg-indigo-50 border-indigo-200 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-300' },
  { id: 'bronze', title: t.badgeBronze, desc: t.badgeBronzeDesc, icon: Medal, req: 10, cur: totalItems, color: 'text-amber-500', colorClass: 'text-amber-800 bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-400' },
  { id: 'silver', title: t.badgeSilver, desc: t.badgeSilverDesc, icon: Medal, req: 25, cur: totalItems, color: 'text-slate-400', colorClass: 'text-slate-700 bg-slate-50 border-slate-300 dark:bg-slate-700/40 dark:border-slate-600 dark:text-slate-300' },
  { id: 'gold', title: t.badgeGold, desc: t.badgeGoldDesc, icon: Trophy, req: 50, cur: totalItems, color: 'text-yellow-500', colorClass: 'text-yellow-800 bg-yellow-50 border-yellow-200 dark:bg-yellow-900/30 dark:border-yellow-800 dark:text-yellow-400' },
  { id: 'diamond', title: t.badgeDiamond, desc: t.badgeDiamondDesc, icon: Sparkles, req: 100, cur: totalItems, color: 'text-violet-500', colorClass: 'text-violet-800 bg-violet-50 border-violet-200 dark:bg-violet-900/30 dark:border-violet-800 dark:text-violet-400' },
  { id: 'streak7', title: t.badgeStreak, desc: t.badgeStreakDesc, icon: Flame, req: 7, cur: streak, color: 'text-orange-500', colorClass: 'text-orange-800 bg-orange-50 border-orange-200 dark:bg-orange-900/30 dark:border-orange-800 dark:text-orange-400' },
  { id: 'plastic', title: t.badgePlastic, desc: t.badgePlasticDesc, icon: Recycle, req: 20, cur: matCounts.plastic || 0, color: 'text-cyan-500', colorClass: 'text-cyan-800 bg-cyan-50 border-cyan-200 dark:bg-cyan-900/30 dark:border-cyan-800 dark:text-cyan-400' },
  { id: 'glass', title: t.badgeGlass, desc: t.badgeGlassDesc, icon: Zap, req: 20, cur: matCounts.glass || 0, color: 'text-emerald-500', colorClass: 'text-emerald-800 bg-emerald-50 border-emerald-200 dark:bg-emerald-800 dark:text-emerald-400' },
  { id: 'tin', title: t.badgeTin, desc: t.badgeTinDesc, icon: Award, req: 20, cur: matCounts.tin || 0, color: 'text-rose-500', colorClass: 'text-rose-800 bg-rose-50 border-rose-200 dark:bg-rose-900/30 dark:border-rose-800 dark:text-rose-400' },
  { id: 'paper', title: t.badgePaper, desc: t.badgePaperDesc, icon: Leaf, req: 20, cur: matCounts.paper || 0, color: 'text-lime-600', colorClass: 'text-lime-800 bg-lime-50 border-lime-200 dark:bg-lime-900/30 dark:border-lime-800 dark:text-lime-400' },
];

// Lifetime levels shown next to names on the leaderboard (thresholds = items).
export const LEVELS = [
  { min: 75, icon: '🌲', en: 'Forest', bg: 'Гора' },
  { min: 30, icon: '🌳', en: 'Tree', bg: 'Дърво' },
  { min: 10, icon: '🌿', en: 'Sprout', bg: 'Стрък' },
  { min: 1, icon: '🌱', en: 'Seedling', bg: 'Кълн' },
];

export const getLevel = (items, lang) => {
  const l = LEVELS.find(lv => items >= lv.min);
  return l ? { icon: l.icon, name: l[lang] || l.en } : null;
};

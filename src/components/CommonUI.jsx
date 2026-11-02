import React, { useState, useEffect } from 'react';

export const MascotLogo = ({ className }) => (
  <img src="/milo_mascot.png" alt="" aria-hidden="true" className={className} draggable="false" />
);

// A reward shows its uploaded photo when one exists, otherwise its emoji.
export const RewardVisual = ({ reward, imgCls, emojiCls }) => reward?.photo
  ? <img src={reward.photo} alt="" aria-hidden="true" draggable="false" className={`${imgCls} object-cover shadow-sm shrink-0`} />
  : <span className={`${emojiCls} shrink-0`} aria-hidden="true">{reward?.icon || '🎁'}</span>;

export const Confetti = ({ count = 60 }) => {
  const colors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];
  return (
    <div className="fixed inset-0 pointer-events-none z-[70] overflow-hidden" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="absolute w-3 h-3 rounded-sm opacity-0"
             style={{
               left: `${Math.random() * 100}%`, top: '-10px',
               backgroundColor: colors[Math.floor(Math.random() * colors.length)],
               animation: `confettiFall ${2.5 + Math.random() * 2}s ease-in ${Math.random() * 1.5}s forwards`
             }} />
      ))}
    </div>
  );
};

export const AnimatedNumber = ({ value }) => {
  const [displayValue, setDisplayValue] = useState(value);
  useEffect(() => {
    if (displayValue === value) return;
    const duration = 1000;
    const frames = 30;
    const step = (value - displayValue) / frames;
    let current = displayValue;
    const interval = setInterval(() => {
      current += step;
      if ((step > 0 && current >= value) || (step < 0 && current <= value)) {
        setDisplayValue(value); clearInterval(interval);
      } else { setDisplayValue(Math.round(current)); }
    }, duration / frames);
    return () => clearInterval(interval);
  }, [value, displayValue]);
  return <span>{displayValue}</span>;
};

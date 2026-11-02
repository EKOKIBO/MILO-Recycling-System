export const parseTimestamp = (ts) => {
  if (!ts) return new Date();
  const num = Number(ts);
  if (!isNaN(num) && num > 0) return new Date(num < 1e10 ? num * 1000 : num);
  return new Date();
};

// Client-side fallback for the season boundary when stats haven't arrived yet
// (Monday 00:00 UTC, mirrors the backend computation).
export const localWeekStart = () => {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7; // Monday=0
  return Math.floor(Date.now() / 1000) - day * 86400 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds());
};

// Downscale a reward photo client-side so the payload stays MQTT-friendly
// (max 320px on the long edge, JPEG ~72% => typically 10-30 KB as a data URL).
export const resizeImageToDataUrl = (file, maxDim = 320) => new Promise((resolve, reject) => {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    resolve(canvas.toDataURL('image/jpeg', 0.72));
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
  img.src = url;
});

export const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

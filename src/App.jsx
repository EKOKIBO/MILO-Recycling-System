import React, { useState, useEffect, useMemo, useRef } from 'react';
import mqtt from 'mqtt';
import {
  Trophy, Users, Settings, Activity, Trash2, Award,
  Zap, UserPlus, Moon, Sun, Lock, ShieldCheck,
  Download, Edit2, Clock, CheckCircle2, XCircle, Smartphone, Server, Eraser, Globe,
  AlertTriangle, MessageSquare, LogOut, Check, ChevronRight, UserCircle, Loader2, Key, Info,
  Leaf, Recycle, Globe2, Cloud, Droplets, Medal, Star, Badge,
  Gift, Bell, FileDown, UserX, Timer, Car, ShowerHead, BatteryCharging, Flag, Sparkles,
  Wrench, Camera, RefreshCw, Fan
} from 'lucide-react';

// ==========================================
// CONFIGURATION & CONSTANTS
// ==========================================
const MQTT_BROKER = import.meta.env?.VITE_MQTT_URL || 'wss://mqtt.milo-robotics.org';
// The broker requires authentication. NOTE: a browser bundle cannot hold a real
// secret — this "browser" principal is intentionally low-privilege and its
// password is build-time public. Security is enforced by broker ACLs + the
// per-connection reply channel, not by hiding this value.
const MQTT_USER = import.meta.env?.VITE_MQTT_USER || 'browser';
const MQTT_PASS = import.meta.env?.VITE_MQTT_PASS || 'goodboy_f@g&gay';
// Web Push: public VAPID key (pair generated with `npx web-push generate-vapid-keys`;
// the private half lives ONLY on the Pi as MILO_VAPID_PRIVATE_KEY).
const VAPID_PUBLIC_KEY = import.meta.env?.VITE_VAPID_PUBLIC_KEY || 'BFEREDv8zD4h3UumMdzp-aV4S7KusQAlb_0ihjhh72A3_y-dYtvaEYuNfHGqRzGbvVdZu2kdFlwwCT1jJVUXZvg';
const NS = 'milo_v2_system';
const FRONTEND_BUILD = '2026-07-05.4'; // shown in the admin bar next to the backend build

// Illustrative per-item averages (kg CO2, litres water, kWh energy saved vs virgin
// production). Sources vary widely; keep these as motivational estimates.
const IMPACT = {
  plastic: { co2: 0.08, water: 0.5, energy: 0.20 },
  glass:   { co2: 0.15, water: 1.2, energy: 0.30 },
  tin:     { co2: 0.20, water: 0.8, energy: 0.95 },
  paper:   { co2: 0.05, water: 2.0, energy: 0.30 },
};
// Relatable equivalents: 0.12 kg CO2 per km driven, ~50 L per shower, ~0.012 kWh per phone charge.
const EQUIV = { kmPerKgCo2: 1 / 0.12, showersPerL: 1 / 50, chargesPerKwh: 1 / 0.012 };

// ==========================================
// ORG-TYPE DESIGN SYSTEM
// School = playful; Office = professional/dense; City = relaxed/earthy.
// All class strings are literal so Tailwind's compiler can see them.
// ==========================================
const THEMES = {
  school: {
    card: 'rounded-[2rem]', btnShape: 'rounded-full', chip: 'rounded-full', input: 'rounded-2xl',
    sectionGap: 'space-y-8', cardPad: 'p-6 md:p-8',
    accentBtn: 'bg-violet-600 hover:bg-violet-500 text-white',
    accentText: 'text-violet-600 dark:text-violet-400',
    accentSoft: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    heroGrad: 'bg-gradient-to-br from-violet-500 to-fuchsia-600',
    confetti: true, mascot: true, dense: false,
  },
  office: {
    card: 'rounded-xl', btnShape: 'rounded-lg', chip: 'rounded-md', input: 'rounded-lg',
    sectionGap: 'space-y-4', cardPad: 'p-4 md:p-5',
    accentBtn: 'bg-indigo-600 hover:bg-indigo-700 text-white',
    accentText: 'text-indigo-600 dark:text-indigo-400',
    accentSoft: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    heroGrad: 'bg-gradient-to-br from-slate-700 to-slate-900',
    confetti: false, mascot: false, dense: true,
  },
  city: {
    card: 'rounded-3xl', btnShape: 'rounded-2xl', chip: 'rounded-xl', input: 'rounded-2xl',
    sectionGap: 'space-y-6', cardPad: 'p-6',
    accentBtn: 'bg-emerald-700 hover:bg-emerald-600 text-white',
    accentText: 'text-emerald-700 dark:text-emerald-400',
    accentSoft: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200',
    heroGrad: 'bg-gradient-to-br from-stone-500 via-stone-600 to-emerald-800',
    confetti: true, mascot: false, dense: false,
  },
};

const STATIC_STYLES = `
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

// ==========================================
// TRANSLATIONS
// ==========================================
const translations = {
  en: {
    appTitle: "Smart Recycling", dashboard: "Dashboard", admin: "Admin", userHub: "User Hub", about: "About Us", rewardsTab: "Rewards",
    topMaterial: "Top Material", itemsProcessed: "items", totalParticipants: "Participants", activeUsers: "Active users",
    nodeStatus: "Node Status", online: "Online & Syncing", offline: "Offline", connecting: "Connecting…", connectedPi: "Connected to Core", disconnected: "Disconnected",
    leaderboard: "Leaderboard", points: "Points", new: "New", awaitingTx: "Waiting for the first drop-off…", activityFeed: "Activity Feed", recycled: "recycled",
    noActivity: "No activity yet", unnamedUser: "Unnamed User", adminAccess: "Technician Access",
    enterPassword: "Enter master credentials to manage the system.", passwordHint: "Password", incorrectPass: "Incorrect credentials", unlockDashboard: "Unlock Dashboard",
    dbConnection: "Database Status", connected2Way: "Connected — 2-way sync active", exportData: "Export", hardwareDiagnostics: "Hardware Diagnostics", noErrors: "System is running smoothly.",
    clearErrors: "Clear Log", unmappedFound: "Unmapped IDs Found", tapToAssign: "Tap an ID to assign a profile.", manageProfiles: "Manage User Profiles",
    userCode: "ID / Card Code", fullName: "Full Name", department: "Department/Role", save: "Save User", piDirectory: "User Directory", dbEmpty: "Nothing here yet.",
    actions: "Actions", congrats: "Awesome Job!", fanError: "Cooling fan stalled", loginTitle: "User Login", loginDesc: "Access your personal dashboard.",
    password: "Password", loginBtn: "Log In", signingIn: "Signing in…", reqAccount: "No account? Request one.", reqTitle: "Request Account", reqDesc: "Submit your ID to the admin.",
    reqBtn: "Send Request", backLogin: "Back to Login", pendingMsg: "Your account is pending admin approval.", approvedMsg: "Account approved. Set a password to finish.", setPassBtn: "Set Password",
    welcome: "Welcome back", personalStats: "Your Statistics", rank: "Current Rank", totalRecycled: "Total Items", feedbackHub: "Feedback Hub", sendFeedback: "Send Feedback",
    feedbackPh: "Have a suggestion or issue? Let us know…", feedbackSent: "Feedback sent.", adminFeedback: "User Feedback", approve: "Approve", pendingUsers: "Pending Requests",
    myHistory: "My History", editProfile: "Edit Profile", requestEdit: "Submit Edit Request", cancel: "Cancel", editPending: "Profile edit pending admin approval.", profileEdits: "Profile Edit Requests",
    current: "Current", requested: "Requested", reject: "Reject", confirmAction: "Confirm Action", confirmDelete: "Permanently delete this user and their profile?", confirmClear: "Clear all transaction history for this user?",
    confirmReset: "Reset the password for this user?", confirmYes: "Confirm", confirmNo: "Cancel", timeoutErr: "No response — the node is offline or busy. Try again.",
    aboutHero: "Empowering communities through smart recycling.", ourMission: "Our Mission", missionDesc: "To revolutionize waste management by making recycling engaging, accessible, and rewarding through cutting-edge AI and seamless user experiences.",
    ourVision: "Our Vision", visionDesc: "A zero-waste world where sustainability is an effortless habit integrated into everyone's daily life.", team: "The Team", teamDesc: "We are a dedicated group of developers, environmentalists, and designers committed to building sustainable tech for the future.",
    resetPassTitle: "Password Reset", newPassMsg: "New password for", copyClose: "Copy & Close", generatingPass: "Generating new password…", resetTimeout: "No response yet — the reset didn't complete. Check the node connection and try again.",
    orgOffice: "Office", orgSchool: "School", orgCity: "City",
    labelOffice: "Department", labelSchool: "Class/Role", labelCity: "Neighborhood", machineSelect: "Select Machine", orgType: "Organization Type", environmentalImpact: "Environmental Impact",
    co2Saved: "CO₂ Saved", waterSaved: "Water Saved", achievements: "Achievements", badgeFirst: "First Step", badgeBronze: "Bronze Recycler", badgePlastic: "Plastic Pioneer", badgeGlass: "Glass Guru",
    locked: "Locked", installApp: "Install App", username: "Username", adminPanelLink: "Technician Login", adminAccounts: "Manage Admins", addAdmin: "Create Admin", role: "Role", roleSuper: "Technician (Full Access)", roleOrg: "Org Admin (Restricted)",
    deleteAdminConfirm: "Delete this admin account?", badgeFirstDesc: "Recycle your very first item.", badgeBronzeDesc: "Recycle 10 items in total.", badgePlasticDesc: "Recycle 20 plastic items.", badgeGlassDesc: "Recycle 20 glass items.",
    unlockedNew: "Achievement Unlocked!", awesome: "Awesome!", close: "Close", unlocked: "Unlocked", progress: "Progress", confirmPass: "Confirm Password to Submit",
    logout: "Logout", reEnterPass: "Session reloaded. Re-enter your password for secure actions.", switchLang: "Switch language", switchTheme: "Toggle dark mode",
    seasonWeek: "This Week", seasonAll: "All Time", resetsIn: "Resets in", teamStandings: "Team Standings",
    classes: "Classes", departments: "Departments", neighborhoods: "Neighborhoods", membersShort: "members",
    balanceLabel: "Points Balance", redeemBtn: "Redeem", stockLeft: "left", unlimitedStock: "Unlimited", outOfStock: "Out of stock",
    redeemConfirmTitle: "Redeem Reward", redeemConfirmMsg: "Spend points on this reward? Your admin will fulfill it.",
    redeemSuccess: "Request sent! Collect your reward from your admin.", redeemFailAuth: "Wrong password — reward not redeemed.",
    redeemFailPoints: "Not enough points.", redeemFailStock: "Sorry, that reward just ran out.", redeemFailUnavailable: "That reward is unavailable.",
    myRedemptions: "My Redemptions", stPending: "Pending", stFulfilled: "Fulfilled", stRejected: "Rejected",
    manageRewards: "Manage Rewards", addReward: "Add Reward", rewardTitleEn: "Title (EN)", rewardTitleBg: "Title (BG)", rewardIcon: "Emoji", rewardStock: "Stock (-1 = unlimited)",
    pendingRedemptions: "Pending Redemptions", fulfill: "Fulfill", promptLogin: "Log in to redeem rewards.",
    communityImpact: "Community Impact", energySaved: "Energy Saved",
    eqKm: "km of driving avoided", eqShowers: "showers of water", eqCharges: "phone charges",
    notifTitle: "Notifications", notifDesc: "Get notified when your account is approved and when rewards are ready for pickup.",
    notifEnable: "Enable notifications", notifOn: "Notifications are on for this device.", notifDenied: "Notifications are blocked in your browser settings.",
    notifUnsupported: "Notifications aren't supported on this device/browser.", notifNeedPass: "Re-enter your password (log out and back in) to enable notifications.",
    privacyTitle: "Privacy & Data", privacyDesc: "Your data belongs to you. Download everything MILO stores about you, or erase your account completely.",
    downloadData: "Download my data", deleteAccount: "Delete my account",
    deleteWarn: "This permanently erases your profile, points, history, feedback and rewards. This cannot be undone.",
    consentLabel: "I agree that my name, group and recycling activity are processed for the leaderboard and rewards. I can export or delete my data at any time.",
    weeklyKpi: "This week", kpiItems: "Items", kpiPoints: "Points", kpiActive: "Active users",
    impactHow: "How it's calculated", impactBreakdown: "Breakdown by material", impactPerItem: "per item",
    impactDisclaimer: "Illustrative estimates based on average savings from recycling versus producing new materials.",
    pubDenied: "Broker rejected publish to",
    confirmDeleteReward: "Remove this reward from the catalog? Past redemptions are kept.",
    rewardDescEn: "Description (EN, optional)", rewardDescBg: "Description (BG, optional)",
    maintTitle: "Maintenance Mode", maintEnter: "Enter maintenance", maintExit: "Exit maintenance",
    maintWarning: "Machine display is on the maintenance page and user sessions are paused. Auto-exits after 2 minutes without commands.",
    maintCamera: "Inference Camera", maintCapture: "Capture", maintAuto: "Auto refresh",
    maintNoFrame: "No frame yet — press Capture.", maintSnapErr: "Snapshot failed:",
    maintSnapTimeout: "No frame arrived — the vision pipeline may be down.",
    maintMotors: "Motor Jog", maintMotor: "Motor", maintSteps: "steps",
    maintSerialErr: "Serial link to the machine is down.", maintDetections: "detections",
    maintFans: "Fans", fanOnLabel: "On", fanOffLabel: "Off",
    fan1Error: "Fan 1 stalled (tachometer silent) — cooling compromised",
    fan2Error: "Fan 2 stalled (tachometer silent) — cooling compromised",
  },
  bg: {
    appTitle: "Смарт Рециклиране", dashboard: "Табло", admin: "Админ", userHub: "Моят Профил", about: "За нас", rewardsTab: "Награди",
    topMaterial: "Най-рециклиран", itemsProcessed: "обработени", totalParticipants: "Участници", activeUsers: "С активни точки",
    nodeStatus: "Статус на Node", online: "Свързан и синхронизиран", offline: "Офлайн", connecting: "Свързване…", connectedPi: "Свързан с базата", disconnected: "Прекъсната връзка",
    leaderboard: "Класация", points: "Точки", new: "Нов", awaitingTx: "Изчакване на първото рециклиране…", activityFeed: "Активност", recycled: "рециклира",
    noActivity: "Все още няма активност", unnamedUser: "Непознат", adminAccess: "Технически Достъп",
    enterPassword: "Въведете мастър данни за управление.", passwordHint: "Парола", incorrectPass: "Грешни данни", unlockDashboard: "Отключи таблото",
    dbConnection: "Статус на Базата", connected2Way: "Свързана — 2-way синхронизация", exportData: "Експорт", hardwareDiagnostics: "Диагностика", noErrors: "Системата работи нормално.",
    clearErrors: "Изчисти", unmappedFound: "Неразпознати ID-та", tapToAssign: "Кликнете на ID, за да го запазите.", manageProfiles: "Управление на Профили",
    userCode: "ID / Код", fullName: "Пълно Име", department: "Отдел/Роля", save: "Запази", piDirectory: "Потребители", dbEmpty: "Все още няма нищо.",
    actions: "Действия", congrats: "Страхотна работа!", fanError: "Вентилаторът е блокиран", loginTitle: "Вход", loginDesc: "Влезте във вашия личен профил.",
    password: "Парола", loginBtn: "Влез", signingIn: "Влизане…", reqAccount: "Нямате профил? Заявете.", reqTitle: "Заявка за профил", reqDesc: "Изпратете вашето ID за одобрение.",
    reqBtn: "Изпрати Заявка", backLogin: "Обратно към Вход", pendingMsg: "Профилът ви чака одобрение.", approvedMsg: "Одобрено. Задайте парола, за да завършите.", setPassBtn: "Задай Парола",
    welcome: "Добре дошли", personalStats: "Вашата Статистика", rank: "Текущ Ранг", totalRecycled: "Общо Артикули", feedbackHub: "Обратна Връзка", sendFeedback: "Изпрати",
    feedbackPh: "Имате предложение или проблем? Споделете…", feedbackSent: "Обратната връзка е изпратена.", adminFeedback: "Обратна Връзка от Потребители", approve: "Одобри", pendingUsers: "Чакащи Заявки",
    myHistory: "Моята История", editProfile: "Редактирай Профил", requestEdit: "Заяви Редакция", cancel: "Отказ", editPending: "Заявката чака одобрение.", profileEdits: "Заявки за Редакция",
    current: "Текущо", requested: "Заявено", reject: "Отхвърли", confirmAction: "Потвърждение", confirmDelete: "Изтриване на този профил завинаги?", confirmClear: "Изчистване на историята за потребителя?",
    confirmReset: "Нулиране на паролата за потребителя?", confirmYes: "Потвърди", confirmNo: "Отказ", timeoutErr: "Няма отговор — node е офлайн или зает. Опитайте отново.",
    aboutHero: "Овластяваме общностите чрез интелигентно рециклиране.", ourMission: "Нашата Мисия", missionDesc: "Да революционизираме управлението на отпадъци, правейки рециклирането ангажиращо и възнаграждаващо чрез AI технологии.",
    ourVision: "Нашата Визия", visionDesc: "Свят без отпадъци, в който устойчивостта е лесен навик, интегриран в ежедневието на всеки.", team: "Екипът", teamDesc: "Ние сме посветена група от разработчици и еколози, ангажирани с изграждането на устойчиви технологии.",
    resetPassTitle: "Нулирана Парола", newPassMsg: "Новата парола за", copyClose: "Копирай и Затвори", generatingPass: "Генериране на нова парола…", resetTimeout: "Все още няма отговор — нулирането не приключи. Проверете връзката с node и опитайте отново.",
    orgOffice: "Офис", orgSchool: "Училище", orgCity: "Град",
    labelOffice: "Отдел", labelSchool: "Клас/Роля", labelCity: "Квартал", machineSelect: "Избор на Машина", orgType: "Тип Организация", environmentalImpact: "Екологично Въздействие",
    co2Saved: "Спестен CO₂", waterSaved: "Спестена Вода", achievements: "Постижения", badgeFirst: "Първа Стъпка", badgeBronze: "Бронзов Рециклатор", badgePlastic: "Пластмасов Герой", badgeGlass: "Стъклен Гуру",
    locked: "Заключено", installApp: "Инсталирай", username: "Потребителско Име", adminPanelLink: "Технически Вход", adminAccounts: "Управление на Админи", addAdmin: "Създай Админ", role: "Роля", roleSuper: "Техник (Пълен достъп)", roleOrg: "Админ (Ограничен)",
    deleteAdminConfirm: "Изтриване на този админ?", badgeFirstDesc: "Рециклирайте първия си артикул.", badgeBronzeDesc: "Рециклирайте общо 10 артикула.", badgePlasticDesc: "Рециклирайте 20 пластмасови артикула.", badgeGlassDesc: "Рециклирайте 20 стъклени артикула.",
    unlockedNew: "Ново Постижение!", awesome: "Страхотно!", close: "Затвори", unlocked: "Отключено", progress: "Прогрес", confirmPass: "Потвърдете паролата си",
    logout: "Изход", reEnterPass: "Сесията е презаредена. Въведете паролата си отново за защитени действия.", switchLang: "Смени езика", switchTheme: "Тъмен режим",
    seasonWeek: "Тази Седмица", seasonAll: "Всички Времена", resetsIn: "Нулира се след", teamStandings: "Отборна Класация",
    classes: "Класове", departments: "Отдели", neighborhoods: "Квартали", membersShort: "участници",
    balanceLabel: "Баланс Точки", redeemBtn: "Вземи", stockLeft: "останали", unlimitedStock: "Неограничено", outOfStock: "Изчерпано",
    redeemConfirmTitle: "Вземане на Награда", redeemConfirmMsg: "Да похарчите точки за тази награда? Вашият админ ще я предаде.",
    redeemSuccess: "Заявката е изпратена! Вземете наградата от вашия админ.", redeemFailAuth: "Грешна парола — наградата не е взета.",
    redeemFailPoints: "Нямате достатъчно точки.", redeemFailStock: "Съжаляваме, тази награда току-що свърши.", redeemFailUnavailable: "Тази награда не е налична.",
    myRedemptions: "Моите Награди", stPending: "Чакаща", stFulfilled: "Предадена", stRejected: "Отказана",
    manageRewards: "Управление на Награди", addReward: "Добави Награда", rewardTitleEn: "Заглавие (EN)", rewardTitleBg: "Заглавие (BG)", rewardIcon: "Емоджи", rewardStock: "Наличност (-1 = безкрайна)",
    pendingRedemptions: "Чакащи Заявки за Награди", fulfill: "Предай", promptLogin: "Влезте, за да вземате награди.",
    communityImpact: "Общо Въздействие", energySaved: "Спестена Енергия",
    eqKm: "км шофиране спестени", eqShowers: "душа вода", eqCharges: "зареждания на телефон",
    notifTitle: "Известия", notifDesc: "Получавайте известие при одобрен профил и готова награда.",
    notifEnable: "Включи известията", notifOn: "Известията са включени за това устройство.", notifDenied: "Известията са блокирани в настройките на браузъра.",
    notifUnsupported: "Известията не се поддържат на това устройство/браузър.", notifNeedPass: "Въведете паролата си отново (излезте и влезте), за да включите известията.",
    privacyTitle: "Поверителност и Данни", privacyDesc: "Вашите данни са ваши. Изтеглете всичко, което MILO съхранява за вас, или изтрийте профила си напълно.",
    downloadData: "Изтегли моите данни", deleteAccount: "Изтрий профила ми",
    deleteWarn: "Това изтрива завинаги профила, точките, историята, обратната връзка и наградите ви. Не може да бъде отменено.",
    consentLabel: "Съгласен/на съм името, групата и рециклиращата ми активност да се обработват за класацията и наградите. Мога да изтегля или изтрия данните си по всяко време.",
    weeklyKpi: "Тази седмица", kpiItems: "Артикули", kpiPoints: "Точки", kpiActive: "Активни потребители",
    impactHow: "Как се изчислява", impactBreakdown: "Разбивка по материал", impactPerItem: "на артикул",
    impactDisclaimer: "Илюстративни оценки на база средни спестявания при рециклиране спрямо ново производство.",
    pubDenied: "Брокерът отказа публикуване към",
    confirmDeleteReward: "Премахване на тази награда от каталога? Минали заявки се запазват.",
    rewardDescEn: "Описание (EN, по избор)", rewardDescBg: "Описание (BG, по избор)",
    maintTitle: "Режим Поддръжка", maintEnter: "Влез в поддръжка", maintExit: "Излез от поддръжка",
    maintWarning: "Дисплеят на машината е на страница за поддръжка и потребителските сесии са спрени. Излиза автоматично след 2 минути без команди.",
    maintCamera: "Камера с Разпознаване", maintCapture: "Снимка", maintAuto: "Автообновяване",
    maintNoFrame: "Още няма кадър — натиснете Снимка.", maintSnapErr: "Снимката се провали:",
    maintSnapTimeout: "Не пристигна кадър — визията може да не работи.",
    maintMotors: "Тестване на Моторите", maintMotor: "Мотор", maintSteps: "стъпки",
    maintSerialErr: "Серийната връзка с машината е прекъсната.", maintDetections: "разпознавания",
    maintFans: "Вентилатори", fanOnLabel: "Вкл", fanOffLabel: "Изкл",
    fan1Error: "Вентилатор 1 е блокирал (няма тахо сигнал) — охлаждането е нарушено",
    fan2Error: "Вентилатор 2 е блокирал (няма тахо сигнал) — охлаждането е нарушено",
  }
};

const getAchievementsData = (totalItems, matCounts, t) => [
  { id: 'first', title: t.badgeFirst, desc: t.badgeFirstDesc, icon: Star, req: 1, cur: totalItems, color: 'text-indigo-500', colorClass: 'text-indigo-700 bg-indigo-50 border-indigo-200 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-300' },
  { id: 'bronze', title: t.badgeBronze, desc: t.badgeBronzeDesc, icon: Medal, req: 10, cur: totalItems, color: 'text-amber-500', colorClass: 'text-amber-800 bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-400' },
  { id: 'plastic', title: t.badgePlastic, desc: t.badgePlasticDesc, icon: Recycle, req: 20, cur: matCounts.plastic || 0, color: 'text-cyan-500', colorClass: 'text-cyan-800 bg-cyan-50 border-cyan-200 dark:bg-cyan-900/30 dark:border-cyan-800 dark:text-cyan-400' },
  { id: 'glass', title: t.badgeGlass, desc: t.badgeGlassDesc, icon: Zap, req: 20, cur: matCounts.glass || 0, color: 'text-emerald-500', colorClass: 'text-emerald-800 bg-emerald-50 border-emerald-200 dark:bg-emerald-800 dark:text-emerald-400' },
];

const parseTimestamp = (ts) => {
  if (!ts) return new Date();
  const num = Number(ts);
  if (!isNaN(num) && num > 0) return new Date(num < 1e10 ? num * 1000 : num);
  return new Date();
};

// Client-side fallback for the season boundary when stats haven't arrived yet
// (Monday 00:00 UTC, mirrors the backend computation).
const localWeekStart = () => {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7; // Monday=0
  return Math.floor(Date.now() / 1000) - day * 86400 - (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds());
};

const impactFrom = (matCounts) => {
  let co2 = 0, water = 0, energy = 0;
  Object.entries(matCounts || {}).forEach(([m, n]) => {
    const f = IMPACT[m];
    if (f) { co2 += f.co2 * n; water += f.water * n; energy += f.energy * n; }
  });
  return { co2, water, energy };
};

const urlBase64ToUint8Array = (base64String) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

// ==========================================
// UI COMPONENTS
// ==========================================
const MascotLogo = ({ className }) => (
  <img src="/milo_mascot.png" alt="" aria-hidden="true" className={className} draggable="false" />
);

const Confetti = ({ count = 60 }) => {
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

const AnimatedNumber = ({ value }) => {
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

// ==========================================
// MAIN APP COMPONENT
// ==========================================
export default function App() {
  // Global UI State
  const [activeTab, setActiveTab] = useState('leaderboard');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [lang, setLang] = useState('en');
  const t = translations[lang] || translations['en'];

  // Keep the latest translations reachable from the once-registered MQTT handler.
  const tRef = useRef(t);
  tRef.current = t;

  const [orgType, setOrgType] = useState('office');
  const th = THEMES[orgType] || THEMES.office;
  const deptLabel = orgType === 'school' ? t.labelSchool : (orgType === 'city' ? t.labelCity : t.labelOffice);
  const teamsLabel = orgType === 'school' ? t.classes : (orgType === 'city' ? t.neighborhoods : t.departments);

  // Theme-derived composite classes (all fragments are literal strings above).
  const cardCls = `bg-white dark:bg-slate-800 ${th.card} shadow-sm border border-slate-200 dark:border-slate-700 transition-colors`;
  const btnPrimary = `${th.accentBtn} ${th.btnShape} font-bold transition-colors`;
  const fieldChrome = `w-full ${th.input} border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-colors`;
  const inputCls = `${fieldChrome} p-4`;
  // Compact 48px fields (admin forms & selects): horizontal padding only —
  // p-4 + h-12 left 16px of content height, which clipped <select> text.
  const inputSm = `${fieldChrome} px-3 h-12`;

  // Connection & Data State
  const [connectionState, setConnectionState] = useState('connecting');
  const isConnected = connectionState === 'online';
  const [transactions, setTransactions] = useState([]);
  const [users, setUsers] = useState({});
  const [hardwareErrors, setHardwareErrors] = useState({});
  const [feedbacks, setFeedbacks] = useState([]);
  const [profileEdits, setProfileEdits] = useState([]);
  const [adminsList, setAdminsList] = useState([]);
  const [stats, setStats] = useState(null);           // {week_start, weekly:{users,teams,materials}, all_time:{...}}
  const [rewards, setRewards] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [seasonView, setSeasonView] = useState('week'); // 'week' | 'all'
  const [, setNowTick] = useState(Date.now());          // re-render for the countdown

  // Session State
  const [loggedInUser, setLoggedInUser] = useState(null);
  const [sessionPassword, setSessionPassword] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminToken, setAdminToken] = useState(null);
  const [adminRole, setAdminRole] = useState(null);

  // Forms & Temp State
  const [userView, setUserView] = useState('login');
  const [userAuthForm, setUserAuthForm] = useState({ code: '', password: '', name: '', department: '', consent: false });
  const [loginError, setLoginError] = useState('');
  const [userAuthPending, setUserAuthPending] = useState(false);
  const [adminAuthForm, setAdminAuthForm] = useState({ username: '', password: '' });
  const [adminAuthError, setAdminAuthError] = useState('');
  const [adminAuthPending, setAdminAuthPending] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackConfirmPass, setFeedbackConfirmPass] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editProfileForm, setEditProfileForm] = useState({ name: '', department: '', confirmPass: '' });
  const [adminForm, setAdminForm] = useState({ code: '', name: '', department: '' });
  const [newAdminForm, setNewAdminForm] = useState({ username: '', password: '', role: 'org' });
  const [rewardForm, setRewardForm] = useState({ title: '', title_bg: '', cost: '', stock: '-1', icon: '🎁', description: '', description_bg: '' });
  const [adminMessage, setAdminMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [resetFlow, setResetFlow] = useState(null);
  const [redeemModal, setRedeemModal] = useState(null); // { reward, pass, pending }
  const [gdprModal, setGdprModal] = useState(null);     // { mode: 'export'|'delete', pass, busy }
  const [pushState, setPushState] = useState('idle');   // idle | on | denied | unsupported
  const [toast, setToast] = useState(null);             // { type: 'ok'|'err', msg }
  const [impactModal, setImpactModal] = useState(null); // { metric: 'co2'|'water'|'energy', matCounts }
  const [installPrompt, setInstallPrompt] = useState(null); // captured beforeinstallprompt
  const [backendBuild, setBackendBuild] = useState(null);   // reported via config/list
  const [rewardInfoModal, setRewardInfoModal] = useState(null); // reward whose description is shown
  const [maintMode, setMaintMode] = useState(false);
  const [snapshot, setSnapshot] = useState(null);        // { src, ts, detections } | { error }
  const [snapshotPending, setSnapshotPending] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [jogMotor, setJogMotor] = useState(1);
  const [fanStates, setFanStates] = useState([true, true]); // maintenance manual fan control

  // Queues & Modals
  const [popupQueue, setPopupQueue] = useState([]);
  const [activePopup, setActivePopup] = useState(null);
  const [highlightedUser, setHighlightedUser] = useState(null);
  const [selectedAchievement, setSelectedAchievement] = useState(null);
  const [newAchievementQueue, setNewAchievementQueue] = useState([]);

  // Refs
  const mqttClientRef = useRef(null);
  const authReqIdRef = useRef(null);
  const attemptingUserRef = useRef(null);
  const attemptingPassRef = useRef('');
  const pendingResetRef = useRef(null);
  const pendingRedeemRef = useRef(null);
  const pendingGdprRef = useRef(null);
  const toastTimerRef = useRef(null);
  const pendingSnapRef = useRef(null);      // timeoutId of an in-flight snapshot
  const requestSnapshotRef = useRef(null);  // latest requestSnapshot for the auto-refresh interval

  // Stable per-connection client id: scopes our private reply topic AND must
  // equal the MQTT client id (broker ACL: pattern read reply/%c/#).
  const clientIdRef = useRef(null);
  if (!clientIdRef.current) {
    clientIdRef.current = 'milo_web_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  }

  const showToast = (msg, type = 'ok') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  };

  // Every dashboard publish goes through this helper. With protocolVersion 5,
  // an ACL denial arrives as PUBACK reason code 135 instead of vanishing —
  // the historical cause of "the button does nothing" on locked-down brokers.
  const pub = (topic, jsonString) => {
    mqttClientRef.current?.publish(topic, jsonString, { qos: 1 }, (err, packet) => {
      const rc = packet && typeof packet.reasonCode === 'number' ? packet.reasonCode : 0;
      if (err || rc >= 128) {
        const reason = err ? (err.message || String(err)) : `rc ${rc}${rc === 135 ? ' — not authorized (aclfile)' : ''}`;
        showToast(`${tRef.current.pubDenied} ${topic} (${reason})`, 'err');
        console.error('[MQTT PUBLISH FAILED]', topic, reason);
      }
    });
  };

  // ==========================================
  // INITIALIZATION & CLEANUP
  // ==========================================
  useEffect(() => {
    setIsDarkMode(localStorage.getItem('miloTheme') === 'dark');
    const savedLang = localStorage.getItem('miloLang'); if (savedLang) setLang(savedLang);
    const savedUser = localStorage.getItem('miloLoggedIn'); if (savedUser) setLoggedInUser(savedUser);
    const savedOrg = localStorage.getItem('miloOrgType'); if (savedOrg) setOrgType(savedOrg);
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_PUBLIC_KEY) {
      setPushState('unsupported');
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      setPushState('denied');
    }
  }, []);

  // PWA install: Chrome on Android fires beforeinstallprompt instead of showing
  // a visible button; capture it and surface our own Install button.
  useEffect(() => {
    const onBip = (e) => { e.preventDefault(); setInstallPrompt(e); };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Countdown re-render tick (once a minute is plenty)
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const toggleTheme = () => { setIsDarkMode(!isDarkMode); localStorage.setItem('miloTheme', !isDarkMode ? 'dark' : 'light'); };
  const toggleLang = () => { const newLang = lang === 'en' ? 'bg' : 'en'; setLang(newLang); localStorage.setItem('miloLang', newLang); };
  const handleOrgChange = (e) => {
    const v = e.target.value;
    setOrgType(v); localStorage.setItem('miloOrgType', v); // optimistic; server echo confirms
    if (adminToken) {
      pub(`${NS}/config/set`, JSON.stringify({ key: 'org_type', value: v, admin_token: adminToken }));
    }
  };

  // Restore push state: if this device already holds a subscription and
  // permission, show 'on' instead of offering to enable again.
  useEffect(() => {
    if (!loggedInUser || pushState !== 'idle') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_PUBLIC_KEY) return;
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => { if (sub && typeof Notification !== 'undefined' && Notification.permission === 'granted') setPushState('on'); })
      .catch(() => {});
  }, [loggedInUser, pushState]);

  // ==========================================
  // MQTT LIFECYCLE
  // ==========================================
  useEffect(() => {
    const clientId = clientIdRef.current;
    const replyPrefix = `${NS}/reply/${clientId}/`;

    const client = mqtt.connect(MQTT_BROKER, {
      clientId,
      username: MQTT_USER,
      password: MQTT_PASS,
      clean: true,
      reconnectPeriod: 3000,
      // MQTT v5: mosquitto reports ACL denials in the PUBACK reason code
      // (135 = not authorized) instead of dropping the message silently.
      protocolVersion: 5,
    });
    mqttClientRef.current = client;

    const topics = [
      `${NS}/transactions`, `${NS}/transactions/list`, `${NS}/errors`,
      `${NS}/users/list`, `${NS}/feedback/list`, `${NS}/profile_edit/list`,
      `${NS}/stats/list`, `${NS}/rewards/list`, `${NS}/redemptions/list`, `${NS}/config/list`,
      `${NS}/reply/${clientId}/#`,
    ];

    client.on('connect', () => {
      setConnectionState('online');
      client.subscribe(topics);
      client.publish(`${NS}/users/request`, JSON.stringify({}));
      client.publish(`${NS}/transactions/request`, JSON.stringify({}));
      client.publish(`${NS}/feedback/request`, JSON.stringify({}));
      client.publish(`${NS}/profile_edit/request`, JSON.stringify({}));
      client.publish(`${NS}/stats/request`, JSON.stringify({}));
      client.publish(`${NS}/rewards/request`, JSON.stringify({}));
      client.publish(`${NS}/redemptions/request`, JSON.stringify({}));
      client.publish(`${NS}/config/request`, JSON.stringify({}));
    });

    client.on('reconnect', () => setConnectionState('connecting'));
    client.on('offline', () => setConnectionState('offline'));
    client.on('error', () => setConnectionState('offline'));

    client.on('message', (topic, message) => {
      const tt = tRef.current;
      try {
        const data = JSON.parse(message.toString());

        // --- Private reply channel (this connection only) ---
        if (topic.startsWith(replyPrefix)) {
          const sub = topic.slice(replyPrefix.length);
          switch (sub) {
            case 'auth':
              if (authReqIdRef.current === data.req_id) {
                setUserAuthPending(false);
                if (data.success) {
                  const uCode = attemptingUserRef.current;
                  setLoggedInUser(uCode);
                  localStorage.setItem('miloLoggedIn', uCode);
                  setSessionPassword(attemptingPassRef.current || '');
                  setLoginError('');
                  setUserView('login');
                } else {
                  setLoginError(tt.incorrectPass);
                }
                attemptingPassRef.current = '';
                authReqIdRef.current = null;
              }
              break;
            case 'admin/auth':
              if (authReqIdRef.current === data.req_id) {
                setAdminAuthPending(false);
                if (data.success) {
                  setAdminToken(data.token);
                  setAdminRole(data.role);
                  setIsAdminAuthenticated(true);
                  setAdminAuthError('');
                  setAdminAuthForm({ username: '', password: '' });
                  if (data.role === 'super') {
                    client.publish(`${NS}/admin/list/request`, JSON.stringify({ admin_token: data.token, client_id: clientId }));
                  }
                } else {
                  setAdminAuthError(tt.incorrectPass);
                }
                authReqIdRef.current = null;
              }
              break;
            case 'admin/list':
              setAdminsList(Array.isArray(data) ? data : []);
              break;
            case 'reset_result': {
              const p = pendingResetRef.current;
              if (p?.timeoutId) clearTimeout(p.timeoutId);
              pendingResetRef.current = null;
              setResetFlow({ status: 'done', name: p?.name || data.code, password: data.password });
              break;
            }
            case 'redeem_result': {
              const p = pendingRedeemRef.current;
              if (p?.timeoutId) clearTimeout(p.timeoutId);
              pendingRedeemRef.current = null;
              setRedeemModal(null);
              if (data.success) {
                setToast({ msg: tt.redeemSuccess, type: 'ok' });
              } else {
                const reasonMap = { auth: tt.redeemFailAuth, insufficient: tt.redeemFailPoints, out_of_stock: tt.redeemFailStock, unavailable: tt.redeemFailUnavailable };
                setToast({ msg: reasonMap[data.reason] || tt.timeoutErr, type: 'err' });
              }
              setTimeout(() => setToast(null), 4000);
              break;
            }
            case 'privacy_export': {
              const p = pendingGdprRef.current;
              if (p?.timeoutId) clearTimeout(p.timeoutId);
              pendingGdprRef.current = null;
              setGdprModal(null);
              if (data.success && data.data) {
                const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'milo_my_data.json'; a.click();
                window.URL.revokeObjectURL(url);
              } else {
                setToast({ msg: tt.incorrectPass, type: 'err' });
                setTimeout(() => setToast(null), 4000);
              }
              break;
            }
            case 'snapshot': {
              if (pendingSnapRef.current) { clearTimeout(pendingSnapRef.current); pendingSnapRef.current = null; }
              setSnapshotPending(false);
              if (data.success) {
                setSnapshot({ src: `data:image/jpeg;base64,${data.jpeg_b64}`, ts: data.ts, detections: data.detections });
              } else {
                setSnapshot({ error: data.reason });
              }
              break;
            }
            case 'maint': {
              if (data.ok === false) {
                const reasonMap = { serial: tt.maintSerialErr, auth: tt.incorrectPass, range: 'range' };
                setToast({ msg: reasonMap[data.reason] || data.reason, type: 'err' });
                setTimeout(() => setToast(null), 4000);
              }
              break;
            }
            case 'privacy_result': {
              const p = pendingGdprRef.current;
              if (p?.timeoutId) clearTimeout(p.timeoutId);
              pendingGdprRef.current = null;
              setGdprModal(null);
              if (data.success) {
                // Account erased server-side: end the local session too.
                setLoggedInUser(null);
                setSessionPassword('');
                localStorage.removeItem('miloLoggedIn');
                setToast({ msg: '✓', type: 'ok' });
                setTimeout(() => setToast(null), 2500);
              } else {
                setToast({ msg: tt.incorrectPass, type: 'err' });
                setTimeout(() => setToast(null), 4000);
              }
              break;
            }
            default:
              break;
          }
          return;
        }

        // --- Public broadcast topics ---
        switch (topic) {
          case `${NS}/transactions`:
            setTransactions(prev => {
              if (prev.some(tx => tx.id === data.id)) return prev;
              return [data, ...prev].slice(0, 500);
            });
            setPopupQueue(q => q.some(tx => tx.id === data.id) ? q : [...q, data]);
            break;
          case `${NS}/transactions/list`:
            setTransactions(Array.isArray(data) ? data : []);
            break;
          case `${NS}/users/list`:
            setUsers(data || {});
            break;
          case `${NS}/feedback/list`:
            setFeedbacks(Array.isArray(data) ? data : []);
            break;
          case `${NS}/profile_edit/list`:
            setProfileEdits(Array.isArray(data) ? data : []);
            break;
          case `${NS}/stats/list`:
            setStats(data || null);
            break;
          case `${NS}/rewards/list`:
            setRewards(Array.isArray(data) ? data : []);
            break;
          case `${NS}/redemptions/list`:
            setRedemptions(Array.isArray(data) ? data : []);
            break;
          case `${NS}/config/list`:
            if (data && data.backend_build) setBackendBuild(data.backend_build);
            if (data && ['office', 'school', 'city'].includes(data.org_type)) {
              setOrgType(data.org_type);
              localStorage.setItem('miloOrgType', data.org_type);
            }
            break;
          case `${NS}/errors`:
            setHardwareErrors(prev => ({ ...prev, [data.error]: Date.now() }));
            break;
          default:
            break;
        }
      } catch (e) {
        console.error("Payload Parse Error", e);
      }
    });

    return () => {
      client.end(true);
    };
  }, []);

  // Hardware Error Auto-Clear
  useEffect(() => {
    const timer = setInterval(() => {
      setHardwareErrors(prev => {
        const now = Date.now();
        const updated = { ...prev };
        let modified = false;
        Object.keys(updated).forEach(key => { if (now - updated[key] > 8000) { delete updated[key]; modified = true; } });
        return modified ? updated : prev;
      });
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // Transaction popup: consume the queue.
  // BUG FIX: this used to also own the dismissal setTimeout and return
  // clearTimeout as its cleanup — but setPopupQueue changes a dependency, so
  // React re-ran the effect and the cleanup CANCELLED the timer, leaving the
  // popup stuck forever. The timer now lives in its own effect.
  useEffect(() => {
    if (popupQueue.length > 0 && !activePopup) {
      const nextTx = popupQueue[0];
      setPopupQueue(prev => prev.slice(1));
      setActivePopup(nextTx);
      setHighlightedUser(nextTx.user_code);
    }
  }, [popupQueue, activePopup]);

  useEffect(() => {
    if (!activePopup) return;
    const dismiss = setTimeout(() => setActivePopup(null), 3500);
    return () => clearTimeout(dismiss);
  }, [activePopup]);

  useEffect(() => {
    if (activePopup || !highlightedUser) return;
    const fade = setTimeout(() => setHighlightedUser(null), 2000);
    return () => clearTimeout(fade);
  }, [activePopup, highlightedUser]);

  // ==========================================
  // MEMOIZED COMPUTATIONS
  // ==========================================
  const safeTransactions = Array.isArray(transactions) ? transactions : [];
  const safeProfileEdits = Array.isArray(profileEdits) ? profileEdits : [];
  const safeUsers = users || {};

  const weekStart = stats?.week_start || localWeekStart();
  const resetCountdown = useMemo(() => {
    const secsLeft = Math.max(0, weekStart + 7 * 86400 - Math.floor(Date.now() / 1000));
    const d = Math.floor(secsLeft / 86400);
    const h = Math.floor((secsLeft % 86400) / 3600);
    const m = Math.floor((secsLeft % 3600) / 60);
    return d > 0 ? `${d}d ${h}h` : (h > 0 ? `${h}h ${m}m` : `${m}m`);
  }, [weekStart, stats, transactions]); // ticks via setNowTick re-render

  // Client-side fallback aggregation (used until the first stats broadcast).
  const fallbackScope = useMemo(() => {
    const build = (txs) => {
      const users_ = {}; const teams_ = {}; const materials_ = {};
      const teamMembers = {}; // BUG FIX: members was initialized to 0 and never counted
      txs.forEach(tx => {
        if (!users_[tx.user_code]) users_[tx.user_code] = { points: 0, items: 0 };
        users_[tx.user_code].points += tx.points; users_[tx.user_code].items += 1;
        materials_[tx.material] = (materials_[tx.material] || 0) + 1;
        const dept = safeUsers[tx.user_code]?.department;
        if (dept) {
          if (!teams_[dept]) { teams_[dept] = { points: 0, items: 0, members: 0 }; teamMembers[dept] = new Set(); }
          teams_[dept].points += tx.points; teams_[dept].items += 1;
          teamMembers[dept].add(tx.user_code);
        }
      });
      Object.keys(teams_).forEach(d => { teams_[d].members = teamMembers[d].size; });
      return { users: users_, teams: teams_, materials: materials_ };
    };
    const weekly = build(safeTransactions.filter(tx => {
      const tsec = Number(tx.timestamp) < 1e10 ? Number(tx.timestamp) : Number(tx.timestamp) / 1000;
      return tsec >= weekStart;
    }));
    return { weekly, all_time: build(safeTransactions) };
  }, [safeTransactions, safeUsers, weekStart]);

  const scopeData = (view) => {
    const source = stats && stats.weekly && stats.all_time ? stats : fallbackScope;
    return view === 'week' ? source.weekly : source.all_time;
  };

  // Leaderboard for the selected season view
  const board = useMemo(() => {
    const scope = scopeData(seasonView);
    return Object.entries(scope.users || {})
      .map(([code, v]) => ({ code, totalPoints: v.points, items: v.items }))
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, 10);
  }, [stats, fallbackScope, seasonView]);

  // Team standings for the selected season view
  const teamBoard = useMemo(() => {
    const scope = scopeData(seasonView);
    return Object.entries(scope.teams || {})
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 6);
  }, [stats, fallbackScope, seasonView]);

  // All-time personal numbers (rank/points/balance stay all-time regardless of view)
  const allTimeUsers = useMemo(() => {
    const scope = scopeData('all');
    return Object.entries(scope.users || {})
      .map(([code, v]) => ({ code, totalPoints: v.points, items: v.items }))
      .sort((a, b) => b.totalPoints - a.totalPoints);
  }, [stats, fallbackScope]);

  const { mostRecycled, materialsCount, totalParticipants } = useMemo(() => {
    const mats = { plastic: 0, glass: 0, tin: 0, paper: 0, ...(scopeData('all').materials || {}) };
    const sortedMats = Object.keys(mats).sort((a, b) => mats[b] - mats[a]);
    return {
      mostRecycled: mats[sortedMats[0]] > 0 ? sortedMats[0] : "None",
      materialsCount: mats,
      totalParticipants: Object.keys(scopeData('all').users || {}).length
    };
  }, [stats, fallbackScope]);

  const communityImpact = useMemo(() => impactFrom(scopeData('all').materials), [stats, fallbackScope]);

  const userRank = useMemo(() => {
    if (!loggedInUser) return 0;
    const index = allTimeUsers.findIndex(u => u.code === loggedInUser);
    return index !== -1 ? index + 1 : 0;
  }, [allTimeUsers, loggedInUser]);

  const myEarned = allTimeUsers.find(u => u.code === loggedInUser)?.totalPoints || 0;
  const myItems = allTimeUsers.find(u => u.code === loggedInUser)?.items || 0;
  const mySpent = useMemo(() =>
    redemptions.filter(r => r.user_code === loggedInUser && r.status !== 'rejected').reduce((s, r) => s + (r.cost || 0), 0),
    [redemptions, loggedInUser]);
  const myBalance = myEarned - mySpent;
  const myRedemptions = useMemo(() => redemptions.filter(r => r.user_code === loggedInUser), [redemptions, loggedInUser]);

  const suggestedIds = useMemo(() => {
    const ids = new Set();
    safeTransactions.forEach(tx => { if (!safeUsers[tx.user_code]) ids.add(tx.user_code); });
    return Array.from(ids);
  }, [safeTransactions, safeUsers]);

  // Achievements Monitor
  useEffect(() => {
    if (!loggedInUser || safeTransactions.length === 0) return;
    const myTxs = safeTransactions.filter(tx => tx.user_code === loggedInUser);
    if (myTxs.length === 0) return;
    const matCounts = { plastic: 0, glass: 0, tin: 0, paper: 0 };
    myTxs.forEach(tx => { matCounts[tx.material] = (matCounts[tx.material] || 0) + 1; });
    const achievementsList = getAchievementsData(myTxs.length, matCounts, t);
    const unlockedNow = achievementsList.filter(a => a.cur >= a.req).map(a => a.id);
    const seenKey = `milo_achievements_seen_${loggedInUser}`;
    const seenIds = JSON.parse(localStorage.getItem(seenKey) || '[]');
    const newlyUnlockedIds = unlockedNow.filter(id => !seenIds.includes(id));
    if (newlyUnlockedIds.length > 0) {
      const newAchs = achievementsList.filter(a => newlyUnlockedIds.includes(a.id));
      setNewAchievementQueue(prev => [...prev, ...newAchs]);
      localStorage.setItem(seenKey, JSON.stringify([...seenIds, ...newlyUnlockedIds]));
    }
  }, [safeTransactions, loggedInUser, t]);

  // ==========================================
  // ACTION HANDLERS
  // ==========================================
  const handleUserLoginStep = (e) => {
    e.preventDefault();
    setLoginError('');
    const code = userAuthForm.code;
    const uData = safeUsers[code];

    if (!uData || (uData.status === 'active' && !uData.has_password)) {
      if (uData) setUserAuthForm(prev => ({ ...prev, name: uData.name || '', department: uData.department || '' }));
      setUserView('request');
    } else if (uData.status === 'pending') {
      setLoginError(t.pendingMsg);
    } else if (uData.status === 'approved') {
      setUserView('set_password');
    } else {
      if (!userAuthForm.password) { setLoginError(t.incorrectPass); return; }
      const reqId = Math.random().toString(36);
      authReqIdRef.current = reqId;
      attemptingUserRef.current = code;
      attemptingPassRef.current = userAuthForm.password;
      setUserAuthPending(true);
      pub(`${NS}/auth/request`, JSON.stringify({ req_id: reqId, code: code, password: userAuthForm.password, client_id: clientIdRef.current }));
      setTimeout(() => {
        if (authReqIdRef.current === reqId) {
          setLoginError(t.timeoutErr);
          setUserAuthPending(false);
          attemptingPassRef.current = '';
          authReqIdRef.current = null;
        }
      }, 6000);
    }
  };

  const handleAdminLogin = (e) => {
    e.preventDefault();
    setAdminAuthError('');
    const reqId = Math.random().toString(36);
    authReqIdRef.current = reqId;
    setAdminAuthPending(true);
    pub(`${NS}/admin/auth/request`, JSON.stringify({ req_id: reqId, username: adminAuthForm.username, password: adminAuthForm.password, client_id: clientIdRef.current }));
    setTimeout(() => {
      if (authReqIdRef.current === reqId) {
        setAdminAuthError(t.timeoutErr);
        setAdminAuthPending(false);
        authReqIdRef.current = null;
      }
    }, 6000);
  };

  const submitAccountRequest = (e) => {
    e.preventDefault();
    if (!userAuthForm.consent) return; // GDPR: backend also enforces this
    pub(`${NS}/users/update`, JSON.stringify({
      action: 'request', code: userAuthForm.code, name: userAuthForm.name,
      department: userAuthForm.department, consent: true
    }));
    setLoginError(t.pendingMsg); setUserView('login');
  };

  const submitNewPassword = (e) => {
    e.preventDefault();
    pub(`${NS}/users/update`, JSON.stringify({ action: 'set_password', code: userAuthForm.code, password: userAuthForm.password }));
    setLoggedInUser(userAuthForm.code); localStorage.setItem('miloLoggedIn', userAuthForm.code);
    setSessionPassword(userAuthForm.password);
    setUserView('login'); setUserAuthForm(prev => ({ ...prev, password: '' }));
  };

  const submitFeedback = (e) => {
    e.preventDefault();
    const pw = sessionPassword || feedbackConfirmPass;
    if (!feedbackText.trim() || !loggedInUser || !pw) return;
    pub(`${NS}/feedback/submit`, JSON.stringify({ code: loggedInUser, message: feedbackText, user_password: pw }));
    setFeedbackText(''); setFeedbackConfirmPass(''); setFeedbackMsg(t.feedbackSent);
    setTimeout(() => setFeedbackMsg(''), 3000);
  };

  const submitProfileEdit = (e) => {
    e.preventDefault();
    const pw = sessionPassword || editProfileForm.confirmPass;
    if (!loggedInUser || !pw) return;
    pub(`${NS}/profile_edit/submit`, JSON.stringify({ code: loggedInUser, name: editProfileForm.name, department: editProfileForm.department, user_password: pw }));
    setIsEditingProfile(false); setEditProfileForm({ name: '', department: '', confirmPass: '' });
  };

  // --- Rewards ---
  const openRedeem = (reward) => {
    if (!loggedInUser) { setActiveTab('userHub'); showToast(t.promptLogin, 'err'); return; }
    setRedeemModal({ reward, pass: '', pending: false });
  };

  const confirmRedeem = () => {
    const rm = redeemModal;
    if (!rm) return;
    const pw = sessionPassword || rm.pass;
    if (!pw) return;
    const timeoutId = setTimeout(() => {
      if (pendingRedeemRef.current) {
        pendingRedeemRef.current = null;
        setRedeemModal(null);
        showToast(t.timeoutErr, 'err');
      }
    }, 6000);
    pendingRedeemRef.current = { rewardId: rm.reward.id, timeoutId };
    setRedeemModal({ ...rm, pending: true });
    pub(`${NS}/rewards/redeem`, JSON.stringify({
      code: loggedInUser, user_password: pw, reward_id: rm.reward.id, client_id: clientIdRef.current
    }));
  };

  const submitNewReward = (e) => {
    e.preventDefault();
    const cost = parseInt(rewardForm.cost, 10);
    const stock = parseInt(rewardForm.stock, 10);
    if (!rewardForm.title || !Number.isFinite(cost) || cost <= 0) return;
    pub(`${NS}/rewards/manage`, JSON.stringify({
      action: 'add', title: rewardForm.title, title_bg: rewardForm.title_bg,
      cost, stock: Number.isFinite(stock) ? stock : -1, icon: rewardForm.icon || '🎁',
      description: rewardForm.description, description_bg: rewardForm.description_bg,
      admin_token: adminToken
    }));
    setRewardForm({ title: '', title_bg: '', cost: '', stock: '-1', icon: '🎁', description: '', description_bg: '' });
  };

  // --- Web Push ---
  const enableNotifications = async () => {
    if (pushState === 'unsupported' || pushState === 'denied') return;
    if (!sessionPassword) { showToast(t.notifNeedPass, 'err'); return; }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setPushState('denied'); return; }
      // Don't hang forever if the SW failed to install on this browser.
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error('service worker not ready')), 5000)),
      ]);
      // Reuse an existing subscription (re-registering it server-side is a
      // harmless INSERT OR REPLACE and re-links it to this account).
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      pub(`${NS}/notifications/subscribe`, JSON.stringify({
        code: loggedInUser, user_password: sessionPassword, subscription: sub.toJSON()
      }));
      setPushState('on');
      showToast(t.notifOn, 'ok');
    } catch (err) {
      console.error('Push subscribe failed', err);
      showToast(`${t.notifUnsupported} (${err && err.message ? err.message : err})`, 'err');
    }
  };

  // --- GDPR ---
  const runGdpr = () => {
    const gm = gdprModal;
    if (!gm) return;
    const pw = sessionPassword || gm.pass;
    if (!pw) return;
    const topic = gm.mode === 'export' ? 'privacy/export' : 'privacy/delete';
    const timeoutId = setTimeout(() => {
      if (pendingGdprRef.current) {
        pendingGdprRef.current = null;
        setGdprModal(null);
        showToast(t.timeoutErr, 'err');
      }
    }, 8000);
    pendingGdprRef.current = { mode: gm.mode, timeoutId };
    setGdprModal({ ...gm, busy: true });
    pub(`${NS}/${topic}`, JSON.stringify({
      code: loggedInUser, user_password: pw, client_id: clientIdRef.current
    }));
  };

  // --- Maintenance mode ---
  const setMachineMaint = (enabled) => {
    pub(`${NS}/maintenance/mode`, JSON.stringify({ enabled, admin_token: adminToken, client_id: clientIdRef.current }));
    setMaintMode(enabled);
    if (enabled) setFanStates([true, true]); // firmware defaults both fans ON in maintenance
    if (!enabled) { setAutoRefresh(false); setSnapshot(null); }
  };

  const toggleFan = (idx) => {
    const next = [...fanStates];
    next[idx] = !next[idx];
    setFanStates(next);
    pub(`${NS}/maintenance/fan`, JSON.stringify({ fan: idx + 1, on: next[idx], admin_token: adminToken, client_id: clientIdRef.current }));
  };

  const requestSnapshot = () => {
    if (pendingSnapRef.current) return; // one in flight at a time
    setSnapshotPending(true);
    pendingSnapRef.current = setTimeout(() => {
      pendingSnapRef.current = null;
      setSnapshotPending(false);
      setSnapshot({ error: 'timeout' });
    }, 8000);
    pub(`${NS}/maintenance/snapshot`, JSON.stringify({ admin_token: adminToken, client_id: clientIdRef.current }));
  };
  requestSnapshotRef.current = requestSnapshot;

  const jog = (steps) => {
    pub(`${NS}/maintenance/jog`, JSON.stringify({ motor: jogMotor, steps, admin_token: adminToken, client_id: clientIdRef.current }));
  };

  // Auto-refresh the inference view every 3s while enabled (pseudo-live feed).
  useEffect(() => {
    if (!maintMode || !autoRefresh) return;
    const id = setInterval(() => requestSnapshotRef.current?.(), 3000);
    return () => clearInterval(id);
  }, [maintMode, autoRefresh]);

  // Leaving the admin tab or logging out ends maintenance so the machine
  // display returns to normal (the backend watchdog is the fallback).
  useEffect(() => {
    if (maintMode && (activeTab !== 'admin' || !isAdminAuthenticated)) {
      if (adminToken) {
        pub(`${NS}/maintenance/mode`, JSON.stringify({ enabled: false, admin_token: adminToken, client_id: clientIdRef.current }));
      }
      setMaintMode(false); setAutoRefresh(false);
    }
  }, [activeTab, isAdminAuthenticated, maintMode, adminToken]);

  // --- Admin secure actions ---
  const executeConfirmedAction = () => {
    if (!confirmAction || !adminToken) return;
    if (confirmAction.type === 'delete') {
      pub(`${NS}/users/update`, JSON.stringify({ action: 'delete', code: confirmAction.code, admin_token: adminToken }));
    } else if (confirmAction.type === 'clear') {
      pub(`${NS}/transactions/delete`, JSON.stringify({ code: confirmAction.code, admin_token: adminToken }));
    } else if (confirmAction.type === 'reset_pass') {
      const clientId = clientIdRef.current;
      const name = confirmAction.name;
      const timeoutId = setTimeout(() => {
        if (pendingResetRef.current) { pendingResetRef.current = null; setResetFlow({ status: 'error', name }); }
      }, 6000);
      pendingResetRef.current = { code: confirmAction.code, name, timeoutId };
      setResetFlow({ status: 'pending', name });
      pub(`${NS}/users/update`, JSON.stringify({ action: 'set_password_admin', code: confirmAction.code, admin_token: adminToken, client_id: clientId }));
    } else if (confirmAction.type === 'delete_admin') {
      pub(`${NS}/admin/mgt`, JSON.stringify({ action: 'delete', username: confirmAction.code, admin_token: adminToken, client_id: clientIdRef.current }));
    } else if (confirmAction.type === 'delete_reward') {
      pub(`${NS}/rewards/manage`, JSON.stringify({ action: 'delete', reward_id: confirmAction.rewardId, admin_token: adminToken }));
    }
  };

  const handleAdminSave = (e) => {
    e.preventDefault();
    if (!adminForm.code || !adminForm.name) return;
    pub(`${NS}/users/update`, JSON.stringify({ action: 'set', code: adminForm.code, name: adminForm.name, department: adminForm.department, admin_token: adminToken }));
    setAdminMessage(`${adminForm.name} saved!`);
    setAdminForm({ code: '', name: '', department: '' });
    setTimeout(() => setAdminMessage(''), 3000);
  };

  const submitNewAdmin = (e) => {
    e.preventDefault();
    if (!newAdminForm.username || !newAdminForm.password) return;
    pub(`${NS}/admin/mgt`, JSON.stringify({ action: 'add', username: newAdminForm.username, password: newAdminForm.password, role: newAdminForm.role, admin_token: adminToken, client_id: clientIdRef.current }));
    setNewAdminForm({ username: '', password: '', role: 'org' });
  };

  const resolveRedemption = (id, action) => {
    pub(`${NS}/redemptions/resolve`, JSON.stringify({ id, action, admin_token: adminToken }));
  };

  const logoutUser = () => {
    setLoggedInUser(null);
    setSessionPassword('');
    localStorage.removeItem('miloLoggedIn');
    setUserAuthForm({ code: '', password: '', name: '', department: '', consent: false });
    setUserView('login');
  };

  const exportCSV = () => {
    const header = `Timestamp,User Code,Display Name,${deptLabel},Material,Points\n`;
    const rows = safeTransactions.map(tx => {
      const uData = safeUsers[tx.user_code] || {};
      return `"${parseTimestamp(tx.timestamp).toLocaleString()}",${tx.user_code},"${uData.name || 'Unnamed'}","${uData.department || ''}",${tx.material},${tx.points}`;
    }).join("\n");
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'milo_transactions.csv'; a.click();
    window.URL.revokeObjectURL(url);
  };

  const nodeStatus = connectionState === 'online'
    ? { icon: 'text-emerald-500', ping: 'bg-emerald-400', dot: 'bg-emerald-500', label: t.online, sub: t.connectedPi }
    : connectionState === 'connecting'
      ? { icon: 'text-amber-500', ping: 'bg-amber-400', dot: 'bg-amber-500', label: t.connecting, sub: t.connecting }
      : { icon: 'text-rose-500', ping: 'bg-rose-400', dot: 'bg-rose-500', label: t.offline, sub: t.disconnected };

  // ==========================================
  // RENDER HELPERS
  // ==========================================
  const renderPopup = () => {
    if (!activePopup) return null;
    const uName = safeUsers[activePopup.user_code]?.name || t.unnamedUser;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" role="status" aria-live="polite">
        {th.confetti && <Confetti count={orgType === 'school' ? 60 : 25} />}
        <div className={`bg-white dark:bg-slate-800 ${th.card} shadow-2xl p-8 max-w-sm w-full text-center border-4 ${orgType === 'school' ? 'border-violet-500' : orgType === 'city' ? 'border-emerald-600' : 'border-indigo-500'} transform transition-all animate-bounce-in`}>
          <div className={`mx-auto w-20 h-20 ${th.accentSoft} ${th.chip} flex items-center justify-center mb-6`}><Trophy className="w-10 h-10" /></div>
          <h2 className="text-2xl font-black text-slate-800 dark:text-white mb-2">{t.congrats}</h2>
          <p className="text-slate-600 dark:text-slate-300 text-lg mb-6"><span className={`font-bold ${th.accentText}`}>{uName}</span> {t.recycled} <span className="font-bold capitalize">{activePopup.material}</span>!</p>
          <div className={`bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 font-black text-3xl py-4 ${th.card}`}>+{activePopup.points} {t.points}</div>
        </div>
      </div>
    );
  };

  const statusChip = (status) => {
    const map = {
      pending: ['bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400', t.stPending],
      fulfilled: ['bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400', t.stFulfilled],
      rejected: ['bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400', t.stRejected],
    };
    const [cls, label] = map[status] || map.pending;
    return <span className={`text-[10px] uppercase font-bold px-2 py-1 ${th.chip} ${cls}`}>{label}</span>;
  };

  return (
    <div lang={lang} className={isDarkMode ? 'dark' : ''}>
      <div className="min-h-screen bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-sans selection:bg-indigo-200 dark:selection:bg-indigo-900 transition-colors duration-300">

        {/* Toast */}
        {toast && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] animate-slide-up" role="status" aria-live="polite">
            <div className={`px-5 py-3 ${th.card} shadow-xl font-semibold text-sm flex items-center gap-2 ${toast.type === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
              {toast.type === 'ok' ? <Check size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />} {toast.msg}
            </div>
          </div>
        )}

        {/* Achievement unlocked modal */}
        {newAchievementQueue.length > 0 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true">
            {th.confetti && <Confetti count={orgType === 'school' ? 60 : 25} />}
            <div className={`bg-white dark:bg-slate-800 ${th.card} shadow-2xl p-8 max-w-sm w-full text-center border-4 ${orgType === 'school' ? 'border-violet-500' : orgType === 'city' ? 'border-emerald-600' : 'border-indigo-500'} transform transition-all animate-bounce-in z-50 relative`}>
              <div className={`mx-auto w-24 h-24 ${th.accentSoft} ${th.chip} flex items-center justify-center mb-6`}>
                {React.createElement(newAchievementQueue[0].icon, { className: newAchievementQueue[0].color, size: 48 })}
              </div>
              <h2 className="text-3xl font-black text-slate-800 dark:text-white mb-2">{t.unlockedNew}</h2>
              <p className={`${th.accentText} font-bold text-xl mb-6`}>{newAchievementQueue[0].title}</p>
              <button type="button" onClick={() => setNewAchievementQueue(prev => prev.slice(1))} className={`w-full ${btnPrimary} py-4 shadow-sm text-lg`}>{t.awesome}</button>
            </div>
          </div>
        )}

        {/* Achievement detail modal */}
        {selectedAchievement && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in p-4" role="dialog" aria-modal="true">
            <div className={`bg-white dark:bg-slate-800 ${th.card} p-6 md:p-8 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-700 animate-scale-in text-center`}>
              <div className={`mx-auto w-20 h-20 bg-slate-100 dark:bg-slate-700 ${th.chip} flex items-center justify-center mb-4`}>
                {React.createElement(selectedAchievement.icon, { className: selectedAchievement.cur >= selectedAchievement.req ? selectedAchievement.color : 'text-slate-400', size: 40 })}
              </div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-2xl mb-2">{selectedAchievement.title}</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 px-2">{selectedAchievement.desc}</p>
              <div className="mb-6 text-left">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-xs font-bold uppercase text-slate-400">{t.progress}</span>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{selectedAchievement.cur} / {selectedAchievement.req}</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-4 overflow-hidden relative">
                  <div className={`${orgType === 'city' ? 'bg-emerald-600' : orgType === 'school' ? 'bg-violet-500' : 'bg-indigo-500'} h-4 rounded-full transition-all duration-1000 ease-out absolute left-0 top-0`} style={{ width: `${Math.min(100, (selectedAchievement.cur / selectedAchievement.req) * 100)}%` }}></div>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedAchievement(null)} className={`w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold py-3 ${th.btnShape} transition-colors`}>{t.close}</button>
            </div>
          </div>
        )}

        {/* Password reset flow modal */}
        {resetFlow && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in p-4" role="dialog" aria-modal="true">
            <div className={`bg-white dark:bg-slate-800 ${th.card} p-6 md:p-8 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-700 animate-scale-in text-center`}>
              {resetFlow.status === 'pending' && (
                <>
                  <div className={`mx-auto w-16 h-16 ${th.accentSoft} ${th.chip} flex items-center justify-center mb-4`}><Loader2 size={32} className="animate-spin" /></div>
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xl mb-2">{t.resetPassTitle}</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm">{t.generatingPass}</p>
                </>
              )}
              {resetFlow.status === 'done' && (
                <>
                  <div className={`mx-auto w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 ${th.chip} flex items-center justify-center mb-4`}><CheckCircle2 size={32} /></div>
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xl mb-2">{t.resetPassTitle}</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">{t.newPassMsg} <strong className="text-slate-800 dark:text-slate-200">{resetFlow.name}</strong></p>
                  <div className={`bg-slate-100 dark:bg-slate-900 ${th.input} p-4 mb-6 select-all font-mono text-2xl tracking-widest ${th.accentText} font-black border border-slate-200 dark:border-slate-700 break-all`}>{resetFlow.password}</div>
                  <button type="button" onClick={() => { navigator.clipboard.writeText(resetFlow.password).catch(() => {}); setResetFlow(null); }} className={`w-full ${btnPrimary} py-3 shadow-sm`}>{t.copyClose}</button>
                </>
              )}
              {resetFlow.status === 'error' && (
                <>
                  <div className={`mx-auto w-16 h-16 bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 ${th.chip} flex items-center justify-center mb-4`}><AlertTriangle size={32} /></div>
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xl mb-2">{t.resetPassTitle}</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 px-2">{t.resetTimeout}</p>
                  <button type="button" onClick={() => setResetFlow(null)} className={`w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold py-3 ${th.btnShape} transition-colors`}>{t.close}</button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Redeem confirmation modal */}
        {redeemModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in p-4" role="dialog" aria-modal="true">
            <div className={`bg-white dark:bg-slate-800 ${th.card} p-6 md:p-8 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-700 animate-scale-in text-center`}>
              <div className="text-5xl mb-4" aria-hidden="true">{redeemModal.reward.icon || '🎁'}</div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xl mb-2">{t.redeemConfirmTitle}</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-2">{lang === 'bg' && redeemModal.reward.title_bg ? redeemModal.reward.title_bg : redeemModal.reward.title}</p>
              <p className={`font-black text-2xl mb-4 ${th.accentText}`}>-{redeemModal.reward.cost} {t.points}</p>
              <p className="text-slate-500 dark:text-slate-400 text-xs mb-6">{t.redeemConfirmMsg}</p>
              {!sessionPassword && (
                <input type="password" required maxLength={128} placeholder={t.confirmPass} aria-label={t.confirmPass}
                       className={`${inputCls} mb-4 text-center`} value={redeemModal.pass}
                       onChange={e => setRedeemModal({ ...redeemModal, pass: e.target.value })} />
              )}
              <div className="flex gap-3">
                <button type="button" onClick={() => setRedeemModal(null)} disabled={redeemModal.pending} className={`flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold py-3 ${th.btnShape} transition-colors disabled:opacity-50`}>{t.confirmNo}</button>
                <button type="button" onClick={confirmRedeem} disabled={redeemModal.pending || (!sessionPassword && !redeemModal.pass)} className={`flex-1 ${btnPrimary} py-3 shadow-sm disabled:opacity-60 flex items-center justify-center gap-2`}>
                  {redeemModal.pending ? <Loader2 size={16} className="animate-spin" /> : <Gift size={16} aria-hidden="true" />} {t.redeemBtn}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* GDPR modal */}
        {gdprModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in p-4" role="dialog" aria-modal="true">
            <div className={`bg-white dark:bg-slate-800 ${th.card} p-6 md:p-8 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-700 animate-scale-in text-center`}>
              <div className={`mx-auto w-16 h-16 ${gdprModal.mode === 'delete' ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400' : th.accentSoft} ${th.chip} flex items-center justify-center mb-4`}>
                {gdprModal.mode === 'delete' ? <UserX size={30} /> : <FileDown size={30} />}
              </div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xl mb-2">{gdprModal.mode === 'delete' ? t.deleteAccount : t.downloadData}</h3>
              {gdprModal.mode === 'delete' && <p className="text-rose-500 text-sm font-semibold mb-4 px-2">{t.deleteWarn}</p>}
              {!sessionPassword && (
                <input type="password" required maxLength={128} placeholder={t.confirmPass} aria-label={t.confirmPass}
                       className={`${inputCls} mb-4 text-center`} value={gdprModal.pass}
                       onChange={e => setGdprModal({ ...gdprModal, pass: e.target.value })} />
              )}
              <div className="flex gap-3">
                <button type="button" onClick={() => setGdprModal(null)} disabled={gdprModal.busy} className={`flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold py-3 ${th.btnShape} transition-colors disabled:opacity-50`}>{t.confirmNo}</button>
                <button type="button" onClick={runGdpr} disabled={gdprModal.busy || (!sessionPassword && !gdprModal.pass)} className={`flex-1 font-bold py-3 ${th.btnShape} shadow-sm text-white transition-colors disabled:opacity-60 flex items-center justify-center gap-2 ${gdprModal.mode === 'delete' ? 'bg-rose-600 hover:bg-rose-700' : th.accentBtn}`}>
                  {gdprModal.busy ? <Loader2 size={16} className="animate-spin" /> : null} {t.confirmYes}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Environmental impact detail modal */}
        {impactModal && (() => {
          const meta = {
            co2: { label: t.co2Saved, unit: 'kg', factor: 'co2', icon: Cloud, eqIcon: Car, eq: (v) => `${Math.round(v * EQUIV.kmPerKgCo2)} ${t.eqKm}` },
            water: { label: t.waterSaved, unit: 'L', factor: 'water', icon: Droplets, eqIcon: ShowerHead, eq: (v) => `${Math.round(v * EQUIV.showersPerL)} ${t.eqShowers}` },
            energy: { label: t.energySaved, unit: 'kWh', factor: 'energy', icon: Zap, eqIcon: BatteryCharging, eq: (v) => `${Math.round(v * EQUIV.chargesPerKwh)} ${t.eqCharges}` },
          }[impactModal.metric];
          const rows = Object.entries(impactModal.matCounts || {}).filter(([m, n]) => n > 0 && IMPACT[m]);
          const total = rows.reduce((s, [m, n]) => s + IMPACT[m][meta.factor] * n, 0);
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in p-4" role="dialog" aria-modal="true">
              <div className={`bg-white dark:bg-slate-800 ${th.card} p-6 md:p-8 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-700 animate-scale-in`}>
                <div className={`mx-auto w-16 h-16 ${th.accentSoft} ${th.chip} flex items-center justify-center mb-4`}>{React.createElement(meta.icon, { size: 30, 'aria-hidden': true })}</div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xl mb-1 text-center">{meta.label}</h3>
                <p className={`text-center font-black text-3xl mb-1 ${th.accentText}`}>{total.toFixed(1)} {meta.unit}</p>
                <p className="text-center text-xs text-slate-400 mb-5 flex items-center justify-center gap-1">{React.createElement(meta.eqIcon, { size: 12, 'aria-hidden': true })} ≈ {meta.eq(total)}</p>
                <p className="text-xs font-bold uppercase text-slate-400 mb-2">{t.impactBreakdown}</p>
                <div className="space-y-2 mb-4">
                  {rows.map(([m, n]) => (
                    <div key={m} className={`flex justify-between items-center gap-2 text-sm bg-slate-50 dark:bg-slate-900 ${th.chip} px-3 py-2`}>
                      <span className="capitalize font-semibold text-slate-700 dark:text-slate-200 shrink-0">{m} × {n}</span>
                      <span className="text-slate-500 dark:text-slate-400 text-right text-xs">{IMPACT[m][meta.factor].toFixed(2)} {meta.unit} {t.impactPerItem} = <strong className={th.accentText}>{(IMPACT[m][meta.factor] * n).toFixed(1)} {meta.unit}</strong></span>
                    </div>
                  ))}
                  {rows.length === 0 && <p className="text-sm text-slate-400 text-center">{t.dbEmpty}</p>}
                </div>
                <p className="text-[11px] text-slate-400 mb-5">{t.impactDisclaimer}</p>
                <button type="button" onClick={() => setImpactModal(null)} className={`w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold py-3 ${th.btnShape} transition-colors`}>{t.close}</button>
              </div>
            </div>
          );
        })()}

        {/* Reward description modal */}
        {rewardInfoModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in p-4" role="dialog" aria-modal="true">
            <div className={`bg-white dark:bg-slate-800 ${th.card} p-6 md:p-8 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-700 animate-scale-in text-center`}>
              <div className="text-6xl mb-3" aria-hidden="true">{rewardInfoModal.icon || '🎁'}</div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xl mb-1">{lang === 'bg' && rewardInfoModal.title_bg ? rewardInfoModal.title_bg : rewardInfoModal.title}</h3>
              <p className={`font-black text-2xl mb-4 ${th.accentText}`}>{rewardInfoModal.cost} {t.points.toLowerCase()}</p>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-6 whitespace-pre-wrap text-left">{lang === 'bg' ? (rewardInfoModal.description_bg || rewardInfoModal.description) : rewardInfoModal.description}</p>
              <button type="button" onClick={() => setRewardInfoModal(null)} className={`w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold py-3 ${th.btnShape} transition-colors`}>{t.close}</button>
            </div>
          </div>
        )}

        {/* Generic confirm modal */}
        {confirmAction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in p-4" role="dialog" aria-modal="true">
            <div className={`bg-white dark:bg-slate-800 ${th.card} p-6 md:p-8 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-700 animate-scale-in text-center`}>
              <div className={`mx-auto w-16 h-16 ${th.chip} flex items-center justify-center mb-4 ${confirmAction.type === 'reset_pass' ? th.accentSoft : 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'}`}>
                {confirmAction.type === 'reset_pass' ? <Key size={32} /> : <AlertTriangle size={32} />}
              </div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xl mb-2">{t.confirmAction}</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-8 px-2">
                {confirmAction.type === 'delete' ? t.confirmDelete : (confirmAction.type === 'clear' ? t.confirmClear : (confirmAction.type === 'delete_admin' ? t.deleteAdminConfirm : (confirmAction.type === 'delete_reward' ? t.confirmDeleteReward : t.confirmReset)))}
                <br /><strong className="mt-2 block text-slate-700 dark:text-slate-300">{confirmAction.name}</strong>
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setConfirmAction(null)} className={`flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold py-3 ${th.btnShape} transition-colors`}>{t.confirmNo}</button>
                <button type="button" onClick={() => { executeConfirmedAction(); setConfirmAction(null); }} className={`flex-1 text-white font-bold py-3 ${th.btnShape} shadow-sm transition-colors ${confirmAction.type === 'reset_pass' ? th.accentBtn : 'bg-rose-600 hover:bg-rose-700'}`}>{t.confirmYes}</button>
              </div>
            </div>
          </div>
        )}

        {/* Top Header */}
        <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-20 transition-colors duration-300">
          <div className="max-w-6xl mx-auto px-4 h-16 md:h-20 flex items-center justify-between">
            <button type="button" className="flex items-center gap-3 cursor-pointer text-left" onClick={() => setActiveTab('leaderboard')} aria-label="MILO home">
              <div className={`w-10 h-10 md:w-12 md:h-12 bg-white ${th.chip} border border-slate-200 dark:border-slate-600 flex items-center justify-center shadow-md p-1.5`}>
                <MascotLogo className="w-full h-full object-contain" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-black text-slate-800 dark:text-white tracking-tight leading-none">MILO</h1>
                <p className={`text-[9px] md:text-[10px] font-bold tracking-widest uppercase ${th.accentText}`}>{t.appTitle}</p>
              </div>
            </button>

            <div className="flex items-center gap-2 md:gap-4">
              {installPrompt && (
                <button type="button" aria-label={t.installApp}
                        onClick={async () => { installPrompt.prompt(); try { await installPrompt.userChoice; } catch {} setInstallPrompt(null); }}
                        className={`flex items-center gap-1.5 ${th.accentBtn} ${th.chip} px-3 py-2 text-xs font-bold shadow-sm`}>
                  <Download size={14} aria-hidden="true" /> <span className="hidden md:inline">{t.installApp}</span>
                </button>
              )}
              <div className={`flex gap-1 bg-slate-100 dark:bg-slate-700 ${th.chip} p-1`}>
                <button type="button" onClick={toggleLang} aria-label={t.switchLang} className={`px-3 py-1.5 ${th.chip} text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-600 transition-colors flex items-center gap-1`}>
                  <Globe size={14} aria-hidden="true" /> {lang.toUpperCase()}
                </button>
                <button type="button" onClick={toggleTheme} aria-label={t.switchTheme} aria-pressed={isDarkMode} className={`p-1.5 ${th.chip} text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-600 transition-colors`}>
                  {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
                </button>
              </div>
              <nav className={`hidden sm:flex gap-1 bg-slate-100 dark:bg-slate-900 p-1 ${th.chip}`}>
                {[['leaderboard', t.dashboard], ['rewards', t.rewardsTab], ['userHub', t.userHub], ...(isAdminAuthenticated ? [['admin', t.admin]] : []), ['about', t.about]].map(([tab, label]) => (
                  <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`px-4 py-2 ${th.chip} text-sm font-bold transition-all ${activeTab === tab ? `bg-white dark:bg-slate-700 shadow-sm ${th.accentText}` : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}>{label}</button>
                ))}
              </nav>
            </div>
          </div>
        </header>

        <main className={`max-w-6xl mx-auto px-4 py-6 md:py-8`}>

          {/* TAB: ABOUT */}
          {activeTab === 'about' && (
            <div className={`${th.sectionGap} animate-fade-in pb-24 md:pb-0`}>
              <div className={`text-center py-12 px-4 ${cardCls}`}>
                <div className={`mx-auto w-40 md:w-48 bg-white ${th.card} border border-slate-200 dark:border-slate-600 p-5 mb-6 shadow-sm`}>
                  <img src="/milo_logo_full.png" alt="MILO beta" className="w-full h-auto" draggable="false" />
                </div>
                <p className="text-lg text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">{t.aboutHero}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className={`${cardCls} ${th.cardPad} text-center`}>
                  <Leaf className="w-12 h-12 text-emerald-500 mx-auto mb-4" aria-hidden="true" />
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-3">{t.ourMission}</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">{t.missionDesc}</p>
                </div>
                <div className={`${cardCls} ${th.cardPad} text-center`}>
                  <Globe2 className="w-12 h-12 text-blue-500 mx-auto mb-4" aria-hidden="true" />
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-3">{t.ourVision}</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">{t.visionDesc}</p>
                </div>
                <div className={`${cardCls} ${th.cardPad} text-center`}>
                  <Users className="w-12 h-12 text-amber-500 mx-auto mb-4" aria-hidden="true" />
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-3">{t.team}</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">{t.teamDesc}</p>
                </div>
              </div>
            </div>
          )}

          {/* TAB: LEADERBOARD */}
          {activeTab === 'leaderboard' && (
            <div className={`${th.sectionGap} animate-fade-in pb-24 md:pb-0 relative`}>
              {renderPopup()}

              {/* Season toggle + countdown */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className={`flex gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-1 ${th.chip} shadow-sm`} role="tablist" aria-label={t.leaderboard}>
                  <button type="button" role="tab" aria-selected={seasonView === 'week'} onClick={() => setSeasonView('week')} className={`px-4 py-2 ${th.chip} text-sm font-bold transition-all ${seasonView === 'week' ? `${th.accentSoft}` : 'text-slate-500 dark:text-slate-400'}`}>{t.seasonWeek}</button>
                  <button type="button" role="tab" aria-selected={seasonView === 'all'} onClick={() => setSeasonView('all')} className={`px-4 py-2 ${th.chip} text-sm font-bold transition-all ${seasonView === 'all' ? `${th.accentSoft}` : 'text-slate-500 dark:text-slate-400'}`}>{t.seasonAll}</button>
                </div>
                {seasonView === 'week' && (
                  <div className={`flex items-center gap-2 text-sm font-bold ${th.accentText} bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-2 ${th.chip} shadow-sm`}>
                    <Timer size={16} aria-hidden="true" /> {t.resetsIn} {resetCountdown}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className={`${th.heroGrad} ${th.card} p-6 text-white shadow-lg relative overflow-hidden`}>
                  <div className="absolute top-0 right-0 p-4 opacity-20">
                    {th.mascot ? <MascotLogo className="w-24 h-24 object-contain" /> : <Trash2 size={80} aria-hidden="true" />}
                  </div>
                  <div className="relative z-10">
                    <h3 className="font-semibold text-white/80 text-sm md:text-base">{t.topMaterial}</h3>
                    <p className="text-3xl md:text-4xl font-bold mt-2 capitalize">{mostRecycled}</p>
                    <p className="text-xs md:text-sm text-white/70 mt-1">{materialsCount[mostRecycled] || 0} {t.itemsProcessed}</p>
                  </div>
                </div>
                <div className={`${cardCls} p-6`}>
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-slate-500 dark:text-slate-400 text-sm md:text-base">{t.totalParticipants}</h3>
                    <Users size={24} className="text-blue-500" aria-hidden="true" />
                  </div>
                  <p className="text-3xl md:text-4xl font-bold mt-2">{totalParticipants}</p>
                  <p className="text-xs md:text-sm text-slate-400 mt-1">{t.activeUsers}</p>
                </div>
                <div className={`${cardCls} p-6`}>
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-slate-500 dark:text-slate-400 text-sm md:text-base">{t.nodeStatus}</h3>
                    <Activity size={24} className={nodeStatus.icon} aria-hidden="true" />
                  </div>
                  <p className="text-xl md:text-2xl font-bold mt-2 flex items-center gap-2" role="status" aria-live="polite">
                    <span className="relative flex h-3 w-3 md:h-4 md:w-4">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${nodeStatus.ping}`}></span>
                      <span className={`relative inline-flex rounded-full h-3 w-3 md:h-4 md:w-4 ${nodeStatus.dot}`}></span>
                    </span>
                    {nodeStatus.label}
                  </p>
                  <p className="text-xs md:text-sm text-slate-400 mt-1">{nodeStatus.sub}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className={`lg:col-span-2 ${cardCls} overflow-hidden`}>
                  <div className={`${th.cardPad} border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center`}>
                    <h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                      <Trophy className="text-amber-500" aria-hidden="true" /> {t.leaderboard} · {seasonView === 'week' ? t.seasonWeek : t.seasonAll}
                    </h2>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-700/50 relative">
                    {board.map((userStats, index) => {
                      const userInfo = safeUsers[userStats.code] || { name: t.unnamedUser, department: `ID: ${userStats.code}` };
                      const isHighlighted = highlightedUser === userStats.code;
                      let rankColor = "text-slate-400 dark:text-slate-500";
                      let RankIcon = () => <span className="text-lg font-bold w-6 text-center">{index + 1}</span>;
                      if (index === 0) { rankColor = "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"; RankIcon = () => <Award size={24} />; }
                      if (index === 1) { rankColor = "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"; RankIcon = () => <Award size={24} />; }
                      if (index === 2) { rankColor = "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"; RankIcon = () => <Award size={24} />; }
                      return (
                        <div key={userStats.code} className={`${th.dense ? 'p-3 md:p-4' : 'p-4 md:p-6'} flex flex-col sm:flex-row sm:items-center justify-between transition-all duration-700 ease-in-out gap-4 ${isHighlighted ? 'bg-emerald-50 dark:bg-emerald-900/20 transform scale-[1.02] shadow-md z-10 relative border-l-4 border-emerald-500' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30 border-l-4 border-transparent'}`}>
                          <div className="flex items-center gap-4">
                            <div className={`shrink-0 w-10 h-10 md:w-12 md:h-12 ${th.chip} flex items-center justify-center font-bold ${rankColor} shadow-sm transition-transform duration-500 ${isHighlighted ? 'scale-110' : ''}`}><RankIcon /></div>
                            <div>
                              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base md:text-lg flex items-center gap-2 flex-wrap">
                                {userInfo.name} {!safeUsers[userStats.code] && <span className={`text-[10px] uppercase bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 px-2 py-1 ${th.chip} shrink-0`}>{t.new}</span>}
                              </h3>
                              <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">{userInfo.department}</p>
                            </div>
                          </div>
                          <div className="sm:text-right flex sm:block items-end justify-between sm:justify-end pl-14 sm:pl-0">
                            <p className="text-xs text-slate-400 uppercase font-semibold sm:hidden mb-1">{t.points}</p>
                            <div>
                              <p className={`text-2xl font-black leading-none transition-colors duration-500 ${isHighlighted ? 'text-emerald-600 dark:text-emerald-400' : th.accentText}`}><AnimatedNumber value={userStats.totalPoints} /></p>
                              <p className="text-[10px] md:text-xs text-slate-400 uppercase font-semibold hidden sm:block mt-1">{t.points}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {board.length === 0 && <div className="p-12 text-center text-slate-400"><Clock size={40} className="mb-4 opacity-50 mx-auto" aria-hidden="true" /><p>{t.awaitingTx}</p></div>}
                  </div>
                </div>

                <div className="space-y-6">
                  {/* Team standings */}
                  <div className={`${cardCls} overflow-hidden h-fit`}>
                    <div className={`${th.dense ? 'p-4' : 'p-4 md:p-5'} border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50`}>
                      <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Flag size={18} className={th.accentText} aria-hidden="true" /> {t.teamStandings} · {teamsLabel}</h2>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                      {teamBoard.map((team, i) => (
                        <div key={team.name} className={`${th.dense ? 'p-3' : 'p-4'} flex items-center justify-between gap-3`}>
                          <div className="flex items-center gap-3 min-w-0">
                            <span className={`shrink-0 w-8 h-8 ${th.chip} ${i === 0 ? th.accentSoft : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'} flex items-center justify-center text-sm font-black`}>{i + 1}</span>
                            <div className="min-w-0">
                              <p className="font-bold text-slate-800 dark:text-slate-100 truncate">{team.name}</p>
                              <p className="text-[11px] text-slate-400">{team.members} {t.membersShort} · {team.items} {t.itemsProcessed}</p>
                            </div>
                          </div>
                          <p className={`font-black ${th.accentText}`}>{team.points}</p>
                        </div>
                      ))}
                      {teamBoard.length === 0 && <p className="p-6 text-sm text-slate-400 text-center">{t.dbEmpty}</p>}
                    </div>
                  </div>

                  {/* Activity feed */}
                  <div className={`${cardCls} overflow-hidden h-fit`}>
                    <div className={`${th.dense ? 'p-4' : 'p-4 md:p-5'} border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center`}>
                      <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Activity size={18} className={th.accentText} aria-hidden="true" /> {t.activityFeed}</h2>
                    </div>
                    <div className={`${th.dense ? 'p-4 space-y-3' : 'p-4 md:p-5 space-y-4'}`}>
                      {safeTransactions.slice(0, 6).map(tx => {
                        const uName = safeUsers[tx.user_code]?.name || `ID: ${tx.user_code}`;
                        const timeString = parseTimestamp(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        return (
                          <div key={tx.id} className="flex items-start gap-3 animate-slide-up text-sm">
                            <div className={`${th.accentSoft} p-2 ${th.chip} mt-1 shrink-0`}><Zap size={14} aria-hidden="true" /></div>
                            <div className="flex-1 min-w-0">
                              <p className="text-slate-800 dark:text-slate-200 break-words"><span className="font-bold truncate block sm:inline">{uName}</span> {t.recycled} <span className="font-medium capitalize">{tx.material}</span></p>
                              <div className="flex justify-between items-center mt-0.5">
                                <p className={`${th.accentText} font-semibold`}>+{tx.points} {t.points.toLowerCase()}</p>
                                <p className="text-[10px] text-slate-400">{timeString}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {safeTransactions.length === 0 && <p className="text-sm text-slate-400 text-center py-4">{t.noActivity}</p>}
                    </div>
                  </div>
                </div>
              </div>

              {/* Community environmental impact — below the leaderboard */}
              <div className={`${cardCls} ${th.cardPad}`}>
                <h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4"><Leaf className="text-emerald-500" aria-hidden="true" /> {t.communityImpact}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <button type="button" onClick={() => setImpactModal({ metric: 'co2', matCounts: scopeData('all').materials })} className={`text-left bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 ${th.card} p-4 hover:shadow-md hover:scale-[1.01] transition-all`}>
                    <p className="text-xs font-bold uppercase text-emerald-700 dark:text-emerald-400 flex items-center gap-1"><Cloud size={14} aria-hidden="true" /> {t.co2Saved}</p>
                    <p className="text-2xl font-black mt-1 text-emerald-800 dark:text-emerald-300">{communityImpact.co2.toFixed(1)} kg</p>
                    <p className="text-xs text-emerald-600/80 dark:text-emerald-500 mt-1 flex items-center gap-1"><Car size={12} aria-hidden="true" /> ≈ {Math.round(communityImpact.co2 * EQUIV.kmPerKgCo2)} {t.eqKm}</p>
                  </button>
                  <button type="button" onClick={() => setImpactModal({ metric: 'water', matCounts: scopeData('all').materials })} className={`text-left bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 ${th.card} p-4 hover:shadow-md hover:scale-[1.01] transition-all`}>
                    <p className="text-xs font-bold uppercase text-blue-700 dark:text-blue-400 flex items-center gap-1"><Droplets size={14} aria-hidden="true" /> {t.waterSaved}</p>
                    <p className="text-2xl font-black mt-1 text-blue-800 dark:text-blue-300">{communityImpact.water.toFixed(0)} L</p>
                    <p className="text-xs text-blue-600/80 dark:text-blue-500 mt-1 flex items-center gap-1"><ShowerHead size={12} aria-hidden="true" /> ≈ {Math.round(communityImpact.water * EQUIV.showersPerL)} {t.eqShowers}</p>
                  </button>
                  <button type="button" onClick={() => setImpactModal({ metric: 'energy', matCounts: scopeData('all').materials })} className={`text-left bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 ${th.card} p-4 hover:shadow-md hover:scale-[1.01] transition-all`}>
                    <p className="text-xs font-bold uppercase text-amber-700 dark:text-amber-400 flex items-center gap-1"><Zap size={14} aria-hidden="true" /> {t.energySaved}</p>
                    <p className="text-2xl font-black mt-1 text-amber-800 dark:text-amber-300">{communityImpact.energy.toFixed(1)} kWh</p>
                    <p className="text-xs text-amber-600/80 dark:text-amber-500 mt-1 flex items-center gap-1"><BatteryCharging size={12} aria-hidden="true" /> ≈ {Math.round(communityImpact.energy * EQUIV.chargesPerKwh)} {t.eqCharges}</p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB: REWARDS */}
          {activeTab === 'rewards' && (
            <div className={`${th.sectionGap} animate-fade-in pb-24 md:pb-0`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl md:text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                  <Gift className={th.accentText} aria-hidden="true" /> {t.rewardsTab}
                  {orgType === 'school' && <Sparkles size={20} className="text-amber-400" aria-hidden="true" />}
                </h2>
                {loggedInUser ? (
                  <div className={`flex items-center gap-2 font-black ${th.accentSoft} px-5 py-2.5 ${th.chip} shadow-sm`}>
                    <Star size={18} aria-hidden="true" /> {t.balanceLabel}: <AnimatedNumber value={myBalance} /> {t.points}
                  </div>
                ) : (
                  <button type="button" onClick={() => setActiveTab('userHub')} className={`text-sm font-bold ${th.accentText} hover:underline`}>{t.promptLogin}</button>
                )}
              </div>

              {rewards.filter(r => r.active).length === 0 && (
                <div className={`${cardCls} p-12 text-center text-slate-400`}><Gift size={40} className="mx-auto mb-4 opacity-50" aria-hidden="true" /><p>{t.dbEmpty}</p></div>
              )}

              {/* School & City: playful/relaxed card grid. Office: dense rows. */}
              {th.dense ? (
                <div className={`${cardCls} overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50`}>
                  {rewards.filter(r => r.active).map(r => {
                    const soldOut = r.stock !== null && r.stock <= 0;
                    const cantAfford = loggedInUser && myBalance < r.cost;
                    return (
                      <div key={r.id} className="p-4 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                          <span className="text-3xl shrink-0" aria-hidden="true">{r.icon || '🎁'}</span>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-800 dark:text-slate-100 truncate">{lang === 'bg' && r.title_bg ? r.title_bg : r.title}</p>
                            <p className="text-xs text-slate-400">{r.stock === null ? t.unlimitedStock : (soldOut ? t.outOfStock : `${r.stock} ${t.stockLeft}`)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {(r.description || r.description_bg) && (
                            <button type="button" onClick={() => setRewardInfoModal(r)} aria-label={`${r.title} — info`} className={`p-2 ${th.chip} text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors`}><Info size={16} aria-hidden="true" /></button>
                          )}
                          <span className={`font-black ${th.accentText}`}>{r.cost} {t.points.toLowerCase()}</span>
                          <button type="button" onClick={() => openRedeem(r)} disabled={soldOut || cantAfford || !isConnected} className={`${btnPrimary} px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed`}>{t.redeemBtn}</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {rewards.filter(r => r.active).map(r => {
                    const soldOut = r.stock !== null && r.stock <= 0;
                    const cantAfford = loggedInUser && myBalance < r.cost;
                    return (
                      <div key={r.id} className={`relative ${cardCls} ${th.cardPad} text-center flex flex-col items-center gap-3 ${soldOut ? 'opacity-60' : 'hover:scale-[1.02]'} transition-transform`}>
                        {(r.description || r.description_bg) && (
                          <button type="button" onClick={() => setRewardInfoModal(r)} aria-label={`${lang === 'bg' && r.title_bg ? r.title_bg : r.title} — info`}
                                  className={`absolute top-3 right-3 p-2 ${th.chip} text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors`}>
                            <Info size={18} aria-hidden="true" />
                          </button>
                        )}
                        <span className="text-6xl" aria-hidden="true">{r.icon || '🎁'}</span>
                        <p className="font-bold text-slate-800 dark:text-slate-100 text-lg leading-tight">{lang === 'bg' && r.title_bg ? r.title_bg : r.title}</p>
                        <p className={`font-black text-2xl ${th.accentText}`}>{r.cost} <span className="text-sm">{t.points.toLowerCase()}</span></p>
                        <p className="text-xs text-slate-400">{r.stock === null ? t.unlimitedStock : (soldOut ? t.outOfStock : `${r.stock} ${t.stockLeft}`)}</p>
                        <button type="button" onClick={() => openRedeem(r)} disabled={soldOut || cantAfford || !isConnected} className={`w-full ${btnPrimary} py-3 mt-auto disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}>
                          <Gift size={16} aria-hidden="true" /> {t.redeemBtn}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* My redemptions */}
              {loggedInUser && myRedemptions.length > 0 && (
                <div className={`${cardCls} overflow-hidden`}>
                  <div className={`${th.cardPad} border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50`}>
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Clock size={18} className={th.accentText} aria-hidden="true" /> {t.myRedemptions}</h3>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                    {myRedemptions.map(r => (
                      <div key={r.id} className="p-4 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 dark:text-slate-100 truncate">{r.reward_title}</p>
                          <p className="text-[11px] text-slate-400">{parseTimestamp(r.timestamp).toLocaleString()} · -{r.cost} {t.points.toLowerCase()}</p>
                        </div>
                        {statusChip(r.status)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: USER HUB */}
          {activeTab === 'userHub' && (
            !loggedInUser ? (
              <div className={`max-w-md mx-auto mt-12 bg-white dark:bg-slate-800 ${th.card} shadow-lg border border-slate-200 dark:border-slate-700 p-6 md:p-8 text-center animate-scale-in transition-colors duration-300`}>
                <div className={`w-16 h-16 ${th.accentSoft} ${th.chip} flex items-center justify-center mx-auto mb-4`}><UserCircle size={32} aria-hidden="true" /></div>
                {userView === 'login' && (
                  <div className="animate-fade-in">
                    <h2 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">{t.loginTitle}</h2>
                    <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">{t.loginDesc}</p>
                    <form onSubmit={handleUserLoginStep} className="space-y-4">
                      <input type="text" required maxLength={32} placeholder={t.userCode} aria-label={t.userCode} className={`${inputCls} text-center text-lg`} value={userAuthForm.code} onChange={e => setUserAuthForm({ ...userAuthForm, code: e.target.value })} />
                      {safeUsers[userAuthForm.code]?.has_password && (
                        <input type="password" required maxLength={128} placeholder={t.password} aria-label={t.password} className={`${inputCls} text-center text-lg animate-slide-up`} value={userAuthForm.password} onChange={e => setUserAuthForm({ ...userAuthForm, password: e.target.value })} />
                      )}
                      {loginError && <p className="text-rose-500 text-sm font-medium animate-shake flex items-center justify-center gap-1" role="alert"><AlertTriangle size={14} className="shrink-0" aria-hidden="true" />{loginError}</p>}
                      <button type="submit" disabled={userAuthPending || connectionState !== 'online'} className={`w-full ${btnPrimary} p-4 h-14 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed`}>
                        {userAuthPending ? <><Loader2 size={18} className="animate-spin" /> {t.signingIn}</> : <>{t.loginBtn} <ChevronRight size={18} /></>}
                      </button>
                    </form>
                    <button type="button" onClick={() => { setUserView('request'); setLoginError(''); }} className={`mt-6 text-sm ${th.accentText} font-semibold hover:underline`}>{t.reqAccount}</button>
                    <button type="button" onClick={() => { setActiveTab('admin'); setUserView('login'); }} className="block w-full mt-4 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-medium">{t.adminPanelLink}</button>
                  </div>
                )}
                {userView === 'request' && (
                  <div className="animate-fade-in">
                    <h2 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">{t.reqTitle}</h2>
                    <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">{t.reqDesc}</p>
                    <form onSubmit={submitAccountRequest} className="space-y-4">
                      <input type="text" required maxLength={32} placeholder={t.userCode} aria-label={t.userCode} className={`${inputCls} text-center`} value={userAuthForm.code} onChange={e => setUserAuthForm({ ...userAuthForm, code: e.target.value })} />
                      <input type="text" required maxLength={64} placeholder={t.fullName} aria-label={t.fullName} className={`${inputCls} text-center`} value={userAuthForm.name} onChange={e => setUserAuthForm({ ...userAuthForm, name: e.target.value })} />
                      <input type="text" maxLength={64} placeholder={deptLabel} aria-label={deptLabel} className={`${inputCls} text-center`} value={userAuthForm.department} onChange={e => setUserAuthForm({ ...userAuthForm, department: e.target.value })} />
                      {/* GDPR consent — required, enforced server-side too */}
                      <label className="flex items-start gap-3 text-left text-xs text-slate-500 dark:text-slate-400 cursor-pointer p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl">
                        <input type="checkbox" required checked={userAuthForm.consent} onChange={e => setUserAuthForm({ ...userAuthForm, consent: e.target.checked })} className="mt-0.5 w-4 h-4 accent-indigo-600 shrink-0" />
                        <span>{t.consentLabel}</span>
                      </label>
                      <button type="submit" disabled={!userAuthForm.consent} className={`w-full ${btnPrimary} p-4 h-14 disabled:opacity-50 disabled:cursor-not-allowed`}>{t.reqBtn}</button>
                    </form>
                    <button type="button" onClick={() => setUserView('login')} className="mt-6 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-white font-semibold">{t.backLogin}</button>
                  </div>
                )}
                {userView === 'set_password' && (
                  <div className="animate-fade-in">
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">{t.approvedMsg}</h2>
                    <form onSubmit={submitNewPassword} className="space-y-4 mt-6">
                      <input type="password" required maxLength={128} placeholder={t.password} aria-label={t.password} className={`${inputCls} text-center text-lg`} value={userAuthForm.password} onChange={e => setUserAuthForm({ ...userAuthForm, password: e.target.value })} />
                      <button type="submit" className={`w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold p-4 ${th.btnShape} transition-colors h-14`}>{t.setPassBtn}</button>
                    </form>
                  </div>
                )}
              </div>
            ) : (
              <div className={`${th.sectionGap} animate-fade-in pb-24 md:pb-0`}>
                <div className={`flex justify-between items-center ${cardCls} ${th.cardPad}`}>
                  <div className="flex items-center gap-4 min-w-0">
                    {th.mascot && <MascotLogo className="w-16 h-16 object-contain shrink-0 hidden sm:block" />}
                    <div className="min-w-0">
                      <h2 className="text-2xl font-black text-slate-800 dark:text-white truncate">{t.welcome}, {safeUsers[loggedInUser]?.name || 'User'}!</h2>
                      <p className="text-slate-500 dark:text-slate-400">ID: {loggedInUser} {safeUsers[loggedInUser]?.department ? `• ${safeUsers[loggedInUser].department}` : ''}</p>
                      {!sessionPassword && <p className="text-xs text-rose-500 mt-1 font-semibold flex items-center gap-1"><AlertTriangle size={12} aria-hidden="true" /> {t.reEnterPass}</p>}
                    </div>
                  </div>
                  <button type="button" onClick={logoutUser} aria-label={t.logout} className={`flex items-center gap-2 bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400 px-4 py-2 ${th.btnShape} font-bold hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors shrink-0`}><LogOut size={16} aria-hidden="true" /> <span className="hidden sm:inline">{t.logout}</span></button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className={`${th.heroGrad} ${th.card} p-6 text-white shadow-lg`}><h3 className="font-semibold text-white/80">{t.personalStats}</h3><p className="text-5xl font-black mt-2"><AnimatedNumber value={myEarned} /></p><p className="text-sm text-white/70 mt-1 uppercase tracking-wider font-bold">{t.points}</p></div>
                  <div className={`${cardCls} p-6`}><h3 className="font-semibold text-slate-500 dark:text-slate-400">{t.balanceLabel}</h3><p className={`text-4xl font-bold mt-2 ${th.accentText}`}><AnimatedNumber value={myBalance} /></p></div>
                  <div className={`${cardCls} p-6`}><h3 className="font-semibold text-slate-500 dark:text-slate-400">{t.rank}</h3><p className="text-4xl font-bold mt-2 text-amber-500">#{userRank || '-'}</p></div>
                  <div className={`${cardCls} p-6`}><h3 className="font-semibold text-slate-500 dark:text-slate-400">{t.totalRecycled}</h3><p className="text-4xl font-bold mt-2 text-slate-800 dark:text-white">{myItems}</p></div>
                </div>

                {/* Personal environmental impact + achievements */}
                {(() => {
                  const myTxs = safeTransactions.filter(tx => tx.user_code === loggedInUser);
                  const matCounts = { plastic: 0, glass: 0, tin: 0, paper: 0 };
                  myTxs.forEach(tx => { matCounts[tx.material] = (matCounts[tx.material] || 0) + 1; });
                  const my = impactFrom(matCounts);
                  const achievementsList = getAchievementsData(myTxs.length, matCounts, t);
                  return (
                    <>
                      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mt-4 mb-2"><Leaf size={20} className="text-emerald-500" aria-hidden="true" /> {t.environmentalImpact}</h2>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <button type="button" onClick={() => setImpactModal({ metric: 'co2', matCounts })} className={`text-left w-full bg-emerald-500 ${th.card} p-6 text-white shadow-md relative overflow-hidden hover:shadow-lg hover:scale-[1.01] transition-all`}><Cloud size={80} className="absolute -bottom-4 -right-4 opacity-20" aria-hidden="true" /><h3 className="font-semibold text-emerald-100 flex items-center gap-2"><Cloud size={16} aria-hidden="true" /> {t.co2Saved}</h3><p className="text-3xl font-black mt-2">{my.co2.toFixed(1)} <span className="text-lg">kg</span></p><p className="text-xs text-emerald-100/90 mt-1 flex items-center gap-1"><Car size={12} aria-hidden="true" /> ≈ {Math.round(my.co2 * EQUIV.kmPerKgCo2)} {t.eqKm}</p></button>
                        <button type="button" onClick={() => setImpactModal({ metric: 'water', matCounts })} className={`text-left w-full bg-blue-500 ${th.card} p-6 text-white shadow-md relative overflow-hidden hover:shadow-lg hover:scale-[1.01] transition-all`}><Droplets size={80} className="absolute -bottom-4 -right-4 opacity-20" aria-hidden="true" /><h3 className="font-semibold text-blue-100 flex items-center gap-2"><Droplets size={16} aria-hidden="true" /> {t.waterSaved}</h3><p className="text-3xl font-black mt-2">{my.water.toFixed(1)} <span className="text-lg">L</span></p><p className="text-xs text-blue-100/90 mt-1 flex items-center gap-1"><ShowerHead size={12} aria-hidden="true" /> ≈ {Math.round(my.water * EQUIV.showersPerL)} {t.eqShowers}</p></button>
                        <button type="button" onClick={() => setImpactModal({ metric: 'energy', matCounts })} className={`text-left w-full bg-amber-500 ${th.card} p-6 text-white shadow-md relative overflow-hidden hover:shadow-lg hover:scale-[1.01] transition-all`}><Zap size={80} className="absolute -bottom-4 -right-4 opacity-20" aria-hidden="true" /><h3 className="font-semibold text-amber-100 flex items-center gap-2"><Zap size={16} aria-hidden="true" /> {t.energySaved}</h3><p className="text-3xl font-black mt-2">{my.energy.toFixed(1)} <span className="text-lg">kWh</span></p><p className="text-xs text-amber-100/90 mt-1 flex items-center gap-1"><BatteryCharging size={12} aria-hidden="true" /> ≈ {Math.round(my.energy * EQUIV.chargesPerKwh)} {t.eqCharges}</p></button>
                      </div>

                      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mt-6 mb-2"><Badge size={20} className={th.accentText} aria-hidden="true" /> {t.achievements}</h2>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {achievementsList.map(ach => {
                          const isUnlocked = ach.cur >= ach.req; const Icon = ach.icon;
                          return (
                            <button type="button" key={ach.id} onClick={() => setSelectedAchievement(ach)} aria-label={`${ach.title} — ${isUnlocked ? t.unlocked : t.locked}`} className={`p-4 ${th.card} text-center border-2 cursor-pointer transition-all hover:scale-105 active:scale-95 shadow-sm ${isUnlocked ? ach.colorClass : 'bg-slate-50 border-slate-100 text-slate-400 dark:bg-slate-800 dark:border-slate-700'}`}>
                              <Icon size={32} className={`mx-auto mb-2 ${isUnlocked ? '' : 'opacity-40'}`} aria-hidden="true" />
                              <p className="font-bold text-sm leading-tight">{ach.title}</p>
                              <p className="text-[10px] uppercase font-bold mt-2 opacity-70 tracking-widest">{isUnlocked ? t.unlocked : t.locked}</p>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Edit Profile + Notifications + Privacy */}
                  <div className="flex flex-col gap-6">
                    <div className={`${cardCls} overflow-hidden`}>
                      <div className={`${th.cardPad} border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50`}><h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Settings size={18} className={th.accentText} aria-hidden="true" /> {t.editProfile}</h2></div>
                      <div className={th.cardPad}>
                        {safeProfileEdits.find(ed => ed.code === loggedInUser) ? (
                          <div className={`p-4 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 ${th.card} flex items-center gap-3 animate-fade-in font-semibold border border-amber-200 dark:border-amber-800`}><Clock size={20} className="shrink-0" aria-hidden="true" /> {t.editPending}</div>
                        ) : !isEditingProfile ? (
                          <button type="button" onClick={() => { setEditProfileForm({ name: safeUsers[loggedInUser]?.name || '', department: safeUsers[loggedInUser]?.department || '', confirmPass: '' }); setIsEditingProfile(true); }} className={`w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold p-4 ${th.btnShape} transition-colors flex items-center justify-center gap-2`}><Edit2 size={18} aria-hidden="true" /> {t.editProfile}</button>
                        ) : (
                          <form onSubmit={submitProfileEdit} className="space-y-4 animate-fade-in">
                            <input type="text" required maxLength={64} placeholder={t.fullName} aria-label={t.fullName} className={inputCls} value={editProfileForm.name} onChange={e => setEditProfileForm({ ...editProfileForm, name: e.target.value })} />
                            <input type="text" maxLength={64} placeholder={deptLabel} aria-label={deptLabel} className={inputCls} value={editProfileForm.department} onChange={e => setEditProfileForm({ ...editProfileForm, department: e.target.value })} />
                            {!sessionPassword && <input type="password" required maxLength={128} placeholder={t.confirmPass} aria-label={t.confirmPass} className={`w-full p-4 ${th.input} border border-rose-200 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-100 focus:ring-2 focus:ring-rose-500 outline-none transition-colors`} value={editProfileForm.confirmPass} onChange={e => setEditProfileForm({ ...editProfileForm, confirmPass: e.target.value })} />}
                            <div className="flex gap-2"><button type="submit" className={`flex-1 ${btnPrimary} p-3 shadow-sm`}>{t.requestEdit}</button><button type="button" onClick={() => setIsEditingProfile(false)} className={`bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold p-3 px-6 ${th.btnShape} transition-colors`}>{t.cancel}</button></div>
                          </form>
                        )}
                      </div>
                    </div>

                    {/* Notifications */}
                    <div className={`${cardCls} overflow-hidden`}>
                      <div className={`${th.cardPad} border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50`}><h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Bell size={18} className={th.accentText} aria-hidden="true" /> {t.notifTitle}</h2></div>
                      <div className={th.cardPad}>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t.notifDesc}</p>
                        {pushState === 'on' && <div className={`p-3 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 ${th.card} flex items-center gap-2 font-semibold text-sm`}><CheckCircle2 size={16} aria-hidden="true" /> {t.notifOn}</div>}
                        {pushState === 'denied' && <div className={`p-3 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 ${th.card} flex items-center gap-2 font-semibold text-sm`}><AlertTriangle size={16} aria-hidden="true" /> {t.notifDenied}</div>}
                        {pushState === 'unsupported' && <div className={`p-3 bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-400 ${th.card} flex items-center gap-2 font-semibold text-sm`}><Info size={16} aria-hidden="true" /> {t.notifUnsupported}</div>}
                        {pushState === 'idle' && (
                          <button type="button" onClick={enableNotifications} className={`w-full ${btnPrimary} p-4 flex items-center justify-center gap-2`}><Bell size={18} aria-hidden="true" /> {t.notifEnable}</button>
                        )}
                      </div>
                    </div>

                  </div>

                  {/* Feedback */}
                  <div className={`${cardCls} overflow-hidden h-fit`}>
                    <div className={`${th.cardPad} border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50`}><h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><MessageSquare size={18} className={th.accentText} aria-hidden="true" /> {t.feedbackHub}</h2></div>
                    <div className={th.cardPad}>
                      {feedbackMsg && <div className={`mb-4 p-3 bg-emerald-50 text-emerald-700 ${th.card} flex items-center gap-2 animate-fade-in`} role="status" aria-live="polite"><Check size={16} aria-hidden="true" /> {feedbackMsg}</div>}
                      <form onSubmit={submitFeedback}>
                        <textarea required maxLength={1000} placeholder={t.feedbackPh} aria-label={t.feedbackHub} rows="4" className={`${inputCls} resize-none mb-4`} value={feedbackText} onChange={e => setFeedbackText(e.target.value)} />
                        {!sessionPassword && <input type="password" required maxLength={128} placeholder={t.confirmPass} aria-label={t.confirmPass} className={`w-full p-4 ${th.input} border border-rose-200 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-100 focus:ring-2 focus:ring-rose-500 outline-none transition-colors mb-4`} value={feedbackConfirmPass} onChange={e => setFeedbackConfirmPass(e.target.value)} />}
                        <button type="submit" className={`w-full ${btnPrimary} p-4`}>{t.sendFeedback}</button>
                      </form>
                    </div>
                  </div>

                  {/* GDPR: Privacy & data — full width, always the last card */}
                  <div className={`${cardCls} overflow-hidden lg:col-span-2`}>
                    <div className={`${th.cardPad} border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50`}><h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><ShieldCheck size={18} className={th.accentText} aria-hidden="true" /> {t.privacyTitle}</h2></div>
                    <div className={th.cardPad}>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t.privacyDesc}</p>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <button type="button" onClick={() => setGdprModal({ mode: 'export', pass: '', busy: false })} className={`flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold p-3 ${th.btnShape} transition-colors flex items-center justify-center gap-2`}><FileDown size={16} aria-hidden="true" /> {t.downloadData}</button>
                        <button type="button" onClick={() => setGdprModal({ mode: 'delete', pass: '', busy: false })} className={`flex-1 bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/30 dark:hover:bg-rose-900/50 text-rose-600 dark:text-rose-400 font-bold p-3 ${th.btnShape} transition-colors flex items-center justify-center gap-2`}><UserX size={16} aria-hidden="true" /> {t.deleteAccount}</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          )}

          {/* TAB: ADMIN */}
          {activeTab === 'admin' && (
            !isAdminAuthenticated ? (
              <div className={`max-w-md mx-auto mt-12 bg-white dark:bg-slate-800 ${th.card} shadow-lg border border-slate-200 dark:border-slate-700 p-6 md:p-8 text-center animate-fade-in transition-colors duration-300`}>
                <div className={`w-16 h-16 ${th.accentSoft} ${th.chip} flex items-center justify-center mx-auto mb-4`}><Lock size={32} aria-hidden="true" /></div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">{t.adminAccess}</h2>
                <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">{t.enterPassword}</p>
                <form onSubmit={handleAdminLogin} className="space-y-4">
                  <input type="text" required maxLength={32} placeholder={t.username} aria-label={t.username} className={`${inputCls} text-center text-lg`} value={adminAuthForm.username} onChange={e => setAdminAuthForm({ ...adminAuthForm, username: e.target.value })} />
                  <input type="password" required maxLength={128} placeholder={t.passwordHint} aria-label={t.passwordHint} className={`${inputCls} text-center text-lg`} value={adminAuthForm.password} onChange={e => setAdminAuthForm({ ...adminAuthForm, password: e.target.value })} />
                  {adminAuthError && <p className="text-rose-500 text-sm font-medium animate-shake flex items-center justify-center gap-1" role="alert"><XCircle size={14} aria-hidden="true" /> {adminAuthError}</p>}
                  <button type="submit" disabled={adminAuthPending || connectionState !== 'online'} className={`w-full ${btnPrimary} p-4 flex items-center justify-center gap-2 h-14 disabled:opacity-60 disabled:cursor-not-allowed`}>
                    {adminAuthPending ? <><Loader2 size={20} className="animate-spin" /> {t.signingIn}</> : <><ShieldCheck size={20} /> {t.unlockDashboard}</>}
                  </button>
                </form>
              </div>
            ) : (
              <div className={`${th.sectionGap} animate-fade-in pb-24 md:pb-0`}>
                <div className={`bg-slate-800 dark:bg-slate-900 ${th.card} p-4 flex flex-wrap items-center gap-3 text-slate-200 shadow-lg`}>
                  <Server size={20} className="text-indigo-400" aria-hidden="true" />
                  <div className="flex-1 min-w-[150px]"><h4 className="font-bold text-sm">{t.dbConnection}</h4><p className="text-xs text-slate-400">{isConnected ? t.connected2Way : (connectionState === 'connecting' ? t.connecting : t.disconnected)}</p><p className="text-[10px] text-slate-500 font-mono mt-0.5">ui {FRONTEND_BUILD} · core {backendBuild || '?'}</p></div>
                  <label className="text-xs flex items-center gap-2 text-slate-300 font-semibold">
                    {t.orgType}
                    <select value={orgType} onChange={handleOrgChange} className="bg-slate-700 text-slate-200 rounded-lg px-2 py-1.5 outline-none" aria-label={t.orgType}>
                      <option value="office">{t.orgOffice}</option>
                      <option value="school">{t.orgSchool}</option>
                      <option value="city">{t.orgCity}</option>
                    </select>
                  </label>
                  <button type="button" onClick={exportCSV} className="text-xs flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-2 rounded-lg font-semibold transition-colors"><Download size={14} aria-hidden="true" /> <span className="hidden sm:inline">{t.exportData}</span></button>
                  <button type="button" onClick={() => { setIsAdminAuthenticated(false); setAdminToken(null); setAdminRole(null); }} aria-label={t.logout} className="text-xs flex items-center gap-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 px-3 py-2 rounded-lg font-semibold transition-colors"><LogOut size={14} aria-hidden="true" /></button>
                </div>

                {/* Office theme: reporting KPIs surfaced up front */}
                {th.dense && (
                  <div className="grid grid-cols-3 gap-3">
                    {(() => {
                      const wk = scopeData('week');
                      return (
                        <>
                          <div className={`${cardCls} p-4`}><p className="text-[11px] font-bold uppercase text-slate-400">{t.weeklyKpi} · {t.kpiItems}</p><p className="text-2xl font-black mt-1">{Object.values(wk.users || {}).reduce((s, u) => s + u.items, 0)}</p></div>
                          <div className={`${cardCls} p-4`}><p className="text-[11px] font-bold uppercase text-slate-400">{t.weeklyKpi} · {t.kpiPoints}</p><p className="text-2xl font-black mt-1">{Object.values(wk.users || {}).reduce((s, u) => s + u.points, 0)}</p></div>
                          <div className={`${cardCls} p-4`}><p className="text-[11px] font-bold uppercase text-slate-400">{t.weeklyKpi} · {t.kpiActive}</p><p className="text-2xl font-black mt-1">{Object.keys(wk.users || {}).length}</p></div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Pending redemptions queue */}
                {redemptions.filter(r => r.status === 'pending').length > 0 && (
                  <div className={`${cardCls} border-amber-200 dark:border-amber-700/50 ${th.cardPad} animate-slide-up`}>
                    <h2 className="text-lg md:text-xl font-bold text-amber-800 dark:text-amber-400 flex items-center gap-2 mb-4"><Gift size={20} aria-hidden="true" /> {t.pendingRedemptions} ({redemptions.filter(r => r.status === 'pending').length})</h2>
                    <div className="space-y-2">
                      {redemptions.filter(r => r.status === 'pending').map(r => (
                        <div key={r.id} className={`bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 p-4 ${th.card} flex flex-wrap items-center justify-between gap-3`}>
                          <div className="min-w-0">
                            <p className="font-bold text-amber-900 dark:text-amber-300 truncate">{safeUsers[r.user_code]?.name || r.user_code} — {r.reward_title}</p>
                            <p className="text-xs text-amber-700/80 dark:text-amber-500">{r.cost} {t.points.toLowerCase()} · {parseTimestamp(r.timestamp).toLocaleString()}</p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button type="button" onClick={() => resolveRedemption(r.id, 'fulfill')} className={`bg-emerald-600 hover:bg-emerald-500 text-white py-2 px-4 ${th.btnShape} text-sm font-bold shadow-sm transition-colors`}>{t.fulfill}</button>
                            <button type="button" onClick={() => resolveRedemption(r.id, 'reject')} className={`bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-rose-900/40 dark:hover:bg-rose-900/60 dark:text-rose-400 py-2 px-4 ${th.btnShape} text-sm font-bold transition-colors`}>{t.reject}</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Rewards manager */}
                <div className={`${cardCls} ${th.cardPad}`}>
                  <h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-6"><Gift className={th.accentText} aria-hidden="true" /> {t.manageRewards}</h2>
                  <form onSubmit={submitNewReward} className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end mb-6">
                    <div className="space-y-1 col-span-2 md:col-span-2"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.rewardTitleEn}</label><input type="text" required maxLength={64} className={inputSm} value={rewardForm.title} onChange={e => setRewardForm({ ...rewardForm, title: e.target.value })} /></div>
                    <div className="space-y-1 col-span-2 md:col-span-1"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.rewardTitleBg}</label><input type="text" maxLength={64} className={inputSm} value={rewardForm.title_bg} onChange={e => setRewardForm({ ...rewardForm, title_bg: e.target.value })} /></div>
                    <div className="space-y-1"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.points}</label><input type="number" required min="1" className={inputSm} value={rewardForm.cost} onChange={e => setRewardForm({ ...rewardForm, cost: e.target.value })} /></div>
                    <div className="space-y-1"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.rewardStock}</label><input type="number" min="-1" className={inputSm} value={rewardForm.stock} onChange={e => setRewardForm({ ...rewardForm, stock: e.target.value })} /></div>
                    <div className="space-y-1"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.rewardIcon}</label><input type="text" maxLength={4} className={`${inputSm} text-center`} value={rewardForm.icon} onChange={e => setRewardForm({ ...rewardForm, icon: e.target.value })} /></div>
                    <div className="space-y-1 col-span-2 md:col-span-3"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.rewardDescEn}</label><input type="text" maxLength={200} className={inputSm} value={rewardForm.description} onChange={e => setRewardForm({ ...rewardForm, description: e.target.value })} /></div>
                    <div className="space-y-1 col-span-2 md:col-span-3"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.rewardDescBg}</label><input type="text" maxLength={200} className={inputSm} value={rewardForm.description_bg} onChange={e => setRewardForm({ ...rewardForm, description_bg: e.target.value })} /></div>
                    <button type="submit" className={`${btnPrimary} p-3 h-12 flex items-center justify-center gap-2 col-span-2 md:col-span-6`}><UserPlus size={18} aria-hidden="true" /> {t.addReward}</button>
                  </form>
                  <div className="space-y-2">
                    {rewards.map(r => (
                      <div key={r.id} className={`flex justify-between items-center bg-slate-50 dark:bg-slate-700/30 p-3 ${th.card} border border-slate-100 dark:border-slate-700 gap-3`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-2xl shrink-0" aria-hidden="true">{r.icon || '🎁'}</span>
                          <div className="min-w-0"><p className="font-bold text-slate-800 dark:text-slate-100 truncate">{r.title}{r.title_bg ? ` / ${r.title_bg}` : ''}</p><p className="text-xs text-slate-500">{r.cost} {t.points.toLowerCase()} · {r.stock === null ? t.unlimitedStock : `${r.stock} ${t.stockLeft}`}</p></div>
                        </div>
                        <button type="button" onClick={() => setConfirmAction({ type: 'delete_reward', rewardId: r.id, name: r.title })} aria-label={`Delete reward ${r.title}`} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors shrink-0"><Trash2 size={16} aria-hidden="true" /></button>
                      </div>
                    ))}
                    {rewards.length === 0 && <p className="text-center text-slate-400 text-sm py-2">{t.dbEmpty}</p>}
                  </div>
                </div>

                {adminRole === 'super' && (
                  <>
                    <div className={`${cardCls} ${th.cardPad}`}>
                      <div className="flex justify-between items-center mb-4"><h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Activity className="text-rose-500" aria-hidden="true" /> {t.hardwareDiagnostics}</h2>{Object.keys(hardwareErrors).length > 0 && <button type="button" onClick={() => setHardwareErrors({})} className={`text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-600 dark:text-slate-300 px-3 py-1.5 ${th.btnShape} font-semibold`}>{t.clearErrors}</button>}</div>
                      {Object.keys(hardwareErrors).length === 0 ? (
                        <div className={`p-4 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 ${th.card} border border-emerald-200 dark:border-emerald-800 flex items-center gap-2 text-sm font-semibold`}><CheckCircle2 size={18} aria-hidden="true" /> {t.noErrors}</div>
                      ) : (
                        <div className="space-y-2">
                          {Object.entries(hardwareErrors).map(([errName, errTimestamp]) => (
                            <div key={errName} className={`p-4 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 ${th.card} border border-rose-200 dark:border-rose-800 flex items-start gap-3 text-sm font-semibold animate-shake`} role="alert">
                              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                              <div><p>{(errName || "").includes("FAN1_STALL") ? t.fan1Error : (errName || "").includes("FAN2_STALL") ? t.fan2Error : (errName || "").includes("FAN_STALL") ? t.fanError : errName}</p><p className="text-xs text-rose-500/70 mt-1 font-normal">{parseTimestamp(errTimestamp).toLocaleString()}</p></div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* --- Maintenance mode: live inference view + motor jog --- */}
                      <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                          <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Wrench size={18} className={th.accentText} aria-hidden="true" /> {t.maintTitle}</h3>
                          <button type="button" onClick={() => setMachineMaint(!maintMode)} disabled={!isConnected}
                                  className={`${maintMode ? 'bg-rose-600 hover:bg-rose-700 text-white' : th.accentBtn} ${th.btnShape} font-bold px-4 py-2 text-sm transition-colors disabled:opacity-50`}>
                            {maintMode ? t.maintExit : t.maintEnter}
                          </button>
                        </div>

                        {maintMode && (
                          <div className="animate-fade-in space-y-4">
                            <div className={`p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 ${th.card} border border-amber-200 dark:border-amber-800 flex items-start gap-2 text-xs font-semibold`}>
                              <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" /> {t.maintWarning}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Camera / inference view */}
                              <div className={`bg-slate-50 dark:bg-slate-900/50 ${th.card} border border-slate-200 dark:border-slate-700 p-4`}>
                                <div className="flex items-center justify-between gap-2 mb-3">
                                  <h4 className="font-bold text-sm text-slate-700 dark:text-slate-200 flex items-center gap-2"><Camera size={16} className={th.accentText} aria-hidden="true" /> {t.maintCamera}</h4>
                                  <div className="flex gap-2">
                                    <button type="button" onClick={requestSnapshot} disabled={snapshotPending} className={`${th.accentBtn} ${th.btnShape} px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50`}>
                                      {snapshotPending ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} aria-hidden="true" />} {t.maintCapture}
                                    </button>
                                    <button type="button" onClick={() => setAutoRefresh(!autoRefresh)} aria-pressed={autoRefresh}
                                            className={`${autoRefresh ? th.accentSoft : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'} ${th.btnShape} px-3 py-1.5 text-xs font-bold flex items-center gap-1.5`}>
                                      <RefreshCw size={13} className={autoRefresh ? 'animate-spin' : ''} style={autoRefresh ? { animationDuration: '3s' } : undefined} aria-hidden="true" /> {t.maintAuto}
                                    </button>
                                  </div>
                                </div>
                                <div className={`aspect-video bg-slate-900 ${th.card} overflow-hidden flex items-center justify-center relative`}>
                                  {snapshot?.src ? (
                                    <img src={snapshot.src} alt={t.maintCamera} className="w-full h-full object-contain" />
                                  ) : (
                                    <p className="text-slate-500 text-xs px-4 text-center">
                                      {snapshot?.error
                                        ? `${t.maintSnapErr} ${snapshot.error === 'timeout' ? t.maintSnapTimeout : snapshot.error}`
                                        : t.maintNoFrame}
                                    </p>
                                  )}
                                </div>
                                {snapshot?.ts && (
                                  <p className="text-[10px] text-slate-400 mt-2 font-mono">{parseTimestamp(snapshot.ts).toLocaleTimeString()} · {snapshot.detections} {t.maintDetections}</p>
                                )}
                              </div>

                              {/* Motor jog */}
                              <div className={`bg-slate-50 dark:bg-slate-900/50 ${th.card} border border-slate-200 dark:border-slate-700 p-4`}>
                                <h4 className="font-bold text-sm text-slate-700 dark:text-slate-200 flex items-center gap-2 mb-3"><Settings size={16} className={th.accentText} aria-hidden="true" /> {t.maintMotors}</h4>
                                <div className="flex flex-wrap gap-2 mb-4" role="radiogroup" aria-label={t.maintMotor}>
                                  {[1, 2, 3, 4].map(m => (
                                    <button key={m} type="button" role="radio" aria-checked={jogMotor === m} onClick={() => setJogMotor(m)}
                                            className={`${jogMotor === m ? th.accentSoft : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'} ${th.btnShape} px-4 py-2 text-sm font-bold transition-colors`}>
                                      {t.maintMotor} {m}
                                    </button>
                                  ))}
                                </div>
                                <div className="grid grid-cols-4 gap-2">
                                  {[-10, -1, 1, 10].map(s => (
                                    <button key={s} type="button" onClick={() => jog(s)} disabled={!isConnected}
                                            className={`${th.accentBtn} ${th.btnShape} py-3 font-black text-lg disabled:opacity-50`}>
                                      {s > 0 ? `+${s}` : s}
                                    </button>
                                  ))}
                                </div>
                                <p className="text-[11px] text-slate-400 mt-3">{t.maintMotor} {jogMotor} · ±1 / ±10 {t.maintSteps}</p>

                                <h4 className="font-bold text-sm text-slate-700 dark:text-slate-200 flex items-center gap-2 mt-5 mb-3"><Fan size={16} className={th.accentText} aria-hidden="true" /> {t.maintFans}</h4>
                                <div className="grid grid-cols-2 gap-2">
                                  {[0, 1].map(i => (
                                    <button key={i} type="button" onClick={() => toggleFan(i)} disabled={!isConnected} aria-pressed={fanStates[i]}
                                            className={`${fanStates[i] ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600'} ${th.btnShape} py-3 font-bold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50`}>
                                      <Fan size={16} className={fanStates[i] ? 'animate-spin' : ''} style={fanStates[i] ? { animationDuration: '1.2s' } : undefined} aria-hidden="true" />
                                      {t.maintFans.slice(0, -1) || 'Fan'} {i + 1}: {fanStates[i] ? t.fanOnLabel : t.fanOffLabel}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className={`${cardCls} ${th.cardPad}`}>
                      <h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-6"><ShieldCheck className={th.accentText} aria-hidden="true" /> {t.adminAccounts}</h2>
                      <form onSubmit={submitNewAdmin} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-6">
                        <div className="space-y-1"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.username}</label><input type="text" required maxLength={32} placeholder="admin2" className={inputSm} value={newAdminForm.username} onChange={e => setNewAdminForm({ ...newAdminForm, username: e.target.value })} /></div>
                        <div className="space-y-1"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.password}</label><input type="password" required maxLength={128} placeholder="***" className={inputSm} value={newAdminForm.password} onChange={e => setNewAdminForm({ ...newAdminForm, password: e.target.value })} /></div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.role}</label>
                          <select className={inputSm} value={newAdminForm.role} onChange={e => setNewAdminForm({ ...newAdminForm, role: e.target.value })}>
                            <option value="org">{t.roleOrg}</option>
                            <option value="super">{t.roleSuper}</option>
                          </select>
                        </div>
                        <button type="submit" className={`${btnPrimary} p-3 h-12 flex items-center justify-center gap-2`}><UserPlus size={18} aria-hidden="true" /> {t.addAdmin}</button>
                      </form>
                      <div className="space-y-2">
                        {Array.isArray(adminsList) && adminsList.map(admin => (
                          <div key={admin.username} className={`flex justify-between items-center bg-slate-50 dark:bg-slate-700/30 p-3 ${th.card} border border-slate-100 dark:border-slate-700`}>
                            <div><p className="font-bold text-slate-800 dark:text-slate-100">{admin.username}</p><p className="text-xs text-slate-500">{admin.role === 'super' ? t.roleSuper : t.roleOrg}</p></div>
                            {admin.username !== 'admin' && (
                              <button type="button" onClick={() => setConfirmAction({ type: 'delete_admin', code: admin.username, name: admin.username })} aria-label={`Delete admin ${admin.username}`} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors"><Trash2 size={16} aria-hidden="true" /></button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Profile Edit Approvals */}
                {safeProfileEdits.length > 0 && (
                  <div className={`${cardCls} border-amber-200 dark:border-amber-700/50 ${th.cardPad} animate-slide-up`}>
                    <h2 className="text-lg md:text-xl font-bold text-amber-800 dark:text-amber-400 flex items-center gap-2 mb-4"><Edit2 size={20} aria-hidden="true" /> {t.profileEdits} ({safeProfileEdits.length})</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {safeProfileEdits.map((edit) => {
                        const currentData = safeUsers[edit.code] || {};
                        return (
                          <div key={edit.code} className={`bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 p-4 ${th.card} flex flex-col gap-3`}>
                            <div className="flex justify-between items-start"><p className="font-bold text-amber-900 dark:text-amber-300">ID: {edit.code}</p></div>
                            <div className={`text-sm grid grid-cols-2 gap-3 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800/50 p-3 ${th.card}`}>
                              <div><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">{t.current}</p><p className="font-semibold">{currentData.name}</p><p className="text-xs text-slate-500">{currentData.department}</p></div>
                              <div className="border-l border-slate-200 dark:border-slate-700 pl-3"><p className="text-[10px] text-amber-500 dark:text-amber-400 font-bold uppercase mb-1">{t.requested}</p><p className="font-semibold text-amber-700 dark:text-amber-300">{edit.new_name}</p><p className="text-xs text-amber-600 dark:text-amber-400/80">{edit.new_department}</p></div>
                            </div>
                            <div className="flex gap-2 mt-1">
                              <button type="button" onClick={() => pub(`${NS}/profile_edit/resolve`, JSON.stringify({ action: 'approve', code: edit.code, admin_token: adminToken }))} className={`flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2 ${th.btnShape} text-sm font-bold shadow-sm transition-colors`}>{t.approve}</button>
                              <button type="button" onClick={() => pub(`${NS}/profile_edit/resolve`, JSON.stringify({ action: 'reject', code: edit.code, admin_token: adminToken }))} className={`flex-1 bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-rose-900/40 dark:hover:bg-rose-900/60 dark:text-rose-400 py-2 ${th.btnShape} text-sm font-bold transition-colors`}>{t.reject}</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Unmapped IDs */}
                {suggestedIds.length > 0 && (
                  <div className={`bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 ${th.card} ${th.cardPad}`}>
                    <h3 className="text-amber-800 dark:text-amber-400 font-bold flex items-center gap-2 mb-2 text-sm md:text-base"><Zap className="fill-current" size={18} aria-hidden="true" /> {t.unmappedFound}</h3>
                    <p className="text-xs md:text-sm text-amber-700 dark:text-amber-500 mb-4">{t.tapToAssign}</p>
                    <div className="flex flex-wrap gap-2">
                      {suggestedIds.map(id => (<button type="button" key={id} onClick={() => setAdminForm({ ...adminForm, code: id })} className={`bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400 px-4 py-2 ${th.btnShape} text-sm font-bold hover:bg-amber-100 dark:hover:bg-slate-700 transition-colors shadow-sm min-h-[44px]`}>ID: {id} +</button>))}
                    </div>
                  </div>
                )}

                {/* Directory Management */}
                <div className={`${cardCls} ${th.cardPad}`}>
                  <h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-6"><Settings className={th.accentText} aria-hidden="true" /> {t.manageProfiles}</h2>
                  {adminMessage && <div className={`mb-6 p-4 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 ${th.card} flex items-center gap-2 text-sm font-semibold animate-fade-in`} role="status" aria-live="polite"><CheckCircle2 size={18} aria-hidden="true" /> {adminMessage}</div>}
                  <form onSubmit={handleAdminSave} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="space-y-1"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.userCode}</label><input type="text" required maxLength={32} placeholder="1234" className={inputSm} value={adminForm.code} onChange={e => setAdminForm({ ...adminForm, code: e.target.value })} /></div>
                    <div className="space-y-1"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.fullName}</label><input type="text" required maxLength={64} placeholder="Jane Doe" className={inputSm} value={adminForm.name} onChange={e => setAdminForm({ ...adminForm, name: e.target.value })} /></div>
                    <div className="space-y-1"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{deptLabel}</label><input type="text" maxLength={64} placeholder="…" className={inputSm} value={adminForm.department} onChange={e => setAdminForm({ ...adminForm, department: e.target.value })} /></div>
                    <button type="submit" className={`${btnPrimary} p-3 h-12 flex items-center justify-center gap-2`}><UserPlus size={18} aria-hidden="true" /> {t.save}</button>
                  </form>
                </div>

                {/* Directory Table */}
                <div className={`${cardCls} overflow-hidden`}>
                  <div className={`${th.cardPad} border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50`}>
                    <h3 className="font-bold text-slate-800 dark:text-slate-100">{t.piDirectory}</h3>
                  </div>
                  <div className="overflow-x-auto w-full">
                    <table className="w-full text-left border-collapse min-w-[600px]">
                      <thead>
                        <tr className="bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-xs md:text-sm border-b border-slate-200 dark:border-slate-700">
                          <th className="p-4 font-semibold" scope="col">{t.userCode}</th><th className="p-4 font-semibold" scope="col">{t.fullName}</th><th className="p-4 font-semibold" scope="col">{deptLabel}</th><th className="p-4 font-semibold text-right" scope="col">{t.actions}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 text-sm">
                        {Object.entries(safeUsers).filter(([, data]) => data.status !== 'pending').length === 0 && (<tr><td colSpan="4" className="p-8 text-center text-slate-400 dark:text-slate-500">{t.dbEmpty}</td></tr>)}
                        {Object.entries(safeUsers).filter(([, data]) => data.status !== 'pending').map(([code, data]) => (
                          <tr key={code} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors group">
                            <td className={`p-4 font-mono ${th.accentText} font-semibold`}>{code}</td>
                            <td className="p-4 font-bold text-slate-800 dark:text-slate-100">{data.name}</td>
                            <td className="p-4 text-slate-500 dark:text-slate-400">{data.department || '-'}</td>
                            <td className="p-4">
                              <div className="flex justify-end gap-2 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                <button type="button" onClick={() => { setAdminForm({ code, name: data.name, department: data.department || '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-label={`Edit ${data.name}`} className="p-2 text-slate-400 hover:text-indigo-500 bg-slate-50 dark:bg-slate-700/50 hover:bg-indigo-50 rounded-lg h-10 w-10 flex items-center justify-center"><Edit2 size={16} aria-hidden="true" /></button>
                                <button type="button" onClick={() => setConfirmAction({ type: 'reset_pass', code, name: data.name })} aria-label={`Reset password for ${data.name}`} className="p-2 text-slate-400 hover:text-indigo-500 bg-slate-50 dark:bg-slate-700/50 hover:bg-indigo-50 rounded-lg h-10 w-10 flex items-center justify-center"><Key size={16} aria-hidden="true" /></button>
                                <button type="button" onClick={() => setConfirmAction({ type: 'clear', code, name: data.name })} aria-label={`Clear history for ${data.name}`} className="p-2 text-slate-400 hover:text-amber-500 bg-slate-50 dark:bg-slate-700/50 hover:bg-amber-50 rounded-lg h-10 w-10 flex items-center justify-center"><Eraser size={16} aria-hidden="true" /></button>
                                <button type="button" onClick={() => setConfirmAction({ type: 'delete', code, name: data.name })} aria-label={`Delete ${data.name}`} className="p-2 text-slate-400 hover:text-rose-500 bg-slate-50 dark:bg-slate-700/50 hover:bg-rose-50 rounded-lg h-10 w-10 flex items-center justify-center"><Trash2 size={16} aria-hidden="true" /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Feedback Logs */}
                <div className={`${cardCls} overflow-hidden`}>
                  <div className={`${th.cardPad} border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50`}>
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><MessageSquare size={18} className={th.accentText} aria-hidden="true" /> {t.adminFeedback}</h3>
                  </div>
                  <div className={`${th.cardPad} space-y-4`}>
                    {Array.isArray(feedbacks) && feedbacks.map(fb => (
                      <div key={fb.id} className={`bg-slate-50 dark:bg-slate-700/30 p-4 ${th.card} border border-slate-100 dark:border-slate-700 flex justify-between gap-4`}>
                        <div className="flex-1">
                          <p className="font-bold text-slate-800 dark:text-slate-100 mb-1">{safeUsers[fb.user_code]?.name || fb.user_code}</p>
                          <p className="text-slate-600 dark:text-slate-300 text-sm whitespace-pre-wrap">{fb.message}</p>
                          <p className="text-[10px] text-slate-400 mt-2">{parseTimestamp(fb.timestamp).toLocaleString()}</p>
                        </div>
                        {adminRole === 'super' && (
                          <button type="button" onClick={() => pub(`${NS}/feedback/delete`, JSON.stringify({ id: fb.id, admin_token: adminToken }))} aria-label="Delete feedback" className="text-slate-400 hover:text-rose-500 self-start p-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors"><Trash2 size={16} aria-hidden="true" /></button>
                        )}
                      </div>
                    ))}
                    {(!feedbacks || feedbacks.length === 0) && <p className="text-center text-slate-400">{t.dbEmpty}</p>}
                  </div>
                </div>
              </div>
            )
          )}
        </main>

        {/* Mobile bottom nav */}
        <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex justify-around p-2 z-30 pb-safe transition-colors duration-300" aria-label="Primary">
          {[['leaderboard', t.dashboard, Smartphone], ['rewards', t.rewardsTab, Gift], ['userHub', t.userHub, UserCircle], ...(isAdminAuthenticated ? [['admin', t.admin, Settings]] : []), ['about', t.about, Info]].map(([tab, label, Icon]) => (
            <button key={tab} type="button" onClick={() => setActiveTab(tab)} aria-current={activeTab === tab} className={`flex flex-col items-center p-2 flex-1 ${th.chip} transition-colors ${activeTab === tab ? th.accentSoft : 'text-slate-500 dark:text-slate-400'}`}>
              <Icon size={20} className="mb-1" aria-hidden="true" /><span className="text-[10px] font-bold">{label}</span>
            </button>
          ))}
        </nav>

        <style dangerouslySetInnerHTML={{ __html: STATIC_STYLES }} />
      </div>
    </div>
  );
}
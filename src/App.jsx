import React, { useState, useEffect, useMemo, useRef } from 'react';
import mqtt from 'mqtt';
import {
  Trophy, Users, Settings, Activity, Trash2, Award,
  Zap, UserPlus, Moon, Sun, Lock, ShieldCheck,
  Download, Edit2, Clock, CheckCircle2, XCircle, Smartphone, Server, Eraser, Globe, AlertTriangle, MessageSquare, LogOut, Check, ChevronRight, UserCircle, Loader2, Key, Info, Leaf, Recycle, Globe2, Cloud, Droplets, Medal, Star, Badge
} from 'lucide-react';

// ==========================================
// CONFIGURATION & CONSTANTS
// ==========================================
const MQTT_BROKER = import.meta.env?.VITE_MQTT_URL || 'wss://mqtt.milo-robotics.org';
// The broker now requires authentication. NOTE: a browser bundle cannot hold a
// real secret — this "browser" principal is intentionally low-privilege and its
// password is build-time public. Security is enforced by broker ACLs + the
// per-connection reply channel, not by hiding this value.
const MQTT_USER = import.meta.env?.VITE_MQTT_USER || 'browser';
const MQTT_PASS = import.meta.env?.VITE_MQTT_PASS || '';
const NS = 'milo_v2_system';

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
  /* Quality floor: visible keyboard focus everywhere. */
  :focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; border-radius: 8px; }
  /* Quality floor: respect reduced-motion preferences. */
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
// TRANSLATIONS & ACHIEVEMENTS
// ==========================================
const translations = {
  en: {
    appTitle: "Smart Recycling", dashboard: "Dashboard", admin: "Admin", userHub: "User Hub", about: "About Us",
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
    logout: "Logout", reEnterPass: "Session reloaded. Re-enter your password for secure actions.", switchLang: "Switch language", switchTheme: "Toggle dark mode"
  },
  bg: {
    appTitle: "Смарт Рециклиране", dashboard: "Табло", admin: "Админ", userHub: "Моят Профил", about: "За нас",
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
    logout: "Изход", reEnterPass: "Сесията е презаредена. Въведете паролата си отново за защитени действия.", switchLang: "Смени езика", switchTheme: "Тъмен режим"
  }
};

const getAchievementsData = (totalItems, matCounts, t) => [
  { id: 'first', title: t.badgeFirst, desc: t.badgeFirstDesc, icon: Star, req: 1, cur: totalItems, color: 'text-indigo-500', colorClass: 'text-indigo-700 bg-indigo-50 border-indigo-200 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-300' },
  { id: 'bronze', title: t.badgeBronze, desc: t.badgeBronzeDesc, icon: Medal, req: 10, cur: totalItems, color: 'text-amber-500', colorClass: 'text-amber-800 bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-400' },
  { id: 'plastic', title: t.badgePlastic, desc: t.badgePlasticDesc, icon: Recycle, req: 20, cur: matCounts.plastic || 0, color: 'text-cyan-500', colorClass: 'text-cyan-800 bg-cyan-50 border-cyan-200 dark:bg-cyan-900/30 dark:border-cyan-800 dark:text-cyan-400' },
  { id: 'glass', title: t.badgeGlass, desc: t.badgeGlassDesc, icon: Zap, req: 20, cur: matCounts.glass || 0, color: 'text-emerald-500', colorClass: 'text-emerald-800 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-400' },
];

const parseTimestamp = (ts) => {
  if (!ts) return new Date();
  const num = Number(ts);
  if (!isNaN(num) && num > 0) return new Date(num < 1e10 ? num * 1000 : num);
  return new Date();
};

// ==========================================
// UI COMPONENTS
// ==========================================
const RaccoonLogo = ({ className }) => (
  <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M20,40 L40,20 L60,20 L80,40 L90,70 L50,95 L10,70 Z" fill="currentColor" opacity="0.2"/>
    <path d="M10,40 L35,45 L50,65 L65,45 L90,40 L75,70 L50,95 L25,70 Z" fill="currentColor"/>
    <path d="M25,42 C25,42 40,35 50,45 C60,35 75,42 75,42 L80,60 C80,60 65,70 50,55 C35,70 20,60 20,60 Z" fill="#1e293b"/>
    <circle cx="35" cy="50" r="4" fill="#ffffff"/>
    <circle cx="65" cy="50" r="4" fill="#ffffff"/>
    <circle cx="50" cy="75" r="5" fill="#1e293b"/>
    <path d="M10,40 L25,10 L40,25 Z" fill="currentColor"/>
    <path d="M90,40 L75,10 L60,25 Z" fill="currentColor"/>
  </svg>
);

const Confetti = () => {
  const colors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];
  return (
    <div className="fixed inset-0 pointer-events-none z-[70] overflow-hidden" aria-hidden="true">
      {Array.from({ length: 60 }).map((_, i) => (
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
  const t = translations[lang] || translations['en']; // Ensure safe fallback

  // Keep the latest translations reachable from the MQTT message handler, which
  // is registered once (empty deps) and would otherwise close over a stale `t`.
  const tRef = useRef(t);
  tRef.current = t;

  const [orgType, setOrgType] = useState('office');
  const deptLabel = orgType === 'school' ? t.labelSchool : (orgType === 'city' ? t.labelCity : t.labelOffice);

  // Connection & Data State
  const [connectionState, setConnectionState] = useState('connecting'); // connecting | online | offline
  const isConnected = connectionState === 'online';
  const [transactions, setTransactions] = useState([]);
  const [users, setUsers] = useState({});
  const [hardwareErrors, setHardwareErrors] = useState({});
  const [feedbacks, setFeedbacks] = useState([]);
  const [profileEdits, setProfileEdits] = useState([]);
  const [adminsList, setAdminsList] = useState([]);

  // Session State
  const [loggedInUser, setLoggedInUser] = useState(null);
  const [sessionPassword, setSessionPassword] = useState(''); // In-memory only; authorizes secure user actions this session.

  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminToken, setAdminToken] = useState(null);
  const [adminRole, setAdminRole] = useState(null);

  // Forms & Temp State
  const [userView, setUserView] = useState('login');
  const [userAuthForm, setUserAuthForm] = useState({ code: '', password: '', name: '', department: '' });
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
  const [adminMessage, setAdminMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  // Async admin password reset: { status: 'pending' | 'done' | 'error', name, password? }
  const [resetFlow, setResetFlow] = useState(null);

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
  const attemptingPassRef = useRef('');   // cache password only until auth succeeds
  const pendingResetRef = useRef(null);   // { code, name, timeoutId } for in-flight reset

  // A stable per-connection client id. It scopes our private reply topic
  // (reply/<clientId>/…) AND must equal the MQTT client id we connect with, so
  // the broker ACL (pattern read reply/%c/#) lets us read only our own replies.
  const clientIdRef = useRef(null);
  if (!clientIdRef.current) {
    clientIdRef.current = 'milo_web_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  }

  // ==========================================
  // INITIALIZATION & CLEANUP
  // ==========================================
  useEffect(() => {
    setIsDarkMode(localStorage.getItem('miloTheme') === 'dark');
    const savedLang = localStorage.getItem('miloLang'); if (savedLang) setLang(savedLang);
    const savedUser = localStorage.getItem('miloLoggedIn'); if (savedUser) setLoggedInUser(savedUser);
    const savedOrg = localStorage.getItem('miloOrgType'); if (savedOrg) setOrgType(savedOrg);
  }, []);

  const toggleTheme = () => { setIsDarkMode(!isDarkMode); localStorage.setItem('miloTheme', !isDarkMode ? 'dark' : 'light'); };
  const toggleLang = () => { const newLang = lang === 'en' ? 'bg' : 'en'; setLang(newLang); localStorage.setItem('miloLang', newLang); };
  const handleOrgChange = (e) => { setOrgType(e.target.value); localStorage.setItem('miloOrgType', e.target.value); };

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
    });
    mqttClientRef.current = client;

    const topics = [
      `${NS}/transactions`, `${NS}/transactions/list`, `${NS}/errors`,
      `${NS}/users/list`, `${NS}/feedback/list`, `${NS}/profile_edit/list`,
      // Private per-connection reply channel (auth results, admin roster, reset password).
      `${NS}/reply/${clientId}/#`,
    ];

    client.on('connect', () => {
      setConnectionState('online');
      client.subscribe(topics);

      // Request initial data population
      client.publish(`${NS}/users/request`, JSON.stringify({}));
      client.publish(`${NS}/transactions/request`, JSON.stringify({}));
      client.publish(`${NS}/feedback/request`, JSON.stringify({}));
      client.publish(`${NS}/profile_edit/request`, JSON.stringify({}));
    });

    client.on('reconnect', () => setConnectionState('connecting'));
    client.on('offline', () => setConnectionState('offline'));
    client.on('error', () => setConnectionState('offline'));

    client.on('message', (topic, message) => {
      const tt = tRef.current; // always-current translations
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
                  setSessionPassword(attemptingPassRef.current || ''); // cache only on success
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
              return [data, ...prev].slice(0, 500); // Keep max 500 in memory
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
      client.end(true); // CRITICAL: Prevent memory leaks on unmount
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

  // Transaction Popup Consumer
  useEffect(() => {
    if (popupQueue.length > 0 && !activePopup) {
      const nextTx = popupQueue[0];
      setActivePopup(nextTx);
      setPopupQueue(prev => prev.slice(1));
      setHighlightedUser(nextTx.user_code);
      const t1 = setTimeout(() => {
        setActivePopup(null);
        setTimeout(() => setHighlightedUser(null), 2000);
      }, 3500);
      return () => clearTimeout(t1);
    }
  }, [popupQueue, activePopup]);

  // ==========================================
  // MEMOIZED COMPUTATIONS
  // ==========================================
  const safeTransactions = Array.isArray(transactions) ? transactions : [];
  const safeProfileEdits = Array.isArray(profileEdits) ? profileEdits : [];
  const safeUsers = users || {};

  const { top10, mostRecycled, materialsCount, totalParticipants } = useMemo(() => {
    const scores = {}; const mats = { plastic: 0, glass: 0, tin: 0, paper: 0 };
    safeTransactions.forEach(tx => {
      if (!scores[tx.user_code]) scores[tx.user_code] = { code: tx.user_code, totalPoints: 0, items: 0 };
      scores[tx.user_code].totalPoints += tx.points; scores[tx.user_code].items += 1;
      if (tx.material && mats[tx.material] !== undefined) mats[tx.material] += 1;
    });
    const sorted = Object.values(scores).sort((a, b) => b.totalPoints - a.totalPoints);
    const sortedMats = Object.keys(mats).sort((a, b) => mats[b] - mats[a]);
    return { top10: sorted.slice(0, 10), totalParticipants: sorted.length, mostRecycled: mats[sortedMats[0]] > 0 ? sortedMats[0] : "None", materialsCount: mats };
  }, [safeTransactions]);

  const userRank = useMemo(() => {
    if (!loggedInUser) return 0;
    const index = top10.findIndex(u => u.code === loggedInUser);
    return index !== -1 ? index + 1 : 0;
  }, [top10, loggedInUser]);

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
      attemptingPassRef.current = userAuthForm.password; // held in a ref; promoted to sessionPassword only on success
      setUserAuthPending(true);

      mqttClientRef.current?.publish(`${NS}/auth/request`, JSON.stringify({ req_id: reqId, code: code, password: userAuthForm.password, client_id: clientIdRef.current }));
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

    mqttClientRef.current?.publish(`${NS}/admin/auth/request`, JSON.stringify({ req_id: reqId, username: adminAuthForm.username, password: adminAuthForm.password, client_id: clientIdRef.current }));
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
    mqttClientRef.current?.publish(`${NS}/users/update`, JSON.stringify({ action: 'request', code: userAuthForm.code, name: userAuthForm.name, department: userAuthForm.department }));
    setLoginError(t.pendingMsg); setUserView('login');
  };

  const submitNewPassword = (e) => {
    e.preventDefault();
    mqttClientRef.current?.publish(`${NS}/users/update`, JSON.stringify({ action: 'set_password', code: userAuthForm.code, password: userAuthForm.password }));
    setLoggedInUser(userAuthForm.code); localStorage.setItem('miloLoggedIn', userAuthForm.code);
    setSessionPassword(userAuthForm.password);
    setUserView('login'); setUserAuthForm(prev => ({ ...prev, password: '' }));
  };

  // Secure User Actions
  const submitFeedback = (e) => {
    e.preventDefault();
    const pw = sessionPassword || feedbackConfirmPass;
    if (!feedbackText.trim() || !loggedInUser || !pw) return;

    mqttClientRef.current?.publish(`${NS}/feedback/submit`, JSON.stringify({ code: loggedInUser, message: feedbackText, user_password: pw }));
    setFeedbackText(''); setFeedbackConfirmPass(''); setFeedbackMsg(t.feedbackSent);
    setTimeout(() => setFeedbackMsg(''), 3000);
  };

  const submitProfileEdit = (e) => {
    e.preventDefault();
    const pw = sessionPassword || editProfileForm.confirmPass;
    if (!loggedInUser || !pw) return;

    mqttClientRef.current?.publish(`${NS}/profile_edit/submit`, JSON.stringify({ code: loggedInUser, name: editProfileForm.name, department: editProfileForm.department, user_password: pw }));
    setIsEditingProfile(false); setEditProfileForm({ name: '', department: '', confirmPass: '' });
  };

  // Secure Admin Actions
  const executeConfirmedAction = () => {
    if (!confirmAction || !adminToken) return;
    if (confirmAction.type === 'delete') {
      mqttClientRef.current?.publish(`${NS}/users/update`, JSON.stringify({ action: 'delete', code: confirmAction.code, admin_token: adminToken }));
    } else if (confirmAction.type === 'clear') {
      mqttClientRef.current?.publish(`${NS}/transactions/delete`, JSON.stringify({ code: confirmAction.code, admin_token: adminToken }));
    } else if (confirmAction.type === 'reset_pass') {
      // The password is now generated server-side and returned on our private
      // reply channel. Show a pending state and time out if no reply arrives.
      const clientId = clientIdRef.current;
      const name = confirmAction.name;
      const timeoutId = setTimeout(() => {
        if (pendingResetRef.current) { pendingResetRef.current = null; setResetFlow({ status: 'error', name }); }
      }, 6000);
      pendingResetRef.current = { code: confirmAction.code, name, timeoutId };
      setResetFlow({ status: 'pending', name });
      mqttClientRef.current?.publish(`${NS}/users/update`, JSON.stringify({ action: 'set_password_admin', code: confirmAction.code, admin_token: adminToken, client_id: clientId }));
    } else if (confirmAction.type === 'delete_admin') {
      mqttClientRef.current?.publish(`${NS}/admin/mgt`, JSON.stringify({ action: 'delete', username: confirmAction.code, admin_token: adminToken, client_id: clientIdRef.current }));
    }
  };

  const handleAdminSave = (e) => {
    e.preventDefault();
    if (!adminForm.code || !adminForm.name) return;
    mqttClientRef.current?.publish(`${NS}/users/update`, JSON.stringify({ action: 'set', code: adminForm.code, name: adminForm.name, department: adminForm.department, admin_token: adminToken }));
    setAdminMessage(`${adminForm.name} saved!`);
    setAdminForm({ code: '', name: '', department: '' });
    setTimeout(() => setAdminMessage(''), 3000);
  };

  const submitNewAdmin = (e) => {
    e.preventDefault();
    if (!newAdminForm.username || !newAdminForm.password) return;
    mqttClientRef.current?.publish(`${NS}/admin/mgt`, JSON.stringify({ action: 'add', username: newAdminForm.username, password: newAdminForm.password, role: newAdminForm.role, admin_token: adminToken, client_id: clientIdRef.current }));
    setNewAdminForm({ username: '', password: '', role: 'org' });
  };

  const logoutUser = () => {
    setLoggedInUser(null);
    setSessionPassword('');
    localStorage.removeItem('miloLoggedIn');
    setUserAuthForm({ ...userAuthForm, password: '' });
    setUserView('login');
  };

  const exportCSV = () => {
    const header = `Timestamp,User Code,Display Name,${deptLabel},Material,Points\n`;
    const rows = safeTransactions.map(tx => {
      const uData = safeUsers[tx.user_code] || {};
      const uName = uData.name || 'Unnamed';
      const uDept = uData.department || '';
      return `"${parseTimestamp(tx.timestamp).toLocaleString()}",${tx.user_code},"${uName}","${uDept}",${tx.material},${tx.points}`;
    }).join("\n");
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'milo_transactions.csv'; a.click();
    window.URL.revokeObjectURL(url);
  };

  // Tri-state node status presentation
  const nodeStatus = connectionState === 'online'
    ? { color: 'emerald', label: t.online, sub: t.connectedPi }
    : connectionState === 'connecting'
      ? { color: 'amber', label: t.connecting, sub: t.connecting }
      : { color: 'rose', label: t.offline, sub: t.disconnected };

  // ==========================================
  // RENDER HELPERS
  // ==========================================
  const renderPopup = () => {
    if (!activePopup) return null;
    const uName = safeUsers[activePopup.user_code]?.name || t.unnamedUser;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" role="status" aria-live="polite">
        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-8 max-w-sm w-full text-center border-4 border-indigo-500 transform transition-all animate-bounce-in">
          <div className="mx-auto w-20 h-20 bg-indigo-100 dark:bg-indigo-900/50 rounded-full flex items-center justify-center mb-6"><Trophy className="text-indigo-500 w-10 h-10" /></div>
          <h2 className="text-2xl font-black text-slate-800 dark:text-white mb-2">{t.congrats}</h2>
          <p className="text-slate-600 dark:text-slate-300 text-lg mb-6"><span className="font-bold text-indigo-600 dark:text-indigo-400">{uName}</span> {t.recycled} <span className="font-bold capitalize">{activePopup.material}</span>!</p>
          <div className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 font-black text-3xl py-4 rounded-2xl">+{activePopup.points} {t.points}</div>
        </div>
      </div>
    );
  };

  return (
    <div lang={lang} className={isDarkMode ? 'dark' : ''}>
      <div className="min-h-screen bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-sans selection:bg-indigo-200 dark:selection:bg-indigo-900 transition-colors duration-300">

        {/* Modals & Overlays */}
        {newAchievementQueue.length > 0 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true">
            <Confetti />
            <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl p-8 max-w-sm w-full text-center border-4 border-indigo-500 transform transition-all animate-bounce-in z-50 relative">
              <div className="mx-auto w-24 h-24 bg-indigo-100 dark:bg-indigo-900/50 rounded-full flex items-center justify-center mb-6">
                {React.createElement(newAchievementQueue[0].icon, { className: newAchievementQueue[0].color, size: 48 })}
              </div>
              <h2 className="text-3xl font-black text-slate-800 dark:text-white mb-2">{t.unlockedNew}</h2>
              <p className="text-indigo-600 dark:text-indigo-400 font-bold text-xl mb-6">{newAchievementQueue[0].title}</p>
              <button type="button" onClick={() => setNewAchievementQueue(prev => prev.slice(1))} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl shadow-sm transition-colors text-lg">{t.awesome}</button>
            </div>
          </div>
        )}

        {selectedAchievement && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in p-4" role="dialog" aria-modal="true">
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-700 animate-scale-in text-center">
              <div className="mx-auto w-20 h-20 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mb-4">
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
                  <div className="bg-indigo-500 h-4 rounded-full transition-all duration-1000 ease-out absolute left-0 top-0" style={{ width: `${Math.min(100, (selectedAchievement.cur / selectedAchievement.req) * 100)}%` }}></div>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedAchievement(null)} className="w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold py-3 rounded-xl transition-colors">{t.close}</button>
            </div>
          </div>
        )}

        {resetFlow && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in p-4" role="dialog" aria-modal="true">
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-700 animate-scale-in text-center">
              {resetFlow.status === 'pending' && (
                <>
                  <div className="mx-auto w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center mb-4"><Loader2 size={32} className="animate-spin" /></div>
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xl mb-2">{t.resetPassTitle}</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm">{t.generatingPass}</p>
                </>
              )}
              {resetFlow.status === 'done' && (
                <>
                  <div className="mx-auto w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mb-4"><CheckCircle2 size={32} /></div>
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xl mb-2">{t.resetPassTitle}</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">{t.newPassMsg} <strong className="text-slate-800 dark:text-slate-200">{resetFlow.name}</strong></p>
                  <div className="bg-slate-100 dark:bg-slate-900 rounded-xl p-4 mb-6 select-all font-mono text-2xl tracking-widest text-indigo-600 dark:text-indigo-400 font-black border border-slate-200 dark:border-slate-700 break-all">{resetFlow.password}</div>
                  <button type="button" onClick={() => { navigator.clipboard.writeText(resetFlow.password).catch(() => {}); setResetFlow(null); }} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-sm transition-colors">{t.copyClose}</button>
                </>
              )}
              {resetFlow.status === 'error' && (
                <>
                  <div className="mx-auto w-16 h-16 bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mb-4"><AlertTriangle size={32} /></div>
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xl mb-2">{t.resetPassTitle}</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 px-2">{t.resetTimeout}</p>
                  <button type="button" onClick={() => setResetFlow(null)} className="w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold py-3 rounded-xl transition-colors">{t.close}</button>
                </>
              )}
            </div>
          </div>
        )}

        {confirmAction && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in p-4" role="dialog" aria-modal="true">
            <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-700 animate-scale-in text-center">
              <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4 ${confirmAction.type === 'reset_pass' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400' : 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'}`}>
                {confirmAction.type === 'reset_pass' ? <Key size={32} /> : <AlertTriangle size={32} />}
              </div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xl mb-2">{t.confirmAction}</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-8 px-2">
                {confirmAction.type === 'delete' ? t.confirmDelete : (confirmAction.type === 'clear' ? t.confirmClear : (confirmAction.type === 'delete_admin' ? t.deleteAdminConfirm : t.confirmReset))}
                <br /><strong className="mt-2 block text-slate-700 dark:text-slate-300">{confirmAction.name}</strong>
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setConfirmAction(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold py-3 rounded-xl transition-colors">{t.confirmNo}</button>
                <button type="button" onClick={() => { executeConfirmedAction(); setConfirmAction(null); }} className={`flex-1 text-white font-bold py-3 rounded-xl shadow-sm transition-colors ${confirmAction.type === 'reset_pass' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-rose-600 hover:bg-rose-700'}`}>{t.confirmYes}</button>
              </div>
            </div>
          </div>
        )}

        {/* Top Header */}
        <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-20 transition-colors duration-300">
          <div className="max-w-6xl mx-auto px-4 h-16 md:h-20 flex items-center justify-between">
            <button type="button" className="flex items-center gap-3 cursor-pointer text-left" onClick={() => setActiveTab('leaderboard')} aria-label="MILO home">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-indigo-600 rounded-xl text-white flex items-center justify-center shadow-md">
                <RaccoonLogo className="w-6 h-6 md:w-8 md:h-8" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-black text-slate-800 dark:text-white tracking-tight leading-none">MILO</h1>
                <p className="text-[9px] md:text-[10px] font-bold tracking-widest text-indigo-500 uppercase">{t.appTitle}</p>
              </div>
            </button>

            <div className="flex items-center gap-2 md:gap-4">
              <div className="flex gap-1 bg-slate-100 dark:bg-slate-700 rounded-xl p-1">
                <button type="button" onClick={toggleLang} aria-label={t.switchLang} className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-600 transition-colors flex items-center gap-1">
                  <Globe size={14} aria-hidden="true" /> {lang.toUpperCase()}
                </button>
                <button type="button" onClick={toggleTheme} aria-label={t.switchTheme} aria-pressed={isDarkMode} className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-600 transition-colors">
                  {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
                </button>
              </div>
              <nav className="hidden sm:flex gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl">
                <button type="button" onClick={() => setActiveTab('leaderboard')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'leaderboard' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}>{t.dashboard}</button>
                <button type="button" onClick={() => setActiveTab('userHub')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'userHub' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}>{t.userHub}</button>
                {isAdminAuthenticated && <button type="button" onClick={() => setActiveTab('admin')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'admin' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}>{t.admin}</button>}
                <button type="button" onClick={() => setActiveTab('about')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-1 ${activeTab === 'about' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}><Info size={16} aria-hidden="true" /> {t.about}</button>
              </nav>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-6 md:py-8">

          {/* TAB: ABOUT */}
          {activeTab === 'about' && (
            <div className="space-y-8 animate-fade-in pb-24 md:pb-0">
              <div className="text-center py-12 px-4 bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 transition-colors">
                <div className="mx-auto w-24 h-24 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center mb-6">
                  <RaccoonLogo className="w-16 h-16" />
                </div>
                <h1 className="text-4xl md:text-5xl font-black text-slate-800 dark:text-white mb-4">MILO</h1>
                <p className="text-lg text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">{t.aboutHero}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 text-center transition-colors">
                  <Leaf className="w-12 h-12 text-emerald-500 mx-auto mb-4" aria-hidden="true" />
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-3">{t.ourMission}</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">{t.missionDesc}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 text-center transition-colors">
                  <Globe2 className="w-12 h-12 text-blue-500 mx-auto mb-4" aria-hidden="true" />
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-3">{t.ourVision}</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">{t.visionDesc}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 text-center transition-colors">
                  <Users className="w-12 h-12 text-amber-500 mx-auto mb-4" aria-hidden="true" />
                  <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-3">{t.team}</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">{t.teamDesc}</p>
                </div>
              </div>
            </div>
          )}

          {/* TAB: LEADERBOARD */}
          {activeTab === 'leaderboard' && (
            <div className="space-y-6 animate-fade-in pb-24 md:pb-0 relative">
              {renderPopup()}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-indigo-500 to-purple-700 rounded-3xl p-6 text-white shadow-lg relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-20"><Trash2 size={80} aria-hidden="true" /></div>
                  <div className="relative z-10">
                    <h3 className="font-semibold text-indigo-100 text-sm md:text-base">{t.topMaterial}</h3>
                    <p className="text-3xl md:text-4xl font-bold mt-2 capitalize">{mostRecycled}</p>
                    <p className="text-xs md:text-sm text-indigo-200 mt-1">{materialsCount[mostRecycled] || 0} {t.itemsProcessed}</p>
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 transition-colors duration-300">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-slate-500 dark:text-slate-400 text-sm md:text-base">{t.totalParticipants}</h3>
                    <Users size={24} className="text-blue-500" aria-hidden="true" />
                  </div>
                  <p className="text-3xl md:text-4xl font-bold mt-2">{totalParticipants}</p>
                  <p className="text-xs md:text-sm text-slate-400 mt-1">{t.activeUsers}</p>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 transition-colors duration-300">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-slate-500 dark:text-slate-400 text-sm md:text-base">{t.nodeStatus}</h3>
                    <Activity size={24} className={`text-${nodeStatus.color}-500`} aria-hidden="true" />
                  </div>
                  <p className="text-xl md:text-2xl font-bold mt-2 flex items-center gap-2" role="status" aria-live="polite">
                    <span className="relative flex h-3 w-3 md:h-4 md:w-4">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-${nodeStatus.color}-400`}></span>
                      <span className={`relative inline-flex rounded-full h-3 w-3 md:h-4 md:w-4 bg-${nodeStatus.color}-500`}></span>
                    </span>
                    {nodeStatus.label}
                  </p>
                  <p className="text-xs md:text-sm text-slate-400 mt-1">{nodeStatus.sub}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden transition-colors duration-300">
                  <div className="p-4 md:p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
                    <h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                      <Trophy className="text-amber-500" aria-hidden="true" /> {t.leaderboard}
                    </h2>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-700/50 relative">
                    {top10.map((userStats, index) => {
                      const userInfo = safeUsers[userStats.code] || { name: t.unnamedUser, department: `ID: ${userStats.code}` };
                      const isHighlighted = highlightedUser === userStats.code;
                      let rankColor = "text-slate-400 dark:text-slate-500";
                      let RankIcon = () => <span className="text-lg font-bold w-6 text-center">{index + 1}</span>;
                      if (index === 0) { rankColor = "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"; RankIcon = () => <Award size={24} />; }
                      if (index === 1) { rankColor = "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"; RankIcon = () => <Award size={24} />; }
                      if (index === 2) { rankColor = "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"; RankIcon = () => <Award size={24} />; }

                      return (
                        <div key={userStats.code} className={`p-4 md:p-6 flex flex-col sm:flex-row sm:items-center justify-between transition-all duration-700 ease-in-out gap-4 ${isHighlighted ? 'bg-emerald-50 dark:bg-emerald-900/20 transform scale-[1.02] shadow-md z-10 relative border-l-4 border-emerald-500' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30 border-l-4 border-transparent'}`}>
                          <div className="flex items-center gap-4">
                            <div className={`shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center font-bold ${rankColor} shadow-sm transition-transform duration-500 ${isHighlighted ? 'scale-110' : ''}`}><RankIcon /></div>
                            <div>
                              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base md:text-lg flex items-center gap-2 flex-wrap">
                                {userInfo.name} {!safeUsers[userStats.code] && <span className="text-[10px] uppercase bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 px-2 py-1 rounded-full shrink-0">{t.new}</span>}
                              </h3>
                              <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">{userInfo.department}</p>
                            </div>
                          </div>
                          <div className="sm:text-right flex sm:block items-end justify-between sm:justify-end pl-14 sm:pl-0">
                            <p className="text-xs text-slate-400 uppercase font-semibold sm:hidden mb-1">{t.points}</p>
                            <div>
                              <p className={`text-2xl font-black leading-none transition-colors duration-500 ${isHighlighted ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'}`}><AnimatedNumber value={userStats.totalPoints} /></p>
                              <p className="text-[10px] md:text-xs text-slate-400 uppercase font-semibold hidden sm:block mt-1">{t.points}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {top10.length === 0 && <div className="p-12 text-center text-slate-400"><Clock size={40} className="mb-4 opacity-50 mx-auto" aria-hidden="true" /><p>{t.awaitingTx}</p></div>}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden transition-colors duration-300 h-fit">
                  <div className="p-4 md:p-5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
                    <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Activity size={18} className="text-indigo-500" aria-hidden="true" /> {t.activityFeed}</h2>
                  </div>
                  <div className="p-4 md:p-5 space-y-4">
                    {safeTransactions.slice(0, 6).map(tx => {
                      const uName = safeUsers[tx.user_code]?.name || `ID: ${tx.user_code}`;
                      const timeString = parseTimestamp(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      return (
                        <div key={tx.id} className="flex items-start gap-3 animate-slide-up text-sm">
                          <div className="bg-indigo-100 dark:bg-indigo-900/40 p-2 rounded-full text-indigo-600 dark:text-indigo-400 mt-1 shrink-0"><Zap size={14} aria-hidden="true" /></div>
                          <div className="flex-1 min-w-0">
                            <p className="text-slate-800 dark:text-slate-200 break-words"><span className="font-bold truncate block sm:inline">{uName}</span> {t.recycled} <span className="font-medium capitalize">{tx.material}</span></p>
                            <div className="flex justify-between items-center mt-0.5">
                              <p className="text-indigo-500 font-semibold">+{tx.points} {t.points.toLowerCase()}</p>
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
          )}

          {/* TAB: USER HUB */}
          {activeTab === 'userHub' && (
            !loggedInUser ? (
              <div className="max-w-md mx-auto mt-12 bg-white dark:bg-slate-800 rounded-3xl shadow-lg border border-slate-200 dark:border-slate-700 p-6 md:p-8 text-center animate-scale-in transition-colors duration-300">
                <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-4"><UserCircle size={32} aria-hidden="true" /></div>
                {userView === 'login' && (
                  <div className="animate-fade-in">
                    <h2 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">{t.loginTitle}</h2>
                    <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">{t.loginDesc}</p>
                    <form onSubmit={handleUserLoginStep} className="space-y-4">
                      <input type="text" required maxLength={32} placeholder={t.userCode} aria-label={t.userCode} className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none text-center text-lg transition-colors" value={userAuthForm.code} onChange={e => setUserAuthForm({ ...userAuthForm, code: e.target.value })} />
                      {safeUsers[userAuthForm.code]?.has_password && (
                        <input type="password" required maxLength={128} placeholder={t.password} aria-label={t.password} className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none text-center text-lg transition-colors animate-slide-up" value={userAuthForm.password} onChange={e => setUserAuthForm({ ...userAuthForm, password: e.target.value })} />
                      )}
                      {loginError && <p className="text-rose-500 text-sm font-medium animate-shake flex items-center justify-center gap-1" role="alert"><AlertTriangle size={14} className="shrink-0" aria-hidden="true" />{loginError}</p>}
                      <button type="submit" disabled={userAuthPending || connectionState !== 'online'} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-4 rounded-xl transition-colors h-14 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                        {userAuthPending ? <><Loader2 size={18} className="animate-spin" /> {t.signingIn}</> : <>{t.loginBtn} <ChevronRight size={18} /></>}
                      </button>
                    </form>
                    <button type="button" onClick={() => { setUserView('request'); setLoginError(''); }} className="mt-6 text-sm text-indigo-600 dark:text-indigo-400 font-semibold hover:underline">{t.reqAccount}</button>
                    <button type="button" onClick={() => { setActiveTab('admin'); setUserView('login'); }} className="block w-full mt-4 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-medium">{t.adminPanelLink}</button>
                  </div>
                )}
                {userView === 'request' && (
                  <div className="animate-fade-in">
                    <h2 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">{t.reqTitle}</h2>
                    <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">{t.reqDesc}</p>
                    <form onSubmit={submitAccountRequest} className="space-y-4">
                      <input type="text" required maxLength={32} placeholder={t.userCode} aria-label={t.userCode} className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-center transition-colors" value={userAuthForm.code} onChange={e => setUserAuthForm({ ...userAuthForm, code: e.target.value })} />
                      <input type="text" required maxLength={64} placeholder={t.fullName} aria-label={t.fullName} className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-center transition-colors" value={userAuthForm.name} onChange={e => setUserAuthForm({ ...userAuthForm, name: e.target.value })} />
                      <input type="text" maxLength={64} placeholder={deptLabel} aria-label={deptLabel} className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-center transition-colors" value={userAuthForm.department} onChange={e => setUserAuthForm({ ...userAuthForm, department: e.target.value })} />
                      <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-4 rounded-xl transition-colors h-14">{t.reqBtn}</button>
                    </form>
                    <button type="button" onClick={() => setUserView('login')} className="mt-6 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-white font-semibold">{t.backLogin}</button>
                  </div>
                )}
                {userView === 'set_password' && (
                  <div className="animate-fade-in">
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">{t.approvedMsg}</h2>
                    <form onSubmit={submitNewPassword} className="space-y-4 mt-6">
                      <input type="password" required maxLength={128} placeholder={t.password} aria-label={t.password} className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-center text-lg transition-colors" value={userAuthForm.password} onChange={e => setUserAuthForm({ ...userAuthForm, password: e.target.value })} />
                      <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold p-4 rounded-xl transition-colors h-14">{t.setPassBtn}</button>
                    </form>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-6 animate-fade-in pb-24 md:pb-0">
                <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 transition-colors">
                  <div>
                    <h2 className="text-2xl font-black text-slate-800 dark:text-white">{t.welcome}, {safeUsers[loggedInUser]?.name || 'User'}!</h2>
                    <p className="text-slate-500 dark:text-slate-400">ID: {loggedInUser} {safeUsers[loggedInUser]?.department ? `• ${safeUsers[loggedInUser].department}` : ''}</p>
                    {!sessionPassword && <p className="text-xs text-rose-500 mt-1 font-semibold flex items-center gap-1"><AlertTriangle size={12} aria-hidden="true" /> {t.reEnterPass}</p>}
                  </div>
                  <button type="button" onClick={logoutUser} aria-label={t.logout} className="flex items-center gap-2 bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400 px-4 py-2 rounded-xl font-bold hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors"><LogOut size={16} aria-hidden="true" /> <span className="hidden sm:inline">{t.logout}</span></button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-indigo-600 rounded-3xl p-6 text-white shadow-lg"><h3 className="font-semibold text-indigo-200">{t.personalStats}</h3><p className="text-5xl font-black mt-2"><AnimatedNumber value={top10.find(u => u.code === loggedInUser)?.totalPoints || 0} /></p><p className="text-sm text-indigo-200 mt-1 uppercase tracking-wider font-bold">{t.points}</p></div>
                  <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 transition-colors"><h3 className="font-semibold text-slate-500 dark:text-slate-400">{t.rank}</h3><p className="text-4xl font-bold mt-2 text-amber-500">#{userRank || '-'}</p></div>
                  <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 transition-colors"><h3 className="font-semibold text-slate-500 dark:text-slate-400">{t.totalRecycled}</h3><p className="text-4xl font-bold mt-2 text-slate-800 dark:text-white">{top10.find(u => u.code === loggedInUser)?.items || 0}</p></div>
                </div>

                {/* Achievements Analytics */}
                {(() => {
                  const myTxs = safeTransactions.filter(tx => tx.user_code === loggedInUser);
                  let co2 = 0; let water = 0; const matCounts = { plastic: 0, glass: 0, tin: 0, paper: 0 };
                  myTxs.forEach(tx => {
                    matCounts[tx.material] = (matCounts[tx.material] || 0) + 1;
                    if (tx.material === 'plastic') { co2 += 0.08; water += 0.5; }
                    else if (tx.material === 'glass') { co2 += 0.15; water += 1.2; }
                    else if (tx.material === 'tin') { co2 += 0.20; water += 0.8; }
                    else if (tx.material === 'paper') { co2 += 0.05; water += 2.0; }
                  });
                  const totalItems = myTxs.length;
                  const achievementsList = getAchievementsData(totalItems, matCounts, t);

                  return (
                    <>
                      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mt-8 mb-4"><Globe size={20} className="text-indigo-500" aria-hidden="true" /> {t.environmentalImpact}</h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                        <div className="bg-emerald-500 rounded-3xl p-6 text-white shadow-md relative overflow-hidden"><Cloud size={80} className="absolute -bottom-4 -right-4 opacity-20" aria-hidden="true" /><h3 className="font-semibold text-emerald-100 flex items-center gap-2"><Cloud size={16} aria-hidden="true" /> {t.co2Saved}</h3><p className="text-4xl font-black mt-2"><AnimatedNumber value={parseFloat(co2.toFixed(1))} /> <span className="text-xl">kg</span></p></div>
                        <div className="bg-blue-500 rounded-3xl p-6 text-white shadow-md relative overflow-hidden"><Droplets size={80} className="absolute -bottom-4 -right-4 opacity-20" aria-hidden="true" /><h3 className="font-semibold text-blue-100 flex items-center gap-2"><Droplets size={16} aria-hidden="true" /> {t.waterSaved}</h3><p className="text-4xl font-black mt-2"><AnimatedNumber value={parseFloat(water.toFixed(1))} /> <span className="text-xl">L</span></p></div>
                      </div>

                      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mt-8 mb-4"><Badge size={20} className="text-indigo-500" aria-hidden="true" /> {t.achievements}</h2>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                        {achievementsList.map(ach => {
                          const isUnlocked = ach.cur >= ach.req; const Icon = ach.icon;
                          return (
                            <button type="button" key={ach.id} onClick={() => setSelectedAchievement(ach)} aria-label={`${ach.title} — ${isUnlocked ? t.unlocked : t.locked}`} className={`p-4 rounded-3xl text-center border-2 cursor-pointer transition-all hover:scale-105 active:scale-95 shadow-sm ${isUnlocked ? ach.colorClass : 'bg-slate-50 border-slate-100 text-slate-400 dark:bg-slate-800 dark:border-slate-700'}`}>
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
                  {/* Edit Profile Form (Secure Action) */}
                  <div className="flex flex-col gap-6">
                    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden transition-colors flex-1">
                      <div className="p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50"><h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Settings size={18} className="text-indigo-500" aria-hidden="true" /> {t.editProfile}</h2></div>
                      <div className="p-6">
                        {safeProfileEdits.find(ed => ed.code === loggedInUser) ? (
                          <div className="p-4 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-xl flex items-center gap-3 animate-fade-in font-semibold border border-amber-200 dark:border-amber-800"><Clock size={20} className="shrink-0" aria-hidden="true" /> {t.editPending}</div>
                        ) : !isEditingProfile ? (
                          <button type="button" onClick={() => { setEditProfileForm({ name: safeUsers[loggedInUser]?.name || '', department: safeUsers[loggedInUser]?.department || '', confirmPass: '' }); setIsEditingProfile(true); }} className="w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold p-4 rounded-xl transition-colors flex items-center justify-center gap-2"><Edit2 size={18} aria-hidden="true" /> {t.editProfile}</button>
                        ) : (
                          <form onSubmit={submitProfileEdit} className="space-y-4 animate-fade-in">
                            <input type="text" required maxLength={64} placeholder={t.fullName} aria-label={t.fullName} className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-colors" value={editProfileForm.name} onChange={e => setEditProfileForm({ ...editProfileForm, name: e.target.value })} />
                            <input type="text" maxLength={64} placeholder={deptLabel} aria-label={deptLabel} className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-colors" value={editProfileForm.department} onChange={e => setEditProfileForm({ ...editProfileForm, department: e.target.value })} />
                            {!sessionPassword && <input type="password" required maxLength={128} placeholder={t.confirmPass} aria-label={t.confirmPass} className="w-full p-4 rounded-xl border border-rose-200 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-100 focus:ring-2 focus:ring-rose-500 outline-none transition-colors" value={editProfileForm.confirmPass} onChange={e => setEditProfileForm({ ...editProfileForm, confirmPass: e.target.value })} />}
                            <div className="flex gap-2"><button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-3 rounded-xl transition-colors shadow-sm">{t.requestEdit}</button><button type="button" onClick={() => setIsEditingProfile(false)} className="bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold p-3 px-6 rounded-xl transition-colors">{t.cancel}</button></div>
                          </form>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Feedback Form (Secure Action) */}
                  <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden transition-colors h-fit">
                    <div className="p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50"><h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><MessageSquare size={18} className="text-indigo-500" aria-hidden="true" /> {t.feedbackHub}</h2></div>
                    <div className="p-6">
                      {feedbackMsg && <div className="mb-4 p-3 bg-emerald-50 text-emerald-700 rounded-xl flex items-center gap-2 animate-fade-in" role="status" aria-live="polite"><Check size={16} aria-hidden="true" /> {feedbackMsg}</div>}
                      <form onSubmit={submitFeedback}>
                        <textarea required maxLength={1000} placeholder={t.feedbackPh} aria-label={t.feedbackHub} rows="4" className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-colors resize-none mb-4" value={feedbackText} onChange={e => setFeedbackText(e.target.value)} />
                        {!sessionPassword && <input type="password" required maxLength={128} placeholder={t.confirmPass} aria-label={t.confirmPass} className="w-full p-4 rounded-xl border border-rose-200 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-100 focus:ring-2 focus:ring-rose-500 outline-none transition-colors mb-4" value={feedbackConfirmPass} onChange={e => setFeedbackConfirmPass(e.target.value)} />}
                        <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-4 rounded-xl transition-colors">{t.sendFeedback}</button>
                      </form>
                    </div>
                  </div>
                </div>
              </div>
            )
          )}

          {/* TAB: ADMIN */}
          {activeTab === 'admin' && (
            !isAdminAuthenticated ? (
              <div className="max-w-md mx-auto mt-12 bg-white dark:bg-slate-800 rounded-3xl shadow-lg border border-slate-200 dark:border-slate-700 p-6 md:p-8 text-center animate-fade-in transition-colors duration-300">
                <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-4"><Lock size={32} aria-hidden="true" /></div>
                <h2 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">{t.adminAccess}</h2>
                <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">{t.enterPassword}</p>
                <form onSubmit={handleAdminLogin} className="space-y-4">
                  <input type="text" required maxLength={32} placeholder={t.username} aria-label={t.username} className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-center text-lg" value={adminAuthForm.username} onChange={e => setAdminAuthForm({ ...adminAuthForm, username: e.target.value })} />
                  <input type="password" required maxLength={128} placeholder={t.passwordHint} aria-label={t.passwordHint} className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-center text-lg" value={adminAuthForm.password} onChange={e => setAdminAuthForm({ ...adminAuthForm, password: e.target.value })} />
                  {adminAuthError && <p className="text-rose-500 text-sm font-medium animate-shake flex items-center justify-center gap-1" role="alert"><XCircle size={14} aria-hidden="true" /> {adminAuthError}</p>}
                  <button type="submit" disabled={adminAuthPending || connectionState !== 'online'} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-4 rounded-xl transition-colors flex items-center justify-center gap-2 h-14 disabled:opacity-60 disabled:cursor-not-allowed">
                    {adminAuthPending ? <><Loader2 size={20} className="animate-spin" /> {t.signingIn}</> : <><ShieldCheck size={20} /> {t.unlockDashboard}</>}
                  </button>
                </form>
              </div>
            ) : (
              <div className="space-y-6 animate-fade-in pb-24 md:pb-0">
                <div className="bg-slate-800 dark:bg-slate-900 rounded-2xl p-4 flex items-center gap-3 text-slate-200 shadow-lg">
                  <Server size={20} className="text-indigo-400" aria-hidden="true" />
                  <div className="flex-1"><h4 className="font-bold text-sm">{t.dbConnection}</h4><p className="text-xs text-slate-400">{isConnected ? t.connected2Way : (connectionState === 'connecting' ? t.connecting : t.disconnected)}</p></div>
                  <button type="button" onClick={exportCSV} className="text-xs flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-2 rounded-lg font-semibold transition-colors"><Download size={14} aria-hidden="true" /> <span className="hidden sm:inline">{t.exportData}</span></button>
                  <button type="button" onClick={() => { setIsAdminAuthenticated(false); setAdminToken(null); setAdminRole(null); }} aria-label={t.logout} className="text-xs flex items-center gap-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 px-3 py-2 rounded-lg font-semibold transition-colors"><LogOut size={14} aria-hidden="true" /></button>
                </div>

                {adminRole === 'super' && (
                  <>
                    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-6 transition-colors duration-300">
                      <div className="flex justify-between items-center mb-4"><h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Activity className="text-rose-500" aria-hidden="true" /> {t.hardwareDiagnostics}</h2>{Object.keys(hardwareErrors).length > 0 && <button type="button" onClick={() => setHardwareErrors({})} className="text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-lg font-semibold">{t.clearErrors}</button>}</div>
                      {Object.keys(hardwareErrors).length === 0 ? (
                        <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center gap-2 text-sm font-semibold"><CheckCircle2 size={18} aria-hidden="true" /> {t.noErrors}</div>
                      ) : (
                        <div className="space-y-2">
                          {Object.entries(hardwareErrors).map(([errName, errTimestamp]) => (
                            <div key={errName} className="p-4 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 rounded-xl border border-rose-200 dark:border-rose-800 flex items-start gap-3 text-sm font-semibold animate-shake" role="alert">
                              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                              <div><p>{(errName || "").includes("FAN_STALL") ? t.fanError : errName}</p><p className="text-xs text-rose-500/70 mt-1 font-normal">{parseTimestamp(errTimestamp).toLocaleString()}</p></div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 transition-colors">
                      <h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-6"><ShieldCheck className="text-indigo-500" aria-hidden="true" /> {t.adminAccounts}</h2>
                      <form onSubmit={submitNewAdmin} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-6">
                        <div className="space-y-1"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.username}</label><input type="text" required maxLength={32} placeholder="admin2" className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 outline-none h-12" value={newAdminForm.username} onChange={e => setNewAdminForm({ ...newAdminForm, username: e.target.value })} /></div>
                        <div className="space-y-1"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.password}</label><input type="password" required maxLength={128} placeholder="***" className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 outline-none h-12" value={newAdminForm.password} onChange={e => setNewAdminForm({ ...newAdminForm, password: e.target.value })} /></div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.role}</label>
                          <select className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 outline-none h-12" value={newAdminForm.role} onChange={e => setNewAdminForm({ ...newAdminForm, role: e.target.value })}>
                            <option value="org">{t.roleOrg}</option>
                            <option value="super">{t.roleSuper}</option>
                          </select>
                        </div>
                        <button type="submit" className="bg-indigo-600 text-white font-bold p-3 rounded-xl hover:bg-indigo-700 h-12 flex items-center justify-center gap-2"><UserPlus size={18} aria-hidden="true" /> {t.addAdmin}</button>
                      </form>
                      <div className="space-y-2">
                        {Array.isArray(adminsList) && adminsList.map(admin => (
                          <div key={admin.username} className="flex justify-between items-center bg-slate-50 dark:bg-slate-700/30 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
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
                  <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-amber-200 dark:border-amber-700/50 p-4 md:p-6 transition-colors duration-300 animate-slide-up">
                    <h2 className="text-lg md:text-xl font-bold text-amber-800 dark:text-amber-400 flex items-center gap-2 mb-4"><Edit2 size={20} aria-hidden="true" /> {t.profileEdits} ({safeProfileEdits.length})</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {safeProfileEdits.map((edit) => {
                        const currentData = safeUsers[edit.code] || {};
                        return (
                          <div key={edit.code} className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 p-4 rounded-2xl flex flex-col gap-3">
                            <div className="flex justify-between items-start"><p className="font-bold text-amber-900 dark:text-amber-300">ID: {edit.code}</p></div>
                            <div className="text-sm grid grid-cols-2 gap-3 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800/50 p-3 rounded-xl">
                              <div><p className="text-[10px] text-slate-400 font-bold uppercase mb-1">{t.current}</p><p className="font-semibold">{currentData.name}</p><p className="text-xs text-slate-500">{currentData.department}</p></div>
                              <div className="border-l border-slate-200 dark:border-slate-700 pl-3"><p className="text-[10px] text-amber-500 dark:text-amber-400 font-bold uppercase mb-1">{t.requested}</p><p className="font-semibold text-amber-700 dark:text-amber-300">{edit.new_name}</p><p className="text-xs text-amber-600 dark:text-amber-400/80">{edit.new_department}</p></div>
                            </div>
                            <div className="flex gap-2 mt-1">
                              <button type="button" onClick={() => mqttClientRef.current?.publish(`${NS}/profile_edit/resolve`, JSON.stringify({ action: 'approve', code: edit.code, admin_token: adminToken }))} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-xl text-sm font-bold shadow-sm transition-colors">{t.approve}</button>
                              <button type="button" onClick={() => mqttClientRef.current?.publish(`${NS}/profile_edit/resolve`, JSON.stringify({ action: 'reject', code: edit.code, admin_token: adminToken }))} className="flex-1 bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-rose-900/40 dark:hover:bg-rose-900/60 dark:text-rose-400 py-2 rounded-xl text-sm font-bold transition-colors">{t.reject}</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Unmapped IDs */}
                {suggestedIds.length > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-3xl p-4 md:p-6 transition-colors duration-300">
                    <h3 className="text-amber-800 dark:text-amber-400 font-bold flex items-center gap-2 mb-2 text-sm md:text-base"><Zap className="fill-current" size={18} aria-hidden="true" /> {t.unmappedFound}</h3>
                    <p className="text-xs md:text-sm text-amber-700 dark:text-amber-500 mb-4">{t.tapToAssign}</p>
                    <div className="flex flex-wrap gap-2">
                      {suggestedIds.map(id => (<button type="button" key={id} onClick={() => setAdminForm({ ...adminForm, code: id })} className="bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400 px-4 py-2 rounded-xl text-sm font-bold hover:bg-amber-100 dark:hover:bg-slate-700 transition-colors shadow-sm min-h-[44px]">ID: {id} +</button>))}
                    </div>
                  </div>
                )}

                {/* Directory Management */}
                <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-6 transition-colors duration-300">
                  <h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-6"><Settings className="text-indigo-500" aria-hidden="true" /> {t.manageProfiles}</h2>
                  {adminMessage && <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-xl flex items-center gap-2 text-sm font-semibold animate-fade-in" role="status" aria-live="polite"><CheckCircle2 size={18} aria-hidden="true" /> {adminMessage}</div>}
                  <form onSubmit={handleAdminSave} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="space-y-1"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.userCode}</label><input type="text" required maxLength={32} placeholder="1234" className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none h-12" value={adminForm.code} onChange={e => setAdminForm({ ...adminForm, code: e.target.value })} /></div>
                    <div className="space-y-1"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.fullName}</label><input type="text" required maxLength={64} placeholder="Jane Doe" className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none h-12" value={adminForm.name} onChange={e => setAdminForm({ ...adminForm, name: e.target.value })} /></div>
                    <div className="space-y-1"><label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{deptLabel}</label><input type="text" maxLength={64} placeholder="…" className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none h-12" value={adminForm.department} onChange={e => setAdminForm({ ...adminForm, department: e.target.value })} /></div>
                    <button type="submit" className="bg-indigo-600 text-white font-bold p-3 rounded-xl hover:bg-indigo-700 h-12 flex items-center justify-center gap-2"><UserPlus size={18} aria-hidden="true" /> {t.save}</button>
                  </form>
                </div>

                {/* Directory Table */}
                <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden transition-colors duration-300">
                  <div className="p-4 md:p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
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
                            <td className="p-4 font-mono text-indigo-500 dark:text-indigo-400 font-semibold">{code}</td>
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
                <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden transition-colors duration-300">
                  <div className="p-4 md:p-6 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><MessageSquare size={18} className="text-indigo-500" aria-hidden="true" /> {t.adminFeedback}</h3>
                  </div>
                  <div className="p-4 md:p-6 space-y-4">
                    {Array.isArray(feedbacks) && feedbacks.map(fb => (
                      <div key={fb.id} className="bg-slate-50 dark:bg-slate-700/30 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 flex justify-between gap-4">
                        <div className="flex-1">
                          <p className="font-bold text-slate-800 dark:text-slate-100 mb-1">{safeUsers[fb.user_code]?.name || fb.user_code}</p>
                          <p className="text-slate-600 dark:text-slate-300 text-sm whitespace-pre-wrap">{fb.message}</p>
                          <p className="text-[10px] text-slate-400 mt-2">{parseTimestamp(fb.timestamp).toLocaleString()}</p>
                        </div>
                        {adminRole === 'super' && (
                          <button type="button" onClick={() => mqttClientRef.current?.publish(`${NS}/feedback/delete`, JSON.stringify({ id: fb.id, admin_token: adminToken }))} aria-label="Delete feedback" className="text-slate-400 hover:text-rose-500 self-start p-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors"><Trash2 size={16} aria-hidden="true" /></button>
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

        <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex justify-around p-2 z-30 pb-safe transition-colors duration-300" aria-label="Primary">
          <button type="button" onClick={() => setActiveTab('leaderboard')} aria-current={activeTab === 'leaderboard'} className={`flex flex-col items-center p-2 flex-1 rounded-xl transition-colors ${activeTab === 'leaderboard' ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30' : 'text-slate-500 dark:text-slate-400'}`}><Smartphone size={20} className="mb-1" aria-hidden="true" /><span className="text-[10px] font-bold">{t.dashboard}</span></button>
          <button type="button" onClick={() => setActiveTab('userHub')} aria-current={activeTab === 'userHub'} className={`flex flex-col items-center p-2 flex-1 rounded-xl transition-colors ${activeTab === 'userHub' ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30' : 'text-slate-500 dark:text-slate-400'}`}><UserCircle size={20} className="mb-1" aria-hidden="true" /><span className="text-[10px] font-bold">{t.userHub}</span></button>
          {isAdminAuthenticated && <button type="button" onClick={() => setActiveTab('admin')} aria-current={activeTab === 'admin'} className={`flex flex-col items-center p-2 flex-1 rounded-xl transition-colors ${activeTab === 'admin' ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30' : 'text-slate-500 dark:text-slate-400'}`}><Settings size={20} className="mb-1" aria-hidden="true" /><span className="text-[10px] font-bold">{t.admin}</span></button>}
          <button type="button" onClick={() => setActiveTab('about')} aria-current={activeTab === 'about'} className={`flex flex-col items-center p-2 flex-1 rounded-xl transition-colors ${activeTab === 'about' ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30' : 'text-slate-500 dark:text-slate-400'}`}><Info size={20} className="mb-1" aria-hidden="true" /><span className="text-[10px] font-bold">{t.about}</span></button>
        </nav>

        <style dangerouslySetInnerHTML={{ __html: STATIC_STYLES }} />
      </div>
    </div>
  );
}
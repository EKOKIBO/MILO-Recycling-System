import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import mqtt from 'mqtt';
import {
  Trophy, Users, Settings, Activity, Trash2, Award,
  Zap, UserPlus, Moon, Sun, Lock, ShieldCheck,
  Download, Edit2, Clock, CheckCircle2, XCircle, Smartphone, Server, Eraser, Globe,
  AlertTriangle, MessageSquare, LogOut, Check, ChevronRight, UserCircle, Loader2, Key, Info,
  Leaf, Recycle, Globe2, Cloud, Droplets, Star, Badge,
  Gift, Bell, FileDown, UserX, Timer, Car, ShowerHead, BatteryCharging, Flag, Sparkles,
  Wrench, Camera, RefreshCw, Fan, Flame, Target, LifeBuoy
} from 'lucide-react';
import { translations, DAYS, LEGAL } from './i18n/translations';
import {
  DEFAULT_IMPACT_CFG, THEMES, STATIC_STYLES,
  getLevel, getAchievementsData, impactFrom
} from './constants/themes';
import {
  parseTimestamp, localWeekStart, resizeImageToDataUrl, urlBase64ToUint8Array
} from './utils/helpers';
import { MascotLogo, RewardVisual, Confetti, AnimatedNumber } from './components/CommonUI';

// ==========================================
// CONFIGURATION & CONSTANTS
// ==========================================
const MQTT_BROKER = import.meta.env?.VITE_MQTT_URL || 'wss://mqtt.milo-robotics.org';
// The broker requires authentication. NOTE: a browser bundle cannot hold a real
// secret — this "browser" principal is intentionally low-privilege and its
// password is build-time public. Security is enforced by broker ACLs + the
// per-connection reply channel, not by hiding this value.
const MQTT_USER = import.meta.env?.VITE_MQTT_USER || 'browser';
const MQTT_PASS = import.meta.env?.VITE_MQTT_PASS || 'milo_browser_public';
// Web Push: public VAPID key (pair generated with `npx web-push generate-vapid-keys`;
// the private half lives ONLY on the Pi as MILO_VAPID_PRIVATE_KEY).
const VAPID_PUBLIC_KEY = import.meta.env?.VITE_VAPID_PUBLIC_KEY || 'BFEREDv8zD4h3UumMdzp-aV4S7KusQAlb_0ihjhh72A3_y-dYtvaEYuNfHGqRzGbvVdZu2kdFlwwCT1jJVUXZvg';
const NS = 'milo_v2_system';
const FRONTEND_BUILD = '2026-11-02.3'; // shown in the admin bar next to the backend build

// ==========================================
// MAIN APP COMPONENT
// ==========================================
export default function App() {
  // Global UI State
  const [activeTab, setActiveTab] = useState('leaderboard');
  const [adminTab, setAdminTab] = useState('users');   // admin sub-navigation
  const [hubTab, setHubTab] = useState('overview');    // user hub sub-navigation
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [lang, setLang] = useState('en');
  const t = translations[lang] || translations['en'];

  // Keep the latest translations reachable from the once-registered MQTT handler.
  const tRef = useRef(t);
  tRef.current = t;

  const [orgType, setOrgType] = useState('office');

  // Fleet: stats carries the machine registry + per-machine scopes; declared
  // here (not with the other data state) because the theme derives from it.
  const [stats, setStats] = useState(null);
  // Machine context follows the user's activity: when their deposit event
  // arrives from machine X, the UI adopts X's environment (theme) and offers
  // machine-scoped views. Remembered per device.
  const [machineCtx, setMachineCtx] = useState(null);
  const [boardScope, setBoardScope] = useState('network'); // 'network' | 'machine'
  const [targetMachine, setTargetMachine] = useState('');  // admin: maintenance/bins target

  const machines = stats?.machines || {};
  const ctxEnv = machines[machineCtx]?.env || '';
  const th = THEMES[ctxEnv || orgType] || THEMES.office;
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
  const [rewards, setRewards] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [seasonView, setSeasonView] = useState('week'); // 'week' | 'all'
  const [, setNowTick] = useState(Date.now());          // re-render for the countdown

  // Session State
  const [loggedInUser, setLoggedInUser] = useState(null);
  const [sessionPassword, setSessionPassword] = useState('');
  // Full-account persistent session token (survives reloads via localStorage;
  // quick accounts never get one).
  const [sessionToken, setSessionToken] = useState(null);
  const [stayLoggedIn, setStayLoggedIn] = useState(true);
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
  const [rewardForm, setRewardForm] = useState({ title: '', title_bg: '', cost: '', stock: '-1', icon: '🎁', description: '', description_bg: '', photo: '' });
  const [upgradeForm, setUpgradeForm] = useState({ age: '', phone: '', email: '', confirmPass: '', pending: false });
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
  const [impactCfg, setImpactCfg] = useState(DEFAULT_IMPACT_CFG); // synced via config/list (impact_json)
  const [impactDraft, setImpactDraft] = useState(null);           // admin editor working copy
  const [analyticsData, setAnalyticsData] = useState(null);       // admin: per-user waste profiles
  const [binCaps, setBinCaps] = useState({});                     // admin: capacity input drafts
  const [recoveryKit, setRecoveryKit] = useState(null);           // admin: downloadable install/repair kit
  const [repairUiUrl, setRepairUiUrl] = useState(() => localStorage.getItem('miloRepairUrl') || 'http://192.168.1.17:8088');
  const [showRepairEmbed, setShowRepairEmbed] = useState(false);
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
  const pendingUpgradeRef = useRef(null);   // { code, pass } when upgrading from the login screen
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

  const applyColorScheme = (dark) => {
    document.documentElement.classList.toggle('dark', dark);
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = dark ? 'dark' : 'light';
  };

  // ==========================================
  // INITIALIZATION & CLEANUP
  // ==========================================
  useEffect(() => {
    const savedTheme = localStorage.getItem('miloTheme');
    const savedDark = localStorage.getItem('miloDark');
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const dark = savedDark !== null ? savedDark === '1' : (savedTheme ? savedTheme === 'dark' : prefersDark);
    setIsDarkMode(dark);
    document.documentElement.classList.toggle('dark', dark);
    const savedLang = localStorage.getItem('miloLang'); if (savedLang) setLang(savedLang);
    const savedUser = localStorage.getItem('miloLoggedIn'); if (savedUser) setLoggedInUser(savedUser);
    const savedTok = localStorage.getItem('miloSessionTok'); if (savedTok) setSessionToken(savedTok);
    const savedMachine = localStorage.getItem('miloMachine'); if (savedMachine) setMachineCtx(savedMachine);
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

  const toggleTheme = () => {
    const next = !isDarkMode;
    setIsDarkMode(next);
    localStorage.setItem('miloTheme', next ? 'dark' : 'light');
    localStorage.setItem('miloDark', next ? '1' : '0');
    applyColorScheme(next);
  };
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
                  if (data.token) {
                    // Full login: the backend granted a persistent device session.
                    setSessionToken(data.token);
                    localStorage.setItem('miloSessionTok', data.token);
                  }
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
                  setAdminTab('users');
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
            case 'upgrade_result': {
              setUpgradeForm(f => ({ ...f, pending: false }));
              if (data.success) {
                if (data.token) {
                  setSessionToken(data.token);
                  localStorage.setItem('miloSessionTok', data.token);
                }
                // Login-screen upgrade: the user wasn't logged in yet — the
                // successful password-verified upgrade doubles as their login.
                const pu = pendingUpgradeRef.current;
                if (pu) {
                  pendingUpgradeRef.current = null;
                  setLoggedInUser(pu.code);
                  localStorage.setItem('miloLoggedIn', pu.code);
                  setSessionPassword(pu.pass);
                  setUserView('login');
                }
                setUpgradeForm({ age: '', phone: '', email: '', confirmPass: '', pending: false });
                setToast({ msg: tt.upgradeOk, type: 'ok' });
              } else {
                pendingUpgradeRef.current = null;
                setToast({ msg: tt.upgradeFail, type: 'err' });
              }
              setTimeout(() => setToast(null), 4000);
              break;
            }
            case 'analytics':
              setAnalyticsData(data && typeof data === 'object' ? data : {});
              break;
            case 'analytics_export': {
              const rows = Array.isArray(data.rows) ? data.rows : [];
              if (pendingReportRef.current) {
                pendingReportRef.current = false;
                buildReportRef.current?.(rows);
                break;
              }
              const header = 'id,timestamp,iso_time,user_code,department,material,points,machine_id\n';
              const body = rows.map(r => {
                const iso = new Date((Number(r[1]) || 0) * 1000).toISOString();
                return `${r[0]},${r[1]},${iso},${r[2]},"${String(r[3] || '').replace(/"/g, '""')}",${r[4]},${r[5]},${r[6] || ''}`;
              }).join('\n');
              const blob = new Blob([header + body], { type: 'text/csv' });
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = 'milo_dataset.csv'; a.click();
              window.URL.revokeObjectURL(url);
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
                setSessionToken(null);
                localStorage.removeItem('miloLoggedIn');
                localStorage.removeItem('miloSessionTok');
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
            // Follow-the-activity machine context: the UI adopts the machine
            // where the deposit just happened (and remembers it).
            if (data.machine_id) {
              setMachineCtx(data.machine_id);
              localStorage.setItem('miloMachine', data.machine_id);
            }
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
            if (data && data.repair_ui_url) {
              setRepairUiUrl(data.repair_ui_url);
              localStorage.setItem('miloRepairUrl', data.repair_ui_url);
            }
            if (data && ['office', 'school', 'city'].includes(data.org_type)) {
              setOrgType(data.org_type);
              localStorage.setItem('miloOrgType', data.org_type);
            }
            if (data && typeof data.impact_json === 'string') {
              try {
                const ic = JSON.parse(data.impact_json);
                if (ic && typeof ic === 'object') {
                  setImpactCfg({
                    factors: { ...IMPACT, ...(ic.factors || {}) },
                    kgCo2PerKm: Number(ic.kgCo2PerKm) > 0 ? Number(ic.kgCo2PerKm) : DEFAULT_IMPACT_CFG.kgCo2PerKm,
                    lPerShower: Number(ic.lPerShower) > 0 ? Number(ic.lPerShower) : DEFAULT_IMPACT_CFG.lPerShower,
                    kwhPerCharge: Number(ic.kwhPerCharge) > 0 ? Number(ic.kwhPerCharge) : DEFAULT_IMPACT_CFG.kwhPerCharge,
                  });
                }
              } catch { /* malformed config — keep defaults */ }
            }
            break;
          case `${NS}/errors`:
            setHardwareErrors(prev => ({ ...prev, [data.machine_id ? `${data.error} · ${data.machine_id}` : data.error]: Date.now() }));
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
  const safeTransactions = useMemo(() => (Array.isArray(transactions) ? transactions : []), [transactions]);
  const safeProfileEdits = useMemo(() => (Array.isArray(profileEdits) ? profileEdits : []), [profileEdits]);
  const safeUsers = useMemo(() => (users || {}), [users]);

  // "Equals to" conversion rates derived from the admin-tunable config.
  const EQ = {
    kmPerKgCo2: 1 / (impactCfg.kgCo2PerKm || 0.12),
    showersPerL: 1 / (impactCfg.lPerShower || 50),
    chargesPerKwh: 1 / (impactCfg.kwhPerCharge || 0.012),
  };

  const weekStart = stats?.week_start || localWeekStart();
  const resetCountdown = (() => {
    const secsLeft = Math.max(0, weekStart + 7 * 86400 - Math.floor(Date.now() / 1000));
    const d = Math.floor(secsLeft / 86400);
    const h = Math.floor((secsLeft % 86400) / 3600);
    const m = Math.floor((secsLeft % 3600) / 60);
    return d > 0 ? `${d}d ${h}h` : (h > 0 ? `${h}h ${m}m` : `${m}m`);
  })(); // ticks via setNowTick re-render

  // Client-side fallback aggregation (used until the first stats broadcast).
  const fallbackScope = useMemo(() => {
    const build = (txs) => {
      const users_ = {}; const teams_ = {}; const materials_ = {};
      const teamMembers = {}; // BUG FIX: members was initialized to 0 and never counted
      txs.forEach(tx => {
        if (!users_[tx.user_code]) users_[tx.user_code] = { points: 0, items: 0, materials: {} };
        users_[tx.user_code].points += tx.points; users_[tx.user_code].items += 1;
        users_[tx.user_code].materials[tx.material] = (users_[tx.user_code].materials[tx.material] || 0) + 1;
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

  // Board scope: 'machine' narrows the public boards to the current machine
  // context; identity-level numbers (rank, balance) always stay network-wide.
  const scopeData = useCallback((view) => {
    if (boardScope === 'machine' && machineCtx && stats?.by_machine?.[machineCtx]) {
      const bm = stats.by_machine[machineCtx];
      return view === 'week' ? (bm.weekly || {}) : (bm.all_time || {});
    }
    const source = stats && stats.weekly && stats.all_time ? stats : fallbackScope;
    return view === 'week' ? source.weekly : source.all_time;
  }, [boardScope, machineCtx, stats, fallbackScope]);

  // Leaderboard for the selected season view
  const board = useMemo(() => {
    const scope = scopeData(seasonView);
    return Object.entries(scope.users || {})
      .map(([code, v]) => ({ code, totalPoints: v.points, items: v.items }))
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, 10);
  }, [scopeData, seasonView]);

  // Team standings for the selected season view
  const teamBoard = useMemo(() => {
    const scope = scopeData(seasonView);
    return Object.entries(scope.teams || {})
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 6);
  }, [scopeData, seasonView]);

  // All-time personal numbers — ALWAYS network-wide, never machine-scoped:
  // rank, balance and achievements are properties of the person, not a machine.
  const allTimeUsers = useMemo(() => {
    const source = stats && stats.all_time ? stats.all_time : fallbackScope.all_time;
    return Object.entries(source.users || {})
      .map(([code, v]) => ({ code, totalPoints: v.points, items: v.items, materials: v.materials }))
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
  }, [scopeData]);

  const communityImpact = useMemo(() => {
    const source = stats && stats.all_time ? stats.all_time : fallbackScope.all_time;
    return impactFrom(source.materials, impactCfg.factors);
  }, [stats, fallbackScope, impactCfg]);

  const userRank = useMemo(() => {
    if (!loggedInUser) return 0;
    const index = allTimeUsers.findIndex(u => u.code === loggedInUser);
    return index !== -1 ? index + 1 : 0;
  }, [allTimeUsers, loggedInUser]);

  const myEarned = allTimeUsers.find(u => u.code === loggedInUser)?.totalPoints || 0;
  const myItems = allTimeUsers.find(u => u.code === loggedInUser)?.items || 0;

  // All-time and weekly per-user material counts from backend stats (with fallback
  // to safeTransactions when stats haven't arrived yet), avoiding the 500-tx truncation bug.
  const myMatCounts = useMemo(() => {
    const base = { plastic: 0, glass: 0, tin: 0, paper: 0 };
    if (!loggedInUser) return base;
    const srvMats = stats?.all_time?.users?.[loggedInUser]?.materials;
    if (srvMats && typeof srvMats === 'object') {
      return { ...base, ...srvMats };
    }
    safeTransactions.forEach(tx => {
      if (tx.user_code === loggedInUser) base[tx.material] = (base[tx.material] || 0) + 1;
    });
    return base;
  }, [stats, safeTransactions, loggedInUser]);

  const myWeeklyMatCounts = useMemo(() => {
    const base = { plastic: 0, glass: 0, tin: 0, paper: 0 };
    if (!loggedInUser) return base;
    const srvMats = stats?.weekly?.users?.[loggedInUser]?.materials;
    if (srvMats && typeof srvMats === 'object') {
      return { ...base, ...srvMats };
    }
    safeTransactions.forEach(tx => {
      const tsec = Number(tx.timestamp) < 1e10 ? Number(tx.timestamp) : Number(tx.timestamp) / 1000;
      if (tx.user_code === loggedInUser && tsec >= weekStart) {
        base[tx.material] = (base[tx.material] || 0) + 1;
      }
    });
    return base;
  }, [stats, safeTransactions, loggedInUser, weekStart]);

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
    if (!loggedInUser || myItems === 0) return;
    const achievementsList = getAchievementsData(myItems, myMatCounts, t, stats?.streaks?.[loggedInUser] || 0);
    const unlockedNow = achievementsList.filter(a => a.cur >= a.req).map(a => a.id);
    const seenKey = `milo_achievements_seen_${loggedInUser}`;
    const seenIds = JSON.parse(localStorage.getItem(seenKey) || '[]');
    const newlyUnlockedIds = unlockedNow.filter(id => !seenIds.includes(id));
    if (newlyUnlockedIds.length > 0) {
      const newAchs = achievementsList.filter(a => newlyUnlockedIds.includes(a.id));
      setNewAchievementQueue(prev => [...prev, ...newAchs]);
      localStorage.setItem(seenKey, JSON.stringify([...seenIds, ...newlyUnlockedIds]));
    }
  }, [myItems, myMatCounts, loggedInUser, t, stats]);

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
      // Full accounts may opt into a persistent device session; quick accounts
      // keep the existing session-only behavior.
      const remember = uData?.account_type === 'full' && stayLoggedIn;
      pub(`${NS}/auth/request`, JSON.stringify({ req_id: reqId, code: code, password: userAuthForm.password, client_id: clientIdRef.current, remember }));
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
    if (!feedbackText.trim() || !loggedInUser || (!pw && !sessionToken)) return;
    pub(`${NS}/feedback/submit`, JSON.stringify({ code: loggedInUser, message: feedbackText, user_password: pw || '', user_token: sessionToken || '' }));
    setFeedbackText(''); setFeedbackConfirmPass(''); setFeedbackMsg(t.feedbackSent);
    setTimeout(() => setFeedbackMsg(''), 3000);
  };

  const submitProfileEdit = (e) => {
    e.preventDefault();
    const pw = sessionPassword || editProfileForm.confirmPass;
    if (!loggedInUser || (!pw && !sessionToken)) return;
    pub(`${NS}/profile_edit/submit`, JSON.stringify({ code: loggedInUser, name: editProfileForm.name, department: editProfileForm.department, user_password: pw || '', user_token: sessionToken || '' }));
    setIsEditingProfile(false); setEditProfileForm({ name: '', department: '', confirmPass: '' });
  };

  // Quick -> full account migration: password-verified, inherits the existing
  // profile/points/history, returns a persistent device session token.
  const submitUpgrade = (e) => {
    e.preventDefault();
    const pw = sessionPassword || upgradeForm.confirmPass;
    const age = parseInt(upgradeForm.age, 10);
    if (!loggedInUser || !pw || !upgradeForm.email || !upgradeForm.phone || !Number.isFinite(age)) return;
    setUpgradeForm(f => ({ ...f, pending: true }));
    pub(`${NS}/users/update`, JSON.stringify({
      action: 'upgrade_full', code: loggedInUser, user_password: pw,
      email: upgradeForm.email, phone: upgradeForm.phone, age,
      client_id: clientIdRef.current
    }));
    setTimeout(() => setUpgradeForm(f => (f.pending ? { ...f, pending: false } : f)), 8000);
  };

  // Same migration, launched from the login screen before any session exists:
  // the password proves ownership, and success logs the user straight in.
  const submitLoginUpgrade = (e) => {
    e.preventDefault();
    const code = userAuthForm.code;
    const pw = upgradeForm.confirmPass;
    const age = parseInt(upgradeForm.age, 10);
    if (!code || !pw || !upgradeForm.email || !upgradeForm.phone || !Number.isFinite(age)) return;
    pendingUpgradeRef.current = { code, pass: pw };
    setUpgradeForm(f => ({ ...f, pending: true }));
    pub(`${NS}/users/update`, JSON.stringify({
      action: 'upgrade_full', code, user_password: pw,
      email: upgradeForm.email, phone: upgradeForm.phone, age,
      client_id: clientIdRef.current
    }));
    setTimeout(() => {
      pendingUpgradeRef.current = null;
      setUpgradeForm(f => (f.pending ? { ...f, pending: false } : f));
    }, 8000);
  };

  // --- Admin: environmental impact settings ---
  const saveImpact = (e) => {
    e.preventDefault();
    if (!impactDraft || !adminToken) return;
    const factors = {};
    ['plastic', 'glass', 'tin', 'paper'].forEach(m => {
      factors[m] = {
        co2: parseFloat(impactDraft[`${m}_co2`]) || 0,
        water: parseFloat(impactDraft[`${m}_water`]) || 0,
        energy: parseFloat(impactDraft[`${m}_energy`]) || 0,
      };
    });
    const cfg = {
      factors,
      kgCo2PerKm: parseFloat(impactDraft.kgCo2PerKm) || DEFAULT_IMPACT_CFG.kgCo2PerKm,
      lPerShower: parseFloat(impactDraft.lPerShower) || DEFAULT_IMPACT_CFG.lPerShower,
      kwhPerCharge: parseFloat(impactDraft.kwhPerCharge) || DEFAULT_IMPACT_CFG.kwhPerCharge,
    };
    setImpactCfg(cfg); // optimistic; the config/list echo confirms
    pub(`${NS}/config/set`, JSON.stringify({ key: 'impact_json', value: JSON.stringify(cfg), admin_token: adminToken }));
    showToast(t.settingsSaved, 'ok');
  };

  // Populate the impact editor whenever the System tab opens.
  useEffect(() => {
    if (activeTab !== 'admin' || adminTab !== 'system') return;
    const d = { kgCo2PerKm: String(impactCfg.kgCo2PerKm), lPerShower: String(impactCfg.lPerShower), kwhPerCharge: String(impactCfg.kwhPerCharge) };
    ['plastic', 'glass', 'tin', 'paper'].forEach(m => {
      const f = impactCfg.factors[m] || { co2: 0, water: 0, energy: 0 };
      d[`${m}_co2`] = String(f.co2); d[`${m}_water`] = String(f.water); d[`${m}_energy`] = String(f.energy);
    });
    setImpactDraft(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, adminTab]);

  // Admin: keep a valid maintenance/bins target machine selected.
  useEffect(() => {
    const ids = Object.keys(stats?.machines || {});
    if (ids.length && (!targetMachine || !ids.includes(targetMachine))) {
      setTargetMachine(machineCtx && ids.includes(machineCtx) ? machineCtx : ids[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, targetMachine, machineCtx]);

  // Recovery kit manifest: published alongside the app by the build (see
  // scripts/sync-recovery.mjs), so the scripts offered here always match this
  // deployment. The one-liner points at wherever the app itself is hosted.
  const recoveryCmd = recoveryKit?.install_command
    || `curl -fsSL ${typeof window !== 'undefined' ? window.location.origin : ''}/recovery/install.sh | sudo bash`;
  useEffect(() => {
    if (activeTab !== 'admin' || adminTab !== 'system' || recoveryKit) return;
    fetch('/recovery/manifest.json')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && Array.isArray(d.files)) setRecoveryKit(d); })
      .catch(() => {});
  }, [activeTab, adminTab, recoveryKit]);

  // Fetch waste analytics when that admin tab opens.
  useEffect(() => {
    if (activeTab === 'admin' && adminTab === 'analytics' && adminToken && isConnected) {
      setAnalyticsData(null);
      pub(`${NS}/analytics/request`, JSON.stringify({ admin_token: adminToken, client_id: clientIdRef.current }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, adminTab, adminToken, isConnected]);

  const pendingReportRef = useRef(false);   // next analytics_export reply becomes a report, not a CSV
  const buildReportRef = useRef(null);      // latest report builder (fresh state for the MQTT handler)

  const downloadDataset = () => {
    pendingReportRef.current = false;
    pub(`${NS}/analytics/export`, JSON.stringify({ admin_token: adminToken, client_id: clientIdRef.current }));
  };

  const downloadMonthlyReport = () => {
    pendingReportRef.current = true;
    pub(`${NS}/analytics/export`, JSON.stringify({ admin_token: adminToken, client_id: clientIdRef.current }));
  };

  // Monthly operator report: aggregates the exported dataset's last 30 days
  // into a printable standalone HTML file.
  buildReportRef.current = (rows) => {
    const since = Date.now() / 1000 - 30 * 86400;
    const recent = rows.filter(r => Number(r[1]) >= since);
    const mats = {}; const usersAgg = {}; const teamsAgg = {};
    recent.forEach(r => {
      mats[r[4]] = (mats[r[4]] || 0) + 1;
      const u = usersAgg[r[2]] = usersAgg[r[2]] || { items: 0, points: 0 };
      u.items += 1; u.points += r[5] || 0;
      if (r[3]) {
        const tm = teamsAgg[r[3]] = teamsAgg[r[3]] || { items: 0, points: 0 };
        tm.items += 1; tm.points += r[5] || 0;
      }
    });
    const imp = impactFrom(mats, impactCfg.factors);
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const matRows = Object.entries(mats).sort((a, b) => b[1] - a[1]).map(([m, n]) => `<tr><td style="text-transform:capitalize">${esc(m)}</td><td>${n}</td></tr>`).join('');
    const userRows = Object.entries(usersAgg).sort((a, b) => b[1].points - a[1].points).slice(0, 10)
      .map(([c, v], i) => `<tr><td>${i + 1}</td><td>${esc(safeUsers[c]?.name || c)}</td><td>${v.items}</td><td>${v.points}</td></tr>`).join('');
    const teamRows = Object.entries(teamsAgg).sort((a, b) => b[1].points - a[1].points).slice(0, 5)
      .map(([nm, v], i) => `<tr><td>${i + 1}</td><td>${esc(nm)}</td><td>${v.items}</td><td>${v.points}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.reportTitle)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;color:#1e293b}
h1{margin-bottom:.25rem}table{border-collapse:collapse;width:100%;margin:1rem 0}
td,th{border:1px solid #e2e8f0;padding:.5rem .75rem;text-align:left}th{background:#f1f5f9}
.kpi{display:inline-block;background:#f1f5f9;border-radius:12px;padding:1rem 1.5rem;margin:.25rem;font-weight:700}</style></head><body>
<h1>${esc(t.reportTitle)}</h1><p>${esc(t.reportPeriod)} · ${new Date().toLocaleDateString()}</p>
<div><span class="kpi">${esc(t.kpiItems)}: ${recent.length}</span><span class="kpi">${esc(t.kpiActive)}: ${Object.keys(usersAgg).length}</span><span class="kpi">${esc(t.co2Saved)}: ${imp.co2.toFixed(1)} kg</span><span class="kpi">${esc(t.waterSaved)}: ${imp.water.toFixed(0)} L</span><span class="kpi">${esc(t.energySaved)}: ${imp.energy.toFixed(1)} kWh</span></div>
<h2>${esc(t.impactBreakdown)}</h2><table><tr><th>${esc(t.materialCol)}</th><th>${esc(t.kpiItems)}</th></tr>${matRows}</table>
<h2>${esc(t.leaderboard)}</h2><table><tr><th>#</th><th>${esc(t.fullName)}</th><th>${esc(t.kpiItems)}</th><th>${esc(t.points)}</th></tr>${userRows}</table>
${teamRows ? `<h2>${esc(t.teamStandings)}</h2><table><tr><th>#</th><th></th><th>${esc(t.kpiItems)}</th><th>${esc(t.points)}</th></tr>${teamRows}</table>` : ''}
<p style="color:#94a3b8;font-size:.8rem">${esc(t.impactDisclaimer)}</p>
</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'milo_monthly_report.html'; a.click();
    window.URL.revokeObjectURL(url);
  };

  // --- Admin: bin fill management (per target machine) ---
  const emptyBin = (m) => {
    pub(`${NS}/bins/manage`, JSON.stringify({ action: 'empty', material: m, machine_id: targetMachine, admin_token: adminToken }));
  };
  const saveBinCap = (m) => {
    const c = parseInt(binCaps[m], 10);
    if (!Number.isFinite(c) || c <= 0) return;
    pub(`${NS}/bins/manage`, JSON.stringify({ action: 'capacity', material: m, capacity: c, machine_id: targetMachine, admin_token: adminToken }));
    setBinCaps(prev => { const n = { ...prev }; delete n[m]; return n; });
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
    if (!pw && !sessionToken) return;
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
      code: loggedInUser, user_password: pw || '', user_token: sessionToken || '', reward_id: rm.reward.id, client_id: clientIdRef.current
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
      photo: rewardForm.photo,
      admin_token: adminToken
    }));
    setRewardForm({ title: '', title_bg: '', cost: '', stock: '-1', icon: '🎁', description: '', description_bg: '', photo: '' });
  };

  const handleRewardPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 320);
      if (dataUrl.length > 140000) { showToast(t.photoTooLarge, 'err'); return; }
      setRewardForm(f => ({ ...f, photo: dataUrl }));
    } catch {
      showToast(t.photoTooLarge, 'err');
    }
  };

  // --- Web Push ---
  const enableNotifications = async () => {
    if (pushState === 'unsupported' || pushState === 'denied') return;
    if (!sessionPassword && !sessionToken) { showToast(t.notifNeedPass, 'err'); return; }
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
        code: loggedInUser, user_password: sessionPassword || '', user_token: sessionToken || '', subscription: sub.toJSON()
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
    // Deleting the account is destructive and always requires the password;
    // exporting may ride on a full-account device session.
    if (gm.mode === 'delete' ? !pw : (!pw && !sessionToken)) return;
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
      code: loggedInUser, user_password: pw || '',
      user_token: gm.mode === 'export' ? (sessionToken || '') : '',
      client_id: clientIdRef.current
    }));
  };

  // --- Maintenance mode (targets the machine selected in the System tab) ---
  const setMachineMaint = (enabled) => {
    pub(`${NS}/maintenance/mode`, JSON.stringify({ enabled, machine_id: targetMachine, admin_token: adminToken, client_id: clientIdRef.current }));
    setMaintMode(enabled);
    if (enabled) setFanStates([true, true]); // firmware defaults both fans ON in maintenance
    if (!enabled) { setAutoRefresh(false); setSnapshot(null); }
  };

  const toggleFan = (idx) => {
    const next = [...fanStates];
    next[idx] = !next[idx];
    setFanStates(next);
    pub(`${NS}/maintenance/fan`, JSON.stringify({ fan: idx + 1, on: next[idx], machine_id: targetMachine, admin_token: adminToken, client_id: clientIdRef.current }));
  };

  const requestSnapshot = () => {
    if (pendingSnapRef.current) return; // one in flight at a time
    setSnapshotPending(true);
    pendingSnapRef.current = setTimeout(() => {
      pendingSnapRef.current = null;
      setSnapshotPending(false);
      setSnapshot({ error: 'timeout' });
    }, 8000);
    pub(`${NS}/maintenance/snapshot`, JSON.stringify({ machine_id: targetMachine, admin_token: adminToken, client_id: clientIdRef.current }));
  };
  requestSnapshotRef.current = requestSnapshot;

  const jog = (steps) => {
    pub(`${NS}/maintenance/jog`, JSON.stringify({ motor: jogMotor, steps, machine_id: targetMachine, admin_token: adminToken, client_id: clientIdRef.current }));
  };

  // --- Admin: machine registry editing (name + environment/theme) ---
  const [machineForm, setMachineForm] = useState({ name: '', env: '' });
  useEffect(() => {
    const m = stats?.machines?.[targetMachine];
    if (m) setMachineForm({ name: m.name || '', env: m.env || '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMachine, stats]);
  const saveMachine = (e) => {
    e.preventDefault();
    if (!targetMachine) return;
    pub(`${NS}/machines/manage`, JSON.stringify({
      machine_id: targetMachine, name: machineForm.name, env: machineForm.env, admin_token: adminToken
    }));
    showToast(t.settingsSaved, 'ok');
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
    if (maintMode && (activeTab !== 'admin' || adminTab !== 'system' || !isAdminAuthenticated)) {
      if (adminToken) {
        pub(`${NS}/maintenance/mode`, JSON.stringify({ enabled: false, machine_id: targetMachine, admin_token: adminToken, client_id: clientIdRef.current }));
      }
      setMaintMode(false); setAutoRefresh(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, adminTab, isAdminAuthenticated, maintMode, adminToken]);

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
    // Revoke the persistent device session server-side (best-effort).
    if (sessionToken) pub(`${NS}/auth/logout`, JSON.stringify({ token: sessionToken }));
    setLoggedInUser(null);
    setSessionPassword('');
    setSessionToken(null);
    localStorage.removeItem('miloLoggedIn');
    localStorage.removeItem('miloSessionTok');
    setUserAuthForm({ code: '', password: '', name: '', department: '', consent: false });
    setUpgradeForm({ age: '', phone: '', email: '', confirmPass: '', pending: false });
    setUserView('login');
    setHubTab('overview');
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
        {(th.confetti || activePopup.lucky) && <Confetti count={activePopup.lucky ? 90 : orgType === 'school' ? 60 : 25} />}
        <div className={`bg-white dark:bg-slate-800 ${th.card} shadow-2xl p-8 max-w-sm w-full text-center border-4 ${activePopup.lucky ? 'border-amber-400' : orgType === 'school' ? 'border-violet-500' : orgType === 'city' ? 'border-emerald-600' : 'border-indigo-500'} transform transition-all animate-bounce-in`}>
          <div className={`mx-auto w-20 h-20 ${th.accentSoft} ${th.chip} flex items-center justify-center mb-6`}><Trophy className="w-10 h-10" /></div>
          <h2 className="text-2xl font-black text-slate-800 dark:text-white mb-2">{t.congrats}</h2>
          <p className="text-slate-600 dark:text-slate-300 text-lg mb-2"><span className={`font-bold ${th.accentText}`}>{uName}</span> {t.recycled} <span className="font-bold capitalize">{activePopup.material}</span>!</p>
          {activePopup.machine_id && <p className="text-xs text-slate-400 mb-4">📍 {machines[activePopup.machine_id]?.name || activePopup.machine_id}</p>}
          {!activePopup.machine_id && <div className="mb-4"></div>}
          <div className={`bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 font-black text-3xl py-4 ${th.card}`}>+{activePopup.points} {t.points}</div>
          {activePopup.lucky && (
            <div className={`mt-3 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-black py-3 ${th.card} animate-bounce-in`}>🍀 {t.luckyTitle} <span className="block text-xs font-bold mt-1">{t.luckyDesc}</span></div>
          )}
          {activePopup.streak_bonus > 0 && (
            <p className="mt-3 text-sm font-black text-orange-500 flex items-center justify-center gap-1"><Flame size={16} aria-hidden="true" /> {activePopup.streak} {t.streakLabel} · +{activePopup.streak_bonus} {t.streakBonusLbl}</p>
          )}
          {activePopup.challenge_bonus > 0 && (
            <p className={`mt-3 text-sm font-black ${th.accentText} flex items-center justify-center gap-1`}><Target size={16} aria-hidden="true" /> {t.challengeDone} +{activePopup.challenge_bonus}</p>
          )}
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
              <div className="mb-4 flex justify-center"><RewardVisual reward={redeemModal.reward} imgCls="w-20 h-20 rounded-2xl" emojiCls="text-5xl" /></div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xl mb-2">{t.redeemConfirmTitle}</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-2">{lang === 'bg' && redeemModal.reward.title_bg ? redeemModal.reward.title_bg : redeemModal.reward.title}</p>
              <p className={`font-black text-2xl mb-4 ${th.accentText}`}>-{redeemModal.reward.cost} {t.points}</p>
              <p className="text-slate-500 dark:text-slate-400 text-xs mb-6">{t.redeemConfirmMsg}</p>
              {!sessionPassword && !sessionToken && (
                <input type="password" required maxLength={128} placeholder={t.confirmPass} aria-label={t.confirmPass}
                       className={`${inputCls} mb-4 text-center`} value={redeemModal.pass}
                       onChange={e => setRedeemModal({ ...redeemModal, pass: e.target.value })} />
              )}
              <div className="flex gap-3">
                <button type="button" onClick={() => setRedeemModal(null)} disabled={redeemModal.pending} className={`flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold py-3 ${th.btnShape} transition-colors disabled:opacity-50`}>{t.confirmNo}</button>
                <button type="button" onClick={confirmRedeem} disabled={redeemModal.pending || (!sessionPassword && !sessionToken && !redeemModal.pass)} className={`flex-1 ${btnPrimary} py-3 shadow-sm disabled:opacity-60 flex items-center justify-center gap-2`}>
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
              {/* Deletion always demands the password; export may use the device session. */}
              {(gdprModal.mode === 'delete' ? !sessionPassword : (!sessionPassword && !sessionToken)) && (
                <input type="password" required maxLength={128} placeholder={t.confirmPass} aria-label={t.confirmPass}
                       className={`${inputCls} mb-4 text-center`} value={gdprModal.pass}
                       onChange={e => setGdprModal({ ...gdprModal, pass: e.target.value })} />
              )}
              <div className="flex gap-3">
                <button type="button" onClick={() => setGdprModal(null)} disabled={gdprModal.busy} className={`flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold py-3 ${th.btnShape} transition-colors disabled:opacity-50`}>{t.confirmNo}</button>
                <button type="button" onClick={runGdpr} disabled={gdprModal.busy || (gdprModal.mode === 'delete' ? (!sessionPassword && !gdprModal.pass) : (!sessionPassword && !sessionToken && !gdprModal.pass))} className={`flex-1 font-bold py-3 ${th.btnShape} shadow-sm text-white transition-colors disabled:opacity-60 flex items-center justify-center gap-2 ${gdprModal.mode === 'delete' ? 'bg-rose-600 hover:bg-rose-700' : th.accentBtn}`}>
                  {gdprModal.busy ? <Loader2 size={16} className="animate-spin" /> : null} {t.confirmYes}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Environmental impact detail modal */}
        {impactModal && (() => {
          const meta = {
            co2: { label: t.co2Saved, unit: 'kg', factor: 'co2', icon: Cloud, eqIcon: Car, eq: (v) => `${Math.round(v * EQ.kmPerKgCo2)} ${t.eqKm}` },
            water: { label: t.waterSaved, unit: 'L', factor: 'water', icon: Droplets, eqIcon: ShowerHead, eq: (v) => `${Math.round(v * EQ.showersPerL)} ${t.eqShowers}` },
            energy: { label: t.energySaved, unit: 'kWh', factor: 'energy', icon: Zap, eqIcon: BatteryCharging, eq: (v) => `${Math.round(v * EQ.chargesPerKwh)} ${t.eqCharges}` },
          }[impactModal.metric];
          const rows = Object.entries(impactModal.matCounts || {}).filter(([m, n]) => n > 0 && impactCfg.factors[m]);
          const total = rows.reduce((s, [m, n]) => s + impactCfg.factors[m][meta.factor] * n, 0);
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
                      <span className="text-slate-500 dark:text-slate-400 text-right text-xs">{impactCfg.factors[m][meta.factor].toFixed(2)} {meta.unit} {t.impactPerItem} = <strong className={th.accentText}>{(impactCfg.factors[m][meta.factor] * n).toFixed(1)} {meta.unit}</strong></span>
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
              <div className="mb-3 flex justify-center"><RewardVisual reward={rewardInfoModal} imgCls="w-28 h-28 rounded-2xl" emojiCls="text-6xl" /></div>
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
        <header className="bg-white/85 dark:bg-slate-800/85 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-700/80 sticky top-0 z-20 transition-colors duration-300">
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

            {/* Current machine context (follows your latest deposit) */}
            {machineCtx && machines[machineCtx] && (
              <span className={`hidden md:inline-flex items-center gap-1.5 ${th.accentSoft} ${th.chip} px-3 py-1.5 text-xs font-bold`} title={machines[machineCtx].location || machineCtx}>
                📍 {machines[machineCtx].name}{machines[machineCtx].online ? '' : ` · ${t.offlineTag}`}
              </span>
            )}

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
              <div className={`${cardCls} ${th.cardPad} flex flex-wrap items-center justify-center gap-6`}>
                <button type="button" onClick={() => setActiveTab('privacy')} className={`text-sm font-bold ${th.accentText} hover:underline flex items-center gap-1.5`}><ShieldCheck size={16} aria-hidden="true" /> {t.privacyPolicy}</button>
                <button type="button" onClick={() => setActiveTab('terms')} className={`text-sm font-bold ${th.accentText} hover:underline flex items-center gap-1.5`}><Info size={16} aria-hidden="true" /> {t.termsOfService}</button>
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
                {/* Machine scope: network-wide vs the machine you're at */}
                {machineCtx && stats?.by_machine?.[machineCtx] && (
                  <div className={`flex gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-1 ${th.chip} shadow-sm`} role="tablist" aria-label={t.machineSelect}>
                    <button type="button" role="tab" aria-selected={boardScope === 'network'} onClick={() => setBoardScope('network')} className={`px-4 py-2 ${th.chip} text-sm font-bold transition-all ${boardScope === 'network' ? th.accentSoft : 'text-slate-500 dark:text-slate-400'}`}>{t.networkScope}</button>
                    <button type="button" role="tab" aria-selected={boardScope === 'machine'} onClick={() => setBoardScope('machine')} className={`px-4 py-2 ${th.chip} text-sm font-bold transition-all ${boardScope === 'machine' ? th.accentSoft : 'text-slate-500 dark:text-slate-400'}`}>📍 {machines[machineCtx]?.name || t.thisMachine}</button>
                  </div>
                )}
                {seasonView === 'week' && (
                  <div className={`flex items-center gap-2 text-sm font-bold ${th.accentText} bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-2 ${th.chip} shadow-sm`}>
                    <Timer size={16} aria-hidden="true" /> {t.resetsIn} {resetCountdown}
                  </div>
                )}
              </div>

              {/* Weekly challenge banner */}
              {stats?.challenge && (
                <div className={`${cardCls} ${th.cardPad} flex flex-wrap items-center justify-between gap-3`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`${th.accentSoft} p-3 ${th.chip} shrink-0`}><Target size={22} aria-hidden="true" /></div>
                    <div className="min-w-0">
                      <p className="font-black text-slate-800 dark:text-slate-100">{t.challengeTitle}</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400 capitalize">{t.challengeDesc.replace('{target}', stats.challenge.target).replace('{material}', stats.challenge.material)}</p>
                    </div>
                  </div>
                  <span className={`font-black text-lg ${th.accentText} shrink-0`}>{t.challengeReward.replace('{bonus}', stats.challenge.bonus)} {t.points.toLowerCase()}</span>
                </div>
              )}

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
                  {connectionState !== 'online' && (
                    <a href={repairUiUrl} target="_blank" rel="noopener noreferrer" className={`mt-3 inline-flex items-center gap-1.5 text-xs font-bold ${th.accentText} hover:underline`}>
                      <Wrench size={13} aria-hidden="true" /> {lang === 'bg' ? 'Отвори Технически Панел (Ремонт)' : 'Open Technician Repair UI'} →
                    </a>
                  )}
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
                                {userInfo.name}
                                {(() => { const lv = getLevel(userStats.items, lang); return lv && <span title={lv.name} aria-label={lv.name} className="text-sm shrink-0">{lv.icon}</span>; })()}
                                {(stats?.streaks?.[userStats.code] || 0) >= 2 && <span className="text-[11px] font-black text-orange-500 shrink-0">🔥{stats.streaks[userStats.code]}</span>}
                                {!safeUsers[userStats.code] && <span className={`text-[10px] uppercase bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 px-2 py-1 ${th.chip} shrink-0`}>{t.new}</span>}
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

                  {/* Trophy cabinet: past weekly season winners */}
                  {Array.isArray(stats?.seasons) && stats.seasons.length > 0 && (
                    <div className={`${cardCls} overflow-hidden h-fit`}>
                      <div className={`${th.dense ? 'p-4' : 'p-4 md:p-5'} border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50`}>
                        <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Trophy size={18} className="text-amber-500" aria-hidden="true" /> {t.trophyCabinet}</h2>
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                        {stats.seasons.slice(0, 6).map(s => (
                          <div key={s.week_start} className={`${th.dense ? 'p-3' : 'p-4'} text-sm`}>
                            <p className="text-[11px] text-slate-400 font-semibold mb-1">{t.weekOf} {new Date(s.week_start * 1000).toLocaleDateString()}</p>
                            {s.team && <p className="font-bold text-slate-800 dark:text-slate-100">🏆 {s.team} <span className={`${th.accentText} font-black`}>{s.team_points}</span></p>}
                            <p className="text-slate-600 dark:text-slate-300">⭐ {s.user_name || s.user_code} <span className={`${th.accentText} font-black`}>{s.user_points}</span></p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

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
                    <p className="text-xs text-emerald-600/80 dark:text-emerald-500 mt-1 flex items-center gap-1"><Car size={12} aria-hidden="true" /> ≈ {Math.round(communityImpact.co2 * EQ.kmPerKgCo2)} {t.eqKm}</p>
                  </button>
                  <button type="button" onClick={() => setImpactModal({ metric: 'water', matCounts: scopeData('all').materials })} className={`text-left bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 ${th.card} p-4 hover:shadow-md hover:scale-[1.01] transition-all`}>
                    <p className="text-xs font-bold uppercase text-blue-700 dark:text-blue-400 flex items-center gap-1"><Droplets size={14} aria-hidden="true" /> {t.waterSaved}</p>
                    <p className="text-2xl font-black mt-1 text-blue-800 dark:text-blue-300">{communityImpact.water.toFixed(0)} L</p>
                    <p className="text-xs text-blue-600/80 dark:text-blue-500 mt-1 flex items-center gap-1"><ShowerHead size={12} aria-hidden="true" /> ≈ {Math.round(communityImpact.water * EQ.showersPerL)} {t.eqShowers}</p>
                  </button>
                  <button type="button" onClick={() => setImpactModal({ metric: 'energy', matCounts: scopeData('all').materials })} className={`text-left bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 ${th.card} p-4 hover:shadow-md hover:scale-[1.01] transition-all`}>
                    <p className="text-xs font-bold uppercase text-amber-700 dark:text-amber-400 flex items-center gap-1"><Zap size={14} aria-hidden="true" /> {t.energySaved}</p>
                    <p className="text-2xl font-black mt-1 text-amber-800 dark:text-amber-300">{communityImpact.energy.toFixed(1)} kWh</p>
                    <p className="text-xs text-amber-600/80 dark:text-amber-500 mt-1 flex items-center gap-1"><BatteryCharging size={12} aria-hidden="true" /> ≈ {Math.round(communityImpact.energy * EQ.chargesPerKwh)} {t.eqCharges}</p>
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
                          <RewardVisual reward={r} imgCls="w-10 h-10 rounded-lg" emojiCls="text-3xl" />
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
                        <RewardVisual reward={r} imgCls="w-24 h-24 rounded-2xl" emojiCls="text-6xl" />
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
                      {/* Full accounts can stay signed in on this device */}
                      {safeUsers[userAuthForm.code]?.has_password && safeUsers[userAuthForm.code]?.account_type === 'full' && (
                        <label className="flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400 cursor-pointer animate-slide-up">
                          <input type="checkbox" checked={stayLoggedIn} onChange={e => setStayLoggedIn(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
                          {t.stayLoggedIn}
                        </label>
                      )}
                      {loginError && <p className="text-rose-500 text-sm font-medium animate-shake flex items-center justify-center gap-1" role="alert"><AlertTriangle size={14} className="shrink-0" aria-hidden="true" />{loginError}</p>}
                      <button type="submit" disabled={userAuthPending || connectionState !== 'online'} className={`w-full ${btnPrimary} p-4 h-14 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed`}>
                        {userAuthPending ? <><Loader2 size={18} className="animate-spin" /> {t.signingIn}</> : <>{t.loginBtn} <ChevronRight size={18} /></>}
                      </button>
                    </form>
                    <button type="button" onClick={() => { setUserView('request'); setLoginError(''); }} className={`mt-6 text-sm ${th.accentText} font-semibold hover:underline`}>{t.reqAccount}</button>
                    {safeUsers[userAuthForm.code]?.has_password && safeUsers[userAuthForm.code]?.account_type !== 'full' && (
                      <button type="button" onClick={() => { setUserView('upgrade'); setLoginError(''); }} className={`block w-full mt-4 text-sm ${th.accentText} font-semibold hover:underline animate-fade-in`}>{t.upgradeLink}</button>
                    )}
                    <button type="button" onClick={() => { setActiveTab('admin'); setUserView('login'); }} className="block w-full mt-4 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-medium">{t.adminPanelLink}</button>
                    <a href={repairUiUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 font-medium">
                      <Wrench size={12} aria-hidden="true" /> {lang === 'bg' ? 'Технически Ремонтен Панел (8088)' : 'Technician Repair & Configure UI (8088)'}
                    </a>
                  </div>
                )}
                {userView === 'upgrade' && (
                  <div className="animate-fade-in">
                    <h2 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">{t.fullAccountTitle}</h2>
                    <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">{t.upgradeDesc}</p>
                    <form onSubmit={submitLoginUpgrade} className="space-y-4">
                      <input type="text" required maxLength={32} placeholder={t.userCode} aria-label={t.userCode} className={`${inputCls} text-center`} value={userAuthForm.code} onChange={e => setUserAuthForm({ ...userAuthForm, code: e.target.value })} />
                      <input type="password" required maxLength={128} placeholder={t.password} aria-label={t.password} className={`${inputCls} text-center`} value={upgradeForm.confirmPass} onChange={e => setUpgradeForm({ ...upgradeForm, confirmPass: e.target.value })} />
                      <div className="grid grid-cols-3 gap-3">
                        <input type="number" required min={1} max={120} placeholder={t.ageLabel} aria-label={t.ageLabel} className={`${inputCls} text-center col-span-1`} value={upgradeForm.age} onChange={e => setUpgradeForm({ ...upgradeForm, age: e.target.value })} />
                        <input type="tel" required maxLength={32} placeholder={t.phoneLabel} aria-label={t.phoneLabel} className={`${inputCls} text-center col-span-2`} value={upgradeForm.phone} onChange={e => setUpgradeForm({ ...upgradeForm, phone: e.target.value })} />
                      </div>
                      <input type="email" required maxLength={128} placeholder={t.emailLabel} aria-label={t.emailLabel} className={`${inputCls} text-center`} value={upgradeForm.email} onChange={e => setUpgradeForm({ ...upgradeForm, email: e.target.value })} />
                      <button type="submit" disabled={upgradeForm.pending || connectionState !== 'online'} className={`w-full ${btnPrimary} p-4 h-14 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed`}>
                        {upgradeForm.pending ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} aria-hidden="true" />} {t.upgradeBtn}
                      </button>
                    </form>
                    <button type="button" onClick={() => setUserView('login')} className="mt-6 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-white font-semibold">{t.backLogin}</button>
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
                      <p className="text-[11px] text-slate-400">{t.legalSee} <button type="button" onClick={() => setActiveTab('terms')} className={`${th.accentText} font-semibold hover:underline`}>{t.termsOfService}</button> {t.and} <button type="button" onClick={() => setActiveTab('privacy')} className={`${th.accentText} font-semibold hover:underline`}>{t.privacyPolicy}</button>.</p>
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
                      {!sessionPassword && !sessionToken && <p className="text-xs text-rose-500 mt-1 font-semibold flex items-center gap-1"><AlertTriangle size={12} aria-hidden="true" /> {t.reEnterPass}</p>}
                      {(stats?.streaks?.[loggedInUser] || 0) >= 2 && <p className="text-xs font-black text-orange-500 mt-1 flex items-center gap-1"><Flame size={12} aria-hidden="true" /> {stats.streaks[loggedInUser]} {t.streakLabel}</p>}
                    </div>
                  </div>
                  <button type="button" onClick={logoutUser} aria-label={t.logout} className={`flex items-center gap-2 bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400 px-4 py-2 ${th.btnShape} font-bold hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors shrink-0`}><LogOut size={16} aria-hidden="true" /> <span className="hidden sm:inline">{t.logout}</span></button>
                </div>

                {/* Hub sub-navigation */}
                <div className={`flex flex-wrap gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-1 ${th.chip} shadow-sm w-fit`} role="tablist" aria-label={t.userHub}>
                  {[['overview', t.hubTabOverview], ['activity', t.hubTabActivity], ['account', t.hubTabAccount]].map(([tab, label]) => (
                    <button key={tab} type="button" role="tab" aria-selected={hubTab === tab} onClick={() => setHubTab(tab)} className={`px-4 py-2 ${th.chip} text-sm font-bold transition-all ${hubTab === tab ? th.accentSoft : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}>{label}</button>
                  ))}
                </div>

                {hubTab === 'overview' && (<>
                {/* Rank nudge: how close you are to the person above you */}
                {(() => {
                  const idx = allTimeUsers.findIndex(u => u.code === loggedInUser);
                  if (idx < 0) return null;
                  if (idx === 0) return (
                    <div className={`${cardCls} p-4 font-bold text-amber-700 dark:text-amber-400 flex items-center gap-2 border-amber-200 dark:border-amber-700/50`}><Trophy size={18} aria-hidden="true" /> {t.nudgeTop}</div>
                  );
                  const ahead = allTimeUsers[idx - 1];
                  const gap = ahead.totalPoints - myEarned + 1;
                  const nm = safeUsers[ahead.code]?.name || ahead.code;
                  return (
                    <div className={`${cardCls} p-4 font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2`}><Flame size={18} className="text-orange-500 shrink-0" aria-hidden="true" /> {t.nudgeText.replace('{points}', gap).replace('{name}', nm)}</div>
                  );
                })()}

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className={`${th.heroGrad} ${th.card} p-6 text-white shadow-lg`}><h3 className="font-semibold text-white/80">{t.personalStats}</h3><p className="text-5xl font-black mt-2"><AnimatedNumber value={myEarned} /></p><p className="text-sm text-white/70 mt-1 uppercase tracking-wider font-bold">{t.points}</p></div>
                  <div className={`${cardCls} p-6`}><h3 className="font-semibold text-slate-500 dark:text-slate-400">{t.balanceLabel}</h3><p className={`text-4xl font-bold mt-2 ${th.accentText}`}><AnimatedNumber value={myBalance} /></p></div>
                  <div className={`${cardCls} p-6`}><h3 className="font-semibold text-slate-500 dark:text-slate-400">{t.rank}</h3><p className="text-4xl font-bold mt-2 text-amber-500">#{userRank || '-'}</p></div>
                  <div className={`${cardCls} p-6`}><h3 className="font-semibold text-slate-500 dark:text-slate-400">{t.totalRecycled}</h3><p className="text-4xl font-bold mt-2 text-slate-800 dark:text-white">{myItems}</p></div>
                </div>

                {/* Weekly challenge progress */}
                {stats?.challenge && (() => {
                  const ch = stats.challenge;
                  const count = myWeeklyMatCounts[ch.material] || 0;
                  const done = count >= ch.target;
                  return (
                    <div className={`${cardCls} ${th.cardPad}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Target size={18} className={th.accentText} aria-hidden="true" /> {t.challengeTitle}</h2>
                        <span className={`font-black ${done ? 'text-emerald-500' : th.accentText}`}>{done ? `✓ ${t.challengeDone}` : t.challengeReward.replace('{bonus}', ch.bonus)}</span>
                      </div>
                      <p className="text-sm text-slate-500 dark:text-slate-400 capitalize mb-3">{t.challengeDesc.replace('{target}', ch.target).replace('{material}', ch.material)}</p>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-4 overflow-hidden">
                          <div className={`h-4 rounded-full transition-all duration-700 ${done ? 'bg-emerald-500' : orgType === 'school' ? 'bg-violet-500' : orgType === 'city' ? 'bg-emerald-600' : 'bg-indigo-500'}`} style={{ width: `${Math.min(100, (count / ch.target) * 100)}%` }}></div>
                        </div>
                        <span className="text-sm font-black text-slate-700 dark:text-slate-200 shrink-0">{Math.min(count, ch.target)} / {ch.target}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Personal environmental impact + achievements */}
                {(() => {
                  const matCounts = myMatCounts;
                  const my = impactFrom(matCounts, impactCfg.factors);
                  const achievementsList = getAchievementsData(myItems, matCounts, t, stats?.streaks?.[loggedInUser] || 0);
                  return (
                    <>
                      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mt-4 mb-2"><Leaf size={20} className="text-emerald-500" aria-hidden="true" /> {t.environmentalImpact}</h2>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <button type="button" onClick={() => setImpactModal({ metric: 'co2', matCounts })} className={`text-left w-full bg-emerald-500 ${th.card} p-6 text-white shadow-md relative overflow-hidden hover:shadow-lg hover:scale-[1.01] transition-all`}><Cloud size={80} className="absolute -bottom-4 -right-4 opacity-20" aria-hidden="true" /><h3 className="font-semibold text-emerald-100 flex items-center gap-2"><Cloud size={16} aria-hidden="true" /> {t.co2Saved}</h3><p className="text-3xl font-black mt-2">{my.co2.toFixed(1)} <span className="text-lg">kg</span></p><p className="text-xs text-emerald-100/90 mt-1 flex items-center gap-1"><Car size={12} aria-hidden="true" /> ≈ {Math.round(my.co2 * EQ.kmPerKgCo2)} {t.eqKm}</p></button>
                        <button type="button" onClick={() => setImpactModal({ metric: 'water', matCounts })} className={`text-left w-full bg-blue-500 ${th.card} p-6 text-white shadow-md relative overflow-hidden hover:shadow-lg hover:scale-[1.01] transition-all`}><Droplets size={80} className="absolute -bottom-4 -right-4 opacity-20" aria-hidden="true" /><h3 className="font-semibold text-blue-100 flex items-center gap-2"><Droplets size={16} aria-hidden="true" /> {t.waterSaved}</h3><p className="text-3xl font-black mt-2">{my.water.toFixed(1)} <span className="text-lg">L</span></p><p className="text-xs text-blue-100/90 mt-1 flex items-center gap-1"><ShowerHead size={12} aria-hidden="true" /> ≈ {Math.round(my.water * EQ.showersPerL)} {t.eqShowers}</p></button>
                        <button type="button" onClick={() => setImpactModal({ metric: 'energy', matCounts })} className={`text-left w-full bg-amber-500 ${th.card} p-6 text-white shadow-md relative overflow-hidden hover:shadow-lg hover:scale-[1.01] transition-all`}><Zap size={80} className="absolute -bottom-4 -right-4 opacity-20" aria-hidden="true" /><h3 className="font-semibold text-amber-100 flex items-center gap-2"><Zap size={16} aria-hidden="true" /> {t.energySaved}</h3><p className="text-3xl font-black mt-2">{my.energy.toFixed(1)} <span className="text-lg">kWh</span></p><p className="text-xs text-amber-100/90 mt-1 flex items-center gap-1"><BatteryCharging size={12} aria-hidden="true" /> ≈ {Math.round(my.energy * EQ.chargesPerKwh)} {t.eqCharges}</p></button>
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
                </>)}

                {/* My recycling history */}
                {hubTab === 'activity' && (
                  <div className={`${cardCls} overflow-hidden animate-fade-in`}>
                    <div className={`${th.cardPad} border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50`}>
                      <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Clock size={18} className={th.accentText} aria-hidden="true" /> {t.myHistory}</h2>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                      {safeTransactions.filter(tx => tx.user_code === loggedInUser).slice(0, 30).map(tx => (
                        <div key={tx.id} className="p-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`${th.accentSoft} p-2 ${th.chip} shrink-0`}><Recycle size={14} aria-hidden="true" /></div>
                            <div className="min-w-0">
                              <p className="font-bold text-slate-800 dark:text-slate-100 capitalize">{tx.material}</p>
                              <p className="text-[11px] text-slate-400">{parseTimestamp(tx.timestamp).toLocaleString()}</p>
                            </div>
                          </div>
                          <p className={`font-black ${th.accentText}`}>+{tx.points} {t.points.toLowerCase()}</p>
                        </div>
                      ))}
                      {safeTransactions.filter(tx => tx.user_code === loggedInUser).length === 0 && <p className="p-8 text-sm text-slate-400 text-center">{t.noHistory}</p>}
                    </div>
                  </div>
                )}

                {hubTab === 'account' && (
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
                            {!sessionPassword && !sessionToken && <input type="password" required maxLength={128} placeholder={t.confirmPass} aria-label={t.confirmPass} className={`w-full p-4 ${th.input} border border-rose-200 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-100 focus:ring-2 focus:ring-rose-500 outline-none transition-colors`} value={editProfileForm.confirmPass} onChange={e => setEditProfileForm({ ...editProfileForm, confirmPass: e.target.value })} />}
                            <div className="flex gap-2"><button type="submit" className={`flex-1 ${btnPrimary} p-3 shadow-sm`}>{t.requestEdit}</button><button type="button" onClick={() => setIsEditingProfile(false)} className={`bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold p-3 px-6 ${th.btnShape} transition-colors`}>{t.cancel}</button></div>
                          </form>
                        )}
                      </div>
                    </div>

                    {/* Full-account upgrade (quick accounts only) */}
                    {safeUsers[loggedInUser]?.account_type !== 'full' && (
                      <div className={`${cardCls} overflow-hidden`}>
                        <div className={`${th.cardPad} border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50`}><h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><ShieldCheck size={18} className={th.accentText} aria-hidden="true" /> {t.fullAccountTitle}</h2></div>
                        <div className={th.cardPad}>
                          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">{t.quickAccountNote}</p>
                          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t.upgradeDesc}</p>
                          <form onSubmit={submitUpgrade} className="space-y-3">
                            <div className="grid grid-cols-3 gap-3">
                              <input type="number" required min={1} max={120} placeholder={t.ageLabel} aria-label={t.ageLabel} className={`${inputSm} col-span-1`} value={upgradeForm.age} onChange={e => setUpgradeForm({ ...upgradeForm, age: e.target.value })} />
                              <input type="tel" required maxLength={32} placeholder={t.phoneLabel} aria-label={t.phoneLabel} className={`${inputSm} col-span-2`} value={upgradeForm.phone} onChange={e => setUpgradeForm({ ...upgradeForm, phone: e.target.value })} />
                            </div>
                            <input type="email" required maxLength={128} placeholder={t.emailLabel} aria-label={t.emailLabel} className={inputSm} value={upgradeForm.email} onChange={e => setUpgradeForm({ ...upgradeForm, email: e.target.value })} />
                            {!sessionPassword && <input type="password" required maxLength={128} placeholder={t.confirmPass} aria-label={t.confirmPass} className={`w-full px-3 h-12 ${th.input} border border-rose-200 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-100 focus:ring-2 focus:ring-rose-500 outline-none transition-colors`} value={upgradeForm.confirmPass} onChange={e => setUpgradeForm({ ...upgradeForm, confirmPass: e.target.value })} />}
                            <button type="submit" disabled={upgradeForm.pending || !isConnected} className={`w-full ${btnPrimary} p-4 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed`}>
                              {upgradeForm.pending ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} aria-hidden="true" />} {t.upgradeBtn}
                            </button>
                          </form>
                        </div>
                      </div>
                    )}

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
                        {!sessionPassword && !sessionToken && <input type="password" required maxLength={128} placeholder={t.confirmPass} aria-label={t.confirmPass} className={`w-full p-4 ${th.input} border border-rose-200 dark:border-rose-700/50 bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-100 focus:ring-2 focus:ring-rose-500 outline-none transition-colors mb-4`} value={feedbackConfirmPass} onChange={e => setFeedbackConfirmPass(e.target.value)} />}
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
                      <div className="mt-4 flex gap-4 justify-center text-xs">
                        <button type="button" onClick={() => setActiveTab('privacy')} className={`${th.accentText} font-semibold hover:underline`}>{t.privacyPolicy}</button>
                        <button type="button" onClick={() => setActiveTab('terms')} className={`${th.accentText} font-semibold hover:underline`}>{t.termsOfService}</button>
                      </div>
                    </div>
                  </div>
                </div>
                )}
              </div>
            )
          )}

          {/* TAB: LEGAL (privacy policy / terms of service) */}
          {(activeTab === 'privacy' || activeTab === 'terms') && (
            <div className="max-w-3xl mx-auto animate-fade-in pb-24 md:pb-0">
              <button type="button" onClick={() => setActiveTab('about')} className={`mb-4 flex items-center gap-1 text-sm font-bold ${th.accentText} hover:underline`}>
                <ChevronRight size={16} className="rotate-180" aria-hidden="true" /> {t.legalBack}
              </button>
              <div className={`${cardCls} ${th.cardPad}`}>
                <h1 className="text-2xl font-black text-slate-800 dark:text-white mb-2 flex items-center gap-2">
                  <ShieldCheck className={th.accentText} aria-hidden="true" /> {activeTab === 'privacy' ? t.privacyPolicy : t.termsOfService}
                </h1>
                <p className="text-xs text-slate-400 mb-6">MILO · {new Date().getFullYear()}</p>
                <div className="space-y-6">
                  {(LEGAL[lang] || LEGAL.en)[activeTab === 'privacy' ? 'privacy' : 'terms'].map(sec => (
                    <section key={sec.h}>
                      <h2 className="font-bold text-slate-800 dark:text-slate-100 mb-2">{sec.h}</h2>
                      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{sec.p}</p>
                    </section>
                  ))}
                </div>
              </div>
            </div>
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
                <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-700 text-left space-y-2">
                  <p className="text-xs font-bold uppercase text-slate-400 flex items-center gap-1.5">
                    <Wrench size={13} className={th.accentText} aria-hidden="true" />
                    {lang === 'bg' ? 'Технически Ремонт & Настройки (работи и офлайн)' : 'Technician Repair & Configure UI (works offline)'}
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={repairUiUrl}
                      onChange={e => { setRepairUiUrl(e.target.value); localStorage.setItem('miloRepairUrl', e.target.value); }}
                      placeholder="http://192.168.1.17:8088"
                      aria-label="Repair UI URL"
                      className={`${inputSm} text-xs font-mono flex-1`}
                    />
                    <a
                      href={repairUiUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${btnPrimary} px-4 h-12 text-xs flex items-center justify-center gap-1.5 shrink-0`}
                    >
                      <Wrench size={14} aria-hidden="true" /> {lang === 'bg' ? 'Отвори' : 'Open'}
                    </a>
                  </div>
                </div>
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
                  <a href={repairUiUrl} target="_blank" rel="noopener noreferrer" className="text-xs flex items-center gap-2 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 px-3 py-2 rounded-lg font-semibold transition-colors"><Wrench size={14} aria-hidden="true" /> <span className="hidden sm:inline">{lang === 'bg' ? 'Ремонтен Панел' : 'Repair & Configure UI'}</span></a>
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

                {/* Admin sub-navigation: one section per concern, badge = items waiting */}
                {(() => {
                  const pendingReqCount = Object.values(safeUsers).filter(u => u.status === 'pending').length;
                  const tabs = [
                    ['users', t.adminTabUsers, pendingReqCount + safeProfileEdits.length],
                    ['rewards', t.adminTabRewards, redemptions.filter(r => r.status === 'pending').length],
                    ['analytics', t.adminTabAnalytics, 0],
                    ['feedback', t.adminTabFeedback, (feedbacks || []).length],
                    ...(adminRole === 'super' ? [['system', t.adminTabSystem, Object.keys(hardwareErrors).length]] : []),
                  ];
                  return (
                    <div className={`flex flex-wrap gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-1 ${th.chip} shadow-sm w-fit`} role="tablist" aria-label={t.admin}>
                      {tabs.map(([tab, label, badge]) => (
                        <button key={tab} type="button" role="tab" aria-selected={adminTab === tab} onClick={() => setAdminTab(tab)} className={`px-4 py-2 ${th.chip} text-sm font-bold transition-all flex items-center gap-2 ${adminTab === tab ? th.accentSoft : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}>
                          {label}
                          {badge > 0 && <span className="bg-rose-500 text-white text-[10px] font-black rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">{badge}</span>}
                        </button>
                      ))}
                    </div>
                  );
                })()}

                {adminTab === 'rewards' && (<>
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
                    <div className="space-y-1 col-span-2 md:col-span-6">
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.rewardPhoto}</label>
                      {rewardForm.photo ? (
                        <div className="flex items-center gap-3">
                          <img src={rewardForm.photo} alt="" className="w-12 h-12 rounded-lg object-cover shadow-sm" draggable="false" />
                          <button type="button" onClick={() => setRewardForm(f => ({ ...f, photo: '' }))} className={`text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30 hover:bg-rose-100 dark:hover:bg-rose-900/50 px-3 py-2 ${th.btnShape} transition-colors`}>{t.removePhoto}</button>
                        </div>
                      ) : (
                        <input type="file" accept="image/*" onChange={handleRewardPhoto} aria-label={t.rewardPhoto} className="block w-full text-xs text-slate-500 dark:text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-slate-100 dark:file:bg-slate-700 file:text-slate-700 dark:file:text-slate-200 file:cursor-pointer" />
                      )}
                    </div>
                    <button type="submit" className={`${btnPrimary} p-3 h-12 flex items-center justify-center gap-2 col-span-2 md:col-span-6`}><UserPlus size={18} aria-hidden="true" /> {t.addReward}</button>
                  </form>
                  <div className="space-y-2">
                    {rewards.map(r => (
                      <div key={r.id} className={`flex justify-between items-center bg-slate-50 dark:bg-slate-700/30 p-3 ${th.card} border border-slate-100 dark:border-slate-700 gap-3`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <RewardVisual reward={r} imgCls="w-9 h-9 rounded-lg" emojiCls="text-2xl" />
                          <div className="min-w-0"><p className="font-bold text-slate-800 dark:text-slate-100 truncate">{r.title}{r.title_bg ? ` / ${r.title_bg}` : ''}</p><p className="text-xs text-slate-500">{r.cost} {t.points.toLowerCase()} · {r.stock === null ? t.unlimitedStock : `${r.stock} ${t.stockLeft}`}</p></div>
                        </div>
                        <button type="button" onClick={() => setConfirmAction({ type: 'delete_reward', rewardId: r.id, name: r.title })} aria-label={`Delete reward ${r.title}`} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-colors shrink-0"><Trash2 size={16} aria-hidden="true" /></button>
                      </div>
                    ))}
                    {rewards.length === 0 && <p className="text-center text-slate-400 text-sm py-2">{t.dbEmpty}</p>}
                  </div>
                </div>
                </>)}

                {adminRole === 'super' && adminTab === 'system' && (
                  <>
                    {/* Fleet: which machine the maintenance/bin controls target */}
                    <div className={`${cardCls} p-4 flex flex-wrap items-end gap-3`}>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.machineSelect}</label>
                        <select value={targetMachine} onChange={e => setTargetMachine(e.target.value)} className={`${inputSm} w-auto pr-8`} aria-label={t.machineSelect}>
                          {Object.entries(stats?.machines || {}).map(([id, m]) => (
                            <option key={id} value={id}>{m.name || id}{m.online ? '' : ` (${t.offlineTag})`}</option>
                          ))}
                        </select>
                      </div>
                      <form onSubmit={saveMachine} className="flex flex-wrap items-end gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.fullName}</label>
                          <input type="text" maxLength={64} className={`${inputSm} w-44`} value={machineForm.name} onChange={e => setMachineForm({ ...machineForm, name: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t.orgType}</label>
                          <select className={`${inputSm} w-auto pr-8`} value={machineForm.env} onChange={e => setMachineForm({ ...machineForm, env: e.target.value })}>
                            <option value="">—</option>
                            <option value="office">{t.orgOffice}</option>
                            <option value="school">{t.orgSchool}</option>
                            <option value="city">{t.orgCity}</option>
                          </select>
                        </div>
                        <button type="submit" className={`${btnPrimary} px-4 h-12 text-sm`}>{t.saveSettings}</button>
                      </form>
                    </div>

                    <div className={`${cardCls} ${th.cardPad}`}>
                      <div className="flex justify-between items-center mb-4"><h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Activity className="text-rose-500" aria-hidden="true" /> {t.hardwareDiagnostics}</h2>{Object.keys(hardwareErrors).length > 0 && <button type="button" onClick={() => setHardwareErrors({})} className={`text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-600 dark:text-slate-300 px-3 py-1.5 ${th.btnShape} font-semibold`}>{t.clearErrors}</button>}</div>
                      {Object.keys(hardwareErrors).length === 0 ? (
                        <div className={`p-4 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 ${th.card} border border-emerald-200 dark:border-emerald-800 flex items-center gap-2 text-sm font-semibold`}><CheckCircle2 size={18} aria-hidden="true" /> {t.noErrors}</div>
                      ) : (
                        <div className="space-y-2">
                          {Object.entries(hardwareErrors).map(([errName, errTimestamp]) => (
                            <div key={errName} className={`p-4 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 ${th.card} border border-rose-200 dark:border-rose-800 flex items-start gap-3 text-sm font-semibold animate-shake`} role="alert">
                              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                              <div><p>{(errName || "").includes("FAN1_STALL") ? t.fan1Error : (errName || "").includes("FAN2_STALL") ? t.fan2Error : (errName || "").includes("FAN_STALL") ? t.fanError : (errName || "").startsWith("BIN_FULL") ? `${t.binFull}: ${(errName.split(':')[1] || '')}` : errName}</p><p className="text-xs text-rose-500/70 mt-1 font-normal">{parseTimestamp(errTimestamp).toLocaleString()}</p></div>
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

                    {/* Bin fill levels: derived from deposit counts, reset on empty */}
                    <div className={`${cardCls} ${th.cardPad}`}>
                      <h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4"><Trash2 className={th.accentText} aria-hidden="true" /> {t.binLevels} · {stats?.machines?.[targetMachine]?.name || targetMachine}</h2>
                      {stats?.bins?.[targetMachine] ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {Object.entries(stats.bins[targetMachine]).map(([m, b]) => {
                            const barColor = b.pct >= 90 ? 'bg-rose-500' : b.pct >= 60 ? 'bg-amber-500' : 'bg-emerald-500';
                            return (
                              <div key={m} className={`bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 ${th.card} p-4`}>
                                <div className="flex items-center justify-between mb-2">
                                  <p className="font-bold capitalize text-slate-800 dark:text-slate-100">{m}</p>
                                  <p className={`font-black text-sm ${b.pct >= 90 ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'}`}>{b.pct}% · {b.count}/{b.capacity}</p>
                                </div>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 overflow-hidden mb-3">
                                  <div className={`h-3 rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${b.pct}%` }}></div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button type="button" onClick={() => emptyBin(m)} disabled={!isConnected} className={`bg-emerald-600 hover:bg-emerald-500 text-white ${th.btnShape} px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50`}>{t.binEmptied}</button>
                                  <input type="number" min="1" aria-label={`${m} ${t.binCapacityLbl}`} placeholder={t.binCapacityLbl}
                                         className={`${fieldChrome} px-2 h-9 w-24 text-sm`} value={binCaps[m] ?? String(b.capacity ?? '')}
                                         onChange={e => setBinCaps(prev => ({ ...prev, [m]: e.target.value }))} />
                                  {binCaps[m] !== undefined && binCaps[m] !== String(b.capacity) && (
                                    <button type="button" onClick={() => saveBinCap(m)} className={`${th.accentBtn} ${th.btnShape} px-3 py-2 text-xs font-bold`}>{t.saveSettings}</button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">{t.dbEmpty}</p>
                      )}
                    </div>

                    {/* Environmental impact settings: per-item factors + "equals to" rates */}
                    <div className={`${cardCls} ${th.cardPad}`}>
                      <h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-2"><Leaf className="text-emerald-500" aria-hidden="true" /> {t.impactSettings}</h2>
                      <p className="text-xs text-slate-400 mb-4">{t.impactDisclaimer}</p>
                      {impactDraft && (
                        <form onSubmit={saveImpact} className="space-y-4">
                          <p className="text-xs font-bold uppercase text-slate-400">{t.impactPerItemHdr}</p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm min-w-[420px]">
                              <thead>
                                <tr className="text-left text-xs text-slate-400">
                                  <th className="p-2 font-semibold">{t.materialCol}</th><th className="p-2 font-semibold">{t.co2Col}</th><th className="p-2 font-semibold">{t.waterCol}</th><th className="p-2 font-semibold">{t.energyCol}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {['plastic', 'glass', 'tin', 'paper'].map(m => (
                                  <tr key={m}>
                                    <td className="p-2 font-bold capitalize text-slate-700 dark:text-slate-200">{m}</td>
                                    {['co2', 'water', 'energy'].map(k => (
                                      <td key={k} className="p-2">
                                        <input type="number" step="0.01" min="0" aria-label={`${m} ${k}`} className={inputSm} value={impactDraft[`${m}_${k}`] ?? ''} onChange={e => setImpactDraft(d => ({ ...d, [`${m}_${k}`]: e.target.value }))} />
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <p className="text-xs font-bold uppercase text-slate-400">{t.impactEqHdr}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {[['kgCo2PerKm', t.kgCo2PerKmLbl], ['lPerShower', t.lPerShowerLbl], ['kwhPerCharge', t.kwhPerChargeLbl]].map(([k, label]) => (
                              <div key={k} className="space-y-1">
                                <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">{label}</label>
                                <input type="number" step="0.001" min="0" className={inputSm} value={impactDraft[k] ?? ''} onChange={e => setImpactDraft(d => ({ ...d, [k]: e.target.value }))} />
                              </div>
                            ))}
                          </div>
                          <button type="submit" className={`${btnPrimary} px-6 py-3`}>{t.saveSettings}</button>
                        </form>
                      )}
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

                    {/* Unified Technician Repair & Configure Console (Port 8088) */}
                    <div className={`${cardCls} ${th.cardPad}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <div>
                          <h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <Wrench className={th.accentText} aria-hidden="true" />
                            {lang === 'bg' ? 'Технически Панел за Ремонт, Камера и База Данни (8088)' : 'Technician Repair, Camera & Database Console (8088)'}
                          </h2>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {lang === 'bg'
                              ? 'Директен достъп до живия изглед от камерата с AI предвиждания, таблиците в SQLite базата данни и суровите технически поправки.'
                              : 'Direct access to the live Camera & AI Predictions view, SQLite Database Tables explorer, and raw technician fixes.'}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="url"
                            value={repairUiUrl}
                            onChange={e => { setRepairUiUrl(e.target.value); localStorage.setItem('miloRepairUrl', e.target.value); }}
                            aria-label="Repair UI URL"
                            className={`${inputSm} w-56 text-xs font-mono`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowRepairEmbed(v => !v)}
                            className={`bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 ${th.btnShape} font-bold px-4 h-12 text-xs transition-colors`}
                          >
                            {showRepairEmbed ? (lang === 'bg' ? 'Скрий вградения панел' : 'Hide Embedded Console') : (lang === 'bg' ? 'Покажи тук' : 'Embed Here')}
                          </button>
                          <a
                            href={repairUiUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${btnPrimary} px-4 h-12 text-xs flex items-center gap-1.5`}
                          >
                            <Wrench size={14} aria-hidden="true" /> {lang === 'bg' ? 'Отвори в нов раздел' : 'Open Console'}
                          </a>
                        </div>
                      </div>
                      {showRepairEmbed && (
                        <div className="mt-4 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-950">
                          <iframe
                            src={repairUiUrl}
                            title="MILO Repair & Configure Console"
                            className="w-full h-[720px] border-0"
                          />
                        </div>
                      )}
                    </div>

                    {/* Recovery & Install Kit — the scripts that rebuild a machine.
                        Served as static files from this same site, so the copy a
                        technician downloads always matches the deployed build. */}
                    <div className={`${cardCls} ${th.cardPad}`}>
                      <h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-2"><LifeBuoy className={th.accentText} aria-hidden="true" /> {t.recoveryTitle}</h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t.recoveryDesc}</p>

                      <p className="text-xs font-bold uppercase text-slate-400 mb-2">{t.recoveryRebuild}</p>
                      <div className={`flex items-stretch gap-2 mb-5`}>
                        <code className={`flex-1 min-w-0 overflow-x-auto whitespace-nowrap bg-slate-900 dark:bg-slate-950 text-emerald-300 ${th.input} px-4 py-3 text-xs font-mono`}>
                          {recoveryCmd}
                        </code>
                        <button type="button" onClick={() => { navigator.clipboard?.writeText(recoveryCmd).then(() => showToast(t.copied, 'ok')).catch(() => {}); }}
                                className={`${btnPrimary} px-4 shrink-0 text-sm flex items-center gap-2`}>
                          <Download size={14} aria-hidden="true" /> {t.copyCmd}
                        </button>
                      </div>

                      <p className="text-xs font-bold uppercase text-slate-400 mb-2">{t.recoveryDownloads}</p>
                      <div className="space-y-2">
                        {(recoveryKit?.files || []).map(f => (
                          <a key={f.file} href={`/recovery/${f.file}`} download
                             className={`flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-700/30 p-3 ${th.card} border border-slate-100 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 transition-colors group`}>
                            <div className="min-w-0">
                              <p className="font-bold text-slate-800 dark:text-slate-100 truncate">{f.title}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{f.description}</p>
                              <p className="text-[10px] text-slate-400 font-mono truncate mt-0.5">{f.file} · {(f.bytes / 1024).toFixed(1)} KB · sha256 {String(f.sha256).slice(0, 12)}…</p>
                            </div>
                            <Download size={18} className={`shrink-0 text-slate-400 group-hover:${th.accentText.split(' ')[0]}`} aria-hidden="true" />
                          </a>
                        ))}
                        {!recoveryKit && <p className="text-sm text-slate-400">{t.recoveryUnavailable}</p>}
                      </div>

                      <div className={`mt-4 p-3 ${th.accentSoft} ${th.card} text-xs font-semibold flex items-start gap-2`}>
                        <Info size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{t.recoveryUiHint}{recoveryKit?.version ? ` · ${t.kitVersion} ${recoveryKit.version}` : ''}</span>
                      </div>
                    </div>
                  </>
                )}

                {adminTab === 'users' && (<>
                {/* Pending account requests — BUG FIX: these users were filtered
                    out of the directory table and rendered nowhere, so admins
                    could never approve a new signup. */}
                {(() => {
                  const pendingList = Object.entries(safeUsers).filter(([, d]) => d.status === 'pending');
                  return pendingList.length > 0 && (
                    <div className={`${cardCls} border-amber-200 dark:border-amber-700/50 ${th.cardPad} animate-slide-up`}>
                      <h2 className="text-lg md:text-xl font-bold text-amber-800 dark:text-amber-400 flex items-center gap-2 mb-4"><UserPlus size={20} aria-hidden="true" /> {t.pendingUsers} ({pendingList.length})</h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {pendingList.map(([code, d]) => (
                          <div key={code} className={`bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 p-4 ${th.card} flex flex-col gap-3`}>
                            <div>
                              <p className="font-bold text-amber-900 dark:text-amber-300">{d.name || t.unnamedUser}</p>
                              <p className="text-xs text-amber-700/80 dark:text-amber-500">ID: {code}{d.department ? ` · ${d.department}` : ''}</p>
                            </div>
                            <div className="flex gap-2">
                              <button type="button" onClick={() => pub(`${NS}/users/update`, JSON.stringify({ action: 'approve', code, admin_token: adminToken }))} className={`flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 ${th.btnShape} text-sm font-bold shadow-sm transition-colors`}>{t.approve}</button>
                              <button type="button" onClick={() => setConfirmAction({ type: 'delete', code, name: d.name || code })} className={`flex-1 bg-rose-100 hover:bg-rose-200 text-rose-700 dark:bg-rose-900/40 dark:hover:bg-rose-900/60 dark:text-rose-400 py-2 ${th.btnShape} text-sm font-bold transition-colors`}>{t.approveReject}</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

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
                </>)}

                {/* Waste analytics & user profiles */}
                {adminTab === 'analytics' && (
                  <div className={`${cardCls} ${th.cardPad} animate-fade-in`}>
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                      <h2 className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Activity className={th.accentText} aria-hidden="true" /> {t.analyticsTitle}</h2>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={downloadDataset} disabled={!isConnected} className={`${btnPrimary} px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50`}><Download size={14} aria-hidden="true" /> {t.downloadDataset}</button>
                        <button type="button" onClick={downloadMonthlyReport} disabled={!isConnected} className={`bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 ${th.btnShape} font-bold px-4 py-2 text-sm flex items-center gap-2 transition-colors disabled:opacity-50`}><FileDown size={14} aria-hidden="true" /> {t.monthlyReport}</button>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400 mb-4">{t.analyticsNote}</p>
                    {analyticsData === null ? (
                      <p className="text-sm text-slate-400 flex items-center gap-2 py-4"><Loader2 size={14} className="animate-spin" /> {t.loadingData}</p>
                    ) : Object.keys(analyticsData).length === 0 ? (
                      <p className="text-sm text-slate-400 text-center py-4">{t.dbEmpty}</p>
                    ) : (
                      <div className="overflow-x-auto w-full">
                        <table className="w-full text-left border-collapse min-w-[760px] text-sm">
                          <thead>
                            <tr className="text-slate-500 dark:text-slate-400 text-xs border-b border-slate-200 dark:border-slate-700">
                              <th className="p-3 font-semibold" scope="col">{t.fullName}</th>
                              <th className="p-3 font-semibold" scope="col">{t.kpiItems}</th>
                              <th className="p-3 font-semibold" scope="col">{t.points}</th>
                              <th className="p-3 font-semibold" scope="col">{t.topMatCol}</th>
                              <th className="p-3 font-semibold" scope="col">{t.impactBreakdown}</th>
                              <th className="p-3 font-semibold" scope="col">{t.busiestDay}</th>
                              <th className="p-3 font-semibold" scope="col">{t.lastActive}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                            {Object.entries(analyticsData).sort((a, b) => (b[1].items || 0) - (a[1].items || 0)).map(([code, p]) => {
                              const mats = Object.entries(p.materials || {}).sort((x, y) => y[1] - x[1]);
                              const wk = Array.isArray(p.weekday) ? p.weekday : [];
                              const topDay = wk.length ? wk.indexOf(Math.max(...wk)) : -1;
                              return (
                                <tr key={code} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                  <td className="p-3"><p className="font-bold text-slate-800 dark:text-slate-100">{p.name || t.unnamedUser}</p><p className="text-[11px] text-slate-400 font-mono">{code}{p.department ? ` · ${p.department}` : ''}</p></td>
                                  <td className="p-3 font-bold">{p.items}</td>
                                  <td className={`p-3 font-bold ${th.accentText}`}>{p.points}</td>
                                  <td className="p-3 capitalize font-semibold">{mats[0]?.[0] || '-'}</td>
                                  <td className="p-3"><div className="flex flex-wrap gap-1">{mats.map(([m, n]) => <span key={m} className={`${th.chip} bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 text-[11px] font-semibold capitalize`}>{m} {n}</span>)}</div></td>
                                  <td className="p-3">{p.items > 0 && topDay >= 0 ? (DAYS[lang] || DAYS.en)[topDay] : '-'}</td>
                                  <td className="p-3 text-xs text-slate-400">{p.last_ts ? parseTimestamp(p.last_ts).toLocaleDateString() : '-'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Feedback Logs */}
                {adminTab === 'feedback' && (
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
                )}
              </div>
            )
          )}
        </main>

        {/* Mobile bottom nav */}
        <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-700/80 flex justify-around p-2 z-30 pb-safe transition-colors duration-300" aria-label="Primary">
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
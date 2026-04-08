import type { Language } from "./preferencesStore";

export type TranslationKey =
  | "settings"
  | "account"
  | "displayName"
  | "security"
  | "changePassword"
  | "schedule"
  | "dailyBrief"
  | "weeklyResearch"
  | "timezone"
  | "telegram"
  | "statusConnected"
  | "statusNotConnected"
  | "connect"
  | "disconnect"
  | "rateLimits"
  | "fullReport"
  | "dailyBriefLimit"
  | "deepDiveLimit"
  | "newIdeasLimit"
  | "setByAdmin"
  | "logout"
  | "advancedControls"
  | "theme"
  | "language"
  | "dark"
  | "bright"
  | "middle"
  | "english"
  | "hebrew"
  | "save"
  | "cancel"
  | "edit"
  | "settingsTab"
  | "portfolioTab"
  | "alertsTab"
  | "reportsTab"
  | "strategiesTab"
  | "controlsTab"
  | "addPosition"
  | "editPosition"
  | "priceHistory"
  | "shares"
  | "avgBuyPrice"
  | "livePrice"
  | "currentValue"
  | "costBasis"
  | "weight"
  | "accounts"
  | "priceStale"
  | "jobsRunning"
  | "greeting1"
  | "greeting2"
  | "greeting3"
  | "greeting4"
  | "greeting5"
  | "greeting6";

type Translations = Record<Language, Record<TranslationKey, string>>;

export const translations: Translations = {
  en: {
    settings: "Settings",
    account: "Account",
    displayName: "Display Name",
    security: "Security",
    changePassword: "Change Password",
    schedule: "Schedule",
    dailyBrief: "Daily Brief",
    weeklyResearch: "Weekly Research",
    timezone: "Timezone",
    telegram: "Telegram",
    statusConnected: "Status: Connected",
    statusNotConnected: "Status: Not connected",
    connect: "Connect",
    disconnect: "Disconnect",
    rateLimits: "Rate Limits",
    fullReport: "Full Report",
    dailyBriefLimit: "Daily Brief",
    deepDiveLimit: "Deep Dive",
    newIdeasLimit: "New Ideas",
    setByAdmin: "(set by admin)",
    logout: "Log Out",
    advancedControls: "Advanced Controls",
    theme: "Theme",
    language: "Language",
    dark: "Dark",
    bright: "Bright",
    middle: "Middle",
    english: "English",
    hebrew: "Hebrew",
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    settingsTab: "Settings",
    portfolioTab: "Portfolio",
    alertsTab: "Alerts",
    reportsTab: "Reports",
    strategiesTab: "Strategies",
    controlsTab: "Controls",
    addPosition: "Add Position",
    editPosition: "Edit Position",
    priceHistory: "Price History",
    shares: "Shares",
    avgBuyPrice: "Avg Buy Price",
    livePrice: "Live Price",
    currentValue: "Current Value",
    costBasis: "Cost Basis",
    weight: "Weight",
    accounts: "Accounts",
    priceStale: "Price data may be stale",
    jobsRunning: "job(s) running",
    greeting1: "Let's monitor some positions 📈",
    greeting2: "Keep an eye on things 👀",
    greeting3: "Your portfolio, your rules 🚀",
    greeting4: "Time to check the numbers 📊",
    greeting5: "Welcome back, boss 👑",
    greeting6: "Let's make some gains 💰",
  },
  he: {
    settings: "הגדרות",
    account: "חשבון",
    displayName: "שם תצוגה",
    security: "אבטחה",
    changePassword: "שינוי סיסמה",
    schedule: "לוח זמנים",
    dailyBrief: "סיכום יומי",
    weeklyResearch: "מחקר שבועי",
    timezone: "אזור זמן",
    telegram: "טלגרם",
    statusConnected: "סטטוס: מחובר",
    statusNotConnected: "סטטוס: לא מחובר",
    connect: "חיבור",
    disconnect: "ניתוק",
    rateLimits: "מגבלות שימוש",
    fullReport: "דוח מלא",
    dailyBriefLimit: "סיכום יומי",
    deepDiveLimit: "צלילה עמוקה",
    newIdeasLimit: "רעיונות חדשים",
    setByAdmin: "(מוגדר על ידי מנהל)",
    logout: "התנתקות",
    advancedControls: "בקרות מתקדמות",
    theme: "נושא",
    language: "שפה",
    dark: "כהה",
    bright: "בהיר",
    middle: "בינוני",
    english: "אנגלית",
    hebrew: "עברית",
    save: "שמירה",
    cancel: "ביטול",
    edit: "עריכה",
    settingsTab: "הגדרות",
    portfolioTab: "תיק השקעות",
    alertsTab: "התראות",
    reportsTab: "דוחות",
    strategiesTab: "אסטרטגיות",
    controlsTab: "בקרה",
    addPosition: "הוסף פוזיציה",
    editPosition: "ערוך פוזיציה",
    priceHistory: "היסטוריית מחירים",
    shares: "מניות",
    avgBuyPrice: "מחיר ממוצע",
    livePrice: "מחיר חי",
    currentValue: "ערך נוכחי",
    costBasis: "בסיס עלות",
    weight: "משקל",
    accounts: "חשבונות",
    priceStale: "נתוני מחיר עלולים להיות ישנים",
    jobsRunning: "משימות רצות",
    greeting1: "בואו נעקוב אחרי הפוזיציות 📈",
    greeting2: "שמרו על העין 👀",
    greeting3: "התיק שלכם, הכללים שלכם 🚀",
    greeting4: "זמן לבדוק את המספרים 📊",
    greeting5: "ברוך שובך, הבוס 👑",
    greeting6: "בואו נרוויח 💰",
  },
};

export function t(key: TranslationKey, language: Language): string {
  return translations[language][key] ?? translations.en[key] ?? key;
}

export function getGreeting(name: string | null | undefined, language: Language): string {
  const keys: TranslationKey[] = ["greeting1", "greeting2", "greeting3", "greeting4", "greeting5", "greeting6"];
  const randomKey = keys[Math.floor(Math.random() * keys.length)]!;
  const phrase = t(randomKey, language);
  if (!name) return phrase;
  return `Hello ${name} — ${phrase}`;
}

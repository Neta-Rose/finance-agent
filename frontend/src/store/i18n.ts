import type { Language } from "./preferencesStore";

export type TranslationKey =
  // Navigation
  | "settingsTab" | "portfolioTab" | "alertsTab" | "reportsTab" | "strategiesTab" | "controlsTab"
  // Login
  | "loginTitle" | "loginSubtitle" | "loginUserId" | "loginPassword"
  | "loginSignIn" | "loginSigningIn" | "loginError"
  // Common actions
  | "save" | "cancel" | "edit" | "retry" | "run" | "loading" | "saving"
  | "back" | "next" | "skip" | "confirm" | "delete" | "rename"
  // Settings page
  | "settings" | "account" | "displayName" | "security" | "changePassword"
  | "schedule" | "dailyBrief" | "weeklyResearch" | "timezone"
  | "telegram" | "statusConnected" | "statusNotConnected" | "connect" | "disconnect"
  | "rateLimits" | "fullReport" | "dailyBriefLimit" | "deepDiveLimit" | "newIdeasLimit"
  | "setByAdmin" | "logout" | "theme" | "language" | "dark" | "bright" | "middle"
  | "english" | "hebrew" | "appearance"
  | "currentPassword" | "newPassword" | "confirmPassword"
  | "errorCurrentPasswordRequired" | "errorPasswordTooShort" | "errorPasswordMismatch"
  | "passwordChangedSuccess" | "errorIncorrectPassword" | "errorChangePassword"
  | "scheduleUpdated" | "errorUpdateSchedule"
  | "botToken" | "chatId" | "telegramConnected" | "errorConnectTelegram" | "errorBothFields"
  | "errorInvalidBotToken" | "errorInvalidChatId"
  | "perWeek" | "perDay"
  // Days of week
  | "daySunday" | "dayMonday" | "dayTuesday" | "dayWednesday"
  | "dayThursday" | "dayFriday" | "daySaturday"
  // Portfolio
  | "portfolio" | "errorLoadPortfolio" | "emptyPortfolio" | "addPosition"
  | "colTicker" | "colShares" | "colAvgPrice" | "colLivePrice" | "colValue"
  | "colPlPct" | "colPl" | "colWeight" | "colVerdict"
  | "shares" | "avgBuyPrice" | "livePrice" | "currentValue" | "costBasis" | "weight" | "accounts"
  | "priceStale" | "jobsRunning" | "editPosition" | "priceHistory"
  | "saveChanges" | "noChartData"
  // Summary strip
  | "totalValue" | "totalPL" | "positions" | "usdIls" | "updatedAt"
  // Strategies
  | "strategies" | "errorLoadStrategies" | "emptyStrategies" | "noStrategyMatches"
  | "searchTicker" | "filterAll" | "expiredCatalyst"
  | "colConfidence" | "colTimeframe" | "colSize" | "colWeightPct" | "colReasoning" | "colUpdated"
  // Controls
  | "controls" | "activeJobs" | "recentJobs" | "noJobs" | "enterTicker" | "tickerRequired"
  | "jobDailyTitle" | "jobDailyDesc" | "jobFullTitle" | "jobFullDesc"
  | "jobDeepDiveTitle" | "jobDeepDiveDesc" | "jobNewIdeasTitle" | "jobNewIdeasDesc"
  | "jobQueued" | "jobFailed" | "jobCompleted" | "jobCompletedNotif" | "jobFailedNotif"
  // Reports
  | "reports" | "emptyReports" | "newerBtn" | "olderBtn" | "reportLoadError" | "pageOf"
  // Strategy Modal
  | "reasoning" | "bullCase" | "bearCase" | "entryConditions" | "exitConditions" | "catalysts"
  | "noExpiry" | "triggered" | "comingSoon" | "failedLoadStrategy" | "runDeepDive"
  | "strategyUpdated"
  // Confidence levels (dynamic data display)
  | "confidenceHigh" | "confidenceMedium" | "confidenceLow"
  // Timeframes
  | "timeframeWeek" | "timeframeMonths" | "timeframeLongTerm" | "timeframeUndefined"
  // Verdicts
  | "verdictBuy" | "verdictAdd" | "verdictHold" | "verdictReduce" | "verdictSell" | "verdictClose"
  // Job card
  | "jobInitializing" | "jobTickersComplete" | "jobQueued2" | "jobDone" | "jobCompletedOk"
  // Alerts
  | "alerts" | "errorLoadAlerts" | "emptyAlerts" | "alertsNeedAttention"
  | "alertCritical" | "alertWarning" | "alertOpportunities" | "runNow"
  | "escalationNeeds" | "fullReportStarted" | "errorStartFullReport"
  // App banner
  | "healthBanner"
  // Onboarding
  | "onboardStep1Title" | "onboardStep1Sub" | "onboardAdminKey" | "onboardUserId"
  | "onboardPassword" | "onboardConfirmPassword" | "onboardDisplayName"
  | "onboardUserIdHint" | "onboardUserIdError" | "onboardPasswordHint"
  | "onboardPasswordError" | "onboardPasswordMismatch" | "onboardFieldRequired"
  | "onboardSetPasswordTitle" | "onboardSetPasswordSub"
  | "onboardPasswordIncorrect" | "onboardPasswordChangeFailed"
  | "onboardConnecting" | "onboardContinue"
  | "onboardStep2Title" | "onboardStep2Sub" | "onboardDailyBriefTime"
  | "onboardWeeklyDay" | "onboardWeeklyTime" | "onboardScheduleHint"
  | "onboardStep3Title" | "onboardStep3Sub"
  | "onboardTelegramStep1" | "onboardTelegramStep2" | "onboardTelegramStep3"
  | "onboardBotTokenHint" | "onboardChatIdHint"
  | "onboardSkip" | "onboardConnect" | "onboardBothFields"
  | "onboardInvalidBotToken" | "onboardInvalidChatId"
  | "onboardTelegramConnected" | "onboardTelegramFailed"
  | "onboardStep4Title" | "onboardStep4Sub" | "onboardAddPosition" | "onboardAddAccount"
  | "onboardDefaultAccount" | "onboardReview"
  | "onboardTickerLabel" | "onboardSharesLabel" | "onboardAvgPriceLabel" | "onboardExchangeLabel"
  | "onboardDuplicateTicker" | "onboardTickerRequired" | "onboardSharesError"
  | "onboardAvgPriceError" | "onboardAddPositionError"
  | "onboardStep5Title" | "onboardStep5Sub" | "onboardLaunch" | "onboardLaunching"
  | "onboardSetupFailed"
  | "onboardReviewAccount" | "onboardReviewSchedule" | "onboardReviewTelegram"
  | "onboardReviewPortfolio" | "onboardTelegramYes" | "onboardTelegramNo"
  // Admin
  | "adminTitle" | "adminLoginSub" | "adminKeyPlaceholder" | "adminLoginError"
  | "adminAddUser" | "adminCreateUser" | "adminCreating" | "adminUserCreationError"
  | "adminUserCreationFailed" | "adminDeleteUser" | "adminConfirmDelete"
  | "adminUserIdLabel" | "adminPasswordLabel" | "adminDisplayNameLabel"
  | "adminTelegramSection" | "adminScheduleSection" | "adminRateLimitsSection"
  | "adminDailyTime" | "adminWeeklyDay" | "adminWeeklyTime"
  | "adminModelProfiles" | "adminAddProfile" | "adminProfileName" | "adminProfileNameHint"
  | "adminOrchestrator" | "adminAnalysts" | "adminResearchers"
  | "adminFailedLoadProfiles" | "adminFailedUpdateProfile" | "adminFailedCreateProfile"
  | "adminFailedDeleteProfile" | "adminFailedSwitchProfile" | "adminConfirmDeleteProfile"
  | "adminStatusOk" | "adminStatusError"
  | "adminStateActive" | "adminStateBootstrapping" | "adminPortfolioLoaded" | "adminPortfolioMissing"
  | "adminFailedLoadUsers" | "adminFailedDeleteUser" | "adminUserDeleted"
  | "adminGateway" | "adminUsers" | "adminActive" | "adminRunning" | "adminStopped"
  | "adminNoUsers" | "adminTotal" | "adminSignIn"
  | "adminMax" | "adminPer" | "adminHrs" | "adminRisk"
  | "adminEditTelegram" | "adminAddTelegram" | "adminSaveTelegram"
  | "adminEditLimits" | "adminDeleting"
  | "adminTypeToConfirm" | "adminToConfirmDeletion"
  | "adminTelegramYes" | "adminTelegramNo"
  | "adminDeepDives" | "adminFullReportsLabel"
  // Onboarding additional
  | "onboardPosition" | "onboardPositions" | "onboardAccountSingular"
  | "onboardAcross" | "onboardAt" | "onboardDailyAt" | "onboardLaunchBtn"
  // Greetings
  | "greeting1" | "greeting2" | "greeting3" | "greeting4" | "greeting5" | "greeting6";

type Translations = Record<Language, Record<TranslationKey, string>>;

export const translations: Translations = {
  en: {
    // Navigation
    settingsTab: "Settings",
    portfolioTab: "Portfolio",
    alertsTab: "Alerts",
    reportsTab: "Reports",
    strategiesTab: "Strategies",
    controlsTab: "Controls",
    // Login
    loginTitle: "Portfolio Command Center",
    loginSubtitle: "Sign in to your account",
    loginUserId: "User ID",
    loginPassword: "Password",
    loginSignIn: "Sign In",
    loginSigningIn: "Signing in...",
    loginError: "Invalid credentials. Please try again.",
    // Common actions
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    retry: "Retry",
    run: "Run",
    loading: "Loading...",
    saving: "Saving...",
    back: "← Back",
    next: "Next",
    skip: "Skip for now",
    confirm: "Confirm",
    delete: "Delete",
    rename: "Rename",
    // Settings
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
    theme: "Theme",
    language: "Language",
    dark: "Dark",
    bright: "Bright",
    middle: "Middle",
    english: "English",
    hebrew: "Hebrew",
    appearance: "Appearance",
    currentPassword: "Current Password",
    newPassword: "New Password",
    confirmPassword: "Confirm",
    errorCurrentPasswordRequired: "Current password required",
    errorPasswordTooShort: "New password min 8 characters",
    errorPasswordMismatch: "Passwords do not match",
    passwordChangedSuccess: "Password changed successfully",
    errorIncorrectPassword: "Current password is incorrect",
    errorChangePassword: "Failed to change password",
    scheduleUpdated: "Schedule updated",
    errorUpdateSchedule: "Failed to update schedule",
    botToken: "Bot Token",
    chatId: "Chat ID",
    telegramConnected: "Telegram connected!",
    errorConnectTelegram: "Failed to connect Telegram",
    errorBothFields: "Both fields required",
    errorInvalidBotToken: "Invalid bot token format",
    errorInvalidChatId: "Invalid chat ID",
    perWeek: "/ week",
    perDay: "/ day",
    // Days
    daySunday: "Sunday",
    dayMonday: "Monday",
    dayTuesday: "Tuesday",
    dayWednesday: "Wednesday",
    dayThursday: "Thursday",
    dayFriday: "Friday",
    daySaturday: "Saturday",
    // Portfolio
    portfolio: "Portfolio",
    errorLoadPortfolio: "Failed to load portfolio",
    emptyPortfolio: "No positions found",
    addPosition: "+ Add Position",
    colTicker: "Ticker",
    colShares: "Shares",
    colAvgPrice: "Avg ₪",
    colLivePrice: "Live ₪",
    colValue: "Value ₪",
    colPlPct: "P/L %",
    colPl: "P/L ₪",
    colWeight: "Weight",
    colVerdict: "Verdict",
    shares: "Shares",
    avgBuyPrice: "Avg Buy Price",
    livePrice: "Live Price",
    currentValue: "Current Value",
    costBasis: "Cost Basis",
    weight: "Weight",
    accounts: "Accounts",
    priceStale: "Price data may be stale",
    jobsRunning: "job(s) running",
    editPosition: "Edit Position",
    priceHistory: "Price History",
    saveChanges: "Save Changes",
    noChartData: "No chart data available",
    // Summary strip
    totalValue: "Total Value",
    totalPL: "Total P/L",
    positions: "Positions",
    usdIls: "USD/ILS",
    updatedAt: "Updated",
    // Strategies
    strategies: "Strategies",
    errorLoadStrategies: "Failed to load strategies",
    emptyStrategies: "No strategies yet — run a full report",
    noStrategyMatches: "No strategies match your filter",
    searchTicker: "Search ticker...",
    filterAll: "All",
    expiredCatalyst: "Expired catalyst",
    colConfidence: "Confidence",
    colTimeframe: "Timeframe",
    colSize: "Size ₪",
    colWeightPct: "Weight %",
    colReasoning: "Reasoning",
    colUpdated: "Updated",
    // Controls
    controls: "Controls",
    activeJobs: "Active Jobs",
    recentJobs: "Recent Jobs",
    noJobs: "No jobs yet — use the buttons above to get started",
    enterTicker: "TICKER",
    tickerRequired: "Enter a ticker symbol",
    jobDailyTitle: "Daily Brief",
    jobDailyDesc: "Run today's portfolio brief",
    jobFullTitle: "Full Report",
    jobFullDesc: "Analyze all positions",
    jobDeepDiveTitle: "Deep Dive",
    jobDeepDiveDesc: "Full analysis on one ticker",
    jobNewIdeasTitle: "New Ideas",
    jobNewIdeasDesc: "Weekly research scan",
    jobQueued: "queued — you'll be notified when done",
    jobFailed: "Failed to trigger",
    jobCompleted: "completed",
    jobCompletedNotif: "completed ✓",
    jobFailedNotif: "failed — check logs",
    // Reports
    reports: "Reports",
    emptyReports: "No reports yet",
    newerBtn: "← Newer",
    olderBtn: "Older →",
    reportLoadError: "Failed to load report",
    pageOf: "Page",
    // Strategy modal
    reasoning: "Reasoning",
    bullCase: "Bull Case",
    bearCase: "Bear Case",
    entryConditions: "Entry Conditions",
    exitConditions: "Exit Conditions",
    catalysts: "Catalysts",
    noExpiry: "No expiry",
    triggered: "Triggered",
    comingSoon: "Coming soon",
    failedLoadStrategy: "Failed to load strategy",
    runDeepDive: "🔬 Run Deep Dive",
    strategyUpdated: "Updated",
    // Confidence
    confidenceHigh: "High",
    confidenceMedium: "Medium",
    confidenceLow: "Low",
    // Timeframes
    timeframeWeek: "Week",
    timeframeMonths: "Months",
    timeframeLongTerm: "Long Term",
    timeframeUndefined: "—",
    // Verdicts
    verdictBuy: "BUY",
    verdictAdd: "ADD",
    verdictHold: "HOLD",
    verdictReduce: "REDUCE",
    verdictSell: "SELL",
    verdictClose: "CLOSE",
    // Job card
    jobInitializing: "Initializing…",
    jobTickersComplete: "tickers complete",
    jobQueued2: "Queued:",
    jobDone: "Done:",
    jobCompletedOk: "Completed successfully.",
    // Alerts
    alerts: "Alerts",
    errorLoadAlerts: "Failed to load alerts",
    emptyAlerts: "All clear — no alerts right now",
    alertsNeedAttention: "need attention",
    alertCritical: "Sell / Close",
    alertWarning: "Reduce",
    alertOpportunities: "Buy / Add",
    runNow: "Run Now",
    escalationNeeds: "position(s) need deep analysis",
    fullReportStarted: "Full portfolio analysis started — you'll be notified when ready",
    errorStartFullReport: "Failed to start full report",
    // App banner
    healthBanner: "Your AI advisor is experiencing issues. Reports may be delayed — please contact support.",
    // Onboarding
    onboardStep1Title: "Account Setup",
    onboardStep1Sub: "Create your portfolio agent account",
    onboardAdminKey: "Beta Access Code",
    onboardUserId: "User ID",
    onboardPassword: "Password",
    onboardConfirmPassword: "Confirm Password",
    onboardDisplayName: "Display Name",
    onboardUserIdHint: "Login identifier. Cannot be changed.",
    onboardUserIdError: "4–32 characters: letters, numbers, hyphens",
    onboardPasswordHint: "Min 8 characters",
    onboardPasswordError: "Min 8 characters",
    onboardPasswordMismatch: "Passwords do not match",
    onboardFieldRequired: "Required",
    onboardSetPasswordTitle: "🔐 Set Your Password",
    onboardSetPasswordSub: "You've been given a temporary password by your admin. Please set a new one now.",
    onboardPasswordIncorrect: "Current password is incorrect",
    onboardPasswordChangeFailed: "Failed to change password",
    onboardConnecting: "Connecting...",
    onboardContinue: "Continue →",
    onboardStep2Title: "⏰ Your Brief Schedule",
    onboardStep2Sub: "When should your daily portfolio brief run?",
    onboardDailyBriefTime: "Daily Brief Time",
    onboardWeeklyDay: "Weekly Research Day",
    onboardWeeklyTime: "Weekly Research Time",
    onboardScheduleHint: "All times in your selected timezone. Daily briefs run on weekdays only.",
    onboardStep3Title: "🤖 Connect Telegram (Optional)",
    onboardStep3Sub: "Get portfolio alerts and interact with your agent via Telegram.",
    onboardTelegramStep1: "1. Open Telegram → find @BotFather",
    onboardTelegramStep2: "2. Send /newbot → follow instructions",
    onboardTelegramStep3: "3. Paste your bot token below",
    onboardBotTokenHint: "format: 123456789:ABC-xyz...",
    onboardChatIdHint: "Get from @userinfobot on Telegram",
    onboardSkip: "Skip for now",
    onboardConnect: "Connect & Continue →",
    onboardBothFields: "Both bot token and chat ID are required",
    onboardInvalidBotToken: "Invalid bot token format",
    onboardInvalidChatId: "Invalid chat ID format",
    onboardTelegramConnected: "Telegram connected!",
    onboardTelegramFailed: "Failed to connect Telegram. Check your token and chat ID.",
    onboardStep4Title: "Portfolio",
    onboardStep4Sub: "Add your positions across all accounts",
    onboardAddPosition: "+ Add Position",
    onboardAddAccount: "+ Add Account",
    onboardDefaultAccount: "Account",
    onboardReview: "Review",
    onboardTickerLabel: "Ticker",
    onboardSharesLabel: "Shares",
    onboardAvgPriceLabel: "Avg Price",
    onboardExchangeLabel: "Exchange",
    onboardDuplicateTicker: "Duplicate ticker",
    onboardTickerRequired: "Ticker required",
    onboardSharesError: "Positive integer",
    onboardAvgPriceError: "Positive number",
    onboardAddPositionError: "Add at least one position",
    onboardStep5Title: "Confirm & Launch",
    onboardStep5Sub: "Review before launching",
    onboardLaunch: "Launch →",
    onboardLaunching: "Launching...",
    onboardSetupFailed: "Setup failed. Please check your details and try again.",
    onboardReviewAccount: "Account",
    onboardReviewSchedule: "Schedule",
    onboardReviewTelegram: "Telegram",
    onboardReviewPortfolio: "Portfolio",
    onboardTelegramYes: "✓ Connected",
    onboardTelegramNo: "Not connected",
    // Admin
    adminTitle: "Admin Panel",
    adminLoginSub: "rebalancer.shop",
    adminKeyPlaceholder: "Admin Key",
    adminLoginError: "Invalid admin key",
    adminAddUser: "Add User",
    adminCreateUser: "Create User",
    adminCreating: "Creating...",
    adminUserCreationError: "User ID and password required",
    adminUserCreationFailed: "Failed to create user",
    adminDeleteUser: "Delete user",
    adminConfirmDelete: "Delete user",
    adminUserIdLabel: "User ID",
    adminPasswordLabel: "Password",
    adminDisplayNameLabel: "Display Name",
    adminTelegramSection: "Telegram (optional)",
    adminScheduleSection: "Schedule",
    adminRateLimitsSection: "Rate Limits",
    adminDailyTime: "Daily time",
    adminWeeklyDay: "Weekly day",
    adminWeeklyTime: "Weekly time",
    adminModelProfiles: "Model Profiles",
    adminAddProfile: "+ Add Profile",
    adminProfileName: "Profile Name",
    adminProfileNameHint: "e.g. budget",
    adminOrchestrator: "Orchestrator",
    adminAnalysts: "Analysts",
    adminResearchers: "Researchers",
    adminFailedLoadProfiles: "Failed to load profiles",
    adminFailedUpdateProfile: "Failed to update profile",
    adminFailedCreateProfile: "Failed to create profile",
    adminFailedDeleteProfile: "Failed to delete profile",
    adminFailedSwitchProfile: "Failed to switch profile",
    adminConfirmDeleteProfile: "Delete profile",
    adminStatusOk: "OK",
    adminStatusError: "Error ⚠",
    adminStateActive: "ACTIVE",
    adminStateBootstrapping: "BOOTSTRAPPING",
    adminPortfolioLoaded: "portfolio ✓",
    adminPortfolioMissing: "portfolio ✗",
    adminFailedLoadUsers: "Failed to load users",
    adminFailedDeleteUser: "Failed to delete user",
    adminUserDeleted: "User deleted",
    adminGateway: "Gateway",
    adminUsers: "Users",
    adminActive: "Active",
    adminRunning: "🟢 running",
    adminStopped: "🔴 stopped",
    adminNoUsers: "No users yet",
    adminTotal: "total",
    adminSignIn: "Sign In",
    adminMax: "max",
    adminPer: "per",
    adminHrs: "hrs",
    adminRisk: "Risk",
    adminEditTelegram: "Edit Telegram",
    adminAddTelegram: "Add Telegram",
    adminSaveTelegram: "Save Telegram",
    adminEditLimits: "Edit Limits",
    adminDeleting: "Deleting...",
    adminTypeToConfirm: "Type",
    adminToConfirmDeletion: "to confirm deletion:",
    adminTelegramYes: "Telegram: ✅ connected",
    adminTelegramNo: "Telegram: ✗ not connected",
    adminDeepDives: "Deep dives:",
    adminFullReportsLabel: "Full reports:",
    // Onboarding additional
    onboardPosition: "position",
    onboardPositions: "positions",
    onboardAccountSingular: "account",
    onboardAcross: "across",
    onboardAt: "at",
    onboardDailyAt: "Daily at",
    onboardLaunchBtn: "Launch My Portfolio Agent 🚀",
    // Greetings
    greeting1: "Let's monitor some positions 📈",
    greeting2: "Keep an eye on things 👀",
    greeting3: "Your portfolio, your rules 🚀",
    greeting4: "Time to check the numbers 📊",
    greeting5: "Welcome back, boss 👑",
    greeting6: "Let's make some gains 💰",
  },
  he: {
    // Navigation
    settingsTab: "הגדרות",
    portfolioTab: "תיק",
    alertsTab: "התראות",
    reportsTab: "דוחות",
    strategiesTab: "אסטרטגיות",
    controlsTab: "בקרה",
    // Login
    loginTitle: "מרכז פיקוד תיק השקעות",
    loginSubtitle: "התחבר לחשבונך",
    loginUserId: "מזהה משתמש",
    loginPassword: "סיסמה",
    loginSignIn: "כניסה",
    loginSigningIn: "מתחבר...",
    loginError: "פרטי כניסה שגויים. נסה שנית.",
    // Common actions
    save: "שמירה",
    cancel: "ביטול",
    edit: "עריכה",
    retry: "נסה שנית",
    run: "הפעל",
    loading: "טוען...",
    saving: "שומר...",
    back: "→ חזרה",
    next: "הבא",
    skip: "דלג לעת עתה",
    confirm: "אישור",
    delete: "מחיקה",
    rename: "שינוי שם",
    // Settings
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
    setByAdmin: "(מוגדר ע\"י מנהל)",
    logout: "התנתקות",
    theme: "נושא",
    language: "שפה",
    dark: "כהה",
    bright: "בהיר",
    middle: "בינוני",
    english: "אנגלית",
    hebrew: "עברית",
    appearance: "מראה",
    currentPassword: "סיסמה נוכחית",
    newPassword: "סיסמה חדשה",
    confirmPassword: "אישור",
    errorCurrentPasswordRequired: "יש להזין את הסיסמה הנוכחית",
    errorPasswordTooShort: "סיסמה חדשה — מינימום 8 תווים",
    errorPasswordMismatch: "הסיסמאות אינן תואמות",
    passwordChangedSuccess: "הסיסמה שונתה בהצלחה",
    errorIncorrectPassword: "הסיסמה הנוכחית שגויה",
    errorChangePassword: "שינוי הסיסמה נכשל",
    scheduleUpdated: "לוח הזמנים עודכן",
    errorUpdateSchedule: "עדכון לוח הזמנים נכשל",
    botToken: "טוקן בוט",
    chatId: "מזהה שיחה",
    telegramConnected: "טלגרם חובר בהצלחה!",
    errorConnectTelegram: "חיבור הטלגרם נכשל",
    errorBothFields: "שני השדות נדרשים",
    errorInvalidBotToken: "פורמט טוקן בוט לא תקין",
    errorInvalidChatId: "מזהה שיחה לא תקין",
    perWeek: "/ שבוע",
    perDay: "/ יום",
    // Days
    daySunday: "ראשון",
    dayMonday: "שני",
    dayTuesday: "שלישי",
    dayWednesday: "רביעי",
    dayThursday: "חמישי",
    dayFriday: "שישי",
    daySaturday: "שבת",
    // Portfolio
    portfolio: "תיק השקעות",
    errorLoadPortfolio: "טעינת תיק ההשקעות נכשלה",
    emptyPortfolio: "לא נמצאו פוזיציות",
    addPosition: "+ הוסף פוזיציה",
    colTicker: "מניה",
    colShares: "כמות",
    colAvgPrice: "ממוצע ₪",
    colLivePrice: "מחיר ₪",
    colValue: "ערך ₪",
    colPlPct: "ר/ה %",
    colPl: "ר/ה ₪",
    colWeight: "משקל",
    colVerdict: "המלצה",
    shares: "כמות מניות",
    avgBuyPrice: "מחיר ממוצע",
    livePrice: "מחיר חי",
    currentValue: "ערך נוכחי",
    costBasis: "בסיס עלות",
    weight: "משקל",
    accounts: "חשבונות",
    priceStale: "נתוני מחיר עלולים להיות ישנים",
    jobsRunning: "משימות רצות",
    editPosition: "ערוך פוזיציה",
    priceHistory: "היסטוריית מחירים",
    saveChanges: "שמור שינויים",
    noChartData: "אין נתוני גרף זמינים",
    // Summary strip
    totalValue: "ערך כולל",
    totalPL: "ר/ה כולל",
    positions: "פוזיציות",
    usdIls: "דולר/שקל",
    updatedAt: "עודכן",
    // Strategies
    strategies: "אסטרטגיות",
    errorLoadStrategies: "טעינת האסטרטגיות נכשלה",
    emptyStrategies: "אין אסטרטגיות עדיין — הפעל דוח מלא",
    noStrategyMatches: "לא נמצאו אסטרטגיות התואמות לסינון",
    searchTicker: "חיפוש מניה...",
    filterAll: "הכל",
    expiredCatalyst: "קטליזטור פג תוקף",
    colConfidence: "ביטחון",
    colTimeframe: "מסגרת זמן",
    colSize: "גודל ₪",
    colWeightPct: "משקל %",
    colReasoning: "נימוק",
    colUpdated: "עדכון",
    // Controls
    controls: "בקרה",
    activeJobs: "משימות פעילות",
    recentJobs: "משימות אחרונות",
    noJobs: "אין משימות עדיין — השתמש בכפתורים למעלה להתחיל",
    enterTicker: "מניה",
    tickerRequired: "הזן סמל מניה",
    jobDailyTitle: "סיכום יומי",
    jobDailyDesc: "הפעל סיכום יומי של תיק ההשקעות",
    jobFullTitle: "דוח מלא",
    jobFullDesc: "נתח את כל הפוזיציות",
    jobDeepDiveTitle: "צלילה עמוקה",
    jobDeepDiveDesc: "ניתוח מלא למניה אחת",
    jobNewIdeasTitle: "רעיונות חדשים",
    jobNewIdeasDesc: "סריקת מחקר שבועית",
    jobQueued: "נוסף לתור — תקבל התראה בסיום",
    jobFailed: "הפעלה נכשלה",
    jobCompleted: "הושלם",
    jobCompletedNotif: "הושלם ✓",
    jobFailedNotif: "נכשל — בדוק את הלוגים",
    // Reports
    reports: "דוחות",
    emptyReports: "אין דוחות עדיין",
    newerBtn: "→ חדשים",
    olderBtn: "ישנים ←",
    reportLoadError: "טעינת הדוח נכשלה",
    pageOf: "עמוד",
    // Strategy modal
    reasoning: "נימוק",
    bullCase: "תרחיש שורי",
    bearCase: "תרחיש דובי",
    entryConditions: "תנאי כניסה",
    exitConditions: "תנאי יציאה",
    catalysts: "קטליזטורים",
    noExpiry: "ללא תפוגה",
    triggered: "הופעל",
    comingSoon: "בקרוב",
    failedLoadStrategy: "טעינת האסטרטגיה נכשלה",
    runDeepDive: "🔬 הפעל צלילה עמוקה",
    strategyUpdated: "עודכן",
    // Confidence
    confidenceHigh: "גבוה",
    confidenceMedium: "בינוני",
    confidenceLow: "נמוך",
    // Timeframes
    timeframeWeek: "שבוע",
    timeframeMonths: "חודשים",
    timeframeLongTerm: "טווח ארוך",
    timeframeUndefined: "—",
    // Verdicts
    verdictBuy: "קנה",
    verdictAdd: "הוסף",
    verdictHold: "החזק",
    verdictReduce: "הפחת",
    verdictSell: "מכור",
    verdictClose: "סגור",
    // Job card
    jobInitializing: "מאתחל…",
    jobTickersComplete: "מניות הושלמו",
    jobQueued2: "נוצר בתור:",
    jobDone: "הושלם:",
    jobCompletedOk: "הושלם בהצלחה.",
    // Alerts
    alerts: "התראות",
    errorLoadAlerts: "טעינת ההתראות נכשלה",
    emptyAlerts: "הכל בסדר — אין התראות כרגע",
    alertsNeedAttention: "דורשות תשומת לב",
    alertCritical: "מכור / סגור",
    alertWarning: "הפחת",
    alertOpportunities: "קנה / הוסף",
    runNow: "הפעל עכשיו",
    escalationNeeds: "פוזיציות דורשות ניתוח עמוק",
    fullReportStarted: "ניתוח תיק מלא החל — תקבל התראה כשיסתיים",
    errorStartFullReport: "הפעלת הדוח המלא נכשלה",
    // App banner
    healthBanner: "היועץ ה-AI חווה בעיות. הדוחות עלולים להתעכב — אנא פנה לתמיכה.",
    // Onboarding
    onboardStep1Title: "הגדרת חשבון",
    onboardStep1Sub: "צור את חשבון סוכן התיק שלך",
    onboardAdminKey: "קוד גישה",
    onboardUserId: "מזהה משתמש",
    onboardPassword: "סיסמה",
    onboardConfirmPassword: "אישור סיסמה",
    onboardDisplayName: "שם תצוגה",
    onboardUserIdHint: "מזהה כניסה. לא ניתן לשינוי.",
    onboardUserIdError: "4–32 תווים: אותיות, ספרות, מקפים",
    onboardPasswordHint: "מינימום 8 תווים",
    onboardPasswordError: "מינימום 8 תווים",
    onboardPasswordMismatch: "הסיסמאות אינן תואמות",
    onboardFieldRequired: "שדה חובה",
    onboardSetPasswordTitle: "🔐 הגדר סיסמה",
    onboardSetPasswordSub: "קיבלת סיסמה זמנית מהמנהל. אנא הגדר סיסמה חדשה.",
    onboardPasswordIncorrect: "הסיסמה הנוכחית שגויה",
    onboardPasswordChangeFailed: "שינוי הסיסמה נכשל",
    onboardConnecting: "מתחבר...",
    onboardContinue: "המשך ←",
    onboardStep2Title: "⏰ לוח הזמנים שלך",
    onboardStep2Sub: "מתי להפעיל את הסיכום היומי?",
    onboardDailyBriefTime: "שעת סיכום יומי",
    onboardWeeklyDay: "יום מחקר שבועי",
    onboardWeeklyTime: "שעת מחקר שבועי",
    onboardScheduleHint: "כל השעות באזור הזמן שנבחר. סיכומים יומיים בימי חול בלבד.",
    onboardStep3Title: "🤖 חיבור טלגרם (אופציונלי)",
    onboardStep3Sub: "קבל התראות ותקשר עם הסוכן שלך דרך טלגרם.",
    onboardTelegramStep1: "1. פתח טלגרם → חפש @BotFather",
    onboardTelegramStep2: "2. שלח /newbot → עקוב אחר ההוראות",
    onboardTelegramStep3: "3. הדבק את טוקן הבוט למטה",
    onboardBotTokenHint: "פורמט: 123456789:ABC-xyz...",
    onboardChatIdHint: "קבל מ-@userinfobot בטלגרם",
    onboardSkip: "דלג לעת עתה",
    onboardConnect: "חבר והמשך ←",
    onboardBothFields: "טוקן בוט ומזהה שיחה נדרשים",
    onboardInvalidBotToken: "פורמט טוקן בוט לא תקין",
    onboardInvalidChatId: "פורמט מזהה שיחה לא תקין",
    onboardTelegramConnected: "טלגרם חובר בהצלחה!",
    onboardTelegramFailed: "חיבור הטלגרם נכשל. בדוק את הטוקן ומזהה השיחה.",
    onboardStep4Title: "תיק השקעות",
    onboardStep4Sub: "הוסף את הפוזיציות שלך בכל החשבונות",
    onboardAddPosition: "+ הוסף פוזיציה",
    onboardAddAccount: "+ הוסף חשבון",
    onboardDefaultAccount: "חשבון",
    onboardReview: "סקירה",
    onboardTickerLabel: "מניה",
    onboardSharesLabel: "כמות",
    onboardAvgPriceLabel: "מחיר ממוצע",
    onboardExchangeLabel: "בורסה",
    onboardDuplicateTicker: "מניה כפולה",
    onboardTickerRequired: "מניה נדרשת",
    onboardSharesError: "מספר שלם חיובי",
    onboardAvgPriceError: "מספר חיובי",
    onboardAddPositionError: "הוסף לפחות פוזיציה אחת",
    onboardStep5Title: "אישור והשקה",
    onboardStep5Sub: "בדוק לפני ההשקה",
    onboardLaunch: "השקה ←",
    onboardLaunching: "משיק...",
    onboardSetupFailed: "ההגדרה נכשלה. בדוק את הפרטים ונסה שנית.",
    onboardReviewAccount: "חשבון",
    onboardReviewSchedule: "לוח זמנים",
    onboardReviewTelegram: "טלגרם",
    onboardReviewPortfolio: "תיק השקעות",
    onboardTelegramYes: "✓ מחובר",
    onboardTelegramNo: "לא מחובר",
    // Admin
    adminTitle: "לוח ניהול",
    adminLoginSub: "rebalancer.shop",
    adminKeyPlaceholder: "מפתח מנהל",
    adminLoginError: "מפתח מנהל שגוי",
    adminAddUser: "הוסף משתמש",
    adminCreateUser: "צור משתמש",
    adminCreating: "יוצר...",
    adminUserCreationError: "מזהה משתמש וסיסמה נדרשים",
    adminUserCreationFailed: "יצירת המשתמש נכשלה",
    adminDeleteUser: "מחק משתמש",
    adminConfirmDelete: "מחק משתמש",
    adminUserIdLabel: "מזהה משתמש",
    adminPasswordLabel: "סיסמה",
    adminDisplayNameLabel: "שם תצוגה",
    adminTelegramSection: "טלגרם (אופציונלי)",
    adminScheduleSection: "לוח זמנים",
    adminRateLimitsSection: "מגבלות שימוש",
    adminDailyTime: "שעה יומית",
    adminWeeklyDay: "יום שבועי",
    adminWeeklyTime: "שעה שבועית",
    adminModelProfiles: "פרופילי מודל",
    adminAddProfile: "+ הוסף פרופיל",
    adminProfileName: "שם פרופיל",
    adminProfileNameHint: "לדוגמה: budget",
    adminOrchestrator: "מתאם",
    adminAnalysts: "אנליסטים",
    adminResearchers: "חוקרים",
    adminFailedLoadProfiles: "טעינת הפרופילים נכשלה",
    adminFailedUpdateProfile: "עדכון הפרופיל נכשל",
    adminFailedCreateProfile: "יצירת הפרופיל נכשלה",
    adminFailedDeleteProfile: "מחיקת הפרופיל נכשלה",
    adminFailedSwitchProfile: "החלפת הפרופיל נכשלה",
    adminConfirmDeleteProfile: "מחק פרופיל",
    adminStatusOk: "תקין",
    adminStatusError: "שגיאה ⚠",
    adminStateActive: "פעיל",
    adminStateBootstrapping: "מאתחל",
    adminPortfolioLoaded: "תיק ✓",
    adminPortfolioMissing: "תיק ✗",
    adminFailedLoadUsers: "טעינת המשתמשים נכשלה",
    adminFailedDeleteUser: "מחיקת המשתמש נכשלה",
    adminUserDeleted: "המשתמש נמחק",
    adminGateway: "שער",
    adminUsers: "משתמשים",
    adminActive: "פעילים",
    adminRunning: "🟢 פועל",
    adminStopped: "🔴 עצור",
    adminNoUsers: "אין משתמשים עדיין",
    adminTotal: "סה\"כ",
    adminSignIn: "כניסה",
    adminMax: "מקס",
    adminPer: "לכל",
    adminHrs: "שעות",
    adminRisk: "סיכון",
    adminEditTelegram: "ערוך טלגרם",
    adminAddTelegram: "הוסף טלגרם",
    adminSaveTelegram: "שמור טלגרם",
    adminEditLimits: "ערוך מגבלות",
    adminDeleting: "מוחק...",
    adminTypeToConfirm: "הקלד",
    adminToConfirmDeletion: "לאישור המחיקה:",
    adminTelegramYes: "טלגרם: ✅ מחובר",
    adminTelegramNo: "טלגרם: ✗ לא מחובר",
    adminDeepDives: "צלילות עמוקות:",
    adminFullReportsLabel: "דוחות מלאים:",
    // Onboarding additional
    onboardPosition: "פוזיציה",
    onboardPositions: "פוזיציות",
    onboardAccountSingular: "חשבון",
    onboardAcross: "על פני",
    onboardAt: "ב-",
    onboardDailyAt: "יומי ב-",
    onboardLaunchBtn: "השקת סוכן תיק ההשקעות שלי 🚀",
    // Greetings
    greeting1: "בואו נעקוב אחרי הפוזיציות 📈",
    greeting2: "שמרו על העין 👀",
    greeting3: "התיק שלכם, הכללים שלכם 🚀",
    greeting4: "זמן לבדוק את המספרים 📊",
    greeting5: "ברוך שובך 👑",
    greeting6: "בואו נרוויח 💰",
  },
};

export function t(key: TranslationKey, language: Language): string {
  return translations[language][key] ?? translations.en[key] ?? key;
}

export function tConfidence(confidence: string, language: Language): string {
  if (confidence === "high") return t("confidenceHigh", language);
  if (confidence === "medium") return t("confidenceMedium", language);
  if (confidence === "low") return t("confidenceLow", language);
  return confidence;
}

export function tTimeframe(timeframe: string, language: Language): string {
  if (timeframe === "week") return t("timeframeWeek", language);
  if (timeframe === "months") return t("timeframeMonths", language);
  if (timeframe === "long_term") return t("timeframeLongTerm", language);
  if (timeframe === "undefined") return t("timeframeUndefined", language);
  return timeframe;
}

export function getGreeting(name: string | null | undefined, language: Language): string {
  const keys: TranslationKey[] = ["greeting1", "greeting2", "greeting3", "greeting4", "greeting5", "greeting6"];
  const randomKey = keys[Math.floor(Math.random() * keys.length)]!;
  const phrase = t(randomKey, language);
  if (!name) return phrase;
  if (language === "he") return `שלום ${name} — ${phrase}`;
  return `Hello ${name} — ${phrase}`;
}

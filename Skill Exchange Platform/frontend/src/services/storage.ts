import { 
  Student, 
  SkillExchange, 
  ConnectionRequest, 
  LearningSession, 
  Review, 
  Message, 
  Conversation, 
  Achievement, 
  UserPreferences,
  DemoReport,
  PaymentTransaction,
  UserSubscription
} from '../types';
import { 
  INITIAL_STUDENTS, 
  INITIAL_CURRENT_USER, 
  INITIAL_EXCHANGES, 
  INITIAL_CONNECTIONS, 
  INITIAL_SESSIONS, 
  INITIAL_REVIEWS, 
  INITIAL_MESSAGES, 
  INITIAL_CONVERSATIONS, 
  INITIAL_ACHIEVEMENTS,
  INITIAL_WALLET_BALANCE,
  INITIAL_SUBSCRIPTION,
  INITIAL_TRANSACTIONS
} from '../data/initialData';

const KEYS = {
  CURRENT_USER_ID: 'skillbridge_current_user_id',
  STUDENTS: 'skillbridge_students',
  EXCHANGES: 'skillbridge_exchanges',
  CONNECTIONS: 'skillbridge_connections',
  SESSIONS: 'skillbridge_sessions',
  REVIEWS: 'skillbridge_reviews',
  MESSAGES: 'skillbridge_messages',
  CONVERSATIONS: 'skillbridge_conversations',
  ACHIEVEMENTS: 'skillbridge_achievements',
  PREFERENCES: 'skillbridge_preferences',
  REPORTS: 'skillbridge_reports',
  SAVED_PROFILES: 'skillbridge_saved_profiles',
  WALLET_BALANCE: 'skillbridge_wallet_balance',
  SUBSCRIPTION: 'skillbridge_subscription',
  TRANSACTIONS: 'skillbridge_transactions',
};

const DEFAULT_PREFERENCES: UserPreferences = {
  learningMethod: 'Flexible',
  preferredDays: ['Monday', 'Wednesday', 'Friday', 'Saturday'],
  preferredTimes: ['18:00 - 21:00'],
  interests: ['Frontend Engineering', 'Distributed Systems', 'UI/UX Design'],
  profileVisibility: 'Public',
  showCollege: true,
  showEmail: false,
};

function safeGet<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key);
    if (!item) return fallback;
    return JSON.parse(item) as T;
  } catch (err) {
    console.error(`Error reading ${key} from localStorage:`, err);
    return fallback;
  }
}

function safeSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`Error writing ${key} to localStorage:`, err);
  }
}

export const StorageService = {
  // Current logged in user ID (or null)
  getCurrentUserId(): string | null {
    return safeGet<string | null>(KEYS.CURRENT_USER_ID, INITIAL_CURRENT_USER.id);
  },
  setCurrentUserId(id: string | null): void {
    safeSet(KEYS.CURRENT_USER_ID, id);
  },

  // Students list
  getStudents(): Student[] {
    return safeGet<Student[]>(KEYS.STUDENTS, INITIAL_STUDENTS);
  },
  setStudents(students: Student[]): void {
    safeSet(KEYS.STUDENTS, students);
  },

  // Exchanges
  getExchanges(): SkillExchange[] {
    return safeGet<SkillExchange[]>(KEYS.EXCHANGES, INITIAL_EXCHANGES);
  },
  setExchanges(exchanges: SkillExchange[]): void {
    safeSet(KEYS.EXCHANGES, exchanges);
  },

  // Connections
  getConnections(): ConnectionRequest[] {
    return safeGet<ConnectionRequest[]>(KEYS.CONNECTIONS, INITIAL_CONNECTIONS);
  },
  setConnections(connections: ConnectionRequest[]): void {
    safeSet(KEYS.CONNECTIONS, connections);
  },

  // Sessions
  getSessions(): LearningSession[] {
    return safeGet<LearningSession[]>(KEYS.SESSIONS, INITIAL_SESSIONS);
  },
  setSessions(sessions: LearningSession[]): void {
    safeSet(KEYS.SESSIONS, sessions);
  },

  // Reviews
  getReviews(): Review[] {
    return safeGet<Review[]>(KEYS.REVIEWS, INITIAL_REVIEWS);
  },
  setReviews(reviews: Review[]): void {
    safeSet(KEYS.REVIEWS, reviews);
  },

  // Messages & Conversations
  getMessages(): Message[] {
    return safeGet<Message[]>(KEYS.MESSAGES, INITIAL_MESSAGES);
  },
  setMessages(messages: Message[]): void {
    safeSet(KEYS.MESSAGES, messages);
  },

  getConversations(): Conversation[] {
    return safeGet<Conversation[]>(KEYS.CONVERSATIONS, INITIAL_CONVERSATIONS);
  },
  setConversations(conversations: Conversation[]): void {
    safeSet(KEYS.CONVERSATIONS, conversations);
  },

  // Achievements
  getAchievements(): Achievement[] {
    return safeGet<Achievement[]>(KEYS.ACHIEVEMENTS, INITIAL_ACHIEVEMENTS);
  },
  setAchievements(achievements: Achievement[]): void {
    safeSet(KEYS.ACHIEVEMENTS, achievements);
  },

  // Preferences
  getPreferences(): UserPreferences {
    return safeGet<UserPreferences>(KEYS.PREFERENCES, DEFAULT_PREFERENCES);
  },
  setPreferences(preferences: UserPreferences): void {
    safeSet(KEYS.PREFERENCES, preferences);
  },

  // Saved / Bookmarked Profiles
  getSavedProfileIds(): string[] {
    return safeGet<string[]>(KEYS.SAVED_PROFILES, []);
  },
  setSavedProfileIds(ids: string[]): void {
    safeSet(KEYS.SAVED_PROFILES, ids);
  },

  // Demo Reports
  getReports(): DemoReport[] {
    return safeGet<DemoReport[]>(KEYS.REPORTS, []);
  },
  addReport(report: DemoReport): void {
    const existing = safeGet<DemoReport[]>(KEYS.REPORTS, []);
    safeSet(KEYS.REPORTS, [report, ...existing]);
  },

  // Wallet & Payment Transactions
  getWalletBalance(): number {
    return safeGet<number>(KEYS.WALLET_BALANCE, INITIAL_WALLET_BALANCE);
  },
  setWalletBalance(balance: number): void {
    safeSet(KEYS.WALLET_BALANCE, balance);
  },

  getSubscription(): UserSubscription {
    return safeGet<UserSubscription>(KEYS.SUBSCRIPTION, INITIAL_SUBSCRIPTION);
  },
  setSubscription(subscription: UserSubscription): void {
    safeSet(KEYS.SUBSCRIPTION, subscription);
  },

  getTransactions(): PaymentTransaction[] {
    return safeGet<PaymentTransaction[]>(KEYS.TRANSACTIONS, INITIAL_TRANSACTIONS);
  },
  setTransactions(transactions: PaymentTransaction[]): void {
    safeSet(KEYS.TRANSACTIONS, transactions);
  },

  // Factory Reset
  resetFactoryDefaults(): void {
    localStorage.removeItem(KEYS.CURRENT_USER_ID);
    localStorage.removeItem(KEYS.STUDENTS);
    localStorage.removeItem(KEYS.EXCHANGES);
    localStorage.removeItem(KEYS.CONNECTIONS);
    localStorage.removeItem(KEYS.SESSIONS);
    localStorage.removeItem(KEYS.REVIEWS);
    localStorage.removeItem(KEYS.MESSAGES);
    localStorage.removeItem(KEYS.CONVERSATIONS);
    localStorage.removeItem(KEYS.ACHIEVEMENTS);
    localStorage.removeItem(KEYS.PREFERENCES);
    localStorage.removeItem(KEYS.REPORTS);
    localStorage.removeItem(KEYS.SAVED_PROFILES);
    localStorage.removeItem(KEYS.WALLET_BALANCE);
    localStorage.removeItem(KEYS.SUBSCRIPTION);
    localStorage.removeItem(KEYS.TRANSACTIONS);
  }
};

export type ProficiencyLevel = 'Beginner' | 'Intermediate' | 'Advanced';
export type SkillPriority = 'High' | 'Medium' | 'Low';
export type SkillType = 'offered' | 'wanted';
export type LearningMethod = 'Online' | 'In-person' | 'Flexible';
export type YearOfStudy = 'First Year' | 'Second Year' | 'Third Year' | 'Fourth Year' | 'Graduate / Other';

export type SkillCategory = 
  | 'Programming'
  | 'Web Development'
  | 'Data Science'
  | 'Database Management'
  | 'UI/UX Design'
  | 'Computer Science'
  | 'Communication'
  | 'Career Development'
  | 'Other';

export interface Skill {
  id: string;
  name: string;
  category: SkillCategory;
  proficiency: ProficiencyLevel;
  type: SkillType;
  description?: string;
  priority?: SkillPriority; // For wanted skills
}

export interface Student {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  initials: string;
  college: string;
  department: string;
  yearOfStudy: YearOfStudy;
  bio: string;
  skillsOffered: Skill[];
  skillsWanted: Skill[];
  preferredMethod: LearningMethod;
  availability: string[]; // e.g. ["Weekdays Evenings", "Weekends"]
  languages: string[];
  rating: number;
  reviewCount: number;
  completedExchangesCount: number;
  joinedDate: string;
}

export type ConnectionStatus = 'Pending' | 'Accepted' | 'Declined' | 'Cancelled';

export interface ConnectionRequest {
  id: string;
  senderId: string;
  receiverId: string;
  status: ConnectionStatus;
  createdAt: string;
  message?: string;
}

export type ExchangeStatus = 'Pending' | 'Accepted' | 'Active' | 'Completed' | 'Cancelled';

export interface SkillExchange {
  id: string;
  proposerId: string;
  partnerId: string;
  teachSkillName: string; // What current proposer teaches
  learnSkillName: string; // What current proposer wants to learn
  description: string;
  proposedSchedule: string;
  status: ExchangeStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: string;
  read: boolean;
}

export interface Conversation {
  id: string;
  participantIds: [string, string];
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount: number;
}

export type SessionStatus = 'Upcoming' | 'Completed' | 'Cancelled';

export interface LearningSession {
  id: string;
  exchangeId?: string;
  partnerId: string;
  skillName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  durationMinutes: number; // e.g. 45, 60, 90
  learningMethod: LearningMethod;
  notes?: string;
  status: SessionStatus;
  createdAt: string;
}

export interface Review {
  id: string;
  exchangeId: string;
  authorId: string;
  targetStudentId: string;
  rating: number; // 1-5
  comment: string;
  createdAt: string;
  skillName: string;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: 'Community' | 'Teaching' | 'Learning' | 'Milestone';
  isUnlocked: boolean;
  progress: number;
  maxProgress: number;
  unlockedAt?: string;
}

export interface UserPreferences {
  learningMethod: LearningMethod;
  preferredDays: string[];
  preferredTimes: string[];
  interests: string[];
  profileVisibility: 'Public' | 'Campus' | 'Connections';
  showCollege: boolean;
  showEmail: boolean;
}

export interface ToastNotification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title?: string;
  message: string;
}

export interface MatchScoreResult {
  student: Student;
  score: number; // 0 - 100
  canTeachMe: string[]; // skills they offer that I want
  canLearnFromMe: string[]; // skills I offer that they want
  compatibilityLabel: 'Direct Mutual Match' | 'Strong Match' | 'Good Match' | 'Complementary Match';
  explanation: string;
  isReciprocal: boolean;
}

export interface DemoReport {
  id: string;
  reporterId: string;
  targetStudentId: string;
  reason: string;
  details: string;
  createdAt: string;
}

// Payment System Types
export type PaymentMethodType = 'card' | 'upi' | 'wallet' | 'netbanking';
export type PaymentStatus = 'completed' | 'pending' | 'failed' | 'refunded';
export type PaymentPurpose = 'wallet_topup' | 'pro_subscription' | 'session_booking' | 'mentor_tip';

export interface PaymentDetails {
  cardLast4?: string;
  cardBrand?: string;
  upiId?: string;
  bankName?: string;
}

export interface PaymentTransaction {
  id: string; // e.g. TXN-84920
  invoiceNumber: string; // e.g. INV-2026-081
  userId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  purpose: PaymentPurpose;
  title: string;
  description?: string;
  paymentMethod: PaymentMethodType;
  paymentDetails: PaymentDetails;
  createdAt: string;
  recipientName?: string;
  recipientId?: string;
}

export type SubscriptionPlan = 'free' | 'pro_monthly' | 'pro_semester';

export interface UserSubscription {
  plan: SubscriptionPlan;
  status: 'active' | 'inactive';
  expiresAt?: string;
  autoRenew?: boolean;
}

export interface PaymentCheckoutOptions {
  amount: number;
  title: string;
  purpose: PaymentPurpose;
  description?: string;
  recipientName?: string;
  recipientId?: string;
  targetPlan?: SubscriptionPlan;
  onSuccess?: (transaction: PaymentTransaction) => void;
}

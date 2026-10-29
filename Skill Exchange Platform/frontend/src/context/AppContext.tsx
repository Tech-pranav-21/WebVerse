import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Student, 
  Skill, 
  SkillExchange, 
  ConnectionRequest, 
  LearningSession, 
  Review, 
  Message, 
  Conversation, 
  Achievement, 
  UserPreferences,
  ToastNotification,
  ExchangeStatus,
  SessionStatus,
  YearOfStudy,
  LearningMethod,
  PaymentTransaction,
  UserSubscription,
  PaymentMethodType,
  PaymentDetails,
  PaymentCheckoutOptions,
  SubscriptionPlan
} from '../types';
import { StorageService } from '../services/storage';
import { 
  INITIAL_CURRENT_USER,
  INITIAL_WALLET_BALANCE,
  INITIAL_SUBSCRIPTION,
  INITIAL_TRANSACTIONS
} from '../data/initialData';

interface AppContextType {
  currentUser: Student | null;
  students: Student[];
  exchanges: SkillExchange[];
  connections: ConnectionRequest[];
  sessions: LearningSession[];
  reviews: Review[];
  messages: Message[];
  conversations: Conversation[];
  achievements: Achievement[];
  preferences: UserPreferences;
  savedProfileIds: string[];
  toasts: ToastNotification[];
  
  // Toasts
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string, title?: string) => void;
  removeToast: (id: string) => void;

  // Auth
  login: (email: string) => boolean;
  loginAs: (studentId: string) => void;
  logout: () => void;
  register: (data: {
    name: string;
    email: string;
    college: string;
    department: string;
    yearOfStudy: YearOfStudy;
  }) => void;

  // Skills
  addSkill: (skill: Omit<Skill, 'id'>) => void;
  editSkill: (id: string, skill: Partial<Skill>) => void;
  deleteSkill: (id: string) => void;

  // Connections
  sendConnectionRequest: (receiverId: string, message?: string) => boolean;
  respondConnectionRequest: (requestId: string, status: 'Accepted' | 'Declined' | 'Cancelled') => void;
  removeConnection: (partnerId: string) => void;
  getConnectionWith: (studentId: string) => ConnectionRequest | undefined;

  // Exchanges
  proposeExchange: (data: {
    partnerId: string;
    teachSkillName: string;
    learnSkillName: string;
    description: string;
    proposedSchedule: string;
  }) => void;
  updateExchangeStatus: (exchangeId: string, status: ExchangeStatus) => void;

  // Messaging
  sendMessage: (receiverId: string, text: string) => void;
  markConversationRead: (conversationId: string) => void;

  // Sessions
  scheduleSession: (data: {
    exchangeId?: string;
    partnerId: string;
    skillName: string;
    date: string;
    startTime: string;
    durationMinutes: number;
    learningMethod: LearningMethod;
    notes?: string;
  }) => void;
  editSession: (sessionId: string, data: Partial<LearningSession>) => void;
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;

  // Reviews
  submitReview: (exchangeId: string, targetStudentId: string, rating: number, comment: string, skillName: string) => boolean;

  // Payment & Wallet System
  walletBalance: number;
  subscription: UserSubscription;
  transactions: PaymentTransaction[];
  checkoutModalOpen: boolean;
  checkoutOptions: PaymentCheckoutOptions | null;
  selectedReceiptTransaction: PaymentTransaction | null;
  openCheckout: (options: PaymentCheckoutOptions) => void;
  closeCheckout: () => void;
  processPayment: (details: {
    method: PaymentMethodType;
    paymentDetails: PaymentDetails;
    simulateFailure?: boolean;
    failureReason?: string;
  }) => Promise<{ success: boolean; transaction?: PaymentTransaction; error?: string }>;
  openReceiptModal: (transaction: PaymentTransaction) => void;
  closeReceiptModal: () => void;
  refundTransaction: (transactionId: string) => void;
  subscribeToPro: (plan?: 'pro_monthly' | 'pro_semester') => void;
  cancelSubscription: () => void;
  topUpWallet: (amount: number) => void;
  sendTip: (recipient: Student, amount: number, note?: string) => void;
  bookPaidSession: (data: {
    partner: Student;
    skillName: string;
    amount: number;
    date: string;
    startTime: string;
    durationMinutes: number;
    learningMethod: LearningMethod;
    notes?: string;
  }) => void;

  // Profile & Saved
  toggleSaveProfile: (studentId: string) => void;
  reportProfile: (targetStudentId: string, reason: string, details: string) => void;
  updateProfile: (data: Partial<Student>) => void;
  updatePreferences: (data: UserPreferences) => void;
  resetDemoData: () => void;
  deleteDemoAccount: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [students, setStudents] = useState<Student[]>(() => StorageService.getStudents());
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => StorageService.getCurrentUserId());
  const [exchanges, setExchanges] = useState<SkillExchange[]>(() => StorageService.getExchanges());
  const [connections, setConnections] = useState<ConnectionRequest[]>(() => StorageService.getConnections());
  const [sessions, setSessions] = useState<LearningSession[]>(() => StorageService.getSessions());
  const [reviews, setReviews] = useState<Review[]>(() => StorageService.getReviews());
  const [messages, setMessages] = useState<Message[]>(() => StorageService.getMessages());
  const [conversations, setConversations] = useState<Conversation[]>(() => StorageService.getConversations());
  const [achievements, setAchievements] = useState<Achievement[]>(() => StorageService.getAchievements());
  const [preferences, setPreferences] = useState<UserPreferences>(() => StorageService.getPreferences());
  const [savedProfileIds, setSavedProfileIds] = useState<string[]>(() => StorageService.getSavedProfileIds());
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  // Payment System States
  const [walletBalance, setWalletBalance] = useState<number>(() => StorageService.getWalletBalance());
  const [subscription, setSubscription] = useState<UserSubscription>(() => StorageService.getSubscription());
  const [transactions, setTransactions] = useState<PaymentTransaction[]>(() => StorageService.getTransactions());
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [checkoutOptions, setCheckoutOptions] = useState<PaymentCheckoutOptions | null>(null);
  const [selectedReceiptTransaction, setSelectedReceiptTransaction] = useState<PaymentTransaction | null>(null);

  // Find active student object
  const currentUser = useMemo(() => {
    if (!currentUserId) return null;
    return students.find(s => s.id === currentUserId) || null;
  }, [students, currentUserId]);

  // Toast Helpers
  const addToast = useCallback((type: 'success' | 'error' | 'info' | 'warning', message: string, title?: string) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newToast: ToastNotification = { id, type, message, title };
    setToasts(prev => [...prev, newToast]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Update achievements dynamically whenever activity state changes
  const checkAchievements = useCallback((
    currentStud: Student,
    connList: ConnectionRequest[],
    exchList: SkillExchange[],
    sessList: LearningSession[],
    revList: Review[]
  ) => {
    setAchievements(prev => {
      const updated = prev.map(ach => {
        let isUnlocked = ach.isUnlocked;
        let progress = ach.progress;
        let unlockedAt = ach.unlockedAt;

        if (ach.id === 'ach_1') {
          // First Connection
          const hasConn = connList.some(c => c.senderId === currentStud.id || c.receiverId === currentStud.id);
          progress = hasConn ? 1 : 0;
          if (progress >= 1 && !isUnlocked) {
            isUnlocked = true;
            unlockedAt = 'Recently';
          }
        } else if (ach.id === 'ach_2') {
          // First Exchange
          const hasExch = exchList.some(e => e.proposerId === currentStud.id || e.partnerId === currentStud.id);
          progress = hasExch ? 1 : 0;
          if (progress >= 1 && !isUnlocked) {
            isUnlocked = true;
            unlockedAt = 'Recently';
          }
        } else if (ach.id === 'ach_3') {
          // 5 Skills Added
          const totalSkills = currentStud.skillsOffered.length + currentStud.skillsWanted.length;
          progress = totalSkills;
          if (progress >= 5 && !isUnlocked) {
            isUnlocked = true;
            unlockedAt = 'Recently';
          }
        } else if (ach.id === 'ach_4') {
          // 5 Sessions completed
          const compSessions = sessList.filter(s => s.status === 'Completed').length;
          progress = compSessions;
          if (progress >= 5 && !isUnlocked) {
            isUnlocked = true;
            unlockedAt = 'Recently';
          }
        } else if (ach.id === 'ach_5') {
          // Positive reviews
          const studentReviews = revList.filter(r => r.targetStudentId === currentStud.id);
          progress = studentReviews.length;
          if (progress >= 5 && !isUnlocked) {
            isUnlocked = true;
            unlockedAt = 'Recently';
          }
        } else if (ach.id === 'ach_6') {
          // Connected with peers from >= 3 colleges
          const acceptedPartners = connList
            .filter(c => (c.senderId === currentStud.id || c.receiverId === currentStud.id) && c.status === 'Accepted')
            .map(c => c.senderId === currentStud.id ? c.receiverId : c.senderId);
          const colleges = new Set(students.filter(s => acceptedPartners.includes(s.id)).map(s => s.college));
          progress = colleges.size;
          if (progress >= 3 && !isUnlocked) {
            isUnlocked = true;
            unlockedAt = 'Recently';
          }
        }

        return { ...ach, progress, isUnlocked, unlockedAt };
      });
      StorageService.setAchievements(updated);
      return updated;
    });
  }, [students]);

  // Sync to storage on state change
  useEffect(() => {
    StorageService.setCurrentUserId(currentUserId);
  }, [currentUserId]);

  useEffect(() => {
    StorageService.setStudents(students);
  }, [students]);

  useEffect(() => {
    StorageService.setExchanges(exchanges);
  }, [exchanges]);

  useEffect(() => {
    StorageService.setConnections(connections);
  }, [connections]);

  useEffect(() => {
    StorageService.setSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    StorageService.setReviews(reviews);
  }, [reviews]);

  useEffect(() => {
    StorageService.setMessages(messages);
  }, [messages]);

  useEffect(() => {
    StorageService.setConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    StorageService.setPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    StorageService.setSavedProfileIds(savedProfileIds);
  }, [savedProfileIds]);

  useEffect(() => {
    StorageService.setWalletBalance(walletBalance);
  }, [walletBalance]);

  useEffect(() => {
    StorageService.setSubscription(subscription);
  }, [subscription]);

  useEffect(() => {
    StorageService.setTransactions(transactions);
  }, [transactions]);

  // Auth Functions
  const login = useCallback((email: string): boolean => {
    const found = students.find(s => s.email.toLowerCase() === email.toLowerCase().trim());
    if (found) {
      setCurrentUserId(found.id);
      addToast('success', `Welcome back, ${found.name}!`, 'Logged in');
      return true;
    }
    // If entered arbitrary demo email, match by first name or fallback to Pranav
    const fallback = students[0];
    setCurrentUserId(fallback.id);
    addToast('info', `Signed in as demo student (${fallback.name})`, 'Demo Access');
    return true;
  }, [students, addToast]);

  const loginAs = useCallback((studentId: string) => {
    const student = students.find(s => s.id === studentId);
    if (student) {
      setCurrentUserId(student.id);
      addToast('success', `Switched active account to ${student.name}`);
    }
  }, [students, addToast]);

  const logout = useCallback(() => {
    setCurrentUserId(null);
    addToast('info', 'You have been signed out successfully.');
  }, [addToast]);

  const register = useCallback((data: {
    name: string;
    email: string;
    college: string;
    department: string;
    yearOfStudy: YearOfStudy;
  }) => {
    const initials = data.name
      .split(' ')
      .map(part => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'ST';

    const newStudent: Student = {
      id: `student_${Date.now()}`,
      name: data.name,
      email: data.email,
      initials,
      college: data.college,
      department: data.department,
      yearOfStudy: data.yearOfStudy,
      bio: `Student at ${data.college} excited to exchange skills and connect with motivated learning partners.`,
      skillsOffered: [],
      skillsWanted: [],
      preferredMethod: 'Flexible',
      availability: ['Weekdays Evenings'],
      languages: ['English'],
      rating: 5.0,
      reviewCount: 0,
      completedExchangesCount: 0,
      joinedDate: 'Just now'
    };

    setStudents(prev => [newStudent, ...prev]);
    setCurrentUserId(newStudent.id);
    addToast('success', `Welcome to SkillBridge, ${data.name}! Your demo account is ready.`);
  }, [addToast]);

  // Skill Management
  const addSkill = useCallback((skillData: Omit<Skill, 'id'>) => {
    if (!currentUser) return;
    const isDuplicate = (skillData.type === 'offered' ? currentUser.skillsOffered : currentUser.skillsWanted)
      .some(s => s.name.toLowerCase().trim() === skillData.name.toLowerCase().trim());

    if (isDuplicate) {
      addToast('warning', `You already have "${skillData.name}" in your ${skillData.type} skills list.`);
      return;
    }

    const newSkill: Skill = {
      ...skillData,
      id: `skill_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`
    };

    const updatedUser: Student = {
      ...currentUser,
      skillsOffered: skillData.type === 'offered' ? [...currentUser.skillsOffered, newSkill] : currentUser.skillsOffered,
      skillsWanted: skillData.type === 'wanted' ? [...currentUser.skillsWanted, newSkill] : currentUser.skillsWanted
    };

    setStudents(prev => prev.map(s => s.id === updatedUser.id ? updatedUser : s));
    addToast('success', `Added "${newSkill.name}" to your ${skillData.type === 'offered' ? 'teaching' : 'learning'} skills.`);
    checkAchievements(updatedUser, connections, exchanges, sessions, reviews);
  }, [currentUser, connections, exchanges, sessions, reviews, addToast, checkAchievements]);

  const editSkill = useCallback((id: string, skillUpdate: Partial<Skill>) => {
    if (!currentUser) return;
    const updateList = (list: Skill[]) => list.map(item => item.id === id ? { ...item, ...skillUpdate } : item);

    const updatedUser: Student = {
      ...currentUser,
      skillsOffered: updateList(currentUser.skillsOffered),
      skillsWanted: updateList(currentUser.skillsWanted)
    };

    setStudents(prev => prev.map(s => s.id === updatedUser.id ? updatedUser : s));
    addToast('success', 'Skill updated successfully.');
  }, [currentUser, addToast]);

  const deleteSkill = useCallback((id: string) => {
    if (!currentUser) return;
    const updatedUser: Student = {
      ...currentUser,
      skillsOffered: currentUser.skillsOffered.filter(s => s.id !== id),
      skillsWanted: currentUser.skillsWanted.filter(s => s.id !== id)
    };

    setStudents(prev => prev.map(s => s.id === updatedUser.id ? updatedUser : s));
    addToast('info', 'Skill removed from your profile.');
    checkAchievements(updatedUser, connections, exchanges, sessions, reviews);
  }, [currentUser, connections, exchanges, sessions, reviews, addToast, checkAchievements]);

  // Connection Management
  const getConnectionWith = useCallback((studentId: string): ConnectionRequest | undefined => {
    if (!currentUser) return undefined;
    return connections.find(c => 
      (c.senderId === currentUser.id && c.receiverId === studentId) ||
      (c.receiverId === currentUser.id && c.senderId === studentId)
    );
  }, [currentUser, connections]);

  const sendConnectionRequest = useCallback((receiverId: string, message?: string): boolean => {
    if (!currentUser) {
      addToast('error', 'Please log in to connect with students.');
      return false;
    }

    const existing = getConnectionWith(receiverId);
    if (existing && existing.status === 'Pending') {
      addToast('warning', 'A pending connection request already exists.');
      return false;
    }
    if (existing && existing.status === 'Accepted') {
      addToast('info', 'You are already connected with this student.');
      return false;
    }

    const newRequest: ConnectionRequest = {
      id: `conn_${Date.now()}`,
      senderId: currentUser.id,
      receiverId,
      status: 'Pending',
      createdAt: new Date().toISOString(),
      message: message || `Hi! I saw your profile and would love to exchange skills.`
    };

    setConnections(prev => [newRequest, ...prev.filter(c => !(
      (c.senderId === currentUser.id && c.receiverId === receiverId) ||
      (c.receiverId === currentUser.id && c.senderId === receiverId)
    ))]);

    addToast('success', 'Connection request sent successfully!');
    checkAchievements(currentUser, [...connections, newRequest], exchanges, sessions, reviews);
    return true;
  }, [currentUser, connections, exchanges, sessions, reviews, getConnectionWith, addToast, checkAchievements]);

  const respondConnectionRequest = useCallback((requestId: string, status: 'Accepted' | 'Declined' | 'Cancelled') => {
    setConnections(prev => prev.map(conn => conn.id === requestId ? { ...conn, status } : conn));
    
    if (status === 'Accepted') {
      addToast('success', 'Connection accepted! You can now exchange skills and message.');
    } else if (status === 'Cancelled') {
      addToast('info', 'Connection request cancelled.');
    } else {
      addToast('info', 'Connection request declined.');
    }

    if (currentUser) {
      checkAchievements(currentUser, connections, exchanges, sessions, reviews);
    }
  }, [currentUser, connections, exchanges, sessions, reviews, addToast, checkAchievements]);

  const removeConnection = useCallback((partnerId: string) => {
    if (!currentUser) return;
    setConnections(prev => prev.filter(c => !(
      (c.senderId === currentUser.id && c.receiverId === partnerId) ||
      (c.receiverId === currentUser.id && c.senderId === partnerId)
    )));
    addToast('info', 'Connection removed.');
  }, [currentUser, addToast]);

  // Skill Exchanges
  const proposeExchange = useCallback((data: {
    partnerId: string;
    teachSkillName: string;
    learnSkillName: string;
    description: string;
    proposedSchedule: string;
  }) => {
    if (!currentUser) return;

    const newExchange: SkillExchange = {
      id: `exchange_${Date.now()}`,
      proposerId: currentUser.id,
      partnerId: data.partnerId,
      teachSkillName: data.teachSkillName,
      learnSkillName: data.learnSkillName,
      description: data.description,
      proposedSchedule: data.proposedSchedule,
      status: 'Pending',
      createdAt: new Date().toISOString()
    };

    setExchanges(prev => [newExchange, ...prev]);
    addToast('success', 'Skill exchange proposal submitted successfully!');
    checkAchievements(currentUser, connections, [newExchange, ...exchanges], sessions, reviews);
  }, [currentUser, connections, exchanges, sessions, reviews, addToast, checkAchievements]);

  const updateExchangeStatus = useCallback((exchangeId: string, status: ExchangeStatus) => {
    setExchanges(prev => prev.map(e => {
      if (e.id === exchangeId) {
        const updated = { ...e, status };
        if (status === 'Active' && !e.startedAt) {
          updated.startedAt = new Date().toISOString();
        }
        if (status === 'Completed' && !e.completedAt) {
          updated.completedAt = new Date().toISOString();
        }
        return updated;
      }
      return e;
    }));

    if (status === 'Active') {
      addToast('success', 'Skill exchange is now Active! You can schedule learning sessions.');
    } else if (status === 'Completed') {
      addToast('success', 'Skill exchange marked as Completed! Don\'t forget to leave a review.');
    } else if (status === 'Cancelled') {
      addToast('info', 'Skill exchange proposal cancelled.');
    } else {
      addToast('info', `Exchange status updated to ${status}.`);
    }

    if (currentUser) {
      checkAchievements(currentUser, connections, exchanges, sessions, reviews);
    }
  }, [currentUser, connections, exchanges, sessions, reviews, addToast, checkAchievements]);

  // Messaging (Simulated Local Persisted)
  const sendMessage = useCallback((receiverId: string, text: string) => {
    if (!currentUser || !text.trim()) return;

    const trimmed = text.trim();
    // Look for existing conversation
    let conv = conversations.find(c => 
      c.participantIds.includes(currentUser.id) && c.participantIds.includes(receiverId)
    );

    const now = new Date().toISOString();
    const convId = conv ? conv.id : `conv_${Date.now()}`;

    const newMsg: Message = {
      id: `msg_${Date.now()}`,
      conversationId: convId,
      senderId: currentUser.id,
      receiverId,
      text: trimmed,
      timestamp: now,
      read: true
    };

    setMessages(prev => [...prev, newMsg]);

    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== convId);
      const updatedConv: Conversation = {
        id: convId,
        participantIds: [currentUser.id, receiverId],
        lastMessage: trimmed,
        lastMessageTime: now,
        unreadCount: 0
      };
      return [updatedConv, ...filtered];
    });

    // Provide friendly simulated auto-reply after 1.5 seconds to make demo interactive!
    setTimeout(() => {
      const partner = students.find(s => s.id === receiverId);
      const partnerFirst = partner ? partner.name.split(' ')[0] : 'Partner';
      const autoReplyText = `Thanks for the message! Looking forward to our next skill exchange session.`;

      const replyMsg: Message = {
        id: `msg_${Date.now() + 1}`,
        conversationId: convId,
        senderId: receiverId,
        receiverId: currentUser.id,
        text: autoReplyText,
        timestamp: new Date().toISOString(),
        read: false
      };

      setMessages(p => [...p, replyMsg]);
      setConversations(p => {
        const remaining = p.filter(c => c.id !== convId);
        const updated: Conversation = {
          id: convId,
          participantIds: [currentUser.id, receiverId],
          lastMessage: autoReplyText,
          lastMessageTime: new Date().toISOString(),
          unreadCount: 1
        };
        return [updated, ...remaining];
      });

      addToast('info', `Simulated reply from ${partnerFirst}: "${autoReplyText}"`, 'Demo Message Received');
    }, 1800);
  }, [currentUser, conversations, students, addToast]);

  const markConversationRead = useCallback((conversationId: string) => {
    setConversations(prev => prev.map(c => c.id === conversationId ? { ...c, unreadCount: 0 } : c));
    setMessages(prev => prev.map(m => m.conversationId === conversationId ? { ...m, read: true } : m));
  }, []);

  // Learning Sessions
  const scheduleSession = useCallback((data: {
    exchangeId?: string;
    partnerId: string;
    skillName: string;
    date: string;
    startTime: string;
    durationMinutes: number;
    learningMethod: LearningMethod;
    notes?: string;
  }) => {
    const newSession: LearningSession = {
      id: `session_${Date.now()}`,
      exchangeId: data.exchangeId,
      partnerId: data.partnerId,
      skillName: data.skillName,
      date: data.date,
      startTime: data.startTime,
      durationMinutes: data.durationMinutes,
      learningMethod: data.learningMethod,
      notes: data.notes,
      status: 'Upcoming',
      createdAt: new Date().toISOString()
    };

    setSessions(prev => [newSession, ...prev]);
    addToast('success', `Learning session scheduled for ${data.date} at ${data.startTime}.`);
    if (currentUser) {
      checkAchievements(currentUser, connections, exchanges, [newSession, ...sessions], reviews);
    }
  }, [currentUser, connections, exchanges, sessions, reviews, addToast, checkAchievements]);

  const editSession = useCallback((sessionId: string, data: Partial<LearningSession>) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, ...data } : s));
    addToast('success', 'Learning session updated.');
  }, [addToast]);

  const updateSessionStatus = useCallback((sessionId: string, status: SessionStatus) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status } : s));
    if (status === 'Completed') {
      addToast('success', 'Great job! Learning session marked as completed.');
    } else {
      addToast('info', `Session status changed to ${status}.`);
    }

    if (currentUser) {
      checkAchievements(currentUser, connections, exchanges, sessions, reviews);
    }
  }, [currentUser, connections, exchanges, sessions, reviews, addToast, checkAchievements]);

  // Reviews
  const submitReview = useCallback((exchangeId: string, targetStudentId: string, rating: number, comment: string, skillName: string): boolean => {
    if (!currentUser) return false;

    // Check if review already exists for this exchange from this author
    const alreadyReviewed = reviews.some(r => r.exchangeId === exchangeId && r.authorId === currentUser.id);
    if (alreadyReviewed) {
      addToast('warning', 'You have already submitted a review for this skill exchange.');
      return false;
    }

    const newReview: Review = {
      id: `review_${Date.now()}`,
      exchangeId,
      authorId: currentUser.id,
      targetStudentId,
      rating,
      comment,
      createdAt: new Date().toISOString(),
      skillName
    };

    setReviews(prev => [newReview, ...prev]);

    // Update target student's rating count and average rating
    setStudents(prev => prev.map(student => {
      if (student.id === targetStudentId) {
        const studentRevs = [...reviews.filter(r => r.targetStudentId === targetStudentId), newReview];
        const avg = studentRevs.reduce((acc, r) => acc + r.rating, 0) / studentRevs.length;
        return {
          ...student,
          reviewCount: studentRevs.length,
          rating: Number(avg.toFixed(1))
        };
      }
      return student;
    }));

    addToast('success', 'Review posted! Thank you for supporting peer education.');
    checkAchievements(currentUser, connections, exchanges, sessions, [newReview, ...reviews]);
    return true;
  }, [currentUser, reviews, connections, exchanges, sessions, addToast, checkAchievements]);

  // Profile Saved & Report
  const toggleSaveProfile = useCallback((studentId: string) => {
    setSavedProfileIds(prev => {
      const exists = prev.includes(studentId);
      if (exists) {
        addToast('info', 'Profile removed from saved bookmarks.');
        return prev.filter(id => id !== studentId);
      } else {
        addToast('success', 'Profile bookmarked successfully.');
        return [...prev, studentId];
      }
    });
  }, [addToast]);

  const reportProfile = useCallback((targetStudentId: string, reason: string, details: string) => {
    if (!currentUser) return;
    StorageService.addReport({
      id: `report_${Date.now()}`,
      reporterId: currentUser.id,
      targetStudentId,
      reason,
      details,
      createdAt: new Date().toISOString()
    });
    addToast('info', 'Feedback recorded locally. (Demo simulation: moderation report logged)');
  }, [currentUser, addToast]);

  const updateProfile = useCallback((data: Partial<Student>) => {
    if (!currentUser) return;
    const updated: Student = { ...currentUser, ...data };
    setStudents(prev => prev.map(s => s.id === currentUser.id ? updated : s));
    addToast('success', 'Your student profile has been updated.');
  }, [currentUser, addToast]);

  const updatePreferences = useCallback((newPrefs: UserPreferences) => {
    setPreferences(newPrefs);
    addToast('success', 'Learning preferences saved.');
  }, [addToast]);

  // Payment System Handlers
  const openCheckout = useCallback((options: PaymentCheckoutOptions) => {
    setCheckoutOptions(options);
    setCheckoutModalOpen(true);
  }, []);

  const closeCheckout = useCallback(() => {
    setCheckoutModalOpen(false);
    setCheckoutOptions(null);
  }, []);

  const openReceiptModal = useCallback((transaction: PaymentTransaction) => {
    setSelectedReceiptTransaction(transaction);
  }, []);

  const closeReceiptModal = useCallback(() => {
    setSelectedReceiptTransaction(null);
  }, []);

  const processPayment = useCallback(async (details: {
    method: PaymentMethodType;
    paymentDetails: PaymentDetails;
    simulateFailure?: boolean;
    failureReason?: string;
  }): Promise<{ success: boolean; transaction?: PaymentTransaction; error?: string }> => {
    if (!currentUser || !checkoutOptions) {
      return { success: false, error: 'User or checkout options missing.' };
    }

    if (details.simulateFailure) {
      const errorMsg = details.failureReason || 'Transaction declined by issuing gateway. (Demo Simulation)';
      const failedTxn: PaymentTransaction = {
        id: `TXN-${Math.floor(100000 + Math.random() * 900000)}`,
        invoiceNumber: `INV-2026-${Math.floor(100 + Math.random() * 900)}`,
        userId: currentUser.id,
        amount: checkoutOptions.amount,
        currency: '$',
        status: 'failed',
        purpose: checkoutOptions.purpose,
        title: checkoutOptions.title,
        description: `Failed attempt: ${errorMsg}`,
        paymentMethod: details.method,
        paymentDetails: details.paymentDetails,
        createdAt: new Date().toISOString(),
        recipientName: checkoutOptions.recipientName,
        recipientId: checkoutOptions.recipientId
      };
      setTransactions(prev => [failedTxn, ...prev]);
      addToast('error', errorMsg, 'Payment Failed');
      return { success: false, error: errorMsg, transaction: failedTxn };
    }

    // Check wallet balance if payment method is wallet
    if (details.method === 'wallet' && checkoutOptions.purpose !== 'wallet_topup') {
      if (walletBalance < checkoutOptions.amount) {
        const errorMsg = `Insufficient wallet balance ($${walletBalance.toFixed(2)} available, $${checkoutOptions.amount.toFixed(2)} needed).`;
        addToast('error', errorMsg, 'Payment Declined');
        return { success: false, error: errorMsg };
      }
    }

    const newTxn: PaymentTransaction = {
      id: `TXN-${Math.floor(100000 + Math.random() * 900000)}`,
      invoiceNumber: `INV-2026-${Math.floor(100 + Math.random() * 900)}`,
      userId: currentUser.id,
      amount: checkoutOptions.amount,
      currency: '$',
      status: 'completed',
      purpose: checkoutOptions.purpose,
      title: checkoutOptions.title,
      description: checkoutOptions.description || `${checkoutOptions.title} via ${details.method.toUpperCase()}`,
      paymentMethod: details.method,
      paymentDetails: details.paymentDetails,
      createdAt: new Date().toISOString(),
      recipientName: checkoutOptions.recipientName,
      recipientId: checkoutOptions.recipientId
    };

    // Update Wallet Balance
    if (checkoutOptions.purpose === 'wallet_topup') {
      setWalletBalance(prev => prev + checkoutOptions.amount);
      addToast('success', `Added $${checkoutOptions.amount.toFixed(2)} credits to your SkillBridge wallet!`, 'Top-Up Successful');
    } else if (details.method === 'wallet') {
      setWalletBalance(prev => Math.max(0, prev - checkoutOptions.amount));
    }

    // Update Pro Subscription
    if (checkoutOptions.purpose === 'pro_subscription') {
      const plan = checkoutOptions.targetPlan || 'pro_monthly';
      const expireDate = new Date();
      if (plan === 'pro_semester') {
        expireDate.setMonth(expireDate.getMonth() + 6);
      } else {
        expireDate.setMonth(expireDate.getMonth() + 1);
      }
      setSubscription({
        plan,
        status: 'active',
        expiresAt: expireDate.toISOString(),
        autoRenew: true
      });
      addToast('success', `🎉 Upgraded to ${plan === 'pro_semester' ? 'SkillBridge Pro Semester Pass' : 'SkillBridge Pro Monthly'}!`, 'Pro Activated');
    }

    if (checkoutOptions.purpose === 'mentor_tip') {
      addToast('success', `Appreciation tip of $${checkoutOptions.amount.toFixed(2)} sent to ${checkoutOptions.recipientName || 'Mentor'}!`, 'Tip Delivered');
    }

    if (checkoutOptions.purpose === 'session_booking') {
      addToast('success', `Paid 1-on-1 session confirmed with ${checkoutOptions.recipientName || 'Mentor'}!`, 'Booking Confirmed');
    }

    setTransactions(prev => [newTxn, ...prev]);

    if (checkoutOptions.onSuccess) {
      checkoutOptions.onSuccess(newTxn);
    }

    return { success: true, transaction: newTxn };
  }, [currentUser, checkoutOptions, walletBalance, addToast]);

  const refundTransaction = useCallback((transactionId: string) => {
    setTransactions(prev => prev.map(t => {
      if (t.id === transactionId && t.status === 'completed') {
        // Adjust balance if applicable
        if (t.purpose === 'wallet_topup') {
          setWalletBalance(b => Math.max(0, b - t.amount));
        } else if (t.paymentMethod === 'wallet') {
          setWalletBalance(b => b + t.amount);
        }
        return { ...t, status: 'refunded' as const };
      }
      return t;
    }));
    addToast('info', `Transaction ${transactionId} refunded successfully.`, 'Refund Processed');
  }, [addToast]);

  const topUpWallet = useCallback((amount: number) => {
    openCheckout({
      amount,
      title: 'Wallet Credit Top-Up',
      purpose: 'wallet_topup',
      description: `Recharge your SkillBridge wallet with $${amount.toFixed(2)} credits.`
    });
  }, [openCheckout]);

  const subscribeToPro = useCallback((plan: 'pro_monthly' | 'pro_semester' = 'pro_monthly') => {
    const amount = plan === 'pro_semester' ? 29.99 : 9.99;
    const title = plan === 'pro_semester' ? 'SkillBridge Pro Semester Pass' : 'SkillBridge Pro Monthly Membership';
    openCheckout({
      amount,
      title,
      purpose: 'pro_subscription',
      targetPlan: plan,
      description: 'Unlock 3x matching boost, unlimited sessions, mentor badge, and AI session transcription.'
    });
  }, [openCheckout]);

  const cancelSubscription = useCallback(() => {
    setSubscription({
      plan: 'free',
      status: 'inactive'
    });
    addToast('info', 'Your Pro subscription has been cancelled. You are now on the Free student tier.', 'Subscription Updated');
  }, [addToast]);

  const sendTip = useCallback((recipient: Student, amount: number, note?: string) => {
    openCheckout({
      amount,
      title: `Appreciation Tip to ${recipient.name}`,
      purpose: 'mentor_tip',
      recipientName: recipient.name,
      recipientId: recipient.id,
      description: note ? `Note: "${note}"` : `Recognition tip for peer mentoring and guidance.`
    });
  }, [openCheckout]);

  const bookPaidSession = useCallback((data: {
    partner: Student;
    skillName: string;
    amount: number;
    date: string;
    startTime: string;
    durationMinutes: number;
    learningMethod: LearningMethod;
    notes?: string;
  }) => {
    openCheckout({
      amount: data.amount,
      title: `1-on-1 Mentorship: ${data.skillName}`,
      purpose: 'session_booking',
      recipientName: data.partner.name,
      recipientId: data.partner.id,
      description: `Scheduled for ${data.date} at ${data.startTime} (${data.durationMinutes} min, ${data.learningMethod})`,
      onSuccess: () => {
        scheduleSession({
          partnerId: data.partner.id,
          skillName: data.skillName,
          date: data.date,
          startTime: data.startTime,
          durationMinutes: data.durationMinutes,
          learningMethod: data.learningMethod,
          notes: data.notes ? `[Paid Mentorship: $${data.amount}] ${data.notes}` : `[Paid Mentorship: $${data.amount}]`
        });
      }
    });
  }, [openCheckout, scheduleSession]);

  const resetDemoData = useCallback(() => {
    StorageService.resetFactoryDefaults();
    setStudents(StorageService.getStudents());
    setCurrentUserId(INITIAL_CURRENT_USER.id);
    setExchanges(StorageService.getExchanges());
    setConnections(StorageService.getConnections());
    setSessions(StorageService.getSessions());
    setReviews(StorageService.getReviews());
    setMessages(StorageService.getMessages());
    setConversations(StorageService.getConversations());
    setAchievements(StorageService.getAchievements());
    setPreferences(StorageService.getPreferences());
    setSavedProfileIds([]);
    setWalletBalance(INITIAL_WALLET_BALANCE);
    setSubscription(INITIAL_SUBSCRIPTION);
    setTransactions(INITIAL_TRANSACTIONS);
    addToast('info', 'Demo data & wallet balances have been restored to factory state.');
  }, [addToast]);

  const deleteDemoAccount = useCallback(() => {
    if (!currentUser) return;
    setStudents(prev => prev.filter(s => s.id !== currentUser.id));
    setCurrentUserId(null);
    addToast('info', 'Demo account profile was removed from local session.');
  }, [currentUser, addToast]);

  return (
    <AppContext.Provider
      value={{
        currentUser,
        students,
        exchanges,
        connections,
        sessions,
        reviews,
        messages,
        conversations,
        achievements,
        preferences,
        savedProfileIds,
        toasts,
        walletBalance,
        subscription,
        transactions,
        checkoutModalOpen,
        checkoutOptions,
        selectedReceiptTransaction,
        openCheckout,
        closeCheckout,
        processPayment,
        openReceiptModal,
        closeReceiptModal,
        refundTransaction,
        subscribeToPro,
        cancelSubscription,
        topUpWallet,
        sendTip,
        bookPaidSession,
        addToast,
        removeToast,
        login,
        loginAs,
        logout,
        register,
        addSkill,
        editSkill,
        deleteSkill,
        sendConnectionRequest,
        respondConnectionRequest,
        removeConnection,
        getConnectionWith,
        proposeExchange,
        updateExchangeStatus,
        sendMessage,
        markConversationRead,
        scheduleSession,
        editSession,
        updateSessionStatus,
        submitReview,
        toggleSaveProfile,
        reportProfile,
        updateProfile,
        updatePreferences,
        resetDemoData,
        deleteDemoAccount
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

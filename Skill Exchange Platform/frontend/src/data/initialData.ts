import { 
  Student, 
  SkillExchange, 
  ConnectionRequest, 
  LearningSession, 
  Review, 
  Message, 
  Conversation, 
  Achievement,
  PaymentTransaction,
  UserSubscription
} from '../types';

export const INITIAL_CURRENT_USER: Student = {
  id: 'student_pranav',
  name: 'Pranav Patel',
  email: 'pranav.patel@stanford.edu',
  initials: 'PP',
  college: 'Stanford University',
  department: 'Computer Science',
  yearOfStudy: 'Third Year',
  bio: 'Junior studying CS with focus on systems and backend architectures. Passionate about algorithms and database optimization. Looking to branch out into modern frontend frameworks and UI/UX design.',
  skillsOffered: [
    {
      id: 'skill_p_off_1',
      name: 'Java & Spring Boot',
      category: 'Programming',
      proficiency: 'Advanced',
      type: 'offered',
      description: 'Object-oriented programming, Spring Boot REST APIs, microservices, and multithreading.'
    },
    {
      id: 'skill_p_off_2',
      name: 'PostgreSQL & Database Design',
      category: 'Database Management',
      proficiency: 'Intermediate',
      type: 'offered',
      description: 'Relational schema modeling, index optimization, complex SQL queries, and transaction management.'
    },
    {
      id: 'skill_p_off_3',
      name: 'Data Structures & Algorithms',
      category: 'Computer Science',
      proficiency: 'Advanced',
      type: 'offered',
      description: 'Trees, graphs, dynamic programming, and algorithmic problem-solving for technical interviews.'
    }
  ],
  skillsWanted: [
    {
      id: 'skill_p_wan_1',
      name: 'React & Frontend State',
      category: 'Web Development',
      proficiency: 'Beginner',
      type: 'wanted',
      priority: 'High',
      description: 'Looking to master modern React 19, hooks, component architecture, and client state management.'
    },
    {
      id: 'skill_p_wan_2',
      name: 'UI/UX Design in Figma',
      category: 'UI/UX Design',
      proficiency: 'Beginner',
      type: 'wanted',
      priority: 'High',
      description: 'Eager to learn design thinking, wireframing, color theory, and prototyping responsive web apps in Figma.'
    },
    {
      id: 'skill_p_wan_3',
      name: 'Docker & Containerization',
      category: 'Computer Science',
      proficiency: 'Intermediate',
      type: 'wanted',
      priority: 'Medium',
      description: 'Containerizing multi-service backends and configuring CI/CD deployment pipelines.'
    }
  ],
  preferredMethod: 'Flexible',
  availability: ['Weekdays Evenings', 'Saturday Mornings'],
  languages: ['English', 'Hindi', 'Gujarati'],
  rating: 4.9,
  reviewCount: 7,
  completedExchangesCount: 3,
  joinedDate: 'September 2024'
};

export const INITIAL_STUDENTS: Student[] = [
  INITIAL_CURRENT_USER,
  {
    id: 'student_aisha',
    name: 'Aisha Sharma',
    email: 'aisha.sharma@berkeley.edu',
    initials: 'AS',
    college: 'UC Berkeley',
    department: 'Electrical Engineering & Computer Sciences',
    yearOfStudy: 'Third Year',
    bio: 'Frontend enthusiast and open-source contributor. Built production React web applications and love teaching modern TypeScript and UI architecture.',
    skillsOffered: [
      {
        id: 'skill_as_off_1',
        name: 'React & Frontend State',
        category: 'Web Development',
        proficiency: 'Advanced',
        type: 'offered',
        description: 'React components, custom hooks, Tailwind styling, and performance tuning.'
      },
      {
        id: 'skill_as_off_2',
        name: 'TypeScript Essentials',
        category: 'Web Development',
        proficiency: 'Intermediate',
        type: 'offered',
        description: 'Generics, union types, strict typing, and full-stack type safety.'
      }
    ],
    skillsWanted: [
      {
        id: 'skill_as_wan_1',
        name: 'Java & Spring Boot',
        category: 'Programming',
        proficiency: 'Intermediate',
        type: 'wanted',
        priority: 'High',
        description: 'Need assistance building Spring Boot backends for class term project.'
      },
      {
        id: 'skill_as_wan_2',
        name: 'PostgreSQL & Database Design',
        category: 'Database Management',
        proficiency: 'Beginner',
        type: 'wanted',
        priority: 'Medium',
        description: 'Want to learn SQL query writing and database indexing.'
      }
    ],
    preferredMethod: 'Online',
    availability: ['Weekdays Evenings', 'Sunday Afternoons'],
    languages: ['English', 'Hindi'],
    rating: 5.0,
    reviewCount: 9,
    completedExchangesCount: 4,
    joinedDate: 'August 2024'
  },
  {
    id: 'student_marcus',
    name: 'Marcus Vance',
    email: 'm.vance@uw.edu',
    initials: 'MV',
    college: 'University of Washington',
    department: 'Human-Centered Design & Engineering',
    yearOfStudy: 'Fourth Year',
    bio: 'Design lead at student design collective. Passionate about typography, intuitive user journeys, accessibility standards, and design systems.',
    skillsOffered: [
      {
        id: 'skill_mv_off_1',
        name: 'UI/UX Design in Figma',
        category: 'UI/UX Design',
        proficiency: 'Advanced',
        type: 'offered',
        description: 'Figma auto-layout, design tokens, component libraries, and interactive prototyping.'
      },
      {
        id: 'skill_mv_off_2',
        name: 'User Research & Usability Testing',
        category: 'UI/UX Design',
        proficiency: 'Intermediate',
        type: 'offered',
        description: 'Conducting user interviews, creating journey maps, and heuristic evaluations.'
      }
    ],
    skillsWanted: [
      {
        id: 'skill_mv_wan_1',
        name: 'Web Development Basics',
        category: 'Web Development',
        proficiency: 'Beginner',
        type: 'wanted',
        priority: 'High',
        description: 'Looking to turn my Figma mockups into real interactive web pages.'
      },
      {
        id: 'skill_mv_wan_2',
        name: 'Data Structures & Algorithms',
        category: 'Computer Science',
        proficiency: 'Beginner',
        type: 'wanted',
        priority: 'Medium',
        description: 'Preparing for technical product management technical rounds.'
      }
    ],
    preferredMethod: 'Online',
    availability: ['Tuesday & Thursday Evenings', 'Weekends'],
    languages: ['English'],
    rating: 4.8,
    reviewCount: 6,
    completedExchangesCount: 2,
    joinedDate: 'October 2024'
  },
  {
    id: 'student_elena',
    name: 'Elena Rostova',
    email: 'erostova@gatech.edu',
    initials: 'ER',
    college: 'Georgia Tech',
    department: 'Data Science & Machine Learning',
    yearOfStudy: 'Second Year',
    bio: 'Data science sophomore working on statistical learning, predictive models, and exploratory analysis with Python libraries.',
    skillsOffered: [
      {
        id: 'skill_er_off_1',
        name: 'Python for Data Analysis',
        category: 'Data Science',
        proficiency: 'Advanced',
        type: 'offered',
        description: 'Data wrangling with Pandas, NumPy calculations, and matplotlib visualizations.'
      },
      {
        id: 'skill_er_off_2',
        name: 'Machine Learning Fundamentals',
        category: 'Data Science',
        proficiency: 'Intermediate',
        type: 'offered',
        description: 'Supervised learning, classification, scikit-learn, and model validation.'
      }
    ],
    skillsWanted: [
      {
        id: 'skill_er_wan_1',
        name: 'PostgreSQL & Database Design',
        category: 'Database Management',
        proficiency: 'Intermediate',
        type: 'wanted',
        priority: 'High',
        description: 'Need to write complex analytical SQL queries and database migrations.'
      },
      {
        id: 'skill_er_wan_2',
        name: 'Docker & Containerization',
        category: 'Computer Science',
        proficiency: 'Beginner',
        type: 'wanted',
        priority: 'Medium',
        description: 'Deploying machine learning models in lightweight docker containers.'
      }
    ],
    preferredMethod: 'Flexible',
    availability: ['Monday & Wednesday Afternoons', 'Saturdays'],
    languages: ['English', 'Russian'],
    rating: 4.9,
    reviewCount: 5,
    completedExchangesCount: 3,
    joinedDate: 'November 2024'
  },
  {
    id: 'student_david',
    name: 'David Kim',
    email: 'david.kim@utexas.edu',
    initials: 'DK',
    college: 'UT Austin',
    department: 'Electrical & Computer Engineering',
    yearOfStudy: 'Third Year',
    bio: 'DevOps enthusiast and cloud tinkerer. I spend my weekends optimizing Linux builds, container orchestration, and automating deployments.',
    skillsOffered: [
      {
        id: 'skill_dk_off_1',
        name: 'Docker & Containerization',
        category: 'Computer Science',
        proficiency: 'Advanced',
        type: 'offered',
        description: 'Dockerfile multi-stage builds, Docker Compose, network configurations, and volume caching.'
      },
      {
        id: 'skill_dk_off_2',
        name: 'Linux System Administration',
        category: 'Computer Science',
        proficiency: 'Intermediate',
        type: 'offered',
        description: 'Bash scripting, permissions, process monitoring, and networking.'
      }
    ],
    skillsWanted: [
      {
        id: 'skill_dk_wan_1',
        name: 'Java & Spring Boot',
        category: 'Programming',
        proficiency: 'Intermediate',
        type: 'wanted',
        priority: 'High',
        description: 'Want to understand modern enterprise Java microservices backend.'
      },
      {
        id: 'skill_dk_wan_2',
        name: 'React & Frontend State',
        category: 'Web Development',
        proficiency: 'Beginner',
        type: 'wanted',
        priority: 'Low',
        description: 'Basics of React to build admin dashboards for my cloud tools.'
      }
    ],
    preferredMethod: 'Online',
    availability: ['Weekdays Evenings', 'Sunday Mornings'],
    languages: ['English', 'Korean'],
    rating: 4.7,
    reviewCount: 8,
    completedExchangesCount: 5,
    joinedDate: 'July 2024'
  },
  {
    id: 'student_sophia',
    name: 'Sophia Chen',
    email: 'schen@mit.edu',
    initials: 'SC',
    college: 'MIT',
    department: 'Comparative Media & Communications',
    yearOfStudy: 'Fourth Year',
    bio: 'Senior passionate about interpersonal communication, technical presentations, and pitch storytelling for student startup teams.',
    skillsOffered: [
      {
        id: 'skill_sc_off_1',
        name: 'Public Speaking & Presentations',
        category: 'Communication',
        proficiency: 'Advanced',
        type: 'offered',
        description: 'Slide design storytelling, vocal projection, body language, and Q&A management.'
      },
      {
        id: 'skill_sc_off_2',
        name: 'Resume & Technical Interview Prep',
        category: 'Career Development',
        proficiency: 'Advanced',
        type: 'offered',
        description: 'Action-oriented bullet points, STAR method interview coaching, and behavioral preparation.'
      }
    ],
    skillsWanted: [
      {
        id: 'skill_sc_wan_1',
        name: 'Python for Data Analysis',
        category: 'Data Science',
        proficiency: 'Beginner',
        type: 'wanted',
        priority: 'High',
        description: 'Want to analyze survey responses and media datasets with simple Python scripts.'
      }
    ],
    preferredMethod: 'Flexible',
    availability: ['Fridays', 'Weekends'],
    languages: ['English', 'Mandarin'],
    rating: 5.0,
    reviewCount: 11,
    completedExchangesCount: 6,
    joinedDate: 'September 2024'
  },
  {
    id: 'student_liam',
    name: 'Liam O’Connor',
    email: 'loconnor@umich.edu',
    initials: 'LO',
    college: 'University of Michigan',
    department: 'Computer Science & Engineering',
    yearOfStudy: 'Second Year',
    bio: 'Mobile and game developer. Love building native iOS apps with Swift and cross-platform apps with Flutter.',
    skillsOffered: [
      {
        id: 'skill_lo_off_1',
        name: 'iOS App Development with Swift',
        category: 'Programming',
        proficiency: 'Intermediate',
        type: 'offered',
        description: 'SwiftUI layouts, state management, core animations, and App Store submission.'
      },
      {
        id: 'skill_lo_off_2',
        name: 'Git & Collaborative Version Control',
        category: 'Computer Science',
        proficiency: 'Advanced',
        type: 'offered',
        description: 'Interactive rebase, merge conflict resolution, branch protection strategies.'
      }
    ],
    skillsWanted: [
      {
        id: 'skill_lo_wan_1',
        name: 'UI/UX Design in Figma',
        category: 'UI/UX Design',
        proficiency: 'Beginner',
        type: 'wanted',
        priority: 'High',
        description: 'Want to design beautiful, user-tested iOS app icons and mockups.'
      }
    ],
    preferredMethod: 'In-person',
    availability: ['Weekdays Afternoons'],
    languages: ['English'],
    rating: 4.6,
    reviewCount: 4,
    completedExchangesCount: 2,
    joinedDate: 'January 2025'
  },
  {
    id: 'student_fatima',
    name: 'Fatima Al-Zahra',
    email: 'fatima.az@columbia.edu',
    initials: 'FA',
    college: 'Columbia University',
    department: 'Information Science & Data Analytics',
    yearOfStudy: 'Third Year',
    bio: 'Specializing in business intelligence and data warehousing. Love helping people discover stories hidden in relational tables.',
    skillsOffered: [
      {
        id: 'skill_fa_off_1',
        name: 'Business Intelligence & Tableau',
        category: 'Data Science',
        proficiency: 'Advanced',
        type: 'offered',
        description: 'Dashboard design, calculated fields, parameter actions, and data blending.'
      },
      {
        id: 'skill_fa_off_2',
        name: 'SQL Query Optimization',
        category: 'Database Management',
        proficiency: 'Intermediate',
        type: 'offered',
        description: 'Query execution plans, window functions, and partitioning.'
      }
    ],
    skillsWanted: [
      {
        id: 'skill_fa_wan_1',
        name: 'Public Speaking & Presentations',
        category: 'Communication',
        proficiency: 'Intermediate',
        type: 'wanted',
        priority: 'High',
        description: 'Improve my executive pitch and presentation presence.'
      }
    ],
    preferredMethod: 'Online',
    availability: ['Weekdays Evenings', 'Saturday Afternoons'],
    languages: ['English', 'Arabic', 'French'],
    rating: 4.9,
    reviewCount: 7,
    completedExchangesCount: 4,
    joinedDate: 'October 2024'
  },
  {
    id: 'student_carlos',
    name: 'Carlos Mendez',
    email: 'cmendez@illinois.edu',
    initials: 'CM',
    college: 'University of Illinois Urbana-Champaign',
    department: 'Computer Science',
    yearOfStudy: 'Third Year',
    bio: 'Competitive programmer and problem solver. Love breaking down tricky graph algorithms and dynamic programming challenges.',
    skillsOffered: [
      {
        id: 'skill_cm_off_1',
        name: 'Competitive Programming in C++',
        category: 'Programming',
        proficiency: 'Advanced',
        type: 'offered',
        description: 'STL algorithms, graph traversal, segment trees, and time complexity analysis.'
      }
    ],
    skillsWanted: [
      {
        id: 'skill_cm_wan_1',
        name: 'Resume & Technical Interview Prep',
        category: 'Career Development',
        proficiency: 'Intermediate',
        type: 'wanted',
        priority: 'High',
        description: 'Refining behavioral answers and resume bullets for summer internships.'
      }
    ],
    preferredMethod: 'Online',
    availability: ['Saturday & Sunday Mornings'],
    languages: ['English', 'Spanish'],
    rating: 4.8,
    reviewCount: 5,
    completedExchangesCount: 3,
    joinedDate: 'December 2024'
  },
  {
    id: 'student_ananya',
    name: 'Ananya Gupta',
    email: 'agupta@cmu.edu',
    initials: 'AG',
    college: 'Carnegie Mellon University',
    department: 'Software Engineering',
    yearOfStudy: 'Fourth Year',
    bio: 'Full-stack software engineer with an eye for accessible, fast websites. Love pairing with junior students.',
    skillsOffered: [
      {
        id: 'skill_ag_off_1',
        name: 'Next.js & Fullstack Web',
        category: 'Web Development',
        proficiency: 'Advanced',
        type: 'offered',
        description: 'Server components, API route handlers, routing architecture, and accessibility.'
      },
      {
        id: 'skill_ag_off_2',
        name: 'Tailwind CSS & Modern Layouts',
        category: 'Web Development',
        proficiency: 'Advanced',
        type: 'offered',
        description: 'CSS Grid, Flexbox, responsive design, dark mode, and component abstraction.'
      }
    ],
    skillsWanted: [
      {
        id: 'skill_ag_wan_1',
        name: 'PostgreSQL & Database Design',
        category: 'Database Management',
        proficiency: 'Intermediate',
        type: 'wanted',
        priority: 'High',
        description: 'Deep dive into Postgres query plans, triggers, and relational schemas.'
      }
    ],
    preferredMethod: 'Flexible',
    availability: ['Weekdays Evenings'],
    languages: ['English', 'Hindi'],
    rating: 5.0,
    reviewCount: 14,
    completedExchangesCount: 7,
    joinedDate: 'June 2024'
  }
];

export const INITIAL_EXCHANGES: SkillExchange[] = [
  {
    id: 'exchange_1',
    proposerId: 'student_pranav',
    partnerId: 'student_aisha',
    teachSkillName: 'Java & Spring Boot',
    learnSkillName: 'React & Frontend State',
    description: 'Weekly 1-hour swap: Pranav helps Aisha build Spring Boot APIs, Aisha mentors Pranav in modern React state patterns.',
    proposedSchedule: 'Tuesdays at 6:00 PM PST',
    status: 'Active',
    createdAt: '2026-03-01T10:00:00.000Z',
    startedAt: '2026-03-05T18:00:00.000Z'
  },
  {
    id: 'exchange_2',
    proposerId: 'student_marcus',
    partnerId: 'student_pranav',
    teachSkillName: 'UI/UX Design in Figma',
    learnSkillName: 'Data Structures & Algorithms',
    description: 'Marcus teaches Pranav Figma wireframing and design systems; Pranav helps Marcus with graph algorithm prep.',
    proposedSchedule: 'Thursdays at 5:30 PM PST',
    status: 'Pending',
    createdAt: '2026-03-12T14:30:00.000Z'
  },
  {
    id: 'exchange_3',
    proposerId: 'student_pranav',
    partnerId: 'student_david',
    teachSkillName: 'Java & Spring Boot',
    learnSkillName: 'Docker & Containerization',
    description: 'Completed 4-session exchange covering Docker containers, multi-stage images, and Spring backend setup.',
    proposedSchedule: 'Sundays at 11:00 AM PST',
    status: 'Completed',
    createdAt: '2026-01-10T09:00:00.000Z',
    startedAt: '2026-01-15T11:00:00.000Z',
    completedAt: '2026-02-20T12:00:00.000Z'
  }
];

export const INITIAL_CONNECTIONS: ConnectionRequest[] = [
  {
    id: 'conn_1',
    senderId: 'student_pranav',
    receiverId: 'student_aisha',
    status: 'Accepted',
    createdAt: '2026-02-28T09:15:00.000Z',
    message: 'Hey Aisha! Would love to exchange React knowledge for Java & Spring Boot backend skills.'
  },
  {
    id: 'conn_2',
    senderId: 'student_marcus',
    receiverId: 'student_pranav',
    status: 'Accepted',
    createdAt: '2026-03-10T11:20:00.000Z',
    message: 'Hi Pranav, saw your profile. I can teach you Figma prototyping if you can help me with algorithm concepts!'
  },
  {
    id: 'conn_3',
    senderId: 'student_david',
    receiverId: 'student_pranav',
    status: 'Accepted',
    createdAt: '2026-01-08T14:00:00.000Z',
    message: 'Hey Pranav, excited to trade Docker and Linux tips for Spring backend fundamentals.'
  },
  {
    id: 'conn_4',
    senderId: 'student_elena',
    receiverId: 'student_pranav',
    status: 'Pending',
    createdAt: '2026-03-18T16:45:00.000Z',
    message: 'Hi Pranav! I noticed your Postgres skills. I can teach Python for Data Science in return for database design guidance.'
  },
  {
    id: 'conn_5',
    senderId: 'student_pranav',
    receiverId: 'student_ananya',
    status: 'Pending',
    createdAt: '2026-03-20T10:00:00.000Z',
    message: 'Hello Ananya! Interested in learning Tailwind CSS architectural patterns from you.'
  }
];

export const INITIAL_SESSIONS: LearningSession[] = [
  {
    id: 'session_1',
    exchangeId: 'exchange_1',
    partnerId: 'student_aisha',
    skillName: 'React & Frontend State',
    date: '2026-04-14',
    startTime: '18:00',
    durationMinutes: 60,
    learningMethod: 'Online',
    notes: 'Cover React 19 useActionState, useEffect pitfalls, and custom hook encapsulation.',
    status: 'Upcoming',
    createdAt: '2026-03-15T12:00:00.000Z'
  },
  {
    id: 'session_2',
    exchangeId: 'exchange_1',
    partnerId: 'student_aisha',
    skillName: 'Java & Spring Boot',
    date: '2026-04-21',
    startTime: '18:00',
    durationMinutes: 60,
    learningMethod: 'Online',
    notes: 'Walkthrough Spring Data JPA repositories and custom query methods.',
    status: 'Upcoming',
    createdAt: '2026-03-15T12:10:00.000Z'
  },
  {
    id: 'session_3',
    exchangeId: 'exchange_3',
    partnerId: 'student_david',
    skillName: 'Docker & Containerization',
    date: '2026-02-18',
    startTime: '11:00',
    durationMinutes: 75,
    learningMethod: 'Online',
    notes: 'Successfully built multi-stage Dockerfile and containerized the demo Spring Boot app.',
    status: 'Completed',
    createdAt: '2026-02-10T10:00:00.000Z'
  }
];

export const INITIAL_REVIEWS: Review[] = [
  {
    id: 'review_1',
    exchangeId: 'exchange_3',
    authorId: 'student_david',
    targetStudentId: 'student_pranav',
    rating: 5,
    comment: 'Pranav was an incredible learning partner! He broke down Spring Boot REST controllers and JPA entity mapping clearly and patiently. Really enjoyed our sessions.',
    createdAt: '2026-02-21T14:30:00.000Z',
    skillName: 'Java & Spring Boot'
  },
  {
    id: 'review_2',
    exchangeId: 'exchange_3',
    authorId: 'student_pranav',
    targetStudentId: 'student_david',
    rating: 5,
    comment: 'David is a Docker wizard. In two sessions, he helped me understand volume mounts, caching layers, and container networks. 10/10 recommendation!',
    createdAt: '2026-02-21T15:00:00.000Z',
    skillName: 'Docker & Containerization'
  }
];

export const INITIAL_MESSAGES: Message[] = [
  {
    id: 'msg_1',
    conversationId: 'conv_aisha',
    senderId: 'student_aisha',
    receiverId: 'student_pranav',
    text: 'Hey Pranav! Great chatting earlier about the React & Spring Boot exchange.',
    timestamp: '2026-03-14T15:30:00.000Z',
    read: true
  },
  {
    id: 'msg_2',
    conversationId: 'conv_aisha',
    senderId: 'student_pranav',
    receiverId: 'student_aisha',
    text: 'Hey Aisha! Excited for our upcoming session on Tuesday. I prepared a sample GitHub repo for the Spring backend.',
    timestamp: '2026-03-14T15:45:00.000Z',
    read: true
  },
  {
    id: 'msg_3',
    conversationId: 'conv_aisha',
    senderId: 'student_aisha',
    receiverId: 'student_pranav',
    text: 'Awesome! I will have our React starter sandbox ready with Tailwind v4 so we can dive right into state and hooks.',
    timestamp: '2026-03-14T16:00:00.000Z',
    read: true
  },
  {
    id: 'msg_4',
    conversationId: 'conv_david',
    senderId: 'student_david',
    receiverId: 'student_pranav',
    text: 'Thanks again for leaving the review, Pranav! Ping me anytime if you want to explore Kubernetes next.',
    timestamp: '2026-02-22T09:10:00.000Z',
    read: true
  }
];

export const INITIAL_CONVERSATIONS: Conversation[] = [
  {
    id: 'conv_aisha',
    participantIds: ['student_pranav', 'student_aisha'],
    lastMessage: 'Awesome! I will have our React starter sandbox ready with Tailwind v4 so we can dive right into state and hooks.',
    lastMessageTime: '2026-03-14T16:00:00.000Z',
    unreadCount: 0
  },
  {
    id: 'conv_david',
    participantIds: ['student_pranav', 'student_david'],
    lastMessage: 'Thanks again for leaving the review, Pranav! Ping me anytime if you want to explore Kubernetes next.',
    lastMessageTime: '2026-02-22T09:10:00.000Z',
    unreadCount: 0
  }
];

export const INITIAL_ACHIEVEMENTS: Achievement[] = [
  {
    id: 'ach_1',
    title: 'First Bridge Built',
    description: 'Sent your first connection request on SkillBridge.',
    icon: 'Handshake',
    category: 'Community',
    isUnlocked: true,
    progress: 1,
    maxProgress: 1,
    unlockedAt: 'February 2026'
  },
  {
    id: 'ach_2',
    title: 'Exchange Pioneer',
    description: 'Proposed and initiated your first peer skill exchange.',
    icon: 'Repeat',
    category: 'Milestone',
    isUnlocked: true,
    progress: 1,
    maxProgress: 1,
    unlockedAt: 'January 2026'
  },
  {
    id: 'ach_3',
    title: 'Skill Polymath',
    description: 'Add at least 5 skills across teaching and learning portfolios.',
    icon: 'Sparkles',
    category: 'Teaching',
    isUnlocked: true,
    progress: 6,
    maxProgress: 5,
    unlockedAt: 'March 2026'
  },
  {
    id: 'ach_4',
    title: 'Dedicated Mentor',
    description: 'Successfully complete 5 learning sessions with peers.',
    icon: 'GraduationCap',
    category: 'Learning',
    isUnlocked: false,
    progress: 3,
    maxProgress: 5
  },
  {
    id: 'ach_5',
    title: 'Five-Star Educator',
    description: 'Receive 5 positive reviews with average rating above 4.8.',
    icon: 'Star',
    category: 'Teaching',
    isUnlocked: false,
    progress: 2,
    maxProgress: 5
  },
  {
    id: 'ach_6',
    title: 'Campus Networker',
    description: 'Connect with peers from at least 3 different academic institutions.',
    icon: 'Users',
    category: 'Community',
    isUnlocked: true,
    progress: 3,
    maxProgress: 3,
    unlockedAt: 'March 2026'
  }
];

export const INITIAL_WALLET_BALANCE = 65.00;

export const INITIAL_SUBSCRIPTION: UserSubscription = {
  plan: 'free',
  status: 'active'
};

export const INITIAL_TRANSACTIONS: PaymentTransaction[] = [
  {
    id: 'TXN-98214',
    invoiceNumber: 'INV-2026-004',
    userId: 'student_pranav',
    amount: 50.00,
    currency: '$',
    status: 'completed',
    purpose: 'wallet_topup',
    title: 'Wallet Credit Top-Up',
    description: 'Added 50.00 credits via Visa card ending in 4242',
    paymentMethod: 'card',
    paymentDetails: {
      cardLast4: '4242',
      cardBrand: 'Visa'
    },
    createdAt: '2026-03-24T10:15:00.000Z'
  },
  {
    id: 'TXN-98215',
    invoiceNumber: 'INV-2026-005',
    userId: 'student_pranav',
    amount: 15.00,
    currency: '$',
    status: 'completed',
    purpose: 'session_booking',
    title: '1-on-1 Mentorship Session Booking',
    description: 'Advanced UI/UX Figma Design consultation with Maya Lin',
    paymentMethod: 'wallet',
    paymentDetails: {},
    createdAt: '2026-03-25T14:30:00.000Z',
    recipientName: 'Maya Lin',
    recipientId: 'student_maya'
  },
  {
    id: 'TXN-98216',
    invoiceNumber: 'INV-2026-006',
    userId: 'student_pranav',
    amount: 5.00,
    currency: '$',
    status: 'completed',
    purpose: 'mentor_tip',
    title: 'Peer Appreciation Tip',
    description: 'Coffee tip for exceptional Spring Boot debugging assistance',
    paymentMethod: 'upi',
    paymentDetails: {
      upiId: 'pranav@okhdfcbank'
    },
    createdAt: '2026-03-25T16:45:00.000Z',
    recipientName: 'Alex Chen',
    recipientId: 'student_alex'
  },
  {
    id: 'TXN-98217',
    invoiceNumber: 'INV-2026-007',
    userId: 'student_pranav',
    amount: 25.00,
    currency: '$',
    status: 'completed',
    purpose: 'wallet_topup',
    title: 'Wallet Credit Top-Up',
    description: 'Direct credit reload via Net Banking (HDFC Bank)',
    paymentMethod: 'netbanking',
    paymentDetails: {
      bankName: 'HDFC Bank'
    },
    createdAt: '2026-03-26T09:00:00.000Z'
  }
];

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { Avatar } from '../../components/common/Avatar';
import { Student } from '../../types';
import { 
  Send, 
  Search, 
  MessageSquare, 
  ShieldAlert, 
  ArrowLeft, 
  Clock, 
  CheckCheck 
} from 'lucide-react';

export const MessagesPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { 
    currentUser, 
    students, 
    messages, 
    conversations, 
    sendMessage, 
    markConversationRead 
  } = useApp();

  const [activePartnerId, setActivePartnerId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // If a student query param exists, select them or start conversation
  useEffect(() => {
    const studentParam = searchParams.get('student');
    if (studentParam) {
      setActivePartnerId(studentParam);
    } else if (!activePartnerId && conversations.length > 0) {
      // Default to first conversation partner
      const firstConv = conversations[0];
      const partner = firstConv.participantIds.find(id => id !== currentUser?.id);
      if (partner) {
        setActivePartnerId(partner);
      }
    }
  }, [searchParams, conversations, currentUser]);

  // When active partner changes, mark conversation as read
  useEffect(() => {
    if (activePartnerId && currentUser) {
      const conv = conversations.find(c => 
        c.participantIds.includes(currentUser.id) && c.participantIds.includes(activePartnerId)
      );
      if (conv) {
        markConversationRead(conv.id);
      }
    }
  }, [activePartnerId, currentUser, markConversationRead]);

  // Scroll to bottom of message list on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activePartnerId]);

  if (!currentUser) return null;

  const activePartner = students.find(s => s.id === activePartnerId);

  // Filtered conversation list
  const filteredConversations = useMemo(() => {
    return conversations.filter(conv => {
      const partnerId = conv.participantIds.find(id => id !== currentUser.id);
      const partner = students.find(s => s.id === partnerId);
      if (!partner) return false;
      if (searchFilter.trim()) {
        return partner.name.toLowerCase().includes(searchFilter.toLowerCase().trim());
      }
      return true;
    });
  }, [conversations, students, currentUser, searchFilter]);

  // Messages between current user and active partner
  const currentChatMessages = useMemo(() => {
    if (!activePartnerId) return [];
    return messages.filter(
      m => (m.senderId === currentUser.id && m.receiverId === activePartnerId) ||
           (m.senderId === activePartnerId && m.receiverId === currentUser.id)
    ).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [messages, currentUser, activePartnerId]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activePartnerId) return;

    sendMessage(activePartnerId, inputText);
    setInputText('');
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="h-[calc(100vh-8.5rem)] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Top Disclaimer Notice */}
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
          <span>Demo Peer Messaging: messages are saved to browser LocalStorage with simulated reply capability.</span>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Conversation List Sidebar */}
        <div className={`w-full md:w-80 border-r border-slate-200 flex flex-col ${
          activePartnerId ? 'hidden md:flex' : 'flex'
        }`}>
          {/* Search bar */}
          <div className="p-3 border-b border-slate-100">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search conversations..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Conversation items */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
            {filteredConversations.length > 0 ? (
              filteredConversations.map(conv => {
                const partnerId = conv.participantIds.find(id => id !== currentUser.id);
                const partner = students.find(s => s.id === partnerId);
                if (!partner) return null;
                const isSelected = activePartnerId === partner.id;

                return (
                  <button
                    key={conv.id}
                    onClick={() => {
                      setActivePartnerId(partner.id);
                      const newParams = new URLSearchParams(searchParams);
                      newParams.set('student', partner.id);
                      setSearchParams(newParams);
                    }}
                    className={`w-full text-left p-3.5 flex items-start gap-3 transition-colors ${
                      isSelected ? 'bg-indigo-50/70 border-l-3 border-l-indigo-600' : 'hover:bg-slate-50'
                    }`}
                  >
                    <Avatar name={partner.name} initials={partner.initials} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {partner.name}
                        </span>
                        {conv.lastMessageTime && (
                          <span className="text-[10px] text-slate-400 shrink-0">
                            {formatTime(conv.lastMessageTime)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 truncate leading-snug">
                        {conv.lastMessage || 'No messages yet'}
                      </p>
                    </div>
                    {conv.unreadCount > 0 && (
                      <span className="w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {conv.unreadCount}
                      </span>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="p-8 text-center text-slate-400 space-y-2">
                <MessageSquare className="w-6 h-6 mx-auto text-slate-300" />
                <p className="text-xs">No active conversations found.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Active Chat Area */}
        <div className={`flex-1 flex flex-col ${
          !activePartnerId ? 'hidden md:flex' : 'flex'
        }`}>
          {activePartner ? (
            <>
              {/* Chat Header */}
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setActivePartnerId(null)}
                    className="md:hidden p-1.5 rounded-lg text-slate-500 hover:text-slate-900"
                    aria-label="Back to conversations"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>

                  <Avatar name={activePartner.name} initials={activePartner.initials} size="sm" />
                  <div>
                    <h2 className="text-xs font-bold text-slate-900 leading-tight">
                      {activePartner.name}
                    </h2>
                    <p className="text-[10px] text-slate-500">
                      {activePartner.department} · {activePartner.college}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => window.location.href = `#/students/${activePartner.id}`}
                  className="text-xs font-medium text-indigo-600 hover:underline"
                >
                  View Profile
                </button>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50/40">
                {currentChatMessages.length > 0 ? (
                  currentChatMessages.map(msg => {
                    const isMe = msg.senderId === currentUser.id;
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[78%] px-4 py-2.5 rounded-2xl text-xs leading-relaxed shadow-xs ${
                            isMe
                              ? 'bg-indigo-600 text-white rounded-br-xs'
                              : 'bg-white border border-slate-200/90 text-slate-800 rounded-bl-xs'
                          }`}
                        >
                          {msg.text}
                        </div>
                        <div className="flex items-center gap-1 mt-1 px-1 text-[10px] text-slate-400">
                          <span>{formatTime(msg.timestamp)}</span>
                          {isMe && <CheckCheck className="w-3 h-3 text-indigo-500" />}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                    <MessageSquare className="w-8 h-8 text-slate-300 mb-2" />
                    <p className="text-xs font-semibold text-slate-700">Start the conversation</p>
                    <p className="text-[11px] text-slate-500 max-w-xs mt-1">
                      Say hello to {activePartner.name.split(' ')[0]} and introduce what you'd like to learn or teach!
                    </p>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input */}
              <form onSubmit={handleSend} className="p-3 border-t border-slate-200 bg-white flex items-center gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={`Message ${activePartner.name.split(' ')[0]}...`}
                  className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors shadow-xs disabled:opacity-40"
                  aria-label="Send message"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400">
              <MessageSquare className="w-12 h-12 text-slate-200 mb-3" />
              <h3 className="text-sm font-bold text-slate-800 mb-1">Select a Conversation</h3>
              <p className="text-xs text-slate-500 max-w-xs">
                Choose a peer from the left or connect with a new student to start chatting.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

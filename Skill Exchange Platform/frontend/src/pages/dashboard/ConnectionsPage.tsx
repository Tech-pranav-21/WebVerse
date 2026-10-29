import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { Avatar } from '../../components/common/Avatar';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { EmptyState } from '../../components/common/EmptyState';
import { 
  Users, 
  UserCheck, 
  Clock, 
  Send, 
  MessageSquare, 
  UserX, 
  Check, 
  X, 
  Repeat, 
  ArrowRight 
} from 'lucide-react';

export const ConnectionsPage: React.FC = () => {
  const navigate = useNavigate();
  const { 
    currentUser, 
    students, 
    connections, 
    respondConnectionRequest, 
    removeConnection 
  } = useApp();

  const [activeTab, setActiveTab] = useState<'accepted' | 'received' | 'sent'>('accepted');
  const [removePartnerId, setRemovePartnerId] = useState<string | null>(null);

  if (!currentUser) return null;

  // 1. Accepted Connections
  const acceptedConnections = useMemo(() => {
    return connections.filter(
      c => (c.senderId === currentUser.id || c.receiverId === currentUser.id) && c.status === 'Accepted'
    );
  }, [connections, currentUser]);

  // 2. Received Requests (Pending)
  const receivedRequests = useMemo(() => {
    return connections.filter(
      c => c.receiverId === currentUser.id && c.status === 'Pending'
    );
  }, [connections, currentUser]);

  // 3. Sent Requests (Pending)
  const sentRequests = useMemo(() => {
    return connections.filter(
      c => c.senderId === currentUser.id && c.status === 'Pending'
    );
  }, [connections, currentUser]);

  const handleConfirmRemove = () => {
    if (removePartnerId) {
      removeConnection(removePartnerId);
      setRemovePartnerId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Peer Connections
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Build your peer network across universities. Connected students can message directly and coordinate skill exchanges.
          </p>
        </div>

        <button
          onClick={() => navigate('/explore')}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors shadow-xs self-start sm:self-center"
        >
          <Users className="w-3.5 h-3.5" />
          Find New Peers
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit text-xs font-medium">
        <button
          onClick={() => setActiveTab('accepted')}
          className={`px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'accepted' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>My Network ({acceptedConnections.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('received')}
          className={`px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'received' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Received ({receivedRequests.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('sent')}
          className={`px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'sent' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>Sent ({sentRequests.length})</span>
        </button>
      </div>

      {/* Tab 1: Accepted Connections */}
      {activeTab === 'accepted' && (
        <div className="space-y-4">
          {acceptedConnections.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {acceptedConnections.map((conn) => {
                const partnerId = conn.senderId === currentUser.id ? conn.receiverId : conn.senderId;
                const partner = students.find(s => s.id === partnerId);
                if (!partner) return null;

                return (
                  <div
                    key={conn.id}
                    className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between hover:border-indigo-300 transition-colors"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={partner.name} initials={partner.initials} size="md" />
                          <div>
                            <h3 className="text-sm font-bold text-slate-900">
                              {partner.name}
                            </h3>
                            <p className="text-xs text-slate-500">
                              {partner.department}
                            </p>
                          </div>
                        </div>

                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md">
                          Connected
                        </span>
                      </div>

                      <p className="text-xs text-slate-600 line-clamp-2 mb-3">
                        {partner.bio}
                      </p>

                      <div className="text-[11px] text-slate-500 border-t border-slate-100 pt-2 mb-4">
                        <span className="font-semibold text-slate-700">{partner.college}</span> · {partner.yearOfStudy}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
                      <button
                        onClick={() => navigate(`/students/${partner.id}`)}
                        className="text-xs font-medium text-slate-600 hover:text-indigo-600"
                      >
                        Profile
                      </button>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => navigate(`/messages?student=${partner.id}`)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          Chat
                        </button>
                        <button
                          onClick={() => setRemovePartnerId(partner.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Remove Connection"
                          aria-label="Remove"
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title="No Connections in Your Network Yet"
              description="Browse the student directory or check your mutual matches to connect with peers."
              actionLabel="Explore Learning Partners"
              onAction={() => navigate('/explore')}
            />
          )}
        </div>
      )}

      {/* Tab 2: Received Requests */}
      {activeTab === 'received' && (
        <div className="space-y-4">
          {receivedRequests.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {receivedRequests.map((req) => {
                const sender = students.find(s => s.id === req.senderId);
                if (!sender) return null;

                return (
                  <div
                    key={req.id}
                    className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={sender.name} initials={sender.initials} size="md" />
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">{sender.name}</h3>
                          <p className="text-xs text-slate-500">{sender.department} · {sender.college}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-md">
                        Pending Approval
                      </span>
                    </div>

                    {req.message && (
                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-700 italic">
                        "{req.message}"
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
                      <button
                        onClick={() => navigate(`/students/${sender.id}`)}
                        className="font-medium text-slate-600 hover:text-indigo-600"
                      >
                        View Profile
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => respondConnectionRequest(req.id, 'Declined')}
                          className="px-3 py-1.5 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => respondConnectionRequest(req.id, 'Accepted')}
                          className="px-3.5 py-1.5 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs"
                        >
                          Accept
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Clock}
              title="No Pending Received Requests"
              description="When other students send you a connection request, it will appear here for your review."
            />
          )}
        </div>
      )}

      {/* Tab 3: Sent Requests */}
      {activeTab === 'sent' && (
        <div className="space-y-4">
          {sentRequests.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sentRequests.map((req) => {
                const receiver = students.find(s => s.id === req.receiverId);
                if (!receiver) return null;

                return (
                  <div
                    key={req.id}
                    className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={receiver.name} initials={receiver.initials} size="md" />
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">{receiver.name}</h3>
                          <p className="text-xs text-slate-500">{receiver.department} · {receiver.college}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-md">
                        Awaiting Response
                      </span>
                    </div>

                    {req.message && (
                      <p className="text-xs text-slate-600 italic">
                        "{req.message}"
                      </p>
                    )}

                    <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
                      <button
                        onClick={() => navigate(`/students/${receiver.id}`)}
                        className="font-medium text-slate-600 hover:text-indigo-600"
                      >
                        View Profile
                      </button>

                      <button
                        onClick={() => respondConnectionRequest(req.id, 'Cancelled')}
                        className="px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        Cancel Request
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Send}
              title="No Outgoing Requests"
              description="You have no pending connection requests waiting for approval."
              actionLabel="Discover Students"
              onAction={() => navigate('/explore')}
            />
          )}
        </div>
      )}

      {/* Remove Connection Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!removePartnerId}
        onClose={() => setRemovePartnerId(null)}
        onConfirm={handleConfirmRemove}
        title="Remove Peer Connection"
        message="Are you sure you want to disconnect from this student? You will still be able to reconnect in the future."
        confirmLabel="Remove Connection"
        variant="danger"
      />
    </div>
  );
};

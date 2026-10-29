import React, { useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Sidebar } from '../components/common/Sidebar';
import { Header } from '../components/common/Header';
import { ToastContainer } from '../components/common/Toast';
import { AddSkillModal } from '../components/modals/AddSkillModal';
import { ProposeExchangeModal } from '../components/modals/ProposeExchangeModal';
import { PaymentCheckoutModal } from '../components/modals/PaymentCheckoutModal';
import { InvoiceReceiptModal } from '../components/modals/InvoiceReceiptModal';
import { Student } from '../types';

export const AppLayout: React.FC = () => {
  const { currentUser, selectedReceiptTransaction, closeReceiptModal } = useApp();
  const location = useLocation();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [addSkillOpen, setAddSkillOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposePartner, setProposePartner] = useState<Student | null>(null);

  // If not logged in, redirect to login
  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const handleOpenPropose = (partner?: Student) => {
    if (partner) {
      setProposePartner(partner);
    } else {
      setProposePartner(null);
    }
    setProposeOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      {/* Sidebar */}
      <Sidebar 
        mobileOpen={mobileMenuOpen} 
        onCloseMobile={() => setMobileMenuOpen(false)} 
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          onToggleMobileMenu={() => setMobileMenuOpen(prev => !prev)}
          onOpenAddSkill={() => setAddSkillOpen(true)}
          onOpenProposeExchange={() => handleOpenPropose()}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <Outlet context={{ onOpenProposeExchange: handleOpenPropose, onOpenAddSkill: () => setAddSkillOpen(true) }} />
        </main>
      </div>

      {/* Global Modals */}
      <AddSkillModal
        isOpen={addSkillOpen}
        onClose={() => setAddSkillOpen(false)}
      />

      <ProposeExchangeModal
        isOpen={proposeOpen}
        onClose={() => {
          setProposeOpen(false);
          setProposePartner(null);
        }}
        preselectedPartner={proposePartner}
      />

      <PaymentCheckoutModal />

      <InvoiceReceiptModal
        isOpen={!!selectedReceiptTransaction}
        onClose={closeReceiptModal}
        transaction={selectedReceiptTransaction}
      />

      {/* Toasts */}
      <ToastContainer />
    </div>
  );
};

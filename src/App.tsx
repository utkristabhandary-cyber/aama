import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppLayout } from './components/layout/AppLayout';
import { LoginView } from './features/auth/LoginView';
import { ForcedPasswordChangeView } from './features/auth/ForcedPasswordChangeView';
import { UnauthorizedAccessView } from './components/auth/UnauthorizedAccessView';
import { NotFoundView } from './components/NotFoundView';
import { Role } from './types';

// Admin Views
import { AdminDashboard } from './features/dashboard/AdminDashboard';
import { AcademicView } from './features/academic/AcademicView';
import { SemestersView } from './features/academic/SemestersView';
import { SectionsView } from './features/academic/SectionsView';
import { SectionAllocationCSVView } from './features/academic/SectionAllocationCSVView';
import { SubjectsView } from './features/academic/SubjectsView';
import { TeachersView } from './features/teachers/TeachersView';
import { StudentsView } from './features/students/StudentsView';
import { AssignmentsView } from './features/assignments/AssignmentsView';
import { TimetableAdminView } from './features/timetable/TimetableAdminView';
import { AttendanceAdminView } from './features/attendance/AttendanceAdminView';
import { TakeAttendanceView } from './features/attendance/TakeAttendanceView';
import { ReportsView } from './features/reports/ReportsView';
import { CalendarHolidaysView } from './features/calendar/CalendarHolidaysView';
import { TimesheetView } from './features/timesheet/TimesheetView';
import { PromotionView } from './features/promotion/PromotionView';
import { NotificationsView } from './features/notifications/NotificationsView';
import { SettingsView } from './features/settings/SettingsView';
import { UserProfileView } from './features/profile/UserProfileView';

// Teacher Views
import { TeacherDashboard } from './features/teacher/TeacherDashboard';
import { TeacherClassesView } from './features/teacher/TeacherClassesView';
import { TeacherStudentsView } from './features/teacher/TeacherStudentsView';
import { TeacherReportsView } from './features/teacher/TeacherReportsView';
import { TeacherTimetableView } from './features/teacher/TeacherTimetableView';

// Student Views
import { StudentDashboard } from './features/student/StudentDashboard';
import { StudentAttendanceView } from './features/student/StudentAttendanceView';
import { StudentQRScannerView } from './features/student/StudentQRScannerView';
import { StudentProfileView } from './features/student/StudentProfileView';
import { StudentReportsView } from './features/student/StudentReportsView';
import { StudentTimetableView } from './features/student/StudentTimetableView';
import { StudentAttendanceHistoryView } from './features/student/StudentAttendanceHistoryView';

/**
 * Route protection permissions matrix
 */
const VIEW_ROLE_PERMISSIONS: Record<string, Role[]> = {
  // Shared
  dashboard: ['admin', 'teacher', 'student'],
  notifications: ['admin', 'teacher', 'student'],
  profile: ['admin', 'teacher', 'student'],
  calendar: ['admin', 'teacher', 'student'],

  // Admin exclusive
  academic: ['admin'],
  semesters: ['admin'],
  sections: ['admin'],
  'section-allocation': ['admin'],
  subjects: ['admin'],
  teachers: ['admin'],
  students: ['admin'],
  assignments: ['admin'],
  timetable: ['admin'],
  attendance: ['admin'],
  promotion: ['admin'],
  settings: ['admin'],

  // Teacher exclusive
  'my-classes': ['teacher'],
  'teacher-students': ['teacher'],
  'take-attendance': ['admin', 'teacher'],
  'attendance-history': ['admin', 'teacher'],

  // Student exclusive
  'qr-scanner': ['student'],
  'my-attendance': ['student'],
  'my-history': ['student'],

  // Role-conditional views
  'my-timetable': ['teacher', 'student'],
  reports: ['admin', 'teacher', 'student'],
  timesheet: ['admin', 'teacher'],
};

const MainContent: React.FC = () => {
  const { isAuthenticated, role, user, isLoading } = useAuth();
  const [currentView, setCurrentView] = useState<string>('dashboard');
  const [activeSlotId, setActiveSlotId] = useState<string | undefined>(undefined);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-400 font-medium tracking-wide">Loading Academic Portal...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginView />;
  }

  // Phase D identity gate: an account still holding the importer-generated
  // temporary password is confined to password-setup until it is replaced.
  if (user?.mustChangePassword) {
    return <ForcedPasswordChangeView />;
  }

  const handleNavigate = (viewId: string, params?: Record<string, string>) => {
    if (params?.slotId) {
      setActiveSlotId(params.slotId);
    } else {
      setActiveSlotId(undefined);
    }
    setCurrentView(viewId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleStartAttendance = (slotId?: string) => {
    setActiveSlotId(slotId);
    setCurrentView('take-attendance');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Route-Guard Validation
  const allowedRoles = VIEW_ROLE_PERMISSIONS[currentView];

  // Unmapped / unknown view ids must never fall through to a role-visible view.
  if (!allowedRoles) {
    return (
      <AppLayout currentView={currentView} onNavigate={handleNavigate}>
        <NotFoundView
          attemptedView={currentView}
          onReturnToDashboard={() => setCurrentView('dashboard')}
        />
      </AppLayout>
    );
  }

  if (!allowedRoles.includes(role)) {
    return (
      <AppLayout currentView={currentView} onNavigate={handleNavigate}>
        <UnauthorizedAccessView
          currentRole={role}
          attemptedView={currentView}
          onReturnToDashboard={() => setCurrentView('dashboard')}
        />
      </AppLayout>
    );
  }

  // Render view depending on currentView and role
  const renderCurrentView = () => {
    switch (currentView) {
      case 'dashboard':
        if (role === 'teacher') {
          return (
            <TeacherDashboard
              onStartAttendance={handleStartAttendance}
              onNavigate={handleNavigate}
            />
          );
        }
        if (role === 'student') {
          return <StudentDashboard onNavigate={handleNavigate} />;
        }
        return (
          <AdminDashboard
            onNavigate={handleNavigate}
            onStartAttendance={() => handleStartAttendance()}
          />
        );

      // Academic Hierarchy (Admin)
      case 'academic':
        return <AcademicView onNavigate={handleNavigate} />;
      case 'semesters':
        return <SemestersView />;
      case 'sections':
        return <SectionsView />;
      case 'section-allocation':
        return <SectionAllocationCSVView onFinished={() => setCurrentView('sections')} />;
      case 'subjects':
        return <SubjectsView />;

      // Faculty & Students (Admin)
      case 'teachers':
        return <TeachersView />;
      case 'students':
        return <StudentsView />;
      case 'assignments':
        return <AssignmentsView />;

      // Timetable
      case 'timetable':
        return <TimetableAdminView />;
      case 'my-timetable':
        if (role === 'teacher') {
          return <TeacherTimetableView onStartAttendance={handleStartAttendance} />;
        }
        return <StudentTimetableView />;

      // Teacher Specific
      case 'my-classes':
        return <TeacherClassesView onStartAttendance={handleStartAttendance} />;
      case 'teacher-students':
        return <TeacherStudentsView />;

      // Student Specific
      case 'qr-scanner':
        return <StudentQRScannerView />;
      case 'my-attendance':
        return <StudentAttendanceView />;
      case 'my-history':
        return <StudentAttendanceHistoryView />;

      // Attendance Operations
      case 'take-attendance':
        return (
          <TakeAttendanceView
            preselectedSlotId={activeSlotId}
            onFinished={() => {
              if (role === 'teacher') {
                setCurrentView('attendance-history');
              } else {
                setCurrentView('attendance');
              }
            }}
          />
        );
      case 'attendance':
      case 'attendance-history':
        return (
          <AttendanceAdminView
            onConductAttendance={() => handleStartAttendance()}
          />
        );

      // Timesheet (teacher + admin, role-aware)
      case 'timesheet':
        return <TimesheetView />;

      // Reports & Analytics (Role-scoped)
      case 'reports':
        if (role === 'teacher') {
          return <TeacherReportsView />;
        }
        if (role === 'student') {
          return <StudentReportsView />;
        }
        return <ReportsView />;

      // Academic Calendar & Holidays
      case 'calendar':
        return <CalendarHolidaysView />;

      // Promotion (Admin)
      case 'promotion':
        return <PromotionView />;

      // Notifications
      case 'notifications':
        return <NotificationsView />;

      // System Settings (Admin)
      case 'settings':
        return <SettingsView />;

      // Profile
      case 'profile':
        if (role === 'student') {
          return <StudentProfileView />;
        }
        return <UserProfileView />;

      default:
        return (
          <NotFoundView
            attemptedView={currentView}
            onReturnToDashboard={() => setCurrentView('dashboard')}
          />
        );
    }
  };

  return (
    <AppLayout currentView={currentView} onNavigate={handleNavigate}>
      {renderCurrentView()}
    </AppLayout>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <MainContent />
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

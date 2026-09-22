import React from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  GraduationCap,
  LayoutDashboard,
  Layers,
  CalendarDays,
  Calendar,
  Users,
  UserCheck,
  BookOpen,
  ClipboardList,
  BarChart3,
  TrendingUp,
  Bell,
  Settings,
  X,
  Clock,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  QrCode,
  FileSpreadsheet,
  Hourglass,
} from 'lucide-react';

export interface SidebarProps {
  currentView: string;
  onNavigate: (viewId: string) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  isOpenMobile,
  onCloseMobile,
}) => {
  const { role, user } = useAuth();

  const handleItemClick = (id: string) => {
    onNavigate(id);
    onCloseMobile();
  };

  // Build navigation items based on active role
  const getNavSections = () => {
    if (role === 'teacher') {
      return [
        {
          title: 'Teaching Portal',
          items: [
            { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
            { id: 'my-classes', label: 'My Classes', icon: <BookOpen className="w-4 h-4" /> },
            { id: 'teacher-students', label: 'My Students', icon: <Users className="w-4 h-4" /> },
            { id: 'my-timetable', label: 'My Timetable', icon: <Clock className="w-4 h-4" /> },
          ],
        },
        {
          title: 'Attendance',
          items: [
            { id: 'take-attendance', label: 'Take Attendance', icon: <CheckCircle2 className="w-4 h-4" />, highlight: true },
            { id: 'attendance-history', label: 'Session History', icon: <ClipboardList className="w-4 h-4" /> },
            { id: 'timesheet', label: 'My Timesheet', icon: <Hourglass className="w-4 h-4" /> },
            { id: 'reports', label: 'Class Reports', icon: <BarChart3 className="w-4 h-4" /> },
          ],
        },
        {
          title: 'General',
          items: [
            { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" /> },
            { id: 'profile', label: 'My Profile', icon: <Users className="w-4 h-4" /> },
          ],
        },
      ];
    }

    if (role === 'student') {
      return [
        {
          title: 'Student Portal',
          items: [
            { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
            { id: 'qr-scanner', label: 'QR Attendance', icon: <QrCode className="w-4 h-4" />, highlight: true },
            { id: 'my-attendance', label: 'My Attendance', icon: <CheckCircle2 className="w-4 h-4" /> },
            { id: 'my-timetable', label: 'Class Schedule', icon: <Clock className="w-4 h-4" /> },
          ],
        },
        {
          title: 'Records & Events',
          items: [
            { id: 'reports', label: 'Attendance Reports', icon: <BarChart3 className="w-4 h-4" /> },
            { id: 'calendar', label: 'Calendar & Holidays', icon: <Calendar className="w-4 h-4" /> },
          ],
        },
        {
          title: 'Account',
          items: [
            { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" /> },
            { id: 'profile', label: 'My Profile', icon: <Users className="w-4 h-4" /> },
          ],
        },
      ];
    }

    // Default: Super Admin Navigation
    return [
      {
        title: 'Overview',
        items: [
          { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
        ],
      },
      {
        title: 'Academic Structure',
        items: [
          { id: 'academic', label: 'Academic Hierarchy', icon: <Layers className="w-4 h-4" /> },
          { id: 'semesters', label: 'Semesters', icon: <CalendarDays className="w-4 h-4" /> },
          { id: 'sections', label: 'Sections', icon: <Layers className="w-4 h-4" /> },
          { id: 'section-allocation', label: 'Section Allocation CSV', icon: <FileSpreadsheet className="w-4 h-4" /> },
          { id: 'subjects', label: 'Subjects', icon: <BookOpen className="w-4 h-4" /> },
        ],
      },
      {
        title: 'People & Assignments',
        items: [
          { id: 'teachers', label: 'Teachers', icon: <Briefcase className="w-4 h-4" /> },
          { id: 'students', label: 'Students', icon: <Users className="w-4 h-4" /> },
          { id: 'assignments', label: 'Teacher Assignments', icon: <UserCheck className="w-4 h-4" /> },
        ],
      },
      {
        title: 'Operations',
        items: [
          { id: 'timetable', label: 'Timetable', icon: <Clock className="w-4 h-4" /> },
          { id: 'attendance', label: 'Attendance Sessions', icon: <ClipboardList className="w-4 h-4" /> },
          { id: 'timesheet', label: 'Teacher Timesheet', icon: <FileSpreadsheet className="w-4 h-4" /> },
          { id: 'reports', label: 'Attendance Reports', icon: <BarChart3 className="w-4 h-4" /> },
          { id: 'calendar', label: 'Calendar & Holidays', icon: <Calendar className="w-4 h-4" /> },
          { id: 'promotion', label: 'Student Promotion', icon: <TrendingUp className="w-4 h-4" /> },
        ],
      },
      {
        title: 'System',
        items: [
          { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" /> },
          { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
        ],
      },
    ];
  };

  const navSections = getNavSections();

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 w-64 bg-slate-900 text-slate-200 border-r border-slate-800 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between h-16 px-5 border-b border-slate-800/80 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold shadow-md shadow-indigo-600/30 shrink-0">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <span className="font-extrabold text-white text-base tracking-tight leading-none block">
                AAMS
              </span>
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mt-0.5">
                Academic Portal
              </span>
            </div>
          </div>

          <button
            onClick={onCloseMobile}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Active Role Pill */}
        <div className="px-4 py-3 border-b border-slate-800/60 bg-slate-900/80">
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/70 border border-slate-700/60">
            <div className="min-w-0">
              <p className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">
                Active Session
              </p>
              <p className="text-xs font-semibold text-white truncate">{user?.name}</p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {role}
            </span>
          </div>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {navSections.map((sec, idx) => (
            <div key={idx}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3 mb-1.5">
                {sec.title}
              </p>
              <div className="space-y-0.5">
                {sec.items.map(item => {
                  const isActive = currentView === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleItemClick(item.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-all text-left group cursor-pointer ${
                        isActive
                          ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                          : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`shrink-0 ${
                            isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                          }`}
                        >
                          {item.icon}
                        </span>
                        <span className="truncate">{item.label}</span>
                      </div>
                      {item.highlight && !isActive && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                      )}
                      {isActive && (
                        <ChevronRight className="w-3.5 h-3.5 text-indigo-200 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Institutional Footer */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/30">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>Academic Year</span>
            <span className="font-semibold text-slate-300 font-mono">2026-2027</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">Enterprise Edition v2.4</p>
        </div>
      </aside>
    </>
  );
};

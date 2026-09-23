import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import {
  Shield,
  Database,
  Building,
  Info,
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Institutional System Settings</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Academic attendance policies, compliance thresholds, and database management
        </p>
      </div>

      {/* Institution & Term Parameters */}
      <Card>
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-indigo-600" />
            <CardTitle className="text-sm">Institution & Term Parameters</CardTitle>
          </div>
          <CardDescription>University identity and active academic term</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <span>
              Institution identity and the active academic term are managed by the backend through the
              Semesters module. The academic year shown across the portal is the real year of the
              active semester record — there is no separate institution-settings store, so nothing
              is editable on this screen.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Attendance Policy & Thresholds */}
      <Card>
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-indigo-600" />
            <CardTitle className="text-sm">Attendance Policy & Thresholds</CardTitle>
          </div>
          <CardDescription>Rules governing examination eligibility and roll call</CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Min. Attendance Required
              </span>
              <span className="text-2xl font-bold font-mono text-slate-900 mt-1 block">75%</span>
              <span className="text-[11px] text-slate-500">
                Enforced server-side by the reports API when flagging students at risk.
              </span>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Late Arrival Handling
              </span>
              <span className="text-2xl font-bold font-mono text-slate-900 mt-1 block">
                Present
              </span>
              <span className="text-[11px] text-slate-500">
                A late mark is recorded as present and counts in full toward attendance.
              </span>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Attendance Corrections
              </span>
              <span className="text-2xl font-bold font-mono text-slate-900 mt-1 block">
                Until finalised
              </span>
              <span className="text-[11px] text-slate-500">
                Faculty may correct attendance until the class session is finalised.
              </span>
            </div>
          </div>
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              Editing these values is not yet supported: the backend does not currently expose a settings
              endpoint, so saving changes here would silently have no effect. The displayed values are the
              ones the server enforces today.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Data Management */}
      <Card>
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-indigo-600" />
            <CardTitle className="text-sm">Data Management</CardTitle>
          </div>
          <CardDescription>
            Where institutional data lives and how it is managed
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-start gap-2.5">
            <Database className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <span>
              All semesters, sections, subjects, teachers, students, timetables, and attendance records are
              stored in the PostgreSQL database and served by the AAMS API. There is no client-side data
              store to back up or reset; institutional data changes are made through the Management pages.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
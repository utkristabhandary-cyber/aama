import { TimetableSlot, Semester } from '../../types';

export const EXPORT_CSV_HEADERS = [
  'Day',
  'Start Time',
  'End Time',
  'Semester',
  'Sections / Group',
  'Module Code',
  'Subject Name',
  'Faculty',
  'Type',
  'Room / Venue',
  'Is Combined',
  'Notes',
];

const csvCell = (value: string | number | null | undefined): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const buildTimetableCSV = (
  slots: TimetableSlot[],
  semesters: Semester[] = []
): string => {
  const semesterNameById = (id: string): string => {
    const semester = semesters.find(s => String(s.id) === String(id));
    return semester ? semester.name : '';
  };

  const rows = slots.map(s => {
    const groups =
      s.sectionNames && s.sectionNames.length > 0
        ? s.sectionNames.join(' + ')
        : s.sectionName || '';

    return [
      csvCell(s.day),
      csvCell(s.startTime),
      csvCell(s.endTime),
      csvCell(semesterNameById(s.semesterId)),
      csvCell(groups),
      csvCell(s.subjectCode),
      csvCell(s.subjectName),
      csvCell(s.teacherName),
      csvCell(s.classType || 'Lecture'),
      csvCell(s.room),
      csvCell(s.isCombined ? 'YES' : 'NO'),
      csvCell(s.notes),
    ].join(',');
  });

  return [EXPORT_CSV_HEADERS.join(','), ...rows].join('\n');
};
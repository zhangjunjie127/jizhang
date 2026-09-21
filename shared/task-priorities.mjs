export const TASK_PRIORITIES = [
  { value: 'high', label: '重要且紧急', color: '#e5485d', soft: '#fff0f2' },
  { value: 'important', label: '重要不紧急', color: '#bf7008', soft: '#fff6e8' },
  { value: 'urgent', label: '紧急不重要', color: '#208653', soft: '#edf9f2' },
  { value: 'low', label: '不重要不紧急', color: '#237bd1', soft: '#eef6ff' },
];

// Keep the relative order of the original high / normal / low records.
export const normalizeTaskPriority = value => value === 'normal' ? 'important' : value || 'low';
export const taskPriority = value => TASK_PRIORITIES.find(item => item.value === normalizeTaskPriority(value)) || TASK_PRIORITIES[3];
export const taskPriorityRank = value => TASK_PRIORITIES.indexOf(taskPriority(value));

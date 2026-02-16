// Core belt logic for BJJ Flow Manager
// Small, framework-agnostic module to compute progress towards degrees/belt promotion

export type Belt = 'Branca' | 'Azul' | 'Roxa' | 'Marrom' | 'Preta';

export interface StudentRecord {
  id: string;
  current_belt: Belt;
  current_degree: number; // 0..4
  belt_since: string; // ISO timestamp
}

export interface AttendanceRecord {
  attended_at: string; // ISO timestamp
}

export interface ClubConfig {
  classesPerDegree: Record<Belt, number>;
  monthsPerDegree: Record<Belt, number>;
  alertThresholdPercent: number; // e.g. 0.9 = alert at 90% of required classes
}

const BELT_ORDER: Belt[] = ['Branca', 'Azul', 'Roxa', 'Marrom', 'Preta'];

function nextBelt(belt: Belt): Belt | null {
  const idx = BELT_ORDER.indexOf(belt);
  if (idx === -1 || idx === BELT_ORDER.length - 1) return null;
  return BELT_ORDER[idx + 1];
}

export interface ProgressResult {
  studentId: string;
  currentBelt: Belt;
  currentDegree: number;
  attendedSinceBelt: number;
  requiredForNextDegree: number;
  monthsAtBelt: number;
  readyForDegree: boolean;
  readyForBeltPromotion: boolean; // when current degree > maxDegree (4) and meets promotion rules
  alert: boolean; // visual alert to teacher
  nextDegreeIfAwarded: number;
  nextBeltIfPromoted: Belt | null;
}

export function evaluateBeltProgress(
  student: StudentRecord,
  attendancesSinceBelt: AttendanceRecord[],
  config: ClubConfig,
  maxDegree = 4
): ProgressResult {
  const now = new Date();
  const beltSince = new Date(student.belt_since);
  const monthsAtBelt = Math.floor((now.getTime() - beltSince.getTime()) / (1000 * 60 * 60 * 24 * 30));

  const attended = attendancesSinceBelt.length;
  const required = config.classesPerDegree[student.current_belt] ?? 20;
  const monthsRequired = config.monthsPerDegree[student.current_belt] ?? 6;

  const readyForDegree = attended >= required || monthsAtBelt >= monthsRequired;

  let nextDegree = student.current_degree;
  let readyForBeltPromotion = false;
  let nextBelt: Belt | null = null;

  if (readyForDegree) {
    if (student.current_degree < maxDegree) {
      nextDegree = student.current_degree + 1;
    } else {
      // degree would overflow -> belt promotion
      nextDegree = 0;
      const nb = nextBeltValue(student.current_belt);
      nextBelt = nb;
      readyForBeltPromotion = nb !== null;
    }
  }

  // compute alert when student reaches threshold percent of required classes
  const alert = required > 0 && attended / required >= config.alertThresholdPercent;

  return {
    studentId: student.id,
    currentBelt: student.current_belt,
    currentDegree: student.current_degree,
    attendedSinceBelt: attended,
    requiredForNextDegree: required,
    monthsAtBelt,
    readyForDegree,
    readyForBeltPromotion,
    alert,
    nextDegreeIfAwarded: nextDegree,
    nextBeltIfPromoted: nextBelt,
  };
}

function nextBeltValue(belt: Belt): Belt | null {
  const idx = BELT_ORDER.indexOf(belt);
  if (idx === -1 || idx === BELT_ORDER.length - 1) return null;
  return BELT_ORDER[idx + 1];
}

// Utility: aggregate attendances by student and filter those since student's `belt_since`
export function filterAttendancesSince(dateISO: string, attendances: AttendanceRecord[]) {
  const since = new Date(dateISO).getTime();
  return attendances.filter((a) => new Date(a.attended_at).getTime() >= since);
}

// Example defaults to be used when instantiating the config
export const DEFAULT_CLUB_CONFIG: ClubConfig = {
  classesPerDegree: {
    Branca: 20,
    Azul: 40,
    Roxa: 60,
    Marrom: 80,
    Preta: 120,
  },
  monthsPerDegree: {
    Branca: 6,
    Azul: 12,
    Roxa: 18,
    Marrom: 24,
    Preta: 36,
  },
  alertThresholdPercent: 0.9,
};

// Example usage (pseudo):
// const progress = evaluateBeltProgress(student, filterAttendancesSince(student.belt_since, attendances), DEFAULT_CLUB_CONFIG);

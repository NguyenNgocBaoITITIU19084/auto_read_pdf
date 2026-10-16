// Bumped with each new tour so everyone sees the welcome (and its tour) once more
const ONBOARDING_KEY = 'auto_read_pdf_onboarding_completed_v3';

/** UI state a tour step needs; the tab that owns it does the change. Never touches data. */
export type TourActionType =
  | 'showBookingTable'
  | 'showBookingCalendar'
  | 'openFirstBooking'
  | 'closeBookingDetail'
  | 'showVesselTable'
  | 'showVesselCalendar'
  /** Put back the views the tour changed and close what it opened */
  | 'restoreViews';

/** Tabs with a "this screen" tour (keep in step with TAB_TOURS in tourService). Lives here so the
 * help menu can ask without loading driver.js. */
const TAB_TOUR_TABS = new Set(['booking', 'vessel', 'container', 'dashboard']);
export const hasTabTour = (tabId: string): boolean => TAB_TOUR_TABS.has(tabId);

type TourEventListener = (action: TourActionType) => void;

const tourActionListeners = new Set<TourEventListener>();

export const subscribeTourActions = (listener: TourEventListener) => {
  tourActionListeners.add(listener);
  return () => {
    tourActionListeners.delete(listener);
  };
};

export const emitTourAction = (action: TourActionType) => {
  tourActionListeners.forEach((fn) => {
    try {
      fn(action);
    } catch (e) {
      console.error('Tour action error:', e);
    }
  });
};

/**
 * Checks if the user has completed onboarding before, returns boolean
 */
export const hasCompletedOnboarding = (): boolean => {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'true';
  } catch {
    return false;
  }
};

/**
 * Marks onboarding as completed or dismissed
 */
export const setOnboardingCompleted = (completed: boolean = true) => {
  try {
    localStorage.setItem(ONBOARDING_KEY, completed ? 'true' : 'false');
  } catch {
    // private window / blocked storage: the welcome just shows again next time
  }
};

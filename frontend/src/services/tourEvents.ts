const ONBOARDING_KEY = 'auto_read_pdf_onboarding_completed_v2';

export type TourActionType =
  | 'openColorConfig'
  | 'closeColorConfig'
  | 'openImageModal'
  | 'closeImageModal'
  | 'openVesselWatchlist'
  | 'closeVesselWatchlist'
  | 'openContainerWatchlist'
  | 'closeContainerWatchlist';

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
  return localStorage.getItem(ONBOARDING_KEY) === 'true';
};

/**
 * Marks onboarding as completed or dismissed
 */
export const setOnboardingCompleted = (completed: boolean = true) => {
  localStorage.setItem(ONBOARDING_KEY, completed ? 'true' : 'false');
};
